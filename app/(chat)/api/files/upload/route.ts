import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getChatById, getProjectById, saveChat } from "@/lib/db/queries";
import { deleteDocumentBlob } from "@/lib/document-blob";
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
        [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          ...DOCUMENT_TYPES,
        ].includes(file.type),
      {
        message:
          "File type should be JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX, PPTX, or TXT",
      }
    ),
});

const RequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
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
    const projectId = formData.get("projectId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (chatId || projectId) {
      const validatedRequest = RequestSchema.safeParse({
        chatId: chatId ?? undefined,
        projectId: projectId ?? undefined,
      });
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
    const isDocument = DOCUMENT_TYPES.includes(file.type);
    let collectionId: string | null = null;
    if (isDocument && !(chatId || projectId)) {
      return NextResponse.json(
        { error: "Choose a project or conversation for this document." },
        { status: 400 }
      );
    }
    if (isDocument && projectId) {
      const existingProject = await getProjectById({
        id: projectId,
        userId: session.user.id,
      });
      if (!existingProject) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }
      collectionId = existingProject.collectionId;
    } else if (isDocument && chatId) {
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
          { error: "You do not have access to this conversation." },
          { status: 403 }
        );
      }
      collectionId = existingChat.collectionId;
    }

    const pathname = `${session.user.id}/${crypto.randomUUID()}-${filename}`;
    const privateBlobToken = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
    if (isDocument && !privateBlobToken) {
      return NextResponse.json(
        { error: "Private document storage is not configured." },
        { status: 503 }
      );
    }
    const data = isDocument
      ? await put(pathname, fileBuffer, {
          access: "private",
          addRandomSuffix: true,
          token: privateBlobToken,
        })
      : await put(pathname, fileBuffer, {
          access: "public",
          addRandomSuffix: true,
        });

    if (isDocument && (chatId || projectId)) {
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

      let resourceId: string;
      try {
        resourceId = await ingest({
          userId: session.user.id,
          collectionId: collectionId as string,
          fileName: filename,
          fileUrl: data.url,
          fileType,
          mimeType: file.type,
          fileSize: file.size,
          contentHash: createHash("sha256")
            .update(Buffer.from(fileBuffer))
            .digest("hex"),
          buffer: fileBuffer,
        });
      } catch (error) {
        await deleteDocumentBlob(data.url).catch((cleanupError) => {
          console.error("[Upload Cleanup Error]", cleanupError);
        });
        throw error;
      }

      return NextResponse.json({
        url: `/api/resources/${resourceId}/content`,
        pathname: filename,
        contentType: file.type,
        isDocument: true,
        resourceId,
        status: "queued",
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
