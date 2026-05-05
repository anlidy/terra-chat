import { MarkdownNodeParser } from "@llamaindex/core/node-parser";
import { Document } from "@llamaindex/core/schema";

const parser = new MarkdownNodeParser();
const MAX_CHARS = 1000; // ~1500 tokens fallback

export interface ChunkWithMetadata {
  content: string;
  pageNumber?: number;
}

/**
 * Extract page number from markdown content
 * LlamaCloud often includes page markers like "---\nPage 5\n---"
 */
function extractPageNumber(text: string): number | undefined {
  // Pattern 1: "Page X" or "第X页"
  const pageMatch = text.match(/(?:Page|第)\s*(\d+)(?:页)?/i);
  if (pageMatch) {
    return Number.parseInt(pageMatch[1], 10);
  }

  // Pattern 2: Markdown metadata "page: X"
  const metaMatch = text.match(/^page:\s*(\d+)/im);
  if (metaMatch) {
    return Number.parseInt(metaMatch[1], 10);
  }

  return undefined;
}

export function chunkMarkdown(markdown: string): ChunkWithMetadata[] {
  const nodes = parser.getNodesFromDocuments([
    new Document({ text: markdown }),
  ]);
  const chunks: ChunkWithMetadata[] = [];

  for (const node of nodes) {
    const text = node.getText();
    const pageNumber = extractPageNumber(text);

    if (text.length <= MAX_CHARS) {
      chunks.push({ content: text, pageNumber });
    } else {
      // fallback: split oversized nodes by paragraph
      const parts = text.split(/\n\n+/);
      let current = "";
      for (const part of parts) {
        if ((current + part).length > MAX_CHARS && current) {
          chunks.push({
            content: current.trim(),
            pageNumber,
          });
          current = part;
        } else {
          current = current ? `${current}\n\n${part}` : part;
        }
      }
      if (current.trim()) {
        chunks.push({
          content: current.trim(),
          pageNumber,
        });
      }
    }
  }

  return chunks.filter((c) => c.content.length > 0);
}
