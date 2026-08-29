import { describe, expect, test } from 'bun:test';
import { contentWords, shingleContainment } from '../src/text';
import { classify } from '../src/classify';

describe('contentWords', () => {
  test('strips stopwords, lowercases, keeps words of length ≥ 3', () => {
    expect(contentWords('Should we adopt Mandol for the memory system?')).toEqual([
      'adopt',
      'mandol',
      'memory',
      'system',
    ]);
  });

  test('deduplicates repeated words', () => {
    expect(contentWords('retry the retry logic')).toEqual(['retry', 'logic']);
  });

  test('returns empty for a pure-stopword query', () => {
    expect(contentWords('what is the')).toEqual([]);
  });
});

describe('shingleContainment', () => {
  const a = 'never widen shared method signatures for one caller guard at the call site instead';

  test('identical text has containment 1', () => {
    expect(shingleContainment(a, a)).toBe(1);
  });

  test('disjoint text has containment 0', () => {
    expect(shingleContainment(a, 'completely different words about cooking pasta tonight')).toBe(0);
  });

  test('a paraphrase sharing most phrasing scores above the 0.6 dedupe threshold', () => {
    const b = 'never widen shared method signatures for one caller add a guard at the call site';
    expect(shingleContainment(b, a)).toBeGreaterThan(0.6);
  });

  test('short texts fall back to word overlap rather than crashing', () => {
    expect(shingleContainment('guard call site', 'guard call site')).toBe(1);
  });
});

describe('classify', () => {
  test('episodic phrasing unlocks evidence', () => {
    const c = classify('what did we try last time on the sca-deps queue?');
    expect(c.kind).toBe('episodic');
    expect(c.includeEvidence).toBe(true);
  });

  test('decision phrasing', () => {
    expect(classify('should we adopt qmd or write our own FTS?').kind).toBe('decision');
  });

  test('trail phrasing includes evidence', () => {
    const c = classify('how did I arrive at the belief that indexes must be rebuildable?');
    expect(c.kind).toBe('trail');
    expect(c.includeEvidence).toBe(true);
  });

  test('plain implementation tasks are factual and exclude evidence', () => {
    const c = classify('extend the retry logic in scan-orchestrator');
    expect(c.kind).toBe('factual');
    expect(c.includeEvidence).toBe(false);
  });

  test('each kind carries a default budget, capped at 5000', () => {
    expect(classify('extend the retry logic').defaultBudget).toBe(1200);
    expect(classify('should we migrate?').defaultBudget).toBe(2500);
    for (const q of ['a', 'should we', 'what happened last session']) {
      expect(classify(q).defaultBudget).toBeLessThanOrEqual(5000);
    }
  });
});
