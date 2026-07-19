import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  adaptFinanceBenchRows,
  resolveFinanceBenchDocumentUrl,
} from "../src/adapters/financebench";
import { adaptRgbRows } from "../src/adapters/rgb";

async function readJsonLines(path: string): Promise<unknown[]> {
  const contents = await readFile(path, "utf8");
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

test("FinanceBench adapter preserves document and zero-indexed evidence pages", async () => {
  const rows = await readJsonLines("evals/fixtures/raw/financebench.jsonl");
  const adapted = adaptFinanceBenchRows(rows, 3);

  assert.equal(adapted[0]?.language, "en");
  assert.equal(adapted[0]?.relevantDocumentIds[0], "3M_2018_10K");
  assert.deepEqual(adapted[0]?.evidencePages, [59]);
});

test("FinanceBench adapter samples reasoning groups round-robin", async () => {
  const rows = await readJsonLines("evals/fixtures/raw/financebench.jsonl");
  const adapted = adaptFinanceBenchRows(rows, 2);

  assert.deepEqual(
    adapted.map((item) => item.id),
    ["financebench_id_00001", "financebench_id_00003"],
  );
});

test("FinanceBench adapter resolves Adobe PDF wrapper links", () => {
  const target =
    "https://www.adobe.com/content/dam/example/investor-report.pdf";
  const wrapper = `https://www.adobe.com/pdf-page.html?pdfTarget=${Buffer.from(target).toString("base64url")}`;

  assert.equal(resolveFinanceBenchDocumentUrl(wrapper), target);
  assert.equal(
    resolveFinanceBenchDocumentUrl("https://example.com/report.pdf"),
    "https://example.com/report.pdf",
  );
});

test("RGB adapter retains bounded positive and negative documents", async () => {
  const rows = JSON.parse(
    await readFile("evals/fixtures/raw/rgb-zh.json", "utf8"),
  ) as unknown[];
  const adapted = adaptRgbRows(rows, 1);

  assert.equal(adapted.cases[0]?.id, "rgb-zh-1");
  assert.equal(adapted.cases[0]?.language, "zh");
  assert.deepEqual(adapted.cases[0]?.relevantDocumentIds, [
    "rgb-zh-1-positive-0",
    "rgb-zh-1-positive-1",
  ]);
  assert.equal(adapted.documents.length, 5);
  assert.ok(adapted.documents.some((document) => document.relevant));
  assert.ok(adapted.documents.some((document) => !document.relevant));
});

test("RGB adapter flattens upstream answer aliases", async () => {
  const rows = JSON.parse(
    await readFile("evals/fixtures/raw/rgb-zh.json", "utf8"),
  ) as unknown[];
  const adapted = adaptRgbRows(rows, 2);

  assert.equal(adapted.cases[1]?.expectedAnswer, "第二个答案；第二个别名");
});
