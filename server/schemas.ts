// What the model is asked to produce. These mirror the lesson format, with
// one difference: the model never writes excerpts. It cites line ranges plus
// a short anchor quote, and the server checks the anchor really sits in that
// range before copying the excerpt from the file itself.
import {z} from 'zod';

export const DraftRef = z.object({
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  anchor: z.string().describe('A short exact quote (5-60 chars) copied from within these lines, used to check the line numbers.'),
  note: z.string().optional(),
});

const Option = z.object({
  id: z.string(),
  label: z.string(),
  correct: z.boolean(),
  feedback: z.string().describe('1-2 sentences explaining why this option is right or wrong, grounded in the code.'),
  ref: DraftRef.optional(),
});

const Activity = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('choice'), prompt: z.string(), options: z.array(Option)}),
  z.object({kind: z.literal('predict'), prompt: z.string(), options: z.array(Option), reveal: DraftRef}),
  z.object({kind: z.literal('locate'), prompt: z.string(), answer: DraftRef, tolerance: z.number().int(), hint: z.string().optional()}),
  z.object({
    kind: z.literal('order'),
    prompt: z.string(),
    items: z.array(z.object({id: z.string(), label: z.string(), ref: DraftRef.optional()})),
    correct: z.array(z.string()),
    feedback: z.string(),
  }),
]);

const Claim = z.object({
  text: z.string(),
  evidence: z.enum(['verified', 'inferred']),
  refs: z.array(DraftRef),
});

export const DraftLesson = z.object({
  title: z.string(),
  feature: z.string(),
  estimatedMinutes: z.number().int(),
  diagram: z.object({
    nodes: z.array(z.object({id: z.string(), label: z.string(), ref: DraftRef})),
    edges: z.array(z.object({from: z.string(), to: z.string(), label: z.string().optional(), evidence: z.enum(['verified', 'inferred'])})),
  }),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    explanation: z.string(),
    code: z.array(DraftRef).optional(),
    activity: Activity.optional(),
    claims: z.array(Claim).optional(),
  })),
});

export const DraftSuggestions = z.object({
  summary: z.string().describe('Two sentences on what the project is and how it is organised.'),
  suggestions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    why: z.string(),
    entryPoints: z.array(z.object({path: z.string(), symbol: z.string()})),
    relatedIssues: z.array(z.number().int()).optional(),
  })),
});

export type DraftRef = z.infer<typeof DraftRef>;
export type DraftLesson = z.infer<typeof DraftLesson>;
export type DraftSuggestions = z.infer<typeof DraftSuggestions>;
