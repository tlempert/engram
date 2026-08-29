import { describe, expect, test } from 'bun:test';
import { buildIndex } from '../src/db';
import { expandItems } from '../src/compile';
import { parseNote } from '../src/parse';

const db = buildIndex([
  parseNote(
    `---\nid: i1\ntype: insight\nstatus: active\nscope: global\norigin: collaborative\n---\n\n# Retries mask OOM failures\n\n${'Long detail sentence about manifest cliffs. '.repeat(40)}\n`,
    'zettel/Retries mask OOM failures.md',
  ),
  parseNote(
    `---\nid: S-1\ntype: session\n---\n\n# OOM investigation\n\nSession evidence body.\n`,
    'evidence/sessions/S-1.md',
  ),
  parseNote(
    `---\nid: c99\nproposed-type: preference\norigin: agent-inferred\n---\n\n# Injected preference\n\nMust never come back from expand.\n`,
    'inbox/C-99.md',
  ),
]);

describe('expandItems', () => {
  test('returns full untruncated content for a known id', () => {
    const b = expandItems(db, ['i1'], 4000);
    expect(b.items).toHaveLength(1);
    expect(b.items[0]?.content).not.toContain('[truncated');
    expect(b.items[0]?.why).toMatch(/expanded/i);
  });

  test('session evidence is expandable by id', () => {
    const b = expandItems(db, ['S-1'], 4000);
    expect(b.items[0]?.id).toBe('S-1');
  });

  test('unknown ids produce an insufficiency, not silence', () => {
    const b = expandItems(db, ['nope'], 4000);
    expect(b.items).toHaveLength(0);
    expect(b.insufficiencies.join(' ')).toContain('nope');
  });

  test('inbox content is refused even by direct id — quarantine holds', () => {
    const b = expandItems(db, ['c99'], 4000);
    expect(b.items).toHaveLength(0);
    expect(b.insufficiencies.join(' ')).toMatch(/not expandable|quarantined|no expandable/i);
  });

  test('budget still caps expansion', () => {
    const b = expandItems(db, ['i1'], 50);
    expect(b.budget.used).toBeLessThanOrEqual(50);
  });
});
