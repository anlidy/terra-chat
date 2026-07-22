import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getDocumentResourceById } from "@/lib/db/queries";
import { readDocumentBlob } from "@/lib/document-blob";
import { ChatbotError } from "@/lib/errors";

export async function GET(
  request: Request,
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

  const result = await readDocumentBlob(
    resource.fileUrl,
    request.headers.get("if-none-match") ?? undefined
  );
  if (!result) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers: {
        ...(result.etag ? { ETag: result.etag } : {}),
        "Cache-Control": "private, no-cache",
      },
    });
  }
  if (result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  return new Response(result.stream, {
    headers: {
      "Content-Type": resource.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resource.fileName)}`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      ...(result.etag ? { ETag: result.etag } : {}),
    },
  });
}
