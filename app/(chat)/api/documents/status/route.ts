import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getDocumentResourceById } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get("resourceId");

  if (!resourceId) {
    return NextResponse.json({ error: "Missing resourceId" }, { status: 400 });
  }

  const doc = await getDocumentResourceById({
    id: resourceId,
    userId: session.user.id,
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: doc.status,
    progress: doc.progress ?? 0,
    errorMessage: doc.errorMessage,
  });
}
