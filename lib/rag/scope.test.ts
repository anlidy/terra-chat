import assert from "node:assert/strict";
import test from "node:test";
import { resolveChatCollectionIds } from "./scope";

test("standalone chats only search their chat collection", () => {
  assert.deepEqual(
    resolveChatCollectionIds({ chatCollectionId: "chat-collection" }),
    ["chat-collection"]
  );
});

test("project chats search project and chat collections", () => {
  assert.deepEqual(
    resolveChatCollectionIds({
      chatCollectionId: "chat-collection",
      projectCollectionId: "project-collection",
    }),
    ["chat-collection", "project-collection"]
  );
});

test("collection ids are deduplicated", () => {
  assert.deepEqual(
    resolveChatCollectionIds({
      chatCollectionId: "shared-collection",
      projectCollectionId: "shared-collection",
    }),
    ["shared-collection"]
  );
});
