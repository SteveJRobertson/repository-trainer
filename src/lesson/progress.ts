import {useEffect, useState} from 'react';

export type Progress = {
  // -1 is the overview screen, steps.length is the finish screen.
  stepIndex: number;
  // Steps whose activity was answered correctly or revealed.
  completed: string[];
  // How many tries each step's activity took before it was completed.
  attempts: Record<string, number>;
};

const initial: Progress = {stepIndex: -1, completed: [], attempts: {}};

// Progress is a per-viewer convenience, so localStorage is enough. Storage can
// be unavailable (private windows, blocked site data), so every access is
// guarded and the app works without it.
export function useProgress(lessonId: string) {
  const key = `repository-trainer:progress:${lessonId}`;
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? {...initial, ...JSON.parse(saved) as Progress} : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(progress));
    } catch {
      // Nothing to do: progress just won't survive a reload.
    }
  }, [key, progress]);

  return [progress, setProgress, () => setProgress(initial)] as const;
}
