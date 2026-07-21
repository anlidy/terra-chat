import { cut } from "nodejieba";

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const TOKEN_RE = /\p{Script=Han}+|[\p{L}\p{N}]+/gu;

function quoteLexeme(word: string): string {
  return `'${word.replaceAll("'", "''")}'`;
}

/**
 * Build a PostgreSQL tsquery string from user input.
 */
export function buildTsQuery(query: string): string {
  const words = Array.from(
    query.matchAll(TOKEN_RE),
    ([token]) => token
  ).flatMap((token) => (CJK_RE.test(token) ? cut(token) : [token]));

  return words
    .map((word) => `${quoteLexeme(word)}${CJK_RE.test(word) ? ":*" : ""}`)
    .join(" & ");
}
