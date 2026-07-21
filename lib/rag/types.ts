export type RetrievalStrategy = "vector" | "lexical" | "hybrid";
export type RemoteRerankerName = "aliyun/qwen3-rerank";
export type RerankerName = RemoteRerankerName | "heuristic" | "identity";

export type RerankerAttempt = {
  reranker: RemoteRerankerName;
  status: "failed" | "succeeded";
  error?: string;
};

export type RetrievedChunk = {
  chunkId: string;
  resourceId: string;
  content: string;
  chunkIndex: number;
  fileName: string;
  pageNumber: number | null;
  vectorDistance?: number;
  lexicalRank?: number;
  fusionScore?: number;
  rerankScore?: number;
  reranker?: RerankerName;
  rerankerAttempt?: RerankerAttempt;
};

export type VectorSearchResult = RetrievedChunk & {
  vectorDistance: number;
};

export type LexicalSearchResult = RetrievedChunk & {
  lexicalRank: number;
};

export type RankedSearchResult =
  | (VectorSearchResult & { source: "vector"; rank: number })
  | (LexicalSearchResult & { source: "lexical"; rank: number });
