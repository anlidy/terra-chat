import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const consumers = [
  "lib/ai/tools/rag/retrieve-documents.ts",
  "app/(chat)/api/chat/route.ts",
];

test("document retrieval consumers use the shared retrieval service", async () => {
  for (const path of consumers) {
    const source = await readFile(path, "utf8");

    assert.match(source, /import \{ retrieveDocumentChunks \}/u, path);
    assert.match(source, /retrieveDocumentChunks\s*\(/u, path);
    assert.doesNotMatch(
      source,
      /import[^;]*(?:embedText|similaritySearch|hybridSearch)/u,
      path
    );
  }
});
