import { RAG_EMBEDDING_DIMENSIONS, RAG_EMBEDDING_MODEL } from "./config";

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
    },
    body: JSON.stringify({
      model: RAG_EMBEDDING_MODEL,
      input: text,
      dimensions: RAG_EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    throw new Error(`Zhipu embedding failed: ${res.status}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}
