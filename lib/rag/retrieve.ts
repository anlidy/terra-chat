import type { RetrievedChunk, RetrievalStrategy } from "./types";

export type DocumentRetrievalInput = {
  chatId: string;
  query: string;
  documentIds?: string[];
  limit?: number;
  strategy?: RetrievalStrategy;
  useRerank?: boolean;
};

type SearchInput = DocumentRetrievalInput & {
  query: string;
  strategy: RetrievalStrategy;
  embedding?: number[];
};

type RetrieverDependencies = {
  embed: (query: string) => Promise<number[]>;
  search: (input: SearchInput) => Promise<RetrievedChunk[]>;
};

export function createDocumentRetriever({
  embed,
  search,
}: RetrieverDependencies): (
  input: DocumentRetrievalInput,
) => Promise<RetrievedChunk[]> {
  return async (input) => {
    const query = input.query.trim();
    if (query.length === 0) {
      throw new Error("Retrieval query must not be empty");
    }

    const strategy = input.strategy ?? "hybrid";
    const embedding = strategy === "lexical" ? undefined : await embed(query);
    return search({ ...input, query, strategy, embedding });
  };
}

export async function retrieveDocumentChunks(
  input: DocumentRetrievalInput,
): Promise<RetrievedChunk[]> {
  const [{ embedText }, { hybridSearch }] = await Promise.all([
    import("./embed"),
    import("./hybrid-search"),
  ]);
  return createDocumentRetriever({
    embed: embedText,
    search: hybridSearch,
  })(input);
}
