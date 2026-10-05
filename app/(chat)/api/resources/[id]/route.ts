import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  deleteDocumentResource,
  getDocumentResourceById,
} from "@/lib/db/queries";
import { deleteDocumentBlob } from "@/lib/document-blob";
import { ChatbotError } from "@/lib/errors";

export async function GET(
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
  const { fileUrl: _fileUrl, ...safeResource } = resource;
  return NextResponse.json({ resource: safeResource });
}

/**
 * DELETE /api/resources/:id?collectionId=...
 * With a collectionId the file is only removed from that project or chat;
 * the stored file is deleted once no other collection still uses it.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const { id } = await params;
  const collectionId =
    new URL(request.url).searchParams.get("collectionId") ?? undefined;
  const result = await deleteDocumentResource({
    id,
    userId: session.user.id,
    collectionId,
  });
  if (!result) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (result.deleted && result.fileUrl) {
    await deleteDocumentBlob(result.fileUrl);
  }
  return NextResponse.json({ deleted: true });
}
