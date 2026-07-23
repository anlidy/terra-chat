import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { DataUIPart } from "ai";
import baseline from "@/artifacts/perf-baseline.json";
import type { UIArtifact } from "@/components/artifact";
import {
  type ArtifactStreamState,
  reduceArtifactStreamBatch,
} from "@/lib/artifacts/stream-reducer";
import { parseMarkdownToDocument } from "@/lib/editor/markdown";
import type { CustomUIDataTypes } from "@/lib/types";

const RUNS = 5;
const DELTA_COUNT = 800;
const BATCH_SIZE = 16;

type Part = DataUIPart<CustomUIDataTypes>;

function percentile(values: number[], value: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)
  ];
}

function summarize(values: number[]) {
  return {
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    tasksAtLeast50Ms: values.filter((duration) => duration >= 50).length,
    tasksAtLeast200Ms: values.filter((duration) => duration >= 200).length,
  };
}

function initialArtifact(): UIArtifact {
  return {
    title: "Performance artifact",
    documentId: "00000000-0000-4000-8000-000000000001",
    kind: "text",
    content: "",
    isVisible: false,
    status: "streaming",
    hasAutoOpened: false,
    wasDismissed: false,
    boundingBox: { top: 0, left: 0, width: 0, height: 0 },
  };
}

const deltas = Array.from(
  { length: DELTA_COUNT },
  (_, index) => `token-${index} ${index % 12 === 0 ? "\n\n## Section\n\n" : ""}`
);

function measureLegacy() {
  const taskDurations: number[] = [];
  const totals: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    let content = "# Stress document\n\n";
    const startedAt = performance.now();
    for (const delta of deltas) {
      const taskStartedAt = performance.now();
      content += delta;
      parseMarkdownToDocument(content);
      taskDurations.push(performance.now() - taskStartedAt);
    }
    totals.push(performance.now() - startedAt);
  }
  return {
    commitsPerRun: DELTA_COUNT,
    total: summarize(totals),
    tasks: summarize(taskDurations),
  };
}

function measureBatched() {
  const taskDurations: number[] = [];
  const totals: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    let state: ArtifactStreamState = {
      artifact: initialArtifact(),
      suggestions: [],
    };
    const startedAt = performance.now();
    for (let index = 0; index < deltas.length; index += BATCH_SIZE) {
      const taskStartedAt = performance.now();
      const parts = deltas
        .slice(index, index + BATCH_SIZE)
        .map((data) => ({ type: "data-textDelta", data }) as Part);
      state = reduceArtifactStreamBatch(state, parts);
      parseMarkdownToDocument(state.artifact.content);
      taskDurations.push(performance.now() - taskStartedAt);
    }
    totals.push(performance.now() - startedAt);
  }
  return {
    commitsPerRun: Math.ceil(DELTA_COUNT / BATCH_SIZE),
    total: summarize(totals),
    tasks: summarize(taskDurations),
  };
}

function readInitialJavaScript() {
  const root = process.cwd();
  const manifestPath = path.join(
    root,
    ".next/server/app/(chat)/page_client-reference-manifest.js"
  );
  if (!fs.existsSync(manifestPath)) {
    return { available: false as const };
  }

  const manifest = fs.readFileSync(manifestPath, "utf8");
  const entryPattern = /"[^"]*\/app\/\(chat\)\/page":\[(.*?)\]/g;
  let match = entryPattern.exec(manifest);
  let lastMatch = match;
  while (match) {
    lastMatch = match;
    match = entryPattern.exec(manifest);
  }
  if (!lastMatch) {
    return { available: false as const };
  }

  const files = [...lastMatch[1].matchAll(/static\/chunks\/([^"\]]+)/g)].map(
    (chunkMatch) => chunkMatch[1]
  );
  const chunks = files.map((file) => {
    const filePath = path.join(root, ".next/static/chunks", file);
    return {
      file,
      bytes: fs.statSync(filePath).size,
      source: fs.readFileSync(filePath, "utf8"),
    };
  });
  const editorPattern = /prosemirror|codemirror|react-data-grid/;
  const bytes = chunks.reduce((total, chunk) => total + chunk.bytes, 0);
  return {
    available: true as const,
    bytes,
    baselineBytes: baseline.entryJavaScriptBytes,
    improvementPercent: Number(
      (
        ((baseline.entryJavaScriptBytes - bytes) /
          baseline.entryJavaScriptBytes) *
        100
      ).toFixed(1)
    ),
    editorDependenciesInEntry: chunks
      .filter((chunk) => editorPattern.test(chunk.source))
      .map((chunk) => chunk.file),
  };
}

const legacy = measureLegacy();
const batched = measureBatched();
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    runs: RUNS,
    deltaCount: DELTA_COUNT,
    batchSize: BATCH_SIZE,
    note: "Local synthetic CPU stress scenario; not production INP or Core Web Vitals.",
  },
  streamAndMarkdown: {
    legacy,
    batched,
    totalP50ImprovementPercent: Number(
      (
        ((legacy.total.p50Ms - batched.total.p50Ms) / legacy.total.p50Ms) *
        100
      ).toFixed(1)
    ),
  },
  initialRouteJavaScript: readInitialJavaScript(),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
