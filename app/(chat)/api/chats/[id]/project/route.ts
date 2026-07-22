import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { moveChatToProject } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const moveSchema = z.object({
  projectId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }
  const parsed = moveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  }
  const { id } = await params;
  const chat = await moveChatToProject({
    chatId: id,
    userId: session.user.id,
    projectId: parsed.data.projectId,
  });
  if (!chat) {
    return NextResponse.json(
      { error: "Conversation or project not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ chat });
}
