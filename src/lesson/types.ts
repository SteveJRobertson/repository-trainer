// The lesson format from docs/poc-spec.md. The player only knows this
// shape, so hand-written and generated lessons are interchangeable.

export type RepoPin = {owner: string; name: string; commit: string};

// Points at real lines in the pinned commit. `excerpt` is the exact text of
// those lines, which lets the validator prove the reference is real.
export type CodeRef = {
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  note?: string;
};

export type Evidence = 'verified' | 'inferred';

export type Claim = {
  text: string;
  evidence: Evidence;
  refs: CodeRef[];
};

export type Option = {
  id: string;
  label: string;
  correct: boolean;
  feedback: string;
  ref?: CodeRef;
};

export type ChoiceActivity = {kind: 'choice'; prompt: string; options: Option[]};
export type PredictActivity = {kind: 'predict'; prompt: string; options: Option[]; reveal: CodeRef};
export type LocateActivity = {kind: 'locate'; prompt: string; answer: CodeRef; tolerance: number; hint?: string};
export type OrderActivity = {
  kind: 'order';
  prompt: string;
  items: {id: string; label: string; ref?: CodeRef}[];
  correct: string[];
  feedback: string;
};

export type Activity = ChoiceActivity | PredictActivity | LocateActivity | OrderActivity;

export type Step = {
  id: string;
  title: string;
  explanation: string;
  code?: CodeRef[];
  activity?: Activity;
  claims?: Claim[];
};

export type Diagram = {
  nodes: {id: string; label: string; ref: CodeRef}[];
  edges: {from: string; to: string; label?: string; evidence: Evidence}[];
};

export type Lesson = {
  id: string;
  title: string;
  repo: RepoPin;
  feature: string;
  estimatedMinutes: number;
  diagram: Diagram;
  steps: Step[];
};

// Produced by the analysis stage (step 3) for the learner to choose from.
export type FeatureSuggestion = {
  id: string;
  title: string;
  why: string;
  entryPoints: CodeRef[];
  relatedIssues?: {number: number; title: string}[];
};
