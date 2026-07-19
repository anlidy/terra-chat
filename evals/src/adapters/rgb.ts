import { z } from "zod";

import { type RagEvalCase, ragEvalCaseSchema } from "../schema";

const rgbRowSchema = z.object({
  id: z.number().int().nonnegative(),
  query: z.string().min(1),
  answer: z.array(
    z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  ),
  positive: z.array(z.string().min(1)).min(1),
  negative: z.array(z.string().min(1)),
});

type RgbRow = z.infer<typeof rgbRowSchema>;

export type RgbDocument = {
  id: string;
  caseId: string;
  content: string;
  relevant: boolean;
};

export type AdaptedRgb = {
  cases: RagEvalCase[];
  documents: RgbDocument[];
};

function parseRows(rows: unknown[]): RgbRow[] {
  return rows.map((row, index) => {
    const result = rgbRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Invalid RGB source row ${index}: ${result.error.message}`
      );
    }
    return result.data;
  });
}

export function adaptRgbRows(rows: unknown[], limit: number): AdaptedRgb {
  const selected = parseRows(rows)
    .toSorted((left, right) => left.id - right.id)
    .slice(0, limit);
  const cases: RagEvalCase[] = [];
  const documents: RgbDocument[] = [];

  for (const row of selected) {
    const caseId = `rgb-zh-${row.id}`;
    const positives = row.positive.slice(0, 2).map((content, index) => ({
      id: `${caseId}-positive-${index}`,
      caseId,
      content,
      relevant: true,
    }));
    const negatives = row.negative.slice(0, 3).map((content, index) => ({
      id: `${caseId}-negative-${index}`,
      caseId,
      content,
      relevant: false,
    }));

    cases.push(
      ragEvalCaseSchema.parse({
        id: caseId,
        query: row.query,
        expectedAnswer: row.answer.flat().join("；"),
        relevantDocumentIds: positives.map((document) => document.id),
        evidenceTexts: positives.map((document) => document.content),
        evidencePages: [],
        category: "fact",
        language: "zh",
        answerable: true,
      })
    );
    documents.push(...positives, ...negatives);
  }

  return { cases, documents };
}
