# Engram

Local-first, cross-agent memory built as an agent-assisted Zettelkasten.

A plain-Markdown vault (Git-versioned, Obsidian-compatible) is the canonical
memory. This binary is the deterministic **context compiler** over it — CLI and
MCP server in one, zero model calls. Agents query it for the *minimum
sufficient* context (every item carries a why-line; silence is a valid answer),
append session evidence, and propose candidate notes. Nothing becomes permanent
memory without the human promoting it.

Two invariants the code enforces structurally:

1. **Nothing enters `zettel/` or `maps/` without user gating.** Agents write
   only to `evidence/` and `inbox/`; unreviewed content is excluded from
   retrieval before scoring, not down-ranked.
2. **Every retrieval justifies every token.** Hard budgets, a relevance floor,
   explicit abstention, and per-item reasons for inclusion.

The full architecture plan (product definition, data model, retrieval design,
evaluation, phases) lives in the vault it creates, as `PLAN.md`.

## Quick setup (new machine)

Prerequisites: [Bun](https://bun.sh) ≥ 1.2, git.

```bash
git clone git@github.com:tlempert/engram.git
cd engram
bun install
bun test          # 104 tests should pass
bun link          # registers the `engram` command on your PATH
```

Create a vault (default `~/engram`; override with `$ENGRAM_VAULT`):

```bash
engram init ~/engram
```

Wire it into Claude Code — MCP server plus the usage skill:

```bash
claude mcp add --scope user engram -- ~/.bun/bin/engram serve
cp -r skill ~/.claude/skills/engram
```

Any other MCP client (Codex, OpenCode, …) points at the same command:
`~/.bun/bin/engram serve` over stdio, tools `memory_query`, `memory_expand`,
`memory_record`, `memory_propose`.

Optional:

- **SessionEnd hook** (deterministic housekeeping — expiry sweep + generated
  views): wire `hooks/session-end.sh` per the snippet inside it.
- **qmd hybrid retrieval**: register collections named `engram-zettel`,
  `engram-maps`, `engram-evidence` pointing at those vault folders, then keep
  `retriever: auto` in `_system/config.yaml`. Without qmd, built-in SQLite
  FTS5 (porter) does the searching.

### A second machine and your vault

The vault is a separate, private Git repo — it is *not* part of this code
repo and holds personal thinking. On another machine either `engram init` a
fresh vault, or sync your existing one through a **private** remote you add
yourself. Do not make a vault public.

## Daily use

| Command | What it does |
|---|---|
| `engram query "task"` | Compile a context bundle (`--project X --agent N --budget T --history --json`) |
| `engram expand ID…` | Full content for truncated items |
| `engram note "text"` | Quick-capture a fleeting note (yours, verbatim) |
| `engram review` | Curate the inbox — interactive on a TTY; `--list`, `--accept ID`, `--reject ID` |
| `engram record / propose --json '…'` | Agent capture paths (usually via MCP) |
| `engram stats · doctor · eval` | Health, integrity, and gold-probe checks |
| `engram rebuild` | Sweep expiries, rebuild indexes and generated views |

Weekly ritual (~15 min): `engram review`, `engram doctor`, `engram stats`.

## Layout it creates

```
vault/
├── zettel/  maps/      canonical · human-gated
├── inbox/   evidence/  agent-writable · candidates (30-day TTL) + session records
├── _system/            config, retrieval policies, templates, gold probes
├── _generated/ .index/ disposable — rebuilt by `engram rebuild`
└── archive/            expired and rejected material (audit trail)
```

Every mutation is a git commit; human-gated actions author as `tal`, agent
writes as `<agent> <agent@engram>` — `git log --author` is the audit trail.
