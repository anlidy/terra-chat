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

export async function DELETE(
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
  await deleteDocumentBlob(resource.fileUrl);
  await deleteDocumentResource({ id, userId: session.user.id });
  return NextResponse.json({ deleted: true });
}
