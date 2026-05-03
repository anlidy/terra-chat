import sharp from "sharp";

const MAX_PX = 2048;

export async function downloadAndEncodeImage(
  url: string,
  mediaType: string
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download image: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  let buffer: Buffer = Buffer.from(arrayBuffer);

  const metadata = await sharp(buffer).metadata();
  const { width = 0, height = 0, format } = metadata;

  if (width > MAX_PX || height > MAX_PX) {
    const fitOpt = width >= height ? { width: MAX_PX } : { height: MAX_PX };
    buffer = Buffer.from(await sharp(buffer).resize(fitOpt).toBuffer());
  }

  const outputFormat = format ?? extractFormatFromMediaType(mediaType);
  const finalBuffer =
    outputFormat === format
      ? buffer
      : Buffer.from(
          await sharp(buffer)
            .toFormat(outputFormat as keyof sharp.FormatEnum)
            .toBuffer()
        );

  const base64 = finalBuffer.toString("base64");
  return `data:${mediaType};base64,${base64}`;
}

function extractFormatFromMediaType(mediaType: string): string {
  const mapping: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return mapping[mediaType] ?? "jpeg";
}
