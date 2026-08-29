export type TaskKind = 'factual' | 'decision' | 'episodic' | 'trail' | 'people';

export interface Classification {
  kind: TaskKind;
  includeEvidence: boolean;
  defaultBudget: number;
}

const BUDGETS: Record<TaskKind, number> = {
  factual: 1200,
  decision: 2500,
  episodic: 1200,
  trail: 2500,
  people: 800,
};

const EPISODIC_RE = /\b(last time|last session|previous(ly)?|what happened|have we (tried|done)|did we try|what did (we|i) (try|do)|earlier session)\b/i;
const TRAIL_RE = /\b(how did i (arrive|come|get|end up)|why do i (believe|think|hold)|trail|thought process|how did (my|the) (thinking|belief)|where did .* come from)\b/i;
const DECISION_RE = /\b(should (we|i)|decide|decision|choose|choice|adopt|migrate|switch to|current call|pick between|worth (doing|it)|pros and cons|tradeoffs?)\b/i;
const PEOPLE_RE = /\b(relationship|communicate with|talk to|feedback for|one[- ]on[- ]one|1:1|stakeholder|conversation with)\b/i;

/** Deterministic task classification — selects evidence eligibility and default budget. */
export function classify(task: string): Classification {
  let kind: TaskKind = 'factual';
  if (TRAIL_RE.test(task)) kind = 'trail';
  else if (EPISODIC_RE.test(task)) kind = 'episodic';
  else if (PEOPLE_RE.test(task)) kind = 'people';
  else if (DECISION_RE.test(task)) kind = 'decision';

  return {
    kind,
    includeEvidence: kind === 'episodic' || kind === 'trail',
    defaultBudget: BUDGETS[kind],
  };
}
