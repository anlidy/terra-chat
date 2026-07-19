import { percentile, type RetrievalCaseResult } from "./metrics";

export type RetrievalReport = {
  metadata: {
    dataset: string;
    strategy: string;
    k: number;
    generatedAt: string;
    sourceRevision: string;
    caseSetHash: string;
    corpusHash: string;
    pipelineVersion: string;
    embeddingModel: string | null;
    rerankers: string[];
    minRelevance: number | null;
  };
  summary: {
    caseCount: number;
    answerableCount: number;
    unanswerableCount: number;
    errorCount: number;
    recallAtK: number;
    mrr: number;
    ndcgAtK: number;
    falseRetrievalRate: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
  };
  cases: RetrievalCaseResult[];
};

type ReportOptions = {
  dataset: string;
  strategy: string;
  k: number;
  generatedAt?: string;
  sourceRevision: string;
  caseSetHash: string;
  corpusHash: string;
  pipelineVersion: string;
  embeddingModel: string | null;
  rerankers: string[];
  minRelevance: number | null;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function metricValues(
  results: RetrievalCaseResult[],
  metric: "recallAtK" | "mrr" | "ndcgAtK"
): number[] {
  return results.flatMap((result) => {
    const value = result[metric];
    return value === null ? [] : [value];
  });
}

export function buildRetrievalReport(
  results: RetrievalCaseResult[],
  options: ReportOptions
): RetrievalReport {
  const answerable = results.filter((result) => result.answerable);
  const unanswerable = results.filter((result) => !result.answerable);
  const falseRetrievals = unanswerable.filter(
    (result) => result.falseRetrieval
  ).length;
  const latencies = results.map((result) => result.latencyMs);

  return {
    metadata: {
      dataset: options.dataset,
      strategy: options.strategy,
      k: options.k,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      sourceRevision: options.sourceRevision,
      caseSetHash: options.caseSetHash,
      corpusHash: options.corpusHash,
      pipelineVersion: options.pipelineVersion,
      embeddingModel: options.embeddingModel,
      rerankers: options.rerankers,
      minRelevance: options.minRelevance,
    },
    summary: {
      caseCount: results.length,
      answerableCount: answerable.length,
      unanswerableCount: unanswerable.length,
      errorCount: results.filter((result) => result.error !== undefined).length,
      recallAtK: average(metricValues(answerable, "recallAtK")),
      mrr: average(metricValues(answerable, "mrr")),
      ndcgAtK: average(metricValues(answerable, "ndcgAtK")),
      falseRetrievalRate:
        unanswerable.length === 0 ? 0 : falseRetrievals / unanswerable.length,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
    },
    cases: results,
  };
}

function formatMetric(value: number): string {
  return value.toFixed(4);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdownReport(report: RetrievalReport): string {
  const { metadata, summary } = report;
  const failedCases = report.cases.filter(
    (result) =>
      result.error !== undefined ||
      (result.answerable && result.recallAtK === 0) ||
      result.falseRetrieval
  );
  const failureRows =
    failedCases.length === 0
      ? "| — | — | — |"
      : failedCases
          .map((result) => {
            const reason =
              result.error ??
              (result.falseRetrieval
                ? "false-retrieval"
                : `no relevant result in top ${metadata.k}`);
            return `| ${escapeTableCell(result.caseId)} | ${escapeTableCell(result.query)} | ${escapeTableCell(reason)} |`;
          })
          .join("\n");

  return `# RAG Retrieval Report

- Dataset: ${metadata.dataset}
- Strategy: ${metadata.strategy}
- Generated: ${metadata.generatedAt}
- Source revision: ${metadata.sourceRevision}
- Case set hash: ${metadata.caseSetHash}
- Corpus hash: ${metadata.corpusHash}
- Pipeline version: ${metadata.pipelineVersion}
- Embedding model: ${metadata.embeddingModel ?? "not used"}
- Rerankers: ${metadata.rerankers.join(", ")}
- Minimum relevance: ${metadata.minRelevance ?? "disabled"}

| Metric | Value |
| --- | ---: |
| Cases | ${summary.caseCount} |
| Answerable cases | ${summary.answerableCount} |
| Unanswerable cases | ${summary.unanswerableCount} |
| Errors | ${summary.errorCount} |
| Recall@${metadata.k} | ${formatMetric(summary.recallAtK)} |
| MRR | ${formatMetric(summary.mrr)} |
| NDCG@${metadata.k} | ${formatMetric(summary.ndcgAtK)} |
| False-retrieval rate | ${formatMetric(summary.falseRetrievalRate)} |
| Latency P50 (ms) | ${summary.latencyP50Ms.toFixed(2)} |
| Latency P95 (ms) | ${summary.latencyP95Ms.toFixed(2)} |

## Failed Cases

| Case | Query | Reason |
| --- | --- | --- |
${failureRows}
`;
}
