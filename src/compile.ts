import type { Database } from 'bun:sqlite';
import { classify } from './classify';
import { getNote, searchFts } from './db';
import { contentWords, shingleContainment } from './text';
import type { Bundle, BundleItem, ParsedNote, QueryRequest, Zone } from './types';

export interface Policy {
  typeWeights: Record<string, number>;
}

export const DEFAULT_POLICY: Policy = {
  typeWeights: {
    decision: 1.6,
    preference: 1.45,
    fact: 1.3,
    synthesis: 1.15,
    insight: 1.0,
    question: 0.9,
    session: 0.8,
  },
};

const ABSOLUTE_BUDGET_CAP = 5000;
const MAX_SEEDS = 25;
const MAX_ITEM_TOKENS = 220; // progressive disclosure: long content is truncated, expand() fetches the rest
const DEDUPE_THRESHOLD = 0.6;
const MAX_OMITTED_LISTED = 5;

interface Scored {
  note: ParsedNote;
  score: number;
  matched: string[];
  titleHit: boolean;
  whyParts: string[];
  tokenCost: number;
  content: string;
}

function truncate(claim: string, id: string): { content: string; tokens: number } {
  const maxChars = MAX_ITEM_TOKENS * 4;
  if (claim.length <= maxChars) return { content: claim, tokens: Math.ceil(claim.length / 4) };
  const cut = claim.slice(0, maxChars).replace(/\s+\S*$/, '');
  const content = `${cut} … [truncated — expand ${id}]`;
  return { content, tokens: Math.ceil(content.length / 4) };
}

function coverageFloor(termCount: number): number {
  return termCount >= 4 ? 2 : 1;
}

function scopeAllowed(scope: string, project?: string): boolean {
  if (scope === 'global') return true;
  if (scope === 'personal') return false; // v0: hard-excluded, always
  if (scope.startsWith('project:')) return project !== undefined && scope === `project:${project}`;
  return false;
}

export function compileQuery(db: Database, req: QueryRequest, policy: Policy = DEFAULT_POLICY): Bundle {
  const cls = classify(req.task);
  const requested = Math.min(req.tokenBudget ?? cls.defaultBudget, ABSOLUTE_BUDGET_CAP);
  const terms = contentWords(req.task);

  const empty = (reason: string): Bundle => ({
    items: [],
    insufficiencies: [reason],
    omitted: [],
    budget: { requested, used: 0 },
    taskKind: cls.kind,
  });

  if (terms.length === 0) return empty('Task has no searchable content words; proceed from first principles.');

  const zones: Zone[] = cls.includeEvidence ? ['zettel', 'maps', 'evidence'] : ['zettel', 'maps'];
  const hits = searchFts(db, terms, zones, MAX_SEEDS);
  const maxBm25 = hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 1;

  const scored: Scored[] = [];
  for (const hit of hits) {
    const note = getNote(db, hit.path);
    if (!note) continue;

    // Hard filters — structural, before any ranking.
    if (note.zone === 'inbox' || note.zone === 'archive') continue;
    if (note.origin === 'agent-inferred') continue;
    if (note.status === 'superseded' && !req.includeHistory) continue;
    if (!scopeAllowed(note.scope, req.project)) continue;

    // Coverage: which content words actually appear in this note.
    const text = `${note.title} ${note.tags.join(' ')} ${note.claim}`.toLowerCase();
    const matched = terms.filter((t) => text.includes(t));
    if (matched.length < coverageFloor(terms.length)) continue;

    const coverage = matched.length / terms.length;
    const bm25Norm = maxBm25 > 0 ? hit.score / maxBm25 : 0;
    const titleHit = terms.some((t) => note.title.toLowerCase().includes(t));

    const typeW = policy.typeWeights[note.type ?? 'insight'] ?? 1.0;
    const statusW = note.status === 'disputed' ? 0.6 : note.status === 'superseded' ? 0.5 : 1.0;
    const scopeW = note.scope.startsWith('project:') ? 1.25 : 1.0;
    const originW = note.origin === 'user-articulated' ? 1.1 : 1.0;
    const titleW = titleHit ? 1.2 : 1.0;

    const score = (coverage + 0.1 * bm25Norm) * typeW * statusW * scopeW * originW * titleW;

    const whyParts = [`matched "${matched.join(', ')}"`];
    if (titleHit) whyParts.push('title match');
    if (typeW > 1.0 && note.type) whyParts.push(`${note.type} boost`);
    if (note.scope.startsWith('project:')) whyParts.push(`active in ${note.scope}`);
    if (note.status === 'disputed') whyParts.push('status: DISPUTED');
    if (note.status === 'superseded') whyParts.push('status: superseded (history requested)');

    const { content, tokens } = truncate(note.claim, note.id ?? note.path);
    scored.push({ note, score, matched, titleHit, whyParts, tokenCost: tokens, content });
  }

  if (scored.length === 0) {
    return empty(`No relevant memory for "${req.task.slice(0, 80)}" — proceed from first principles.`);
  }

  scored.sort((a, b) => b.score - a.score);

  const items: BundleItem[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const s of scored) {
    const dup = items.find((p) => shingleContainment(s.note.claim, p.content) > DEDUPE_THRESHOLD);
    if (dup) {
      omitted.push(`${s.note.title} (near-duplicate of "${dup.title}")`);
      continue;
    }
    if (used + s.tokenCost > requested) {
      omitted.push(`${s.note.title} (over budget)`);
      continue;
    }
    used += s.tokenCost;
    items.push({
      id: s.note.id ?? s.note.path,
      path: s.note.path,
      title: s.note.title,
      type: s.note.type ?? 'insight',
      origin: s.note.origin ?? 'unknown',
      status: s.note.status,
      scope: s.note.scope,
      content: s.content,
      why: s.whyParts.join('; '),
      tokenCost: s.tokenCost,
      score: s.score,
    });
  }

  const insufficiencies: string[] = [];
  if (items.length === 0) {
    insufficiencies.push(`No relevant memory fits the ${requested}-token budget — raise it or proceed from first principles.`);
  }

  return {
    items,
    insufficiencies,
    omitted: omitted.slice(0, MAX_OMITTED_LISTED),
    budget: { requested, used },
    taskKind: cls.kind,
  };
}
