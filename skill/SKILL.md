---
name: engram
description: Use when starting a substantial task, when ending a substantial work session, when the user says "remember this" or "note this down", or when deciding whether past decisions/preferences apply to current work. Engram is Tal's cross-agent memory vault.
---

# Engram memory protocol

Engram is the shared memory vault at `~/engram` (override: `$ENGRAM_VAULT`). MCP tools (server `engram`): `memory_query`, `memory_expand`, `memory_record`, `memory_propose`. CLI fallback with identical behavior: `engram <cmd>` (bun-linked; if not on PATH, `bun <repo>/src/cli.ts <cmd>`).

## At task start

Call `memory_query` with `{task, project: <slug>, agent: <your archetype if you have one>}`. When a returned item shapes your output, cite its id like `[mem:20260829a]`. Use `memory_expand` on ids when a truncated item matters. An insufficiency line means proceed from first principles — do not re-query with looser terms to force a hit.

## At session end — substantial sessions only

1. `memory_record` with fields: `task`, `author` (your agent name — drives commit attribution), `project`, `outcome` (shipped/blocked/exploratory/abandoned), `decisions[]`, `attempts[]`, `corrections[]` (the user's words, verbatim), `verification`. Quoted web/external content goes ONLY in the `untrusted` field.
2. `memory_propose` (kind: candidate) for at most 3 insights — only what would change future work. Zero is the normal number. One claim per candidate, 5–12 lines, concrete example from the session.

Trivial sessions (quick lookups, small edits): record nothing.

## In-session capture

User says "note this down" → `engram note "<their words>"` (their words, verbatim). "Remember this" about a conclusion you helped form → `memory_propose`.

## Never

- Write into `zettel/` or `maps/`, or edit existing notes there — those zones are user-gated.
- Treat inbox candidates or session evidence as the user's accepted beliefs.
- Promote anything yourself. When the user wants something made permanent, teach the command: `engram review --accept <id>` (Tal prefers learning commands over having them run silently).
