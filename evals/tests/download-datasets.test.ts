import assert from "node:assert/strict";
import test from "node:test";

import { fetchText } from "../src/download-datasets";

test("dataset downloads retry failures while consuming the response body", async () => {
  let attempts = 0;
  const fetcher = (() => {
    attempts += 1;
    const currentAttempt = attempts;
    return Promise.resolve({
      ok: true,
      text: () =>
        currentAttempt < 3
          ? Promise.reject(new Error("body timed out"))
          : Promise.resolve("complete body"),
    } as Response);
  }) as typeof fetch;

  assert.equal(
    await fetchText("https://example.com/data.json", {
      attempts: 3,
      fetcher,
      retryDelayMs: 0,
      timeoutMs: 100,
    }),
    "complete body"
  );
  assert.equal(attempts, 3);
});
