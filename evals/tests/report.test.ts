import assert from "node:assert/strict";
import test from "node:test";

import type { RetrievalCaseResult } from "../src/metrics";
import { buildRetrievalReport, renderMarkdownReport } from "../src/report";

const results: RetrievalCaseResult[] = [
  {
    caseId: "hit",
    query: "hit query",
    answerable: true,
    recallAtK: 1,
    mrr: 1,
    ndcgAtK: 1,
    falseRetrieval: false,
    latencyMs: 10,
    retrievedCount: 1,
    relevantRanks: [1],
  },
  {
    caseId: "miss",
    query: "miss query",
    answerable: true,
    recallAtK: 0,
    mrr: 0,
    ndcgAtK: 0,
    falseRetrieval: false,
    latencyMs: 20,
    retrievedCount: 1,
    relevantRanks: [],
  },
  {
    caseId: "false-retrieval",
    query: "unknown query",
    answerable: false,
    recallAtK: null,
    mrr: null,
    ndcgAtK: null,
    falseRetrieval: true,
    latencyMs: 30,
    retrievedCount: 1,
    relevantRanks: [],
  },
];

test("buildRetrievalReport keeps answerable and unanswerable denominators separate", () => {
  const report = buildRetrievalReport(results, {
    dataset: "smoke",
    strategy: "fixture",
    k: 5,
    generatedAt: "2026-07-19T00:00:00.000Z",
  });

  assert.equal(report.summary.caseCount, 3);
  assert.equal(report.summary.answerableCount, 2);
  assert.equal(report.summary.unanswerableCount, 1);
  assert.equal(report.summary.recallAtK, 0.5);
  assert.equal(report.summary.mrr, 0.5);
  assert.equal(report.summary.ndcgAtK, 0.5);
  assert.equal(report.summary.falseRetrievalRate, 1);
  assert.equal(report.summary.latencyP50Ms, 20);
  assert.equal(report.summary.latencyP95Ms, 30);
});

test("renderMarkdownReport includes metrics and failed cases", () => {
  const report = buildRetrievalReport(results, {
    dataset: "smoke",
    strategy: "fixture",
    k: 5,
    generatedAt: "2026-07-19T00:00:00.000Z",
  });
  const markdown = renderMarkdownReport(report);

  assert.match(markdown, /Recall@5/);
  assert.match(markdown, /NDCG@5/);
  assert.match(markdown, /P95/);
  assert.match(markdown, /miss query/);
  assert.match(markdown, /false-retrieval/);
});
