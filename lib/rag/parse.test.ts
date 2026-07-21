import assert from "node:assert/strict";
import test from "node:test";

import { parseDocument } from "./parse";

test("plain text documents are parsed locally", async () => {
  const contents = "本地文本解析\nwithout a cloud parser";
  const buffer = Uint8Array.from(new TextEncoder().encode(contents)).buffer;

  assert.equal(await parseDocument(buffer, "sample.txt", "txt"), contents);
});
