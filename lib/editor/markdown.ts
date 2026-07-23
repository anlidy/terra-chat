import { defaultMarkdownParser } from "prosemirror-markdown";
import type { Node, Schema } from "prosemirror-model";
import { documentSchema } from "./schema";

/** Parse Markdown without React rendering, effects, or browser DOM APIs. */
export function parseMarkdownToDocument(
  content: string,
  schema: Schema = documentSchema
): Node {
  const parsed = defaultMarkdownParser.parse(content);
  return schema.nodeFromJSON(parsed.toJSON());
}
