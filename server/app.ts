import {Hono} from 'hono';
import type {FeatureSuggestion} from '../src/lesson/types';
import {buildIndex, type RepoIndex} from './analyse';
import {fetchSnapshot, IngestError, parseRepoUrl, type Snapshot} from './github';
import {createClaude, ModelError, type AskModel} from './model';
import {generateLesson, suggestFeatures} from './pipeline';

type Loaded = {snapshot: Snapshot; index: RepoIndex};

export function createApp(options: {ask?: AskModel; load?: typeof fetchSnapshot} = {}) {
  const load = options.load ?? fetchSnapshot;
  let ask = options.ask;
  const getAsk = () => (ask ??= createClaude());

  // Snapshots are pinned to a commit, so they can be reused between the
  // suggestion and lesson requests for as long as the dev server runs.
  const cache = new Map<string, Promise<Loaded>>();
  const keyFor = (input: string, commit?: string) => {
    const {owner, name} = parseRepoUrl(input);
    return `${owner}/${name}`.toLowerCase() + `@${commit ?? 'latest'}`;
  };

  const loadRepo = (input: string, commit?: string) => {
    const key = keyFor(input, commit);
    if (!cache.has(key)) {
      const loading = load(input, {commit}).then(snapshot => ({snapshot, index: buildIndex(snapshot)}));
      loading.catch(() => cache.delete(key));
      cache.set(key, loading);
    }

    return cache.get(key)!;
  };

  const app = new Hono().basePath('/api');

  app.onError((error, c) => {
    const expected = error instanceof IngestError || error instanceof ModelError;
    if (!expected) {
      console.error(error);
    }

    return c.json({error: error.message}, expected ? 400 : 500);
  });

  app.post('/suggestions', async c => {
    const {repo} = await c.req.json<{repo: unknown}>();
    if (typeof repo !== 'string') {
      throw new IngestError('Enter a GitHub repository.');
    }

    const {snapshot, index} = await loadRepo(repo);
    // Cache under the resolved commit too, so the lesson request hits it.
    cache.set(keyFor(repo, snapshot.repo.commit), Promise.resolve({snapshot, index}));
    return c.json(await suggestFeatures(snapshot, index, getAsk()));
  });

  app.post('/lessons', async c => {
    const {repo, commit, suggestion} = await c.req.json<{repo: string; commit: string; suggestion: FeatureSuggestion}>();
    const {snapshot, index} = await loadRepo(repo, commit);
    return c.json(await generateLesson(snapshot, index, suggestion, getAsk()));
  });

  return app;
}
