import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { QMD_TIMEOUT_MS, qmdBinaryAvailable, qmdSearch } from '../src/qmd';

/**
 * Regression: a stalled qmd must not stall memory_query.
 *
 * qmd vsearch loads an embedding model and has been observed never returning.
 * Every agent calling memory_query under `retriever: auto` inherited that hang.
 * A stalled arm is a failed arm: return null within the deadline so the caller
 * falls back to FTS5.
 */
describe('qmd subprocess deadline', () => {
  let bin: string;
  let originalPath: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), 'engram-fake-qmd-'));
    // A qmd that never answers, whatever it is asked.
    writeFileSync(join(bin, 'qmd'), '#!/bin/sh\nsleep 600\n');
    chmodSync(join(bin, 'qmd'), 0o755);
    originalPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${originalPath ?? ''}`;
  });

  afterAll(() => {
    process.env['PATH'] = originalPath;
    rmSync(bin, { recursive: true, force: true });
  });

  test('vsearch that never returns yields null within the deadline', () => {
    const started = Date.now();
    const hits = qmdSearch(['retry', 'logic'], ['zettel'], 5, () => null);
    const elapsed = Date.now() - started;
    expect(hits).toBeNull();
    expect(elapsed).toBeLessThan(QMD_TIMEOUT_MS + 1500);
  }, QMD_TIMEOUT_MS + 3000);

  test('availability probe that never returns reports qmd unavailable', () => {
    const started = Date.now();
    expect(qmdBinaryAvailable()).toBe(false);
    expect(Date.now() - started).toBeLessThan(QMD_TIMEOUT_MS + 1500);
  }, QMD_TIMEOUT_MS + 3000);
});
