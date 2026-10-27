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

Out, for now:

- The "how to install and use the app" journey.
- Running repository code, in any form.
- Private repositories, accounts, persistence beyond `localStorage`.
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
  steps: Step[];                 // 4 to 8 steps
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

## Open questions

- Should the learner pick the feature, or should the app suggest a few from the repo's structure and open issues?
- Is a static flow diagram per lesson worth it in the PoC, or later?
- Which repo from Steve's job to use as the second test in step 4?
