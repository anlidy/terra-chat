import { lexicalSearch, similaritySearch } from "@/lib/db/queries";
import { reciprocalRankFusion } from "./fusion";
import { rerankDocuments } from "./rerank";
import type {
  LexicalSearchResult,
  RankedSearchResult,
  RetrievalStrategy,
  RetrievedChunk,
  VectorSearchResult,
} from "./types";

type HybridSearchInput = {
  scope?: {
    principalId: string;
    collectionIds: string[];
  };
  query: string;
  embedding?: number[];
  documentIds?: string[];
  limit?: number;
  vectorLimit?: number;
  lexicalLimit?: number;
  useRerank?: boolean;
  strategy?: RetrievalStrategy;
};

function rankVectorResults(
  results: VectorSearchResult[]
): RankedSearchResult[] {
  return results.map((result, index) => ({
    ...result,
    source: "vector",
    rank: index + 1,
  }));
}

function rankLexicalResults(
  results: LexicalSearchResult[]
): RankedSearchResult[] {
  return results.map((result, index) => ({
    ...result,
    source: "lexical",
    rank: index + 1,
  }));
}

export async function hybridSearch({
  scope,
  query,
  embedding,
  documentIds,
  limit = 5,
  vectorLimit = 20,
  lexicalLimit = 20,
  useRerank = true,
  strategy = "hybrid",
}: HybridSearchInput): Promise<RetrievedChunk[]> {
  if (!scope || scope.collectionIds.length === 0) {
    return [];
  }
  const searchVector = (): Promise<VectorSearchResult[]> => {
    if (embedding === undefined) {
      throw new Error(`An embedding is required for ${strategy} retrieval`);
    }
    return similaritySearch({
      scope,
      embedding,
      documentIds,
      limit: vectorLimit,
    });
  };
  const searchLexical = (): Promise<LexicalSearchResult[]> =>
    lexicalSearch({
      scope,
      query,
      documentIds,
      limit: lexicalLimit,
    });

  let vectorResults: VectorSearchResult[] = [];
  let lexicalResults: LexicalSearchResult[] = [];
  if (strategy === "hybrid") {
    [vectorResults, lexicalResults] = await Promise.all([
      searchVector(),
      searchLexical(),
    ]);
  } else if (strategy === "vector") {
    vectorResults = await searchVector();
  } else {
    lexicalResults = await searchLexical();
  }

  console.log(
    `[Retrieval] Strategy: ${strategy}, vector: ${vectorResults.length}, lexical: ${lexicalResults.length}`
  );
  const rankedResults = [
    ...rankVectorResults(vectorResults),
    ...rankLexicalResults(lexicalResults),
  ];
  if (rankedResults.length === 0) {
    return [];
  }

  const fused = reciprocalRankFusion(rankedResults);
  const candidates = fused.slice(0, Math.max(limit * 2, 10));
  if (!useRerank) {
    return candidates.slice(0, limit);
  }

  return rerankDocuments({ query, documents: candidates, topK: limit });
}
