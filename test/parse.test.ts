import { describe, expect, test } from 'bun:test';
import { estimateTokens, parseNote } from '../src/parse';

const ZETTEL = `---
id: 20260829a
type: insight
status: active
scope: global
author: tal
origin: collaborative
created: 2026-08-29
sources: [S-20260829-1420]
tags: [memory-systems, simplicity]
---

# Indexes must be rebuildable, never canonical

Any index must be derivable from plain files by one command.

Example: Engram v1's qmd mirror was safe.

## Links
- supports [[Complexity must earn its existence]] — rebuildability caps lock-in at zero
- exemplifies [[Local-first software principles]]
- derived-from [[Cross-agent memory requires neutrality]] — no runtime can own shared state
`;

describe('parseNote: zettel frontmatter', () => {
  const note = parseNote(ZETTEL, 'zettel/Indexes must be rebuildable, never canonical.md');

  test('reads scalar frontmatter fields', () => {
    expect(note.id).toBe('20260829a');
    expect(note.type).toBe('insight');
    expect(note.status).toBe('active');
    expect(note.scope).toBe('global');
    expect(note.origin).toBe('collaborative');
    expect(note.author).toBe('tal');
  });

  test('reads list fields', () => {
    expect(note.sources).toEqual(['S-20260829-1420']);
    expect(note.tags).toEqual(['memory-systems', 'simplicity']);
  });

  test('derives zone from the path prefix', () => {
    expect(note.zone).toBe('zettel');
  });

  test('title is the filename without extension for zettel notes', () => {
    expect(note.title).toBe('Indexes must be rebuildable, never canonical');
  });
});

describe('parseNote: typed links', () => {
  const note = parseNote(ZETTEL, 'zettel/Indexes must be rebuildable, never canonical.md');

  test('parses relation, target, and reason from a link line', () => {
    expect(note.links[0]).toEqual({
      relation: 'supports',
      target: 'Complexity must earn its existence',
      reason: 'rebuildability caps lock-in at zero',
    });
  });

  test('parses a link with no reason', () => {
    expect(note.links[1]).toEqual({
      relation: 'exemplifies',
      target: 'Local-first software principles',
      reason: undefined,
    });
  });

  test('parses all link lines', () => {
    expect(note.links).toHaveLength(3);
  });

  test('handles wikilink aliases by keeping the target only', () => {
    const n = parseNote(
      `# T\n\n## Links\n- relates [[Real Target|shown text]]\n`,
      'zettel/T.md',
    );
    expect(n.links[0]?.target).toBe('Real Target');
  });

  test('rejects unknown relations and records a problem', () => {
    const n = parseNote(`# T\n\n## Links\n- lovingly-hugs [[X]] — because\n`, 'zettel/T.md');
    expect(n.links).toHaveLength(0);
    expect(n.problems.some((p) => p.includes('lovingly-hugs'))).toBe(true);
  });

  test('keeps a supports link missing its required reason but records a problem', () => {
    const n = parseNote(`# T\n\n## Links\n- supports [[X]]\n`, 'zettel/T.md');
    expect(n.links).toHaveLength(1);
    expect(n.problems.some((p) => p.includes('reason'))).toBe(true);
  });
});

describe('parseNote: claim extraction', () => {
  const note = parseNote(ZETTEL, 'zettel/Indexes must be rebuildable, never canonical.md');

  test('claim drops frontmatter, the H1, and the Links section', () => {
    expect(note.claim).toContain('derivable from plain files');
    expect(note.claim).toContain("Engram v1's qmd mirror");
    expect(note.claim).not.toContain('## Links');
    expect(note.claim).not.toContain('rebuildability caps');
    expect(note.claim).not.toContain('# Indexes must be rebuildable');
  });

  test('body keeps the Links section', () => {
    expect(note.body).toContain('## Links');
  });
});

describe('parseNote: defaults and special fields', () => {
  test('defaults status to active and scope to global', () => {
    const n = parseNote(`# T\n\nA claim.\n`, 'zettel/T.md');
    expect(n.status).toBe('active');
    expect(n.scope).toBe('global');
  });

  test('extracts supersedes targets from wikilink frontmatter strings', () => {
    const n = parseNote(
      `---\nsupersedes: "[[Old decision]]"\n---\n\n# T\n\nX.\n`,
      'zettel/T.md',
    );
    expect(n.supersedes).toEqual(['Old decision']);
  });

  test('reads candidate fields: proposed-type becomes type, title from H1', () => {
    const n = parseNote(
      `---\nid: C-20260829-01\nproposed-type: preference\norigin: user-articulated\nsource-trust: user-said\nexpires: 2026-09-28\n---\n\n# Guard at the call site\n\nBody.\n`,
      'inbox/C-20260829-01.md',
    );
    expect(n.zone).toBe('inbox');
    expect(n.type).toBe('preference');
    expect(n.title).toBe('Guard at the call site');
    expect(n.sourceTrust).toBe('user-said');
    expect(n.expires).toBe('2026-09-28');
  });

  test('malformed yaml records a problem instead of throwing', () => {
    const n = parseNote(`---\n: [ : broken\n---\n\n# T\n\nX.\n`, 'zettel/T.md');
    expect(n.problems.length).toBeGreaterThan(0);
    expect(n.title).toBe('T');
  });
});

describe('estimateTokens', () => {
  test('estimates roughly one token per four characters', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  test('note.tokens reflects the claim, not the full body', () => {
    const note = parseNote(ZETTEL, 'zettel/Indexes must be rebuildable, never canonical.md');
    expect(note.tokens).toBe(estimateTokens(note.claim));
    expect(note.tokens).toBeLessThan(estimateTokens(note.body));
  });
});
