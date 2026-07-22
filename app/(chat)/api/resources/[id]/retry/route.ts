import { after, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getDocumentResourceById,
  queueDocumentResourceRetry,
} from "@/lib/db/queries";
import { readDocumentBlob } from "@/lib/document-blob";
import { ChatbotError } from "@/lib/errors";
import { processDocumentResource } from "@/lib/rag/ingest";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const { id } = await params;
  const resource = await getDocumentResourceById({
    id,
    userId: session.user.id,
  });
  if (!resource) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const queued = await queueDocumentResourceRetry({
    id,
    userId: session.user.id,
  });
  if (!queued) {
    return NextResponse.json(
      { error: "Only failed files can be retried." },
      { status: 409 }
    );
  }

  after(async () => {
    try {
      const result = await readDocumentBlob(resource.fileUrl);
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error("Private file could not be read");
      }
      const buffer = await new Response(result.stream).arrayBuffer();
      await processDocumentResource({
        resourceId: id,
        fileName: resource.fileName,
        fileType: resource.fileType,
        buffer,
      });
    } catch (error) {
      console.error(`[ingest] Retry failed for resource ${id}`, error);
    }
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
