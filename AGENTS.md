# Engram (v2 code)

Cross-agent Zettelkasten memory: a Markdown vault is canonical, this binary is the
deterministic context compiler over it (CLI + MCP server, one core, zero model calls).
The full architecture plan lives in the vault at `~/engram/PLAN.md`.

## Invariants — never break these

1. **Nothing enters `zettel/` or `maps/` without user gating.** Agents append to
   `evidence/` and `inbox/` only. Promotion (`review --accept`, `memory.promote` in v1)
   is the single door, and it upgrades `agent-inferred` origin to `collaborative`.
2. **Retrieval must justify every token; silence is a valid answer.** Hard budgets,
   coverage floor, explicit insufficiencies. Never pad a bundle.
3. **Indexes are disposable.** SQLite/FTS5 and qmd are projections rebuilt from files;
   queries build a fresh in-memory index per call (no stale-index state anywhere).
4. **Quarantine is structural.** `inbox/` and `origin: agent-inferred` are excluded
   from retrieval and from `expand`, before scoring — not down-ranked.

## Map

| File | Role |
|---|---|
| `src/types.ts` | Note/link/bundle types, closed 9-relation vocabulary |
| `src/parse.ts` | Frontmatter + typed-link grammar + claim extraction |
| `src/db.ts` | bun:sqlite schema, FTS5 (porter), zone-restricted search |
| `src/text.ts` | content words, 3-gram shingle containment (dedupe) |
| `src/classify.ts` | task kind → evidence eligibility + default budget |
| `src/compile.ts` | the compiler: filters → coverage floor → score → pack; `expandItems` |
| `src/render.ts` | frozen markdown bundle contract (+json) |
| `src/vault.ts` | zone walker, promotion, session/candidate/link/dispute writers, expiry |
| `src/evalrun.ts` | gold-probe runner + quarantine battery |
| `src/qmd.ts` | qmd search adapter + RRF merge (retriever seam) |
| `src/git.ts` | commits: `tal <tal@engram>` for human-gated, `<agent> <agent@engram>` for evidence |
| `src/commands.ts` / `src/cli.ts` | command layer |
| `src/mcp.ts` | stdio MCP: memory_query / memory_expand / memory_record / memory_propose |

## Rules

- TDD: red first for any behavior change; `bun test` must stay green.
- v0 scope is frozen by PLAN.md §11. Do not build v1 features (link traversal, trails,
  personas, disputes UI, embeddings) without the user asking.
- No model calls inside this binary. Distillation happens in the calling agent.
- The rendered bundle format may grow fields, never change their meaning.
- Vault path: `$ENGRAM_VAULT` or `~/engram`.
