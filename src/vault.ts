import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify } from 'yaml';
import { parseNote } from './parse';
import type { ParsedNote } from './types';

/** Zones walked into the index. _system, _generated, .index, archive are not memory. */
const CONTENT_ZONES = ['zettel', 'maps', 'inbox', 'evidence'];

export interface PromoteOptions {
  now?: Date;
  approval?: 'direct' | 'conversational';
}

export interface SessionPayload {
  task: string;
  /** Idempotency key. A retry with the same key and content returns the existing record. */
  externalId?: string;
  client?: string;
  agents?: string[];
  project?: string;
  outcome?: string;
  decisions?: string[];
  attempts?: string[];
  corrections?: string[];
  verification?: string;
  transcript?: string;
  untrusted?: string;
}

export interface CandidatePayload {
  title: string;
  proposedType: string;
  body: string;
  author: string;
  sessionId?: string;
  scope?: string;
  tags?: string[];
  sources?: string[];
  sourceTrust?: string;
  proposedLinks?: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function ymdCompact(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function walk(dir: string, rel: string, out: { rel: string; abs: string }[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const abs = join(dir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    if (statSync(abs).isDirectory()) walk(abs, relPath, out);
    else if (entry.toLowerCase().endsWith('.md')) out.push({ rel: relPath, abs });
  }
}

export function loadVaultNotes(root: string): ParsedNote[] {
  const files: { rel: string; abs: string }[] = [];
  for (const zone of CONTENT_ZONES) walk(join(root, zone), zone, files);
  return files.map((f) => parseNote(readFileSync(f.abs, 'utf8'), f.rel));
}

/** Frontmatter serialized with stable key order; undefined values dropped. */
function fmBlock(fields: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  return `---\n${yamlStringify(clean).trimEnd()}\n---\n`;
}

/**
 * Titles double as filenames and wikilink targets, so they must be legal in
 * Obsidian/macOS and IDENTICAL in both roles. Colon/slash become a spaced
 * em-dash; Obsidian-illegal characters are dropped.
 */
function sanitizeTitle(title: string): string {
  return title
    .replace(/\s*[:/\\|]+\s*/g, ' — ')
    .replace(/[*?"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Next free zettel id for the day: 20260830a, 20260830b, … 20260830aa. */
function newZettelId(root: string, now: Date): string {
  const prefix = ymdCompact(now);
  const taken = new Set(
    loadVaultNotes(root)
      .filter((n) => n.zone === 'zettel' && n.id?.startsWith(prefix))
      .map((n) => n.id!),
  );
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (const c of alphabet) if (!taken.has(prefix + c)) return prefix + c;
  for (const c1 of alphabet) for (const c2 of alphabet) if (!taken.has(prefix + c1 + c2)) return prefix + c1 + c2;
  throw new Error(`no free zettel id for ${prefix}`);
}

export function promoteCandidate(
  root: string,
  candidatePath: string,
  opts: PromoteOptions = {},
): { zettelPath: string; archivePath: string } {
  const now = opts.now ?? new Date();
  const abs = join(root, candidatePath);
  const note = parseNote(readFileSync(abs, 'utf8'), candidatePath);
  if (note.zone !== 'inbox') throw new Error(`${candidatePath} is not in the inbox`);

  const title = sanitizeTitle(note.title);
  const zettelPath = `zettel/${title}.md`;
  const zettelAbs = join(root, zettelPath);
  if (existsSync(zettelAbs)) throw new Error(`zettel already exists: ${zettelPath}`);

  const fm = fmBlock({
    id: newZettelId(root, now),
    type: note.type ?? 'insight',
    status: 'active',
    scope: note.scope,
    author: note.author,
    // User acceptance upgrades an agent's inference to a collaborative belief;
    // user-articulated and collaborative origins pass through unchanged.
    origin: note.origin === 'agent-inferred' || !note.origin ? 'collaborative' : note.origin,
    created: note.created ?? ymd(now),
    promoted: ymd(now),
    approval: opts.approval ?? 'direct',
    'source-trust': note.sourceTrust,
    sources: note.sources,
    tags: note.tags,
  });

  const body = note.body.replace(/^##\s+Proposed links\s*$/im, '## Links');
  writeFileSync(zettelAbs, `${fm}\n${body.trimStart()}`);
  // The inbox copy is archived, not deleted — audit trail stays cheap.
  const archivePath = `archive/promoted-${candidatePath.split('/').pop()}`;
  renameSync(abs, join(root, archivePath));
  return { zettelPath, archivePath };
}

function uniquePath(root: string, makeRel: (suffix: string) => string): { rel: string; suffix: string } {
  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`;
    const rel = makeRel(suffix);
    if (!existsSync(join(root, rel))) return { rel, suffix };
  }
  throw new Error('could not find a unique path');
}

/** Stable content hash of a record payload: same fields in any key order → same fingerprint. */
function fingerprintOf(payload: SessionPayload): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return new Bun.CryptoHasher('sha256').update(canonical).digest('hex').slice(0, 16);
}

export interface WrittenRecord {
  path: string;
  id: string;
  /** True when an identical record with this externalId already existed; nothing was written. */
  existed: boolean;
}

export function writeSessionRecord(root: string, payload: SessionPayload, now: Date = new Date()): WrittenRecord {
  const fingerprint = payload.externalId ? fingerprintOf(payload) : undefined;
  if (payload.externalId) {
    const existing = loadVaultNotes(root).find((n) => n.zone === 'evidence' && n.externalId === payload.externalId);
    if (existing) {
      if (existing.fingerprint === fingerprint) return { path: existing.path, id: existing.id ?? existing.path, existed: true };
      throw new Error(`externalId "${payload.externalId}" is already recorded as ${existing.id} with different content`);
    }
  }

  const stamp = `${ymdCompact(now)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const { rel, suffix } = uniquePath(root, (s) => `evidence/sessions/S-${stamp}${s}.md`);
  const id = `S-${stamp}${suffix}`;

  const fm = fmBlock({
    id,
    type: 'session',
    'external-id': payload.externalId,
    fingerprint,
    client: payload.client,
    agents: payload.agents,
    project: payload.project,
    scope: payload.project ? `project:${payload.project}` : 'global',
    outcome: payload.outcome,
    created: ymd(now),
    transcript: payload.transcript,
  });

  const sections: string[] = [`# ${payload.task.split('\n')[0]}`, '', '## Task', payload.task];
  const push = (heading: string, items?: string[] | string) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return;
    sections.push('', `## ${heading}`);
    if (Array.isArray(items)) sections.push(...items.map((i) => `- ${i}`));
    else sections.push(items);
  };
  push('Decisions', payload.decisions);
  push('Attempts & failures', payload.attempts);
  push('Corrections from user', payload.corrections);
  push('Outcome & verification', payload.verification);
  if (payload.untrusted) {
    sections.push('', '## Untrusted content', ...payload.untrusted.split('\n').map((l) => `> ${l}`));
  }

  mkdirSync(join(root, 'evidence/sessions'), { recursive: true });
  writeFileSync(join(root, rel), `${fm}\n${sections.join('\n')}\n`);
  return { path: rel, id, existed: false };
}

export interface Move {
  from: string;
  to: string;
}

/** Sweep expired inbox candidates into archive/. Returns each move made. */
export function expireCandidates(root: string, now: Date = new Date()): Move[] {
  const today = ymd(now);
  const moved: Move[] = [];
  for (const note of loadVaultNotes(root)) {
    if (note.zone !== 'inbox' || !note.expires) continue;
    if (note.expires >= today) continue;
    const to = `archive/expired-${note.path.split('/').pop()!}`;
    renameSync(join(root, note.path), join(root, to));
    moved.push({ from: note.path, to });
  }
  return moved;
}

/** User quick-capture: a fleeting note in the inbox, origin user-articulated. */
export function writeFleetingNote(root: string, text: string, now: Date = new Date()): { path: string; id: string } {
  const stamp = `${ymdCompact(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const { rel, suffix } = uniquePath(root, (s) => `inbox/fleeting/F-${stamp}${s}.md`);
  const id = `F-${stamp}${suffix}`;
  const fm = fmBlock({ id, author: 'tal', origin: 'user-articulated', 'source-trust': 'user-said', created: ymd(now) });
  mkdirSync(join(root, 'inbox/fleeting'), { recursive: true });
  writeFileSync(join(root, rel), `${fm}\n${text.trim()}\n`);
  return { path: rel, id };
}

export interface LinkProposalPayload {
  from: string;
  relation: string;
  to: string;
  reason?: string;
  author: string;
  sessionId?: string;
}

export interface DisputePayload {
  target: string;
  evidence: string;
  author: string;
  sessionId?: string;
}

export function writeLinkProposal(root: string, p: LinkProposalPayload, now: Date = new Date()): { path: string; id: string } {
  const { rel, suffix } = uniquePath(root, (s) => `inbox/links/L-${ymdCompact(now)}${s}.md`);
  const id = `L-${ymdCompact(now)}${suffix}`;
  const fm = fmBlock({
    id, author: p.author, origin: 'agent-inferred', created: ymd(now),
    sources: p.sessionId ? [p.sessionId] : [],
  });
  mkdirSync(join(root, 'inbox/links'), { recursive: true });
  const line = `- ${p.relation} [[${p.to}]]${p.reason ? ` — ${p.reason}` : ''}`;
  writeFileSync(join(root, rel), `${fm}\n# Link proposal for [[${p.from}]]\n\n${line}\n`);
  return { path: rel, id };
}

export function writeDisputeProposal(root: string, p: DisputePayload, now: Date = new Date()): { path: string; id: string } {
  const { rel, suffix } = uniquePath(root, (s) => `inbox/disputes/D-${ymdCompact(now)}${s}.md`);
  const id = `D-${ymdCompact(now)}${suffix}`;
  const fm = fmBlock({
    id, author: p.author, origin: 'agent-inferred', created: ymd(now),
    sources: p.sessionId ? [p.sessionId] : [],
  });
  mkdirSync(join(root, 'inbox/disputes'), { recursive: true });
  writeFileSync(join(root, rel), `${fm}\n# Dispute: [[${p.target}]]\n\n${p.evidence.trim()}\n`);
  return { path: rel, id };
}

const CANDIDATE_CAP = 3;

export function writeCandidate(root: string, payload: CandidatePayload, now: Date = new Date()): { path: string; id: string } {
  const inbox = loadVaultNotes(root).filter((n) => n.zone === 'inbox' && n.path.match(/^inbox\/C-/));
  const siblings = payload.sessionId
    ? inbox.filter((n) => n.sources.includes(payload.sessionId!))
    : inbox.filter((n) => n.author === payload.author && n.created === ymd(now));
  if (siblings.length >= CANDIDATE_CAP) {
    throw new Error(
      `candidate cap reached (${CANDIDATE_CAP} per session): distill harder — which one insight actually matters?`,
    );
  }

  const day = ymdCompact(now);
  const taken = new Set(inbox.map((n) => n.id));
  let id = '';
  for (let i = 1; i < 100; i++) {
    const candidate = `C-${day}-${pad(i)}`;
    if (!taken.has(candidate)) { id = candidate; break; }
  }
  if (!id) throw new Error('no free candidate id');

  const expires = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const fm = fmBlock({
    id,
    'proposed-type': payload.proposedType,
    scope: payload.scope ?? 'global',
    author: payload.author,
    origin: 'agent-inferred',
    'source-trust': payload.sourceTrust ?? 'session',
    sources: [...(payload.sessionId ? [payload.sessionId] : []), ...(payload.sources ?? [])],
    created: ymd(now),
    expires: ymd(expires),
    tags: payload.tags,
  });

  const parts = [`# ${sanitizeTitle(payload.title)}`, '', payload.body.trim()];
  if (payload.proposedLinks && payload.proposedLinks.length > 0) {
    parts.push('', '## Proposed links', ...payload.proposedLinks);
  }
  const rel = `inbox/${id}.md`;
  writeFileSync(join(root, rel), `${fm}\n${parts.join('\n')}\n`);
  return { path: rel, id };
}
