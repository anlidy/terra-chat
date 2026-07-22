import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/app/(auth)/auth";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { getCustomModelsForUser } from "@/lib/ai/custom-models";
import {
  getChatById,
  getDocumentsByChat,
  getMessagesByChatId,
  getProjectById,
  getUserProfile,
} from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <ChatPage params={props.params} />
    </Suspense>
  );
}

async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChatById({ id });

  if (!chat) {
    redirect("/");
  }

  const session = await auth();

  if (!session) {
    redirect("/api/auth/guest");
  }

  if (chat.visibility === "private") {
    if (!session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messagesFromDb = await getMessagesByChatId({
    id,
  });

  const uiMessages = convertToUIMessages(messagesFromDb);

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get("chat-model");

  let fallbackModel = "";
  if (session.user) {
    const profile = await getUserProfile({ userId: session.user.id });
    if (profile?.preferences?.defaultModel) {
      fallbackModel = profile.preferences.defaultModel;
    }
    if (!fallbackModel) {
      const models = await getCustomModelsForUser(session.user.id);
      if (models.length > 0) {
        fallbackModel = models[0].id;
      }
    }
  }

  const chatModel = chatModelFromCookie?.value || fallbackModel;
  const [project, documents] = await Promise.all([
    chat.projectId
      ? getProjectById({ id: chat.projectId, userId: session.user.id })
      : Promise.resolve(null),
    getDocumentsByChat({ chatId: id, userId: session.user.id }),
  ]);

  return (
    <>
      <Chat
        autoResume={true}
        id={chat.id}
        initialChatModel={chatModel}
        initialMessages={uiMessages}
        isReadonly={session?.user?.id !== chat.userId}
        project={project ? { id: project.id, name: project.name } : null}
        readyResourceCount={
          documents.filter((document) => document.status === "ready").length
        }
      />
      <DataStreamHandler />
    </>
  );
}
