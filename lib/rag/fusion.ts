import type { RankedSearchResult, RetrievedChunk } from "./types";

type FusionCandidate = {
  chunk: RetrievedChunk;
  vectorRank?: number;
  lexicalRankPosition?: number;
};

export function reciprocalRankFusion(
  results: RankedSearchResult[],
  k = 60,
): RetrievedChunk[] {
  const candidates = new Map<string, FusionCandidate>();

  for (const result of results) {
    const existing = candidates.get(result.chunkId);
    const candidate = existing ?? {
      chunk: {
        chunkId: result.chunkId,
        resourceId: result.resourceId,
        content: result.content,
        chunkIndex: result.chunkIndex,
        fileName: result.fileName,
        pageNumber: result.pageNumber,
      },
    };

    if (result.source === "vector") {
      candidate.vectorRank = Math.min(
        candidate.vectorRank ?? Number.POSITIVE_INFINITY,
        result.rank,
      );
      candidate.chunk.vectorDistance = Math.min(
        candidate.chunk.vectorDistance ?? Number.POSITIVE_INFINITY,
        result.vectorDistance,
      );
    } else {
      candidate.lexicalRankPosition = Math.min(
        candidate.lexicalRankPosition ?? Number.POSITIVE_INFINITY,
        result.rank,
      );
      candidate.chunk.lexicalRank = Math.max(
        candidate.chunk.lexicalRank ?? Number.NEGATIVE_INFINITY,
        result.lexicalRank,
      );
    }

    candidates.set(result.chunkId, candidate);
  }

  return [...candidates.values()]
    .map(({ chunk, vectorRank, lexicalRankPosition }) => ({
      ...chunk,
      fusionScore:
        (vectorRank === undefined ? 0 : 1 / (k + vectorRank)) +
        (lexicalRankPosition === undefined
          ? 0
          : 1 / (k + lexicalRankPosition)),
    }))
    .sort(
      (left, right) =>
        (right.fusionScore ?? 0) - (left.fusionScore ?? 0),
    );
}
