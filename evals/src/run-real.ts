import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import {
  RAG_EMBEDDING_DIMENSIONS,
  RAG_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
} from "../../lib/rag/config";
import type { RetrievalStrategy } from "../../lib/rag/types";
import projectProfile from "../profiles/project.json";
import quickEnProfile from "../profiles/quick-en.json";
import quickZhProfile from "../profiles/quick-zh.json";
import {
  hashFiles,
  hashPath,
  hashText,
  resolveSourceRevision,
} from "./provenance";
import { parseEvalCases, type RagEvalCase } from "./schema";

const READY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_POLL_INTERVAL_MS = 1000;

type DatasetOption = "all" | "en" | "project" | "zh";
type EvaluationProfile = "full" | "quick";
type StrategyOption = "hybrid" | "hybrid-rerank" | "lexical" | "vector";

type RetrievalRun = {
  strategy: RetrievalStrategy;
  useRerank: boolean;
};

type RealEvaluationConfig = {
  answerModel?: string;
  dataset: DatasetOption;
  dryRun: boolean;
  ingestOnly: boolean;
  keepData: boolean;
  profile: EvaluationProfile;
  refresh: boolean;
  retrievalRuns: RetrievalRun[];
  reuseChatId?: string;
};

type DocumentStatus = {
  fileName: string;
  status: string;
};

export const REAL_RETRIEVAL_RUNS: readonly RetrievalRun[] = [
  { strategy: "vector", useRerank: false },
  { strategy: "lexical", useRerank: false },
  { strategy: "hybrid", useRerank: false },
  { strategy: "hybrid", useRerank: true },
];

const RETRIEVAL_RUNS_BY_OPTION: Record<StrategyOption, RetrievalRun> = {
  vector: { strategy: "vector", useRerank: false },
  lexical: { strategy: "lexical", useRerank: false },
  hybrid: { strategy: "hybrid", useRerank: false },
  "hybrid-rerank": { strategy: "hybrid", useRerank: true },
};

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function parseRetrievalRuns(value: string | undefined): RetrievalRun[] {
  if (value === undefined) {
    return [{ strategy: "hybrid", useRerank: false }];
  }
  if (value === "all") {
    return [...REAL_RETRIEVAL_RUNS];
  }

  const options = value.split(",");
  const unsupported = options.find(
    (option) => !(option in RETRIEVAL_RUNS_BY_OPTION)
  );
  if (unsupported !== undefined || options.length === 0) {
    throw new Error(
      `Unsupported real evaluation strategy: ${unsupported ?? value}`
    );
  }
  return [...new Set(options)].map(
    (option) => RETRIEVAL_RUNS_BY_OPTION[option as StrategyOption]
  );
}

export function parseRealEvaluationConfig(
  args: string[]
): RealEvaluationConfig {
  const options = args.filter((argument) => argument !== "--");
  const flags = new Set([
    "--dry-run",
    "--ingest-only",
    "--keep-data",
    "--refresh",
  ]);
  const prefixes = [
    "--dataset=",
    "--profile=",
    "--reuse-chat=",
    "--strategies=",
    "--answer-model=",
  ];
  const unknown = options.find(
    (argument) =>
      !flags.has(argument) &&
      !prefixes.some((prefix) => argument.startsWith(prefix))
  );
  if (unknown !== undefined) {
    throw new Error(`Unknown real evaluation option: ${unknown}`);
  }

  const profile = optionValue(options, "profile") ?? "quick";
  if (profile !== "quick" && profile !== "full") {
    throw new Error("--profile must be quick or full");
  }
  const dataset = optionValue(options, "dataset") ?? "all";
  if (
    dataset !== "en" &&
    dataset !== "zh" &&
    dataset !== "project" &&
    dataset !== "all"
  ) {
    throw new Error("--dataset must be en, zh, project, or all");
  }
  const ingestOnly = options.includes("--ingest-only");
  const reuseChatId = optionValue(options, "reuse-chat");
  if (ingestOnly && reuseChatId !== undefined) {
    throw new Error("--ingest-only cannot be combined with --reuse-chat");
  }

  return {
    answerModel: optionValue(options, "answer-model"),
    dataset,
    dryRun: options.includes("--dry-run"),
    ingestOnly,
    keepData: options.includes("--keep-data"),
    profile,
    refresh: options.includes("--refresh"),
    retrievalRuns: parseRetrievalRuns(optionValue(options, "strategies")),
    reuseChatId,
  };
}

export function selectProfileCases<T extends { id: string }>(
  cases: T[],
  profile: EvaluationProfile,
  quickCaseIds: string[]
): T[] {
  if (profile === "full") {
    return cases;
  }

  const selectedIds = new Set(quickCaseIds);
  const missing = quickCaseIds.filter(
    (caseId) => !cases.some((evalCase) => evalCase.id === caseId)
  );
  if (missing.length > 0) {
    throw new Error(
      `Quick profile references missing cases: ${missing.join(", ")}`
    );
  }
  return cases.filter((evalCase) => selectedIds.has(evalCase.id));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForDocumentsReady({
  expectedCount,
  getDocuments,
  timeoutMs = READY_TIMEOUT_MS,
  pollIntervalMs = READY_POLL_INTERVAL_MS,
}: {
  expectedCount: number;
  getDocuments: () => Promise<DocumentStatus[]>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const documents = await getDocuments();
    const failed = documents.find((document) => document.status === "error");
    if (failed !== undefined) {
      throw new Error(`Document ingestion failed: ${failed.fileName}`);
    }
    if (
      documents.length === expectedCount &&
      documents.every((document) => document.status === "ready")
    ) {
      return;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${expectedCount} evaluation documents to become ready`
  );
}

function parseJsonLines(contents: string): unknown[] {
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const file = await stat(filePath);
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}

type DatasetKey = Exclude<DatasetOption, "all">;

type CorpusFile = {
  fileName: string;
  filePath: string;
  fileType: string;
};

type DatasetPlan = {
  cases: RagEvalCase[];
  casesPath: string;
  corpusFiles: CorpusFile[];
  corpusPath: string;
  key: DatasetKey;
  reportName: string;
};

const DATASET_DEFINITIONS: Record<
  DatasetKey,
  {
    casesPath: string;
    corpusPath: string;
    quickCaseIds: string[];
  }
> = {
  en: {
    casesPath: "evals/data/normalized/financebench.jsonl",
    corpusPath: "evals/data/corpus/financebench",
    quickCaseIds: quickEnProfile.caseIds,
  },
  zh: {
    casesPath: "evals/data/normalized/rgb-zh.jsonl",
    corpusPath: "evals/data/corpus/rgb-zh",
    quickCaseIds: quickZhProfile.caseIds,
  },
  project: {
    casesPath: "evals/fixtures/project/cases.jsonl",
    corpusPath: "evals/fixtures/project/corpus",
    quickCaseIds: projectProfile.caseIds,
  },
};

function selectedDatasetKeys(dataset: DatasetOption): DatasetKey[] {
  return dataset === "all" ? ["en", "zh", "project"] : [dataset];
}

export function expectedCorpusFileNames(
  dataset: DatasetKey,
  cases: RagEvalCase[]
): string[] {
  if (dataset === "en") {
    return [
      ...new Set(
        cases.flatMap((evalCase) =>
          evalCase.relevantDocumentIds.map((id) => `${id}.pdf`)
        )
      ),
    ].toSorted();
  }

  if (dataset === "project") {
    return [
      ...new Set(
        cases.flatMap((evalCase) =>
          evalCase.relevantDocumentIds.map((id) => `${id}.txt`)
        )
      ),
    ].toSorted();
  }

  return cases
    .filter((evalCase) => evalCase.answerable)
    .flatMap((evalCase) => [
      `${evalCase.id}-positive-0.txt`,
      `${evalCase.id}-positive-1.txt`,
      `${evalCase.id}-negative-0.txt`,
      `${evalCase.id}-negative-1.txt`,
      `${evalCase.id}-negative-2.txt`,
    ])
    .toSorted();
}

async function loadDatasetPlan(
  key: DatasetKey,
  profile: EvaluationProfile
): Promise<DatasetPlan> {
  const definition = DATASET_DEFINITIONS[key];
  if (!(await hasNonEmptyFile(definition.casesPath))) {
    throw new Error(`Evaluation cases are missing: ${definition.casesPath}`);
  }
  const allCases = parseEvalCases(
    parseJsonLines(await readFile(definition.casesPath, "utf8"))
  );
  const cases = selectProfileCases(allCases, profile, definition.quickCaseIds);
  const corpusFiles = expectedCorpusFileNames(key, cases).map((fileName) => ({
    fileName,
    filePath: path.join(definition.corpusPath, fileName),
    fileType: path.extname(fileName).slice(1).toLowerCase(),
  }));
  return {
    cases,
    casesPath: definition.casesPath,
    corpusFiles,
    corpusPath: definition.corpusPath,
    key,
    reportName:
      key === "project"
        ? "project-scenarios"
        : `${key === "en" ? "financebench" : "rgb-zh"}-${profile}`,
  };
}

async function missingCorpusFiles(plans: DatasetPlan[]): Promise<string[]> {
  const checks = await Promise.all(
    plans.flatMap((plan) =>
      plan.corpusFiles.map(async (file) => ({
        filePath: file.filePath,
        exists: await hasNonEmptyFile(file.filePath),
      }))
    )
  );
  return checks.filter((file) => !file.exists).map((file) => file.filePath);
}

async function loadSelectedDatasetPlans(
  config: RealEvaluationConfig
): Promise<DatasetPlan[]> {
  const keys = selectedDatasetKeys(config.dataset);
  const casesMissing = await Promise.all(
    keys.map(
      async (key) =>
        !(await hasNonEmptyFile(DATASET_DEFINITIONS[key].casesPath))
    )
  );
  let downloaded = false;
  if (!config.dryRun && (config.refresh || casesMissing.some(Boolean))) {
    console.log("[eval:rag] Downloading evaluation datasets...");
    const { downloadDatasets } = await import("./download-datasets");
    await downloadDatasets();
    downloaded = true;
  }

  let plans = await Promise.all(
    keys.map((key) => loadDatasetPlan(key, config.profile))
  );
  let missing = await missingCorpusFiles(plans);
  if (!config.dryRun && missing.length > 0 && !downloaded) {
    console.log("[eval:rag] Downloading missing evaluation corpus files...");
    const { downloadDatasets } = await import("./download-datasets");
    await downloadDatasets();
    plans = await Promise.all(
      keys.map((key) => loadDatasetPlan(key, config.profile))
    );
    missing = await missingCorpusFiles(plans);
  }
  if (!config.dryRun && missing.length > 0) {
    throw new Error(`Evaluation corpus is incomplete: ${missing.join(", ")}`);
  }
  return plans;
}

function validateEnvironment(config: RealEvaluationConfig): void {
  const required = new Set(["POSTGRES_URL"]);
  const ingesting = config.reuseChatId === undefined;
  if (
    ingesting ||
    config.retrievalRuns.some((run) => run.strategy !== "lexical")
  ) {
    required.add("ZHIPU_API_KEY");
  }
  if (ingesting && selectedDatasetKeys(config.dataset).includes("en")) {
    required.add("LLAMA_CLOUD_API_KEY");
  }
  const missing = [...required].filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables for real RAG evaluation: ${missing.join(", ")}`
    );
  }
}

function arrayBuffer(contents: Buffer): ArrayBuffer {
  return Uint8Array.from(contents).buffer;
}

async function evaluationFileUrl(file: CorpusFile): Promise<string> {
  const fingerprint = hashText(
    [
      await hashPath(file.filePath),
      RAG_PIPELINE_VERSION,
      RAG_EMBEDDING_MODEL,
      String(RAG_EMBEDDING_DIMENSIONS),
    ].join("\0")
  );
  return `eval://${encodeURIComponent(file.fileName)}#${fingerprint}`;
}

export async function runRealEvaluation(
  config: RealEvaluationConfig
): Promise<void> {
  const evaluationStartedAt = Date.now();
  let phase = "environment validation";
  validateEnvironment(config);

  phase = "dataset planning";
  const datasetPlans = await loadSelectedDatasetPlans(config);
  const missingBeforeRun = await missingCorpusFiles(datasetPlans);
  const selectedDocuments = [
    ...new Map(
      datasetPlans
        .flatMap((plan) => plan.corpusFiles)
        .map((file) => [file.fileName, file])
    ).values(),
  ];
  const retrievalRunCount = config.ingestOnly
    ? 0
    : datasetPlans.length * config.retrievalRuns.length;
  if (config.dryRun) {
    console.log("[eval:rag] Dry run passed");
    console.log(
      `[eval:rag] Profile: ${config.profile}, datasets: ${datasetPlans.map((plan) => plan.key).join(",")}`
    );
    for (const plan of datasetPlans) {
      console.log(
        `[eval:rag] Dataset ${plan.key}: ${plan.cases.length} cases, ${plan.corpusFiles.length} documents`
      );
    }
    console.log(
      `[eval:rag] Dataset action: ${config.refresh || missingBeforeRun.length > 0 ? `download (${missingBeforeRun.length} missing files)` : "reuse local files"}`
    );
    console.log(`[eval:rag] Documents to ingest: ${selectedDocuments.length}`);
    console.log(`[eval:rag] Retrieval runs: ${retrievalRunCount}`);
    if (config.reuseChatId !== undefined) {
      console.log(`[eval:rag] Reusing chat: ${config.reuseChatId}`);
    }
    return;
  }

  phase = "database migration";
  const { runMigrate } = await import("../../lib/db/migrate");
  await runMigrate();
  const expectedFileUrls = new Map(
    await Promise.all(
      selectedDocuments.map(
        async (file) => [file.fileName, await evaluationFileUrl(file)] as const
      )
    )
  );
  console.log(
    `[eval:rag] Starting ${config.profile} evaluation with ${selectedDocuments.length} documents and ${retrievalRunCount} retrieval runs`
  );
  console.log(
    `[eval:rag] Embedding provider: zhipu/${RAG_EMBEDDING_MODEL}:${RAG_EMBEDDING_DIMENSIONS}`
  );
  const queries = await import("../../lib/db/queries");

  let userId: string | undefined;
  let chatId: string | undefined;
  const resourceIds = new Map<string, string>();
  const reusingChat = config.reuseChatId !== undefined;

  try {
    phase = "temporary data setup";
    const { processDocumentResource } = await import("../../lib/rag/ingest");
    const { runRetrieval } = await import("./run-retrieval");
    let evaluationChatId: string;

    if (config.reuseChatId === undefined) {
      const [evaluationUser] = await queries.createGuestUser();
      if (evaluationUser === undefined) {
        throw new Error("Failed to create the temporary evaluation user");
      }
      userId = evaluationUser.id;
      evaluationChatId = randomUUID();
      chatId = evaluationChatId;
      await queries.saveChat({
        id: evaluationChatId,
        userId,
        title: `RAG evaluation ${config.profile} ${new Date().toISOString()}`,
        visibility: "private",
      });

      for (const [index, file] of selectedDocuments.entries()) {
        phase = `document ingestion ${index + 1}/${selectedDocuments.length} (${file.fileName})`;
        const documentStartedAt = Date.now();
        console.log(
          `[eval:rag] Ingesting ${index + 1}/${selectedDocuments.length}: ${file.fileName}`
        );
        const resource = await queries.insertDocumentResource({
          chatId: evaluationChatId,
          fileName: file.fileName,
          fileUrl: expectedFileUrls.get(file.fileName) as string,
          fileType: file.fileType,
        });
        resourceIds.set(file.fileName, resource.id);
        await processDocumentResource({
          resourceId: resource.id,
          chatId: evaluationChatId,
          fileName: file.fileName,
          fileType: file.fileType,
          buffer: arrayBuffer(await readFile(file.filePath)),
        });
        console.log(
          `[eval:rag] Ingested ${index + 1}/${selectedDocuments.length}: ${file.fileName} in ${Date.now() - documentStartedAt}ms`
        );
      }

      phase = "document readiness check";
      await waitForDocumentsReady({
        expectedCount: selectedDocuments.length,
        getDocuments: () =>
          queries.getDocumentsByChat({ chatId: evaluationChatId }),
      });
    } else {
      evaluationChatId = config.reuseChatId;
      chatId = evaluationChatId;
      const existingChat = await queries.getChatById({ id: evaluationChatId });
      if (existingChat === null) {
        throw new Error(`Evaluation chat not found: ${evaluationChatId}`);
      }
      const existingDocuments = await queries.getDocumentsByChat({
        chatId: evaluationChatId,
      });
      for (const file of selectedDocuments) {
        const document = existingDocuments.find(
          (candidate) => candidate.fileName === file.fileName
        );
        if (document === undefined) {
          throw new Error(
            `Reusable chat ${evaluationChatId} is missing ${file.fileName}`
          );
        }
        if (document.status !== "ready") {
          throw new Error(
            `Reusable chat document is not ready: ${file.fileName} (${document.status})`
          );
        }
        if (document.fileUrl !== expectedFileUrls.get(file.fileName)) {
          throw new Error(
            `Reusable chat document fingerprint is stale: ${file.fileName}`
          );
        }
        resourceIds.set(file.fileName, document.id);
      }
      console.log(
        `[eval:rag] Reusing ${selectedDocuments.length} ready documents from chat ${evaluationChatId}`
      );
    }

    if (config.ingestOnly) {
      console.log(
        `[eval:rag] Ingestion completed; reuse with --reuse-chat=${evaluationChatId}`
      );
      return;
    }

    let errorCount = 0;
    let retrievalIndex = 0;
    for (const plan of datasetPlans) {
      const documentIds = plan.corpusFiles.map((file) => {
        const resourceId = resourceIds.get(file.fileName);
        if (resourceId === undefined) {
          throw new Error(`Missing resource id for ${file.fileName}`);
        }
        return resourceId;
      });
      for (const retrievalRun of config.retrievalRuns) {
        retrievalIndex += 1;
        const runName = `${plan.key}:${retrievalRun.strategy}/${retrievalRun.useRerank ? "rerank" : "no-rerank"}`;
        phase = `retrieval run ${retrievalIndex}/${retrievalRunCount} (${runName})`;
        const retrievalStartedAt = Date.now();
        console.log(
          `[eval:rag] Running retrieval ${retrievalIndex}/${retrievalRunCount}: ${runName}`
        );
        const report = await runRetrieval({
          caseIds: plan.cases.map((evalCase) => evalCase.id),
          casesPath: plan.casesPath,
          chatId: evaluationChatId,
          corpusFiles: plan.corpusFiles.map((file) => file.filePath),
          corpusPath: plan.corpusPath,
          dataset: plan.reportName,
          documentIds,
          strategy: retrievalRun.strategy,
          useRerank: retrievalRun.useRerank,
          k: 5,
        });
        errorCount += report.summary.errorCount;
        console.log(
          `[eval:rag] Finished retrieval ${retrievalIndex}/${retrievalRunCount}: ${runName} in ${Date.now() - retrievalStartedAt}ms (caseErrors=${report.summary.errorCount})`
        );
      }
    }
    if (errorCount > 0) {
      throw new Error(
        `Real RAG evaluation completed with ${errorCount} retrieval case errors`
      );
    }
    if (config.answerModel !== undefined) {
      phase = `answer evaluation (${config.answerModel})`;
      const { runAnswerEvaluation } = await import("./run-answer");
      for (const plan of datasetPlans) {
        const documentIds = plan.corpusFiles.map((file) =>
          resourceIds.get(file.fileName)
        );
        if (documentIds.some((id) => id === undefined)) {
          throw new Error(
            `Missing resource id for answer evaluation: ${plan.key}`
          );
        }
        await runAnswerEvaluation({
          answerModel: config.answerModel,
          cases: plan.cases,
          chatId: evaluationChatId,
          documentIds: documentIds as string[],
          dataset: plan.reportName,
          caseSetHash: hashText(
            `${plan.cases.map((evalCase) => JSON.stringify(evalCase)).join("\n")}\n`
          ),
          corpusHash: await hashFiles(
            plan.corpusFiles.map((file) => file.filePath),
            plan.corpusPath
          ),
          sourceRevision: resolveSourceRevision(),
        });
      }
    }
    console.log(
      `[eval:rag] Real evaluation completed in ${Date.now() - evaluationStartedAt}ms`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[eval:rag] Failed during ${phase} after ${Date.now() - evaluationStartedAt}ms: ${message}`
    );
    throw error;
  } finally {
    try {
      if (reusingChat) {
        console.log(`[eval:rag] Reused chat preserved: ${chatId}`);
      } else if (config.keepData || config.ingestOnly) {
        console.log(
          `[eval:rag] Keeping temporary data: user=${userId ?? "not-created"}, chat=${chatId ?? "not-created"}`
        );
      } else {
        const cleanupStartedAt = Date.now();
        if (chatId !== undefined) {
          await queries.deleteChatById({ id: chatId });
        }
        if (userId !== undefined) {
          await queries.deleteUserById({ id: userId });
        }
        console.log(
          `[eval:rag] Temporary database data cleaned up in ${Date.now() - cleanupStartedAt}ms`
        );
      }
    } finally {
      await queries.closeDatabaseConnection();
    }
  }
}

if (require.main === module) {
  loadEnv({ path: ".env.local" });
  loadEnv();
  runRealEvaluation(parseRealEvaluationConfig(process.argv.slice(2))).catch(
    (error: unknown) => {
      console.error("[eval:rag] Fatal error:", error);
      process.exitCode = 1;
    }
  );
}
