import { notFound, redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { ProjectWorkspace } from "@/components/project-workspace";
import {
  getChatsByProject,
  getDocumentsByProject,
  getProjectById,
} from "@/lib/db/queries";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/guest");
  }
  const { id } = await params;
  const project = await getProjectById({ id, userId: session.user.id });
  if (!project) {
    notFound();
  }
  const [chats, resources] = await Promise.all([
    getChatsByProject({ projectId: id, userId: session.user.id }),
    getDocumentsByProject({ projectId: id, userId: session.user.id }),
  ]);

  return (
    <ProjectWorkspace
      initialData={{
        project,
        chats,
        resources: resources.map(
          ({ fileUrl: _fileUrl, ...resource }) => resource
        ),
      }}
      projectId={id}
    />
  );
}
