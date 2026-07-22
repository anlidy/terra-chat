import "server-only";

import dns from "node:dns";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import { buildTsQuery } from "@/lib/rag/lexical-query";
import { resolveChatCollectionIds } from "@/lib/rag/scope";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  collectionResource,
  customModel,
  customProvider,
  type DBMessage,
  document,
  documentChunk,
  documentResource,
  ingestionJob,
  knowledgeCollection,
  message,
  type Project,
  project,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  userProfile,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

dns.setDefaultResultOrder("ipv4first");

const globalForDb = globalThis as unknown as {
  _postgresClient?: ReturnType<typeof postgres>;
};

const postgresUrl = process.env.POSTGRES_URL;

if (!postgresUrl) {
  throw new Error("POSTGRES_URL is required");
}

const client =
  globalForDb._postgresClient ??
  postgres(postgresUrl, {
    ssl: process.env.NODE_ENV === "production" ? "require" : "prefer",
    connect_timeout: 60,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    max: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb._postgresClient = client;
}

const db = drizzle(client);
type ChatVisibility = "public" | "private";

export async function closeDatabaseConnection(): Promise<void> {
  await client.end({ timeout: 5 });
  if (globalForDb._postgresClient === client) {
    globalForDb._postgresClient = undefined;
  }
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteUserById({ id }: { id: string }): Promise<void> {
  try {
    await db.delete(user).where(eq(user.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
  projectId,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: ChatVisibility;
  projectId?: string | null;
}) {
  try {
    return await db.transaction(async (tx) => {
      if (projectId) {
        const [ownedProject] = await tx
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.id, projectId), eq(project.userId, userId)))
          .limit(1);
        if (!ownedProject) {
          throw new ChatbotError("not_found:database", "Project not found");
        }
      }

      const [collection] = await tx
        .insert(knowledgeCollection)
        .values({ userId, kind: "chat" })
        .returning({ id: knowledgeCollection.id });

      const insertedChat = await tx.insert(chat).values({
        id,
        createdAt: new Date(),
        userId,
        title,
        visibility,
        projectId: projectId ?? null,
        collectionId: collection.id,
      });
      if (projectId) {
        await tx
          .update(project)
          .set({ updatedAt: new Date() })
          .where(eq(project.id, projectId));
      }
      return insertedChat;
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    return await db.transaction(async (tx) => {
      const [selectedChat] = await tx
        .select({ collectionId: chat.collectionId })
        .from(chat)
        .where(eq(chat.id, id))
        .limit(1);

      await tx.delete(vote).where(eq(vote.chatId, id));
      await tx.delete(message).where(eq(message.chatId, id));
      await tx.delete(stream).where(eq(stream.chatId, id));

      const [chatsDeleted] = await tx
        .delete(chat)
        .where(eq(chat.id, id))
        .returning();

      if (selectedChat) {
        const resources = await tx
          .select({ id: collectionResource.resourceId })
          .from(collectionResource)
          .where(
            eq(collectionResource.collectionId, selectedChat.collectionId)
          );
        if (resources.length > 0) {
          await tx.delete(documentResource).where(
            inArray(
              documentResource.id,
              resources.map((resource) => resource.id)
            )
          );
        }
        await tx
          .delete(knowledgeCollection)
          .where(eq(knowledgeCollection.id, selectedChat.collectionId));
      }

      return chatsDeleted;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id, collectionId: chat.collectionId })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0, fileUrls: [] };
    }

    const chatIds = userChats.map((c) => c.id);
    const collectionIds = userChats.map((c) => c.collectionId);

    const resources = await db
      .selectDistinct({
        id: collectionResource.resourceId,
        fileUrl: documentResource.fileUrl,
      })
      .from(collectionResource)
      .innerJoin(
        documentResource,
        eq(documentResource.id, collectionResource.resourceId)
      )
      .where(inArray(collectionResource.collectionId, collectionIds));

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    if (resources.length > 0) {
      await db.delete(documentResource).where(
        inArray(
          documentResource.id,
          resources.map((resource) => resource.id)
        )
      );
    }
    await db
      .delete(knowledgeCollection)
      .where(inArray(knowledgeCollection.id, collectionIds));

    return {
      deletedCount: deletedChats.length,
      fileUrls: resources.map((resource) => resource.fileUrl),
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id), isNull(chat.projectId))
            : and(eq(chat.userId, id), isNull(chat.projectId))
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

// ─── Projects ────────────────────────────────────────────

export type ProjectSummary = Project & {
  chatCount: number;
  readyResourceCount: number;
  recentChats: Chat[];
};

export async function createProject({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [collection] = await tx
        .insert(knowledgeCollection)
        .values({ userId, kind: "project" })
        .returning({ id: knowledgeCollection.id });
      const [createdProject] = await tx
        .insert(project)
        .values({ userId, name, collectionId: collection.id })
        .returning();
      return createdProject;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getProjectById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    const [selectedProject] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, id), eq(project.userId, userId)))
      .limit(1);
    return selectedProject ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getProjectsByUserId({ userId }: { userId: string }) {
  try {
    const projects = await db
      .select()
      .from(project)
      .where(eq(project.userId, userId))
      .orderBy(desc(project.updatedAt));

    return await Promise.all(
      projects.map(async (item): Promise<ProjectSummary> => {
        const [chatCountResult, resourceCountResult, recentChats] =
          await Promise.all([
            db
              .select({ count: count() })
              .from(chat)
              .where(eq(chat.projectId, item.id)),
            db
              .select({ count: count() })
              .from(collectionResource)
              .innerJoin(
                documentResource,
                eq(collectionResource.resourceId, documentResource.id)
              )
              .where(
                and(
                  eq(collectionResource.collectionId, item.collectionId),
                  eq(documentResource.status, "ready")
                )
              ),
            db
              .select()
              .from(chat)
              .where(eq(chat.projectId, item.id))
              .orderBy(desc(chat.createdAt))
              .limit(5),
          ]);

        return {
          ...item,
          chatCount: chatCountResult[0]?.count ?? 0,
          readyResourceCount: resourceCountResult[0]?.count ?? 0,
          recentChats,
        };
      })
    );
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getChatsByProject({
  projectId,
  userId,
  limit = 50,
}: {
  projectId: string;
  userId: string;
  limit?: number;
}) {
  try {
    return await db
      .select()
      .from(chat)
      .where(and(eq(chat.projectId, projectId), eq(chat.userId, userId)))
      .orderBy(desc(chat.createdAt))
      .limit(limit);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateProject({
  id,
  userId,
  name,
}: {
  id: string;
  userId: string;
  name: string;
}) {
  try {
    const [updated] = await db
      .update(project)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(project.id, id), eq(project.userId, userId)))
      .returning();
    return updated ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function moveChatToProject({
  chatId,
  userId,
  projectId,
}: {
  chatId: string;
  userId: string;
  projectId: string | null;
}) {
  try {
    if (projectId) {
      const ownedProject = await getProjectById({ id: projectId, userId });
      if (!ownedProject) {
        return null;
      }
    }
    const [updated] = await db
      .update(chat)
      .set({ projectId })
      .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
      .returning();
    return updated ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteProject({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [selectedProject] = await tx
        .select()
        .from(project)
        .where(and(eq(project.id, id), eq(project.userId, userId)))
        .limit(1);
      if (!selectedProject) {
        return null;
      }

      await tx
        .update(chat)
        .set({ projectId: null })
        .where(eq(chat.projectId, id));

      const resources = await tx
        .select({ id: collectionResource.resourceId })
        .from(collectionResource)
        .where(
          eq(collectionResource.collectionId, selectedProject.collectionId)
        );
      if (resources.length > 0) {
        await tx.delete(documentResource).where(
          inArray(
            documentResource.id,
            resources.map((resource) => resource.id)
          )
        );
      }

      const [deleted] = await tx
        .delete(project)
        .where(eq(project.id, id))
        .returning();
      await tx
        .delete(knowledgeCollection)
        .where(eq(knowledgeCollection.id, selectedProject.collectionId));
      return deleted ?? null;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getRetrievalScopeForChat({
  chatId,
  userId,
}: {
  chatId: string;
  userId?: string;
}) {
  try {
    const conditions = [eq(chat.id, chatId)];
    if (userId) {
      conditions.push(eq(chat.userId, userId));
    }
    const [selectedChat] = await db
      .select({
        userId: chat.userId,
        chatCollectionId: chat.collectionId,
        projectCollectionId: project.collectionId,
      })
      .from(chat)
      .leftJoin(project, eq(chat.projectId, project.id))
      .where(and(...conditions))
      .limit(1);
    if (!selectedChat) {
      return null;
    }
    return {
      principalId: selectedChat.userId,
      collectionIds: resolveChatCollectionIds({
        chatCollectionId: selectedChat.chatCollectionId,
        projectCollectionId: selectedChat.projectCollectionId,
      }),
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update title for chat", chatId, error);
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

// ─── User Profile ────────────────────────────────────────

export async function getUserProfile({ userId }: { userId: string }) {
  try {
    const [profile] = await db
      .select()
      .from(userProfile)
      .where(eq(userProfile.id, userId));
    return profile ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function upsertUserProfile({
  userId,
  displayName,
  avatarUrl,
  preferences,
}: {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  preferences?: {
    theme?: "light" | "dark" | "system";
    defaultModel?: string;
    systemModel?: string;
  } | null;
}) {
  try {
    const existing = await getUserProfile({ userId });
    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (displayName !== undefined) {
        updates.displayName = displayName;
      }
      if (avatarUrl !== undefined) {
        updates.avatarUrl = avatarUrl;
      }
      if (preferences !== undefined) {
        updates.preferences = preferences;
      }
      return await db
        .update(userProfile)
        .set(updates)
        .where(eq(userProfile.id, userId))
        .returning();
    }
    return await db
      .insert(userProfile)
      .values({
        id: userId,
        displayName: displayName ?? null,
        avatarUrl: avatarUrl ?? null,
        preferences: preferences ?? {},
        updatedAt: new Date(),
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

// ─── Custom Providers ────────────────────────────────────

export async function getCustomProviders({ userId }: { userId: string }) {
  try {
    return await db
      .select()
      .from(customProvider)
      .where(eq(customProvider.userId, userId))
      .orderBy(asc(customProvider.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getCustomProviderById({ id }: { id: string }) {
  try {
    const [provider] = await db
      .select()
      .from(customProvider)
      .where(eq(customProvider.id, id));
    return provider ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function createCustomProvider({
  userId,
  name,
  baseUrl,
  apiKey,
  format,
}: {
  userId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  format: "openai" | "anthropic" | "alibaba";
}) {
  try {
    const [provider] = await db
      .insert(customProvider)
      .values({
        userId,
        name,
        baseUrl,
        apiKey,
        format,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return provider;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateCustomProvider({
  id,
  ...updates
}: {
  id: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  format?: "openai" | "anthropic" | "alibaba";
  isEnabled?: boolean;
}) {
  try {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) {
      setValues.name = updates.name;
    }
    if (updates.baseUrl !== undefined) {
      setValues.baseUrl = updates.baseUrl;
    }
    if (updates.apiKey !== undefined) {
      setValues.apiKey = updates.apiKey;
    }
    if (updates.format !== undefined) {
      setValues.format = updates.format;
    }
    if (updates.isEnabled !== undefined) {
      setValues.isEnabled = updates.isEnabled;
    }

    const [provider] = await db
      .update(customProvider)
      .set(setValues)
      .where(eq(customProvider.id, id))
      .returning();
    return provider;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteCustomProvider({ id }: { id: string }) {
  try {
    await db.delete(customModel).where(eq(customModel.providerId, id));
    await db.delete(customProvider).where(eq(customProvider.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

// ─── Custom Models ───────────────────────────────────────

export async function getCustomModels({ providerId }: { providerId: string }) {
  try {
    return await db
      .select()
      .from(customModel)
      .where(eq(customModel.providerId, providerId))
      .orderBy(asc(customModel.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getEnabledCustomModelsByUserId({
  userId,
}: {
  userId: string;
}) {
  try {
    return await db
      .select({
        model: customModel,
        provider: customProvider,
      })
      .from(customModel)
      .innerJoin(customProvider, eq(customModel.providerId, customProvider.id))
      .where(
        and(
          eq(customProvider.userId, userId),
          eq(customProvider.isEnabled, true),
          eq(customModel.isEnabled, true)
        )
      );
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function createCustomModel({
  providerId,
  modelId,
  displayName,
}: {
  providerId: string;
  modelId: string;
  displayName: string;
}) {
  try {
    const [model] = await db
      .insert(customModel)
      .values({
        providerId,
        modelId,
        displayName,
        createdAt: new Date(),
      })
      .returning();
    return model;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteCustomModelByIdAndProvider({
  id,
  providerId,
}: {
  id: string;
  providerId: string;
}) {
  try {
    const [deleted] = await db
      .delete(customModel)
      .where(
        and(eq(customModel.id, id), eq(customModel.providerId, providerId))
      )
      .returning();
    return deleted ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateCustomModelByIdAndProvider({
  id,
  providerId,
  isEnabled,
}: {
  id: string;
  providerId: string;
  isEnabled: boolean;
}) {
  try {
    const [model] = await db
      .update(customModel)
      .set({ isEnabled })
      .where(
        and(eq(customModel.id, id), eq(customModel.providerId, providerId))
      )
      .returning();
    return model ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

// ─── Document Resources (RAG) ────────────────────────────

export async function insertDocumentResource({
  userId,
  collectionId,
  fileName,
  fileUrl,
  fileType,
  mimeType,
  fileSize,
  contentHash,
  pipelineVersion,
}: {
  userId: string;
  collectionId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  pipelineVersion: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [ownedCollection] = await tx
        .select({ id: knowledgeCollection.id })
        .from(knowledgeCollection)
        .where(
          and(
            eq(knowledgeCollection.id, collectionId),
            eq(knowledgeCollection.userId, userId)
          )
        )
        .limit(1);
      if (!ownedCollection) {
        throw new ChatbotError("not_found:database", "Collection not found");
      }

      const [resource] = await tx
        .insert(documentResource)
        .values({
          userId,
          fileName,
          fileUrl,
          fileType,
          mimeType,
          fileSize,
          contentHash,
          pipelineVersion,
          status: "queued",
        })
        .returning();
      await tx.insert(collectionResource).values({
        collectionId,
        resourceId: resource.id,
      });
      await tx
        .update(project)
        .set({ updatedAt: new Date() })
        .where(eq(project.collectionId, collectionId));
      const [job] = await tx
        .insert(ingestionJob)
        .values({ resourceId: resource.id })
        .returning();
      return { resource, job };
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", error);
  }
}

export type IngestionStatus =
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed"
  | "cancelled";

export async function updateIngestionStatus({
  id,
  status,
  progress,
  errorMessage,
}: {
  id: string;
  status: IngestionStatus;
  progress: number;
  errorMessage?: string | null;
}) {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(documentResource)
        .set({
          status,
          errorMessage: errorMessage ?? null,
          updatedAt: new Date(),
        })
        .where(eq(documentResource.id, id));
      await tx
        .update(ingestionJob)
        .set({
          status,
          progress,
          errorMessage: errorMessage ?? null,
          updatedAt: new Date(),
        })
        .where(eq(ingestionJob.resourceId, id));
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentsByChat({
  chatId,
  userId,
}: {
  chatId: string;
  userId?: string;
}) {
  try {
    const scope = await getRetrievalScopeForChat({ chatId, userId });
    if (!scope) {
      return [];
    }
    return await db
      .selectDistinct({ ...getTableColumns(documentResource) })
      .from(documentResource)
      .innerJoin(
        collectionResource,
        eq(collectionResource.resourceId, documentResource.id)
      )
      .where(
        and(
          eq(documentResource.userId, scope.principalId),
          inArray(collectionResource.collectionId, scope.collectionIds),
          eq(collectionResource.isEnabled, true)
        )
      )
      .orderBy(asc(documentResource.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentsByProject({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  try {
    return await db
      .select({
        id: documentResource.id,
        fileName: documentResource.fileName,
        fileUrl: documentResource.fileUrl,
        fileType: documentResource.fileType,
        mimeType: documentResource.mimeType,
        fileSize: documentResource.fileSize,
        status: documentResource.status,
        errorMessage: documentResource.errorMessage,
        createdAt: documentResource.createdAt,
        updatedAt: documentResource.updatedAt,
        progress: ingestionJob.progress,
      })
      .from(project)
      .innerJoin(
        collectionResource,
        eq(collectionResource.collectionId, project.collectionId)
      )
      .innerJoin(
        documentResource,
        eq(documentResource.id, collectionResource.resourceId)
      )
      .leftJoin(ingestionJob, eq(ingestionJob.resourceId, documentResource.id))
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .orderBy(desc(documentResource.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentsByCollection({
  collectionId,
  userId,
}: {
  collectionId: string;
  userId: string;
}) {
  try {
    return await db
      .select({ id: documentResource.id, fileUrl: documentResource.fileUrl })
      .from(collectionResource)
      .innerJoin(
        documentResource,
        eq(documentResource.id, collectionResource.resourceId)
      )
      .where(
        and(
          eq(collectionResource.collectionId, collectionId),
          eq(documentResource.userId, userId)
        )
      );
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentResourceById({
  id,
  userId,
}: {
  id: string;
  userId?: string;
}) {
  try {
    const conditions = [eq(documentResource.id, id)];
    if (userId) {
      conditions.push(eq(documentResource.userId, userId));
    }
    const [doc] = await db
      .select({
        id: documentResource.id,
        userId: documentResource.userId,
        fileName: documentResource.fileName,
        fileUrl: documentResource.fileUrl,
        fileType: documentResource.fileType,
        mimeType: documentResource.mimeType,
        fileSize: documentResource.fileSize,
        status: documentResource.status,
        errorMessage: documentResource.errorMessage,
        progress: ingestionJob.progress,
      })
      .from(documentResource)
      .leftJoin(ingestionJob, eq(ingestionJob.resourceId, documentResource.id))
      .where(and(...conditions))
      .limit(1);
    return doc ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteDocumentResource({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    const [deleted] = await db
      .delete(documentResource)
      .where(
        and(eq(documentResource.id, id), eq(documentResource.userId, userId))
      )
      .returning();
    return deleted ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function queueDocumentResourceRetry({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [resource] = await tx
        .update(documentResource)
        .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
        .where(
          and(
            eq(documentResource.id, id),
            eq(documentResource.userId, userId),
            eq(documentResource.status, "failed")
          )
        )
        .returning();
      if (!resource) {
        return null;
      }
      await tx
        .update(ingestionJob)
        .set({
          status: "queued",
          progress: 0,
          attempt: sql`${ingestionJob.attempt} + 1`,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(ingestionJob.resourceId, id));
      return resource;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function insertDocumentChunks({
  chunks,
}: {
  chunks: Array<{
    resourceId: string;
    content: string;
    embedding: number[];
    chunkIndex: number;
    pageNumber?: number | null;
  }>;
}) {
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(documentChunk)
        .where(eq(documentChunk.resourceId, chunks[0]?.resourceId ?? ""));
      if (chunks.length > 0) {
        await tx.insert(documentChunk).values(chunks);
      }
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function similaritySearch({
  scope,
  embedding,
  documentIds,
  limit = 5,
}: {
  scope: { principalId: string; collectionIds: string[] };
  embedding: number[];
  documentIds?: string[];
  limit?: number;
}) {
  try {
    const embeddingStr = `[${embedding.join(",")}]`;
    const vectorDistance = sql<number>`${documentChunk.embedding} <=> ${embeddingStr}::vector`;
    const conditions = [
      eq(documentResource.userId, scope.principalId),
      inArray(collectionResource.collectionId, scope.collectionIds),
      eq(collectionResource.isEnabled, true),
      eq(documentResource.status, "ready"),
    ];
    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentResource.id, documentIds));
    }
    return await db
      .select({
        chunkId: documentChunk.id,
        resourceId: documentResource.id,
        content: documentChunk.content,
        chunkIndex: documentChunk.chunkIndex,
        fileName: documentResource.fileName,
        pageNumber: documentChunk.pageNumber,
        vectorDistance,
      })
      .from(documentChunk)
      .innerJoin(
        documentResource,
        eq(documentChunk.resourceId, documentResource.id)
      )
      .innerJoin(
        collectionResource,
        eq(collectionResource.resourceId, documentResource.id)
      )
      .where(and(...conditions))
      .orderBy(vectorDistance)
      .limit(limit);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

/**
 * Lexical full-text search using PostgreSQL's ts_rank_cd.
 * Uses 'simple' configuration for multilingual support (Chinese + English)
 * Chinese queries are segmented with jieba for better recall
 */
export async function lexicalSearch({
  scope,
  query,
  documentIds,
  limit = 20,
}: {
  scope: { principalId: string; collectionIds: string[] };
  query: string;
  documentIds?: string[];
  limit?: number;
}) {
  try {
    const tsQuery = buildTsQuery(query);
    if (tsQuery.length === 0) {
      return [];
    }
    const lexicalRank = sql<number>`ts_rank_cd(to_tsvector('simple', ${documentChunk.content}), to_tsquery('simple', ${tsQuery}))`;

    const conditions: SQL[] = [
      eq(documentResource.userId, scope.principalId),
      inArray(collectionResource.collectionId, scope.collectionIds),
      eq(collectionResource.isEnabled, true),
      eq(documentResource.status, "ready"),
      sql`to_tsvector('simple', ${documentChunk.content}) @@ to_tsquery('simple', ${tsQuery})`,
    ];
    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentResource.id, documentIds));
    }

    return await db
      .select({
        chunkId: documentChunk.id,
        resourceId: documentResource.id,
        content: documentChunk.content,
        chunkIndex: documentChunk.chunkIndex,
        fileName: documentResource.fileName,
        pageNumber: documentChunk.pageNumber,
        lexicalRank,
      })
      .from(documentChunk)
      .innerJoin(
        documentResource,
        eq(documentChunk.resourceId, documentResource.id)
      )
      .innerJoin(
        collectionResource,
        eq(collectionResource.resourceId, documentResource.id)
      )
      .where(and(...conditions))
      .orderBy(sql`${lexicalRank} DESC`)
      .limit(limit);
  } catch (error) {
    console.error("[Lexical Search Error]", error);
    // Return empty array if query parsing fails
    return [];
  }
}
