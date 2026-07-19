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
  .superRefine((evalCase, context) => {
    if (evalCase.answerable && evalCase.relevantDocumentIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Answerable cases require at least one relevant document id",
        path: ["relevantDocumentIds"],
      });
    }
  });

export const evalRetrievedChunkSchema = z.object({
  chunkId: z.string(),
  resourceId: z.string(),
  content: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  fileName: z.string(),
  pageNumber: z.number().int().nonnegative().nullable(),
});

export type RagEvalCase = z.infer<typeof ragEvalCaseSchema>;
export type EvalRetrievedChunk = z.infer<typeof evalRetrievedChunkSchema>;

export function parseEvalCases(input: unknown[]): RagEvalCase[] {
  const evalCases = ragEvalCaseSchema.array().parse(input);
  const seenIds = new Set<string>();

  for (const evalCase of evalCases) {
    if (seenIds.has(evalCase.id)) {
      throw new Error(`Duplicate evaluation case id: ${evalCase.id}`);
    }

    seenIds.add(evalCase.id);
  }

  return evalCases;
}
