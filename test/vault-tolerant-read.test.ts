import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadVaultNotes } from '../src/vault';

/**
 * Queries scan the vault without a lock while promotion, rejection, and expiry
 * rename files underneath them. A file listed by readdir and gone by stat or
 * read must be skipped, not turn the whole memory_query into an error.
 * A dangling symlink reproduces "listed, then vanished" deterministically.
 */
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-tolerant-'));
  for (const d of ['zettel', 'inbox', 'evidence/sessions', 'maps']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'zettel/Real note.md'), '---\nid: r1\ntype: insight\n---\n\n# Real note\n\nStill here.\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('loadVaultNotes under concurrent moves', () => {
  test('a file that vanishes between listing and reading is skipped', () => {
    symlinkSync(join(root, 'inbox/gone-already.md'), join(root, 'inbox/C-20260906-01.md'));
    const notes = loadVaultNotes(root);
    expect(notes.map((n) => n.id)).toEqual(['r1']);
  });
});
