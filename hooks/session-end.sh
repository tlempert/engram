#!/bin/bash
# Engram SessionEnd hook (v0): deterministic housekeeping only.
# Sweeps expired inbox candidates and refreshes _generated/ views.
# Distillation (memory_record) is skill-driven; an LLM-based backstop is a v1 item.
#
# Wire it in ~/.claude/settings.json:
#   "hooks": { "SessionEnd": [ { "hooks": [ { "type": "command",
#     "command": "/Users/tallempert/src-tal/engram/hooks/session-end.sh" } ] } ] }
exec bun /Users/tallempert/src-tal/engram/src/cli.ts rebuild >/dev/null 2>&1
