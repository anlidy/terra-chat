# RAG Evaluation-First Implementation Plan

> **Status**: Implemented
>
> **Scope**: Execution plan for the evaluation-first RAG design
>
> **Last reviewed**: 2026-07-19

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible RAG retrieval benchmark and route proactive and tool-based document searches through one accurately named hybrid retrieval pipeline.

**Architecture:** A root-level `evals/` package owns normalized public-dataset adapters, deterministic retrieval metrics, smoke fixtures, and reports. Application retrieval is split into pure fusion logic, database-specific vector/lexical searches, and one orchestration service used by both chat entry points.

**Tech Stack:** TypeScript, Node test runner through `tsx --test`, Zod, PostgreSQL full-text search, pgvector, existing DashScope reranker.

---

## File Map

**Create**

- `evals/src/schema.ts` — normalized evaluation case/result schemas and JSONL parsing.
- `evals/src/metrics.ts` — Recall@K, MRR, NDCG@K, latency, and relevance matching.
- `evals/src/report.ts` — aggregate JSON/Markdown report construction.
- `evals/src/run-smoke.ts` — offline smoke evaluator.
- `evals/src/run-retrieval.ts` — credentialed retrieval benchmark against an evaluation chat.
- `evals/src/download-datasets.ts` — explicit public dataset downloader.
- `evals/src/adapters/financebench.ts` — FinanceBench normalization and deterministic selection.
- `evals/src/adapters/rgb.ts` — RGB Chinese normalization and positive/negative corpus extraction.
- `evals/datasets/financebench.manifest.json` — source, license note, selection rules.
- `evals/datasets/rgb-zh.manifest.json` — source, license, selection rules.
- `evals/fixtures/smoke-cases.jsonl` — tiny committed evaluation cases.
- `evals/fixtures/smoke-results.json` — deterministic ranked results.
- `evals/fixtures/raw/financebench.jsonl` — adapter test source row.
- `evals/fixtures/raw/rgb-zh.json` — adapter test source row.
- `evals/results/.gitkeep` — retain the generated-report directory.
- `evals/tests/schema.test.ts` — schema/parser tests.
- `evals/tests/metrics.test.ts` — metric/relevance tests.
- `evals/tests/adapters.test.ts` — public dataset adapter tests.
- `evals/tests/report.test.ts` — report snapshot assertions.
- `evals/tests/retrieval-routing.test.ts` — architectural contract for shared retrieval.
- `evals/README.md` — commands, dataset attribution, interpretation.
- `lib/rag/types.ts` — stable retrieval result types.
- `lib/rag/fusion.ts` — pure RRF implementation.
- `lib/rag/fusion.test.ts` — RRF behavior tests.
- `lib/rag/retrieve.ts` — shared retrieval orchestration service.
- `lib/rag/retrieve.test.ts` — orchestration dependency tests.

**Modify**

- `package.json` — unit-test and evaluation scripts.
- `.gitignore` — local public datasets and generated reports.
- `lib/db/queries.ts` — return stable IDs/scores and rename lexical retrieval.
- `lib/rag/hybrid-search.ts` — consume pure fusion and normalized results.
- `lib/rag/rerank.ts` — preserve result metadata while reranking.
- `lib/ai/tools/rag/retrieve-documents.ts` — use shared retrieval service.
- `app/(chat)/api/chat/route.ts` — use shared retrieval service proactively.
- `lib/ai/prompts/dynamic-messages.ts` — accept normalized retrieval results.
- `lib/rag/README.md` — describe PostgreSQL lexical search accurately.
- `README.md` — document benchmark and baseline table workflow.
- `lib/ai/models.test.ts` — narrow mock finish-reason literals if required for clean type checking.

### Task 1: Unit-Test Harness and Evaluation Schema

**Files:**
- Create: `evals/src/schema.ts`
- Create: `evals/tests/schema.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a failing schema test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseEvalCases } from "../src/schema";

test("parseEvalCases accepts answerable and unanswerable cases", () => {
  const cases = parseEvalCases([
    {
      id: "answerable-1",
      query: "What is the policy?",
      expectedAnswer: "Seven days",
      relevantDocumentIds: ["handbook"],
      evidenceTexts: ["Submit within seven days"],
      evidencePages: [12],
      category: "fact",
      language: "en",
      answerable: true,
    },
    {
      id: "unanswerable-1",
      query: "What is the launch date?",
      expectedAnswer: "",
      relevantDocumentIds: [],
      evidenceTexts: [],
      evidencePages: [],
      category: "unanswerable",
      language: "en",
      answerable: false,
    },
  ]);

  assert.equal(cases.length, 2);
});

test("parseEvalCases rejects duplicate ids", () => {
  const row = {
    id: "duplicate",
    query: "问题",
    expectedAnswer: "答案",
    relevantDocumentIds: ["doc"],
    evidenceTexts: ["答案"],
    evidencePages: [],
    category: "fact",
    language: "zh" as const,
    answerable: true,
  };
  assert.throws(() => parseEvalCases([row, row]), /duplicate/i);
});
```

- [ ] **Step 2: Add the test command and verify failure**

Add to `package.json`:

```json
"test:unit": "tsx --test evals/tests/*.test.ts lib/rag/*.test.ts"
```

Run: `pnpm exec tsx --test evals/tests/schema.test.ts`

Expected: FAIL because `evals/src/schema.ts` does not exist.

- [ ] **Step 3: Implement the normalized schemas**

```ts
import { z } from "zod";

export const ragEvalCaseSchema = z
  .object({
    id: z.string().min(1),
    query: z.string().trim().min(1),
    expectedAnswer: z.string(),
    relevantDocumentIds: z.array(z.string().min(1)),
    evidenceTexts: z.array(z.string().min(1)),
    evidencePages: z.array(z.number().int().nonnegative()),
    category: z.string().min(1),
    language: z.enum(["en", "zh"]),
    answerable: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.answerable && value.relevantDocumentIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "answerable cases require a relevant document",
        path: ["relevantDocumentIds"],
      });
    }
  });

export const evalRetrievedChunkSchema = z.object({
  chunkId: z.string().min(1),
  resourceId: z.string().min(1),
  content: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  pageNumber: z.number().int().nonnegative().nullable(),
});

export type RagEvalCase = z.infer<typeof ragEvalCaseSchema>;
export type EvalRetrievedChunk = z.infer<typeof evalRetrievedChunkSchema>;

export function parseEvalCases(input: unknown[]): RagEvalCase[] {
  const cases = input.map((row) => ragEvalCaseSchema.parse(row));
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate evaluation case id: ${item.id}`);
    }
    ids.add(item.id);
  }
  return cases;
}
```

- [ ] **Step 4: Run schema tests**

Run: `pnpm exec tsx --test evals/tests/schema.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json evals/src/schema.ts evals/tests/schema.test.ts
git commit -m "test: add RAG evaluation schema"
```

### Task 2: Deterministic Retrieval Metrics

**Files:**
- Create: `evals/src/metrics.ts`
- Create: `evals/tests/metrics.test.ts`

- [ ] **Step 1: Write failing metric tests**

Tests must assert the exact known values:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRetrievalCase,
  ndcgAtK,
  percentile,
  reciprocalRank,
} from "../src/metrics";

test("reciprocalRank returns the reciprocal of the first hit", () => {
  assert.equal(reciprocalRank([false, true, true]), 0.5);
  assert.equal(reciprocalRank([false, false]), 0);
});

test("ndcgAtK rewards an ideal ranking", () => {
  assert.equal(ndcgAtK([true, true, false], 3), 1);
});

test("evaluateRetrievalCase matches document and evidence page", () => {
  const result = evaluateRetrievalCase({
    evalCase: {
      id: "case-1",
      query: "policy",
      expectedAnswer: "seven days",
      relevantDocumentIds: ["handbook"],
      evidenceTexts: ["submit within seven days"],
      evidencePages: [12],
      category: "fact",
      language: "en",
      answerable: true,
    },
    retrieved: [
      {
        chunkId: "wrong-1",
        resourceId: "other",
        content: "noise",
        chunkIndex: 0,
        fileName: "other.pdf",
        pageNumber: 1,
      },
      {
        chunkId: "right-1",
        resourceId: "handbook",
        content: "Submit within seven days.",
        chunkIndex: 4,
        fileName: "handbook.pdf",
        pageNumber: 12,
      },
    ],
    latencyMs: 25,
    k: 5,
  });
  assert.equal(result.recallAtK, 1);
  assert.equal(result.mrr, 0.5);
});

test("percentile uses nearest-rank interpolation", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm exec tsx --test evals/tests/metrics.test.ts`

Expected: FAIL because the metrics module is missing.

- [ ] **Step 3: Implement pure metric functions**

Implement `normalizeEvidenceText`, `isRelevant`, `reciprocalRank`, `ndcgAtK`, `percentile`, and `evaluateRetrievalCase`. Relevance must first require `resourceId` to be in `relevantDocumentIds`, then accept either a gold page match or normalized evidence containment. Unanswerable cases return `falseRetrieval = retrieved.length > 0` and do not contribute to answerable Recall/MRR/NDCG denominators.

Use binary relevance and DCG gain `1 / Math.log2(rank + 1)`. Use a deterministic text normalizer:

```ts
function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
```

Stable gold document IDs may match either `resourceId` or the retrieved `fileName` with its final extension removed. This lets public benchmark IDs such as `3M_2018_10K` match locally ingested files such as `3M_2018_10K.pdf` without storing environment-specific database UUIDs in fixtures.

- [ ] **Step 4: Run metric tests**

Run: `pnpm exec tsx --test evals/tests/metrics.test.ts`

Expected: all metric tests pass.

- [ ] **Step 5: Commit**

```bash
git add evals/src/metrics.ts evals/tests/metrics.test.ts
git commit -m "feat: add deterministic RAG retrieval metrics"
```

### Task 3: Offline Smoke Runner and Reports

**Files:**
- Create: `evals/fixtures/smoke-cases.jsonl`
- Create: `evals/fixtures/smoke-results.json`
- Create: `evals/src/report.ts`
- Create: `evals/src/run-smoke.ts`
- Create: `evals/tests/report.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add a failing report test**

Create two answerable results and one unanswerable result, then assert:

```ts
const report = buildRetrievalReport(results, {
  dataset: "smoke",
  strategy: "fixture",
  k: 5,
});
assert.equal(report.summary.caseCount, 3);
assert.equal(report.summary.answerableCount, 2);
assert.match(renderMarkdownReport(report), /Recall@5/);
assert.match(renderMarkdownReport(report), /NDCG@5/);
```

- [ ] **Step 2: Verify report test fails**

Run: `pnpm exec tsx --test evals/tests/report.test.ts`

Expected: FAIL because the report module is missing.

- [ ] **Step 3: Implement report aggregation**

`buildRetrievalReport` must average Recall/MRR/NDCG over answerable cases only, calculate unanswerable false-retrieval rate separately, and report P50/P95 latency. `renderMarkdownReport` must include metadata, a summary table, and a failed-case table.

- [ ] **Step 4: Add smoke fixtures and runner**

`run-smoke.ts` must:

1. read JSONL cases and JSON ranked results from `evals/fixtures`;
2. validate both with Zod;
3. evaluate each case at K=5;
4. create `evals/results` if absent;
5. write `smoke-latest.json` and `smoke-latest.md`;
6. print the Markdown summary to stdout.

Add scripts:

```json
"eval:rag:smoke": "tsx evals/src/run-smoke.ts",
"eval:rag:download": "tsx evals/src/download-datasets.ts"
```

Add to `.gitignore`:

```gitignore
/evals/data/
/evals/results/*
!/evals/results/.gitkeep
```

- [ ] **Step 5: Run tests and the smoke evaluator**

Run: `pnpm exec tsx --test evals/tests/report.test.ts && pnpm eval:rag:smoke`

Expected: tests pass; stdout includes Recall@5, MRR, NDCG@5, and P95; both report files exist.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore evals/fixtures evals/src/report.ts evals/src/run-smoke.ts evals/tests/report.test.ts evals/results/.gitkeep
git commit -m "feat: add offline RAG smoke evaluation"
```

### Task 4: Public Dataset Download and Adapters

**Files:**
- Create: `evals/src/download-datasets.ts`
- Create: `evals/src/adapters/financebench.ts`
- Create: `evals/src/adapters/rgb.ts`
- Create: `evals/datasets/financebench.manifest.json`
- Create: `evals/datasets/rgb-zh.manifest.json`
- Create: `evals/fixtures/raw/financebench.jsonl`
- Create: `evals/fixtures/raw/rgb-zh.json`
- Create: `evals/tests/adapters.test.ts`

- [ ] **Step 1: Write failing adapter tests**

FinanceBench assertions:

```ts
const [item] = adaptFinanceBenchRows(rows, 30);
assert.equal(item.language, "en");
assert.equal(item.relevantDocumentIds[0], rows[0].doc_name);
assert.deepEqual(item.evidencePages, [59]);
```

RGB assertions:

```ts
const adapted = adaptRgbRows(rows, 15);
assert.equal(adapted.cases[0].language, "zh");
assert.ok(adapted.documents.some((doc) => doc.relevant));
assert.ok(adapted.documents.some((doc) => !doc.relevant));
```

- [ ] **Step 2: Verify adapter tests fail**

Run: `pnpm exec tsx --test evals/tests/adapters.test.ts`

Expected: FAIL because adapter modules are missing.

- [ ] **Step 3: Implement FinanceBench adapter**

Parse JSONL fields `financebench_id`, `question`, `answer`, `doc_name`, `question_type`, `question_reasoning`, and `evidence[]`. Select 30 cases deterministically by sorting by `financebench_id` and round-robin sampling across `question_reasoning`. Preserve zero-indexed evidence pages exactly and document the convention.

- [ ] **Step 4: Implement RGB adapter**

Parse `id`, `query`, `answer`, `positive`, and `negative`. Select the first 15 rows after stable numeric ID sorting. Keep the first two positive and first three negative passages per case so the local corpus remains bounded. Assign deterministic passage IDs of `rgb-zh-{caseId}-positive-{index}` and `rgb-zh-{caseId}-negative-{index}`. Each normalized case lists the two retained positive IDs as relevant documents.

- [ ] **Step 5: Add explicit downloader and manifests**

Use these pinned upstream files:

```ts
const SOURCES = {
  financebench:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl",
  financebenchDocuments:
    "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl",
  rgbZh:
    "https://raw.githubusercontent.com/chen700564/RGB/master/data/zh_refine.json",
};
```

The downloader writes raw files under `evals/data/raw`, normalized cases under `evals/data/normalized`, selected FinanceBench PDFs under `evals/data/corpus/financebench`, and RGB passage documents under `evals/data/corpus/rgb-zh`. Join selected FinanceBench cases with `financebench_document_information.jsonl` and download each unique `doc_link` as `<doc_name>.pdf`. It must fail on non-2xx responses and never run as part of unit tests or install scripts.

Generate the five unanswerable cases from the next five stably sorted FinanceBench rows whose `doc_name` is not in the selected 30-case corpus. Do not download those five source PDFs; clear their expected answer/evidence/relevant-document arrays and label them `answerable: false` and `category: "unanswerable"`.

Manifest license notes:

- FinanceBench: open-source 150-case sample; retain upstream attribution and links; do not assert a license that upstream does not publish.
- RGB: CC BY-NC-SA 4.0, noncommercial use, attribution required.

- [ ] **Step 6: Run adapter tests**

Run: `pnpm exec tsx --test evals/tests/adapters.test.ts`

Expected: all adapter tests pass without network access.

- [ ] **Step 7: Run downloader explicitly**

Run: `pnpm eval:rag:download`

Expected: reports 30 FinanceBench cases, 15 RGB cases, and 5 generated unanswerable cases under ignored `evals/data/`.

- [ ] **Step 8: Commit**

```bash
git add evals/src/download-datasets.ts evals/src/adapters evals/datasets evals/fixtures/raw evals/tests/adapters.test.ts
git commit -m "feat: add FinanceBench and RGB evaluation adapters"
```

### Task 5: Stable Retrieval Types and Pure RRF

**Files:**
- Create: `lib/rag/types.ts`
- Create: `lib/rag/fusion.ts`
- Create: `lib/rag/fusion.test.ts`
- Modify: `lib/db/queries.ts`
- Modify: `lib/rag/rerank.ts`
- Modify: `lib/rag/hybrid-search.ts`

- [ ] **Step 1: Write failing RRF tests**

```ts
test("RRF deduplicates by chunk id rather than filename", () => {
  const fused = reciprocalRankFusion([
    { ...first, chunkId: "chunk-a", source: "vector", rank: 1 },
    { ...first, chunkId: "chunk-a", source: "lexical", rank: 2 },
    { ...first, chunkId: "chunk-b", source: "lexical", rank: 1 },
  ]);
  assert.equal(fused.length, 2);
  assert.equal(fused[0].chunkId, "chunk-a");
});
```

Also assert that vector-only and lexical-only input returns ranked output.

- [ ] **Step 2: Verify RRF tests fail**

Run: `pnpm exec tsx --test lib/rag/fusion.test.ts`

Expected: FAIL because the pure fusion module is missing.

- [ ] **Step 3: Add stable retrieval types**

Define `RetrievalStrategy = "vector" | "lexical" | "hybrid"`, `RetrievedChunk`, `VectorSearchResult`, `LexicalSearchResult`, and `RankedSearchResult`. `RetrievedChunk` must carry `chunkId`, `resourceId`, content metadata, and optional `vectorDistance`, `lexicalRank`, `fusionScore`, and `rerankScore`.

- [ ] **Step 4: Implement pure RRF**

Move fusion out of `hybrid-search.ts`; key its map by `chunkId`; preserve the best vector distance and lexical rank; expose `fusionScore` instead of overloading `score`.

- [ ] **Step 5: Rename and enrich database searches**

Rename `bm25Search` to `lexicalSearch`. Both database queries must select `documentChunk.id` as `chunkId` and `documentResource.id` as `resourceId`. Vector search must select the cosine distance expression as `vectorDistance`; lexical search must keep `ts_rank_cd` as `lexicalRank`. Change logs and comments from “BM25” to “lexical/full-text search”.

- [ ] **Step 6: Preserve metadata through reranking**

Make `rerankDocuments` generic over `T extends RerankDocument` and return `Array<T & { rerankScore: number }>` so IDs and fusion metadata survive. Rename the old ambiguous `score` field to `rerankScore`.

- [ ] **Step 7: Update hybrid search**

Use `similaritySearch`, `lexicalSearch`, `reciprocalRankFusion`, and the normalized types. Add a `strategy` option: vector runs only `similaritySearch`, lexical runs only `lexicalSearch`, and hybrid runs both in parallel and applies RRF. Keep one-sided fallbacks, candidate limit, and optional reranking. Rename `bm25Limit` to `lexicalLimit`.

- [ ] **Step 8: Run RRF tests**

Run: `pnpm exec tsx --test lib/rag/fusion.test.ts`

Expected: all fusion tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/rag/types.ts lib/rag/fusion.ts lib/rag/fusion.test.ts lib/rag/hybrid-search.ts lib/rag/rerank.ts lib/db/queries.ts
git commit -m "refactor: normalize hybrid retrieval results"
```

### Task 6: Shared Retrieval Orchestration and Routing

**Files:**
- Create: `lib/rag/retrieve.ts`
- Create: `lib/rag/retrieve.test.ts`
- Create: `evals/tests/retrieval-routing.test.ts`
- Modify: `lib/ai/tools/rag/retrieve-documents.ts`
- Modify: `app/(chat)/api/chat/route.ts`
- Modify: `lib/ai/prompts/dynamic-messages.ts`

- [ ] **Step 1: Write a failing orchestration test**

Expose a dependency-injected constructor:

```ts
const retrieve = createDocumentRetriever({
  embed: async (query) => {
    calls.push(`embed:${query}`);
    return [0.1, 0.2];
  },
  search: async (input) => {
    calls.push(`search:${input.query}`);
    return [chunk];
  },
});

assert.deepEqual(
  await retrieve({ chatId: "chat", query: "policy", limit: 5 }),
  [chunk]
);
assert.deepEqual(calls, ["embed:policy", "search:policy"]);
```

- [ ] **Step 2: Verify orchestration test fails**

Run: `pnpm exec tsx --test lib/rag/retrieve.test.ts`

Expected: FAIL because `retrieve.ts` is missing.

- [ ] **Step 3: Implement shared retrieval service**

`createDocumentRetriever` accepts `embed` and `search` dependencies. The production export `retrieveDocumentChunks` binds `embedText` and `hybridSearch`. It trims the query, rejects empty input, skips embedding for the lexical-only strategy, otherwise embeds exactly once, and forwards `chatId`, `documentIds`, `limit`, `strategy`, and `useRerank`.

- [ ] **Step 4: Route the model tool through the service**

Remove direct `embedText` and `hybridSearch` imports from `retrieve-documents.ts`. Call `retrieveDocumentChunks` after the ready-document filter and return `fusionScore`/`rerankScore` alongside citation metadata.

- [ ] **Step 5: Route proactive retrieval through the service**

Replace direct `embedText` plus `similaritySearch` in the chat route with:

```ts
const chunks = await retrieveDocumentChunks({
  chatId: id,
  query: queryText,
  limit: 5,
  useRerank: true,
});
```

Keep the existing specificity gate in this milestone so pipeline changes can be measured independently.

- [ ] **Step 6: Add the routing contract test**

Read both consumer source files with `node:fs/promises` and assert they import/call `retrieveDocumentChunks` and no longer import `embedText`, `similaritySearch`, or `hybridSearch`. This intentionally guards an architectural boundary.

- [ ] **Step 7: Run retrieval tests**

Run: `pnpm exec tsx --test lib/rag/retrieve.test.ts evals/tests/retrieval-routing.test.ts`

Expected: orchestration and routing tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/rag/retrieve.ts lib/rag/retrieve.test.ts evals/tests/retrieval-routing.test.ts lib/ai/tools/rag/retrieve-documents.ts app/'(chat)'/api/chat/route.ts lib/ai/prompts/dynamic-messages.ts
git commit -m "refactor: unify document retrieval entry points"
```

### Task 7: Credentialed Retrieval Benchmark Runner

**Files:**
- Create: `evals/src/run-retrieval.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a failing configuration test**

Extend `evals/tests/schema.test.ts` to test an exported `parseRetrievalRunConfig` with `chatId`, cases path, `strategy`, `useRerank`, and K. Assert that an absent chat ID and an unsupported strategy fail with actionable messages.

- [ ] **Step 2: Verify the configuration test fails**

Run: `pnpm exec tsx --test evals/tests/schema.test.ts`

Expected: FAIL because `parseRetrievalRunConfig` is missing.

- [ ] **Step 3: Implement the live runner**

`run-retrieval.ts` must require `EVAL_CHAT_ID`, accept `--cases=<path>`, `--strategy=vector|lexical|hybrid`, and `--rerank=true|false`, then:

1. parse normalized JSONL cases;
2. call `retrieveDocumentChunks` once per case without document filtering;
3. measure wall-clock retrieval latency;
4. continue after individual retrieval errors and record each error string;
5. evaluate successful ranked results at K=5;
6. write timestamped JSON and Markdown reports named with the strategy and rerank mode.

Add:

```json
"eval:rag:retrieval": "tsx evals/src/run-retrieval.ts"
```

- [ ] **Step 4: Run the configuration test**

Run: `pnpm exec tsx --test evals/tests/schema.test.ts`

Expected: all schema/configuration tests pass.

- [ ] **Step 5: Verify fail-fast behavior without credentials**

Run: `pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=hybrid --rerank=false`

Expected: non-zero exit with `EVAL_CHAT_ID is required`; no fallback to smoke data.

- [ ] **Step 6: Commit**

```bash
git add package.json evals/src/run-retrieval.ts evals/tests/schema.test.ts
git commit -m "feat: add live RAG retrieval benchmark runner"
```

### Task 8: Documentation and Terminology Audit

**Files:**
- Create: `evals/README.md`
- Modify: `lib/rag/README.md`
- Modify: `README.md`

- [ ] **Step 1: Rewrite retrieval documentation accurately**

Document the pipeline as:

```text
pgvector dense retrieval + PostgreSQL lexical retrieval
→ Reciprocal Rank Fusion
→ optional DashScope reranking
```

Explicitly state that PostgreSQL `ts_rank_cd` is not BM25.

- [ ] **Step 2: Document benchmark commands**

`evals/README.md` must include:

- `pnpm eval:rag:smoke` for offline validation;
- `pnpm eval:rag:download` for explicit public-data download;
- `EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=hybrid --rerank=true` for a real retrieval run against a chat containing the downloaded corpus;
- dataset sources, attribution, FinanceBench page indexing, and RGB CC BY-NC-SA restriction;
- normalized schema;
- definitions and denominators for Recall@5, MRR, NDCG@5, and false-retrieval rate;
- how to preserve result JSON for vector, lexical, hybrid, and hybrid-plus-rerank comparisons.

- [ ] **Step 3: Add the evaluation section to the root README**

Include an architecture summary and a baseline table whose cells initially say `Run pnpm eval:rag:smoke` rather than fabricated performance numbers.

- [ ] **Step 4: Audit terminology**

Run:

```bash
rg -n -i "bm25" README.md lib/rag lib/db/queries.ts app components evals
```

Expected: no implementation claim that `ts_rank_cd` is BM25. Historical design documents and explicit “not BM25” explanations are allowed.

- [ ] **Step 5: Commit**

```bash
git add README.md lib/rag/README.md evals/README.md
git commit -m "docs: document reproducible RAG evaluation"
```

### Task 9: Full Verification and Baseline Hygiene

**Files:**
- Modify if needed: `lib/ai/models.test.ts`

- [ ] **Step 1: Run the unit suite**

Run: `pnpm test:unit`

Expected: schema, metrics, report, adapter, fusion, orchestration, and routing tests all pass.

- [ ] **Step 2: Run the offline evaluator**

Run: `pnpm eval:rag:smoke`

Expected: exit 0 and generated JSON/Markdown reports under `evals/results/`.

- [ ] **Step 3: Run TypeScript checking**

Run: `pnpm exec tsc --noEmit --incremental false`

Expected: exit 0. If the pre-existing mock model errors remain, narrow every mock `finishReason` with `"stop" as const` and rerun; do not suppress the errors globally.

- [ ] **Step 4: Run lint**

Run: `XDG_CACHE_HOME=/tmp/terra-chat-pnpm-cache pnpm lint`

Expected: exit 0. Apply formatter-only fixes to files changed by this plan if needed.

- [ ] **Step 5: Run existing E2E tests when services are configured**

Run: `pnpm test`

Expected: Playwright suite passes. If required external services are unavailable, record the exact missing prerequisite; do not claim an E2E pass.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check && git status --short && git log --oneline -10`

Expected: no whitespace errors, only planned files changed, and generated/downloaded evaluation data remains untracked or ignored.

- [ ] **Step 7: Commit any verification-only correction**

```bash
git add lib/ai/models.test.ts
git commit -m "test: restore clean TypeScript verification"
```

Skip this commit when no verification correction was required.
