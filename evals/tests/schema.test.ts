import assert from "node:assert/strict";
import test from "node:test";

import { parseEvalCases } from "../src/schema";

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
