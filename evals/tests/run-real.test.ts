import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRealEvaluationConfig,
  REAL_RETRIEVAL_RUNS,
  selectProfileCases,
  waitForDocumentsReady,
} from "../src/run-real";

const cases = [{ id: "case-a" }, { id: "case-b" }, { id: "case-c" }];

test("real evaluation defaults to a quick bilingual hybrid run", () => {
  assert.deepEqual(parseRealEvaluationConfig([]), {
    dataset: "all",
    dryRun: false,
    ingestOnly: false,
    keepData: false,
    profile: "quick",
    refresh: false,
    retrievalRuns: [{ strategy: "hybrid", useRerank: false }],
    reuseChatId: undefined,
  });
  assert.deepEqual(REAL_RETRIEVAL_RUNS, [
    { strategy: "vector", useRerank: false },
    { strategy: "lexical", useRerank: false },
    { strategy: "hybrid", useRerank: false },
    { strategy: "hybrid", useRerank: true },
  ]);
});

test("real evaluation parses lifecycle flags and rejects unknown options", () => {
  assert.deepEqual(
    parseRealEvaluationConfig([
      "--",
      "--profile=full",
      "--dataset=zh",
      "--strategies=vector,hybrid-rerank",
      "--dry-run",
      "--keep-data",
      "--refresh",
    ]),
    {
      dataset: "zh",
      dryRun: true,
      ingestOnly: false,
      keepData: true,
      profile: "full",
      refresh: true,
      retrievalRuns: [
        { strategy: "vector", useRerank: false },
        { strategy: "hybrid", useRerank: true },
      ],
      reuseChatId: undefined,
    }
  );
  assert.deepEqual(
    parseRealEvaluationConfig(["--ingest-only", "--dataset=en"]),
    {
      dataset: "en",
      dryRun: false,
      ingestOnly: true,
      keepData: false,
      profile: "quick",
      refresh: false,
      retrievalRuns: [{ strategy: "hybrid", useRerank: false }],
      reuseChatId: undefined,
    }
  );
  assert.equal(
    parseRealEvaluationConfig([
      "--reuse-chat=123e4567-e89b-12d3-a456-426614174000",
    ]).reuseChatId,
    "123e4567-e89b-12d3-a456-426614174000"
  );
  assert.throws(
    () =>
      parseRealEvaluationConfig([
        "--ingest-only",
        "--reuse-chat=123e4567-e89b-12d3-a456-426614174000",
      ]),
    /--ingest-only cannot be combined with --reuse-chat/u
  );
  assert.throws(
    () => parseRealEvaluationConfig(["--unknown"]),
    /Unknown real evaluation option/u
  );
  assert.throws(
    () => parseRealEvaluationConfig(["--profile=large"]),
    /profile must be quick or full/u
  );
  assert.throws(
    () => parseRealEvaluationConfig(["--dataset=fr"]),
    /dataset must be en, zh, or all/u
  );
  assert.throws(
    () => parseRealEvaluationConfig(["--strategies=keyword"]),
    /Unsupported real evaluation strategy/u
  );
});

test("real evaluation expands the all strategy matrix", () => {
  assert.deepEqual(
    parseRealEvaluationConfig(["--strategies=all"]).retrievalRuns,
    REAL_RETRIEVAL_RUNS
  );
});

test("selectProfileCases keeps full data or a deterministic quick subset", () => {
  assert.deepEqual(selectProfileCases(cases, "full", ["missing"]), cases);
  assert.deepEqual(selectProfileCases(cases, "quick", ["case-c", "case-a"]), [
    cases[0],
    cases[2],
  ]);
  assert.throws(
    () => selectProfileCases(cases, "quick", ["missing"]),
    /Quick profile references missing cases: missing/u
  );
});

test("waitForDocumentsReady polls until every resource is ready", async () => {
  let reads = 0;

  await waitForDocumentsReady({
    expectedCount: 2,
    timeoutMs: 100,
    pollIntervalMs: 0,
    getDocuments: () => {
      reads += 1;
      return Promise.resolve(
        reads === 1
          ? [
              { fileName: "a.pdf", status: "ready" },
              { fileName: "b.pdf", status: "pending" },
            ]
          : [
              { fileName: "a.pdf", status: "ready" },
              { fileName: "b.pdf", status: "ready" },
            ]
      );
    },
  });

  assert.equal(reads, 2);
});

test("waitForDocumentsReady fails when ingestion reports an error", async () => {
  await assert.rejects(
    () =>
      waitForDocumentsReady({
        expectedCount: 1,
        timeoutMs: 100,
        pollIntervalMs: 0,
        getDocuments: () =>
          Promise.resolve([{ fileName: "broken.pdf", status: "error" }]),
      }),
    /Document ingestion failed: broken.pdf/u
  );
});
