import { parse as parseYaml } from 'yaml';
import { REASON_REQUIRED, RELATIONS, ZONES } from './types';
import type { ParsedNote, Relation, Status, TypedLink, Zone } from './types';

/** ~4 chars per token — deterministic, dependency-free, close enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LINK_LINE_RE = /^-\s+([a-z-]+)\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*(?:[—–-]{1,2}\s*(.*))?$/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;

function asStringArray(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x));
}

/** "[[Old decision]]" → "Old decision"; plain strings pass through. */
function unwrapWikilinks(values: string[]): string[] {
  return values.map((v) => {
    const m = WIKILINK_RE.exec(v);
    return m ? m[1]!.trim() : v.trim();
  });
}

function zoneOf(path: string): Zone {
  const head = path.split('/')[0] ?? '';
  return (ZONES as readonly string[]).includes(head) ? (head as Zone) : 'archive';
}

function parseLinks(body: string, problems: string[]): { links: TypedLink[]; linksStart: number } {
  const lines = body.split('\n');
  const links: TypedLink[] = [];
  let linksStart = -1;
  let inLinks = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+Links\s*$/i.test(line.trim()) || /^##\s+Proposed links\s*$/i.test(line.trim())) {
      inLinks = true;
      if (linksStart === -1) linksStart = i;
      continue;
    }
    if (inLinks && /^#{1,6}\s/.test(line)) inLinks = false; // next heading ends the section
    if (!inLinks) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith('-')) continue;
    const m = LINK_LINE_RE.exec(trimmed);
    if (!m) {
      problems.push(`unparseable link line: "${trimmed}"`);
      continue;
    }
    const [, relRaw, target, reasonRaw] = m;
    const relation = relRaw as Relation;
    if (!(RELATIONS as readonly string[]).includes(relation)) {
      problems.push(`unknown relation "${relRaw}" (allowed: ${RELATIONS.join(', ')})`);
      continue;
    }
    const reason = reasonRaw?.trim() || undefined;
    if (!reason && REASON_REQUIRED.includes(relation)) {
      problems.push(`link "${relation} [[${target!.trim()}]]" is missing its required reason`);
    }
    links.push({ relation, target: target!.trim(), reason });
  }
  return { links, linksStart };
}

/** Body minus frontmatter H1 and the Links section — what retrieval renders. */
function extractClaim(body: string, linksStart: number): string {
  let lines = body.split('\n');
  if (linksStart >= 0) {
    // Drop from the Links heading to the next heading (or EOF).
    const after = lines.slice(linksStart + 1);
    const nextHeading = after.findIndex((l) => /^#{1,6}\s/.test(l) && !/^##\s+Links/i.test(l));
    const tail = nextHeading >= 0 ? after.slice(nextHeading) : [];
    lines = [...lines.slice(0, linksStart), ...tail];
  }
  return lines
    .filter((l) => !/^#\s/.test(l)) // drop the H1 title line
    .join('\n')
    .trim();
}

export function parseNote(raw: string, path: string): ParsedNote {
  const problems: string[] = [];
  let fm: Record<string, unknown> = {};
  let body = raw;

  const fmMatch = FRONTMATTER_RE.exec(raw);
  if (fmMatch) {
    body = raw.slice(fmMatch[0].length);
    try {
      const parsed = parseYaml(fmMatch[1]!);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = parsed as Record<string, unknown>;
      }
    } catch (e) {
      problems.push(`frontmatter yaml error: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  const zone = zoneOf(path);
  const filename = path.split('/').pop() ?? path;
  const filenameTitle = filename.replace(/\.md$/i, '');
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  // Inbox candidates and session records carry their human title as the H1;
  // zettel/maps titles are the filename (Obsidian-native identity).
  const title = zone === 'inbox' || zone === 'evidence' ? (h1 ?? filenameTitle) : filenameTitle;

  const { links, linksStart } = parseLinks(body, problems);
  const claim = extractClaim(body, linksStart);

  const statusRaw = fm['status'] ? String(fm['status']) : 'active';
  const status: Status = ['active', 'disputed', 'superseded'].includes(statusRaw)
    ? (statusRaw as Status)
    : (problems.push(`unknown status "${statusRaw}"`), 'active');

  const type = fm['type'] != null ? String(fm['type']) : fm['proposed-type'] != null ? String(fm['proposed-type']) : undefined;

  return {
    path,
    zone,
    title,
    id: fm['id'] != null ? String(fm['id']) : undefined,
    type,
    status,
    scope: fm['scope'] != null ? String(fm['scope']) : 'global',
    author: fm['author'] != null ? String(fm['author']) : undefined,
    origin: fm['origin'] != null ? String(fm['origin']) : undefined,
    created: fm['created'] != null ? String(fm['created']) : undefined,
    expires: fm['expires'] != null ? String(fm['expires']) : undefined,
    sourceTrust: fm['source-trust'] != null ? String(fm['source-trust']) : undefined,
    confidence: fm['confidence'] != null ? String(fm['confidence']) : undefined,
    sources: asStringArray(fm['sources']),
    tags: asStringArray(fm['tags']),
    supersedes: unwrapWikilinks(asStringArray(fm['supersedes'])),
    supersededBy: unwrapWikilinks(asStringArray(fm['superseded-by'])),
    body,
    claim,
    links,
    problems,
    tokens: estimateTokens(claim),
  };
}
