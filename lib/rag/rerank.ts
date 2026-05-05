/**
 * Reranker — improves retrieval quality via second-stage scoring.
 *
 * Priority chain:
 *   1. DashScope gte-rerank (DASHSCOPE_API_KEY)
 *   2. Heuristic              (no API key required)
 */

interface RerankDocument {
  content: string;
  chunkIndex: number;
  fileName: string;
  pageNumber?: number | null;
}

interface RerankResult extends RerankDocument {
  score: number;
}

export async function rerankDocuments({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: RerankDocument[];
  topK?: number;
}): Promise<RerankResult[]> {
  if (documents.length <= topK) {
    return documents.slice(0, topK).map((d) => ({ ...d, score: 1 }));
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

async function rerankWithDashScope({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: RerankDocument[];
  topK?: number;
}): Promise<RerankResult[]> {
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

  return results.map((r) => ({
    ...documents[r.index],
    score: r.relevance_score,
  }));
}

// ─── Heuristic fallback ────────────────────────────────────

function rerankWithHeuristic({
  query,
  documents,
  topK = 5,
}: {
  query: string;
  documents: RerankDocument[];
  topK?: number;
}): RerankResult[] {
  const results = documents.map((doc) => ({
    ...doc,
    score: calculateRelevanceScore(query, doc.content),
  }));

  results.sort((a, b) => b.score - a.score);

  console.log(
    `[Heuristic Rerank] Top score: ${results[0]?.score.toFixed(3)}, Bottom: ${results.at(-1)?.score.toFixed(3)}`
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
