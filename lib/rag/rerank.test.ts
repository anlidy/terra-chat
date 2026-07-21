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
  const previousKey = process.env.ALIYUN_RERANK_API_KEY;
  const previousBaseUrl = process.env.ALIYUN_RERANK_BASE_URL;
  process.env.ALIYUN_RERANK_API_KEY = "";
  process.env.ALIYUN_RERANK_BASE_URL = "";

  try {
    const results = await rerankDocuments({
      query: "alpha",
      documents,
      topK: 1,
    });

    assert.equal(results[0]?.reranker, "heuristic");
  } finally {
    process.env.ALIYUN_RERANK_API_KEY = previousKey ?? "";
    process.env.ALIYUN_RERANK_BASE_URL = previousBaseUrl ?? "";
  }
});

test("rerankDocuments records the remote reranker", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.ALIYUN_RERANK_API_KEY;
  const previousBaseUrl = process.env.ALIYUN_RERANK_BASE_URL;
  process.env.ALIYUN_RERANK_API_KEY = "test-key";
  process.env.ALIYUN_RERANK_BASE_URL =
    "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/";
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          output: { results: [{ index: 1, relevance_score: 0.9 }] },
        }),
        { status: 200 }
      )
    );
  };

  try {
    const results = await rerankDocuments({
      query: "alpha",
      documents,
      topK: 1,
    });

    assert.equal(results[0]?.reranker, "aliyun/qwen3-rerank");
    assert.deepEqual(results[0]?.rerankerAttempt, {
      reranker: "aliyun/qwen3-rerank",
      status: "succeeded",
    });
    assert.equal(
      requestUrl,
      "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
    );
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      model: "qwen3-rerank",
      input: {
        query: "alpha",
        documents: ["alpha policy", "unrelated text"],
      },
      parameters: {
        top_n: 1,
        return_documents: false,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    process.env.ALIYUN_RERANK_API_KEY = previousKey ?? "";
    process.env.ALIYUN_RERANK_BASE_URL = previousBaseUrl ?? "";
  }
});

test("rerankDocuments records a failed remote attempt before fallback", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.ALIYUN_RERANK_API_KEY;
  const previousBaseUrl = process.env.ALIYUN_RERANK_BASE_URL;
  process.env.ALIYUN_RERANK_API_KEY = "test-key";
  process.env.ALIYUN_RERANK_BASE_URL =
    "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1";
  globalThis.fetch = () =>
    Promise.resolve(new Response('{"code":"InvalidApiKey"}', { status: 401 }));

  try {
    const results = await rerankDocuments({
      query: "alpha",
      documents,
      topK: 1,
    });

    assert.equal(results[0]?.reranker, "heuristic");
    assert.equal(results[0]?.rerankerAttempt?.status, "failed");
    assert.match(results[0]?.rerankerAttempt?.error ?? "", /401/u);
  } finally {
    globalThis.fetch = previousFetch;
    process.env.ALIYUN_RERANK_API_KEY = previousKey ?? "";
    process.env.ALIYUN_RERANK_BASE_URL = previousBaseUrl ?? "";
  }
});
