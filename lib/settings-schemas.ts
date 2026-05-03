import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  preferences: z
    .object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
});

export const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  format: z.enum(["openai", "anthropic", "alibaba"]),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  format: z.enum(["openai", "anthropic", "alibaba"]).optional(),
  isEnabled: z.boolean().optional(),
});

export const createModelSchema = z.object({
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
});

export const toggleModelSchema = z.object({
  isEnabled: z.boolean(),
});
