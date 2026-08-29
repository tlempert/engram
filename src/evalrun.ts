import type { Database } from 'bun:sqlite';
import { compileQuery } from './compile';
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

function idExistsInZettel(db: Database, id: string): boolean {
  const row = db.prepare("SELECT 1 FROM notes WHERE id = ? AND zone = 'zettel' LIMIT 1").get(id);
  return row != null;
}

/** must_exclude entry forms: a note id, or "scope:<value>" with optional trailing "*". */
function violates(entry: string, items: BundleItem[]): boolean {
  if (entry.startsWith('scope:')) {
    const pattern = entry.slice('scope:'.length);
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
    return items.some((i) => (prefix !== null ? i.scope.startsWith(prefix) : i.scope === pattern));
  }
  return items.some((i) => i.id === entry);
}

export function runProbes(db: Database, probes: Probe[]): ProbeResult {
  let passed = 0;
  let skipped = 0;
  const failed: { q: string; reason: string }[] = [];

  for (const probe of probes) {
    const missing = (probe.requires ?? []).filter((id) => !idExistsInZettel(db, id));
    if (missing.length > 0) {
      skipped++;
      continue; // awaiting promotion — not a failure
    }

    const bundle = compileQuery(db, { task: probe.q, project: probe.project });
    const reasons: string[] = [];

    if (probe.expect === 'abstain' && bundle.items.length > 0) {
      reasons.push(`expected abstention, got ${bundle.items.length} item(s): ${bundle.items.map((i) => i.id).join(', ')}`);
    }
    for (const id of probe.must_include ?? []) {
      if (!bundle.items.some((i) => i.id === id)) reasons.push(`missing required item ${id}`);
    }
    for (const entry of probe.must_exclude ?? []) {
      if (violates(entry, bundle.items)) reasons.push(`forbidden item present: ${entry}`);
    }

    if (reasons.length > 0) failed.push({ q: probe.q, reason: reasons.join('; ') });
    else passed++;
  }

  return { passed, failed, skipped };
}

/** For each inbox candidate, query its own title; any inbox item surfacing is a violation. */
export function quarantineBattery(db: Database, sample = 5): string[] {
  const violations: string[] = [];
  const candidates = listNotes(db, 'inbox').slice(0, sample);
  for (const c of candidates) {
    const bundle = compileQuery(db, { task: c.title });
    for (const item of bundle.items) {
      if (item.path.startsWith('inbox/')) {
        violations.push(`inbox item "${item.title}" surfaced for query "${c.title}"`);
      }
    }
  }
  return violations;
}
