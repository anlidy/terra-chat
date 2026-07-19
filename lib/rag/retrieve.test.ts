import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentRetriever } from "./retrieve";
import type { RetrievedChunk } from "./types";

const chunk: RetrievedChunk = {
  chunkId: "chunk-1",
  resourceId: "resource-1",
  content: "policy",
  chunkIndex: 0,
  fileName: "policy.pdf",
  pageNumber: 1,
};

test("document retriever embeds once and forwards normalized input", async () => {
  const calls: string[] = [];
  const retrieve = createDocumentRetriever({
    embed: (query) => {
      calls.push(`embed:${query}`);
      return Promise.resolve([0.1, 0.2]);
    },
    search: (input) => {
      calls.push(`search:${input.query}`);
      assert.deepEqual(input.embedding, [0.1, 0.2]);
      return Promise.resolve([chunk]);
    },
  });

  assert.deepEqual(
    await retrieve({ chatId: "chat", query: " policy ", limit: 5 }),
    [chunk]
  );
  assert.deepEqual(calls, ["embed:policy", "search:policy"]);
});

test("lexical retrieval skips embedding", async () => {
  let embedded = false;
  const retrieve = createDocumentRetriever({
    embed: () => {
      embedded = true;
      return Promise.resolve([0.1]);
    },
    search: (input) => {
      assert.equal(input.strategy, "lexical");
      assert.equal(input.embedding, undefined);
      return Promise.resolve([chunk]);
    },
  });

  await retrieve({ chatId: "chat", query: "policy", strategy: "lexical" });
  assert.equal(embedded, false);
});

test("document retriever rejects an empty query", async () => {
  const retrieve = createDocumentRetriever({
    embed: () => Promise.resolve([0.1]),
    search: () => Promise.resolve([chunk]),
  });

  await assert.rejects(
    () => retrieve({ chatId: "chat", query: "   " }),
    /query must not be empty/i
  );
});
