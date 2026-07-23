# Design System

> **Status**: Active
>
> **Scope**: FurryChatbot authenticated web product
>
> **Last verified**: 2026-07-22

## Direction

Restrained product UI based on the existing warm Claude-inspired surface, Notion-like information hierarchy, and the approved balanced project-home direction. The interface uses familiar navigation and compact data rows; visual distinction comes from spacing, type weight, and semantic state rather than decoration.

## Color and Theme

Use the light and dark semantic tokens in `app/globals.css`. Accent color is reserved for primary actions, selection, focus, and state. Ready, processing, failed, destructive, disabled, hover, and focus states must remain distinguishable in both themes and without color alone.

## Typography

Geist Sans is the single product type family, with Geist Mono for code. Use fixed product sizes: 12px metadata, 14px controls and rows, 16–18px section headings, and 20–24px page-level headings. Do not use display typography in controls.

## Layout

Use the Tailwind 4-point spacing scale. Related rows use 4–12px gaps; sections use 24–32px separation. Product pages are capped near `max-w-6xl`. The project overview becomes a conversation-first main column plus a 22rem knowledge summary only when the main content has sufficient width; mobile uses one column.

## Components and Interaction

- Reuse primitives in `components/ui/` and Lucide icons already present in the product.
- Cards top out at the existing 8–12px radius. Prefer dividers and whitespace for lists.
- Product transitions run for 150–250ms, convey state, and respect reduced motion.
- Mobile and coarse-pointer actions provide at least 44×44px hit areas.
- Empty states explain value and offer one clear next action. Errors state what failed and how to recover.
- Artifact generation uses a lightweight read-only live preview. Load the type-specific editor only after generation finishes; on failure, preserve partial content and provide explicit retry and close actions.
