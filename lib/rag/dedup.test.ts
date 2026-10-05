import assert from "node:assert/strict";
import test from "node:test";
import { canReuseResource, findOrphanedResourceIds } from "./dedup";

test("ready resources from the current pipeline are reusable", () => {
  assert.equal(
    canReuseResource({ status: "ready", pipelineVersion: "v2" }, "v2"),
    true
  );
});

test("failed or in-flight resources are not reusable", () => {
  for (const status of ["queued", "parsing", "embedding", "failed"]) {
    assert.equal(
      canReuseResource({ status, pipelineVersion: "v2" }, "v2"),
      false
    );
  }
});

test("resources indexed by an older pipeline are not reusable", () => {
  assert.equal(
    canReuseResource({ status: "ready", pipelineVersion: "v1" }, "v2"),
    false
  );
});

test("only resources without remaining links are orphaned", () => {
  assert.deepEqual(findOrphanedResourceIds(["a", "b", "c"], ["b"]), ["a", "c"]);
});

test("duplicate detached ids are reported once", () => {
  assert.deepEqual(findOrphanedResourceIds(["a", "a"], []), ["a"]);
});

test("shared resources survive when still linked", () => {
  assert.deepEqual(findOrphanedResourceIds(["a"], ["a"]), []);
});
