import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { config as loadEnv } from "dotenv";

import {
  RAG_EMBEDDING_DIMENSIONS,
  RAG_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
} from "../../lib/rag/config";
import { retrieveDocumentChunks } from "../../lib/rag/retrieve";
import type { RetrievalStrategy } from "../../lib/rag/types";
import { evaluateRetrievalCase, type RetrievalCaseResult } from "./metrics";
import {
  hashFiles,
  hashPath,
  hashText,
  resolveSourceRevision,
} from "./provenance";
import { buildRetrievalReport, renderMarkdownReport } from "./report";
import { evalRetrievedChunkSchema, parseEvalCases } from "./schema";

const K = 5;

export type RetrievalRunConfig = {
  caseIds?: string[];
  chatId: string;
  casesPath: string;
  corpusFiles?: string[];
  corpusPath: string;
  dataset?: string;
  documentIds?: string[];
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

  const corpusPath = optionValue(args, "corpus");
  if (!corpusPath) {
    throw new Error("--corpus=<path> is required for a retrieval benchmark");
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
    corpusPath,
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

export async function runRetrieval(
  config: RetrievalRunConfig
): Promise<ReturnType<typeof buildRetrievalReport>> {
  const casesContents = await readFile(config.casesPath, "utf8");
  const allCases = parseEvalCases(parseJsonLines(casesContents));
  const selectedCaseIds =
    config.caseIds === undefined ? undefined : new Set(config.caseIds);
  const evalCases =
    selectedCaseIds === undefined
      ? allCases
      : allCases.filter((evalCase) => selectedCaseIds.has(evalCase.id));
  if (
    selectedCaseIds !== undefined &&
    evalCases.length !== selectedCaseIds.size
  ) {
    const foundIds = new Set(evalCases.map((evalCase) => evalCase.id));
    const missing = [...selectedCaseIds].filter((id) => !foundIds.has(id));
    throw new Error(
      `Selected evaluation cases are missing: ${missing.join(", ")}`
    );
  }
  const results: RetrievalCaseResult[] = [];
  const rerankers = new Set<string>();
  let errorCount = 0;
  const runStartedAt = performance.now();

  console.log(
    `[eval:retrieval] Starting ${evalCases.length} cases (strategy=${config.strategy}, rerank=${config.useRerank}, k=${config.k})`
  );

  for (const [index, evalCase] of evalCases.entries()) {
    const startedAt = performance.now();
    try {
      const chunks = await retrieveDocumentChunks({
        chatId: config.chatId,
        documentIds: config.documentIds,
        query: evalCase.query,
        limit: config.k,
        strategy: config.strategy,
        useRerank: config.useRerank,
      });
      for (const chunk of chunks) {
        if (chunk.reranker !== undefined) {
          rerankers.add(chunk.reranker);
        }
      }
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
      errorCount += 1;
      console.error(
        `[eval:retrieval] Case ${index + 1}/${evalCases.length} failed (${evalCase.id}): ${errorMessage(error)}`
      );
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

    const completed = index + 1;
    if (completed % 10 === 0 || completed === evalCases.length) {
      console.log(
        `[eval:retrieval] Progress ${completed}/${evalCases.length} (errors=${errorCount}, elapsed=${Math.round(performance.now() - runStartedAt)}ms)`
      );
    }
  }

  const dataset =
    config.dataset ??
    path.basename(config.casesPath, path.extname(config.casesPath));
  const strategy = `${config.strategy}-${config.useRerank ? "rerank" : "no-rerank"}`;
  const actualRerankers = config.useRerank
    ? rerankers.size > 0
      ? [...rerankers].toSorted()
      : ["not-invoked"]
    : ["disabled"];
  const report = buildRetrievalReport(results, {
    dataset,
    strategy,
    k: config.k,
    sourceRevision: resolveSourceRevision(),
    caseSetHash:
      config.caseIds === undefined
        ? await hashPath(config.casesPath)
        : hashText(
            `${evalCases.map((evalCase) => JSON.stringify(evalCase)).join("\n")}\n`
          ),
    corpusHash:
      config.corpusFiles === undefined
        ? await hashPath(config.corpusPath)
        : await hashFiles(config.corpusFiles, config.corpusPath),
    pipelineVersion: RAG_PIPELINE_VERSION,
    embeddingModel:
      config.strategy === "lexical"
        ? null
        : `zhipu/${RAG_EMBEDDING_MODEL}:${RAG_EMBEDDING_DIMENSIONS}`,
    rerankers: actualRerankers,
    minRelevance: null,
  });
  const markdown = renderMarkdownReport(report);
  const timestamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, "-");
  const fileStem = `${dataset}-${strategy}-${timestamp}`;
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
  return report;
}

if (require.main === module) {
  loadEnv({ path: ".env.local" });
  loadEnv();
  const main = async (): Promise<void> => {
    const config = parseRetrievalRunConfig({
      env: process.env,
      args: process.argv.slice(2),
    });
    try {
      await runRetrieval(config);
    } finally {
      const { closeDatabaseConnection } = await import("../../lib/db/queries");
      await closeDatabaseConnection();
    }
  };
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
