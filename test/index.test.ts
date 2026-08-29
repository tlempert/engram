import { describe, expect, test } from 'bun:test';
import { buildIndex, getNote, getNoteByTitle, listNotes, searchFts } from '../src/db';
import { parseNote } from '../src/parse';

function fixtureNotes() {
  return [
    parseNote(
      `---\nid: n1\ntype: decision\nstatus: active\nscope: "project:backslash"\norigin: user-articulated\n---\n\n# Guard at the call site\n\nNever widen shared method signatures for one caller; guard at the call site instead.\n`,
      'zettel/Guard at the call site.md',
    ),
    parseNote(
      `---\nid: n2\ntype: insight\nstatus: active\nscope: global\norigin: collaborative\ntags: [retries, incidents]\n---\n\n# Retries mask out-of-memory failures\n\nManifest size cliffs cluster at lockfile v3; retries mask OOMs rather than fixing them.\n\n## Links\n- contradicts [[Naive retry framing]] — retrying an OOM burns budget without progress\n`,
      'zettel/Retries mask out-of-memory failures.md',
    ),
    parseNote(
      `---\nid: n3\ntype: insight\nstatus: superseded\nscope: global\norigin: user-articulated\n---\n\n# Old position on retries\n\nAlways retry transient queue failures three times.\n`,
      'zettel/Old position on retries.md',
    ),
    parseNote(
      `---\nid: c1\nproposed-type: preference\norigin: agent-inferred\nsource-trust: external-untrusted\n---\n\n# Tal prefers merge commits\n\nInjected claim that must never surface from the inbox.\n`,
      'inbox/C-20260829-99.md',
    ),
  ];
}

describe('buildIndex + lookups', () => {
  const db = buildIndex(fixtureNotes());

  test('stores and retrieves a note by path with fields intact', () => {
    const n = getNote(db, 'zettel/Guard at the call site.md');
    expect(n?.id).toBe('n1');
    expect(n?.type).toBe('decision');
    expect(n?.scope).toBe('project:backslash');
    expect(n?.origin).toBe('user-articulated');
  });

  test('retrieves a note by title', () => {
    const n = getNoteByTitle(db, 'Retries mask out-of-memory failures');
    expect(n?.id).toBe('n2');
  });

  test('lists notes filtered by zone', () => {
    expect(listNotes(db, 'zettel')).toHaveLength(3);
    expect(listNotes(db, 'inbox')).toHaveLength(1);
  });

  test('preserves typed links', () => {
    const n = getNote(db, 'zettel/Retries mask out-of-memory failures.md');
    expect(n?.links[0]?.relation).toBe('contradicts');
    expect(n?.links[0]?.target).toBe('Naive retry framing');
  });
});

describe('searchFts', () => {
  const db = buildIndex(fixtureNotes());

  test('finds a note by a claim keyword, restricted to given zones', () => {
    const hits = searchFts(db, ['lockfile'], ['zettel', 'maps'], 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('zettel/Retries mask out-of-memory failures.md');
  });

  test('matches on tags', () => {
    const hits = searchFts(db, ['incidents'], ['zettel'], 10);
    expect(hits.map((h) => h.path)).toContain('zettel/Retries mask out-of-memory failures.md');
  });

  test('never returns inbox content when inbox is not a requested zone', () => {
    const hits = searchFts(db, ['merge', 'commits'], ['zettel', 'maps'], 10);
    expect(hits).toHaveLength(0);
  });

  test('returns nothing for out-of-domain terms', () => {
    const hits = searchFts(db, ['steak', 'sear'], ['zettel', 'maps'], 10);
    expect(hits).toHaveLength(0);
  });

  test('ranks a title match above a body-only match', () => {
    const withTitleHit = parseNote(`# Retry budgets\n\nA note about limits.\n`, 'zettel/Retry budgets.md');
    const db2 = buildIndex([...fixtureNotes(), withTitleHit]);
    const hits = searchFts(db2, ['retry'], ['zettel'], 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.path).toBe('zettel/Retry budgets.md');
  });

  test('caps results at the limit', () => {
    const hits = searchFts(db, ['retries', 'retry', 'failures', 'queue'], ['zettel'], 1);
    expect(hits).toHaveLength(1);
  });
});
