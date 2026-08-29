const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one',
  'our', 'out', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two',
  'way', 'who', 'did', 'get', 'use', 'that', 'this', 'with', 'from', 'they', 'been', 'have',
  'were', 'what', 'when', 'where', 'which', 'while', 'will', 'would', 'could', 'should',
  'about', 'into', 'over', 'after', 'before', 'between', 'through', 'during', 'without',
  'again', 'further', 'then', 'once', 'here', 'there', 'why', 'how', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'does', 'doing', 'their', 'them', 'these', 'those', 'your', 'yours',
  'want', 'need', 'please', 'let', 'lets', 'make', 'makes',
]);

/** Lowercased, deduplicated, stopword-free words of length ≥ 3 — the query's content terms. */
export function contentWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function shingles(text: string, n: number): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Fraction of the candidate's word 3-gram shingles already present in the picked text.
 * (4-grams proved brittle: one inserted word kills four shingles, letting near-copies
 * through the 0.6 threshold.) Texts too short for 3-grams fall back to word overlap.
 */
export function shingleContainment(candidate: string, picked: string): number {
  let a = shingles(candidate, 3);
  let b = shingles(picked, 3);
  if (a.size === 0 || b.size === 0) {
    a = shingles(candidate, 1);
    b = shingles(picked, 1);
    if (a.size === 0) return 0;
  }
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}
