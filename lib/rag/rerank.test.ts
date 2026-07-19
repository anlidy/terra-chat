import assert from "node:assert/strict";
import test from "node:test";

import { rerankDocuments } from "./rerank";

const documents = [
  {
    content: "alpha policy",
    chunkIndex: 0,
    fileName: "policy.md",
    pageNumber: null,
  },
  {
    content: "unrelated text",
    chunkIndex: 1,
    fileName: "policy.md",
    pageNumber: null,
  },
];

test("rerankDocuments records when reranking is not needed", async () => {
  const results = await rerankDocuments({
    query: "alpha",
    documents,
    topK: 2,
  });

  assert.deepEqual(
    results.map((result) => result.reranker),
    ["identity", "identity"]
  );
});

test("rerankDocuments records the heuristic fallback", async () => {
  const previousKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = "";

  try {
    const results = await rerankDocuments({
      query: "alpha",
      documents,
      topK: 1,
    });

    assert.equal(results[0]?.reranker, "heuristic");
  } finally {
    process.env.DASHSCOPE_API_KEY = previousKey ?? "";
  }
});

test("rerankDocuments records the remote reranker", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = "test-key";
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          output: { results: [{ index: 1, relevance_score: 0.9 }] },
        }),
        { status: 200 }
      )
    );

  try {
    const results = await rerankDocuments({
      query: "alpha",
      documents,
      topK: 1,
    });

    assert.equal(results[0]?.reranker, "dashscope/gte-rerank");
  } finally {
    globalThis.fetch = previousFetch;
    process.env.DASHSCOPE_API_KEY = previousKey ?? "";
  }
});
