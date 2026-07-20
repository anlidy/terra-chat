import { tool } from "ai";
import { z } from "zod";
import { getDocumentsByChat } from "@/lib/db/queries";
import { retrieveDocumentChunks } from "@/lib/rag/retrieve";

export const retrieveDocuments = ({ chatId }: { chatId: string }) =>
  tool({
    description: `Retrieve relevant content from documents uploaded in this conversation.

Use cases:
1. User asks about specific information in the documents
2. User asks general/summary questions (e.g., "what is this document about", "summarize this")
3. System prompt doesn't provide sufficient relevant content

Important guidelines:
- Use short, specific keywords or phrases as queries, not complete sentences
- For general questions, call this tool multiple times with different query terms
- Each query should focus on one aspect, for example:
  * "main content" - get document overview
  * "key points" - get main arguments
  * "conclusion" - get summary content
  * "background" - get context information
- Optionally specify documentIds to search only within specific documents
- Use the getDocumentsStatus tool to get document IDs and filenames if needed

Examples:
- User asks "what is this document about" → Query sequentially: "topic", "main content", "purpose"
- User asks "summarize this" → Query sequentially: "key points", "main conclusions", "highlights"
- User asks "what technologies are mentioned" → Query: "technology", "methods"
- User asks about a specific document → First call getDocumentsStatus to get the document ID, then include documentIds parameter`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Short keyword or phrase (recommended 2-5 words) to find relevant content. Avoid long sentences or combinations of multiple concepts."
        ),
      documentIds: z
        .array(z.string())
        .optional()
        .describe(
          "Optional array of document IDs to limit search scope. If not provided, searches all ready documents. Use getDocumentsStatus tool to get document IDs."
        ),
    }),
    execute: async ({ query, documentIds }) => {
      // Check if documents exist
      const docs = await getDocumentsByChat({ chatId });
      if (docs.length === 0) {
        return {
          message:
            "No documents are available in this conversation. Please upload documents first using the file upload button.",
          chunks: [],
        };
      }

      // Filter by documentIds if provided
      let targetDocs = docs;
      if (documentIds && documentIds.length > 0) {
        targetDocs = docs.filter((d) => documentIds.includes(d.id));
        if (targetDocs.length === 0) {
          return {
            message: "The specified document IDs were not found.",
            chunks: [],
          };
        }
      }

      // Check if any documents are ready
      const readyDocs = targetDocs.filter((d) => d.status === "ready");
      if (readyDocs.length === 0) {
        return {
          message:
            "Documents are still processing. Please wait a moment and try again.",
          chunks: [],
        };
      }

      const chunks = await retrieveDocumentChunks({
        chatId,
        query,
        documentIds: readyDocs.map((d) => d.id),
      });
      console.log(
        `[RAG Tool] Retrieved ${chunks.length} chunks for query: ${query}`
      );
      return chunks.map((c) => ({
        chunkId: c.chunkId,
        resourceId: c.resourceId,
        content: c.content,
        fileName: c.fileName,
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        fusionScore: c.fusionScore,
        rerankScore: c.rerankScore,
        citation:
          c.pageNumber === null
            ? c.fileName
            : `${c.fileName} (Page ${c.pageNumber})`,
      }));
    },
  });
