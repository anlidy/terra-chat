import type { EvalRetrievedChunk, RagEvalCase } from "./schema";

export type RetrievalCaseResult = {
  caseId: string;
  query: string;
  answerable: boolean;
  recallAtK: number | null;
  mrr: number | null;
  ndcgAtK: number | null;
  falseRetrieval: boolean;
  latencyMs: number;
  retrievedCount: number;
  relevantRanks: number[];
  error?: string;
};

export function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function isRelevant(
  evalCase: RagEvalCase,
  chunk: EvalRetrievedChunk,
): boolean {
  const documentMatches = evalCase.relevantDocumentIds.some(
    (id) =>
      id === chunk.resourceId || id === fileNameWithoutExtension(chunk.fileName),
  );

  if (!documentMatches) {
    return false;
  }

  const pageMatches =
    chunk.pageNumber !== null &&
    evalCase.evidencePages.includes(chunk.pageNumber);
  const normalizedContent = normalizeEvidenceText(chunk.content);
  const evidenceMatches = evalCase.evidenceTexts.some((evidence) =>
    normalizedContent.includes(normalizeEvidenceText(evidence)),
  );

  return pageMatches || evidenceMatches;
}

export function reciprocalRank(relevance: boolean[]): number {
  const firstRelevantIndex = relevance.indexOf(true);
  return firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);
}

function discountedCumulativeGain(relevance: boolean[]): number {
  return relevance.reduce(
    (total, relevant, index) =>
      relevant ? total + 1 / Math.log2(index + 2) : total,
    0,
  );
}

export function ndcgAtK(relevance: boolean[], k: number): number {
  const topK = relevance.slice(0, k);
  const relevantCount = topK.filter(Boolean).length;

  if (relevantCount === 0) {
    return 0;
  }

  const ideal = Array.from({ length: topK.length }, (_, index) =>
    index < relevantCount,
  );
  return discountedCumulativeGain(topK) / discountedCumulativeGain(ideal);
}

export function percentile(values: number[], probability: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (probability < 0 || probability > 1) {
    throw new RangeError("Percentile probability must be between 0 and 1");
  }

  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(probability * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function evaluateRetrievalCase({
  evalCase,
  retrieved,
  latencyMs,
  k,
}: {
  evalCase: RagEvalCase;
  retrieved: EvalRetrievedChunk[];
  latencyMs: number;
  k: number;
}): RetrievalCaseResult {
  const topK = retrieved.slice(0, k);
  const relevance = topK.map((chunk) => isRelevant(evalCase, chunk));
  const relevantRanks = relevance.flatMap((relevant, index) =>
    relevant ? [index + 1] : [],
  );

  return {
    caseId: evalCase.id,
    query: evalCase.query,
    answerable: evalCase.answerable,
    recallAtK: evalCase.answerable ? Number(relevance.some(Boolean)) : null,
    mrr: evalCase.answerable ? reciprocalRank(relevance) : null,
    ndcgAtK: evalCase.answerable ? ndcgAtK(relevance, k) : null,
    falseRetrieval: !evalCase.answerable && retrieved.length > 0,
    latencyMs,
    retrievedCount: retrieved.length,
    relevantRanks,
  };
}
