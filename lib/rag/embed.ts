import { RAG_EMBEDDING_DIMENSIONS, RAG_EMBEDDING_MODEL } from "./config";

const EMBEDDING_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/embeddings";
const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_MAX_ATTEMPTS = 3;
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;

type EmbeddingResponse = {
  data?: Array<{
    embedding?: unknown;
    index?: unknown;
  }>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseDetails(body: string): string {
  const compact = body.replaceAll(/\s+/gu, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    return `${error.message}; cause=${String(cause.code)}`;
  }
  return error.message;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function requestEmbeddingBatch({
  inputs,
  batchNumber,
  batchCount,
  context,
}: {
  inputs: string[];
  batchNumber: number;
  batchCount: number;
  context?: string;
}): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
        },
        body: JSON.stringify({
          model: RAG_EMBEDDING_MODEL,
          input: inputs,
          dimensions: RAG_EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt < EMBEDDING_MAX_ATTEMPTS) {
        const retryDelayMs = attempt * 250;
        console.warn(
          `[rag:embed] Retrying batch ${batchNumber}/${batchCount} attempt ${attempt + 1}/${EMBEDDING_MAX_ATTEMPTS} in ${retryDelayMs}ms${context ? ` (${context})` : ""}: ${errorDetails(error)}`
        );
        await delay(retryDelayMs);
        continue;
      }
      break;
    }

    const body = await response.text();
    if (!response.ok) {
      const details = responseDetails(body);
      const error = new Error(
        `Zhipu embedding failed (status=${response.status}${details ? `, response=${details}` : ""})`
      );
      if (!isRetryableStatus(response.status)) {
        throw error;
      }
      lastError = error;
      if (attempt < EMBEDDING_MAX_ATTEMPTS) {
        const retryDelayMs = attempt * 250;
        console.warn(
          `[rag:embed] Retrying batch ${batchNumber}/${batchCount} attempt ${attempt + 1}/${EMBEDDING_MAX_ATTEMPTS} in ${retryDelayMs}ms${context ? ` (${context})` : ""}: ${error.message}`
        );
        await delay(retryDelayMs);
        continue;
      }
      break;
    }

    let payload: EmbeddingResponse;
    try {
      payload = JSON.parse(body) as EmbeddingResponse;
    } catch (error) {
      throw new Error("Zhipu embedding returned invalid JSON", {
        cause: error,
      });
    }

    if (!Array.isArray(payload.data) || payload.data.length !== inputs.length) {
      throw new Error(
        `Zhipu embedding returned ${payload.data?.length ?? 0} vectors for ${inputs.length} inputs`
      );
    }

    const embeddings = new Array<number[] | undefined>(inputs.length).fill(
      undefined
    );
    for (const item of payload.data) {
      if (
        typeof item.index !== "number" ||
        item.index < 0 ||
        item.index >= inputs.length ||
        !Array.isArray(item.embedding) ||
        !item.embedding.every((value) => typeof value === "number")
      ) {
        throw new Error("Zhipu embedding returned an invalid vector payload");
      }
      embeddings[item.index] = item.embedding;
    }

    return embeddings.map((embedding) => {
      if (embedding === undefined) {
        throw new Error("Zhipu embedding response omitted one or more inputs");
      }
      return embedding;
    });
  }

  throw new Error(
    `Zhipu embedding request failed after ${EMBEDDING_MAX_ATTEMPTS} attempts for batch ${batchNumber}/${batchCount}${context ? ` (${context})` : ""}: ${errorDetails(lastError)}`,
    { cause: lastError }
  );
}

export async function embedTexts(
  texts: string[],
  { context }: { context?: string } = {}
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const batchCount = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);
  const embeddings: number[][] = [];

  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batchNumber = offset / EMBEDDING_BATCH_SIZE + 1;
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const startedAt = Date.now();
    if (context) {
      console.log(
        `[rag:embed] Embedding batch ${batchNumber}/${batchCount} (${batch.length} chunks, ${context})`
      );
    }
    embeddings.push(
      ...(await requestEmbeddingBatch({
        inputs: batch,
        batchNumber,
        batchCount,
        context,
      }))
    );
    if (context) {
      console.log(
        `[rag:embed] Embedded batch ${batchNumber}/${batchCount} in ${Date.now() - startedAt}ms (${context})`
      );
    }
  }

  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (embedding === undefined) {
    throw new Error("Zhipu embedding returned no vector");
  }
  return embedding;
}
