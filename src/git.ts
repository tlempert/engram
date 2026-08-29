import { existsSync } from 'fs';
import { join } from 'path';

export interface GitAuthor {
  name: string;
  email: string;
}

export const TAL: GitAuthor = { name: 'tal', email: 'tal@engram' };

export function agentAuthor(name: string): GitAuthor {
  return { name, email: 'agent@engram' };
}

function git(root: string, ...args: string[]): { ok: boolean; out: string } {
  const proc = Bun.spawnSync(['git', '-C', root, ...args]);
  return { ok: proc.exitCode === 0, out: proc.stdout.toString() + proc.stderr.toString() };
}

export function gitInit(root: string): void {
  if (existsSync(join(root, '.git'))) return;
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', TAL.name);
  git(root, 'config', 'user.email', TAL.email);
}

/** Stage everything and commit as the given author. Vault-without-git degrades to a no-op. */
export function commitAll(root: string, message: string, author: GitAuthor = TAL): boolean {
  if (!existsSync(join(root, '.git'))) return false;
  git(root, 'add', '-A');
  const r = git(
    root,
    '-c', `user.name=${author.name}`,
    '-c', `user.email=${author.email}`,
    'commit', '-q', '-m', message,
  );
  return r.ok;
}

/** Distinct commit authors that have touched a path — doctor's audit input. */
export function authorsFor(root: string, path: string): string[] {
  const r = git(root, 'log', '--format=%an', '--', path);
  if (!r.ok) return [];
  return [...new Set(r.out.split('\n').map((l) => l.trim()).filter(Boolean))];
}
