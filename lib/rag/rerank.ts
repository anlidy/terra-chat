import type { RerankerName } from "./types";

/**
 * Reranker — improves retrieval quality via second-stage scoring.
 *
 * Priority chain:
 *   1. DashScope gte-rerank (DASHSCOPE_API_KEY)
 *   2. Heuristic              (no API key required)
 */

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
}): Promise<Array<T & { reranker: RerankerName; rerankScore: number }>> {
  if (documents.length <= topK) {
    return documents.slice(0, topK).map((document) => ({
      ...document,
      reranker: "identity" as const,
      rerankScore: 1,
    }));
  }

  if (process.env.DASHSCOPE_API_KEY) {
    try {
      return await rerankWithDashScope({ query, documents, topK });
    } catch (error) {
      console.error(
        "[DashScope Rerank Error] Falling back to heuristic:",
        error
      );
    }
  }

  console.log(
    "[Rerank] Using heuristic (set DASHSCOPE_API_KEY for better results)"
  );
  return rerankWithHeuristic({ query, documents, topK });
}

// ─── DashScope gte-rerank ──────────────────────────────────

async function rerankWithDashScope<T extends RerankDocument>({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: T[];
  topK?: number;
}): Promise<Array<T & { reranker: RerankerName; rerankScore: number }>> {
  const response = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gte-rerank",
        input: {
          query,
          documents: documents.map((d) => d.content),
        },
        parameters: {
          top_n: topK,
          return_documents: false,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DashScope rerank failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const results = data.output.results as Array<{
    index: number;
    relevance_score: number;
  }>;

  console.log(
    `[DashScope Rerank] ${documents.length} docs → top ${topK}, score range: ${results[0]?.relevance_score.toFixed(3)} - ${results.at(-1)?.relevance_score.toFixed(3)}`
  );

  return results.map((result) => {
    const document = documents[result.index];
    if (document === undefined) {
      throw new Error(
        `DashScope returned invalid document index: ${result.index}`
      );
    }
    return {
      ...document,
      reranker: "dashscope/gte-rerank",
      rerankScore: result.relevance_score,
    };
  });
}

// ─── Heuristic fallback ────────────────────────────────────

function rerankWithHeuristic<T extends RerankDocument>({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: T[];
  topK?: number;
}): Array<T & { reranker: RerankerName; rerankScore: number }> {
  const results = documents.map((doc) => ({
    ...doc,
    reranker: "heuristic" as const,
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
