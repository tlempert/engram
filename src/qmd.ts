import type { FtsHit } from './db';
import type { Zone } from './types';

/** qmd://engram-zettel/foo/bar.md → "zettel/foo/bar.md"; non-engram collections → null. */
export function mapQmdFile(file: string): string | null {
  const m = /^qmd:\/\/engram-([a-z]+)\/(.+)$/.exec(file);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
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
 * BM25 search via qmd, filtered to engram collections and requested zones.
 * Returns null on any failure so the caller can fall back to FTS5.
 */
export function qmdSearch(terms: string[], zones: Zone[], limit: number): FtsHit[] | null {
  try {
    const proc = Bun.spawnSync(['qmd', 'search', terms.join(' '), '--json', '-n', '50']);
    if (proc.exitCode !== 0) return null;
    const rows = JSON.parse(proc.stdout.toString()) as { file: string; score: number }[];
    const zoneSet = new Set<string>(zones);
    const hits: FtsHit[] = [];
    for (const row of rows) {
      const path = mapQmdFile(row.file);
      if (!path) continue;
      const zone = path.split('/')[0]!;
      if (!zoneSet.has(zone)) continue;
      hits.push({ path, score: row.score });
      if (hits.length >= limit) break;
    }
    return hits;
  } catch {
    return null;
  }
}
