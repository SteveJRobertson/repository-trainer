// A cheap static index of a snapshot: what each file exports and imports.
// It gives the model a map of the project and lets the server turn a symbol
// name back into real line numbers, so suggestions never cite invented lines.
import path from 'node:path/posix';
import type {CodeRef} from '../src/lesson/types';
import {isSourceFile, type Snapshot} from './github';

export type ExportEntry = {name: string; line: number};

export type FileIndex = {
  path: string;
  lines: number;
  exports: ExportEntry[];
  // Non-exported functions and class members, so the model can name them.
  members: ExportEntry[];
  // Resolved repository paths of relative imports.
  imports: string[];
};

export type RepoIndex = {
  files: Map<string, FileIndex>;
  entryPoints: string[];
  tests: string[];
};

const exportPattern = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const exportDefaultPattern = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)/;
const methodPattern = /^\s*(?:(?:public|private|protected|static|readonly|override|async)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)?[^;]*\{\s*$/;
const importPattern = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function resolveImport(from: string, specifier: string, known: Set<string>): string | undefined {
  const base = path.normalize(path.join(path.dirname(from), specifier));
  // TypeScript ESM code imports "./x.js" for a file called x.ts.
  const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  const candidates = [base, ...extensions.map(ext => stem + ext), ...extensions.map(ext => `${base}/index${ext}`)];
  return candidates.find(candidate => known.has(candidate));
}

export function indexFile(filePath: string, text: string, known: Set<string>): FileIndex {
  const lines = text.split('\n');
  const exports: ExportEntry[] = [];
  const members: ExportEntry[] = [];
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor']);
  lines.forEach((line, i) => {
    const match = exportPattern.exec(line) ?? exportDefaultPattern.exec(line);
    if (match) {
      exports.push({name: match[2] ?? match[1], line: i + 1});
      return;
    }

    const member = methodPattern.exec(line) ?? /^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (member && !keywords.has(member[1]) && members.length < 40) {
      members.push({name: member[1], line: i + 1});
    }
  });

  const imports = new Set<string>();
  for (const match of text.matchAll(importPattern)) {
    const resolved = resolveImport(filePath, match[1] ?? match[2] ?? match[3], known);
    if (resolved) {
      imports.add(resolved);
    }
  }

  return {path: filePath, lines: lines.length, exports, members, imports: [...imports]};
}

export function buildIndex(snapshot: Snapshot): RepoIndex {
  const known = new Set(snapshot.files.keys());
  const files = new Map<string, FileIndex>();
  for (const [filePath, text] of snapshot.files) {
    if (isSourceFile(filePath)) {
      files.set(filePath, indexFile(filePath, text, known));
    }
  }

  const entryPoints = new Set<string>();
  const manifest = snapshot.files.get('package.json');
  if (manifest) {
    try {
      const pkg = JSON.parse(manifest) as {main?: string; module?: string; source?: string; bin?: string | Record<string, string>; exports?: unknown};
      const targets = [pkg.source, pkg.main, pkg.module, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})), ...collectStrings(pkg.exports)];
      for (const target of targets) {
        const resolved = target && resolveEntry(target, known);
        if (resolved) {
          entryPoints.add(resolved);
        }
      }
    } catch {
      // A broken package.json just means no manifest entry points.
    }
  }

  for (const candidate of ['src/index', 'source/index', 'index', 'src/main', 'src/app', 'lib/index']) {
    const resolved = resolveImport('x', `./${candidate}`, known);
    if (resolved) {
      entryPoints.add(resolved);
    }
  }

  const tests = [...files.keys()].filter(file => /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  return {files, entryPoints: [...entryPoints], tests};
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }

  return [];
}

// Manifests point at build output ("./dist/index.js"); map that back to source.
function resolveEntry(target: string, known: Set<string>): string | undefined {
  const clean = target.replace(/^\.\//, '');
  const direct = resolveImport('x', `./${clean}`, known);
  if (direct) {
    return direct;
  }

  const stem = clean.replace(/^(?:dist|build|lib|out)\//, '').replace(/\.(?:d\.ts|js|mjs|cjs)$/, '');
  return ['src', 'source', ''].map(dir => resolveImport('x', `./${dir ? `${dir}/` : ''}${stem}`, known)).find(Boolean);
}

// Files reachable from `start` through relative imports, nearest first.
export function importClosure(index: RepoIndex, start: string[], depth: number): string[] {
  const seen = new Set<string>();
  let frontier = start.filter(file => index.files.has(file));
  for (let level = 0; level <= depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const file of frontier) {
      if (!seen.has(file)) {
        seen.add(file);
        next.push(...index.files.get(file)!.imports);
      }
    }

    frontier = next;
  }

  return [...seen];
}

// A compact, line-per-file map of the project for the model's prompt.
export function describeIndex(index: RepoIndex): string {
  return [...index.files.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(file => {
      const list = (entries: ExportEntry[]) => entries.map(entry => `${entry.name}@${entry.line}`).join(', ');
      return [
        `${file.path} (${file.lines} lines)`,
        file.exports.length > 0 ? ` exports: ${list(file.exports)}` : '',
        file.members.length > 0 ? ` defines: ${list(file.members)}` : '',
        file.imports.length > 0 ? ` imports: ${file.imports.join(', ')}` : '',
      ].join('');
    })
    .join('\n');
}

// Finds where a named symbol is defined in a file: an export, or failing
// that a method or function declaration. Returns its declaration line.
export function findSymbol(text: string, symbol: string): number | undefined {
  const lines = text.split('\n');
  const escaped = symbol.replace(/[$#]/g, '\\$&');
  const declaration = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:(?:function\\*?|class|const|let|var|interface|type|enum)\\s+)${escaped}\\b`);
  const index = lines.findIndex(line => declaration.test(line));
  if (index !== -1) {
    return index + 1;
  }

  const method = lines.findIndex(line => {
    const match = methodPattern.exec(line);
    return match?.[1] === symbol;
  });
  return method === -1 ? undefined : method + 1;
}

export function lineRef(text: string, filePath: string, startLine: number, endLine = startLine): CodeRef {
  const lines = text.split('\n');
  return {path: filePath, startLine, endLine, excerpt: lines.slice(startLine - 1, endLine).join('\n')};
}
