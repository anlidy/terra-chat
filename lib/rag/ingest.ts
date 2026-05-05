import { after } from "next/server";
import {
  insertDocumentChunks,
  insertDocumentResource,
  updateDocumentResourceStatus,
} from "@/lib/db/queries";
import { chunkMarkdown } from "./chunk";
import { embedText } from "./embed";
import { parseDocument } from "./parse";

/**
 * Ingest a document: create record immediately, process in background
 *
 * @returns resourceId - Document resource ID (created immediately)
 *
 * Flow:
 * 1. Create document_resource record immediately (status: pending)
 * 2. Return resourceId
 * 3. Process document in background using after()
 * 4. Update status to ready or error
 */
export async function ingest({
  chatId,
  fileName,
  fileUrl,
  fileType,
  buffer,
}: {
  chatId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  buffer: ArrayBuffer;
}): Promise<string> {
  // 1. Create document resource record immediately
  const resource = await insertDocumentResource({
    chatId,
    fileName,
    fileUrl,
    fileType,
  });

  console.log(`[ingest] Created resource ${resource.id} for ${fileName}`);

  // 2. Process document in background
  after(async () => {
    try {
      console.log(`[ingest] Processing document ${resource.id}`);

      const markdown = await parseDocument(buffer, fileName);
      const chunks = chunkMarkdown(markdown);

      console.log(
        `[ingest] Embedding ${chunks.length} chunks for ${resource.id}`
      );
      const embeddings = await Promise.all(
        chunks.map((c) => embedText(c.content))
      );

      await insertDocumentChunks({
        chunks: chunks.map((chunk, i) => ({
          resourceId: resource.id,
          chatId,
          content: chunk.content,
          embedding: embeddings[i],
          chunkIndex: i,
          pageNumber: chunk.pageNumber ?? null,
        })),
      });

      await updateDocumentResourceStatus({ id: resource.id, status: "ready" });
      console.log(`[ingest] Document ${resource.id} ready`);
    } catch (error) {
      console.error(
        `[ingest] Error processing document ${resource.id}:`,
        error
      );
      await updateDocumentResourceStatus({ id: resource.id, status: "error" });
    }
  });

  // 3. Return resourceId immediately
  return resource.id;
}
