import { bm25Search, similaritySearch } from "@/lib/db/queries";
import { rerankDocuments } from "./rerank";

export interface ChunkCitation {
  content: string;
  chunkIndex: number;
  fileName: string;
  pageNumber?: number | null;
  /** Relevance score from reranker (0–1), only present when reranking is enabled */
  score?: number;
}

function reciprocalRankFusion(
  results: Array<{
    id: string;
    content: string;
    chunkIndex: number;
    fileName: string;
    pageNumber?: number | null;
    source: "vector" | "bm25";
    rank: number;
  }>,
  k = 60
): Array<ChunkCitation & { score: number }> {
  const scoreMap = new Map<
    string,
    {
      content: string;
      chunkIndex: number;
      fileName: string;
      pageNumber?: number | null;
      vectorRank?: number;
      bm25Rank?: number;
    }
  >();

  for (const result of results) {
    const key = `${result.fileName}-${result.chunkIndex}`;
    const existing = scoreMap.get(key);

    if (existing) {
      if (result.source === "vector") {
        existing.vectorRank = result.rank;
      } else {
        existing.bm25Rank = result.rank;
      }
    } else {
      scoreMap.set(key, {
        content: result.content,
        chunkIndex: result.chunkIndex,
        fileName: result.fileName,
        pageNumber: result.pageNumber,
        vectorRank: result.source === "vector" ? result.rank : undefined,
        bm25Rank: result.source === "bm25" ? result.rank : undefined,
      });
    }
  }

  const scored = Array.from(scoreMap.values()).map((item) => {
    let score = 0;
    if (item.vectorRank !== undefined) {
      score += 1 / (k + item.vectorRank);
    }
    if (item.bm25Rank !== undefined) {
      score += 1 / (k + item.bm25Rank);
    }
    return {
      content: item.content,
      chunkIndex: item.chunkIndex,
      fileName: item.fileName,
      pageNumber: item.pageNumber,
      score,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export async function hybridSearch({
  chatId,
  query,
  embedding,
  documentIds,
  limit = 5,
  vectorLimit = 20,
  bm25Limit = 20,
  useRerank = true,
}: {
  chatId: string;
  query: string;
  embedding: number[];
  documentIds?: string[];
  limit?: number;
  vectorLimit?: number;
  bm25Limit?: number;
  useRerank?: boolean;
}): Promise<ChunkCitation[]> {
  const [vectorResults, bm25Results] = await Promise.all([
    similaritySearch({ chatId, embedding, documentIds, limit: vectorLimit }),
    bm25Search({ chatId, query, documentIds, limit: bm25Limit }),
  ]);

  console.log(
    `[Hybrid Search] Vector: ${vectorResults.length}, BM25: ${bm25Results.length}`
  );

  // If one method returns no results, fall back to the other
  if (vectorResults.length === 0 && bm25Results.length === 0) {
    return [];
  }
  if (vectorResults.length === 0) {
    return await rerankAndFormat({
      query,
      candidates: bm25Results,
      useRerank,
      limit,
      topK: limit,
    });
  }
  if (bm25Results.length === 0) {
    return await rerankAndFormat({
      query,
      candidates: vectorResults,
      useRerank,
      limit,
      topK: limit,
    });
  }

  // Prepare results with ranks for RRF
  const rankedResults = [
    ...vectorResults.map((r, idx) => ({
      id: `${r.fileName}-${r.chunkIndex}`,
      content: r.content,
      chunkIndex: r.chunkIndex,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      source: "vector" as const,
      rank: idx + 1,
    })),
    ...bm25Results.map((r, idx) => ({
      id: `${r.fileName}-${r.chunkIndex}`,
      content: r.content,
      chunkIndex: r.chunkIndex,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      source: "bm25" as const,
      rank: idx + 1,
    })),
  ];

  // Apply RRF fusion
  const fused = reciprocalRankFusion(rankedResults);

  // Get top candidates for reranking
  const candidates = fused.slice(0, Math.max(limit * 2, 10));

  return await rerankAndFormat({
    query,
    candidates,
    useRerank,
    limit,
    topK: limit,
  });
}

/** Apply reranking (if enabled) and format to ChunkCitation */
async function rerankAndFormat({
  query,
  candidates,
  useRerank,
  limit,
  topK,
}: {
  query: string;
  candidates: ChunkCitation[];
  useRerank: boolean;
  limit: number;
  topK: number;
}): Promise<ChunkCitation[]> {
  if (useRerank && candidates.length > topK) {
    console.log(`[Hybrid Search] Reranking ${candidates.length} candidates`);
    const reranked = await rerankDocuments({
      query,
      documents: candidates,
      topK,
    });
    return reranked.map((r) => ({
      content: r.content,
      chunkIndex: r.chunkIndex,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      score: r.score,
    }));
  }

  if (useRerank) {
    // Fewer candidates than topK — skip API call, rerankDocuments would just return them
    return candidates.slice(0, topK).map((r) => ({
      content: r.content,
      chunkIndex: r.chunkIndex,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      score: r.score,
    }));
  }

  // No reranking — no meaningful score
  return candidates.slice(0, limit).map((r) => ({
    content: r.content,
    chunkIndex: r.chunkIndex,
    fileName: r.fileName,
    pageNumber: r.pageNumber,
  }));
}
