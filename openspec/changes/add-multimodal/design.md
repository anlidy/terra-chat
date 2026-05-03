## Context

The current image upload flow has a critical bug: when `convertToModelMessages` processes file parts with URLs, it places the URL string into the `data` field of the model message content part. The downstream AI SDK provider (`@ai-sdk/openai`) then attempts to decode the URL string as base64, which fails, causing the image to be silently dropped. The model never sees the image.

Additionally, document upload is restricted to PDF/DOCX only in the upload route, despite the chat schema already listing XLSX/PPTX/TXT as valid media types. The RAG pipeline uses LlamaCloud for parsing which supports these formats natively.

On the frontend, `PreviewAttachment` only renders image thumbnails for image MIME types; all other files show a generic "File" placeholder. There is no image lightbox for viewing full-size images, and no drag-and-drop upload support in the active `MultimodalInput` component.

File storage uses Vercel Blob with `access: "public"`. The AI SDK is v6, using `@ai-sdk/openai` for OpenAI-compatible providers and `@ai-sdk/anthropic` for Anthropic-compatible providers. All Chinese domestic models use the OpenAI-compatible interface.

## Goals / Non-Goals

**Goals:**
- Fix the image-to-model pipeline so the model receives image data correctly
- Support JPEG, PNG, GIF, WebP image formats for vision input
- Enable drag-and-drop upload in the chat input
- Show meaningful file type previews for all supported document formats
- Add image lightbox for viewing attached images at full resolution
- Extend document upload/ingestion to XLSX, PPTX, TXT
- Add chat-based image generation via tool calling with domestic AI providers

**Non-Goals:**
- Video or audio input/support
- Real-time camera capture
- Image editing/annotation
- Replacing Vercel Blob storage (exploration only, not in this change)
- Anthropic provider vision support (works already; focus is on OpenAI-compatible providers where the bug manifests)

## Decisions

### 1. Image Preprocessing: Download + Encode Before convertToModelMessages

**Decision:** Before `convertToModelMessages`, download image URLs from Vercel Blob, resize large images server-side (max 2048px on longest side), and encode as data URLs (`data:image/...;base64,...`). Set the encoded data URL as the file part's `url` — the AI SDK's `convertToModelMessages` handles `data:` URLs correctly by passing them through as inline image content parts.

**Rationale:** The AI SDK's `convertToModelMessages` puts `part.url` into the content part's `data` field for file parts. When the URL is an external HTTP URL, the OpenAI provider checks `data instanceof Uint8Array` (false), then tries `convertBase64ToUint8Array(data)` which corrupts the URL string. By pre-downloading and encoding as a `data:` URL, we ensure the content part carries proper base64 image data. The `data:` URL format is recognized by `convertToModelMessages` and passed through correctly, producing valid `image_url` content blocks for OpenAI-compatible providers.

**Alternative considered:** Fix at the provider level with a custom `convertToModelMessages` override. Rejected because it couples the fix to a specific SDK version and is harder to maintain.

**Alternative considered:** Pass the Vercel Blob URL directly in the OpenAI `image_url` format. This works for public URLs but not all Chinese model APIs support URL-based image references (some require base64). Rejected for portability.

### 2. Image Generation: Tool-Based Architecture

**Decision:** Implement image generation as a chat tool (`generateImage`), not as a separate API endpoint or UI feature. The model decides when to call the tool. Results stream back via `imageDelta` in the UI message stream.

**Rationale:** Matches the existing tool pattern (getWeather, createDocument). Keeps image generation in the conversational flow rather than as a separate UI feature. The `imageDelta` type already exists in `CustomUIDataTypes`.

**Provider choice:** Use SiliconFlow (FLUX.1) as default. Users configure the API key and endpoint in their custom provider settings. The tool reads the user's providers to find an image-generation-capable one, or uses a dedicated environment variable `IMAGE_GEN_API_KEY`.

### 3. File Preview: Icon-Based with Lightbox

**Decision:** Show file-type-specific icons for documents (PDF, DOCX, XLSX, PPTX, TXT) and image thumbnails for images. Add a lightweight lightbox component for image zoom. Do NOT attempt server-side document thumbnail generation.

**Rationale:** Server-side thumbnail generation adds infrastructure complexity (pdf-to-image, etc.) that isn't justified for a preview feature. File type icons + filename provide sufficient at-a-glance identification. Lightbox handles the need to see images at full size.

### 4. Document Upload: Expand DOCUMENT_TYPES Array

**Decision:** Add XLSX, PPTX, TXT MIME types to the upload route's `DOCUMENT_TYPES` array and the input's `accept` attribute. Fix the hardcoded fileType mapping (`file.type.includes("pdf") ? "pdf" : "docx"`) to use a proper MIME-to-fileType lookup covering all six document types. Pass these new types to LlamaCloud for parsing. No new parsing infrastructure needed.

**Rationale:** LlamaCloud already supports these formats. The chat schema already accepts their media types. The only gaps are the upload route's type whitelist, the fileType mapping logic, and the frontend's accept attribute.

### 5. Image Size and Compression

**Decision:** Resize images larger than 2048px on the longest side server-side before base64 encoding, using sharp or a lightweight alternative in `lib/ai/image-utils.ts`. The upload size limit remains 20MB (unchanged).

**Rationale:** Large images inflate base64 size by 33%, potentially exceeding model API limits or causing memory pressure in the serverless function (a 20MB image becomes ~27MB of base64 text). Server-side resize ensures we control the encoding size independent of what the user uploaded. Client-side resize could be added later as an optimization to reduce upload traffic, but is not needed for correctness.

## Risks / Trade-offs

- **Vision model availability**: Not all Chinese models support vision. Users must select a vision-capable model (qwen-vl-max, glm-4v-plus, etc.). A text-only model will ignore image content or error.
  - Mitigation: Document which models support vision in the model selector hints.
- **Image generation latency**: FLUX.1 generation takes 5-30 seconds. The chat will show a loading state during generation.
  - Mitigation: Show tool invocation UI with loading indicator; time out at 60s.
- **Base64 encoding memory**: Large images encoded as base64 use significant server memory during the request (20MB raw → ~27MB base64 text in memory). Combined with the 60s `maxDuration`, this could stress serverless functions.
  - Mitigation: Server-side resize to max 2048px before encoding; enforce 20MB upload limit. Large images that survive resize will still be encoded, but a 2048px image is typically under 2MB.
