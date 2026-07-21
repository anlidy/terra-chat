import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCitations,
  extractCitations,
  parseAnswerJudge,
  resolveAnswerPricing,
} from "../src/answer-metrics";

const evalCase = {
  id: "case-1",
  query: "Compare both documents",
  expectedAnswer: "Alpha and beta",
  relevantDocumentIds: ["alpha", "beta"],
  evidenceTexts: ["Alpha", "Beta"],
  evidencePages: [],
  category: "comparison",
  language: "en" as const,
  answerable: true,
};

test("answer citation metrics separate precision from gold-document recall", () => {
  const citations = extractCitations(
    "Supported by [alpha.pdf], [other.txt], and [alpha.pdf]."
  );
  const metrics = evaluateCitations(evalCase, citations);

  assert.deepEqual(citations, ["alpha.pdf", "other.txt", "alpha.pdf"]);
  assert.equal(metrics.citationPrecision, 1 / 3);
  assert.equal(metrics.citationRecall, 0.5);
});

test("unanswerable citation metrics reward an answer without citations", () => {
  const metrics = evaluateCitations(
    {
      ...evalCase,
      answerable: false,
      relevantDocumentIds: [],
      evidenceTexts: [],
    },
    []
  );

  assert.deepEqual(metrics, { citationPrecision: 1, citationRecall: 1 });
});

test("answer judge parser requires faithfulness, correctness, and completeness", () => {
  assert.deepEqual(
    parseAnswerJudge(
      "FAITHFULNESS: 0.75\nCORRECTNESS: 1\nCOMPLETENESS: 0.5\nRATIONALE: One detail is missing."
    ),
    {
      faithfulnessScore: 0.75,
      correctnessScore: 1,
      completenessScore: 0.5,
      rationale: "One detail is missing.",
    }
  );
  assert.throws(
    () => parseAnswerJudge("FAITHFULNESS: 1"),
    /valid CORRECTNESS/u
  );
});

test("answer pricing is only reported for a known model", () => {
  assert.notEqual(resolveAnswerPricing("provider/deepseek-v4-flash"), null);
  assert.equal(resolveAnswerPricing("provider/unknown-model"), null);
});
