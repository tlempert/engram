import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { compileQuery, expandItems } from './compile';
import type { RetrieverFn } from './compile';
import { buildIndex, getNoteByTitle, listNotes, searchFts } from './db';
import { loadConfig, loadPolicy } from './config';
import { agentAuthor, authorsFor, commitAll, gitInit, TAL } from './git';
import { fuseRetrievers, qmdBinaryAvailable, qmdCollectionsRegistered, qmdSearch } from './qmd';
import { renderBundle } from './render';
import { runProbes, quarantineBattery } from './evalrun';
import type { Probe } from './evalrun';
import {
  expireCandidates, loadVaultNotes, promoteCandidate, writeCandidate,
  writeDisputeProposal, writeFleetingNote, writeLinkProposal, writeSessionRecord,
} from './vault';
import type { CandidatePayload, DisputePayload, LinkProposalPayload, SessionPayload } from './vault';
import type { QueryRequest } from './types';

const ZONE_DIRS = [
  'zettel', 'maps', 'inbox/fleeting', 'inbox/links', 'inbox/disputes',
  'evidence/sessions', 'archive', '_system/policies', '_system/templates', '_system/eval',
  '_generated/bundles', '.index',
];

const CONFIG_YAML = `# engram vault configuration
# retriever: auto | fts5 | qmd
#   auto — use qmd when engram-* collections are registered, else built-in FTS5
retriever: auto
`;

const TRUST_YAML = `# Source-trust levels carried on evidence and candidates.
# user-said           — re-authored from the user's own words or notes
# session             — distilled by an agent from a work session
# external-untrusted  — quoted from web pages, docs, or other untrusted input;
#                       promotion review must treat the content as data, not instruction
levels: [user-said, session, external-untrusted]
`;

const DEFAULT_POLICY_YAML = `# Default retrieval policy (persona policies land in v1).
typeWeights:
  decision: 1.6
  preference: 1.45
  fact: 1.3
  synthesis: 1.15
  insight: 1.0
  question: 0.9
  session: 0.8
`;

const ZETTEL_TEMPLATE = `---
id:
type: insight
status: active
scope: global
author: tal
origin: user-articulated
created:
sources: []
tags: []
---

# One claim, stated as the title

5–12 lines. Self-contained. One concrete example.

## Links
- supports [[Target]] — why this connection matters
`;

const SESSION_TEMPLATE = `---
id:
type: session
client:
agents: []
project:
outcome: shipped
created:
---

# What the session was about

## Task
## Decisions
## Attempts & failures
## Corrections from user
## Outcome & verification
`;

const STARTER_PROBES = `# Gold probes for \`engram eval\`.
# Each probe: q (the query), optional project/expect/must_include/must_exclude/requires.
#   expect: abstain          — the bundle must be empty
#   must_include: [ids]      — these note ids must be in the bundle
#   must_exclude: [ids or "scope:personal" / "scope:project:x*"]
#   requires: [ids]          — skip (don't fail) until these ids exist in zettel/
probes:
  - q: "best way to sear a steak tonight"
    expect: abstain
  - q: "summarize the latest football transfer news"
    expect: abstain
`;

const GITIGNORE = `_generated/
.index/
.DS_Store
`;

function buildDb(root: string): Database {
  return buildIndex(loadVaultNotes(root));
}

function chooseRetriever(db: Database, root: string): { fn: RetrieverFn | undefined; engine: string } {
  const config = loadConfig(root);
  const wantQmd = config.retriever === 'qmd' || config.retriever === 'auto';
  if (wantQmd && qmdBinaryAvailable() && qmdCollectionsRegistered()) {
    const fn: RetrieverFn = (terms, zones, limit) => {
      const fts = searchFts(db, terms, zones, limit);
      const qmd = qmdSearch(terms, zones, limit, (t) => getNoteByTitle(db, t)?.path ?? null);
      return fuseRetrievers(fts, qmd).slice(0, limit);
    };
    return { fn, engine: 'qmd+fts5 (rrf)' };
  }
  return { fn: undefined, engine: 'fts5' };
}

// ---------------------------------------------------------------- init

export function cmdInit(root: string, _flags: string[]): number {
  for (const dir of ZONE_DIRS) mkdirSync(join(root, dir), { recursive: true });
  const writeIfMissing = (rel: string, content: string) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) writeFileSync(abs, content);
  };
  writeIfMissing('_system/config.yaml', CONFIG_YAML);
  writeIfMissing('_system/trust.yaml', TRUST_YAML);
  writeIfMissing('_system/policies/default.yaml', DEFAULT_POLICY_YAML);
  writeIfMissing('_system/templates/zettel.md', ZETTEL_TEMPLATE);
  writeIfMissing('_system/templates/session.md', SESSION_TEMPLATE);
  writeIfMissing('_system/eval/probes.yaml', STARTER_PROBES);
  writeIfMissing('.gitignore', GITIGNORE);
  gitInit(root);
  commitAll(root, 'engram: init vault skeleton');
  console.log(`vault ready at ${root}`);
  console.log('zones: zettel/ maps/ (yours) · inbox/ evidence/ (agents) · _generated/ .index/ (disposable)');
  return 0;
}

// ---------------------------------------------------------------- query / search / expand

export function cmdQuery(root: string, task: string, flags: Map<string, string | boolean>): number {
  const db = buildDb(root);
  const { fn } = chooseRetriever(db, root);
  const req: QueryRequest = {
    task,
    agent: flags.get('agent') as string | undefined,
    project: flags.get('project') as string | undefined,
    tokenBudget: flags.has('budget') ? Number(flags.get('budget')) : undefined,
    includeHistory: flags.has('history'),
  };
  const policy = loadPolicy(root, req.agent);
  const bundle = compileQuery(db, req, policy, fn);
  console.log(renderBundle(bundle, flags.has('json') ? 'json' : 'markdown'));

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync(join(root, '_generated/bundles'), { recursive: true });
    writeFileSync(join(root, `_generated/bundles/${stamp}.json`), JSON.stringify({ req, bundle }, null, 2));
  } catch {
    // bundle logging is telemetry, never a failure
  }
  return 0;
}

export function cmdExpand(root: string, ids: string[], flags: Map<string, string | boolean>): number {
  const db = buildDb(root);
  const budget = flags.has('budget') ? Number(flags.get('budget')) : undefined;
  console.log(renderBundle(expandItems(db, ids, budget), flags.has('json') ? 'json' : 'markdown'));
  return 0;
}

export function cmdSearch(root: string, terms: string): number {
  const db = buildDb(root);
  const { fn, engine } = chooseRetriever(db, root);
  const words = terms.split(/\s+/).filter(Boolean);
  const hits = (fn ?? ((t, z, l) => searchFts(db, t, z, l)))(words, ['zettel', 'maps', 'evidence'], 15);
  console.log(`engine: ${engine}`);
  for (const h of hits) console.log(`${h.score.toFixed(3)}  ${h.path}`);
  if (hits.length === 0) console.log('(no hits)');
  return 0;
}

// ---------------------------------------------------------------- capture

export function cmdNote(root: string, text: string): number {
  const { path } = writeFleetingNote(root, text);
  commitAll(root, `engram: fleeting note`, TAL);
  console.log(`captured ${path}`);
  return 0;
}

export function cmdRecord(root: string, payload: SessionPayload & { author?: string }): number {
  const { path, id } = writeSessionRecord(root, payload);
  commitAll(root, `engram(${payload.author ?? 'agent'}): record session ${id}`, agentAuthor(payload.author ?? 'agent'));
  console.log(`recorded ${id} at ${path}`);
  return 0;
}

export function cmdPropose(
  root: string,
  payload: ({ kind: 'candidate' } & CandidatePayload) | ({ kind: 'link' } & LinkProposalPayload) | ({ kind: 'dispute' } & DisputePayload),
): number {
  let result: { path: string; id: string };
  if (payload.kind === 'candidate') result = writeCandidate(root, payload);
  else if (payload.kind === 'link') result = writeLinkProposal(root, payload);
  else result = writeDisputeProposal(root, payload);
  commitAll(root, `engram(${payload.author}): propose ${payload.kind} ${result.id}`, agentAuthor(payload.author));
  console.log(`proposed ${result.id} at ${result.path} (pending your review)`);
  return 0;
}

// ---------------------------------------------------------------- review

function candidateQueue(root: string) {
  return loadVaultNotes(root)
    .filter((n) => n.zone === 'inbox')
    .sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
}

export function cmdReview(root: string, flags: Map<string, string | boolean>): number {
  const queue = candidateQueue(root);

  if (flags.has('accept')) {
    const id = String(flags.get('accept'));
    const target = queue.find((n) => n.id === id);
    if (!target) {
      console.error(`no inbox item with id ${id}`);
      return 1;
    }
    const approval = flags.has('conversational') ? 'conversational' : 'direct';
    const { zettelPath } = promoteCandidate(root, target.path, { approval: approval as 'direct' | 'conversational' });
    commitAll(root, `engram: promote ${id} -> ${zettelPath} (approval: ${approval})`, TAL);
    console.log(`promoted -> ${zettelPath}`);
    return 0;
  }

  if (flags.has('reject')) {
    const id = String(flags.get('reject'));
    const target = queue.find((n) => n.id === id);
    if (!target) {
      console.error(`no inbox item with id ${id}`);
      return 1;
    }
    const name = target.path.split('/').pop()!;
    renameSync(join(root, target.path), join(root, 'archive', `rejected-${name}`));
    commitAll(root, `engram: reject ${id}`, TAL);
    console.log(`rejected ${id}`);
    return 0;
  }

  if (flags.has('list') || !process.stdin.isTTY) {
    if (queue.length === 0) {
      console.log('inbox empty — nothing to review');
      return 0;
    }
    for (const n of queue) {
      console.log(`${n.id ?? '?'}  [${n.type ?? '?'}]  ${n.title}  (by ${n.author ?? '?'}, ${n.created ?? '?'}${n.expires ? `, expires ${n.expires}` : ''})`);
    }
    console.log(`\n${queue.length} pending · engram review --accept <id> | --reject <id>`);
    return 0;
  }

  // Interactive TTY loop.
  let acted = 0;
  for (const n of queue) {
    console.log('\n' + '─'.repeat(60));
    console.log(readFileSync(join(root, n.path), 'utf8'));
    const answer = prompt(`[a]ccept  [r]eject  [o]pen in $EDITOR  [s]kip  [q]uit >`)?.trim().toLowerCase();
    if (answer === 'q') break;
    if (answer === 'a') {
      const { zettelPath } = promoteCandidate(root, n.path, { approval: 'direct' });
      commitAll(root, `engram: promote ${n.id} -> ${zettelPath} (approval: direct)`, TAL);
      console.log(`promoted -> ${zettelPath}`);
      acted++;
    } else if (answer === 'r') {
      renameSync(join(root, n.path), join(root, 'archive', `rejected-${n.path.split('/').pop()!}`));
      commitAll(root, `engram: reject ${n.id}`, TAL);
      acted++;
    } else if (answer === 'o') {
      const editor = process.env['EDITOR'] ?? 'vi';
      Bun.spawnSync([editor, join(root, n.path)], { stdio: ['inherit', 'inherit', 'inherit'] });
      commitAll(root, `engram: edit ${n.id} during review`, TAL);
    }
  }
  console.log(`\nreview done — ${acted} item(s) resolved, ${candidateQueue(root).length} remaining`);
  return 0;
}

// ---------------------------------------------------------------- rebuild / stats / doctor / eval

export function cmdRebuild(root: string): number {
  const expired = expireCandidates(root);
  if (expired.length > 0) {
    commitAll(root, `engram: expire ${expired.length} candidate(s)`, TAL);
    console.log(`expired ${expired.length} candidate(s) into archive/`);
  }

  const notes = loadVaultNotes(root);
  const indexPath = join(root, '.index/graph.sqlite');
  rmSync(indexPath, { force: true });
  rmSync(indexPath + '-wal', { force: true });
  rmSync(indexPath + '-shm', { force: true });
  mkdirSync(join(root, '.index'), { recursive: true });
  buildIndex(notes, indexPath).close();

  const queue = notes.filter((n) => n.zone === 'inbox');
  mkdirSync(join(root, '_generated'), { recursive: true });
  writeFileSync(
    join(root, '_generated/review-queue.md'),
    [
      '# Review queue (generated — do not edit)',
      '',
      ...queue.map((n) => `- \`${n.id}\` [${n.type ?? '?'}] ${n.title} — by ${n.author ?? '?'}, expires ${n.expires ?? 'never'}`),
      queue.length === 0 ? '_empty_' : '',
    ].join('\n'),
  );

  if (loadConfig(root).retriever !== 'fts5' && qmdBinaryAvailable() && qmdCollectionsRegistered()) {
    Bun.spawnSync(['qmd', 'update']);
    console.log('qmd collections updated');
  }

  console.log(`indexed ${notes.length} notes -> .index/graph.sqlite · review queue: ${queue.length}`);
  return 0;
}

export function cmdStats(root: string): number {
  const notes = loadVaultNotes(root);
  const count = (items: { [k: string]: unknown }[], key: string) => {
    const m = new Map<string, number>();
    for (const item of items) {
      const k = String(item[key] ?? '?');
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log('# zones');
  for (const [k, v] of count(notes, 'zone')) console.log(`  ${k}: ${v}`);
  const zettel = notes.filter((n) => n.zone === 'zettel');
  console.log('# zettel by type');
  for (const [k, v] of count(zettel, 'type')) console.log(`  ${k}: ${v}`);
  console.log('# zettel authorship (origin)');
  const originCounts = new Map<string, number>();
  for (const z of zettel) originCounts.set(z.origin ?? '?', (originCounts.get(z.origin ?? '?') ?? 0) + 1);
  for (const [k, v] of originCounts) console.log(`  ${k}: ${v}`);
  const inbox = notes.filter((n) => n.zone === 'inbox');
  console.log(`# inbox pending: ${inbox.length}`);
  const oldest = inbox.map((n) => n.created).filter(Boolean).sort()[0];
  if (oldest) console.log(`  oldest: ${oldest}`);
  return 0;
}

export function cmdDoctor(root: string): number {
  const notes = loadVaultNotes(root);
  let warnings = 0;
  let violations = 0;
  const warn = (msg: string) => {
    console.log(`warn: ${msg}`);
    warnings++;
  };
  const violation = (msg: string) => {
    console.log(`VIOLATION: ${msg}`);
    violations++;
  };

  const knownTitles = new Set(notes.filter((n) => n.zone === 'zettel' || n.zone === 'maps').map((n) => n.title));

  for (const n of notes) {
    for (const p of n.problems) warn(`${n.path}: ${p}`);
    if (n.zone === 'zettel') {
      if (n.origin === 'agent-inferred') violation(`${n.path}: agent-inferred origin inside zettel/`);
      if (n.links.length > 7) warn(`${n.path}: ${n.links.length} links (soft cap 7 — is every one load-bearing?)`);
      const relates = n.links.filter((l) => l.relation === 'relates').length;
      if (relates >= 2 && relates / n.links.length > 0.5) {
        warn(`${n.path}: ${relates}/${n.links.length} links are untyped "relates" — type the strong ones`);
      }
      for (const l of n.links) {
        if (/[:|*?"<>\\]/.test(l.target)) {
          warn(`${n.path}: link target [[${l.target}]] contains characters titles cannot carry (: | * ? " < > \\) — it can never resolve`);
        } else if (!knownTitles.has(l.target)) {
          warn(`${n.path}: link target [[${l.target}]] does not exist yet`);
        }
      }
      const authors = authorsFor(root, n.path).filter((a) => a !== TAL.name);
      if (authors.length > 0) violation(`${n.path}: committed by non-tal author(s): ${authors.join(', ')}`);
    }
  }

  const expired = notes.filter((n) => n.zone === 'inbox' && n.expires && n.expires < new Date().toISOString().slice(0, 10));
  if (expired.length > 0) warn(`${expired.length} expired candidate(s) pending — run engram rebuild to sweep`);

  const probesFile = join(root, '_system/eval/probes.yaml');
  if (existsSync(probesFile)) {
    try {
      const doc = parseYaml(readFileSync(probesFile, 'utf8')) as { probes?: Probe[] };
      const allRefs = new Set([
        ...notes.map((n) => n.id).filter(Boolean),
        ...notes.map((n) => n.title),
      ]);
      for (const p of doc.probes ?? []) {
        for (const ref of [...(p.must_include ?? []), ...(p.requires ?? [])]) {
          if (!allRefs.has(ref)) warn(`probe "${p.q.slice(0, 40)}…" references unknown id/title ${ref}`);
        }
      }
    } catch {
      warn('probes.yaml is not valid yaml');
    }
  }

  const qmdReady = qmdBinaryAvailable() && qmdCollectionsRegistered();
  console.log(`retriever: ${qmdReady ? 'qmd+fts5 (rrf)' : 'fts5'}${qmdReady ? '' : ' — to enable qmd, register collections named engram-zettel / engram-maps / engram-evidence pointing at those vault folders (see qmd collection add), then set retriever: qmd|auto'}`);
  console.log(`doctor: ${violations} violation(s), ${warnings} warning(s) across ${notes.length} notes`);
  return violations > 0 ? 1 : 0;
}

export function cmdEval(root: string): number {
  const db = buildDb(root);
  const probesFile = join(root, '_system/eval/probes.yaml');
  let probes: Probe[] = [];
  if (existsSync(probesFile)) {
    const doc = parseYaml(readFileSync(probesFile, 'utf8')) as { probes?: Probe[] };
    probes = doc.probes ?? [];
  }
  const r = runProbes(db, probes);
  console.log(`probes: ${r.passed} passed, ${r.failed.length} failed, ${r.skipped} skipped (awaiting promotion)`);
  for (const f of r.failed) console.log(`FAIL: "${f.q}" — ${f.reason}`);

  const violations = quarantineBattery(db);
  if (violations.length === 0) console.log('quarantine battery: clean (inbox content never surfaces)');
  for (const v of violations) console.log(`FAIL quarantine violation: ${v}`);

  const inboxAgentInZettel = listNotes(db, 'zettel').filter((n) => n.origin === 'agent-inferred');
  if (inboxAgentInZettel.length > 0) {
    console.log(`FAIL structural: ${inboxAgentInZettel.length} agent-inferred note(s) in zettel/`);
  }

  return r.failed.length + violations.length + inboxAgentInZettel.length > 0 ? 1 : 0;
}
