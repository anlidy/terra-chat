import path from "node:path";

import type { RagEvalCase } from "./schema";

export type AnswerPricing = {
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
};

const DEEPSEEK_V4_FLASH_PRICING: AnswerPricing = {
  inputCacheHit: 0.0028,
  inputCacheMiss: 0.14,
  output: 0.28,
};

export function extractCitations(answer: string): string[] {
  return [
    ...answer.matchAll(/\[([^\]]+\.(?:docx|pdf|pptx|txt|xlsx))\]/giu),
  ].map((match) => match[1] as string);
}

function citationStem(citation: string): string {
  return path.basename(citation, path.extname(citation));
}

export function evaluateCitations(
  evalCase: RagEvalCase,
  citations: string[]
): { citationPrecision: number; citationRecall: number } {
  if (!evalCase.answerable) {
    const score = citations.length === 0 ? 1 : 0;
    return { citationPrecision: score, citationRecall: score };
  }
  const correct = citations.filter((citation) =>
    evalCase.relevantDocumentIds.includes(citationStem(citation))
  );
  const citedGoldDocuments = new Set(correct.map(citationStem));
  return {
    citationPrecision:
      citations.length === 0 ? 0 : citedGoldDocuments.size / citations.length,
    citationRecall:
      evalCase.relevantDocumentIds.length === 0
        ? 0
        : citedGoldDocuments.size / new Set(evalCase.relevantDocumentIds).size,
  };
}

function score(text: string, label: string): number {
  const match = text.match(
    new RegExp(`${label}:\\s*(0(?:\\.\\d+)?|1(?:\\.0+)?)`, "iu")
  );
  if (match?.[1] === undefined) {
    throw new Error(`Judge returned no valid ${label}: ${text.slice(0, 200)}`);
  }
  return Number(match[1]);
}

export function parseAnswerJudge(text: string): {
  faithfulnessScore: number;
  correctnessScore: number;
  completenessScore: number;
  rationale: string;
} {
  const rationale = text.match(/RATIONALE:\s*([\s\S]*)/iu)?.[1]?.trim() ?? "";
  return {
    faithfulnessScore: score(text, "FAITHFULNESS"),
    correctnessScore: score(text, "CORRECTNESS"),
    completenessScore: score(text, "COMPLETENESS"),
    rationale,
  };
}

export function resolveAnswerPricing(
  answerModel: string
): AnswerPricing | null {
  const modelId = answerModel.slice(answerModel.indexOf("/") + 1);
  return modelId === "deepseek-v4-flash" ? DEEPSEEK_V4_FLASH_PRICING : null;
}
