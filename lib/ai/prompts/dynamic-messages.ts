/**
 * Dynamic message construction utilities
 *
 * These functions build dynamic system messages that are injected into the message stream
 * based on current session state (document status, retrieved context).
 *
 * Unlike static prompts, these messages change based on:
 * - Document upload/processing status
 * - Proactive retrieval results
 * - User query context
 */

import type { RetrievedChunk } from "@/lib/rag/types";
import type { DocsStatusResult } from "./types";

/**
 * Build a document status message for injection into the message stream
 *
 * This message informs the AI about available documents and their processing status.
 * Injected as an independent system message after document upload.
 */
export function buildDocsStatusMessage(status: DocsStatusResult): string {
  if (!status.hasDocuments) {
    return "";
  }

  const totalDocs = status.documents.length;
  const parts: string[] = [
    "<document_status>",
    `The user has uploaded ${totalDocs} document${totalDocs > 1 ? "s" : ""} to this conversation:`,
    "",
  ];

  for (const doc of status.documents) {
    const statusLabel =
      doc.status === "ready"
        ? "ready"
        : doc.status === "processing"
          ? "processing"
          : "failed";
    parts.push(
      `- id: ${doc.id}  name: ${doc.fileName}  status: ${statusLabel}`
    );
  }
  parts.push("");

  if (status.readyCount > 0) {
    parts.push(
      `${status.readyCount} document${status.readyCount > 1 ? "s" : ""} above marked "ready" can be searched now. Use the \`retrieveDocuments\` tool with the document id(s) and a query to find relevant excerpts.`
    );
  }
  if (status.processingCount > 0) {
    parts.push(
      `${status.processingCount} document${status.processingCount > 1 ? "s" : ""} above marked "processing" ${status.processingCount > 1 ? "are" : "is"} not yet searchable. Tell the user to wait briefly and try again.`
    );
  }
  if (status.failedCount > 0) {
    parts.push(
      `${status.failedCount} document${status.failedCount > 1 ? "s" : ""} above marked "failed" could not be processed. Ask the user to re-upload ${status.failedCount > 1 ? "them" : "it"}.`
    );
  }

  parts.push("</document_status>");
  return parts.join("\n");
}

/**
 * Build a retrieved context message for proactive document retrieval
 * Wraps document excerpts with XML tags for clear structure
 */
export function ragContextPrompt(chunks: RetrievedChunk[]): string {
  const excerpts = chunks
    .map(
      (c, idx) =>
        `### Document Excerpt ${idx + 1} [Source: ${c.fileName}, Chunk ${c.chunkIndex}]\n${c.content}`
    )
    .join("\n\n");

  return `<retrieved_context>
Below are excerpts from the user's uploaded documents. Please answer the user's question based on these excerpts:

${excerpts}

Answer the user's question based on the above document content. If the excerpts are insufficient to answer the question, indicate that more information is needed.
</retrieved_context>`;
}
