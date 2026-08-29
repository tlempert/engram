export const NOTE_TYPES = ['insight', 'fact', 'decision', 'preference', 'question', 'synthesis'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const STATUSES = ['active', 'disputed', 'superseded'] as const;
export type Status = (typeof STATUSES)[number];

export const ORIGINS = ['user-articulated', 'collaborative', 'agent-inferred'] as const;
export type Origin = (typeof ORIGINS)[number];

export const RELATIONS = [
  'supports',
  'contradicts',
  'tension',
  'refines',
  'alternative-to',
  'exemplifies',
  'derived-from',
  'supersedes',
  'relates',
] as const;
export type Relation = (typeof RELATIONS)[number];

/** Relations whose links must carry a human-readable reason. */
export const REASON_REQUIRED: readonly Relation[] = ['supports', 'contradicts', 'tension', 'derived-from'];

export const ZONES = ['zettel', 'maps', 'inbox', 'evidence', 'archive'] as const;
export type Zone = (typeof ZONES)[number];

export interface TypedLink {
  relation: Relation;
  target: string;
  reason?: string;
}

export interface ParsedNote {
  /** Vault-relative path, e.g. "zettel/Some Title.md" */
  path: string;
  zone: Zone;
  title: string;
  id?: string;
  type?: string;
  status: Status;
  scope: string;
  author?: string;
  origin?: string;
  created?: string;
  expires?: string;
  sourceTrust?: string;
  confidence?: string;
  sources: string[];
  tags: string[];
  supersedes: string[];
  supersededBy: string[];
  /** Body with frontmatter stripped, links section included. */
  body: string;
  /** Body minus the "## Links" section and the leading H1 — what retrieval renders. */
  claim: string;
  links: TypedLink[];
  /** Parse-level problems for `engram doctor` (unknown relation, missing reason, bad yaml…). */
  problems: string[];
  /** Estimated tokens of the rendered claim. */
  tokens: number;
}

export interface QueryRequest {
  task: string;
  agent?: string;
  project?: string;
  tokenBudget?: number;
  format?: 'markdown' | 'json';
  includeHistory?: boolean;
}

export interface BundleItem {
  id: string;
  path: string;
  title: string;
  type: string;
  origin: string;
  status: Status;
  scope: string;
  content: string;
  why: string;
  tokenCost: number;
  score: number;
}

export interface Bundle {
  items: BundleItem[];
  insufficiencies: string[];
  omitted: string[];
  budget: { requested: number; used: number };
  taskKind: string;
}
