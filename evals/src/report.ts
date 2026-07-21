import type { RerankerAttempt } from "../../lib/rag/types";
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
    rerankerAttempts: RerankerAttempt[];
    rerankers: string[];
    minRelevance: number | null;
  };
  summary: RetrievalSummary;
  breakdowns: {
    languages: Record<string, RetrievalSummary>;
    categories: Record<string, RetrievalSummary>;
  };
  cases: RetrievalCaseResult[];
};

export type RetrievalSummary = {
  caseCount: number;
  answerableCount: number;
  unanswerableCount: number;
  errorCount: number;
  documentRecallAtK: number | null;
  goldDocumentCoverageAtK: number | null;
  evidenceCoverageAtK: number | null;
  contextPrecisionAtK: number | null;
  recallAtK: number | null;
  mrr: number | null;
  ndcgAtK: number | null;
  falseRetrievalRate: number | null;
  latencyP50Ms: number;
  latencyP95Ms: number;
};

export function latestReportFileStem(...parts: string[]): string {
  return `${parts.join("-")}-latest`;
}

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
  rerankerAttempts: RerankerAttempt[];
  rerankers: string[];
  minRelevance: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function metricValues(
  results: RetrievalCaseResult[],
  metric:
    | "documentRecallAtK"
    | "goldDocumentCoverageAtK"
    | "evidenceCoverageAtK"
    | "contextPrecisionAtK"
    | "recallAtK"
    | "mrr"
    | "ndcgAtK"
): number[] {
  return results.flatMap((result) => {
    const value = result[metric];
    return value === null ? [] : [value];
  });
}

function buildSummary(results: RetrievalCaseResult[]): RetrievalSummary {
  const answerable = results.filter((result) => result.answerable);
  const unanswerable = results.filter((result) => !result.answerable);
  const falseRetrievals = unanswerable.filter(
    (result) => result.falseRetrieval
  ).length;
  const latencies = results.map((result) => result.latencyMs);

  return {
    caseCount: results.length,
    answerableCount: answerable.length,
    unanswerableCount: unanswerable.length,
    errorCount: results.filter((result) => result.error !== undefined).length,
    documentRecallAtK: average(metricValues(answerable, "documentRecallAtK")),
    goldDocumentCoverageAtK: average(
      metricValues(answerable, "goldDocumentCoverageAtK")
    ),
    evidenceCoverageAtK: average(
      metricValues(answerable, "evidenceCoverageAtK")
    ),
    contextPrecisionAtK: average(
      metricValues(answerable, "contextPrecisionAtK")
    ),
    recallAtK: average(metricValues(answerable, "recallAtK")),
    mrr: average(metricValues(answerable, "mrr")),
    ndcgAtK: average(metricValues(answerable, "ndcgAtK")),
    falseRetrievalRate:
      unanswerable.length === 0 ? null : falseRetrievals / unanswerable.length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
  };
}

function buildBreakdown(
  results: RetrievalCaseResult[],
  key: "category" | "language"
): Record<string, RetrievalSummary> {
  const values = [...new Set(results.map((result) => result[key]))].toSorted();
  return Object.fromEntries(
    values.map((value) => [
      value,
      buildSummary(results.filter((result) => result[key] === value)),
    ])
  );
}

export function buildRetrievalReport(
  results: RetrievalCaseResult[],
  options: ReportOptions
): RetrievalReport {
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
      rerankerAttempts: options.rerankerAttempts,
      rerankers: options.rerankers,
      minRelevance: options.minRelevance,
    },
    summary: buildSummary(results),
    breakdowns: {
      languages: buildBreakdown(results, "language"),
      categories: buildBreakdown(results, "category"),
    },
    cases: results,
  };
}

function renderBreakdown(
  summaries: Record<string, RetrievalSummary>,
  k: number
): string {
  const rows = Object.entries(summaries)
    .map(
      ([name, summary]) =>
        `| ${escapeTableCell(name)} | ${summary.caseCount} | ${formatMetric(summary.documentRecallAtK)} | ${formatMetric(summary.recallAtK)} | ${formatMetric(summary.evidenceCoverageAtK)} | ${formatMetric(summary.contextPrecisionAtK)} | ${formatMetric(summary.falseRetrievalRate)} | ${summary.latencyP95Ms.toFixed(2)} |`
    )
    .join("\n");
  return `| Slice | Cases | Document recall@${k} | Evidence recall@${k} | Evidence coverage@${k} | Context precision@${k} | False-retrieval | P95 ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}`;
}

function formatMetric(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatRerankerAttempts(attempts: RerankerAttempt[]): string {
  if (attempts.length === 0) {
    return "not invoked";
  }

  return attempts
    .map((attempt) =>
      attempt.error === undefined
        ? `${attempt.reranker}: ${attempt.status}`
        : `${attempt.reranker}: ${attempt.status} (${attempt.error})`
    )
    .join("; ");
}

function formatTopResults(result: RetrievalCaseResult): string {
  if (result.topResults.length === 0) {
    return "—";
  }

  return result.topResults
    .map((item) => {
      const scores = [
        item.vectorDistance === undefined
          ? undefined
          : `vectorDistance=${item.vectorDistance.toFixed(4)}`,
        item.lexicalRank === undefined
          ? undefined
          : `lexicalRank=${item.lexicalRank.toFixed(4)}`,
        item.fusionScore === undefined
          ? undefined
          : `fusionScore=${item.fusionScore.toFixed(4)}`,
        item.rerankScore === undefined
          ? undefined
          : `rerankScore=${item.rerankScore.toFixed(4)}`,
        item.reranker === undefined ? undefined : `reranker=${item.reranker}`,
      ].filter((value) => value !== undefined);
      const location = `${item.rank}:${item.fileName}#page=${item.pageNumber ?? "unknown"}`;
      return scores.length === 0
        ? location
        : `${location} (${scores.join(", ")})`;
    })
    .join("<br>");
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
      ? "| — | — | — | — |"
      : failedCases
          .map((result) => {
            const reason =
              result.error ??
              (result.falseRetrieval
                ? "false-retrieval"
                : `no relevant result in top ${metadata.k}`);
            return `| ${escapeTableCell(result.caseId)} | ${escapeTableCell(result.query)} | ${escapeTableCell(reason)} | ${escapeTableCell(formatTopResults(result))} |`;
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
- Reranker attempts: ${formatRerankerAttempts(metadata.rerankerAttempts)}
- Minimum relevance: ${metadata.minRelevance ?? "disabled"}

| Metric | Value |
| --- | ---: |
| Cases | ${summary.caseCount} |
| Answerable cases | ${summary.answerableCount} |
| Unanswerable cases | ${summary.unanswerableCount} |
| Errors | ${summary.errorCount} |
| Document recall@${metadata.k} | ${formatMetric(summary.documentRecallAtK)} |
| Gold-document coverage@${metadata.k} | ${formatMetric(summary.goldDocumentCoverageAtK)} |
| Evidence Recall@${metadata.k} | ${formatMetric(summary.recallAtK)} |
| Evidence coverage@${metadata.k} | ${formatMetric(summary.evidenceCoverageAtK)} |
| Context precision@${metadata.k} | ${formatMetric(summary.contextPrecisionAtK)} |
| MRR | ${formatMetric(summary.mrr)} |
| NDCG@${metadata.k} | ${formatMetric(summary.ndcgAtK)} |
| False-retrieval rate | ${formatMetric(summary.falseRetrievalRate)} |
| Latency P50 (ms) | ${summary.latencyP50Ms.toFixed(2)} |
| Latency P95 (ms) | ${summary.latencyP95Ms.toFixed(2)} |

## Breakdown by Language

${renderBreakdown(report.breakdowns.languages, metadata.k)}

## Breakdown by Category

${renderBreakdown(report.breakdowns.categories, metadata.k)}

## Failed Cases

| Case | Query | Reason | Top results |
| --- | --- | --- | --- |
${failureRows}
`;
}
