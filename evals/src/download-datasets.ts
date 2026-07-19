import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  normalizeFinanceBenchRow,
  parseFinanceBenchRows,
  resolveFinanceBenchDocumentUrl,
  selectFinanceBenchRows,
} from "./adapters/financebench";
import { adaptRgbRows } from "./adapters/rgb";
import type { RagEvalCase } from "./schema";

export const SOURCES = {
  financebench:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl",
  financebenchDocuments:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl",
  rgbZh:
    "https://raw.githubusercontent.com/chen700564/RGB/master/data/zh_refine.json",
} as const;

const documentInformationSchema = z.object({
  doc_name: z.string().min(1),
  doc_link: z.string().url(),
});

function parseJsonLines(contents: string): unknown[] {
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function fetchResponse(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}) for ${url}`);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Download failed")) {
        throw error;
      }
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }
  throw new Error(`Download failed after 3 attempts for ${url}`, {
    cause: lastError,
  });
}

async function fetchText(url: string): Promise<string> {
  return (await fetchResponse(url)).text();
}

function toJsonLines(values: unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function makeUnanswerableCase(evalCase: RagEvalCase): RagEvalCase {
  return {
    ...evalCase,
    expectedAnswer: "",
    relevantDocumentIds: [],
    evidenceTexts: [],
    evidencePages: [],
    category: "unanswerable",
    answerable: false,
  };
}

function safeDocumentName(documentName: string): string {
  if (!/^[\w.-]+$/u.test(documentName)) {
    throw new Error(`Unsafe FinanceBench document name: ${documentName}`);
  }
  return documentName;
}

async function hasDownloadedFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const rawDirectory = path.resolve("evals/data/raw");
  const normalizedDirectory = path.resolve("evals/data/normalized");
  const financeCorpusDirectory = path.resolve(
    "evals/data/corpus/financebench",
  );
  const rgbCorpusDirectory = path.resolve("evals/data/corpus/rgb-zh");
  await Promise.all(
    [
      rawDirectory,
      normalizedDirectory,
      financeCorpusDirectory,
      rgbCorpusDirectory,
    ].map((directory) => mkdir(directory, { recursive: true })),
  );

  const [financeText, documentText, rgbText] = await Promise.all([
    fetchText(SOURCES.financebench),
    fetchText(SOURCES.financebenchDocuments),
    fetchText(SOURCES.rgbZh),
  ]);
  await Promise.all([
    writeFile(path.join(rawDirectory, "financebench.jsonl"), financeText),
    writeFile(
      path.join(rawDirectory, "financebench-documents.jsonl"),
      documentText,
    ),
    writeFile(path.join(rawDirectory, "rgb-zh.json"), rgbText),
  ]);

  const financeRows = parseFinanceBenchRows(parseJsonLines(financeText));
  const selectedFinanceRows = selectFinanceBenchRows(financeRows, 30);
  const selectedFinanceCases = selectedFinanceRows.map(
    normalizeFinanceBenchRow,
  );
  const selectedIds = new Set(
    selectedFinanceRows.map((row) => row.financebench_id),
  );
  const selectedDocuments = new Set(
    selectedFinanceRows.map((row) => row.doc_name),
  );
  const unanswerableCases = financeRows
    .toSorted((left, right) =>
      left.financebench_id.localeCompare(right.financebench_id),
    )
    .filter(
      (row) =>
        !selectedIds.has(row.financebench_id) &&
        !selectedDocuments.has(row.doc_name),
    )
    .slice(0, 5)
    .map(normalizeFinanceBenchRow)
    .map(makeUnanswerableCase);
  if (unanswerableCases.length !== 5) {
    throw new Error("Unable to derive five FinanceBench unanswerable cases");
  }

  const rgbSource = z.array(z.unknown()).parse(parseJsonLines(rgbText));
  const rgb = adaptRgbRows(rgbSource, 15);
  await Promise.all([
    writeFile(
      path.join(normalizedDirectory, "financebench.jsonl"),
      toJsonLines([...selectedFinanceCases, ...unanswerableCases]),
    ),
    writeFile(
      path.join(normalizedDirectory, "rgb-zh.jsonl"),
      toJsonLines(rgb.cases),
    ),
    ...rgb.documents.map((document) =>
      writeFile(
        path.join(rgbCorpusDirectory, `${document.id}.txt`),
        `${document.content}\n`,
      ),
    ),
  ]);

  const documentInformation = parseJsonLines(documentText).map((row, index) => {
    const result = documentInformationSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Invalid FinanceBench document row ${index}: ${result.error.message}`,
      );
    }
    return result.data;
  });
  const documentUrls = new Map(
    documentInformation.map((document) => [
      document.doc_name,
      resolveFinanceBenchDocumentUrl(document.doc_link),
    ]),
  );
  for (const documentName of selectedDocuments) {
    const url = documentUrls.get(documentName);
    if (url === undefined) {
      throw new Error(`No FinanceBench PDF URL for ${documentName}`);
    }
    const outputPath = path.join(
      financeCorpusDirectory,
      `${safeDocumentName(documentName)}.pdf`,
    );
    if (await hasDownloadedFile(outputPath)) {
      continue;
    }
    const contents = await (await fetchResponse(url)).arrayBuffer();
    await writeFile(outputPath, new Uint8Array(contents));
  }

  console.log(`FinanceBench cases: ${selectedFinanceCases.length}`);
  console.log(`RGB Chinese cases: ${rgb.cases.length}`);
  console.log(`Generated unanswerable cases: ${unanswerableCases.length}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
