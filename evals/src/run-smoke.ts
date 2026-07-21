import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { RAG_PIPELINE_VERSION } from "../../lib/rag/config";
import { evaluateRetrievalCase } from "./metrics";
import { hashPath, resolveSourceRevision } from "./provenance";
import {
  buildRetrievalReport,
  latestReportFileStem,
  renderMarkdownReport,
} from "./report";
import {
  evalRetrievedChunkSchema,
  parseEvalCases,
  type RagEvalCase,
} from "./schema";

const K = 5;
const rankedResultsSchema = z.record(evalRetrievedChunkSchema.array());

function parseJsonLines(contents: string): unknown[] {
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function evaluateFixture(
  evalCases: RagEvalCase[],
  rankedResults: z.infer<typeof rankedResultsSchema>
) {
  return evalCases.map((evalCase) => {
    const retrieved = rankedResults[evalCase.id];
    if (retrieved === undefined) {
      throw new Error(`Missing smoke results for case: ${evalCase.id}`);
    }

    return evaluateRetrievalCase({
      evalCase,
      retrieved,
      latencyMs: 0,
      k: K,
    });
  });
}

async function main(): Promise<void> {
  const fixturesDirectory = path.resolve("evals/fixtures");
  const casesContents = await readFile(
    path.join(fixturesDirectory, "smoke-cases.jsonl"),
    "utf8"
  );
  const rankedResultsContents = await readFile(
    path.join(fixturesDirectory, "smoke-results.json"),
    "utf8"
  );
  const evalCases = parseEvalCases(parseJsonLines(casesContents));
  const rankedResults = rankedResultsSchema.parse(
    JSON.parse(rankedResultsContents)
  );
  const results = evaluateFixture(evalCases, rankedResults);
  const report = buildRetrievalReport(results, {
    dataset: "smoke",
    strategy: "fixture",
    k: K,
    sourceRevision: resolveSourceRevision(),
    caseSetHash: await hashPath(
      path.join(fixturesDirectory, "smoke-cases.jsonl")
    ),
    corpusHash: await hashPath(
      path.join(fixturesDirectory, "smoke-results.json")
    ),
    pipelineVersion: RAG_PIPELINE_VERSION,
    embeddingModel: null,
    rerankerAttempts: [],
    rerankers: ["fixture"],
    minRelevance: null,
  });
  const markdown = renderMarkdownReport(report);
  const resultsDirectory = path.resolve("evals/results");
  const fileStem = latestReportFileStem("smoke");

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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
