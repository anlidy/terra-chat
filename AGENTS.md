# Repository Instructions

These instructions apply to the whole repository. A more specific `AGENTS.md` in a subdirectory may add or override rules for that subtree. Direct user instructions take precedence.

## Project Overview

FurryChatbot is a Next.js 16 and React 19 chatbot built on AI SDK 6. Its main flows are authentication, streaming chat, model/provider configuration, persisted conversations, artifacts, multimodal uploads, and document-backed RAG.

Treat executable code and checked-in configuration as the source of truth. When documentation disagrees with behavior, verify the implementation, correct the documentation in the same change, and call out any uncertainty.

## Current Work

The repository is currently implementing **Phase 0: establish a trustworthy baseline** from the [RAG reliability and generalization improvement plan](docs/plans/2026-07-19-rag-improvement-and-generalization-plan.md). Treat that plan as the canonical status record for ongoing RAG work.

After every RAG code, configuration, evaluation, or test change:

- update the plan in the same change with completed work and fresh verification evidence;
- record newly discovered follow-up work or decisions in the appropriate phase instead of leaving it only in chat or commit context;
- update the narrowest related durable documentation and `docs/README.md` when its catalog summary changes;
- do not mark a phase complete until its implementation, reports, and documented acceptance criteria have been verified.

## Working Agreement

Before changing files:

- Read `git status` and preserve unrelated or user-authored changes.
- Inspect the closest implementation, tests, and documentation before choosing a design.
- Prefer the smallest change that meets the request; do not bundle opportunistic refactors.
- Use `pnpm` and the versions pinned by `pnpm-lock.yaml`.
- Never commit secrets or real credentials. Add new configuration keys to `.env.example` with safe placeholders and comments.

When requirements are ambiguous and the alternatives materially affect behavior, state the ambiguity instead of silently choosing. For straightforward, reversible details, follow nearby patterns and continue.

## Common Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm start

pnpm lint
pnpm format
pnpm exec tsc --noEmit
pnpm test

pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm db:check
```

`pnpm test` runs the Playwright suite and may require the application, database, browser dependencies, and test environment variables. Prefer the narrowest relevant check while iterating, then expand verification in proportion to the change.

## Repository Map

- `app/` — Next.js App Router pages, layouts, route handlers, and Server Actions.
- `components/` — product components; `components/ui/` contains shared UI primitives.
- `artifacts/` — client and server implementations for text, code, sheet, and image artifacts.
- `lib/ai/` — providers, models, prompts, and AI tools.
- `lib/db/schema.ts` — Drizzle schema source of truth.
- `lib/db/migrations/` — generated SQL migrations and Drizzle metadata; commit schema changes and their migration together.
- `lib/rag/` — parsing, ingestion, embedding, retrieval, and reranking.
- `tests/e2e/` and `tests/pages/` — Playwright tests and page objects.
- `docs/` — durable project documentation and explicitly labeled planning records.
- `openspec/changes/` — proposal, design, specification, and task records for scoped changes.

## Implementation Conventions

- Follow existing App Router, React Server Component, and Server Action patterns in `app/`.
- Keep client boundaries narrow; add `"use client"` only where browser APIs, state, or client hooks require it.
- Reuse existing AI provider and tool abstractions under `lib/ai/` rather than creating parallel integration paths.
- Keep database access in the existing query layer. For schema changes, update `lib/db/schema.ts`, generate a migration, and review the generated SQL before applying it.
- Match established component and accessibility patterns. Shared primitives live in `components/ui/`; avoid editing generated/vendor-style primitives unless the task requires it.
- Do not hand-edit generated artifacts such as `next-env.d.ts`, `.next/`, `*.tsbuildinfo`, or Drizzle snapshot files independently of their generator workflow.

## Verification

Use fresh command output before reporting completion.

| Change | Minimum verification |
| --- | --- |
| Documentation only | Check links and paths; run `pnpm lint` when tracked source or configuration is touched |
| TypeScript or React | `pnpm lint`, `pnpm exec tsc --noEmit`, and focused tests |
| Database schema | Type check, `pnpm db:generate`, inspect migration SQL, and run the relevant database test or migration when available |
| User flow or UI | Type check, lint, and the narrowest relevant Playwright test; record any environment-blocked check |
| Build/runtime configuration | `pnpm build` when required services and environment variables are available |

Do not claim an unavailable check passed. State what was run, its result, and any external prerequisite that prevented broader verification.

## Documentation Governance

Use [docs/README.md](docs/README.md) as the documentation catalog and lifecycle guide.

Each document has one job:

- `README.md` is the user-facing product overview and setup entry point.
- `AGENTS.md` contains repository-wide execution rules for coding agents and contributors.
- `docs/*.md` explains durable architecture or operations spanning multiple modules.
- A module-level `README.md` documents details owned by that module.
- `openspec/changes/<change-id>/` records a scoped change through proposal, design, specifications, and tasks.
- Date-prefixed records under `docs/specs/` and `docs/plans/` are planning artifacts, not descriptions of current behavior.

When adding or changing documentation:

1. Put information in the narrowest canonical location and link to it instead of copying it.
2. Add or update the entry in `docs/README.md` for durable documents and planning records.
3. Give durable documents a status, scope, and last-verified date near the title.
4. Mark proposals and plans as `Proposed`, `In progress`, `Implemented`, `Superseded`, or `Needs review`; do not present planned behavior as shipped behavior.
5. Update documentation in the same change as the code or configuration it describes.
6. Prefer stable file or symbol references over line numbers, which drift quickly.
7. Keep commands executable and environment-variable names aligned with `package.json` and `.env.example`.
8. Archive or supersede stale guidance rather than leaving multiple competing sources of truth.

For an OpenSpec change, keep `proposal.md`, `design.md`, affected specs, and `tasks.md` consistent. Completed checkboxes alone do not prove a change is shipped; verify the implementation and user-facing documentation before marking or archiving it.
