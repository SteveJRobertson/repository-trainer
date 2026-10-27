import {useEffect, useState} from 'react';
import type {RepoPin} from './types';
import {rawFileUrl} from './validate';

type FileState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'ready'; text: string};

// Files are fetched from the pinned commit, so they never change and can be
// cached for the lifetime of the page.
const cache = new Map<string, Promise<string>>();

function loadFile(repo: RepoPin, path: string): Promise<string> {
  const url = rawFileUrl(repo, path);
  if (!cache.has(url)) {
    const request = fetch(url).then(async response => {
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status} for ${path}`);
      }

      return response.text();
    });
    request.catch(() => cache.delete(url));
    cache.set(url, request);
  }

  return cache.get(url)!;
}

export function useRepoFile(repo: RepoPin, path: string): FileState {
  const [state, setState] = useState<FileState>({status: 'loading'});

  useEffect(() => {
    let cancelled = false;
    setState({status: 'loading'});
    loadFile(repo, path).then(
      text => !cancelled && setState({status: 'ready', text}),
      (error: unknown) => !cancelled && setState({status: 'error', message: error instanceof Error ? error.message : String(error)}),
    );
    return () => {
      cancelled = true;
    };
  }, [repo, path]);

  return state;
}
