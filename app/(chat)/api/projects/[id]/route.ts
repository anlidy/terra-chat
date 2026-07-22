import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  deleteProject,
  getChatsByProject,
  getDocumentsByProject,
  getProjectById,
  updateProject,
} from "@/lib/db/queries";
import { deleteDocumentBlob } from "@/lib/document-blob";
import { ChatbotError } from "@/lib/errors";

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const { id } = await params;
  const project = await getProjectById({ id, userId: session.user.id });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const [chats, resources] = await Promise.all([
    getChatsByProject({ projectId: id, userId: session.user.id }),
    getDocumentsByProject({ projectId: id, userId: session.user.id }),
  ]);
  return NextResponse.json({
    project,
    chats,
    resources: resources.map(({ fileUrl: _fileUrl, ...resource }) => resource),
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const parsed = updateProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Project name must be between 1 and 120 characters." },
      { status: 400 }
    );
  }
  const { id } = await params;
  const project = await updateProject({
    id,
    userId: session.user.id,
    name: parsed.data.name,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const { id } = await params;
  const resources = await getDocumentsByProject({
    projectId: id,
    userId: session.user.id,
  });
  const project = await deleteProject({ id, userId: session.user.id });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await Promise.allSettled(
    resources.map((resource) => deleteDocumentBlob(resource.fileUrl))
  );
  return NextResponse.json({ project });
}
