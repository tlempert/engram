import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadVaultNotes, promoteCandidate, writeCandidate, writeSessionRecord } from '../src/vault';
import { parseNote } from '../src/parse';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-test-'));
  for (const z of ['zettel', 'maps', 'inbox', 'inbox/fleeting', 'inbox/links', 'inbox/disputes', 'evidence/sessions', 'archive']) {
    mkdirSync(join(root, z), { recursive: true });
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const CANDIDATE = `---
id: C-20260829-01
proposed-type: preference
scope: global
author: fable
origin: user-articulated
source-trust: user-said
sources: ["claude-md:global"]
created: 2026-08-29
expires: 2026-09-28
tags: [code-review, minimal-change]
---

# Guard at the call site, not the shared signature

Never widen a shared method signature to accommodate one caller.

## Proposed links
- exemplifies [[Keep changes minimal]]
`;

describe('loadVaultNotes', () => {
  test('walks all zones and parses notes with vault-relative paths', () => {
    writeFileSync(join(root, 'zettel/A note.md'), '# A note\n\nClaim.\n');
    writeFileSync(join(root, 'inbox/C-1.md'), CANDIDATE);
    writeFileSync(join(root, 'evidence/sessions/S-1.md'), '---\ntype: session\n---\n\n# S\n\nDid things.\n');
    const notes = loadVaultNotes(root);
    const paths = notes.map((n) => n.path).sort();
    expect(paths).toEqual(['evidence/sessions/S-1.md', 'inbox/C-1.md', 'zettel/A note.md']);
  });

  test('ignores non-markdown files and generated directories', () => {
    writeFileSync(join(root, 'zettel/real.md'), '# R\n\nX.\n');
    mkdirSync(join(root, '_generated'), { recursive: true });
    writeFileSync(join(root, '_generated/review-queue.md'), '# generated\n');
    writeFileSync(join(root, 'zettel/.DS_Store'), 'junk');
    const notes = loadVaultNotes(root);
    expect(notes).toHaveLength(1);
  });
});

describe('promoteCandidate', () => {
  test('moves the candidate to zettel/ named by its title', () => {
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), CANDIDATE);
    const { zettelPath } = promoteCandidate(root, 'inbox/C-20260829-01.md', {
      now: new Date('2026-08-30T10:00:00Z'),
    });
    expect(zettelPath).toBe('zettel/Guard at the call site, not the shared signature.md');
    expect(existsSync(join(root, zettelPath))).toBe(true);
    expect(existsSync(join(root, 'inbox/C-20260829-01.md'))).toBe(false);
  });

  test('rewrites frontmatter: fresh zettel id, type from proposed-type, promotion metadata, no expiry', () => {
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), CANDIDATE);
    const { zettelPath } = promoteCandidate(root, 'inbox/C-20260829-01.md', {
      now: new Date('2026-08-30T10:00:00Z'),
      approval: 'direct',
    });
    const n = parseNote(readFileSync(join(root, zettelPath), 'utf8'), zettelPath);
    expect(n.id).toMatch(/^20260830/);
    expect(n.type).toBe('preference');
    expect(n.status).toBe('active');
    expect(n.origin).toBe('user-articulated');
    expect(n.expires).toBeUndefined();
    expect(n.sources).toEqual(['claude-md:global']);
    const raw = readFileSync(join(root, zettelPath), 'utf8');
    expect(raw).toContain('approval: direct');
    expect(raw).toContain('promoted: 2026-08-30');
  });

  test('accepting an agent-inferred candidate upgrades its origin to collaborative', () => {
    const agentDraft = CANDIDATE.replace('origin: user-articulated', 'origin: agent-inferred').replace(
      '# Guard at the call site, not the shared signature',
      '# An agent-formulated claim',
    );
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), agentDraft);
    const { zettelPath } = promoteCandidate(root, 'inbox/C-20260829-01.md', { now: new Date('2026-08-30') });
    const n = parseNote(readFileSync(join(root, zettelPath), 'utf8'), zettelPath);
    expect(n.origin).toBe('collaborative');
  });

  test('renames Proposed links to Links so they become live', () => {
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), CANDIDATE);
    const { zettelPath } = promoteCandidate(root, 'inbox/C-20260829-01.md', { now: new Date('2026-08-30') });
    const raw = readFileSync(join(root, zettelPath), 'utf8');
    expect(raw).toContain('## Links');
    expect(raw).not.toContain('## Proposed links');
  });

  test('generates distinct ids for two promotions on the same day', () => {
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), CANDIDATE);
    const second = CANDIDATE.replace('C-20260829-01', 'C-20260829-02').replace(
      '# Guard at the call site, not the shared signature',
      '# Another distinct claim entirely',
    );
    writeFileSync(join(root, 'inbox/C-20260829-02.md'), second);
    const a = promoteCandidate(root, 'inbox/C-20260829-01.md', { now: new Date('2026-08-30') });
    const b = promoteCandidate(root, 'inbox/C-20260829-02.md', { now: new Date('2026-08-30') });
    const idA = parseNote(readFileSync(join(root, a.zettelPath), 'utf8'), a.zettelPath).id;
    const idB = parseNote(readFileSync(join(root, b.zettelPath), 'utf8'), b.zettelPath).id;
    expect(idA).not.toBe(idB);
  });

  test('refuses to overwrite an existing zettel with the same title', () => {
    writeFileSync(join(root, 'inbox/C-20260829-01.md'), CANDIDATE);
    writeFileSync(join(root, 'zettel/Guard at the call site, not the shared signature.md'), '# Existing\n\nX.\n');
    expect(() => promoteCandidate(root, 'inbox/C-20260829-01.md', { now: new Date('2026-08-30') })).toThrow(/exists/i);
  });
});

describe('writeSessionRecord', () => {
  test('writes a structured session record into evidence/sessions', () => {
    const { path, id } = writeSessionRecord(
      root,
      {
        task: 'Fix sca-deps queue OOM',
        client: 'claude-code',
        agents: ['forge'],
        project: 'backslash',
        outcome: 'shipped',
        decisions: ['Guard at call site'],
        attempts: ['Timeout hypothesis disproven'],
        corrections: ['User: find the size cliff first'],
        verification: 'Regression test passes',
        untrusted: 'Some pasted web content',
      },
      new Date('2026-08-30T14:20:00Z'),
    );
    expect(id).toMatch(/^S-20260830-/);
    const raw = readFileSync(join(root, path), 'utf8');
    expect(raw).toContain('type: session');
    expect(raw).toContain('outcome: shipped');
    expect(raw).toContain('## Task');
    expect(raw).toContain('## Corrections from user');
    expect(raw).toContain('## Untrusted content');
    expect(raw).toContain('> Some pasted web content');
  });

  test('session ids are unique when two sessions land in the same minute', () => {
    const a = writeSessionRecord(root, { task: 'a' }, new Date('2026-08-30T14:20:00Z'));
    const b = writeSessionRecord(root, { task: 'b' }, new Date('2026-08-30T14:20:00Z'));
    expect(a.id).not.toBe(b.id);
  });
});

describe('expireCandidates', () => {
  test('moves candidates past their expiry into archive, leaves fresh ones', async () => {
    const { expireCandidates } = await import('../src/vault');
    writeFileSync(join(root, 'inbox/C-1.md'), CANDIDATE); // expires 2026-09-28
    const fresh = CANDIDATE.replace('expires: 2026-09-28', 'expires: 2026-12-01').replace('C-20260829-01', 'C-2');
    writeFileSync(join(root, 'inbox/C-2.md'), fresh);
    const expired = expireCandidates(root, new Date('2026-10-01'));
    expect(expired).toHaveLength(1);
    expect(existsSync(join(root, 'inbox/C-1.md'))).toBe(false);
    expect(existsSync(join(root, 'inbox/C-2.md'))).toBe(true);
    expect(existsSync(join(root, 'archive/expired-C-1.md'))).toBe(true);
  });
});

describe('writeCandidate', () => {
  const payload = {
    title: 'Manifest size cliffs cluster at lockfile v3',
    proposedType: 'insight',
    body: 'Jobs died at v3 boundaries; the cliff is the format, not the size.',
    author: 'forge',
    sessionId: 'S-20260830-1420',
    tags: ['incidents'],
  };

  test('writes a candidate with agent-inferred origin and a 30-day expiry', () => {
    const { path, id } = writeCandidate(root, payload, new Date('2026-08-30T14:25:00Z'));
    expect(id).toMatch(/^C-20260830-/);
    const n = parseNote(readFileSync(join(root, path), 'utf8'), path);
    expect(n.origin).toBe('agent-inferred');
    expect(n.type).toBe('insight');
    expect(n.expires).toBe('2026-09-29');
    expect(n.sources).toContain('S-20260830-1420');
    expect(n.title).toBe('Manifest size cliffs cluster at lockfile v3');
  });

  test('enforces the cap of 3 candidates per session', () => {
    const now = new Date('2026-08-30T14:25:00Z');
    writeCandidate(root, { ...payload, title: 'One' }, now);
    writeCandidate(root, { ...payload, title: 'Two' }, now);
    writeCandidate(root, { ...payload, title: 'Three' }, now);
    expect(() => writeCandidate(root, { ...payload, title: 'Four' }, now)).toThrow(/cap/i);
  });
});
