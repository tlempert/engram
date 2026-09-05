import { describe, expect, test } from 'bun:test';
import { fuseRetrievers, isEngramFile, qmdRows, rrfMerge } from '../src/qmd';
import type { FtsHit } from '../src/db';

/**
 * Regression: an empty qmd arm must not be fused.
 *
 * qmd's arm comes back empty whenever its query finds nothing (long
 * natural-language tasks are the common case). Fusing that empty list
 * still rewrites every FTS5 score into 1/(k+rank), collapsing a ranking
 * that cleanly separated signal from noise into near-uniform mush.
 */
describe('fuseRetrievers', () => {
  const fts: FtsHit[] = [
    { path: 'zettel/Guard at the Call Site.md', score: 1.34 },
    { path: 'zettel/No Abstractions for Single-Use Sites.md', score: 0.7 },
    { path: 'zettel/The Compass Method.md', score: 0.02 },
  ];

  test('returns FTS5 hits untouched when the qmd arm is empty', () => {
    expect(fuseRetrievers(fts, [])).toEqual(fts);
  });

  test('returns FTS5 hits untouched when the qmd arm failed', () => {
    expect(fuseRetrievers(fts, null)).toEqual(fts);
  });

  test('preserves score separation between a top hit and noise when qmd is empty', () => {
    const fused = fuseRetrievers(fts, []);
    expect(fused[0]!.score / fused[2]!.score).toBeGreaterThan(10);
  });

  test('fuses both arms when qmd returns hits', () => {
    const qmd: FtsHit[] = [{ path: 'zettel/No Abstractions for Single-Use Sites.md', score: 0.68 }];
    const fused = fuseRetrievers(fts, qmd);
    expect(fused[0]!.path).toBe('zettel/No Abstractions for Single-Use Sites.md');
    expect(fused).toEqual(rrfMerge(fts, qmd));
  });
});

/**
 * Regression: qmd reports slugified filenames, the vault stores real titles.
 *
 * qmd://engram-zettel/guard-at-the-call-site....md is the same note as
 * zettel/Guard at the Call Site, Not in the Shared Signature.md, but RRF keys
 * on path — so an unresolved slug makes each note appear twice and destroys the
 * cross-arm agreement that is the entire point of fusing.
 */
describe('qmdSearch path resolution', () => {
  const rows = [
    {
      file: 'qmd://engram-zettel/guard-at-the-call-site-not-in-the-shared-signature.md',
      title: 'Guard at the Call Site, Not in the Shared Signature',
      score: 0.68,
    },
    {
      file: 'qmd://engram-zettel/guard-at-the-call-site-not-in-the-shared-signature.md',
      title: 'Guard at the Call Site, Not in the Shared Signature',
      score: 0.61,
    },
    { file: 'qmd://other-collection/unrelated.md', title: 'Unrelated', score: 0.9 },
  ];
  const resolve = (title: string) =>
    title === 'Guard at the Call Site, Not in the Shared Signature'
      ? 'zettel/Guard at the Call Site, Not in the Shared Signature.md'
      : null;

  test('resolves qmd titles to real vault paths', () => {
    expect(qmdRows(rows, resolve, ['zettel'], 10)[0]!.path).toBe(
      'zettel/Guard at the Call Site, Not in the Shared Signature.md',
    );
  });

  test('collapses repeated chunks of one note into a single hit', () => {
    expect(qmdRows(rows, resolve, ['zettel'], 10)).toHaveLength(1);
  });

  test('drops rows from collections outside the vault', () => {
    expect(qmdRows(rows, resolve, ['zettel'], 10).map((h) => h.path)).not.toContain('Unrelated');
  });

  test('drops rows whose zone was not requested', () => {
    expect(qmdRows(rows, resolve, ['maps'], 10)).toHaveLength(0);
  });
});

describe('isEngramFile', () => {
  test('accepts hits from the vault\'s own collections', () => {
    expect(isEngramFile('qmd://engram-zettel/a-note.md')).toBe(true);
    expect(isEngramFile('qmd://engram-maps/a-map.md')).toBe(true);
  });

  test('rejects hits from any other indexed folder', () => {
    expect(isEngramFile('qmd://src-tal/README.md')).toBe(false);
    expect(isEngramFile('qmd://engram-zettel/')).toBe(false);
    expect(isEngramFile('/Users/tal/engram/zettel/a-note.md')).toBe(false);
  });
});
