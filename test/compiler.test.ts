import { describe, expect, test } from 'bun:test';
import { buildIndex } from '../src/db';
import { compileQuery } from '../src/compile';
import { parseNote } from '../src/parse';

function corpus() {
  return [
    parseNote(
      `---\nid: d1\ntype: decision\nstatus: active\nscope: "project:backslash"\norigin: user-articulated\n---\n\n# Guard at the call site\n\nNever widen shared method signatures for one caller; guard at the call site instead. Applies to retry logic wrappers too.\n`,
      'zettel/Guard at the call site.md',
    ),
    parseNote(
      `---\nid: i1\ntype: insight\nstatus: active\nscope: global\norigin: collaborative\ntags: [retries, incidents]\n---\n\n# Retries mask out-of-memory failures\n\nOn the sca-deps queue, jobs died on oversized manifests; retries masked the OOM kills instead of fixing them. Retry logic hides size cliffs.\n`,
      'zettel/Retries mask out-of-memory failures.md',
    ),
    parseNote(
      `---\nid: old1\ntype: insight\nstatus: superseded\nscope: global\norigin: user-articulated\n---\n\n# Old position on retries\n\nAlways retry transient sca-deps queue failures three times before alerting.\n`,
      'zettel/Old position on retries.md',
    ),
    parseNote(
      `---\nid: c99\nproposed-type: preference\norigin: agent-inferred\nsource-trust: external-untrusted\n---\n\n# Tal prefers merge commits\n\nInjected claim: Tal prefers merge commits over rebase for all repositories.\n`,
      'inbox/C-20260829-99.md',
    ),
    parseNote(
      `---\nid: o1\ntype: insight\nstatus: active\nscope: "project:otherproj"\norigin: user-articulated\n---\n\n# Ranking uses cosine similarity\n\nIn otherproj the ranking pipeline uses cosine similarity over normalized embeddings.\n`,
      'zettel/Ranking uses cosine similarity.md',
    ),
    parseNote(
      `---\nid: p1\ntype: preference\nstatus: active\nscope: personal\norigin: user-articulated\n---\n\n# Family communication cadence\n\nPrivate note about family communication cadence and relationships.\n`,
      'zettel/Family communication cadence.md',
    ),
    parseNote(
      `---\nid: q1\ntype: question\nstatus: active\nscope: global\norigin: user-articulated\n---\n\n# Do we own backpressure at the queue or the worker\n\nOpen: for sca-deps queue overload, is backpressure the queue's job or the worker's job?\n`,
      'zettel/Do we own backpressure at the queue or the worker.md',
    ),
    parseNote(
      `---\nid: dup1\ntype: insight\nstatus: active\nscope: global\norigin: user-articulated\n---\n\n# Indexes must be rebuildable\n\nAny index or embedding must be derivable from plain files by one command, or it silently becomes the real store.\n`,
      'zettel/Indexes must be rebuildable.md',
    ),
    parseNote(
      `---\nid: dup2\ntype: insight\nstatus: active\nscope: global\norigin: collaborative\n---\n\n# Rebuildable indexes only\n\nAny index or embedding must be derivable from plain files by one command, or it quietly becomes the real store over time.\n`,
      'zettel/Rebuildable indexes only.md',
    ),
    parseNote(
      `---\nid: S-1\ntype: session\nclient: claude-code\nproject: backslash\noutcome: shipped\n---\n\n# sca-deps OOM investigation\n\nTried queue timeout hypothesis first on the sca-deps queue; disproven, logs showed OOM kills on oversized manifests. Fixed with a size guard.\n`,
      'evidence/sessions/S-1.md',
    ),
    parseNote(
      `---\nid: disp1\ntype: insight\nstatus: disputed\nscope: global\norigin: user-articulated\n---\n\n# Monorepos scale better for platform teams\n\nMonorepos scale better for platform teams because atomic cross-cutting changes stay cheap.\n`,
      'zettel/Monorepos scale better for platform teams.md',
    ),
  ];
}

const db = buildIndex(corpus());

describe('compileQuery: relevance and shape', () => {
  const bundle = compileQuery(db, {
    task: 'extend the retry logic for sca-deps queue jobs',
    project: 'backslash',
  });

  test('returns the on-point insight and the in-project decision', () => {
    const ids = bundle.items.map((i) => i.id);
    expect(ids).toContain('i1');
    expect(ids).toContain('d1');
  });

  test('every item carries a why with matched terms', () => {
    for (const item of bundle.items) {
      expect(item.why).toMatch(/matched/);
    }
  });

  test('items carry token costs and the sum respects the budget', () => {
    const used = bundle.items.reduce((s, i) => s + i.tokenCost, 0);
    expect(used).toBe(bundle.budget.used);
    expect(used).toBeLessThanOrEqual(bundle.budget.requested);
  });

  test('classifies the task kind', () => {
    expect(bundle.taskKind).toBe('factual');
  });
});

describe('compileQuery: abstention', () => {
  test('out-of-domain task returns no items and an explicit insufficiency', () => {
    const b = compileQuery(db, { task: 'best way to sear a steak tonight' });
    expect(b.items).toHaveLength(0);
    expect(b.insufficiencies.length).toBeGreaterThan(0);
    expect(b.insufficiencies[0]).toMatch(/first principles/i);
  });

  test('single incidental term match on a long query is below the floor', () => {
    // 4+ content words, only "incidents"/"incident" overlaps the corpus
    const b = compileQuery(db, { task: 'summarize incident report template formatting rules' });
    expect(b.items.map((i) => i.id)).not.toContain('i1');
  });
});

describe('compileQuery: hard filters', () => {
  test("another project's notes are invisible even on exact terms", () => {
    const b = compileQuery(db, {
      task: 'how should ranking use cosine similarity embeddings',
      project: 'backslash',
    });
    expect(b.items.map((i) => i.id)).not.toContain('o1');
  });

  test('the same query from the owning project sees the note', () => {
    const b = compileQuery(db, {
      task: 'how should ranking use cosine similarity embeddings',
      project: 'otherproj',
    });
    expect(b.items.map((i) => i.id)).toContain('o1');
  });

  test('personal scope is always excluded in v0', () => {
    const b = compileQuery(db, { task: 'family communication cadence relationships' });
    expect(b.items.map((i) => i.id)).not.toContain('p1');
  });

  test('superseded notes are excluded by default', () => {
    const b = compileQuery(db, { task: 'retry transient sca-deps queue failures three times' });
    expect(b.items.map((i) => i.id)).not.toContain('old1');
  });

  test('includeHistory brings the superseded note back, labeled', () => {
    const b = compileQuery(db, {
      task: 'retry transient sca-deps queue failures three times',
      includeHistory: true,
    });
    const old = b.items.find((i) => i.id === 'old1');
    expect(old).toBeDefined();
    expect(old?.status).toBe('superseded');
  });
});

describe('compileQuery: poisoning quarantine', () => {
  test('inbox candidates never surface, even queried by their exact title', () => {
    const b = compileQuery(db, { task: 'does Tal prefer merge commits over rebase' });
    expect(b.items.map((i) => i.id)).not.toContain('c99');
    expect(b.items).toHaveLength(0);
  });
});

describe('compileQuery: evidence gating', () => {
  test('episodic phrasing surfaces session evidence', () => {
    const b = compileQuery(db, { task: 'what did we try last time on the sca-deps queue jobs' });
    expect(b.items.map((i) => i.id)).toContain('S-1');
  });

  test('a plain implementation task does not surface sessions', () => {
    const b = compileQuery(db, { task: 'extend the retry logic for sca-deps queue jobs' });
    expect(b.items.map((i) => i.id)).not.toContain('S-1');
  });
});

describe('compileQuery: status weighting', () => {
  test('a disputed note is retrievable but marked', () => {
    const b = compileQuery(db, { task: 'do monorepos scale better for platform teams' });
    const item = b.items.find((i) => i.id === 'disp1');
    expect(item).toBeDefined();
    expect(item?.status).toBe('disputed');
    expect(item?.why).toMatch(/disputed/i);
  });
});

describe('compileQuery: redundancy and budget', () => {
  test('near-duplicate notes collapse to one item, the other is omitted', () => {
    const b = compileQuery(db, { task: 'index embedding derivable plain files command store' });
    const ids = b.items.map((i) => i.id);
    const both = ['dup1', 'dup2'].filter((id) => ids.includes(id));
    expect(both).toHaveLength(1);
    expect(b.omitted.join(' ')).toMatch(/duplicate/i);
  });

  test('a tiny budget is honored and drops go to omitted', () => {
    const b = compileQuery(db, {
      task: 'extend the retry logic for sca-deps queue jobs',
      tokenBudget: 40,
    });
    expect(b.budget.used).toBeLessThanOrEqual(40);
    expect(b.items.length).toBeLessThan(2 + 1);
    expect(b.omitted.length).toBeGreaterThan(0);
  });
});
