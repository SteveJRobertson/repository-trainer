import type {CodeRef, Lesson} from './types';

export type LoadFile = (path: string) => Promise<string | undefined>;

export type ValidationIssue = {where: string; message: string};

// Collects every CodeRef in a lesson with a label saying where it came from,
// so a failure can be traced back to the step or option that made it.
export function collectRefs(lesson: Lesson): {where: string; ref: CodeRef}[] {
  const refs: {where: string; ref: CodeRef}[] = [];
  for (const node of lesson.diagram.nodes) {
    refs.push({where: `diagram node "${node.id}"`, ref: node.ref});
  }

  for (const step of lesson.steps) {
    const at = `step "${step.id}"`;
    step.code?.forEach((ref, i) => refs.push({where: `${at} code[${i}]`, ref}));
    step.claims?.forEach((claim, i) => claim.refs.forEach((ref, j) => refs.push({where: `${at} claim[${i}] ref[${j}]`, ref})));

    const activity = step.activity;
    if (!activity) {
      continue;
    }

    switch (activity.kind) {
      case 'choice':
      case 'predict': {
        for (const option of activity.options) {
          if (option.ref) {
            refs.push({where: `${at} option "${option.id}"`, ref: option.ref});
          }
        }

        if (activity.kind === 'predict') {
          refs.push({where: `${at} reveal`, ref: activity.reveal});
        }

        break;
      }

      case 'locate': {
        refs.push({where: `${at} locate answer`, ref: activity.answer});
        break;
      }

      case 'order': {
        for (const item of activity.items) {
          if (item.ref) {
            refs.push({where: `${at} order item "${item.id}"`, ref: item.ref});
          }
        }

        break;
      }
    }
  }

  return refs;
}

// Checks the lesson's own consistency: things that are wrong whatever the
// repository contains.
export function checkStructure(lesson: Lesson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(lesson.diagram.nodes.map(node => node.id));

  for (const edge of lesson.diagram.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!nodeIds.has(end)) {
        issues.push({where: `diagram edge ${edge.from} -> ${edge.to}`, message: `unknown node "${end}"`});
      }
    }
  }

  const stepIds = new Set<string>();
  for (const step of lesson.steps) {
    const where = `step "${step.id}"`;
    if (stepIds.has(step.id)) {
      issues.push({where, message: 'duplicate step id'});
    }

    stepIds.add(step.id);

    step.claims?.forEach((claim, i) => {
      if (claim.evidence === 'verified' && claim.refs.length === 0) {
        issues.push({where: `${where} claim[${i}]`, message: 'verified claim has no code references'});
      }
    });

    const activity = step.activity;
    if (activity?.kind === 'choice' || activity?.kind === 'predict') {
      const correct = activity.options.filter(option => option.correct).length;
      if (correct !== 1) {
        issues.push({where, message: `expected exactly one correct option, found ${correct}`});
      }
    }

    if (activity?.kind === 'order') {
      const itemIds = activity.items.map(item => item.id).sort();
      const correctIds = [...activity.correct].sort();
      if (itemIds.join('\n') !== correctIds.join('\n')) {
        issues.push({where, message: 'order.correct must list every item id exactly once'});
      }
    }
  }

  return issues;
}

// Checks every CodeRef against the pinned repository: the file exists, the
// line range is inside it, and the excerpt matches those lines exactly.
export async function checkRefs(lesson: Lesson, loadFile: LoadFile): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const cache = new Map<string, Promise<string | undefined>>();
  const load = (path: string) => {
    if (!cache.has(path)) {
      cache.set(path, loadFile(path));
    }

    return cache.get(path)!;
  };

  for (const {where, ref} of collectRefs(lesson)) {
    const label = `${where} (${ref.path}:${ref.startLine}-${ref.endLine})`;
    if (ref.startLine < 1 || ref.endLine < ref.startLine) {
      issues.push({where: label, message: 'invalid line range'});
      continue;
    }

    const content = await load(ref.path);
    if (content === undefined) {
      issues.push({where: label, message: 'file not found at pinned commit'});
      continue;
    }

    const lines = content.split('\n');
    if (ref.endLine > lines.length) {
      issues.push({where: label, message: `range ends past the file (${lines.length} lines)`});
      continue;
    }

    const actual = lines.slice(ref.startLine - 1, ref.endLine).join('\n');
    if (actual !== ref.excerpt) {
      issues.push({where: label, message: 'excerpt does not match the file'});
    }
  }

  return issues;
}

export async function validateLesson(lesson: Lesson, loadFile: LoadFile): Promise<ValidationIssue[]> {
  return [...checkStructure(lesson), ...await checkRefs(lesson, loadFile)];
}

export function rawFileUrl(repo: Lesson['repo'], path: string): string {
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.commit}/${path}`;
}
