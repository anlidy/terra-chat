import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByProject, getProjectById, saveChat } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { generateUUID } from "@/lib/utils";

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
  const chats = await getChatsByProject({
    projectId: id,
    userId: session.user.id,
  });
  return NextResponse.json({ chats });
}

export async function POST(_: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const { id: projectId } = await params;
  const project = await getProjectById({
    id: projectId,
    userId: session.user.id,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const chatId = generateUUID();
  await saveChat({
    id: chatId,
    userId: session.user.id,
    title: "New chat",
    visibility: "private",
    projectId,
  });
  return NextResponse.json({ chatId }, { status: 201 });
}
