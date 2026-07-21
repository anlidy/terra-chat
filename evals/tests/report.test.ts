import assert from "node:assert/strict";
import test from "node:test";

import type { RetrievalCaseResult } from "../src/metrics";
import {
  buildRetrievalReport,
  latestReportFileStem,
  renderMarkdownReport,
} from "../src/report";

const results: RetrievalCaseResult[] = [
  {
    caseId: "hit",
    query: "hit query",
    category: "fact",
    language: "en",
    answerable: true,
    documentRecallAtK: 1,
    goldDocumentCoverageAtK: 1,
    evidenceCoverageAtK: 1,
    contextPrecisionAtK: 1,
    recallAtK: 1,
    mrr: 1,
    ndcgAtK: 1,
    falseRetrieval: false,
    latencyMs: 10,
    retrievedCount: 1,
    relevantRanks: [1],
    topResults: [],
  },
  {
    caseId: "miss",
    query: "miss query",
    category: "summary",
    language: "zh",
    answerable: true,
    documentRecallAtK: 0,
    goldDocumentCoverageAtK: 0,
    evidenceCoverageAtK: 0,
    contextPrecisionAtK: 0,
    recallAtK: 0,
    mrr: 0,
    ndcgAtK: 0,
    falseRetrieval: false,
    latencyMs: 20,
    retrievedCount: 1,
    relevantRanks: [],
    topResults: [
      {
        rank: 1,
        chunkId: "wrong-chunk",
        resourceId: "wrong-resource",
        fileName: "wrong.pdf",
        pageNumber: 7,
        contentPreview: "wrong evidence",
        relevant: false,
        vectorDistance: 0.42,
      },
    ],
  },
  {
    caseId: "false-retrieval",
    query: "unknown query",
    category: "unanswerable",
    language: "zh",
    answerable: false,
    documentRecallAtK: null,
    goldDocumentCoverageAtK: null,
    evidenceCoverageAtK: null,
    contextPrecisionAtK: null,
    recallAtK: null,
    mrr: null,
    ndcgAtK: null,
    falseRetrieval: true,
    latencyMs: 30,
    retrievedCount: 1,
    relevantRanks: [],
    topResults: [],
  },
];

test("latestReportFileStem produces stable overwrite targets", () => {
  assert.equal(latestReportFileStem("smoke"), "smoke-latest");
  assert.equal(
    latestReportFileStem("financebench-quick", "hybrid-rerank"),
    "financebench-quick-hybrid-rerank-latest"
  );
  assert.equal(
    latestReportFileStem("project-scenarios", "answer"),
    "project-scenarios-answer-latest"
  );
});

test("buildRetrievalReport keeps answerable and unanswerable denominators separate", () => {
  const report = buildRetrievalReport(results, {
    dataset: "smoke",
    strategy: "fixture",
    k: 5,
    generatedAt: "2026-07-19T00:00:00.000Z",
    sourceRevision: "abc123",
    caseSetHash: "sha256:cases",
    corpusHash: "sha256:corpus",
    pipelineVersion: "smoke-v1",
    embeddingModel: null,
    rerankerAttempts: [],
    rerankers: ["fixture"],
    minRelevance: null,
  });

  assert.equal(report.summary.caseCount, 3);
  assert.equal(report.summary.answerableCount, 2);
  assert.equal(report.summary.unanswerableCount, 1);
  assert.equal(report.summary.recallAtK, 0.5);
  assert.equal(report.summary.documentRecallAtK, 0.5);
  assert.equal(report.summary.goldDocumentCoverageAtK, 0.5);
  assert.equal(report.summary.evidenceCoverageAtK, 0.5);
  assert.equal(report.summary.contextPrecisionAtK, 0.5);
  assert.equal(report.summary.mrr, 0.5);
  assert.equal(report.summary.ndcgAtK, 0.5);
  assert.equal(report.summary.falseRetrievalRate, 1);
  assert.equal(report.summary.latencyP50Ms, 20);
  assert.equal(report.summary.latencyP95Ms, 30);
  assert.equal(report.breakdowns.languages.en?.caseCount, 1);
  assert.equal(report.breakdowns.languages.zh?.caseCount, 2);
  assert.equal(report.breakdowns.categories.fact?.recallAtK, 1);
  assert.equal(report.breakdowns.categories.summary?.recallAtK, 0);
  assert.equal(report.breakdowns.categories.fact?.falseRetrievalRate, null);
  assert.equal(report.breakdowns.categories.unanswerable?.recallAtK, null);
});

test("renderMarkdownReport includes metrics and failed cases", () => {
  const report = buildRetrievalReport(results, {
    dataset: "smoke",
    strategy: "fixture",
    k: 5,
    generatedAt: "2026-07-19T00:00:00.000Z",
    sourceRevision: "abc123",
    caseSetHash: "sha256:cases",
    corpusHash: "sha256:corpus",
    pipelineVersion: "smoke-v1",
    embeddingModel: null,
    rerankerAttempts: [
      {
        reranker: "aliyun/qwen3-rerank",
        status: "failed",
        error: "Qwen3 rerank failed: 401",
      },
    ],
    rerankers: ["fixture"],
    minRelevance: null,
  });
  const markdown = renderMarkdownReport(report);

  assert.equal(report.metadata.sourceRevision, "abc123");
  assert.equal(report.metadata.corpusHash, "sha256:corpus");
  assert.match(markdown, /Source revision: abc123/);
  assert.match(markdown, /Corpus hash: sha256:corpus/);
  assert.match(markdown, /Rerankers: fixture/);
  assert.match(
    markdown,
    /Reranker attempts: aliyun\/qwen3-rerank: failed \(Qwen3 rerank failed: 401\)/u
  );
  assert.match(markdown, /Minimum relevance: disabled/);
  assert.match(markdown, /Recall@5/);
  assert.match(markdown, /Document recall@5/);
  assert.match(markdown, /Evidence coverage@5/);
  assert.match(markdown, /Context precision@5/);
  assert.match(markdown, /Breakdown by Language/);
  assert.match(markdown, /Breakdown by Category/);
  assert.match(markdown, /NDCG@5/);
  assert.match(markdown, /P95/);
  assert.match(markdown, /miss query/);
  assert.match(markdown, /wrong\.pdf#page=7/);
  assert.match(markdown, /vectorDistance=0\.4200/);
  assert.match(markdown, /false-retrieval/);
});
