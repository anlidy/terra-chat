import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  extractReasoningMiddleware,
  generateId,
  stepCountIs,
  streamText,
  wrapLanguageModel,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { downloadAndEncodeImage } from "@/lib/ai/image-utils";
import { promptBuilder } from "@/lib/ai/prompts/builder";
import {
  buildDocsStatusMessage,
  ragContextPrompt,
} from "@/lib/ai/prompts/dynamic-messages";
import type { RequestHints } from "@/lib/ai/prompts/types";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/artifacts/create-document";
import { requestSuggestions } from "@/lib/ai/tools/artifacts/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/artifacts/update-document";
import { generateImage } from "@/lib/ai/tools/generate-image";
import {
  getDocsStatus,
  getDocumentsStatus,
} from "@/lib/ai/tools/rag/get-docs-status";
import { retrieveDocuments } from "@/lib/ai/tools/rag/retrieve-documents";
import { getWeather } from "@/lib/ai/tools/weather/get-weather";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getCustomProviderById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  similaritySearch,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { embedText } from "@/lib/rag/embed";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

/**
 * 检测查询是否过于模糊，不适合做主动检索
 */
function isVagueQuery(query: string): boolean {
  const vaguePatterns = [
    /^(这个?|那个?|该)(文档|文件|资料|内容)/, // "这个文档"、"这文档"
    /^(总结|概括|介绍|说明)(一?下)?$/, // "总结"、"概括一下"
    /^(讲|说)(什么|啥)$/, // "讲什么"
    /^(什么|啥)(内容|东西)$/, // "什么内容"
    /^(帮我?|请)(看|读|分析)(一?下)?$/, // "帮我看一下"
    /^文档(内容|是什么|讲什么)/, // "文档内容"
  ];

  const trimmed = query.trim();
  return vaguePatterns.some((pattern) => pattern.test(trimmed));
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      messages,
      selectedChatModel,
      mode = "fast",
    } = requestBody;

    const [botResult, session] = await Promise.all([checkBotId(), auth()]);

    if (botResult.isBot) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const slashIndex = selectedChatModel.indexOf("/");
    if (slashIndex === -1) {
      return new ChatbotError("bad_request:api").toResponse();
    }
    const providerId = selectedChatModel.slice(0, slashIndex);
    const provider = await getCustomProviderById({ id: providerId });
    if (!provider || provider.userId !== session.user.id) {
      return new ChatbotError("bad_request:api").toResponse();
    }
    if (!provider.isEnabled) {
      return Response.json({ error: "Provider is disabled" }, { status: 400 });
    }

    const isThinkingMode = mode === "thinking";

    // Validate provider supports thinking mode
    if (
      isThinkingMode &&
      !["anthropic", "openai", "alibaba"].includes(provider.format)
    ) {
      return Response.json(
        { error: "This provider doesn't support thinking mode" },
        { status: 400 }
      );
    }

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      if (!isToolApprovalFlow) {
        messagesFromDb = await getMessagesByChatId({ id });
      }
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: "private",
      });
      titlePromise = generateTitleFromUserMessage({
        message,
        userId: session.user.id,
      });
    }

    const uiMessages = isToolApprovalFlow
      ? (messages as ChatMessage[])
      : [...convertToUIMessages(messagesFromDb), message as ChatMessage];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const filteredUIMessages: ChatMessage[] = uiMessages.map((msg) => {
      if (msg.role !== "user") {
        return msg;
      }
      const parts = msg.parts.filter((p) => {
        // Only keep image files; drop other file parts.
        if (p.type !== "file") {
          return true;
        }
        return IMAGE_TYPES.includes(p.mediaType ?? "");
      });
      return { ...msg, parts };
    });

    // Preprocess image file parts: download, resize, and encode as base64 data URLs
    // so the model provider can correctly handle them in image_url content blocks.
    const processedMessages: ChatMessage[] = await Promise.all(
      filteredUIMessages.map(async (msg) => {
        if (msg.role !== "user") {
          return msg;
        }
        const parts = await Promise.all(
          msg.parts.map(async (p) => {
            if (
              p.type === "file" &&
              IMAGE_TYPES.includes(p.mediaType ?? "") &&
              p.url
            ) {
              try {
                const dataUrl = await downloadAndEncodeImage(
                  p.url,
                  p.mediaType ?? "image/jpeg"
                );
                return { ...p, url: dataUrl };
              } catch (error) {
                console.error("Failed to preprocess image:", error);
                throw new ChatbotError("bad_request:api");
              }
            }
            return p;
          })
        );
        return { ...msg, parts };
      })
    );
    const modelMessages = await convertToModelMessages(processedMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        let model = await getLanguageModel(selectedChatModel, session.user.id);

        // Wrap model with reasoning middleware if thinking mode is enabled
        if (isThinkingMode) {
          model = wrapLanguageModel({
            model,
            middleware: extractReasoningMiddleware({ tagName: "thinking" }),
          });
        }

        // Build provider-specific options for thinking mode
        let providerOptions:
          | {
              anthropic: {
                thinking: { type: "enabled"; budgetTokens: number };
              };
            }
          | { openai: { thinking: { type: "enabled" } } }
          | { alibaba: { enableThinking: true; thinkingBudget: number } }
          | undefined;
        if (isThinkingMode) {
          if (provider.format === "anthropic") {
            providerOptions = {
              anthropic: {
                thinking: { type: "enabled" as const, budgetTokens: 10_000 },
              },
            };
          } else if (provider.format === "openai") {
            providerOptions = {
              openai: {
                thinking: { type: "enabled" as const },
              },
            };
          } else if (provider.format === "alibaba") {
            providerOptions = {
              alibaba: {
                enableThinking: true as const,
                thinkingBudget: 81_920,
              },
            };
          }
        }

        const docsStatus = await getDocsStatus(id);

        // Build static system prompt (built once, reused)
        const staticSystemPrompt = promptBuilder.build({ requestHints });

        // Prepare dynamic system messages
        const dynamicMessages: Array<{ role: "system"; content: string }> = [];

        // Inject document status if documents exist
        if (docsStatus.hasDocuments) {
          const docsStatusMsg = buildDocsStatusMessage(docsStatus);
          if (docsStatusMsg) {
            dynamicMessages.push({ role: "system", content: docsStatusMsg });
          }
        }

        // Proactive retrieval for specific queries
        if (docsStatus.readyCount > 0) {
          const lastUserMsg = [...modelMessages]
            .reverse()
            .find((m) => m.role === "user");
          const content = lastUserMsg?.content;
          const queryText = Array.isArray(content)
            ? content
                .filter(
                  (p): p is { type: "text"; text: string } => p.type === "text"
                )
                .map((p) => p.text)
                .join(" ")
            : (content ?? "");
          console.log("[RAG Debug] docsStatus:", docsStatus);
          console.log("[RAG Debug] queryText:", queryText);

          // 检查查询是否足够具体
          const isSpecificQuery =
            queryText.length > 10 && !isVagueQuery(queryText);

          if (queryText && isSpecificQuery) {
            const embedding = await embedText(queryText);
            const chunks = await similaritySearch({ chatId: id, embedding });
            console.log("[RAG Debug] chunks found:", chunks.length);
            if (chunks.length > 0) {
              const proactiveContextMsg = ragContextPrompt(chunks);
              dynamicMessages.push({
                role: "system",
                content: proactiveContextMsg,
              });
              console.log(
                "[RAG Debug] proactiveContext length:",
                proactiveContextMsg.length
              );
            }
          } else if (queryText) {
            console.log(
              "[RAG Debug] Query too vague, skipping proactive retrieval. Model will use retrieveDocuments tool if needed."
            );
          }
        }

        // All tools always available (including retrieveDocuments and getDocumentsStatus)
        const activeTools = [
          "getWeather",
          "createDocument",
          "updateDocument",
          "requestSuggestions",
          "retrieveDocuments",
          "getDocumentsStatus",
          "generateImage",
        ];

        // Construct final messages: static prompt → history → dynamic messages → current message
        // Insert dynamic messages before the last user message to maintain proper context flow
        let finalMessages = [...modelMessages];

        if (dynamicMessages.length > 0) {
          // Find the index of the last user message
          const lastUserMsgIndex = finalMessages
            .map((m) => m.role)
            .lastIndexOf("user");

          if (lastUserMsgIndex === -1) {
            // If no user message found (shouldn't happen), append dynamic messages at the end
            finalMessages = [...finalMessages, ...dynamicMessages];
          } else {
            // Insert dynamic messages right before the last user message
            finalMessages = [
              ...finalMessages.slice(0, lastUserMsgIndex),
              ...dynamicMessages,
              ...finalMessages.slice(lastUserMsgIndex),
            ];
          }
        }

        const result = streamText({
          model,
          system: staticSystemPrompt,
          messages: finalMessages,
          stopWhen: stepCountIs(5),
          experimental_activeTools: activeTools as never[],
          providerOptions,
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({ session, dataStream }),
            retrieveDocuments: retrieveDocuments({ chatId: id }),
            getDocumentsStatus: getDocumentsStatus({ chatId: id }),
            generateImage,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isThinkingMode })
        );

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}

export async function PATCH(request: Request) {
  try {
    const { id, title } = await request.json();

    if (!id || !title) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    if (chat.userId !== session.user.id) {
      return new ChatbotError("forbidden:chat").toResponse();
    }

    await updateChatTitleById({ chatId: id, title });

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating chat title:", error);
    return new ChatbotError("offline:chat").toResponse();
  }
}
