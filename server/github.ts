// Reads a public GitHub repository at one commit. Everything fetched here is
// untrusted input: it is only ever stored as text and passed on as data.
import type {RepoPin} from '../src/lesson/types';
import {rawFileUrl} from '../src/lesson/validate';

export type RepoFile = {path: string; size: number};

export type Snapshot = {
  repo: RepoPin;
  description: string | null;
  // Every file in the tree, so the model can see the project's shape.
  tree: RepoFile[];
  // Contents of the files worth analysing, keyed by path.
  files: Map<string, string>;
  // Files that matched but were left out, with the reason.
  skipped: {path: string; reason: string}[];
  // Recently updated open issues, to tie suggestions to real contribution work.
  issues: {number: number; title: string; labels: string[]}[];
};

export class IngestError extends Error {}

export const limits = {
  maxFileBytes: 120_000,
  maxTotalBytes: 2_500_000,
  maxFiles: 600,
};

const ownerRepo = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

// Accepts "owner/repo" or a github.com URL, and nothing else, so user input
// can never make the server fetch an arbitrary host.
export function parseRepoUrl(input: string): {owner: string; name: string} {
  let value = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(value);
  if (match) {
    value = match[1].split('/').slice(0, 2).join('/');
  }

  if (!ownerRepo.test(value)) {
    throw new IngestError('Enter a public GitHub repository, like "sindresorhus/ky" or its github.com URL.');
  }

  const [owner, name] = value.split('/');
  return {owner, name};
}

const sourceExtensions = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const ignoredDirectories = /(?:^|\/)(?:node_modules|dist|build|out|coverage|vendor|\.next|\.git|fixtures?|__snapshots__)\//;
const generated = /(?:\.min\.js|\.d\.ts|\.map|lock\.json|\.lock)$/;

export function isSourceFile(path: string) {
  return sourceExtensions.test(path) && !ignoredDirectories.test(path) && !generated.test(path);
}

// Top-level docs and manifests give the model the project's own description.
export function isContextFile(path: string) {
  return /^(?:readme|contributing)(?:\.md)?$/i.test(path) || path === 'package.json';
}

type Fetch = typeof fetch;

export async function fetchSnapshot(input: string, options: {commit?: string; fetchImpl?: Fetch} = {}): Promise<Snapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const {owner, name} = parseRepoUrl(input);
  const headers: Record<string, string> = {accept: 'application/vnd.github+json', 'user-agent': 'repository-trainer'};
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const api = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}${path}`, {headers});
    if (response.status === 404) {
      throw new IngestError(`Couldn't find ${owner}/${name}. Only public repositories are supported.`);
    }

    if (response.status === 401) {
      throw new IngestError('GitHub rejected the GITHUB_TOKEN. Fix or remove it in .env.local.');
    }

    if (response.status === 403 || response.status === 429) {
      throw new IngestError('GitHub rate limit reached. Set GITHUB_TOKEN in .env.local to raise it, or try again later.');
    }

    if (!response.ok) {
      throw new IngestError(`GitHub returned ${response.status} for ${owner}/${name}.`);
    }

    return response.json() as Promise<T>;
  };

  const meta = await api<{private: boolean; default_branch: string; description: string | null}>('');
  if (meta.private) {
    throw new IngestError('Only public repositories are supported.');
  }

  const commit = options.commit && /^[0-9a-f]{40}$/.test(options.commit)
    ? options.commit
    : (await api<{commit: {sha: string}}>(`/branches/${encodeURIComponent(meta.default_branch)}`)).commit.sha;
  const repo: RepoPin = {owner, name, commit};
  const treeResponse = await api<{tree: {path: string; type: string; size?: number}[]; truncated: boolean}>(`/git/trees/${repo.commit}?recursive=1`);
  const tree = treeResponse.tree
    .filter(entry => entry.type === 'blob')
    .map(entry => ({path: entry.path, size: entry.size ?? 0}));

  const skipped: Snapshot['skipped'] = [];
  const wanted: RepoFile[] = [];
  let total = 0;
  // Context files first, then source files from shallowest to deepest, so the
  // budget is spent on the code nearest the entry points.
  const candidates = tree
    .filter(file => isContextFile(file.path) || isSourceFile(file.path))
    .sort((a, b) => Number(isContextFile(b.path)) - Number(isContextFile(a.path)) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));

  for (const file of candidates) {
    if (file.size > limits.maxFileBytes) {
      skipped.push({path: file.path, reason: 'too large'});
    } else if (wanted.length >= limits.maxFiles || total + file.size > limits.maxTotalBytes) {
      skipped.push({path: file.path, reason: 'repository size limit'});
    } else {
      wanted.push(file);
      total += file.size;
    }
  }

  if (!wanted.some(file => isSourceFile(file.path))) {
    throw new IngestError(`${owner}/${name} has no TypeScript or JavaScript source files. Only TS/JS repositories are supported for now.`);
  }

  const files = new Map<string, string>();
  await mapLimit(wanted, 12, async file => {
    const response = await fetchImpl(rawFileUrl(repo, file.path), {headers: {'user-agent': 'repository-trainer'}});
    if (response.ok) {
      files.set(file.path, await response.text());
    } else {
      skipped.push({path: file.path, reason: `download failed (${response.status})`});
    }
  });

  const issues = await api<{number: number; title: string; pull_request?: unknown; labels: {name: string}[]}[]>('/issues?state=open&per_page=40&sort=updated')
    .then(list => list.filter(issue => !issue.pull_request).map(issue => ({number: issue.number, title: issue.title, labels: issue.labels.map(label => label.name)})))
    // Issues only enrich suggestions, so a failure here isn't fatal.
    .catch(() => []);

  return {repo, description: meta.description, tree, files, skipped, issues};
}

async function mapLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}
