import { z } from "zod";

import { ragEvalCaseSchema, type RagEvalCase } from "../schema";

const financeBenchEvidenceSchema = z.object({
  evidence_text: z.string(),
  doc_name: z.string().min(1),
  evidence_page_num: z.number().int().nonnegative(),
});

export const financeBenchRowSchema = z.object({
  financebench_id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  doc_name: z.string().min(1),
  question_type: z.string().min(1),
  question_reasoning: z
    .string()
    .min(1)
    .nullable()
    .transform((value) => value ?? "Unspecified"),
  evidence: z.array(financeBenchEvidenceSchema),
});

export type FinanceBenchRow = z.infer<typeof financeBenchRowSchema>;

export function resolveFinanceBenchDocumentUrl(url: string): string {
  const parsed = new URL(url);
  const encodedTarget =
    parsed.hostname === "www.adobe.com" &&
    parsed.pathname === "/pdf-page.html"
      ? parsed.searchParams.get("pdfTarget")
      : null;

  if (encodedTarget === null) {
    return url;
  }

  const target = new URL(Buffer.from(encodedTarget, "base64url").toString());
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`Unsupported FinanceBench PDF protocol: ${target.protocol}`);
  }
  return target.toString();
}

function parseRows(rows: unknown[]): FinanceBenchRow[] {
  return rows.map((row, index) => {
    const result = financeBenchRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Invalid FinanceBench source row ${index}: ${result.error.message}`,
      );
    }
    return result.data;
  });
}

export function selectFinanceBenchRows(
  rows: FinanceBenchRow[],
  limit: number,
): FinanceBenchRow[] {
  const sorted = rows.toSorted((left, right) =>
    left.financebench_id.localeCompare(right.financebench_id),
  );
  const groups = new Map<string, FinanceBenchRow[]>();

  for (const row of sorted) {
    const group = groups.get(row.question_reasoning) ?? [];
    group.push(row);
    groups.set(row.question_reasoning, group);
  }

  const selected: FinanceBenchRow[] = [];
  const groupRows = [...groups.values()];
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const group of groupRows) {
      const row = group[index];
      if (row !== undefined && selected.length < limit) {
        selected.push(row);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }

  return selected;
}

export function normalizeFinanceBenchRow(row: FinanceBenchRow): RagEvalCase {
  const relevantDocumentIds = [
    ...new Set([row.doc_name, ...row.evidence.map((item) => item.doc_name)]),
  ];
  const evidenceTexts = row.evidence
    .map((item) => item.evidence_text.trim())
    .filter((text) => text.length > 0);
  const evidencePages = [
    ...new Set(row.evidence.map((item) => item.evidence_page_num)),
  ];

  return ragEvalCaseSchema.parse({
    id: row.financebench_id,
    query: row.question,
    expectedAnswer: row.answer,
    relevantDocumentIds,
    evidenceTexts,
    evidencePages,
    category: row.question_type,
    language: "en",
    answerable: true,
  });
}

export function adaptFinanceBenchRows(
  rows: unknown[],
  limit: number,
): RagEvalCase[] {
  return selectFinanceBenchRows(parseRows(rows), limit).map(
    normalizeFinanceBenchRow,
  );
}

export function parseFinanceBenchRows(rows: unknown[]): FinanceBenchRow[] {
  return parseRows(rows);
}
