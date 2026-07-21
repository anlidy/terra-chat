import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateText, type LanguageModelUsage } from "ai";

import { getLanguageModel } from "../../lib/ai/providers";
import { getCustomProviderById } from "../../lib/db/queries";
import { RAG_PIPELINE_VERSION } from "../../lib/rag/config";
import { retrieveDocumentChunks } from "../../lib/rag/retrieve";
import { latestReportFileStem } from "./report";
import type { RagEvalCase } from "./schema";

const INPUT_CACHE_HIT_USD_PER_MILLION = 0.0028;
const INPUT_CACHE_MISS_USD_PER_MILLION = 0.14;
const OUTPUT_USD_PER_MILLION = 0.28;

type AnswerEvaluationCaseResult = {
  caseId: string;
  answer: string;
  citations: string[];
  faithfulnessScore: number;
  judgeRationale: string;
  citationCorrectness: number;
  inputTokens: number;
  outputTokens: number;
  externalApiCalls: {
    embedding: number;
    rerank: number;
    answer: number;
    judge: number;
  };
  estimatedCostUsd: number;
};

function usageCost(usage: LanguageModelUsage): number {
  const inputTokens = usage.inputTokens ?? 0;
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheMissTokens = Math.max(0, inputTokens - cacheReadTokens);
  return (
    (cacheReadTokens * INPUT_CACHE_HIT_USD_PER_MILLION +
      cacheMissTokens * INPUT_CACHE_MISS_USD_PER_MILLION +
      (usage.outputTokens ?? 0) * OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}

function correctCitation(evalCase: RagEvalCase, citation: string): boolean {
  const stem = path.basename(citation, path.extname(citation));
  return evalCase.relevantDocumentIds.includes(stem);
}

function extractCitations(answer: string): string[] {
  return [
    ...answer.matchAll(/\[([^\]]+\.(?:docx|pdf|pptx|txt|xlsx))\]/giu),
  ].map((match) => match[1] as string);
}

function parseJudge(text: string): {
  faithfulnessScore: number;
  rationale: string;
} {
  const match = text.match(/SCORE:\s*(0(?:\.\d+)?|1(?:\.0+)?)/iu);
  if (match?.[1] === undefined) {
    throw new Error(`Judge returned no valid SCORE: ${text.slice(0, 200)}`);
  }
  return {
    faithfulnessScore: Number(match[1]),
    rationale: text.replace(match[0], "").trim(),
  };
}

export async function runAnswerEvaluation({
  answerModel,
  cases,
  chatId,
  documentIds,
  dataset,
  caseSetHash,
  corpusHash,
  sourceRevision,
}: {
  answerModel: string;
  cases: RagEvalCase[];
  chatId: string;
  documentIds: string[];
  dataset: string;
  caseSetHash: string;
  corpusHash: string;
  sourceRevision: string;
}) {
  const slashIndex = answerModel.indexOf("/");
  if (slashIndex < 1) {
    throw new Error("--answer-model must use <provider-id>/<model-id>");
  }
  const provider = await getCustomProviderById({
    id: answerModel.slice(0, slashIndex),
  });
  if (provider === null) {
    throw new Error(`Answer evaluation provider not found: ${answerModel}`);
  }
  const model = await getLanguageModel(answerModel, provider.userId);
  const results: AnswerEvaluationCaseResult[] = [];

  for (const [index, evalCase] of cases.entries()) {
    const chunks = await retrieveDocumentChunks({
      chatId,
      documentIds,
      query: evalCase.query,
      limit: 5,
      strategy: "hybrid",
      useRerank: true,
    });
    const context = chunks
      .map((chunk) => `[${chunk.fileName}]\n${chunk.content}`)
      .join("\n\n");
    const answerResult = await generateText({
      model,
      maxOutputTokens: 800,
      temperature: 0,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
      },
      prompt: `Answer the question using only the supplied context. If the context is insufficient, say so and include no citation. Cite supporting sources inline using the exact format [filename].\n\nQuestion:\n${evalCase.query}\n\nContext:\n${context}`,
    });
    const answer = answerResult.text;
    const citations = extractCitations(answer);
    const judgeResult = await generateText({
      model,
      maxOutputTokens: 400,
      temperature: 0,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
      },
      prompt: `Judge whether every factual claim in the answer is supported by the context. Score 1 only when fully supported, 0 when unsupported, and use intermediate values for partial support. Do not reward correctness from outside knowledge. Start the response with exactly SCORE: <number from 0 to 1>, followed by a short rationale.\n\nQuestion:\n${evalCase.query}\n\nAnswer:\n${answer}\n\nContext:\n${context}`,
    });
    const judge = parseJudge(judgeResult.text);
    const correctCitations = citations.filter((citation) =>
      correctCitation(evalCase, citation)
    ).length;
    const citationCorrectness = evalCase.answerable
      ? citations.length === 0
        ? 0
        : correctCitations / citations.length
      : citations.length === 0
        ? 1
        : 0;
    const inputTokens =
      (answerResult.usage.inputTokens ?? 0) +
      (judgeResult.usage.inputTokens ?? 0);
    const outputTokens =
      (answerResult.usage.outputTokens ?? 0) +
      (judgeResult.usage.outputTokens ?? 0);
    results.push({
      caseId: evalCase.id,
      answer,
      citations,
      faithfulnessScore: judge.faithfulnessScore,
      judgeRationale: judge.rationale,
      citationCorrectness,
      inputTokens,
      outputTokens,
      externalApiCalls: {
        embedding: 1,
        rerank: chunks.some((chunk) => chunk.rerankerAttempt !== undefined)
          ? 1
          : 0,
        answer: 1,
        judge: 1,
      },
      estimatedCostUsd:
        usageCost(answerResult.usage) + usageCost(judgeResult.usage),
    });
    console.log(`[eval:answer] Progress ${index + 1}/${cases.length}`);
  }

  const total = (field: "inputTokens" | "outputTokens" | "estimatedCostUsd") =>
    results.reduce((sum, result) => sum + result[field], 0);
  const report = {
    metadata: {
      dataset,
      generatedAt: new Date().toISOString(),
      sourceRevision,
      caseSetHash,
      corpusHash,
      pipelineVersion: RAG_PIPELINE_VERSION,
      answerModel,
      judgeModel: answerModel,
      judgeIndependence: "same-model",
      pricingUsdPerMillionTokens: {
        inputCacheHit: INPUT_CACHE_HIT_USD_PER_MILLION,
        inputCacheMiss: INPUT_CACHE_MISS_USD_PER_MILLION,
        output: OUTPUT_USD_PER_MILLION,
      },
    },
    summary: {
      caseCount: results.length,
      averageFaithfulness:
        results.reduce((sum, result) => sum + result.faithfulnessScore, 0) /
        results.length,
      averageCitationCorrectness:
        results.reduce((sum, result) => sum + result.citationCorrectness, 0) /
        results.length,
      inputTokens: total("inputTokens"),
      outputTokens: total("outputTokens"),
      externalApiCalls: results.reduce(
        (sum, result) =>
          sum + Object.values(result.externalApiCalls).reduce((a, b) => a + b),
        0
      ),
      estimatedCostUsd: total("estimatedCostUsd"),
    },
    cases: results,
  };
  const resultsDirectory = path.resolve("evals/results");
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    path.join(
      resultsDirectory,
      `${latestReportFileStem(dataset, "answer")}.json`
    ),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(JSON.stringify(report.summary, null, 2));
  return report;
}
