# RAG Evaluation-First Improvement Design

## Objective

Turn the existing document-chat RAG implementation into a measurable and internally consistent system. The first milestone must make retrieval changes comparable, route every automatic and tool-triggered search through the same pipeline, and report reproducible retrieval metrics.

## Scope

This milestone includes:

- a root-level `evals/` workspace;
- a normalized evaluation data format;
- download/import adapters for a 30-question FinanceBench subset and a 15-question Chinese RGB subset;
- five unanswerable cases derived from the selected corpora;
- deterministic retrieval metrics and machine-readable result reports;
- a single retrieval service shared by proactive retrieval and the `retrieveDocuments` tool;
- accurate naming of PostgreSQL full-text retrieval as lexical search rather than BM25;
- relevance metadata needed for later threshold and citation work;
- unit tests for metrics, fusion, data validation, and retrieval routing;
- README documentation for running and interpreting the benchmark.

This milestone does not add a benchmark dashboard, replace PostgreSQL full-text search, introduce a job queue, or use an LLM judge as the primary metric.

## Dataset Design

Downloaded source datasets and PDFs are local artifacts and are not committed. The repository contains manifests, normalized question fixtures where licensing permits, adapters, and attribution metadata.

```text
evals/
├── README.md
├── datasets/
│   ├── financebench.manifest.json
│   └── rgb-zh.manifest.json
├── fixtures/
│   └── smoke.jsonl
├── results/                 # generated, gitignored except .gitkeep
├── src/
│   ├── schema.ts
│   ├── metrics.ts
│   ├── evaluate-retrieval.ts
│   └── adapters/
│       ├── financebench.ts
│       └── rgb.ts
└── tests/
    ├── metrics.test.ts
    └── schema.test.ts
```

Each normalized case contains:

```ts
type RagEvalCase = {
  id: string;
  query: string;
  expectedAnswer: string;
  relevantDocumentIds: string[];
  evidenceTexts: string[];
  evidencePages: number[];
  category: string;
  language: "en" | "zh";
  answerable: boolean;
};
```

FinanceBench is the end-to-end PDF and page-evidence benchmark. RGB Chinese examples supplement lexical/semantic retrieval and noisy-context behavior. Unanswerable cases use questions whose evidence documents are intentionally absent from the evaluation corpus, and are explicitly labeled so they do not count as ordinary retrieval misses.

## Retrieval Architecture

Add one application-level entry point that owns retrieval orchestration:

```ts
retrieveDocumentChunks({
  chatId,
  query,
  documentIds,
  limit,
  useRerank,
})
```

It performs:

1. query embedding;
2. vector and PostgreSQL lexical retrieval in parallel;
3. reciprocal-rank fusion;
4. optional reranking;
5. normalized result formatting.

Both proactive retrieval in the chat route and the model tool call use this function. Database functions remain responsible only for individual retrieval mechanisms.

The lexical function and documentation are renamed from `bm25Search` to `lexicalSearch`. The implementation continues to use `to_tsvector`, `to_tsquery`, and `ts_rank_cd`; it will not claim to implement BM25.

Normalized results expose stable identifiers and scores where available:

```ts
type RetrievedChunk = {
  chunkId: string;
  resourceId: string;
  content: string;
  chunkIndex: number;
  fileName: string;
  pageNumber: number | null;
  vectorDistance?: number;
  lexicalRank?: number;
  fusionScore?: number;
  rerankScore?: number;
};
```

RRF deduplicates by `chunkId`, not by filename and chunk index.

## Evaluation Flow

The evaluator accepts normalized cases plus retrieved results and computes retrieval-only metrics without an LLM judge:

- Recall@K: whether any relevant evidence is present in the first K results;
- MRR: reciprocal rank of the first relevant result;
- NDCG@K: ranking quality when several evidence chunks/documents are relevant;
- answerable coverage and unanswerable false-retrieval rate;
- latency percentiles collected from each retrieval run.

A result is relevant when it matches a gold document and either its page number matches a gold evidence page or its normalized text overlaps a gold evidence string above a documented threshold. The evaluator records per-case details so failures can be inspected rather than only reporting aggregate numbers.

The runner outputs timestamped JSON and a Markdown summary under `evals/results/`. A smoke fixture runs without external services and validates the metric implementation. Full FinanceBench/RGB runs require downloaded data, PostgreSQL, and embedding credentials.

## Error Handling

- Dataset adapters validate every record with Zod and report the source row and reason on failure.
- Downloaded data is checksummed when the upstream source provides a stable artifact; otherwise the manifest records source URL and retrieval date.
- Empty queries, missing gold evidence for answerable cases, and duplicate case IDs fail before evaluation.
- One failed retrieval case is recorded as an error and does not abort the remaining benchmark.
- Reranker failure retains the existing deterministic fallback, and the report records which reranker was used.
- Full benchmark commands never silently fall back to smoke fixtures.

## Testing

Development follows test-first changes.

Unit tests cover:

- Recall@K, MRR, and NDCG with known rankings;
- unanswerable cases;
- schema validation and duplicate IDs;
- RRF deduplication by chunk ID;
- lexical-only and vector-only fallback;
- proactive and tool retrieval calling the same retrieval service;
- FinanceBench and RGB adapter behavior against small committed fixtures.

Integration verification covers TypeScript checking, linting, existing tests, and a local smoke evaluation. The full online benchmark is documented separately because it requires external datasets and credentials.

## Success Criteria

- Proactive retrieval and tool retrieval produce the same result shape and use the same hybrid pipeline.
- No project documentation or symbol describes `ts_rank_cd` as BM25.
- `pnpm eval:rag:smoke` produces valid JSON and Markdown reports with Recall@5, MRR, and NDCG@5.
- Metric and fusion unit tests pass without network access or API keys.
- Dataset download/import instructions are reproducible and include source attribution and license notes.
- The README explains how to compare vector-only, lexical-only, hybrid, and hybrid-plus-rerank runs.

## Later Milestones

After a baseline report exists, a separate milestone can calibrate a relevance threshold, add explicit refusal behavior, render page-level citations in the UI, and evaluate answer faithfulness. Those changes depend on the score distributions and failure cases produced here.
