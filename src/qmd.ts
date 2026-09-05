import type { FtsHit } from './db';
import type { Zone } from './types';

/** True for a qmd hit that came from one of the vault's own collections. */
export function isEngramFile(file: string): boolean {
  return /^qmd:\/\/engram-[a-z]+\/.+$/.test(file);
}

export interface QmdRow {
  file: string;
  title: string;
  score: number;
}

/** Reciprocal-rank fusion of two ranked hit lists (scores are not comparable across engines). */
export function rrfMerge(a: FtsHit[], b: FtsHit[], k = 60): FtsHit[] {
  const scores = new Map<string, number>();
  for (const [list, weight] of [[a, 1], [b, 1]] as const) {
    list.forEach((hit, rank) => {
      scores.set(hit.path, (scores.get(hit.path) ?? 0) + weight / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((x, y) => y.score - x.score);
}

export function qmdBinaryAvailable(): boolean {
  try {
    return Bun.spawnSync(['qmd', '--version']).exitCode === 0;
  } catch {
    return false;
  }
}

/** True when the user has registered engram-* collections with qmd. */
export function qmdCollectionsRegistered(): boolean {
  try {
    const proc = Bun.spawnSync(['qmd', 'collection', 'list']);
    if (proc.exitCode !== 0) return false;
    return proc.stdout.toString().includes('engram-');
  } catch {
    return false;
  }
}

/**
 * Semantic search via qmd, filtered to engram collections and requested zones.
 *
 * Deliberately vsearch, not qmd's BM25 or hybrid path: FTS5 already supplies the
 * lexical arm, so the vector arm is the opinion it lacks. qmd's BM25 returns
 * nothing for long natural-language tasks, and its hybrid 'query' reranks at ~5s
 * per call for a lexical ranking we already have.
 * Returns null on any failure so the caller can fall back to FTS5.
 */
export function qmdSearch(
  terms: string[],
  zones: Zone[],
  limit: number,
  resolvePath: (title: string) => string | null,
): FtsHit[] | null {
  try {
    const proc = Bun.spawnSync(['qmd', 'vsearch', terms.join(' '), '--json', '-n', '50']);
    if (proc.exitCode !== 0) return null;
    return qmdRows(JSON.parse(proc.stdout.toString()) as QmdRow[], resolvePath, zones, limit);
  } catch {
    return null;
  }
}

/**
 * Turn raw qmd rows into vault hits: drop foreign collections and unwanted
 * zones, resolve each row's title to its real vault path, and collapse the
 * several chunks qmd returns per document down to its best-ranked one.
 */
export function qmdRows(
  rows: QmdRow[],
  resolvePath: (title: string) => string | null,
  zones: Zone[],
  limit: number,
): FtsHit[] {
  const zoneSet = new Set<string>(zones);
  const seen = new Set<string>();
  const hits: FtsHit[] = [];
  for (const row of rows) {
    if (!isEngramFile(row.file)) continue;
    const path = resolvePath(row.title);
    if (!path || seen.has(path)) continue;
    if (!zoneSet.has(path.split('/')[0]!)) continue;
    seen.add(path);
    hits.push({ path, score: row.score });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Fuse the FTS5 and qmd arms, guarding the case where qmd contributed nothing.
 *
 * RRF discards raw scores in favour of rank position, so fusing an empty arm
 * is not a no-op: it flattens FTS5's separation between a strong hit and noise
 * into near-uniform 1/(k+rank) values. With no second opinion to fuse, the
 * FTS5 ranking stands as-is.
 */
export function fuseRetrievers(fts: FtsHit[], qmd: FtsHit[] | null): FtsHit[] {
  return qmd && qmd.length > 0 ? rrfMerge(fts, qmd) : fts;
}
