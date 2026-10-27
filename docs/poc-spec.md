# Repository Trainer: proof-of-concept spec

## Goal

Find out whether a short, interactive, source-linked lesson helps a developer understand how one feature works across several files of a real repository, well enough to start changing it.

The PoC succeeds if, after a ~10 minute lesson, the learner can open the files involved, say what each one does in the feature, and name where they would make a given small change and how they would check it.

## Scope

In:

- One public TypeScript repository, pinned to a single commit (first target: [`sindresorhus/ky`](https://github.com/sindresorhus/ky) at `3541888`).
- The contribution journey only: "how does feature X work, and where would I change it?"
- A React/TypeScript lesson player (Vite) that renders lessons from JSON.
- One hand-written lesson first (step 2), then AI-generated lessons (step 3).
- A validator that checks every code reference in a lesson against the pinned repository.
- Feature suggestions: after analysing the repo, the app proposes 3 to 5 features to learn (from structure, exports and open issues) and the learner picks one.
- A flow diagram per lesson showing how the files involved connect, with each node linked to code.

Out, for now:

- The "how to install and use the app" journey.
- Running repository code, in any form.
- Private repositories (so no work repos yet), accounts, persistence beyond `localStorage`.
- Languages other than TypeScript/JavaScript.

## Lesson format

A lesson is a single JSON document. The player only knows this format, so hand-written and generated lessons are interchangeable.

```ts
type Lesson = {
  id: string;
  title: string;                 // "What happens when a ky request fails?"
  repo: { owner: string; name: string; commit: string };
  feature: string;               // one sentence: what the learner will understand
  estimatedMinutes: number;
  diagram: Diagram;              // overview of the flow, shown beside the steps
  steps: Step[];                 // 4 to 8 steps
};

// Nodes are files or functions; edges are calls or data passed.
// Every node must link to code, so the diagram obeys the same grounding rules.
type Diagram = {
  nodes: { id: string; label: string; ref: CodeRef }[];
  edges: { from: string; to: string; label?: string; evidence: 'verified' | 'inferred' }[];
};

// Produced by the analysis stage (step 3) for the learner to choose from.
type FeatureSuggestion = {
  id: string;
  title: string;                 // "How failed requests are retried"
  why: string;                   // one sentence on why it is worth learning
  entryPoints: CodeRef[];        // where the lesson would start
  relatedIssues?: { number: number; title: string }[];
};

type Step = {
  id: string;
  title: string;
  explanation: string;           // at most ~3 sentences, Markdown
  code?: CodeRef[];              // shown in the viewer, first one focused
  activity?: Activity;
  claims?: Claim[];              // statements the step makes about the code
};

// Points at real lines in the pinned commit. The validator checks
// the file exists, the range is in bounds, and `excerpt` matches.
type CodeRef = {
  path: string;                  // "source/core/Ky.ts"
  startLine: number;
  endLine: number;
  excerpt: string;               // exact text of those lines
  note?: string;
};

type Claim = {
  text: string;
  evidence: 'verified' | 'inferred';
  refs: CodeRef[];               // required when evidence is 'verified'
};

type Activity =
  | { kind: 'choice'; prompt: string; options: Option[]; }            // "Which file next?", "What does this return?"
  | { kind: 'predict'; prompt: string; options: Option[]; reveal: CodeRef }  // predict, then see the code that decides it
  | { kind: 'locate'; prompt: string; answer: CodeRef; tolerance: number }   // click the line(s) where X happens
  | { kind: 'order'; prompt: string; items: { id: string; label: string; ref?: CodeRef }[]; correct: string[] }; // trace a flow

type Option = { id: string; label: string; correct: boolean; feedback: string; ref?: CodeRef };
```

Every option carries its own feedback, so a wrong answer explains itself and links to the code that shows why.

## Grounding rules

1. Every `CodeRef` must match the pinned commit exactly, or the lesson is rejected.
2. Any claim about behaviour is either `verified` (with refs) or `inferred` (shown with a visible "inferred" badge).
3. Explanations stay short. If a step needs more than three sentences, split it.
4. Repository content is untrusted input. It is rendered as text, never as HTML, and never executed.

## Example lesson outline (ky)

"What happens when a request fails?", roughly 6 steps:

1. Entry point: `ky.get()` in `source/index.ts` creates a `Ky` instance.
2. The run loop: `#run()` in `source/core/Ky.ts`. Predict: does a 500 response throw straight away?
3. Where `HTTPError` is built, and what it carries (`source/errors/HTTPError.ts`).
4. Retry: locate the line that decides whether to retry (`source/core/Ky.ts`, `source/core/retry-timing.ts`).
5. Hooks: order `beforeRequest`, fetch, `afterResponse`, `beforeRetry`, `beforeError`.
6. Change it: "Where would you add a new retry condition, and which test file proves it?" (`test/`).

## Success criteria

- The hand-written lesson can be completed end to end in the player.
- Every code reference in it passes the validator.
- Generated lessons pass the validator at least most of the time, and failures are reported clearly.
- Steve can use a lesson on an unfamiliar repo and say whether it helped more than asking a chatbot.

## Decisions

- The app suggests features to learn; the learner picks one (2026-10-27).
- Each lesson includes a flow diagram (2026-10-27).
- The step 4 trial uses a second public repo, since Steve's work repos are private (2026-10-27).
- Hands-on "add a feature" practice (an in-browser code-editing activity and a build-a-feature lesson) comes after generation, as its own step (2026-10-27).
- Generation (step 3): the model cites code as a line range plus a short quote, and the server copies excerpts from the file itself. References that fail are sent back once for repair, then removed and listed as warnings (2026-10-27).
