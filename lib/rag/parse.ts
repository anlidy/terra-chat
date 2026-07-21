import LlamaCloud from "@llamaindex/llama-cloud";

let client: LlamaCloud | undefined;

function getClient(): LlamaCloud {
  client ??= new LlamaCloud({
    apiKey: process.env.LLAMA_CLOUD_API_KEY,
  });
  return client;
}

export async function parseDocument(
  buffer: ArrayBuffer,
  fileName: string,
  fileType?: string
): Promise<string> {
  if (fileType === "txt" || fileName.toLowerCase().endsWith(".txt")) {
    return new TextDecoder().decode(buffer);
  }

  const file = new File([buffer], fileName);
  const llamaCloud = getClient();
  const fileObj = await llamaCloud.files.create({ file, purpose: "parse" });

  const result = await llamaCloud.parsing.parse({
    file_id: fileObj.id,
    version: "latest",
    tier: "fast",
    expand: ["markdown_full"],
  });
  return result.markdown_full ?? "";
}
