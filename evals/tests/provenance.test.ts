import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashPath } from "../src/provenance";

test("hashPath is stable and changes with corpus content", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-corpus-"));

  try {
    await mkdir(path.join(directory, "nested"));
    await writeFile(path.join(directory, "a.txt"), "alpha");
    await writeFile(path.join(directory, "nested", "b.txt"), "beta");

    const initial = await hashPath(directory);
    assert.equal(initial, await hashPath(directory));

    await writeFile(path.join(directory, "nested", "b.txt"), "changed");
    assert.notEqual(initial, await hashPath(directory));
  } finally {
    await rm(directory, { recursive: true });
  }
});
