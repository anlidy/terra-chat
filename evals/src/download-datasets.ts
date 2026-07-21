import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  normalizeFinanceBenchRow,
  parseFinanceBenchRows,
  resolveFinanceBenchDocumentUrl,
  selectFinanceBenchRows,
} from "./adapters/financebench";
import {
  adaptRgbIntegrationRows,
  adaptRgbRows,
  adaptRgbUnanswerableRows,
} from "./adapters/rgb";
import type { RagEvalCase } from "./schema";

export const SOURCES = {
  financebench:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl",
  financebenchDocuments:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl",
  rgbZh:
    "https://raw.githubusercontent.com/chen700564/RGB/master/data/zh_refine.json",
  rgbZhIntegration:
    "https://raw.githubusercontent.com/chen700564/RGB/master/data/zh_int.json",
} as const;

const RGB_FACT_CASES = 15;
const RGB_INTEGRATION_CASES = 10;
const RGB_UNANSWERABLE_CASES = 5;

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

type FetchOptions = {
  attempts?: number;
  fetcher?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
};

async function fetchBody<T>(
  url: string,
  readBody: (response: Response) => Promise<T>,
  {
    attempts = 3,
    fetcher = fetch,
    retryDelayMs = 250,
    timeoutMs = 15_000,
  }: FetchOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}) for ${url}`);
      }
      return await readBody(response);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Download failed")
      ) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * retryDelayMs)
        );
      }
    }
  }
  throw new Error(`Download failed after ${attempts} attempts for ${url}`, {
    cause: lastError,
  });
}

export function fetchText(
  url: string,
  options?: FetchOptions
): Promise<string> {
  return fetchBody(url, (response) => response.text(), options);
}

function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  return fetchBody(url, (response) => response.arrayBuffer());
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

export async function downloadDatasets(): Promise<void> {
  const rawDirectory = path.resolve("evals/data/raw");
  const normalizedDirectory = path.resolve("evals/data/normalized");
  const financeCorpusDirectory = path.resolve("evals/data/corpus/financebench");
  const rgbCorpusDirectory = path.resolve("evals/data/corpus/rgb-zh");
  await Promise.all(
    [
      rawDirectory,
      normalizedDirectory,
      financeCorpusDirectory,
      rgbCorpusDirectory,
    ].map((directory) => mkdir(directory, { recursive: true }))
  );

  const [financeText, documentText, rgbText, rgbIntegrationText] =
    await Promise.all([
      fetchText(SOURCES.financebench),
      fetchText(SOURCES.financebenchDocuments),
      fetchText(SOURCES.rgbZh),
      fetchText(SOURCES.rgbZhIntegration),
    ]);
  await Promise.all([
    writeFile(path.join(rawDirectory, "financebench.jsonl"), financeText),
    writeFile(
      path.join(rawDirectory, "financebench-documents.jsonl"),
      documentText
    ),
    writeFile(path.join(rawDirectory, "rgb-zh.json"), rgbText),
    writeFile(
      path.join(rawDirectory, "rgb-zh-integration.jsonl"),
      rgbIntegrationText
    ),
  ]);

  // Parse document information early so we can filter out documents that are
  // known to be unavailable before selecting eval cases.
  const documentInformation = parseJsonLines(documentText).map((row, index) => {
    const result = documentInformationSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Invalid FinanceBench document row ${index}: ${result.error.message}`
      );
    }
    return result.data;
  });

  // Some FinanceBench PDF URLs point to decommissioned investor-relations
  // subdomains that no longer resolve via DNS.  Filter those document names
  // out of the row pool so we never select cases that depend on them.
  const DEAD_HOSTS = new Set(["johnsonandjohnson.gcs-web.com"]);
  const deadDocNames = new Set(
    documentInformation
      .filter((doc) => {
        try {
          return DEAD_HOSTS.has(new URL(doc.doc_link).hostname);
        } catch {
          return false;
        }
      })
      .map((doc) => doc.doc_name)
  );

  let financeRows = parseFinanceBenchRows(parseJsonLines(financeText));
  if (deadDocNames.size > 0) {
    const excludedCount = financeRows.filter((row) =>
      deadDocNames.has(row.doc_name)
    ).length;
    console.warn(
      `Excluding ${excludedCount} FinanceBench row(s) whose PDFs are no longer available`
    );
    financeRows = financeRows.filter((row) => !deadDocNames.has(row.doc_name));
  }

  const selectedFinanceRows = selectFinanceBenchRows(financeRows, 30);
  const selectedFinanceCases = selectedFinanceRows.map(
    normalizeFinanceBenchRow
  );
  const selectedIds = new Set(
    selectedFinanceRows.map((row) => row.financebench_id)
  );
  const selectedDocuments = new Set(
    selectedFinanceRows.map((row) => row.doc_name)
  );
  const unanswerableCases = financeRows
    .toSorted((left, right) =>
      left.financebench_id.localeCompare(right.financebench_id)
    )
    .filter(
      (row) =>
        !selectedIds.has(row.financebench_id) &&
        !selectedDocuments.has(row.doc_name)
    )
    .slice(0, 5)
    .map(normalizeFinanceBenchRow)
    .map(makeUnanswerableCase);
  if (unanswerableCases.length !== 5) {
    throw new Error("Unable to derive five FinanceBench unanswerable cases");
  }

  const rgbSource = z.array(z.unknown()).parse(parseJsonLines(rgbText));
  const rgbIntegrationSource = z
    .array(z.unknown())
    .parse(parseJsonLines(rgbIntegrationText));
  const rgbFacts = adaptRgbRows(rgbSource, RGB_FACT_CASES);
  const rgbIntegration = adaptRgbIntegrationRows(
    rgbIntegrationSource,
    RGB_INTEGRATION_CASES
  );
  const rgbUnanswerable = adaptRgbUnanswerableRows(
    rgbSource,
    RGB_FACT_CASES,
    RGB_UNANSWERABLE_CASES
  );
  if (rgbUnanswerable.length !== RGB_UNANSWERABLE_CASES) {
    throw new Error(
      `Unable to derive ${RGB_UNANSWERABLE_CASES} RGB Chinese unanswerable cases`
    );
  }
  const rgbCases = [
    ...rgbFacts.cases,
    ...rgbIntegration.cases,
    ...rgbUnanswerable,
  ];
  const rgbDocuments = [...rgbFacts.documents, ...rgbIntegration.documents];
  await Promise.all([
    writeFile(
      path.join(normalizedDirectory, "financebench.jsonl"),
      toJsonLines([...selectedFinanceCases, ...unanswerableCases])
    ),
    writeFile(
      path.join(normalizedDirectory, "rgb-zh.jsonl"),
      toJsonLines(rgbCases)
    ),
    ...rgbDocuments.map((document) =>
      writeFile(
        path.join(rgbCorpusDirectory, `${document.id}.txt`),
        `${document.content}\n`
      )
    ),
  ]);

  const documentUrls = new Map(
    documentInformation.map((document) => [
      document.doc_name,
      resolveFinanceBenchDocumentUrl(document.doc_link),
    ])
  );
  for (const documentName of selectedDocuments) {
    const url = documentUrls.get(documentName);
    if (url === undefined) {
      throw new Error(`No FinanceBench PDF URL for ${documentName}`);
    }
    const outputPath = path.join(
      financeCorpusDirectory,
      `${safeDocumentName(documentName)}.pdf`
    );
    if (await hasDownloadedFile(outputPath)) {
      continue;
    }
    try {
      const contents = await fetchArrayBuffer(url);
      await writeFile(outputPath, new Uint8Array(contents));
    } catch (error) {
      console.warn(
        `Skipping ${documentName}: download failed — ${(error as Error).message ?? String(error)}`
      );
    }
  }

  console.log(`FinanceBench cases: ${selectedFinanceCases.length}`);
  console.log(
    `RGB Chinese cases: ${rgbCases.length} (${rgbFacts.cases.length} fact, ${rgbIntegration.cases.length} integration, ${rgbUnanswerable.length} unanswerable)`
  );
  console.log(
    `Generated unanswerable cases: ${unanswerableCases.length + rgbUnanswerable.length}`
  );
}

if (require.main === module) {
  downloadDatasets().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
