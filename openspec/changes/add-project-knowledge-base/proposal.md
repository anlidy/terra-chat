# Proposal: Add project knowledge bases

## Why

Documents are currently scoped directly to one chat, so users must upload the same sources repeatedly and cannot organize related conversations as one durable body of work.

## What Changes

- Add personal projects containing multiple chats and one shared RAG knowledge collection.
- Keep independent chats and allow owned chats to move into or out of projects without losing chat attachments.
- Add a balanced project home, nested project chats in the sidebar, and a responsive knowledge-file manager.
- Replace chat-bound retrieval with owner-checked collection scopes.
- Persist ingestion stages and move knowledge documents to a separate private Blob store.

## Non-goals

- Multi-user membership, invitations, or role-based access.
- Project-specific model selection or custom instructions.
- Per-chat exclusion of individual project files.
