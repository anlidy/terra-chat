import assert from "node:assert/strict";
import test from "node:test";

import { reciprocalRankFusion } from "./fusion";
import type { RankedSearchResult, RetrievedChunk } from "./types";

const first: RetrievedChunk = {
  chunkId: "chunk-a",
  resourceId: "resource-a",
  content: "first",
  chunkIndex: 0,
  fileName: "same.pdf",
  pageNumber: 1,
};

test("RRF deduplicates by chunk id rather than filename", () => {
  const input: RankedSearchResult[] = [
    {
      ...first,
      source: "vector",
      rank: 1,
      vectorDistance: 0.1,
    },
    {
      ...first,
      source: "lexical",
      rank: 2,
      lexicalRank: 0.8,
    },
    {
      ...first,
      chunkId: "chunk-b",
      content: "second",
      source: "lexical",
      rank: 1,
      lexicalRank: 0.9,
    },
  ];
  const fused = reciprocalRankFusion(input);

  assert.equal(fused.length, 2);
  assert.equal(fused[0]?.chunkId, "chunk-a");
  assert.equal(fused[0]?.vectorDistance, 0.1);
  assert.equal(fused[0]?.lexicalRank, 0.8);
  assert.ok((fused[0]?.fusionScore ?? 0) > (fused[1]?.fusionScore ?? 0));
});

test("RRF keeps distinct chunks with the same filename and index", () => {
  const fused = reciprocalRankFusion([
    { ...first, source: "vector", rank: 1, vectorDistance: 0.1 },
    {
      ...first,
      chunkId: "chunk-b",
      source: "lexical",
      rank: 1,
      lexicalRank: 0.9,
    },
  ]);

  assert.deepEqual(
    fused.map((item) => item.chunkId),
    ["chunk-a", "chunk-b"]
  );
});

test("RRF ranks vector-only and lexical-only input", () => {
  const vectorOnly = reciprocalRankFusion([
    { ...first, source: "vector", rank: 2, vectorDistance: 0.2 },
    {
      ...first,
      chunkId: "chunk-b",
      source: "vector",
      rank: 1,
      vectorDistance: 0.1,
    },
  ]);
  const lexicalOnly = reciprocalRankFusion([
    { ...first, source: "lexical", rank: 2, lexicalRank: 0.5 },
    {
      ...first,
      chunkId: "chunk-b",
      source: "lexical",
      rank: 1,
      lexicalRank: 0.9,
    },
  ]);

  assert.equal(vectorOnly[0]?.chunkId, "chunk-b");
  assert.equal(lexicalOnly[0]?.chunkId, "chunk-b");
});
