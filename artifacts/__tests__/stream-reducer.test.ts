import assert from "node:assert/strict";
import test from "node:test";
import type { DataUIPart } from "ai";
import { initialArtifactData } from "@/hooks/use-artifact";
import {
  compactArtifactStreamParts,
  reduceArtifactStreamBatch,
} from "@/lib/artifacts/stream-reducer";
import type { CustomUIDataTypes } from "@/lib/types";

type Part = DataUIPart<CustomUIDataTypes>;

const part = <T extends Part["type"]>(
  type: T,
  data: Extract<Part, { type: T }>["data"]
) => ({ type, data }) as Extract<Part, { type: T }>;

test("preserves control order while compacting deltas and snapshots", () => {
  const parts = compactArtifactStreamParts([
    part("data-textDelta", "a"),
    part("data-textDelta", "b"),
    part("data-codeDelta", "old"),
    part("data-title", "Draft"),
    part("data-codeDelta", "latest"),
    part("data-finish", null),
  ]);

  assert.deepEqual(
    parts.map(({ type, data }) => [type, data]),
    [
      ["data-textDelta", "ab"],
      ["data-title", "Draft"],
      ["data-codeDelta", "latest"],
      ["data-finish", null],
    ]
  );
});

test("reduces a mixed text stream with one artifact commit", () => {
  const result = reduceArtifactStreamBatch(
    { artifact: initialArtifactData, suggestions: [] },
    [
      part("data-id", "doc-1"),
      part("data-title", "中英 Draft"),
      part("data-kind", "text"),
      part("data-clear", null),
      part("data-textDelta", "x".repeat(250)),
      part("data-textDelta", "y".repeat(151)),
    ]
  );

  assert.equal(result.artifact.documentId, "doc-1");
  assert.equal(result.artifact.title, "中英 Draft");
  assert.equal(result.artifact.content.length, 401);
  assert.equal(result.artifact.status, "streaming");
  assert.equal(result.artifact.isVisible, true);
  assert.equal(result.artifact.hasAutoOpened, true);
});

test("does not auto-open again after the user dismisses a stream", () => {
  const result = reduceArtifactStreamBatch(
    {
      artifact: {
        ...initialArtifactData,
        documentId: "doc-1",
        status: "streaming",
        content: "x".repeat(390),
        wasDismissed: true,
      },
      suggestions: [],
    },
    [part("data-textDelta", "y".repeat(30))]
  );

  assert.equal(result.artifact.isVisible, false);
  assert.equal(result.artifact.hasAutoOpened, false);
});

test("keeps the latest snapshot, suggestions, finish and failure state", () => {
  const suggestion = {
    id: "s-1",
    documentId: "doc-2",
    documentCreatedAt: new Date(),
    createdAt: new Date(),
    originalText: "a",
    suggestedText: "b",
    description: "Improve",
    isResolved: false,
    userId: "user-1",
  };
  const streamed = reduceArtifactStreamBatch(
    { artifact: initialArtifactData, suggestions: [] },
    [
      part("data-id", "doc-2"),
      part("data-kind", "sheet"),
      part("data-sheetDelta", "old"),
      part("data-sheetDelta", "latest"),
      part("data-suggestion", suggestion),
      part("data-finish", null),
    ]
  );

  assert.equal(streamed.artifact.content, "latest");
  assert.equal(streamed.artifact.status, "idle");
  assert.deepEqual(streamed.suggestions, [suggestion]);

  const failed = reduceArtifactStreamBatch(
    {
      ...streamed,
      artifact: { ...streamed.artifact, status: "streaming" },
    },
    [],
    "Connection lost"
  );
  assert.equal(failed.artifact.content, "latest");
  assert.equal(failed.artifact.status, "error");
  assert.equal(failed.artifact.errorMessage, "Connection lost");
});

test("does not turn an idle artifact into an error for a chat-only failure", () => {
  const result = reduceArtifactStreamBatch(
    { artifact: initialArtifactData, suggestions: [] },
    [],
    "Chat request failed"
  );

  assert.deepEqual(result.artifact, initialArtifactData);
});
