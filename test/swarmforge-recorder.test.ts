import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * SwarmForge has the coordination plane (board, handoffs, worktrees) and no
 * memory. The recorder is the one writer between the two: for every card the
 * board has moved to `done`, it files exactly one session record built from
 * the operator's task document and the completed handoffs, keyed by
 * swarmforge:<slug>:<task-id> so a crash-and-retry cannot double-record.
 */
const CLI = join(import.meta.dir, '../src/cli.ts');
const RECORDER = join(import.meta.dir, '../swarmforge/record-cards.ts');
let vault: string;
let project: string;

const TASK_ID = '20260906T101500000000Z-retry-backoff';
const CARD = 'retry-backoff';

function handoff(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nRe-read your role and constitution.\n';
}

function writeCompleted(worktree: string, name: string, headers: Record<string, string>): void {
  const dir = join(worktree, '.swarmforge/handoffs/inbox/completed');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), handoff(headers));
}

function run(...args: string[]): { out: string; code: number } {
  const proc = Bun.spawnSync(['bun', RECORDER, '--root', project, '--slug', 'acme', ...args], {
    env: { ...process.env, ENGRAM_VAULT: vault },
  });
  return { out: proc.stdout.toString() + proc.stderr.toString(), code: proc.exitCode ?? 1 };
}

const sessions = () => (existsSync(join(vault, 'evidence/sessions')) ? readdirSync(join(vault, 'evidence/sessions')) : []);

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'engram-sf-vault-'));
  Bun.spawnSync(['bun', CLI, 'init', vault], { env: { ...process.env, ENGRAM_VAULT: vault } });
  writeFileSync(join(vault, '_system/config.yaml'), 'retriever: fts5\n');

  project = mkdtempSync(join(tmpdir(), 'engram-sf-project-'));
  mkdirSync(join(project, '.swarmforge/board'), { recursive: true });
  mkdirSync(join(project, 'tasks'), { recursive: true });
  const coder = join(project, '.worktrees/coder');
  const qa = join(project, '.worktrees/QA');
  mkdirSync(coder, { recursive: true });
  mkdirSync(qa, { recursive: true });
  // Real layout (swarmforge.bb write-roles-file!): role, worktree-name, worktree-path, session, display, agent, mode, propagation.
  writeFileSync(
    join(project, '.swarmforge/roles.tsv'),
    [
      `specifier\tmaster\t${project}\tsf-specifier\tSpecifier\tcodex\ttask\tforward-only`,
      `coder\tcoder\t${coder}\tsf-coder\tCoder\tclaude\ttask\tforward-only`,
      `QA\tQA\t${qa}\tsf-QA\tQA\tclaude\tbatch\tback-all`,
    ].join('\n') + '\n',
  );
  writeFileSync(
    join(project, '.swarmforge/board/tasks.tsv'),
    [
      `${CARD}\tdone\t2026-09-06T10:15:00Z\t2026-09-06T12:40:00Z\t${TASK_ID}\t1`,
      `still-cooking\tcoder\t2026-09-06T11:00:00Z\t2026-09-06T11:30:00Z\t20260906T110000000000Z-still-cooking\t0`,
    ].join('\n') + '\n',
  );
  writeFileSync(join(project, `tasks/${CARD}.md`), `# ${CARD}\n\nAdd exponential backoff to the retry loop; cap at five attempts.\n`);

  // coder received the specifier's handoff; QA received the hardender's and sent the terminal one.
  writeCompleted(coder, `50_20260906T103000Z_000001_from_specifier_to_coder.handoff`, {
    id: '20260906T103000Z_000001_from_specifier', from: 'specifier', to: 'coder', recipient: 'coder', priority: '50',
    type: 'git_handoff', role: 'specifier', task: CARD, task_id: TASK_ID, commit: 'a1b2c3d4e5',
    created_at: '2026-09-06T10:30:00Z', completed_at: '2026-09-06T11:10:00Z',
  });
  writeCompleted(qa, `50_20260906T121000Z_000007_from_hardender_to_QA.handoff`, {
    id: '20260906T121000Z_000007_from_hardender', from: 'hardender', to: 'QA', recipient: 'QA', priority: '50',
    type: 'git_handoff', role: 'hardender', task: CARD, task_id: TASK_ID, commit: 'f6e5d4c3b2',
    created_at: '2026-09-06T12:10:00Z', completed_at: '2026-09-06T12:40:00Z',
  });
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('swarmforge record-cards', () => {
  test('files one attributed record per done card and marks it recorded', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(sessions()).toHaveLength(1);

    const record = readFileSync(join(vault, 'evidence/sessions', sessions()[0]!), 'utf8');
    expect(record).toContain(`external-id: swarmforge:acme:${TASK_ID}`);
    expect(record).toContain('scope: project:acme');
    expect(record).toContain('client: swarmforge');
    expect(record).toMatch(/agents:\n(\s+- \w+\n)+/);
    for (const role of ['specifier', 'hardender']) expect(record).toContain(`- ${role}`);
    expect(record).toContain('Add exponential backoff');
    expect(record).toContain('f6e5d4c3b2');
    expect(record).not.toContain('still-cooking');

    const marker = join(project, `.swarmforge/memory/recorded/${TASK_ID}`);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toMatch(/S-\d{8}-\d{4}/);
    expect(Bun.spawnSync(['git', '-C', vault, 'log', '--format=%an', '-1']).stdout.toString().trim()).toBe('swarmforge-recorder');
  });

  test('a second run records nothing new', () => {
    expect(run().code).toBe(0);
    const again = run();
    expect(again.code).toBe(0);
    expect(sessions()).toHaveLength(1);
    expect(again.out).toContain('0 new');
  });

  test('a lost marker is reconciled through the externalId, not by duplicating', () => {
    expect(run().code).toBe(0);
    rmSync(join(project, '.swarmforge/memory'), { recursive: true, force: true });
    expect(run().code).toBe(0);
    expect(sessions()).toHaveLength(1);
    expect(existsSync(join(project, `.swarmforge/memory/recorded/${TASK_ID}`))).toBe(true);
  });
});
