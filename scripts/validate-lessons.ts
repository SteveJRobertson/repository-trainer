// Checks every lesson in src/lessons against its pinned GitHub commit.
// Usage: npm run validate [-- path/to/lesson.json ...]
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import type {Lesson} from '../src/lesson/types';
import {rawFileUrl, validateLesson} from '../src/lesson/validate';

const lessonsDir = path.resolve(import.meta.dirname, '../src/lessons');

async function lessonPaths(): Promise<string[]> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args;
  }

  const names = await readdir(lessonsDir);
  return names.filter(name => name.endsWith('.json')).map(name => path.join(lessonsDir, name));
}

let failed = false;
for (const file of await lessonPaths()) {
  const lesson = JSON.parse(await readFile(file, 'utf8')) as Lesson;
  const issues = await validateLesson(lesson, async filePath => {
    const response = await fetch(rawFileUrl(lesson.repo, filePath));
    return response.ok ? response.text() : undefined;
  });

  const name = path.relative(process.cwd(), file);
  if (issues.length === 0) {
    console.log(`✓ ${name}`);
    continue;
  }

  failed = true;
  console.log(`✗ ${name}`);
  for (const issue of issues) {
    console.log(`  ${issue.where}: ${issue.message}`);
  }
}

process.exitCode = failed ? 1 : 0;
