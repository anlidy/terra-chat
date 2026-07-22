import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createProject, getProjectsByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const projects = await getProjectsByUserId({ userId: session.user.id });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const parsed = createProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Project name must be between 1 and 120 characters." },
      { status: 400 }
    );
  }

  const project = await createProject({
    userId: session.user.id,
    name: parsed.data.name,
  });
  return NextResponse.json({ project }, { status: 201 });
}
