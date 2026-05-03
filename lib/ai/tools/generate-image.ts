import { tool } from "ai";
import { z } from "zod";

const IMAGE_GEN_API_KEY = process.env.IMAGE_GEN_API_KEY ?? "";
const IMAGE_GEN_BASE_URL =
  process.env.IMAGE_GEN_BASE_URL ?? "https://api.siliconflow.cn";

export const generateImage = tool({
  description:
    "Generate an image based on a text prompt. Use this when the user asks you to draw, create, or generate an image. " +
    "Provide a detailed prompt in English describing what to draw.",
  inputSchema: z.object({
    prompt: z
      .string()
      .describe("Detailed description of the image to generate, in English"),
    negativePrompt: z
      .string()
      .optional()
      .describe("Things to avoid in the generated image"),
    size: z
      .enum(["1024x1024", "768x1024", "1024x768", "576x1024", "1024x576"])
      .optional()
      .default("1024x1024")
      .describe(
        "Image size. Use '1024x1024' for square, '768x1024' or '576x1024' for portrait, '1024x768' or '1024x576' for landscape"
      ),
  }),
  needsApproval: false,
  execute: async ({ prompt, negativePrompt, size }, { abortSignal }) => {
    if (!IMAGE_GEN_API_KEY) {
      return {
        error:
          "Image generation is not configured. Set IMAGE_GEN_API_KEY in environment variables.",
      };
    }

    const controller = new AbortController();
    const linkedSignal = abortSignal
      ? AbortSignal.any([abortSignal, controller.signal])
      : controller.signal;

    const timeout = setTimeout(() => controller.abort(), 55_000);

    try {
      const response = await fetch(
        `${IMAGE_GEN_BASE_URL}/v1/images/generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${IMAGE_GEN_API_KEY}`,
          },
          body: JSON.stringify({
            model: "flux-dev",
            prompt,
            negative_prompt: negativePrompt,
            image_size: size,
          }),
          signal: linkedSignal,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return {
          error: `Image generation failed: ${response.status} ${text}`,
        };
      }

      const data = await response.json();
      const imageUrl = data.images?.[0]?.url;
      if (!imageUrl) {
        return {
          error: "Image generation returned no image URL",
        };
      }

      return { url: imageUrl, prompt };
    } catch (error) {
      if (linkedSignal.aborted) {
        return { error: "Image generation timed out" };
      }
      return {
        error: `Image generation failed: ${String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});
