# Design: Project knowledge bases

## Data and retrieval

Every project and chat owns a `KnowledgeCollection`. A project chat resolves to two collection IDs: its own chat collection and its project's collection. Independent chats resolve only to their chat collection. Resources are owned by a user and linked through `CollectionResource`; chunks only reference their resource.

Existing chat resources are migrated into generated chat collections before legacy `chatId` columns are removed. `IngestionJob` records queued, parsing, chunking, embedding, indexing, ready, failed, and cancelled states. Chunk replacement is transactional and idempotent for retries.

## Security

Project, chat, resource-status, content, retry, delete, and retrieval operations verify the authenticated owner. Knowledge files use a separate private Vercel Blob store and are streamed through an authenticated route. Public image attachments continue using the existing public store.

## Interface

The sidebar shows expandable projects with recent child chats and retains independent chat history below. `/projects/[id]` provides a Chats overview with a knowledge summary and a full Knowledge view. Project deletion permanently removes project files but moves its chats back to independent history.

The approved visual direction is restrained and warm, with conversation rows as the primary hierarchy, divider-based file lists, semantic ingestion badges, and a single-column mobile layout.
