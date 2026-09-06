import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'fs';
import { join } from 'path';

/** Inside .index/ so it is never indexed, never committed, and gone with `rebuild`. */
export const LOCK_PATH = '.index/write.lock';
const WAIT_MS = 15_000;
const POLL_MS = 50;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

/**
 * Reclaim a lock whose owner died mid-write. The rename is the arbiter: of
 * several waiters that all see the same dead pid, exactly one rename succeeds,
 * so a lock freshly taken by a live process is never removed by mistake.
 */
function reclaimIfStale(file: string): void {
  let pid: number;
  try {
    pid = Number(readFileSync(file, 'utf8').trim());
  } catch {
    return; // released between our open and our read
  }
  if (!Number.isInteger(pid) || processAlive(pid)) return;
  const claimed = `${file}.stale-${process.pid}`;
  try {
    renameSync(file, claimed);
    unlinkSync(claimed);
  } catch {
    // another waiter reclaimed it first
  }
}

/**
 * Run `fn` holding the vault's single write lock.
 *
 * Every write is allocate-id → write file → commit, and each step is
 * check-then-act against shared state (the inbox listing, .git/index).
 * Several engram processes on one vault must therefore take turns. The lock
 * is an O_EXCL file holding the owner's pid; waiters poll until it is gone
 * or the wait deadline passes, in which case the write fails loudly rather
 * than proceeding unlocked.
 */
export function withVaultLock<T>(root: string, fn: () => T): T {
  const file = join(root, LOCK_PATH);
  mkdirSync(join(root, '.index'), { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() > deadline) {
        throw new Error(`vault write lock ${file} held for over ${WAIT_MS / 1000}s; another engram process may be stuck`);
      }
      reclaimIfStale(file);
      Bun.sleepSync(POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // already gone: nothing to release
    }
  }
}
