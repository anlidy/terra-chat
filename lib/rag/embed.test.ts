import assert from "node:assert/strict";
import test from "node:test";

import { embedTexts } from "./embed";

function embeddingResponse(inputs: string[]): Response {
  return Response.json({
    data: inputs.map((input, index) => ({
      embedding: [input.length, index],
      index,
      object: "embedding",
    })),
    model: "embedding-3",
    object: "list",
  });
}

test("embedTexts batches large inputs and preserves their order", async () => {
  const previousFetch = globalThis.fetch;
  const batchSizes: number[] = [];

  globalThis.fetch = (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    batchSizes.push(body.input.length);
    return Promise.resolve(embeddingResponse(body.input));
  };

  try {
    const inputs = Array.from({ length: 65 }, (_, index) => `chunk-${index}`);
    const embeddings = await embedTexts(inputs, { context: "test.pdf" });

    assert.deepEqual(batchSizes, [64, 1]);
    assert.equal(embeddings.length, inputs.length);
    assert.deepEqual(embeddings[0], [7, 0]);
    assert.deepEqual(embeddings[64], [8, 0]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("embedTexts retries a transient network failure", async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (_input, init) => {
    attempts += 1;
    if (attempts === 1) {
      return Promise.reject(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect timed out"), {
            code: "UND_ERR_CONNECT_TIMEOUT",
          }),
        })
      );
    }
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return Promise.resolve(embeddingResponse(body.input));
  };

  try {
    assert.deepEqual(await embedTexts(["hello"], { context: "test.pdf" }), [
      [5, 0],
    ]);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("embedTexts reports non-retryable API errors with response details", async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = () => {
    attempts += 1;
    return Promise.resolve(
      Response.json(
        { error: { code: "1001", message: "invalid api key" } },
        { status: 401 }
      )
    );
  };

  try {
    await assert.rejects(
      () => embedTexts(["hello"], { context: "test.pdf" }),
      /Zhipu embedding failed \(status=401.*invalid api key/u
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("embedTexts rejects responses that omit an input index", async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = () =>
    Promise.resolve(
      Response.json({
        data: [
          { embedding: [1], index: 0 },
          { embedding: [2], index: 0 },
        ],
      })
    );

  try {
    await assert.rejects(
      () => embedTexts(["first", "second"]),
      /response omitted one or more inputs/u
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
