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

/**
 * Stage exactly `paths` and commit them as the given author.
 *
 * Only the operation's own files may enter its commit: the history is the
 * audit trail (`git log --author`, doctor's non-tal check), and staging
 * anything broader would launder a stray canonical edit under whoever
 * commits next. Returns false when the vault has no git repo (plain files
 * still work) or when nothing changed. Throws when git itself fails, so no
 * caller can report a write as durable that is not.
 */
export function commitPaths(root: string, paths: string[], message: string, author: GitAuthor = TAL): boolean {
  if (!existsSync(join(root, '.git'))) return false;
  const add = git(root, 'add', '--', ...paths);
  if (!add.ok) throw new Error(`git add failed: ${add.out.trim()}`);
  if (git(root, 'diff', '--cached', '--quiet').ok) return false; // nothing staged
  const r = git(
    root,
    '-c', `user.name=${author.name}`,
    '-c', `user.email=${author.email}`,
    'commit', '-q', '-m', message,
  );
  if (!r.ok) throw new Error(`git commit failed: ${r.out.trim()}`);
  return true;
}

/** Distinct commit authors that have touched a path — doctor's audit input. */
export function authorsFor(root: string, path: string): string[] {
  const r = git(root, 'log', '--format=%an', '--', path);
  if (!r.ok) return [];
  return [...new Set(r.out.split('\n').map((l) => l.trim()).filter(Boolean))];
}
