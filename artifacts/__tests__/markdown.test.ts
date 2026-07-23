import assert from "node:assert/strict";
import test from "node:test";
import { buildContentFromDocument } from "@/lib/editor/functions";
import { parseMarkdownToDocument } from "@/lib/editor/markdown";

test("parses visible English and Chinese Markdown synchronously", () => {
  const markdown = [
    "# 项目标题",
    "",
    "正文 with **bold** and [link](https://example.com).",
    "",
    "- first",
    "- 第二项",
    "",
    "```ts",
    "const value = 1;",
    "```",
  ].join("\n");

  const document = parseMarkdownToDocument(markdown);

  assert.equal(document.textContent.includes("项目标题"), true);
  assert.equal(document.textContent.includes("第二项"), true);
  assert.equal(document.childCount, 4);
  assert.match(buildContentFromDocument(document), /# 项目标题/);
});

test("keeps an empty document valid and saveable", () => {
  const document = parseMarkdownToDocument("");

  assert.equal(document.type.name, "doc");
  assert.equal(document.textContent, "");
  assert.equal(buildContentFromDocument(document), "");
});
