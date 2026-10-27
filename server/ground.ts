// Turns the model's draft into a real lesson. Every reference is checked
// against the snapshot: the file must exist and the anchor quote must appear
// in the cited lines. Excerpts are always copied from the file, never from
// the model, so a lesson can only show code that really exists.
import type {Activity, Claim, CodeRef, Lesson, RepoPin, Step} from '../src/lesson/types';
import {checkStructure, type ValidationIssue} from '../src/lesson/validate';
import type {DraftLesson, DraftRef} from './schemas';

type Files = Map<string, string>;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// Returns the checked ref, or a reason it was rejected. When the anchor is
// in the file exactly once but outside the cited range, the range is moved
// onto it: models often cite lines that are off by a few.
export function resolveRef(draft: DraftRef, files: Files): {ref: CodeRef; moved: boolean} | {problem: string} {
  const text = files.get(draft.path);
  if (text === undefined) {
    return {problem: `file "${draft.path}" was not in the provided files`};
  }

  const lines = text.split('\n');
  const anchor = squash(draft.anchor);
  if (anchor.length < 3) {
    return {problem: 'anchor is too short to check'};
  }

  const span = Math.max(0, draft.endLine - draft.startLine);
  const make = (start: number, end: number): CodeRef => ({
    path: draft.path,
    startLine: start,
    endLine: end,
    excerpt: lines.slice(start - 1, end).join('\n'),
    ...(draft.note ? {note: draft.note} : {}),
  });

  const inRange = draft.startLine >= 1 && draft.endLine >= draft.startLine && draft.endLine <= lines.length;
  if (inRange && squash(lines.slice(draft.startLine - 1, draft.endLine).join('\n')).includes(anchor)) {
    return {ref: make(draft.startLine, draft.endLine), moved: false};
  }

  const hits = lines.flatMap((line, i) => (squash(line).includes(anchor) ? [i + 1] : []));
  if (hits.length === 1) {
    const start = Math.max(1, Math.min(hits[0], lines.length - span));
    return {ref: make(start, Math.min(lines.length, start + span)), moved: true};
  }

  return {problem: hits.length === 0 ? `anchor "${draft.anchor}" is not in ${draft.path}` : `anchor "${draft.anchor}" is ambiguous in ${draft.path} and the lines don't contain it`};
}

export type GroundResult = {lesson: Lesson; issues: ValidationIssue[]; moved: number};

// With `prune`, anything whose reference fails is dropped instead of reported,
// so a nearly-right lesson can still be used. Dropped items become warnings.
export function groundLesson(draft: DraftLesson, repo: RepoPin, files: Files, options: {prune: boolean}): GroundResult & {dropped: string[]} {
  const issues: ValidationIssue[] = [];
  const dropped: string[] = [];
  let moved = 0;

  const ref = (value: DraftRef, where: string): CodeRef | undefined => {
    const result = resolveRef(value, files);
    if ('problem' in result) {
      if (options.prune) {
        dropped.push(`${where}: ${result.problem}`);
      } else {
        issues.push({where, message: result.problem});
      }

      return undefined;
    }

    moved += Number(result.moved);
    return result.ref;
  };

  const nodes = draft.diagram.nodes.flatMap(node => {
    const r = ref(node.ref, `diagram node "${node.id}"`);
    return r ? [{id: node.id, label: node.label, ref: r}] : [];
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = draft.diagram.edges.filter(edge => !options.prune || (nodeIds.has(edge.from) && nodeIds.has(edge.to)));

  const steps: Step[] = draft.steps.map(step => {
    const at = `step "${step.id}"`;
    const code = step.code?.flatMap((value, i) => {
      const r = ref(value, `${at} code[${i}]`);
      return r ? [r] : [];
    });

    const claims = step.claims?.flatMap((claim, i): Claim[] => {
      const refs = claim.refs.flatMap((value, j) => {
        const r = ref(value, `${at} claim[${i}] ref[${j}]`);
        return r ? [r] : [];
      });
      // A verified claim that lost its evidence is no longer verified.
      if (claim.evidence === 'verified' && refs.length === 0 && options.prune) {
        dropped.push(`${at} claim[${i}]: no checkable evidence left`);
        return [];
      }

      return [{text: claim.text, evidence: claim.evidence, refs}];
    });

    const activity = groundActivity(step.activity, at, ref, options.prune, dropped);
    return {
      id: step.id,
      title: step.title,
      explanation: step.explanation,
      ...(code && code.length > 0 ? {code} : {}),
      ...(activity ? {activity} : {}),
      ...(claims && claims.length > 0 ? {claims} : {}),
    };
  });

  const lesson: Lesson = {
    id: `${repo.owner}-${repo.name}-${slug(draft.title)}`,
    title: draft.title,
    repo,
    feature: draft.feature,
    estimatedMinutes: draft.estimatedMinutes,
    diagram: {nodes, edges},
    steps,
  };

  issues.push(...checkStructure(lesson));
  if (lesson.steps.length === 0) {
    issues.push({where: 'lesson', message: 'has no steps'});
  }

  return {lesson, issues, moved, dropped};
}

function groundActivity(
  activity: DraftLesson['steps'][number]['activity'],
  at: string,
  ref: (value: DraftRef, where: string) => CodeRef | undefined,
  prune: boolean,
  dropped: string[],
): Activity | undefined {
  if (!activity) {
    return undefined;
  }

  const options = () => 'options' in activity
    ? activity.options.map(option => {
      const r = option.ref && ref(option.ref, `${at} option "${option.id}"`);
      return {id: option.id, label: option.label, correct: option.correct, feedback: option.feedback, ...(r ? {ref: r} : {})};
    })
    : [];

  switch (activity.kind) {
    case 'choice': {
      return {kind: 'choice', prompt: activity.prompt, options: options()};
    }

    case 'predict': {
      const reveal = ref(activity.reveal, `${at} reveal`);
      if (!reveal) {
        // Without the code that settles it, a prediction is still a fair question.
        return prune ? {kind: 'choice', prompt: activity.prompt, options: options()} : undefined;
      }

      return {kind: 'predict', prompt: activity.prompt, options: options(), reveal};
    }

    case 'locate': {
      const answer = ref(activity.answer, `${at} locate answer`);
      if (!answer) {
        if (prune) {
          dropped.push(`${at}: locate activity removed`);
        }

        return undefined;
      }

      return {kind: 'locate', prompt: activity.prompt, answer, tolerance: Math.max(0, Math.min(activity.tolerance, 3)), ...(activity.hint ? {hint: activity.hint} : {})};
    }

    case 'order': {
      const items = activity.items.map(item => {
        const r = item.ref && ref(item.ref, `${at} order item "${item.id}"`);
        return {id: item.id, label: item.label, ...(r ? {ref: r} : {})};
      });
      return {kind: 'order', prompt: activity.prompt, items, correct: activity.correct, feedback: activity.feedback};
    }
  }
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}
