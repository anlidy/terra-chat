import { after } from "next/server";
import {
  insertDocumentChunks,
  insertDocumentResource,
  updateDocumentResourceStatus,
} from "@/lib/db/queries";
import { chunkMarkdown } from "./chunk";
import { embedTexts } from "./embed";
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
      await processDocumentResource({
        resourceId: resource.id,
        chatId,
        fileName,
        fileType,
        buffer,
      });
    } catch (error) {
      console.error(
        `[ingest] Error processing document ${resource.id}:`,
        error
      );
    }
  });

  // 3. Return resourceId immediately
  return resource.id;
}

export async function processDocumentResource({
  resourceId,
  chatId,
  fileName,
  fileType,
  buffer,
}: {
  resourceId: string;
  chatId: string;
  fileName: string;
  fileType: string;
  buffer: ArrayBuffer;
}): Promise<void> {
  const startedAt = Date.now();
  let stage = "parse";

  try {
    console.log(
      `[ingest] Processing ${fileName} (resource=${resourceId}, size=${buffer.byteLength} bytes)`
    );

    const markdown = await parseDocument(buffer, fileName, fileType);
    const chunks = chunkMarkdown(markdown);
    console.log(
      `[ingest] Parsed ${fileName} into ${chunks.length} chunks in ${Date.now() - startedAt}ms (resource=${resourceId})`
    );

    stage = "embedding";
    const embeddingStartedAt = Date.now();
    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.content),
      { context: `${fileName}, resource=${resourceId}` }
    );
    console.log(
      `[ingest] Embedded ${chunks.length} chunks in ${Date.now() - embeddingStartedAt}ms (${fileName}, resource=${resourceId})`
    );

    stage = "chunk insertion";
    const insertionStartedAt = Date.now();
    await insertDocumentChunks({
      chunks: chunks.map((chunk, index) => ({
        resourceId,
        chatId,
        content: chunk.content,
        embedding: embeddings[index],
        chunkIndex: index,
        pageNumber: chunk.pageNumber ?? null,
      })),
    });
    console.log(
      `[ingest] Stored ${chunks.length} chunks in ${Date.now() - insertionStartedAt}ms (${fileName}, resource=${resourceId})`
    );

    stage = "status update";
    await updateDocumentResourceStatus({ id: resourceId, status: "ready" });
    console.log(
      `[ingest] Ready ${fileName} in ${Date.now() - startedAt}ms (resource=${resourceId})`
    );
  } catch (error) {
    try {
      await updateDocumentResourceStatus({ id: resourceId, status: "error" });
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        `Document ingestion failed during ${stage} and its error status could not be saved (${fileName}, resource=${resourceId})`
      );
    }
    throw new Error(
      `Document ingestion failed during ${stage} (${fileName}, resource=${resourceId})`,
      { cause: error }
    );
  }
}
