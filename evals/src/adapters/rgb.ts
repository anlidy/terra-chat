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

const rgbIntegrationRowSchema = rgbRowSchema.extend({
  positive: z.array(z.array(z.string().min(1)).min(1)).min(2),
});

type RgbRow = z.infer<typeof rgbRowSchema>;
type RgbIntegrationRow = z.infer<typeof rgbIntegrationRowSchema>;

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

function parseIntegrationRows(rows: unknown[]): RgbIntegrationRow[] {
  return rows.map((row, index) => {
    const result = rgbIntegrationRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Invalid RGB integration source row ${index}: ${result.error.message}`
      );
    }
    return result.data;
  });
}

function documentsForCase({
  caseId,
  positive,
  negative,
}: {
  caseId: string;
  positive: string[];
  negative: string[];
}): RgbDocument[] {
  return [
    ...positive.slice(0, 2).map((content, index) => ({
      id: `${caseId}-positive-${index}`,
      caseId,
      content,
      relevant: true,
    })),
    ...negative.slice(0, 3).map((content, index) => ({
      id: `${caseId}-negative-${index}`,
      caseId,
      content,
      relevant: false,
    })),
  ];
}

export function adaptRgbRows(rows: unknown[], limit: number): AdaptedRgb {
  const selected = parseRows(rows)
    .toSorted((left, right) => left.id - right.id)
    .slice(0, limit);
  const cases: RagEvalCase[] = [];
  const documents: RgbDocument[] = [];

  for (const row of selected) {
    const caseId = `rgb-zh-${row.id}`;
    const caseDocuments = documentsForCase({
      caseId,
      positive: row.positive,
      negative: row.negative,
    });
    const positives = caseDocuments.filter((document) => document.relevant);

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
    documents.push(...caseDocuments);
  }

  return { cases, documents };
}

export function adaptRgbIntegrationRows(
  rows: unknown[],
  limit: number
): AdaptedRgb {
  const selected = parseIntegrationRows(rows)
    .toSorted((left, right) => left.id - right.id)
    .slice(0, limit);
  const cases: RagEvalCase[] = [];
  const documents: RgbDocument[] = [];

  for (const row of selected) {
    const caseId = `rgb-zh-int-${row.id}`;
    const evidence = row.positive
      .slice(0, 2)
      .map((group) => group[0] as string);
    const caseDocuments = documentsForCase({
      caseId,
      positive: evidence,
      negative: row.negative,
    });
    const positives = caseDocuments.filter((document) => document.relevant);
    cases.push(
      ragEvalCaseSchema.parse({
        id: caseId,
        query: row.query,
        expectedAnswer: row.answer.flat().join("；"),
        relevantDocumentIds: positives.map((document) => document.id),
        evidenceTexts: evidence,
        evidencePages: [],
        category: "information-integration",
        language: "zh",
        answerable: true,
      })
    );
    documents.push(...caseDocuments);
  }

  return { cases, documents };
}

export function adaptRgbUnanswerableRows(
  rows: unknown[],
  offset: number,
  limit: number
): RagEvalCase[] {
  return parseRows(rows)
    .toSorted((left, right) => left.id - right.id)
    .slice(offset, offset + limit)
    .map((row) =>
      ragEvalCaseSchema.parse({
        id: `rgb-zh-unanswerable-${row.id}`,
        query: row.query,
        expectedAnswer: "",
        relevantDocumentIds: [],
        evidenceTexts: [],
        evidencePages: [],
        category: "unanswerable",
        language: "zh",
        answerable: false,
      })
    );
}
