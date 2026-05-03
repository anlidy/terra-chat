import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import {
  getCustomProviderById,
  getEnabledCustomModelsByUserId,
  getUserProfile,
} from "../db/queries";
import { decrypt } from "../encryption";
import { ChatbotError } from "../errors";

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        artifactModel,
        chatModel,
        reasoningModel,
        titleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "chat-model-reasoning": reasoningModel,
          "title-model": titleModel,
          "artifact-model": artifactModel,
        },
      });
    })()
  : null;

function createProviderInstance(
  format: "openai" | "anthropic" | "alibaba",
  baseUrl: string,
  apiKey: string
) {
  if (format === "anthropic") {
    return createAnthropic({ baseURL: baseUrl, apiKey });
  }
  if (format === "alibaba") {
    return createAlibaba({ baseURL: baseUrl, apiKey });
  }
  return createOpenAI({ baseURL: baseUrl, apiKey });
}

export async function getLanguageModel(modelId: string, userId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model ID format: ${modelId}`);
  }

  const providerId = modelId.slice(0, slashIndex);
  const rawModelId = modelId.slice(slashIndex + 1);

  const provider = await getCustomProviderById({ id: providerId });
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  if (provider.userId !== userId) {
    throw new ChatbotError(
      "forbidden:chat",
      "Provider does not belong to the current user"
    );
  }
  if (!provider.isEnabled) {
    throw new Error(`Provider is disabled: ${provider.name}`);
  }

  const apiKey = decrypt(provider.apiKey);
  const instance = createProviderInstance(
    provider.format,
    provider.baseUrl,
    apiKey
  );

  return instance(rawModelId);
}

async function getSystemModel(userId: string) {
  const profile = await getUserProfile({ userId });
  const systemModelId = profile?.preferences?.defaultModel;

  if (systemModelId) {
    // Validate model ID format before calling getLanguageModel
    if (typeof systemModelId === "string" && systemModelId.includes("/")) {
      try {
        return await getLanguageModel(systemModelId, userId);
      } catch (error) {
        console.error(
          `Failed to get language model with ID "${systemModelId}":`,
          error
        );
        // Fall through to use fallback model
      }
    } else {
      console.error(
        `Invalid defaultModel format: "${systemModelId}". Expected "<provider>/<model>".`
      );
      // Fall through to use fallback model
    }
  }

  const enabledModels = await getEnabledCustomModelsByUserId({ userId });
  if (enabledModels.length === 0) {
    throw new Error(
      "No models available. Please configure a provider in Settings."
    );
  }

  const first = enabledModels[0];
  const fallbackId = `${first.provider.id}/${first.model.modelId}`;
  return getLanguageModel(fallbackId, userId);
}

export async function getTitleModel(userId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return await getSystemModel(userId);
}

export async function getArtifactModel(userId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("artifact-model");
  }
  return await getSystemModel(userId);
}
