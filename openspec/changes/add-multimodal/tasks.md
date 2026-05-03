## 1. Fix Image-to-Model Pipeline

- [x] 1.1 Create `lib/ai/image-utils.ts` with server-side `downloadAndEncodeImage(url, mediaType)` function: download image from Vercel Blob URL, resize to max 2048px if larger, encode as `data:image/...;base64,...` data URL
- [x] 1.2 In `app/(chat)/api/chat/route.ts`, between filtering and `convertToModelMessages`, preprocess image file parts: download, resize, and replace the `url` field with a base64 data URL
- [x] 1.3 Expand `IMAGE_TYPES` in route.ts from `["image/jpeg", "image/png"]` to include `image/gif`, `image/webp`
- [x] 1.4 Expand `filePartSchema` in schema.ts to accept `image/gif` and `image/webp`

## 2. Expand Document Upload and Ingestion

- [x] 2.1 Add XLSX, PPTX, TXT MIME types to `DOCUMENT_TYPES` array in `app/(chat)/api/files/upload/route.ts`
- [x] 2.2 Fix the hardcoded `fileType` mapping in upload route (currently `file.type.includes("pdf") ? "pdf" : "docx"`) to use a MIME-to-fileType lookup covering all six document types (pdf, docx, xlsx, pptx, txt)
- [x] 2.3 Update `FileSchema` refine error message in upload route to list all supported types (JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX, PPTX, TXT)
- [ ] 2.4 Verify LlamaCloud parsing works for XLSX, PPTX, and TXT file types (test upload + ingest + chunk cycle)

## 3. File Preview Improvements

- [x] 3.1 Add file-type-specific icons in `components/preview-attachment.tsx` for PDF, DOCX, XLSX, PPTX, TXT based on contentType
- [x] 3.2 Create `components/image-lightbox.tsx` component for full-size image viewing with close button and Escape key support
- [x] 3.3 Wire image thumbnails in `PreviewAttachment` to open the lightbox on click (covers both input preview and message history since both use PreviewAttachment)

## 4. Frontend Upload UX

- [x] 4.1 Add drag-and-drop event handlers to `MultimodalInput` for file drop support
- [x] 4.2 Expand `accept` attribute on hidden file input to include new image formats (GIF, WebP) and document types (XLSX, PPTX, TXT)
- [x] 4.3 Show visual drop zone indicator when files are dragged over the input area

## 5. Image Generation Tool

- [x] 5.1 Create `lib/ai/tools/generate-image.ts` with `generateImage` tool definition using SiliconFlow FLUX API (or compatible endpoint)
- [x] 5.2 Add `IMAGE_GEN_API_KEY` and `IMAGE_GEN_BASE_URL` to `.env.example` with defaults pointing to SiliconFlow
- [x] 5.3 Register `generateImage` tool in route.ts active tools list
- [x] 5.4 Render generated image in message component via tool output (Image component with click-to-lightbox in message.tsx)
- [x] 5.5 Handle image generation errors (API failure, timeout) with user-friendly error messages

## 6. Integration and Polish

- [x] 6.1 Run `pnpm lint` and fix all issues
- [x] 6.2 Run `pnpm build` to verify no type errors
- [ ] 6.3 Manual end-to-end test: upload image → verify model describes image content
- [ ] 6.4 Manual end-to-end test: upload XLSX/PPTX/TXT → verify ingestion and retrieval
- [ ] 6.5 Manual end-to-end test: request image generation → verify image appears in chat

## 7. Provider Compatibility Fixes

- [x] 7.1 Add `unoptimized` to `ImageLightbox` and generated image display in `message.tsx` to bypass `next/image` domain whitelist for non-whitelisted origins (SiliconFlow, etc.)
- [x] 7.2 Add `*.siliconflow.cn` to `next.config.ts` `remotePatterns` for generated image URLs
- [x] 7.3 Install `@ai-sdk/alibaba` and add `createAlibaba` to `lib/ai/providers.ts` for native DashScope API support
- [x] 7.4 Register `"alibaba"` as a provider format in DB schema, settings-schemas, queries, and provider form UI
- [x] 7.5 Add Alibaba-specific thinking mode in route.ts (`enableThinking` + `thinkingBudget`) instead of OpenAI-style `reasoning_effort`
- [ ] 7.6 Investigate MiniMax image input handling — MiniMax API converts base64 `image_url` to OSS text URL, model cannot "see" images (may need provider-specific image pre-upload flow)
