import type { Database } from 'bun:sqlite';
import { compileQuery, DEFAULT_POLICY } from './compile';
import type { Policy, RetrieverFn } from './compile';
import { listNotes } from './db';
import type { BundleItem } from './types';

export interface Probe {
  q: string;
  agent?: string;
  project?: string;
  expect?: 'abstain';
  must_include?: string[];
  must_exclude?: string[];
  requires?: string[];
}

export interface ProbeResult {
  passed: number;
  failed: { q: string; reason: string }[];
  skipped: number;
}

/**
 * The seams production compiles through. Eval must run the same retriever and
 * the same per-agent policy as `engram query`, or it is measuring a different
 * system than the one answering real queries.
 */
export interface EvalSeams {
  retriever?: RetrieverFn;
  policyFor?: (agent?: string) => Policy;
}

/** Probes may reference notes by id or by title — titles survive promotion, ids do not. */
function idExistsInZettel(db: Database, ref: string): boolean {
  const row = db.prepare("SELECT 1 FROM notes WHERE (id = ? OR title = ?) AND zone = 'zettel' LIMIT 1").get(ref, ref);
  return row != null;
}

/** must_exclude entry forms: a note id, or "scope:<value>" with optional trailing "*". */
function violates(entry: string, items: BundleItem[]): boolean {
  if (entry.startsWith('scope:')) {
    const pattern = entry.slice('scope:'.length);
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
    return items.some((i) => (prefix !== null ? i.scope.startsWith(prefix) : i.scope === pattern));
  }
  return items.some((i) => i.id === entry || i.title === entry);
}

export function runProbes(db: Database, probes: Probe[], seams: EvalSeams = {}): ProbeResult {
  let passed = 0;
  let skipped = 0;
  const failed: { q: string; reason: string }[] = [];

  for (const probe of probes) {
    const missing = (probe.requires ?? []).filter((id) => !idExistsInZettel(db, id));
    if (missing.length > 0) {
      skipped++;
      continue; // awaiting promotion — not a failure
    }

    const bundle = compileQuery(
      db,
      { task: probe.q, agent: probe.agent, project: probe.project },
      seams.policyFor?.(probe.agent) ?? DEFAULT_POLICY,
      seams.retriever,
    );
    const reasons: string[] = [];

    if (probe.expect === 'abstain' && bundle.items.length > 0) {
      reasons.push(`expected abstention, got ${bundle.items.length} item(s): ${bundle.items.map((i) => i.id).join(', ')}`);
    }
    for (const ref of probe.must_include ?? []) {
      if (!bundle.items.some((i) => i.id === ref || i.title === ref)) reasons.push(`missing required item ${ref}`);
    }
    for (const entry of probe.must_exclude ?? []) {
      if (violates(entry, bundle.items)) reasons.push(`forbidden item present: ${entry}`);
    }

    if (reasons.length > 0) failed.push({ q: probe.q, reason: reasons.join('; ') });
    else passed++;
  }

  return { passed, failed, skipped };
}

export interface QuarantineResult {
  /** How many candidates were actually queried — zero means nothing was proven. */
  sampled: number;
  violations: string[];
}

/** For each inbox candidate, query its own title; any inbox item surfacing is a violation. */
export function quarantineBattery(db: Database, seams: EvalSeams = {}, sample = 5): QuarantineResult {
  const policy = seams.policyFor?.() ?? DEFAULT_POLICY;
  const violations: string[] = [];
  const candidates = listNotes(db, 'inbox').slice(0, sample);
  for (const c of candidates) {
    const bundle = compileQuery(db, { task: c.title }, policy, seams.retriever);
    for (const item of bundle.items) {
      if (item.path.startsWith('inbox/')) {
        violations.push(`inbox item "${item.title}" surfaced for query "${c.title}"`);
      }
    }
  }
  return { sampled: candidates.length, violations };
}
