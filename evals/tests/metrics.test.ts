import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRetrievalCase,
  isRelevant,
  ndcgAtK,
  percentile,
  reciprocalRank,
} from "../src/metrics";

const evalCase = {
  id: "case-1",
  query: "policy",
  expectedAnswer: "seven days",
  relevantDocumentIds: ["handbook"],
  evidenceTexts: ["submit within seven days"],
  evidencePages: [12],
  category: "fact",
  language: "en" as const,
  answerable: true,
};

const relevantChunk = {
  chunkId: "right-1",
  resourceId: "handbook",
  content: "Submit within seven days.",
  chunkIndex: 4,
  fileName: "handbook.pdf",
  pageNumber: 12,
};

test("reciprocalRank returns the reciprocal of the first hit", () => {
  assert.equal(reciprocalRank([false, true, true]), 0.5);
  assert.equal(reciprocalRank([false, false]), 0);
});

test("ndcgAtK rewards an ideal ranking", () => {
  assert.equal(ndcgAtK([true, true, false], 3), 1);
});

test("evaluateRetrievalCase matches document and evidence page", () => {
  const result = evaluateRetrievalCase({
    evalCase,
    retrieved: [
      {
        chunkId: "wrong-1",
        resourceId: "other",
        content: "noise",
        chunkIndex: 0,
        fileName: "other.pdf",
        pageNumber: 1,
      },
      relevantChunk,
    ],
    latencyMs: 25,
    k: 5,
  });

  assert.equal(result.recallAtK, 1);
  assert.equal(result.mrr, 0.5);
  assert.equal(result.ndcgAtK, 1 / Math.log2(3));
  assert.equal(result.falseRetrieval, false);
});

test("relevance requires a gold document and matches normalized evidence", () => {
  assert.equal(
    isRelevant(evalCase, {
      ...relevantChunk,
      resourceId: "database-id",
      fileName: "handbook.pdf",
      pageNumber: null,
      content: "Submit—within SEVEN days!",
    }),
    true,
  );
  assert.equal(
    isRelevant(evalCase, {
      ...relevantChunk,
      resourceId: "other",
      fileName: "other.pdf",
    }),
    false,
  );
});

test("unanswerable cases track false retrieval separately", () => {
  const result = evaluateRetrievalCase({
    evalCase: {
      ...evalCase,
      id: "unanswerable",
      relevantDocumentIds: [],
      evidenceTexts: [],
      evidencePages: [],
      answerable: false,
    },
    retrieved: [relevantChunk],
    latencyMs: 10,
    k: 5,
  });

  assert.equal(result.falseRetrieval, true);
  assert.equal(result.recallAtK, null);
  assert.equal(result.mrr, null);
  assert.equal(result.ndcgAtK, null);
});

test("percentile uses nearest-rank interpolation", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.equal(percentile([], 0.95), 0);
});
