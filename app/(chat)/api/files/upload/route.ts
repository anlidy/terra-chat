import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getChatById, saveChat } from "@/lib/db/queries";
import { ingest } from "@/lib/rag/ingest";

const DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
];

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 20 * 1024 * 1024, {
      message: "File size should be less than 20MB",
    })
    .refine(
      (file) =>
        ["image/jpeg", "image/png", ...DOCUMENT_TYPES].includes(file.type),
      {
        message:
          "File type should be JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX, PPTX, or TXT",
      }
    ),
});

const RequestSchema = z.object({
  chatId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;
    const chatId = formData.get("chatId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate chatId if provided
    if (chatId) {
      const validatedRequest = RequestSchema.safeParse({ chatId });
      if (!validatedRequest.success) {
        return NextResponse.json(
          { error: "Invalid chatId format" },
          { status: 400 }
        );
      }
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const fileBuffer = await file.arrayBuffer();

    const data = await put(filename, fileBuffer, { access: "public" });

    const isDocument = DOCUMENT_TYPES.includes(file.type);

    if (isDocument && chatId) {
      const fileTypeMap: Record<string, string> = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
          "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation":
          "pptx",
        "text/plain": "txt",
      };
      const fileType = fileTypeMap[file.type];

      // Ensure chat exists (create if it doesn't — the user may upload files
      // before sending the first message)
      let existingChat = await getChatById({ id: chatId });
      if (!existingChat) {
        await saveChat({
          id: chatId,
          userId: session.user.id,
          title: filename,
          visibility: "private",
        });
        existingChat = await getChatById({ id: chatId });
      }

      if (existingChat?.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Unauthorized to upload to this chat" },
          { status: 403 }
        );
      }

      // Ingest document (creates record immediately, processes in background)
      const resourceId = await ingest({
        chatId,
        fileName: filename,
        fileUrl: data.url,
        fileType,
        buffer: fileBuffer,
      });

      return NextResponse.json({
        ...data,
        isDocument: true,
        resourceId,
        status: "pending",
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[Upload Error]", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
