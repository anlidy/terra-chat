import assert from "node:assert/strict";
import test from "node:test";

import { parseRetrievalRunConfig } from "../src/run-retrieval";
import { evalRetrievedChunkSchema, parseEvalCases } from "../src/schema";

const answerableCase = {
  id: "answerable-1",
  query: "  What is the refund period?  ",
  expectedAnswer: "Refunds are available within 30 days.",
  relevantDocumentIds: ["refund-policy"],
  evidenceTexts: ["Customers may request a refund within 30 days."],
  evidencePages: [2],
  category: "policy",
  language: "en",
  answerable: true,
};

const unanswerableCase = {
  id: "unanswerable-1",
  query: "Who founded the company?",
  expectedAnswer: "",
  relevantDocumentIds: [],
  evidenceTexts: [],
  evidencePages: [],
  category: "out-of-scope",
  language: "en",
  answerable: false,
};

test("parseEvalCases accepts answerable and unanswerable cases", () => {
  const parsed = parseEvalCases([answerableCase, unanswerableCase]);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.query, "What is the refund period?");
  assert.deepEqual(parsed[1], unanswerableCase);
});

test("parseEvalCases rejects duplicate IDs", () => {
  assert.throws(
    () =>
      parseEvalCases([
        answerableCase,
        { ...unanswerableCase, id: answerableCase.id },
      ]),
    new Error("Duplicate evaluation case id: answerable-1"),
  );
});

test("evalRetrievedChunkSchema rejects empty required metadata fields", () => {
  const validChunk = {
    chunkId: "chunk-1",
    resourceId: "resource-1",
    content: "Refunds are available within 30 days.",
    chunkIndex: 0,
    fileName: "refund-policy.pdf",
    pageNumber: 2,
  };

  const validationResults = ["chunkId", "resourceId", "fileName"].map(
    (field) =>
      evalRetrievedChunkSchema.safeParse({
        ...validChunk,
        [field]: "",
      }).success,
  );

  assert.deepEqual(validationResults, [false, false, false]);
});

test("retrieval runner requires a chat id", () => {
  assert.throws(
    () =>
      parseRetrievalRunConfig({
        env: {},
        args: ["--cases=evals/cases.jsonl"],
      }),
    /EVAL_CHAT_ID is required/u,
  );
});

test("retrieval runner rejects unsupported strategies", () => {
  assert.throws(
    () =>
      parseRetrievalRunConfig({
        env: { EVAL_CHAT_ID: "chat-id" },
        args: ["--cases=evals/cases.jsonl", "--strategy=keyword"],
      }),
    /strategy must be vector, lexical, or hybrid/u,
  );
});

test("retrieval runner parses explicit options", () => {
  assert.deepEqual(
    parseRetrievalRunConfig({
      env: { EVAL_CHAT_ID: "chat-id" },
      args: [
        "--cases=evals/cases.jsonl",
        "--strategy=lexical",
        "--rerank=false",
      ],
    }),
    {
      chatId: "chat-id",
      casesPath: "evals/cases.jsonl",
      strategy: "lexical",
      useRerank: false,
      k: 5,
    },
  );
});
