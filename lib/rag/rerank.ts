import type { RerankerAttempt, RerankerName } from "./types";

/**
 * Reranker — improves retrieval quality via second-stage scoring.
 *
 * Priority chain:
 *   1. Alibaba Cloud Model Studio qwen3-rerank
 *   2. Heuristic              (no API key required)
 */

const QWEN3_RERANK_PATH = "/services/rerank/text-rerank/text-rerank";

export interface RerankDocument {
  content: string;
  chunkIndex: number;
  fileName: string;
  pageNumber?: number | null;
}

export async function rerankDocuments<T extends RerankDocument>({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: T[];
  topK?: number;
}): Promise<
  Array<
    T & {
      reranker: RerankerName;
      rerankerAttempt?: RerankerAttempt;
      rerankScore: number;
    }
  >
> {
  if (documents.length <= topK) {
    return documents.slice(0, topK).map((document) => ({
      ...document,
      reranker: "identity" as const,
      rerankScore: 1,
    }));
  }

  if (process.env.ALIYUN_RERANK_API_KEY && process.env.ALIYUN_RERANK_BASE_URL) {
    try {
      return await rerankWithQwen3({ query, documents, topK });
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      console.error("[Qwen3 Rerank Error] Falling back to heuristic:", error);
      return rerankWithHeuristic({
        query,
        documents,
        topK,
        rerankerAttempt: {
          reranker: "aliyun/qwen3-rerank",
          status: "failed",
          error: failure,
        },
      });
    }
  }

  console.log(
    "[Rerank] Using heuristic (set ALIYUN_RERANK_API_KEY and ALIYUN_RERANK_BASE_URL for Qwen3 reranking)"
  );
  return rerankWithHeuristic({ query, documents, topK });
}

// ─── Alibaba Cloud Model Studio qwen3-rerank ───────────────

async function rerankWithQwen3<T extends RerankDocument>({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: T[];
  topK?: number;
}): Promise<
  Array<
    T & {
      reranker: RerankerName;
      rerankerAttempt: RerankerAttempt;
      rerankScore: number;
    }
  >
> {
  const baseUrl = process.env.ALIYUN_RERANK_BASE_URL?.replace(/\/$/u, "");
  const response = await fetch(`${baseUrl}${QWEN3_RERANK_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ALIYUN_RERANK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "qwen3-rerank",
      input: {
        query,
        documents: documents.map((document) => document.content),
      },
      parameters: {
        top_n: topK,
        return_documents: false,
      },
    }),
  });

  if (!response.ok) {
    const error = (await response.text()).slice(0, 500);
    throw new Error(`Qwen3 rerank failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    output?: {
      results?: Array<{ index: number; relevance_score: number }>;
    };
  };

  if (!Array.isArray(data.output?.results)) {
    throw new Error("Qwen3 rerank returned no results array");
  }
  const results = data.output.results;

  console.log(
    `[Qwen3 Rerank] ${documents.length} docs → top ${topK}, score range: ${results[0]?.relevance_score.toFixed(3)} - ${results.at(-1)?.relevance_score.toFixed(3)}`
  );

  return results.map((result) => {
    const document = documents[result.index];
    if (document === undefined) {
      throw new Error(
        `Qwen3 rerank returned invalid document index: ${result.index}`
      );
    }
    return {
      ...document,
      reranker: "aliyun/qwen3-rerank",
      rerankerAttempt: {
        reranker: "aliyun/qwen3-rerank",
        status: "succeeded",
      },
      rerankScore: result.relevance_score,
    };
  });
}

// ─── Heuristic fallback ────────────────────────────────────

function rerankWithHeuristic<T extends RerankDocument>({
  query,
  documents,
  topK = 5,
  rerankerAttempt,
}: {
  query: string;
  documents: T[];
  topK?: number;
  rerankerAttempt?: RerankerAttempt;
}): Array<
  T & {
    reranker: RerankerName;
    rerankerAttempt?: RerankerAttempt;
    rerankScore: number;
  }
> {
  const results = documents.map((doc) => ({
    ...doc,
    reranker: "heuristic" as const,
    ...(rerankerAttempt === undefined ? {} : { rerankerAttempt }),
    rerankScore: calculateRelevanceScore(query, doc.content),
  }));

  results.sort((a, b) => b.rerankScore - a.rerankScore);

  console.log(
    `[Heuristic Rerank] Top score: ${results[0]?.rerankScore.toFixed(3)}, Bottom: ${results.at(-1)?.rerankScore.toFixed(3)}`
  );

  return results.slice(0, topK);
}

function calculateRelevanceScore(query: string, document: string): number {
  const queryLower = query.toLowerCase();
  const docLower = document.toLowerCase();

  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
  const docWords = new Set(docLower.split(/\s+/));
  const overlap = queryWords.filter((w) => docWords.has(w)).length;
  const keywordScore = overlap / Math.max(queryWords.length, 1);

  const phraseScore = docLower.includes(queryLower) ? 0.5 : 0;

  const lengthPenalty = Math.min(1, 500 / document.length);

  return keywordScore * 0.5 + phraseScore + lengthPenalty * 0.2;
}
