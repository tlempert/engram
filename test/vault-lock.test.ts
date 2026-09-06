import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Six swarm agents each run their own `engram serve` against one vault.
 * Id allocation and file creation were check-then-write with no lock, and
 * every commit contends for .git/index.lock. Writes must serialize across
 * processes: one vault-wide lock around allocate + write + commit.
 */
const CLI = join(import.meta.dir, '../src/cli.ts');
const LOCK = '.index/write.lock';
let root: string;

type Child = Bun.Subprocess<'ignore', 'pipe', 'pipe'>;

function spawnEngram(...args: string[]): Child {
  return Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, ENGRAM_VAULT: root },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function finish(proc: Child): Promise<{ code: number; out: string }> {
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: out + err };
}

function git(...args: string[]): string {
  return Bun.spawnSync(['git', '-C', root, ...args]).stdout.toString().trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-lock-'));
  Bun.spawnSync(['bun', CLI, 'init', root], { env: { ...process.env, ENGRAM_VAULT: root } });
  writeFileSync(join(root, '_system/config.yaml'), 'retriever: fts5\n');
  Bun.spawnSync(['git', '-C', root, 'commit', '-qam', 'test: pin retriever']);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('vault writes serialize across processes', () => {
  test('six concurrent proposers get six distinct candidates and six commits', async () => {
    const roles = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'QA'];
    const procs = roles.map((role) =>
      spawnEngram('propose', '--json', JSON.stringify({
        kind: 'candidate', author: role, title: `Lesson from ${role}`, proposedType: 'insight', body: `What ${role} learned.`,
      })),
    );
    const results = await Promise.all(procs.map(finish));

    for (const r of results) expect(r.code).toBe(0);
    const candidates = readdirSync(join(root, 'inbox')).filter((f) => f.startsWith('C-'));
    expect(candidates).toHaveLength(6);
    expect(git('log', '--format=%an', '--grep=propose').split('\n').sort()).toEqual([...roles].sort());
    expect(git('status', '--porcelain')).toBe('');
  }, 60000);

  test('a live lock is waited for, not clobbered', async () => {
    mkdirSync(join(root, '.index'), { recursive: true });
    writeFileSync(join(root, LOCK), `${process.pid}\n`); // held by this (alive) test process
    const started = Date.now();
    const proc = spawnEngram('record', '--json', JSON.stringify({ task: 'card 3', author: 'coder' }));
    setTimeout(() => unlinkSync(join(root, LOCK)), 1500);

    const r = await finish(proc);
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(git('log', '--format=%s', '-1')).toContain('record session');
  }, 30000);

  test('a lock left behind by a dead process is reclaimed', async () => {
    mkdirSync(join(root, '.index'), { recursive: true });
    // A writer that crashed mid-write: its pid is long gone, its lock file is not.
    const dead = Bun.spawnSync(['sh', '-c', 'echo $$']).stdout.toString().trim();
    writeFileSync(join(root, LOCK), `${dead}\n`);
    const started = Date.now();
    const r = await finish(spawnEngram('record', '--json', JSON.stringify({ task: 'card 4', author: 'coder' })));
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(git('log', '--format=%s', '-1')).toContain('record session');
  }, 30000);
});
