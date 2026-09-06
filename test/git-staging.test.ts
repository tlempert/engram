import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpClient } from './mcp-client';

/**
 * The vault's Git history is the audit trail: `git log --author` says which
 * agent wrote what, and `doctor` flags zettel commits by anyone but tal.
 * Both collapse if a commit stages more than the operation wrote.
 */
const CLI = join(import.meta.dir, '../src/cli.ts');
let root: string;

function engram(...args: string[]): { out: string; code: number } {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { env: { ...process.env, ENGRAM_VAULT: root } });
  return { out: proc.stdout.toString() + proc.stderr.toString(), code: proc.exitCode ?? 1 };
}

function git(...args: string[]): string {
  return Bun.spawnSync(['git', '-C', root, ...args]).stdout.toString().trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-git-'));
  engram('init', root);
  writeFileSync(join(root, '_system/config.yaml'), 'retriever: fts5\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('commits stage only what the operation wrote', () => {
  test('a stray zettel edit is not swept into an agent record commit', () => {
    // A bypass-permissions agent (or anyone) drops a file straight into the canonical zone.
    writeFileSync(join(root, 'zettel/Stray.md'), '# Stray\n\nNot written through engram.\n');

    const r = engram('record', '--json', JSON.stringify({ task: 'swarm card 7', author: 'coder' }));
    expect(r.code).toBe(0);

    const committed = git('show', '--name-only', '--format=', 'HEAD').split('\n');
    expect(committed.some((p) => p.startsWith('evidence/sessions/'))).toBe(true);
    expect(committed).not.toContain('zettel/Stray.md');
    expect(git('status', '--porcelain', '--untracked-files=all')).toContain('?? zettel/Stray.md');
  });

  test('promotion commits the new zettel and the archived candidate, nothing else', () => {
    engram('propose', '--json', JSON.stringify({
      kind: 'candidate', author: 'forge', title: 'Retries mask OOM', proposedType: 'insight', body: 'A claim.',
    }));
    writeFileSync(join(root, 'zettel/Stray.md'), '# Stray\n');

    const r = engram('review', '--accept', 'C-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-01');
    expect(r.code).toBe(0);

    // --no-renames: list the inbox deletion and the archive addition separately.
    const committed = git('show', '--no-renames', '--name-only', '--format=', 'HEAD').split('\n').sort();
    expect(committed).toEqual(expect.arrayContaining(['zettel/Retries mask OOM.md']));
    expect(committed.some((p) => p.startsWith('archive/promoted-'))).toBe(true);
    expect(committed.some((p) => p.startsWith('inbox/'))).toBe(true); // the removal is staged too
    expect(committed).not.toContain('zettel/Stray.md');
  });
});

describe('a failed commit is reported as a failure', () => {
  test('CLI record exits non-zero when git cannot commit', () => {
    writeFileSync(join(root, '.git/index.lock'), ''); // another process holds the index
    const r = engram('record', '--json', JSON.stringify({ task: 'swarm card 8', author: 'coder' }));
    expect(r.code).not.toBe(0);
    expect(r.out.toLowerCase()).toContain('git');
    expect(r.out).not.toContain('recorded S-');
  });

  test('MCP memory_record answers with an error when git cannot commit', async () => {
    writeFileSync(join(root, '.git/index.lock'), '');
    const client = new McpClient(root);
    try {
      await client.initialize();
      const res = await client.call('memory_record', { task: 'swarm card 9', author: 'coder' });
      expect(res.isError).toBe(true);
      expect(res.text.toLowerCase()).toContain('git');
    } finally {
      client.close();
    }
    expect(existsSync(join(root, '.git/index.lock'))).toBe(true); // we never touch a lock we do not own
  }, 15000);
});
