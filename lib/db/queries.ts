import "server-only";

import dns from "node:dns";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { cut } from "nodejieba";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  customModel,
  customProvider,
  type DBMessage,
  document,
  documentChunk,
  documentResource,
  message,
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

// biome-ignore lint: Forbidden non-null assertion.
const client =
  globalForDb._postgresClient ??
  postgres(process.env.POSTGRES_URL!, {
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

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: ChatVisibility;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
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
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
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
  chatId,
  fileName,
  fileUrl,
  fileType,
}: {
  chatId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
}) {
  try {
    const [resource] = await db
      .insert(documentResource)
      .values({ chatId, fileName, fileUrl, fileType })
      .returning();
    return resource;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function updateDocumentResourceStatus({
  id,
  status,
}: {
  id: string;
  status: "pending" | "ready" | "error";
}) {
  try {
    await db
      .update(documentResource)
      .set({ status })
      .where(eq(documentResource.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentsByChat({ chatId }: { chatId: string }) {
  try {
    return await db
      .select()
      .from(documentResource)
      .where(eq(documentResource.chatId, chatId))
      .orderBy(asc(documentResource.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function getDocumentResourceById({ id }: { id: string }) {
  try {
    const [doc] = await db
      .select({ status: documentResource.status })
      .from(documentResource)
      .where(eq(documentResource.id, id))
      .limit(1);
    return doc ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function insertDocumentChunks({
  chunks,
}: {
  chunks: Array<{
    resourceId: string;
    chatId: string;
    content: string;
    embedding: number[];
    chunkIndex: number;
    pageNumber?: number | null;
  }>;
}) {
  try {
    await db.insert(documentChunk).values(chunks);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

export async function similaritySearch({
  chatId,
  embedding,
  documentIds,
  limit = 5,
}: {
  chatId: string;
  embedding: number[];
  documentIds?: string[];
  limit?: number;
}) {
  try {
    const embeddingStr = `[${embedding.join(",")}]`;
    const conditions = [eq(documentChunk.chatId, chatId)];
    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentResource.id, documentIds));
    }
    return await db
      .select({
        content: documentChunk.content,
        chunkIndex: documentChunk.chunkIndex,
        fileName: documentResource.fileName,
        pageNumber: documentChunk.pageNumber,
      })
      .from(documentChunk)
      .innerJoin(
        documentResource,
        eq(documentChunk.resourceId, documentResource.id)
      )
      .where(and(...conditions))
      .orderBy(sql`${documentChunk.embedding} <=> ${embeddingStr}::vector`)
      .limit(limit);
  } catch (error) {
    throw new ChatbotError("bad_request:database", error);
  }
}

const CJK_RE = /[一-鿿㐀-䶿]/;

/**
 * Build a tsquery string from user input.
 * Uses jieba for Chinese word segmentation, with prefix matching
 * for CJK terms since the indexed content (to_tsvector('simple'))
 * doesn't segment Chinese.
 */
function buildTsQuery(query: string): string {
  try {
    const segments = cut(query);
    return segments.map((w) => (CJK_RE.test(w) ? `${w}:*` : w)).join(" & ");
  } catch {
    // Fallback: space-split, no prefix matching
    return query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .join(" & ");
  }
}

/**
 * BM25 full-text search using PostgreSQL's ts_rank_cd
 * Uses 'simple' configuration for multilingual support (Chinese + English)
 * Chinese queries are segmented with jieba for better recall
 */
export async function bm25Search({
  chatId,
  query,
  documentIds,
  limit = 20,
}: {
  chatId: string;
  query: string;
  documentIds?: string[];
  limit?: number;
}) {
  try {
    const tsQuery = buildTsQuery(query);

    const conditions: SQL[] = [
      eq(documentChunk.chatId, chatId),
      sql`to_tsvector('simple', ${documentChunk.content}) @@ to_tsquery('simple', ${tsQuery})`,
    ];
    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentResource.id, documentIds));
    }

    return await db
      .select({
        id: documentChunk.id,
        content: documentChunk.content,
        chunkIndex: documentChunk.chunkIndex,
        fileName: documentResource.fileName,
        pageNumber: documentChunk.pageNumber,
        rank: sql<number>`ts_rank_cd(to_tsvector('simple', ${documentChunk.content}), to_tsquery('simple', ${tsQuery}))`,
      })
      .from(documentChunk)
      .innerJoin(
        documentResource,
        eq(documentChunk.resourceId, documentResource.id)
      )
      .where(and(...conditions))
      .orderBy(
        sql`ts_rank_cd(to_tsvector('simple', ${documentChunk.content}), to_tsquery('simple', ${tsQuery})) DESC`
      )
      .limit(limit);
  } catch (error) {
    console.error("[BM25 Search Error]", error);
    // Return empty array if query parsing fails
    return [];
  }
}
