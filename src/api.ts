import type {FeatureSuggestion, Lesson, RepoPin} from './lesson/types';

export type SuggestResponse = {
  repo: RepoPin;
  description: string | null;
  summary: string;
  suggestions: FeatureSuggestion[];
  skipped: number;
  goal?: string;
};

export type ProviderId = 'claude' | 'chatgpt' | 'gemini';
export type ProviderInfo = {id: ProviderId; label: string; keyVar: string; available: boolean};

export type LessonResponse = {lesson: Lesson; warnings: string[]};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({error: `The server returned ${response.status}.`})) as T & {error?: string};
  if (!response.ok || data.error) {
    throw new Error(data.error ?? `The server returned ${response.status}.`);
  }

  return data;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const response = await fetch('/api/providers');
  if (!response.ok) {
    throw new Error(`The server returned ${response.status}.`);
  }

  return response.json() as Promise<ProviderInfo[]>;
}

export const suggestFeatures = (repo: string, provider: ProviderId, goal?: string) => post<SuggestResponse>('/api/suggestions', {repo, provider, goal});

export const generateLesson = (repo: RepoPin, suggestion: FeatureSuggestion, provider: ProviderId, goal?: string) =>
  post<LessonResponse>('/api/lessons', {repo: `${repo.owner}/${repo.name}`, commit: repo.commit, suggestion, provider, goal});
