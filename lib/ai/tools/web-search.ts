import { tool } from "ai";
import { z } from "zod";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? "";

export const webSearch = tool({
  description:
    "Search the web for current information. Use this when the user asks about recent events, " +
    "news, facts you're unsure about, or anything that requires up-to-date information. " +
    "Returns relevant web page titles, URLs, and content snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    maxResults: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Number of results to return (1-5, default 3)"),
  }),
  needsApproval: false,
  execute: async ({ query, maxResults }, { abortSignal }) => {
    if (!TAVILY_API_KEY) {
      return "Web search is not configured. Set TAVILY_API_KEY in environment variables.";
    }

    const controller = new AbortController();
    const linkedSignal = abortSignal
      ? AbortSignal.any([abortSignal, controller.signal])
      : controller.signal;

    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: "basic",
          include_answer: true,
          max_results: maxResults,
        }),
        signal: linkedSignal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        return `Search failed: ${response.status} ${text}`;
      }

      const data = await response.json();

      // Format results as readable text — model handles this better than raw JSON
      const lines: string[] = [];
      if (data.answer) {
        lines.push(`Summary: ${data.answer}`, "");
      }
      for (const r of data.results ?? []) {
        lines.push(`- ${r.title}`);
        lines.push(`  URL: ${r.url}`);
        lines.push(`  ${r.content}`);
        lines.push("");
      }

      return lines.join("\n").trim() || "No results found.";
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        return "Search timed out. Please try again.";
      }
      return `Search failed: ${String(error)}`;
    }
  },
});
