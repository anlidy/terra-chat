import { del, get } from "@vercel/blob";

type DocumentBlobResult = {
  etag: string | null;
  statusCode: 200 | 304;
  stream: ReadableStream<Uint8Array> | null;
};

function isPrivateBlobUrl(url: string) {
  try {
    return new URL(url).hostname.includes(".private.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function privateBlobToken() {
  const token = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Private document storage is not configured");
  }
  return token;
}

export async function deleteDocumentBlob(url: string) {
  if (isPrivateBlobUrl(url)) {
    await del(url, { token: privateBlobToken() });
    return;
  }
  await del(url);
}

export async function readDocumentBlob(
  url: string,
  ifNoneMatch?: string
): Promise<DocumentBlobResult | null> {
  if (isPrivateBlobUrl(url)) {
    const result = await get(url, {
      access: "private",
      ifNoneMatch,
      token: privateBlobToken(),
    });
    if (!result) {
      return null;
    }
    return {
      etag: result.blob.etag,
      statusCode: result.statusCode,
      stream: result.stream,
    };
  }

  const response = await fetch(url, {
    headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined,
  });
  if (response.status === 304) {
    return {
      etag: response.headers.get("etag"),
      statusCode: 304,
      stream: null,
    };
  }
  if (!response.ok || !response.body) {
    return null;
  }
  return {
    etag: response.headers.get("etag"),
    statusCode: 200,
    stream: response.body,
  };
}
