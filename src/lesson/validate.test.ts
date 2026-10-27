import {describe, expect, it} from 'vitest';
import kyLesson from '../lessons/ky-request-failure.json';
import type {Lesson} from './types';
import {checkRefs, checkStructure} from './validate';

const file = ['line one', 'line two', 'line three'].join('\n');
const loadFile = async (path: string) => (path === 'a.ts' ? file : undefined);

function lessonWith(step: Lesson['steps'][number]): Lesson {
  return {
    id: 't',
    title: 't',
    repo: {owner: 'o', name: 'n', commit: 'c'},
    feature: 'f',
    estimatedMinutes: 1,
    diagram: {nodes: [], edges: []},
    steps: [step],
  };
}

describe('checkRefs', () => {
  it('accepts an exact excerpt', async () => {
    const lesson = lessonWith({id: 's', title: 's', explanation: '', code: [{path: 'a.ts', startLine: 2, endLine: 3, excerpt: 'line two\nline three'}]});
    expect(await checkRefs(lesson, loadFile)).toEqual([]);
  });

  it('rejects a missing file, an out-of-range line and a changed excerpt', async () => {
    const lesson = lessonWith({
      id: 's',
      title: 's',
      explanation: '',
      code: [
        {path: 'missing.ts', startLine: 1, endLine: 1, excerpt: ''},
        {path: 'a.ts', startLine: 3, endLine: 9, excerpt: ''},
        {path: 'a.ts', startLine: 1, endLine: 1, excerpt: 'line 1'},
      ],
    });
    const messages = (await checkRefs(lesson, loadFile)).map(issue => issue.message);
    expect(messages).toEqual([
      'file not found at pinned commit',
      'range ends past the file (3 lines)',
      'excerpt does not match the file',
    ]);
  });
});

describe('checkStructure', () => {
  it('requires exactly one correct option and refs on verified claims', () => {
    const lesson = lessonWith({
      id: 's',
      title: 's',
      explanation: '',
      claims: [{text: 'x', evidence: 'verified', refs: []}],
      activity: {kind: 'choice', prompt: 'p', options: [
        {id: 'a', label: 'a', correct: true, feedback: ''},
        {id: 'b', label: 'b', correct: true, feedback: ''},
      ]},
    });
    expect(checkStructure(lesson).map(issue => issue.message)).toEqual([
      'verified claim has no code references',
      'expected exactly one correct option, found 2',
    ]);
  });

  it('passes the bundled ky lesson', () => {
    expect(checkStructure(kyLesson as Lesson)).toEqual([]);
  });
});
