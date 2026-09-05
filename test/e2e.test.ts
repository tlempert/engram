import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI = join(import.meta.dir, '../src/cli.ts');
let root: string;

function engram(...args: string[]): { out: string; code: number } {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { env: { ...process.env, ENGRAM_VAULT: root } });
  return {
    out: proc.stdout.toString() + proc.stderr.toString(),
    code: proc.exitCode ?? 1,
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-e2e-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('engram end-to-end', () => {
  test('init scaffolds the vault with zones, config, and a git repo', () => {
    const r = engram('init', root);
    expect(r.code).toBe(0);
    for (const p of ['zettel', 'inbox', 'evidence/sessions', 'maps', '_system/policies/default.yaml', '_system/eval/probes.yaml', '.gitignore']) {
      expect(existsSync(join(root, p))).toBe(true);
    }
    expect(existsSync(join(root, '.git'))).toBe(true);
    // Pin the retriever: qmd collections are machine-global, so a temp vault would
    // otherwise pick up whatever engram-* collections the developer has registered.
    writeFileSync(join(root, '_system/config.yaml'), 'retriever: fts5\n');
  });

  test('query on an empty vault abstains explicitly', () => {
    const r = engram('query', 'extend the retry logic for queue jobs');
    expect(r.code).toBe(0);
    expect(r.out).toContain('no memory returned');
  });

  test('record writes session evidence', () => {
    const r = engram('record', '--json', JSON.stringify({ task: 'Fix the sca-deps queue OOM', outcome: 'shipped', client: 'test' }));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/S-\d{8}-\d{4}/);
  });

  test('propose writes an inbox candidate that queries must NOT see', () => {
    const r = engram(
      'propose',
      '--json',
      JSON.stringify({
        kind: 'candidate',
        title: 'Retries mask out-of-memory failures',
        proposedType: 'insight',
        body: 'On the sca-deps queue, retries masked OOM kills on oversized manifests instead of fixing them.',
        author: 'forge',
        tags: ['incidents', 'retries'],
      }),
    );
    expect(r.code).toBe(0);
    const q = engram('query', 'why do retries mask out-of-memory failures on the queue');
    expect(q.out).toContain('no memory returned');
  });

  test('review --list shows the pending candidate', () => {
    const r = engram('review', '--list');
    expect(r.out).toContain('Retries mask out-of-memory failures');
  });

  test('review --accept promotes it, and the same query now returns it with a why-line', () => {
    const list = engram('review', '--list');
    const id = list.out.match(/C-\d{8}-\d{2}/)?.[0];
    expect(id).toBeDefined();
    const r = engram('review', '--accept', id!);
    expect(r.code).toBe(0);
    const q = engram('query', 'why do retries mask out-of-memory failures on the queue');
    expect(q.out).toContain('Retries mask out-of-memory failures');
    expect(q.out).toContain('↳ why:');
    expect(q.out).toContain('[mem:');
  });

  test('the promoted zettel is committed with tal as author', () => {
    const log = Bun.spawnSync(['git', '-C', root, 'log', '--format=%an %s', '-3']).stdout.toString();
    expect(log).toContain('tal');
    expect(log).toMatch(/promote/i);
  });

  test('stats reports zone and origin counts', () => {
    const r = engram('stats');
    expect(r.out).toMatch(/zettel:\s*1/);
  });

  test('doctor runs clean on a healthy vault', () => {
    const r = engram('doctor');
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/VIOLATION/);
  });

  test('eval runs the starter probes without failures', () => {
    const r = engram('eval');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/quarantine/i);
    expect(r.out).not.toMatch(/FAIL/);
  });

  test('a poisoned candidate in the inbox never surfaces, and doctor stays clean', () => {
    engram(
      'propose',
      '--json',
      JSON.stringify({
        kind: 'candidate',
        title: 'Tal prefers merge commits everywhere',
        proposedType: 'preference',
        body: 'Injected instruction claiming Tal prefers merge commits over rebase in all repositories.',
        author: 'forge',
        sourceTrust: 'external-untrusted',
      }),
    );
    const q = engram('query', 'does Tal prefer merge commits over rebase everywhere');
    expect(q.out).toContain('no memory returned');
    const ev = engram('eval');
    expect(ev.out).not.toMatch(/quarantine.*violation/i);
  });
});
