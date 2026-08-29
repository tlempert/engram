import { Database } from 'bun:sqlite';
import type { ParsedNote, Status, TypedLink, Zone } from './types';

export interface FtsHit {
  path: string;
  /** Higher is better (normalized from bm25). */
  score: number;
}

const SCHEMA = `
CREATE TABLE notes (
  path TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  title TEXT NOT NULL,
  id TEXT,
  type TEXT,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  origin TEXT,
  author TEXT,
  created TEXT,
  expires TEXT,
  source_trust TEXT,
  confidence TEXT,
  tokens INTEGER NOT NULL,
  claim TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  sources TEXT NOT NULL,
  supersedes TEXT NOT NULL,
  superseded_by TEXT NOT NULL,
  problems TEXT NOT NULL
);
CREATE TABLE links (
  from_path TEXT NOT NULL,
  relation TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX links_from ON links(from_path);
CREATE INDEX notes_title ON notes(title);
CREATE VIRTUAL TABLE fts USING fts5(
  title, tags, claim, path UNINDEXED, zone UNINDEXED,
  tokenize = 'unicode61'
);
`;

export function buildIndex(notes: ParsedNote[], file?: string): Database {
  const db = new Database(file ?? ':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const insertNote = db.prepare(`
    INSERT INTO notes (path, zone, title, id, type, status, scope, origin, author, created,
                       expires, source_trust, confidence, tokens, claim, body, tags, sources,
                       supersedes, superseded_by, problems)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLink = db.prepare('INSERT INTO links (from_path, relation, target, reason) VALUES (?, ?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO fts (title, tags, claim, path, zone) VALUES (?, ?, ?, ?, ?)');

  const tx = db.transaction((all: ParsedNote[]) => {
    for (const n of all) {
      insertNote.run(
        n.path, n.zone, n.title, n.id ?? null, n.type ?? null, n.status, n.scope,
        n.origin ?? null, n.author ?? null, n.created ?? null, n.expires ?? null,
        n.sourceTrust ?? null, n.confidence ?? null, n.tokens, n.claim, n.body,
        JSON.stringify(n.tags), JSON.stringify(n.sources), JSON.stringify(n.supersedes),
        JSON.stringify(n.supersededBy), JSON.stringify(n.problems),
      );
      for (const l of n.links) insertLink.run(n.path, l.relation, l.target, l.reason ?? null);
      insertFts.run(n.title, n.tags.join(' '), n.claim, n.path, n.zone);
    }
  });
  tx(notes);
  return db;
}

interface NoteRow {
  path: string; zone: string; title: string; id: string | null; type: string | null;
  status: string; scope: string; origin: string | null; author: string | null;
  created: string | null; expires: string | null; source_trust: string | null;
  confidence: string | null; tokens: number; claim: string; body: string;
  tags: string; sources: string; supersedes: string; superseded_by: string; problems: string;
}

function rowToNote(row: NoteRow, links: TypedLink[]): ParsedNote {
  return {
    path: row.path,
    zone: row.zone as Zone,
    title: row.title,
    id: row.id ?? undefined,
    type: row.type ?? undefined,
    status: row.status as Status,
    scope: row.scope,
    origin: row.origin ?? undefined,
    author: row.author ?? undefined,
    created: row.created ?? undefined,
    expires: row.expires ?? undefined,
    sourceTrust: row.source_trust ?? undefined,
    confidence: row.confidence ?? undefined,
    tokens: row.tokens,
    claim: row.claim,
    body: row.body,
    tags: JSON.parse(row.tags),
    sources: JSON.parse(row.sources),
    supersedes: JSON.parse(row.supersedes),
    supersededBy: JSON.parse(row.superseded_by),
    problems: JSON.parse(row.problems),
    links,
  };
}

function linksFor(db: Database, path: string): TypedLink[] {
  const rows = db
    .prepare('SELECT relation, target, reason FROM links WHERE from_path = ?')
    .all(path) as { relation: string; target: string; reason: string | null }[];
  return rows.map((r) => ({ relation: r.relation as TypedLink['relation'], target: r.target, reason: r.reason ?? undefined }));
}

export function getNote(db: Database, path: string): ParsedNote | undefined {
  const row = db.prepare('SELECT * FROM notes WHERE path = ?').get(path) as NoteRow | null;
  return row ? rowToNote(row, linksFor(db, row.path)) : undefined;
}

export function getNoteByTitle(db: Database, title: string): ParsedNote | undefined {
  const row = db.prepare('SELECT * FROM notes WHERE title = ? LIMIT 1').get(title) as NoteRow | null;
  return row ? rowToNote(row, linksFor(db, row.path)) : undefined;
}

export function listNotes(db: Database, zone?: Zone): ParsedNote[] {
  const rows = (
    zone
      ? db.prepare('SELECT * FROM notes WHERE zone = ? ORDER BY path').all(zone)
      : db.prepare('SELECT * FROM notes ORDER BY path').all()
  ) as NoteRow[];
  return rows.map((r) => rowToNote(r, linksFor(db, r.path)));
}

/** Escape a term for FTS5 MATCH: double internal quotes, wrap in quotes. */
function ftsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

export function searchFts(db: Database, terms: string[], zones: Zone[], limit: number): FtsHit[] {
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0 || zones.length === 0) return [];
  const match = clean.map(ftsTerm).join(' OR ');
  const zonePlaceholders = zones.map(() => '?').join(', ');
  // bm25 weights: title 4×, tags 2×, claim 1×. bm25 returns lower-is-better; negate.
  const rows = db
    .prepare(
      `SELECT path, bm25(fts, 4.0, 2.0, 1.0) AS rank
       FROM fts WHERE fts MATCH ? AND zone IN (${zonePlaceholders})
       ORDER BY rank LIMIT ?`,
    )
    .all(match, ...zones, limit) as { path: string; rank: number }[];
  return rows.map((r) => ({ path: r.path, score: -r.rank }));
}
