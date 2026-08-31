#!/bin/bash
# Engram SessionEnd hook: deterministic housekeeping only.
# Sweeps expired inbox candidates and refreshes _generated/ views.
# Distillation (memory_record) is skill-driven; an LLM-based backstop is a v1 item.
#
# Wire it in ~/.claude/settings.json (use the absolute path to this script):
#   "hooks": { "SessionEnd": [ { "hooks": [ { "type": "command",
#     "command": "<repo>/hooks/session-end.sh" } ] } ] }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "$DIR/../src/cli.ts" rebuild >/dev/null 2>&1
