## Why

The chatbot currently lacks real multimodal capabilities: images uploaded by users are silently dropped before reaching the model, non-image file previews show only a generic "File" placeholder, document support is limited to PDF/DOCX, and there is no image generation ability. With domestic Chinese AI providers now offering mature vision and image generation models, this is the right time to make the chatbot truly multimodal.

## What Changes

- Fix image input so the model can actually see user-uploaded images by downloading and encoding image data before passing to the model
- Expand supported image formats from JPEG/PNG only to include GIF and WebP
- Add drag-and-drop file upload alongside existing paste and file picker
- Add proper file previews for all document types (PDF, DOCX, XLSX, PPTX, TXT) with file type icons
- Add image lightbox/gallery for viewing attached images at full size
- Extend document upload and ingestion to support XLSX, PPTX, and plain text files in the RAG pipeline
- Add image generation capability via domestic AI models as a chat tool
- Ensure domestic vision models (Qwen-VL, GLM-4V) can receive and process image inputs

## Capabilities

### New Capabilities

- `image-input`: Upload images via file picker, paste, or drag-and-drop; model receives the image content for vision understanding. Supports JPEG, PNG, GIF, WebP.
- `image-generation`: Model can invoke an image generation tool to create images based on user descriptions, with results streamed back as image deltas.
- `file-preview`: Attached files render meaningful previews — images show thumbnails with lightbox zoom, documents show type-specific icons or thumbnails.
- `document-upload`: Upload and ingest XLSX, PPTX, and TXT documents into the RAG pipeline, expanding beyond PDF/DOCX.

### Modified Capabilities

None — all existing capabilities are preserved as-is.

## Impact

- **Route**: `app/(chat)/api/chat/route.ts` — image preprocessing logic before `convertToModelMessages`, expanded `IMAGE_TYPES` filter
- **Upload**: `app/(chat)/api/files/upload/route.ts` — expanded `DOCUMENT_TYPES`, new file type validation
- **RAG pipeline**: `lib/rag/parse.ts` — verify XLSX/PPTX/TXT parsing via LlamaCloud
- **New tool**: `lib/ai/tools/generate-image.ts` — image generation tool
- **Frontend**: `components/multimodal-input.tsx` — drag-and-drop, expanded accept types
- **Frontend**: `components/preview-attachment.tsx` — enhanced previews, lightbox
- **Frontend**: `components/message.tsx` — image lightbox in message history
- **Config**: `next.config.ts` — additional image remotePatterns if switching storage
- **Utilities**: `lib/ai/image-utils.ts` (new) — server-side image download, resize (max 2048px), and base64 encode helpers
