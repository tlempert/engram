import { describe, expect, test } from 'bun:test';
import { renderBundle } from '../src/render';
import type { Bundle } from '../src/types';

const bundle: Bundle = {
  items: [
    {
      id: 'd1',
      path: 'zettel/Guard at the call site.md',
      title: 'Guard at the call site',
      type: 'decision',
      origin: 'user-articulated',
      status: 'active',
      scope: 'project:backslash',
      content: 'Never widen shared method signatures for one caller.',
      why: 'matched "retry, logic"; decision boost; active in project:backslash',
      tokenCost: 14,
      score: 2.1,
    },
    {
      id: 'q1',
      path: 'zettel/Do we own backpressure.md',
      title: 'Do we own backpressure',
      type: 'question',
      origin: 'collaborative',
      status: 'active',
      scope: 'global',
      content: 'Open: queue or worker?',
      why: 'matched "queue"',
      tokenCost: 6,
      score: 0.8,
    },
  ],
  insufficiencies: [],
  omitted: ['Old incident review (over budget)'],
  budget: { requested: 1200, used: 20 },
  taskKind: 'factual',
};

describe('renderBundle: markdown', () => {
  const md = renderBundle(bundle, 'markdown');

  test('header carries token use and item count', () => {
    expect(md).toContain('## Memory (engram · 20/1200 tokens · 2 items)');
  });

  test('each item renders a typed label, id, short origin, and status', () => {
    expect(md).toContain('**Decision** [d1 · user · active · project:backslash]');
    expect(md).toContain('**Open question** [q1 · collab · active]');
  });

  test('content and why-lines are present', () => {
    expect(md).toContain('Never widen shared method signatures for one caller.');
    expect(md).toContain('↳ why: matched "retry, logic"; decision boost; active in project:backslash');
  });

  test('omitted hints and the citation instruction are in the footer', () => {
    expect(md).toContain('omitted: Old incident review (over budget)');
    expect(md).toContain('cite the memory ids you use');
  });
});

describe('renderBundle: empty bundle', () => {
  const emptyBundle: Bundle = {
    items: [],
    insufficiencies: ['No relevant memory for "sear a steak" — proceed from first principles.'],
    omitted: [],
    budget: { requested: 1200, used: 0 },
    taskKind: 'factual',
  };

  test('renders the insufficiency instead of item scaffolding', () => {
    const md = renderBundle(emptyBundle, 'markdown');
    expect(md).toContain('no memory returned');
    expect(md).toContain('proceed from first principles');
    expect(md).not.toContain('**');
    expect(md).not.toContain('cite the memory ids');
  });
});

describe('renderBundle: json', () => {
  test('json format round-trips the bundle object', () => {
    const parsed = JSON.parse(renderBundle(bundle, 'json'));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].id).toBe('d1');
    expect(parsed.budget).toEqual({ requested: 1200, used: 20 });
  });
});
