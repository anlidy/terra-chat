import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateText, type LanguageModelUsage } from "ai";

import { getLanguageModel } from "../../lib/ai/providers";
import { getCustomProviderById } from "../../lib/db/queries";
import { RAG_PIPELINE_VERSION } from "../../lib/rag/config";
import { retrieveDocumentChunks } from "../../lib/rag/retrieve";
import {
  type AnswerPricing,
  evaluateCitations,
  extractCitations,
  parseAnswerJudge,
  resolveAnswerPricing,
} from "./answer-metrics";
import { latestReportFileStem } from "./report";
import type { RagEvalCase } from "./schema";

type AnswerEvaluationCaseResult = {
  caseId: string;
  answer: string;
  citations: string[];
  faithfulnessScore: number;
  correctnessScore: number;
  completenessScore: number;
  judgeRationale: string;
  citationPrecision: number;
  citationRecall: number;
  inputTokens: number;
  outputTokens: number;
  externalApiCalls: {
    embedding: number;
    rerank: number;
    answer: number;
    judge: number;
  };
  estimatedCostUsd: number | null;
};

function usageCost(
  usage: LanguageModelUsage,
  pricing: AnswerPricing | null
): number | null {
  if (pricing === null) {
    return null;
  }
  const inputTokens = usage.inputTokens ?? 0;
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheMissTokens = Math.max(0, inputTokens - cacheReadTokens);
  return (
    (cacheReadTokens * pricing.inputCacheHit +
      cacheMissTokens * pricing.inputCacheMiss +
      (usage.outputTokens ?? 0) * pricing.output) /
    1_000_000
  );
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
  const pricing = resolveAnswerPricing(answerModel);
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
      prompt: `Evaluate the answer on three independent dimensions from 0 to 1. FAITHFULNESS measures whether every factual claim is supported by the supplied context. CORRECTNESS measures agreement with the expected answer; for an unanswerable case it measures whether the answer correctly refuses. COMPLETENESS measures coverage of the expected answer without omitting required facts. Do not use outside knowledge. Return exactly four labeled lines: FAITHFULNESS: <score>, CORRECTNESS: <score>, COMPLETENESS: <score>, RATIONALE: <short explanation>.\n\nQuestion:\n${evalCase.query}\n\nExpected answer:\n${evalCase.answerable ? evalCase.expectedAnswer : "<unanswerable: should refuse>"}\n\nAnswer:\n${answer}\n\nContext:\n${context}`,
    });
    const judge = parseAnswerJudge(judgeResult.text);
    const citationMetrics = evaluateCitations(evalCase, citations);
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
      correctnessScore: judge.correctnessScore,
      completenessScore: judge.completenessScore,
      judgeRationale: judge.rationale,
      ...citationMetrics,
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
        pricing === null
          ? null
          : (usageCost(answerResult.usage, pricing) ?? 0) +
            (usageCost(judgeResult.usage, pricing) ?? 0),
    });
    console.log(`[eval:answer] Progress ${index + 1}/${cases.length}`);
  }

  const total = (field: "inputTokens" | "outputTokens") =>
    results.reduce((sum, result) => sum + result[field], 0);
  const average = (
    field:
      | "faithfulnessScore"
      | "correctnessScore"
      | "completenessScore"
      | "citationPrecision"
      | "citationRecall"
  ) => results.reduce((sum, result) => sum + result[field], 0) / results.length;
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
      pricingUsdPerMillionTokens: pricing,
    },
    summary: {
      caseCount: results.length,
      averageFaithfulness: average("faithfulnessScore"),
      averageCorrectness: average("correctnessScore"),
      averageCompleteness: average("completenessScore"),
      averageCitationPrecision: average("citationPrecision"),
      averageCitationRecall: average("citationRecall"),
      inputTokens: total("inputTokens"),
      outputTokens: total("outputTokens"),
      externalApiCalls: results.reduce(
        (sum, result) =>
          sum + Object.values(result.externalApiCalls).reduce((a, b) => a + b),
        0
      ),
      estimatedCostUsd:
        pricing === null
          ? null
          : results.reduce(
              (sum, result) => sum + (result.estimatedCostUsd ?? 0),
              0
            ),
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
