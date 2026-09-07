#!/usr/bin/env bun
/**
 * SwarmForge → Engram recorder.
 *
 * SwarmForge owns coordination (board, handoffs, worktrees); Engram owns
 * durable memory. This is the single writer between them: for every board
 * card in lane `done` that has no marker yet, file one session record built
 * from the operator's task document and the completed handoffs, keyed by
 * `swarmforge:<slug>:<task-id>`. Engram's externalId makes a retry after a
 * crash return the existing record, so the marker is a cache, not the truth.
 *
 * Run from anywhere:  bun record-cards.ts --root <swarmforge project> [--slug <project slug>]
 * Idempotent; safe to run after every Done, on a timer, or by hand.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { recordSession } from '../src/commands';
import { defaultVaultRoot } from '../src/config';

interface Card {
  name: string;
  lane: string;
  updated: string;
  key: string; // task-id, falling back to name for old boards
}

interface Handoff {
  from: string;
  to: string;
  type: string;
  task: string;
  taskId: string;
  commit: string;
  createdAt: string;
  completedAt: string;
}

function parseArgs(argv: string[]): { root: string; slug: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = get('--root') ?? process.cwd();
  return { root, slug: get('--slug') ?? basename(root) };
}

function readCards(root: string): Card[] {
  const file = join(root, '.swarmforge/board/tasks.tsv');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.split('\t'))
    .map(([name = '', lane = '', , updated = '', taskId = '']) => ({ name, lane, updated, key: taskId || name }));
}

/** roles.tsv columns: role, worktree-name, worktree-path, session, display, agent, mode, propagation. */
function worktrees(root: string): string[] {
  const file = join(root, '.swarmforge/roles.tsv');
  if (!existsSync(file)) return [root];
  const paths = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.split('\t')[2] ?? '')
    .filter(Boolean);
  return [...new Set([root, ...paths])];
}

function parseHandoff(text: string): Handoff {
  const h: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) break; // headers end at the first blank line
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    from: h['from'] ?? '', to: h['to'] ?? '', type: h['type'] ?? '', task: h['task'] ?? '', taskId: h['task_id'] ?? '',
    commit: h['commit'] ?? '', createdAt: h['created_at'] ?? '', completedAt: h['completed_at'] ?? '',
  };
}

/** Completed handoffs across all role worktrees, including batch directories. */
function completedHandoffs(root: string): Handoff[] {
  const out: Handoff[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) visit(abs);
      else if (entry.endsWith('.handoff')) out.push(parseHandoff(readFileSync(abs, 'utf8')));
    }
  };
  for (const wt of worktrees(root)) visit(join(wt, '.swarmforge/handoffs/inbox/completed'));
  return out;
}

function taskDocument(root: string, name: string): string {
  const file = join(root, 'tasks', `${name}.md`);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').replace(/^#\s.*\n+/, '').trim();
}

function writeMarker(dir: string, key: string, id: string): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${key}.tmp-${process.pid}`);
  writeFileSync(tmp, `${id}\n`);
  renameSync(tmp, join(dir, key));
}

function main(): number {
  const { root, slug } = parseArgs(process.argv.slice(2));
  const vault = defaultVaultRoot();
  const markers = join(root, '.swarmforge/memory/recorded');
  const done = readCards(root).filter((c) => c.lane === 'done' && !existsSync(join(markers, c.key)));
  const handoffs = completedHandoffs(root);

  let fresh = 0;
  let existed = 0;
  for (const card of done) {
    const route = handoffs
      .filter((h) => h.type === 'git_handoff' && (h.taskId === card.key || (!h.taskId && h.task === card.name)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const terminal = route[route.length - 1];
    const doc = taskDocument(root, card.name);

    const result = recordSession(vault, {
      task: doc ? `${card.name}\n\n${doc}` : card.name,
      externalId: `swarmforge:${slug}:${card.key}`,
      author: 'swarmforge-recorder',
      client: 'swarmforge',
      agents: [...new Set(route.map((h) => h.from))],
      project: slug,
      outcome: 'shipped',
      attempts: route.map((h) => `${h.from} → ${h.to} · commit ${h.commit} · completed ${h.completedAt || 'unknown'}`),
      verification: terminal
        ? `Board lane done at ${card.updated}; terminal git_handoff from ${terminal.from} at commit ${terminal.commit}.`
        : `Board lane done at ${card.updated}; no completed git_handoff found for this card.`,
      transcript: `${root}/.swarmforge/board/tasks.tsv#${card.key}`,
    });
    writeMarker(markers, card.key, result.id);
    if (result.existed) existed++;
    else fresh++;
    console.log(`${result.existed ? 'already recorded' : 'recorded'} ${card.name} -> ${result.id}`);
  }
  console.log(`record-cards: ${fresh} new, ${existed} already recorded, ${done.length} done card(s) checked`);
  return 0;
}

process.exit(main());
