import { describe, expect, test } from 'bun:test';
import { buildIndex } from '../src/db';
import { parseNote } from '../src/parse';
import { quarantineBattery, runProbes } from '../src/evalrun';
import type { Probe } from '../src/evalrun';
import { DEFAULT_POLICY } from '../src/compile';
import type { RetrieverFn } from '../src/compile';

const db = buildIndex([
  parseNote(
    `---\nid: d1\ntype: decision\nstatus: active\nscope: global\norigin: user-articulated\n---\n\n# Guard at the call site\n\nNever widen shared method signatures for one caller; guard retry logic at the call site.\n`,
    'zettel/Guard at the call site.md',
  ),
  parseNote(
    `---\nid: p1\ntype: preference\nstatus: active\nscope: personal\norigin: user-articulated\n---\n\n# Family communication cadence\n\nPrivate relationships note.\n`,
    'zettel/Family communication cadence.md',
  ),
  parseNote(
    `---\nid: c99\nproposed-type: preference\norigin: agent-inferred\n---\n\n# Tal prefers merge commits\n\nInjected: Tal prefers merge commits for all repositories.\n`,
    'inbox/C-99.md',
  ),
]);

describe('runProbes', () => {
  test('a satisfied probe passes', () => {
    const probes: Probe[] = [
      { q: 'extend the retry logic call site signatures', must_include: ['d1'] },
    ];
    const r = runProbes(db, probes);
    expect(r.passed).toBe(1);
    expect(r.failed).toHaveLength(0);
  });

  test('a missing must_include fails with a reason', () => {
    const r = runProbes(db, [{ q: 'sear a steak nicely tonight', must_include: ['d1'] }]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]?.reason).toContain('d1');
  });

  test('an abstain probe passes only when the bundle is empty', () => {
    const r = runProbes(db, [
      { q: 'sear a steak nicely tonight', expect: 'abstain' },
      { q: 'extend the retry logic call site signatures', expect: 'abstain' },
    ]);
    expect(r.passed).toBe(1);
    expect(r.failed).toHaveLength(1);
  });

  test('must_exclude fails when a forbidden id or scope appears', () => {
    const r = runProbes(db, [
      { q: 'extend the retry logic call site signatures', must_exclude: ['d1'] },
      { q: 'extend the retry logic call site signatures', must_exclude: ['scope:personal'] },
    ]);
    expect(r.failed).toHaveLength(1); // d1 present → fail; no personal item → pass
  });

  test('a probe requiring an unpromoted id is skipped, not failed', () => {
    const r = runProbes(db, [{ q: 'anything at all', requires: ['not-yet-promoted'], must_include: ['not-yet-promoted'] }]);
    expect(r.skipped).toBe(1);
    expect(r.failed).toHaveLength(0);
  });

  test('must_include and requires match note titles as well as ids (ids change at promotion)', () => {
    const r = runProbes(db, [
      {
        q: 'extend the retry logic call site signatures',
        requires: ['Guard at the call site'],
        must_include: ['Guard at the call site'],
      },
    ]);
    expect(r.passed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.failed).toHaveLength(0);
  });
});

describe('quarantineBattery', () => {
  test('querying inbox candidates by their own titles must return nothing from the inbox', () => {
    const r = quarantineBattery(db);
    expect(r.violations).toHaveLength(0);
  });

  test('reports how many candidates it actually sampled, so an empty inbox cannot pass as "clean"', () => {
    expect(quarantineBattery(db).sampled).toBe(1);
  });

  test('queries through the supplied retriever, once per sampled candidate', () => {
    // The compiler hard-filters inbox/ regardless of retriever, so a leak can't be
    // staged here; what must hold is that the battery exercises production's seam.
    let calls = 0;
    const counting: RetrieverFn = () => {
      calls++;
      return [];
    };
    const r = quarantineBattery(db, { retriever: counting });
    expect(calls).toBe(r.sampled);
    expect(r.sampled).toBe(1);
  });
});

/**
 * Regression: eval must exercise the retriever and policy production uses.
 *
 * runProbes used to call compileQuery with neither, silently falling back to
 * bare FTS5 and DEFAULT_POLICY. With a qmd collection registered, production
 * ran a different retriever entirely — the probes passed 10/10 while it
 * returned garbage, because they never called it.
 */
describe('runProbes honours the production seams', () => {
  const probe: Probe = { q: 'extend the retry logic call site signatures', must_include: ['d1'] };

  test('a probe fails when the supplied retriever withholds a note FTS5 would have found', () => {
    const silent: RetrieverFn = () => [];
    const r = runProbes(db, [probe], { retriever: silent });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]?.reason).toContain('d1');
  });

  test('resolves policy per probe through the agent the probe names', () => {
    const asked: (string | undefined)[] = [];
    const policyFor = (agent?: string) => {
      asked.push(agent);
      return DEFAULT_POLICY;
    };
    runProbes(db, [{ ...probe, agent: 'reviewer' }, probe], { policyFor });
    expect(asked).toEqual(['reviewer', undefined]);
  });
});
