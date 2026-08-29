import type { Bundle, BundleItem } from './types';

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision',
  preference: 'Preference',
  fact: 'Fact',
  insight: 'Insight',
  synthesis: 'Synthesis',
  question: 'Open question',
  session: 'Episode',
};

const ORIGIN_SHORT: Record<string, string> = {
  'user-articulated': 'user',
  collaborative: 'collab',
  'agent-inferred': 'agent',
};

function renderItem(item: BundleItem): string {
  const label = TYPE_LABELS[item.type] ?? item.type;
  const origin = ORIGIN_SHORT[item.origin] ?? item.origin;
  const meta = [item.id, origin, item.status, ...(item.scope !== 'global' ? [item.scope] : [])].join(' · ');
  return `**${label} · ${item.title}** [${meta}]\n${item.content}\n↳ why: ${item.why}`;
}

export function renderBundle(bundle: Bundle, format: 'markdown' | 'json' = 'markdown'): string {
  if (format === 'json') return JSON.stringify(bundle, null, 2);

  if (bundle.items.length === 0) {
    const lines = [
      '## Memory (engram · no memory returned)',
      ...bundle.insufficiencies.map((s) => `insufficient: ${s}`),
    ];
    return lines.join('\n');
  }

  const lines = [
    `## Memory (engram · ${bundle.budget.used}/${bundle.budget.requested} tokens · ${bundle.items.length} item${bundle.items.length === 1 ? '' : 's'})`,
    '',
    ...bundle.items.map(renderItem).join('\n\n').split('\n'),
    '',
  ];
  if (bundle.omitted.length > 0) lines.push(`omitted: ${bundle.omitted.join('; ')}`);
  lines.push('_When a memory item shapes your output, cite the memory ids you use (e.g. [mem:d1])._');
  return lines.join('\n');
}
