import { describe, expect, test } from 'bun:test';
import { buildIndex } from '../src/db';
import { compileQuery, expandItems } from '../src/compile';
import { parseNote } from '../src/parse';
import { writeSessionRecord } from '../src/vault';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The project firewall is applied before scoring so leakage is structurally
 * impossible. Two holes: session records carried `project` but no `scope`,
 * so evidence parsed as global and crossed projects on episodic queries; and
 * expand checked only zone and origin, so any id could be pulled regardless of
 * scope or status.
 */
const db = buildIndex([
  parseNote(
    `---\nid: S-A\ntype: session\nproject: project-a\noutcome: shipped\n---\n\n# project-a retry architecture\n\nWhat happened last time with retry architecture in project-a: we tried backoff first.\n`,
    'evidence/sessions/S-A.md',
  ),
  parseNote(
    `---\nid: S-B\ntype: session\nproject: project-b\noutcome: blocked\n---\n\n# project-b retry architecture\n\nWhat happened last time with retry architecture in project-b: the deployment failed.\n`,
    'evidence/sessions/S-B.md',
  ),
  parseNote(
    `---\nid: p1\ntype: preference\nstatus: active\nscope: personal\norigin: user-articulated\n---\n\n# Family communication cadence\n\nPrivate.\n`,
    'zettel/Family communication cadence.md',
  ),
  parseNote(
    `---\nid: o1\ntype: insight\nstatus: active\nscope: "project:otherproj"\norigin: user-articulated\n---\n\n# Ranking uses cosine similarity\n\nOnly otherproj should see this.\n`,
    'zettel/Ranking uses cosine similarity.md',
  ),
  parseNote(
    `---\nid: old1\ntype: decision\nstatus: superseded\nscope: global\norigin: user-articulated\n---\n\n# Old retry policy\n\nRetry three times.\n`,
    'zettel/Old retry policy.md',
  ),
]);

describe('session evidence honours the project firewall', () => {
  test('an episodic query for project-a never returns project-b evidence', () => {
    const b = compileQuery(db, { task: 'what happened last time with retry architecture', project: 'project-a' });
    expect(b.items.map((i) => i.id)).toContain('S-A');
    expect(b.items.map((i) => i.id)).not.toContain('S-B');
  });

  test('an episodic query with no project sees no project evidence at all', () => {
    const b = compileQuery(db, { task: 'what happened last time with retry architecture' });
    expect(b.items).toHaveLength(0);
  });

  test('a record written with a project carries an explicit project scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'engram-scope-'));
    try {
      const { path } = writeSessionRecord(root, { task: 'card 5', project: 'acme' });
      expect(readFileSync(join(root, path), 'utf8')).toContain('scope: project:acme');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('expand applies the same filters as query', () => {
  test('personal notes are not expandable', () => {
    const b = expandItems(db, ['p1'], 4000);
    expect(b.items).toHaveLength(0);
    expect(b.insufficiencies.join(' ')).toContain('p1');
  });

  test("another project's note is not expandable without that project", () => {
    expect(expandItems(db, ['o1'], 4000).items).toHaveLength(0);
    expect(expandItems(db, ['o1'], 4000, { project: 'otherproj' }).items.map((i) => i.id)).toEqual(['o1']);
  });

  test('superseded notes expand only when history is requested', () => {
    expect(expandItems(db, ['old1'], 4000).items).toHaveLength(0);
    expect(expandItems(db, ['old1'], 4000, { includeHistory: true }).items.map((i) => i.id)).toEqual(['old1']);
  });

  test("evidence from another project is not expandable", () => {
    expect(expandItems(db, ['S-B'], 4000, { project: 'project-a' }).items).toHaveLength(0);
  });
});

describe('expand refusals name the actual reason and the flag that lifts it', () => {
  test('an out-of-scope note says so and points at --project', () => {
    const msg = expandItems(db, ['o1'], 4000).insufficiencies.join(' ');
    expect(msg).toMatch(/out of scope/i);
    expect(msg).toContain('--project');
    expect(msg).not.toMatch(/superseded|quarantined/i);
  });

  test('a superseded note says so and points at --history', () => {
    const msg = expandItems(db, ['old1'], 4000).insufficiencies.join(' ');
    expect(msg).toMatch(/superseded/i);
    expect(msg).toContain('--history');
    expect(msg).not.toMatch(/out of scope|quarantined/i);
  });
});
