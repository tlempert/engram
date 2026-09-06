import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * A harness recorder (SwarmForge's Done hook) can crash between a successful
 * memory_record and writing its own "recorded" marker, then retry on restart.
 * An externalId lets the vault answer the retry with the existing record
 * instead of a duplicate, and refuse a reused key that carries different content.
 */
const CLI = join(import.meta.dir, '../src/cli.ts');
let root: string;

function engram(...args: string[]): { out: string; code: number } {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { env: { ...process.env, ENGRAM_VAULT: root } });
  return { out: proc.stdout.toString() + proc.stderr.toString(), code: proc.exitCode ?? 1 };
}
const record = (payload: Record<string, unknown>) => engram('record', '--json', JSON.stringify(payload));
const sessions = () => readdirSync(join(root, 'evidence/sessions'));
const commits = () => Bun.spawnSync(['git', '-C', root, 'log', '--format=%s', '--grep=record session']).stdout.toString().trim().split('\n').filter(Boolean);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-idem-'));
  engram('init', root);
  writeFileSync(join(root, '_system/config.yaml'), 'retriever: fts5\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('memory_record with an externalId', () => {
  const card = { task: 'card 12: retry backoff', author: 'swarmforge-recorder', outcome: 'shipped', externalId: 'swarmforge:acme:card-12' };

  test('a retried identical record returns the original instead of writing a second one', () => {
    const first = record(card);
    expect(first.code).toBe(0);
    const id = first.out.match(/S-\d{8}-\d{4}(-\d+)?/)![0];

    const retry = record(card);
    expect(retry.code).toBe(0);
    expect(retry.out).toContain(id);
    expect(retry.out).toContain('already recorded');
    expect(sessions()).toHaveLength(1);
    expect(commits()).toHaveLength(1);
  });

  test('a reused externalId with different content is refused', () => {
    expect(record(card).code).toBe(0);
    const clash = record({ ...card, task: 'card 12: something else entirely' });
    expect(clash.code).not.toBe(0);
    expect(clash.out).toContain('swarmforge:acme:card-12');
    expect(sessions()).toHaveLength(1);
  });

  test('records without an externalId are never deduplicated', () => {
    const plain = { task: 'ad hoc session', author: 'fable' };
    expect(record(plain).code).toBe(0);
    expect(record(plain).code).toBe(0);
    expect(sessions()).toHaveLength(2);
  });
});
