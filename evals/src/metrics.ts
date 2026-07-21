import type { EvalRetrievedChunk, RagEvalCase } from "./schema";

export type RetrievalCaseResult = {
  caseId: string;
  query: string;
  category: string;
  language: RagEvalCase["language"];
  answerable: boolean;
  documentRecallAtK: number | null;
  goldDocumentCoverageAtK: number | null;
  evidenceCoverageAtK: number | null;
  contextPrecisionAtK: number | null;
  recallAtK: number | null;
  mrr: number | null;
  ndcgAtK: number | null;
  falseRetrieval: boolean;
  latencyMs: number;
  retrievedCount: number;
  relevantRanks: number[];
  topResults: Array<{
    rank: number;
    chunkId: string;
    resourceId: string;
    fileName: string;
    pageNumber: number | null;
    contentPreview: string;
    relevant: boolean;
    vectorDistance?: number;
    lexicalRank?: number;
    fusionScore?: number;
    rerankScore?: number;
    reranker?: EvalRetrievedChunk["reranker"];
    rerankerAttempt?: EvalRetrievedChunk["rerankerAttempt"];
  }>;
  error?: string;
};

function contentPreview(content: string): string {
  const compact = content.replaceAll(/\s+/gu, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 160)}…` : compact;
}

export function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function matchesDocumentId(
  documentId: string,
  chunk: EvalRetrievedChunk
): boolean {
  return (
    documentId === chunk.resourceId ||
    documentId === fileNameWithoutExtension(chunk.fileName)
  );
}

function matchesGoldDocument(
  evalCase: RagEvalCase,
  chunk: EvalRetrievedChunk
): boolean {
  return evalCase.relevantDocumentIds.some((id) =>
    matchesDocumentId(id, chunk)
  );
}

export function isRelevant(
  evalCase: RagEvalCase,
  chunk: EvalRetrievedChunk
): boolean {
  if (!matchesGoldDocument(evalCase, chunk)) {
    return false;
  }

  const pageMatches =
    chunk.pageNumber !== null &&
    evalCase.evidencePages.includes(chunk.pageNumber);
  const normalizedContent = normalizeEvidenceText(chunk.content);
  const evidenceMatches = evalCase.evidenceTexts.some((evidence) =>
    normalizedContent.includes(normalizeEvidenceText(evidence))
  );

  return pageMatches || evidenceMatches;
}

function goldDocumentCoverage(
  evalCase: RagEvalCase,
  chunks: EvalRetrievedChunk[]
): number {
  const goldIds = [...new Set(evalCase.relevantDocumentIds)];
  if (goldIds.length === 0) {
    return 0;
  }
  return (
    goldIds.filter((id) => chunks.some((chunk) => matchesDocumentId(id, chunk)))
      .length / goldIds.length
  );
}

function evidenceCoverage(
  evalCase: RagEvalCase,
  chunks: EvalRetrievedChunk[]
): number {
  const goldChunks = chunks.filter((chunk) =>
    matchesGoldDocument(evalCase, chunk)
  );
  if (evalCase.evidenceTexts.length > 0) {
    const matched = evalCase.evidenceTexts.filter((evidence) => {
      const normalizedEvidence = normalizeEvidenceText(evidence);
      return goldChunks.some((chunk) =>
        normalizeEvidenceText(chunk.content).includes(normalizedEvidence)
      );
    }).length;
    return matched / evalCase.evidenceTexts.length;
  }
  if (evalCase.evidencePages.length > 0) {
    const pages = [...new Set(evalCase.evidencePages)];
    return (
      pages.filter((page) =>
        goldChunks.some((chunk) => chunk.pageNumber === page)
      ).length / pages.length
    );
  }
  return Number(goldChunks.length > 0);
}

export function reciprocalRank(relevance: boolean[]): number {
  const firstRelevantIndex = relevance.indexOf(true);
  return firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);
}

function discountedCumulativeGain(relevance: boolean[]): number {
  return relevance.reduce(
    (total, relevant, index) =>
      relevant ? total + 1 / Math.log2(index + 2) : total,
    0
  );
}

export function ndcgAtK(relevance: boolean[], k: number): number {
  const topK = relevance.slice(0, k);
  const relevantCount = topK.filter(Boolean).length;

  if (relevantCount === 0) {
    return 0;
  }

  const ideal = Array.from(
    { length: topK.length },
    (_, index) => index < relevantCount
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
    relevant ? [index + 1] : []
  );
  const topResults = topK.map((chunk, index) => ({
    rank: index + 1,
    chunkId: chunk.chunkId,
    resourceId: chunk.resourceId,
    fileName: chunk.fileName,
    pageNumber: chunk.pageNumber,
    contentPreview: contentPreview(chunk.content),
    relevant: relevance[index] ?? false,
    ...(chunk.vectorDistance === undefined
      ? {}
      : { vectorDistance: chunk.vectorDistance }),
    ...(chunk.lexicalRank === undefined
      ? {}
      : { lexicalRank: chunk.lexicalRank }),
    ...(chunk.fusionScore === undefined
      ? {}
      : { fusionScore: chunk.fusionScore }),
    ...(chunk.rerankScore === undefined
      ? {}
      : { rerankScore: chunk.rerankScore }),
    ...(chunk.reranker === undefined ? {} : { reranker: chunk.reranker }),
    ...(chunk.rerankerAttempt === undefined
      ? {}
      : { rerankerAttempt: chunk.rerankerAttempt }),
  }));

  return {
    caseId: evalCase.id,
    query: evalCase.query,
    category: evalCase.category,
    language: evalCase.language,
    answerable: evalCase.answerable,
    documentRecallAtK: evalCase.answerable
      ? Number(topK.some((chunk) => matchesGoldDocument(evalCase, chunk)))
      : null,
    goldDocumentCoverageAtK: evalCase.answerable
      ? goldDocumentCoverage(evalCase, topK)
      : null,
    evidenceCoverageAtK: evalCase.answerable
      ? evidenceCoverage(evalCase, topK)
      : null,
    contextPrecisionAtK: evalCase.answerable
      ? topK.length === 0
        ? 0
        : relevance.filter(Boolean).length / topK.length
      : null,
    recallAtK: evalCase.answerable ? Number(relevance.some(Boolean)) : null,
    mrr: evalCase.answerable ? reciprocalRank(relevance) : null,
    ndcgAtK: evalCase.answerable ? ndcgAtK(relevance, k) : null,
    falseRetrieval: !evalCase.answerable && retrieved.length > 0,
    latencyMs,
    retrievedCount: retrieved.length,
    relevantRanks,
    topResults,
  };
}
