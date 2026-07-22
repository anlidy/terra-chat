import { after } from "next/server";
import {
  insertDocumentChunks,
  insertDocumentResource,
  updateIngestionStatus,
} from "@/lib/db/queries";
import { chunkMarkdown } from "./chunk";
import { RAG_PIPELINE_VERSION } from "./config";
import { embedTexts } from "./embed";
import { parseDocument } from "./parse";

/**
 * Ingest a document: create record immediately, process in background
 *
 * @returns resourceId - Document resource ID (created immediately)
 *
 * Flow:
 * 1. Create a document resource and ingestion job (status: queued)
 * 2. Return resourceId
 * 3. Process document in background using after()
 * 4. Persist stage progress, then update status to ready or failed
 */
export async function ingest({
  userId,
  collectionId,
  fileName,
  fileUrl,
  fileType,
  mimeType,
  fileSize,
  contentHash,
  buffer,
}: {
  userId: string;
  collectionId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  buffer: ArrayBuffer;
}): Promise<string> {
  // 1. Create document resource record immediately
  const { resource } = await insertDocumentResource({
    userId,
    collectionId,
    fileName,
    fileUrl,
    fileType,
    mimeType,
    fileSize,
    contentHash,
    pipelineVersion: RAG_PIPELINE_VERSION,
  });

  console.log(`[ingest] Created resource ${resource.id} for ${fileName}`);

  // 2. Process document in background
  after(async () => {
    try {
      await processDocumentResource({
        resourceId: resource.id,
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
  fileName,
  fileType,
  buffer,
}: {
  resourceId: string;
  fileName: string;
  fileType: string;
  buffer: ArrayBuffer;
}): Promise<void> {
  const startedAt = Date.now();
  let stage = "parsing";

  try {
    console.log(
      `[ingest] Processing ${fileName} (resource=${resourceId}, size=${buffer.byteLength} bytes)`
    );

    await updateIngestionStatus({
      id: resourceId,
      status: "parsing",
      progress: 10,
    });
    const markdown = await parseDocument(buffer, fileName, fileType);
    stage = "chunking";
    await updateIngestionStatus({
      id: resourceId,
      status: "chunking",
      progress: 35,
    });
    const chunks = chunkMarkdown(markdown);
    console.log(
      `[ingest] Parsed ${fileName} into ${chunks.length} chunks in ${Date.now() - startedAt}ms (resource=${resourceId})`
    );

    stage = "embedding";
    await updateIngestionStatus({
      id: resourceId,
      status: "embedding",
      progress: 50,
    });
    const embeddingStartedAt = Date.now();
    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.content),
      { context: `${fileName}, resource=${resourceId}` }
    );
    console.log(
      `[ingest] Embedded ${chunks.length} chunks in ${Date.now() - embeddingStartedAt}ms (${fileName}, resource=${resourceId})`
    );

    stage = "indexing";
    await updateIngestionStatus({
      id: resourceId,
      status: "indexing",
      progress: 85,
    });
    const insertionStartedAt = Date.now();
    await insertDocumentChunks({
      chunks: chunks.map((chunk, index) => ({
        resourceId,
        content: chunk.content,
        embedding: embeddings[index],
        chunkIndex: index,
        pageNumber: chunk.pageNumber ?? null,
      })),
    });
    console.log(
      `[ingest] Stored ${chunks.length} chunks in ${Date.now() - insertionStartedAt}ms (${fileName}, resource=${resourceId})`
    );

    stage = "ready";
    await updateIngestionStatus({
      id: resourceId,
      status: "ready",
      progress: 100,
    });
    console.log(
      `[ingest] Ready ${fileName} in ${Date.now() - startedAt}ms (resource=${resourceId})`
    );
  } catch (error) {
    try {
      await updateIngestionStatus({
        id: resourceId,
        status: "failed",
        progress: 0,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
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
