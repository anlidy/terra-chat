import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { retrieveDocumentChunks } from "../../lib/rag/retrieve";
import type { RetrievalStrategy } from "../../lib/rag/types";
import { evaluateRetrievalCase, type RetrievalCaseResult } from "./metrics";
import { buildRetrievalReport, renderMarkdownReport } from "./report";
import { evalRetrievedChunkSchema, parseEvalCases } from "./schema";

const K = 5;

export type RetrievalRunConfig = {
  chatId: string;
  casesPath: string;
  strategy: RetrievalStrategy;
  useRerank: boolean;
  k: number;
};

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

export function parseRetrievalRunConfig({
  env,
  args,
}: {
  env: Record<string, string | undefined>;
  args: string[];
}): RetrievalRunConfig {
  const chatId = env.EVAL_CHAT_ID?.trim();
  if (!chatId) {
    throw new Error("EVAL_CHAT_ID is required for a retrieval benchmark");
  }

  const casesPath = optionValue(args, "cases");
  if (!casesPath) {
    throw new Error("--cases=<path> is required for a retrieval benchmark");
  }

  const strategy = optionValue(args, "strategy") ?? "hybrid";
  if (!(["vector", "lexical", "hybrid"] as string[]).includes(strategy)) {
    throw new Error("--strategy must be vector, lexical, or hybrid");
  }

  const rerank = optionValue(args, "rerank") ?? "true";
  if (rerank !== "true" && rerank !== "false") {
    throw new Error("--rerank must be true or false");
  }

  return {
    chatId,
    casesPath,
    strategy: strategy as RetrievalStrategy,
    useRerank: rerank === "true",
    k: K,
  };
}

function parseJsonLines(contents: string): unknown[] {
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(config: RetrievalRunConfig): Promise<void> {
  const casesContents = await readFile(config.casesPath, "utf8");
  const evalCases = parseEvalCases(parseJsonLines(casesContents));
  const results: RetrievalCaseResult[] = [];

  for (const evalCase of evalCases) {
    const startedAt = performance.now();
    try {
      const chunks = await retrieveDocumentChunks({
        chatId: config.chatId,
        query: evalCase.query,
        limit: config.k,
        strategy: config.strategy,
        useRerank: config.useRerank,
      });
      const retrieved = evalRetrievedChunkSchema.array().parse(chunks);
      results.push(
        evaluateRetrievalCase({
          evalCase,
          retrieved,
          latencyMs: performance.now() - startedAt,
          k: config.k,
        })
      );
    } catch (error) {
      results.push({
        ...evaluateRetrievalCase({
          evalCase,
          retrieved: [],
          latencyMs: performance.now() - startedAt,
          k: config.k,
        }),
        error: errorMessage(error),
      });
    }
  }

  const dataset = path.basename(
    config.casesPath,
    path.extname(config.casesPath)
  );
  const strategy = `${config.strategy}-${config.useRerank ? "rerank" : "no-rerank"}`;
  const report = buildRetrievalReport(results, {
    dataset,
    strategy,
    k: config.k,
  });
  const markdown = renderMarkdownReport(report);
  const timestamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, "-");
  const fileStem = `${strategy}-${timestamp}`;
  const resultsDirectory = path.resolve("evals/results");

  await mkdir(resultsDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(resultsDirectory, `${fileStem}.json`),
      `${JSON.stringify(report, null, 2)}\n`
    ),
    writeFile(path.join(resultsDirectory, `${fileStem}.md`), markdown),
  ]);
  process.stdout.write(markdown);
}

if (require.main === module) {
  const config = parseRetrievalRunConfig({
    env: process.env,
    args: process.argv.slice(2),
  });
  run(config).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
