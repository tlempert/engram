#!/usr/bin/env bun
import {
  cmdDoctor, cmdEval, cmdExpand, cmdInit, cmdNote, cmdPropose, cmdQuery,
  cmdRebuild, cmdRecord, cmdReview, cmdSearch, cmdStats,
} from './commands';
import { defaultVaultRoot } from './config';
import { serveMcp } from './mcp';

const HELP = `engram — cross-agent Zettelkasten memory

usage:
  engram init [path]                 scaffold a vault (default ~/engram or $ENGRAM_VAULT)
  engram query "task" [flags]        compile a minimal context bundle
      --project X --budget N --agent NAME --history --json
  engram expand ID [ID…] [--budget N]  full content for known note ids
  engram search "terms"              raw retriever hits (debug)
  engram note "text"                 quick-capture a fleeting note (yours)
  engram review [flags]              curate the inbox (interactive on a TTY)
      --list | --accept ID [--conversational] | --reject ID
  engram record --json '<payload>'   append a session record (agents)
  engram propose --json '<payload>'  propose candidate/link/dispute (agents)
  engram rebuild                     sweep expiries, rebuild indexes & generated views
  engram stats                       zone/type/authorship counts
  engram doctor                      health & integrity checks
  engram eval                        run gold probes + quarantine battery
  engram serve                       MCP server on stdio (memory_query/expand/record/propose)
`;

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string | boolean> } {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--') && ['project', 'budget', 'agent', 'accept', 'reject', 'json'].includes(key)) {
        if (key === 'json' && ['record', 'propose'].includes(args[0] ?? '')) {
          flags.set(key, next);
          i++;
        } else if (key !== 'json') {
          flags.set(key, next);
          i++;
        } else {
          flags.set(key, true);
        }
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags([cmd ?? '', ...rest]);
  positional.shift(); // drop the command itself
  const root = defaultVaultRoot();

  switch (cmd) {
    case 'init':
      return cmdInit(positional[0] ?? root, rest);
    case 'query': {
      if (!positional[0]) return (console.error('usage: engram query "task"'), 1);
      return cmdQuery(root, positional[0], flags);
    }
    case 'expand': {
      if (positional.length === 0) return (console.error('usage: engram expand ID [ID…]'), 1);
      return cmdExpand(root, positional, flags);
    }
    case 'search': {
      if (!positional[0]) return (console.error('usage: engram search "terms"'), 1);
      return cmdSearch(root, positional[0]);
    }
    case 'note': {
      if (!positional[0]) return (console.error('usage: engram note "text"'), 1);
      return cmdNote(root, positional.join(' '));
    }
    case 'review':
      return cmdReview(root, flags);
    case 'record': {
      const payload = JSON.parse(String(flags.get('json') ?? positional[0] ?? '{}'));
      return cmdRecord(root, payload);
    }
    case 'propose': {
      const payload = JSON.parse(String(flags.get('json') ?? positional[0] ?? '{}'));
      return cmdPropose(root, payload);
    }
    case 'rebuild':
      return cmdRebuild(root);
    case 'stats':
      return cmdStats(root);
    case 'doctor':
      return cmdDoctor(root);
    case 'eval':
      return cmdEval(root);
    case 'serve':
      await serveMcp(root);
      return 0;
    default:
      console.log(HELP);
      return cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`engram: ${(e as Error).message}`);
    process.exit(1);
  });
