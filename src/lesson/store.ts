import type {Lesson} from './types';

export type SavedLesson = {lesson: Lesson; warnings: string[]; savedAt: string};

const key = 'repository-trainer:lessons';

// Generated lessons are kept in this browser so they can be reopened without
// paying for generation again. Storage may be unavailable; then nothing is kept.
export function loadSavedLessons(): SavedLesson[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as SavedLesson[];
  } catch {
    return [];
  }
}

export function saveLesson(entry: SavedLesson): SavedLesson[] {
  const next = [entry, ...loadSavedLessons().filter(saved => saved.lesson.id !== entry.lesson.id)].slice(0, 12);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the lesson still opens, it just isn't kept.
  }

  return next;
}
