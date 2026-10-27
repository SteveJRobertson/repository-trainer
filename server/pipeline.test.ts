import {describe, expect, it} from 'vitest';
import {buildIndex, findSymbol, indexFile, resolveImport} from './analyse';
import {fetchSnapshot, IngestError, parseRepoUrl, type Snapshot} from './github';
import {resolveRef} from './ground';
import type {AskModel} from './model';
import {generateLesson, selectFiles, suggestFeatures} from './pipeline';
import type {DraftLesson, DraftSuggestions} from './schemas';

const files = new Map<string, string>([
  ['package.json', JSON.stringify({main: './dist/index.js'})],
  ['src/index.ts', ['import {run} from \'./core/run.js\';', '', 'export function start(input: string) {', '  return run(input);', '}'].join('\n')],
  ['src/core/run.ts', ['import {retry} from \'../utils/retry\';', '', 'export async function run(input: string) {', '  const result = await retry(() => fetch(input));', '  return result;', '}'].join('\n')],
  ['src/utils/retry.ts', ['export const limit = 2;', '', 'export async function retry<T>(task: () => Promise<T>) {', '  for (let i = 0; i < limit; i++) {', '    try { return await task(); } catch {}', '  }', '  return task();', '}'].join('\n')],
  ['test/run.test.ts', ['import {run} from \'../src/core/run\';', 'test(\'runs\', () => run(\'x\'));'].join('\n')],
]);

const snapshot: Snapshot = {
  repo: {owner: 'o', name: 'r', commit: 'c'.repeat(40)},
  description: 'A tiny fixture',
  tree: [...files.keys()].map(path => ({path, size: files.get(path)!.length})),
  files,
  skipped: [],
  issues: [{number: 7, title: 'Make retry limit configurable', labels: ['good first issue']}],
};

describe('parseRepoUrl', () => {
  it('accepts owner/repo and github.com URLs', () => {
    expect(parseRepoUrl('sindresorhus/ky')).toEqual({owner: 'sindresorhus', name: 'ky'});
    expect(parseRepoUrl('https://github.com/sindresorhus/ky/tree/main/source')).toEqual({owner: 'sindresorhus', name: 'ky'});
    expect(parseRepoUrl('github.com/honojs/hono.git')).toEqual({owner: 'honojs', name: 'hono'});
  });

  it('rejects anything that is not a GitHub repository', () => {
    for (const input of ['https://evil.example/a/b', 'just-a-name', '../../etc/passwd', 'a/b/c d']) {
      expect(() => parseRepoUrl(input)).toThrow(IngestError);
    }
  });
});

describe('analyse', () => {
  it('resolves .js specifiers to .ts files and finds entry points from package.json', () => {
    const index = buildIndex(snapshot);
    expect(index.files.get('src/index.ts')!.imports).toEqual(['src/core/run.ts']);
    expect(index.files.get('src/core/run.ts')!.imports).toEqual(['src/utils/retry.ts']);
    expect(index.entryPoints).toContain('src/index.ts');
    expect(index.tests).toEqual(['test/run.test.ts']);
  });

  it('indexes exports with their lines', () => {
    expect(indexFile('src/utils/retry.ts', files.get('src/utils/retry.ts')!, new Set()).exports).toEqual([
      {name: 'limit', line: 1},
      {name: 'retry', line: 3},
    ]);
    expect(resolveImport('a/b.ts', './c', new Set(['a/c/index.tsx']))).toBe('a/c/index.tsx');
  });

  it('finds methods and private members as well as exports', () => {
    const text = ['class Ky {', '  async #run(): Promise<void> {', '  }', '  static create(input: string) {', '  }', '}'].join('\n');
    expect(findSymbol(text, '#run')).toBe(2);
    expect(findSymbol(text, 'create')).toBe(4);
    expect(findSymbol(text, 'Ky')).toBe(1);
    expect(findSymbol(text, 'missing')).toBeUndefined();
  });

  it('selects the import closure plus tests that import it', () => {
    const index = buildIndex(snapshot);
    const suggestion = {id: 's', title: 't', why: 'w', entryPoints: [{path: 'src/index.ts', startLine: 3, endLine: 3, excerpt: ''}]};
    expect(selectFiles(snapshot, index, suggestion)).toEqual(['src/index.ts', 'src/core/run.ts', 'test/run.test.ts', 'src/utils/retry.ts']);
  });
});

describe('resolveRef', () => {
  it('accepts a range containing the anchor and copies the excerpt from the file', () => {
    const result = resolveRef({path: 'src/utils/retry.ts', startLine: 4, endLine: 6, anchor: 'i < limit'}, files);
    expect(result).toEqual({ref: {path: 'src/utils/retry.ts', startLine: 4, endLine: 6, excerpt: files.get('src/utils/retry.ts')!.split('\n').slice(3, 6).join('\n')}, moved: false});
  });

  it('moves an off-by-a-few range onto a unique anchor', () => {
    const result = resolveRef({path: 'src/utils/retry.ts', startLine: 1, endLine: 1, anchor: 'return task();'}, files);
    expect('ref' in result && result.ref.startLine).toBe(7);
    expect('moved' in result && result.moved).toBe(true);
  });

  it('rejects unknown files and anchors that are not in the file', () => {
    expect(resolveRef({path: 'nope.ts', startLine: 1, endLine: 1, anchor: 'abc'}, files)).toHaveProperty('problem');
    expect(resolveRef({path: 'src/index.ts', startLine: 1, endLine: 2, anchor: 'made up code'}, files)).toHaveProperty('problem');
  });
});

const ref = (path: string, line: number, anchor: string) => ({path, startLine: line, endLine: line, anchor});

function draft(overrides: Partial<DraftLesson> = {}): DraftLesson {
  return {
    title: 'How retries work',
    feature: 'Follow a call from start() into retry().',
    estimatedMinutes: 8,
    diagram: {
      nodes: [
        {id: 'start', label: 'start()', ref: ref('src/index.ts', 3, 'export function start')},
        {id: 'retry', label: 'retry()', ref: ref('src/utils/retry.ts', 3, 'export async function retry')},
      ],
      edges: [{from: 'start', to: 'retry', evidence: 'verified'}],
    },
    steps: [
      {
        id: 'limit',
        title: 'The limit',
        explanation: 'Retries stop after `limit` attempts.',
        code: [ref('src/utils/retry.ts', 1, 'export const limit = 2')],
        claims: [{text: 'The default limit is 2.', evidence: 'verified', refs: [ref('src/utils/retry.ts', 1, 'limit = 2')]}],
        activity: {kind: 'locate', prompt: 'Click the loop condition.', answer: ref('src/utils/retry.ts', 4, 'i < limit'), tolerance: 0},
      },
    ],
    ...overrides,
  };
}

function stubModel(responses: unknown[]) {
  const calls: Parameters<AskModel>[0][] = [];
  const ask = (async request => {
    calls.push(request);
    return responses.shift();
  }) as AskModel;
  return {ask, calls};
}

describe('generateLesson', () => {
  const index = buildIndex(snapshot);
  const suggestion = {id: 's', title: 'Retries', why: 'Core behaviour', entryPoints: [{path: 'src/index.ts', startLine: 3, endLine: 3, excerpt: ''}]};

  it('returns a valid lesson without a repair round when every reference checks out', async () => {
    const {ask, calls} = stubModel([draft()]);
    const {lesson, warnings} = await generateLesson(snapshot, index, suggestion, ask);
    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(lesson.steps[0].code![0].excerpt).toBe('export const limit = 2;');
    // The prompt carries line-numbered files and marks them as untrusted.
    expect(calls[0].turns[0].content).toContain('<file path="src/utils/retry.ts">');
    expect(calls[0].turns[0].content).toContain('1| export const limit = 2;');
    expect(calls[0].system).toContain('untrusted');
  });

  it('asks for one repair when a reference is invented, then accepts the fix', async () => {
    const bad = draft();
    bad.steps[0].claims = [{text: 'It logs every retry.', evidence: 'verified', refs: [ref('src/utils/retry.ts', 5, 'console.log')]}];
    const {ask, calls} = stubModel([bad, draft()]);
    const {lesson} = await generateLesson(snapshot, index, suggestion, ask);
    expect(calls).toHaveLength(2);
    expect(calls[1].turns.at(-1)!.content).toContain('anchor "console.log" is not in src/utils/retry.ts');
    expect(lesson.steps[0].claims![0].text).toBe('The default limit is 2.');
  });

  it('drops what still fails after the repair and says so', async () => {
    const bad = draft();
    bad.steps[0].claims = [{text: 'It logs every retry.', evidence: 'verified', refs: [ref('src/utils/retry.ts', 5, 'console.log')]}];
    const {ask} = stubModel([bad, bad]);
    const {lesson, warnings} = await generateLesson(snapshot, index, suggestion, ask);
    expect(lesson.steps[0].claims).toBeUndefined();
    expect(warnings.join('\n')).toContain('no checkable evidence left');
  });
});

describe('suggestFeatures', () => {
  it('resolves entry point names to real lines and keeps only known issues', async () => {
    const response: DraftSuggestions = {
      summary: 'A fixture.',
      suggestions: [
        {id: 'retry', title: 'Retries', why: 'Core', entryPoints: [{path: 'src/utils/retry.ts', symbol: 'retry'}], relatedIssues: [7, 99]},
        {id: 'ghost', title: 'Made up', why: 'None', entryPoints: [{path: 'src/ghost.ts', symbol: 'boo'}]},
      ],
    };
    const {ask} = stubModel([response]);
    const result = await suggestFeatures(snapshot, buildIndex(snapshot), ask);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].entryPoints[0]).toMatchObject({path: 'src/utils/retry.ts', startLine: 3});
    expect(result.suggestions[0].relatedIssues).toEqual([{number: 7, title: 'Make retry limit configurable'}]);
  });
});

describe('fetchSnapshot', () => {
  it('keeps source files, skips oversized and generated ones, and pins the commit', async () => {
    const commit = 'a'.repeat(40);
    const fake = (async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body));
      if (url.endsWith('/repos/o/r')) return json({private: false, default_branch: 'main', description: 'd'});
      if (url.endsWith('/branches/main')) return json({commit: {sha: commit}});
      if (url.includes('/git/trees/')) {
        return json({truncated: false, tree: [
          {path: 'src/a.ts', type: 'blob', size: 10},
          {path: 'src/big.ts', type: 'blob', size: 10_000_000},
          {path: 'dist/a.js', type: 'blob', size: 10},
          {path: 'node_modules/x/index.js', type: 'blob', size: 10},
          {path: 'README.md', type: 'blob', size: 5},
        ]});
      }

      if (url.includes('/issues')) return json([{number: 1, title: 'Bug', labels: []}, {number: 2, title: 'PR', labels: [], pull_request: {}}]);
      if (url.startsWith(`https://raw.githubusercontent.com/o/r/${commit}/`)) return new Response(`contents of ${url.split('/').at(-1)}`);
      return new Response('', {status: 404});
    }) as typeof fetch;

    const result = await fetchSnapshot('o/r', {fetchImpl: fake});
    expect(result.repo.commit).toBe(commit);
    expect([...result.files.keys()].sort()).toEqual(['README.md', 'src/a.ts']);
    expect(result.skipped).toEqual([{path: 'src/big.ts', reason: 'too large'}]);
    expect(result.issues).toEqual([{number: 1, title: 'Bug', labels: []}]);
  });
});

describe('createApp', () => {
  it('reuses the snapshot from the suggestions request for the lesson request', async () => {
    const {createApp} = await import('./app');
    let loads = 0;
    const load = (async () => {
      loads++;
      return snapshot;
    }) as unknown as typeof fetchSnapshot;
    const suggestions: DraftSuggestions = {summary: 's', suggestions: [{id: 'start', title: 'Retries', why: 'w', entryPoints: [{path: 'src/index.ts', symbol: 'start'}]}]};
    const {ask} = stubModel([suggestions, draft()]);
    const app = createApp({ask, load});
    const post = (path: string, body: unknown) => app.request(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

    const first = await (await post('/api/suggestions', {repo: 'https://github.com/o/r'})).json() as {suggestions: unknown[]};
    const second = await post('/api/lessons', {repo: 'o/r', commit: snapshot.repo.commit, suggestion: first.suggestions[0]});
    expect(second.status).toBe(200);
    expect(loads).toBe(1);

    const bad = await post('/api/suggestions', {repo: 'https://evil.example/x/y'});
    expect(bad.status).toBe(400);
  });
});
