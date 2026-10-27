# repository-trainer

Learn-By-Doing tool to learn a repo using AI instead of throwing an agent at a problem

## Status

Proof of concept. See [docs/poc-spec.md](docs/poc-spec.md) for scope and the lesson format.

Paste a public TypeScript or JavaScript repository and the app suggests a few features to learn, then generates a short interactive lesson for the one you pick. Every code reference in a generated lesson is checked against the repository before you see it. A hand-written sample lesson for [`sindresorhus/ky`](https://github.com/sindresorhus/ky) is always available, and works without an API key.

## Running it

```sh
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:5173
```

The API runs inside the Vite dev server, so keys stay on your machine and never reach the browser. Restart `npm run dev` after changing anything in `server/`.

Each generated lesson sends up to about 250 KB of the repository's code to the Claude API, plus a smaller request for the feature suggestions. Generated lessons are saved in your browser so reopening one costs nothing.

## How generation works

1. **Ingest** (`server/github.ts`): resolves the default branch to a commit, lists the tree, and downloads TS/JS source plus README and `package.json`, within size limits. Private and non-TS/JS repositories are refused with a clear message.
2. **Index** (`server/analyse.ts`): a regex-based map of each file's exports, functions, methods and relative imports, plus entry points from `package.json`.
3. **Suggest** (`server/pipeline.ts`): Claude reads the map, README and recent open issues and proposes features. Entry points come back as symbol names, and the server looks up their real line numbers.
4. **Generate**: the entry points, their callers, their imports (two levels) and the most relevant tests go to Claude with line numbers. It cites code as a line range plus a short quote.
5. **Ground** (`server/ground.ts`): each citation is checked. The quote must appear in the cited lines (an off-by-a-few range is moved onto the quote), and the excerpt is copied from the file, never from the model. Failures go back to Claude once for repair; anything still failing is removed and listed on the lesson's first screen.

Other scripts:

- `npm run validate` checks every code reference in `src/lessons/*.json` against the pinned commit on GitHub (file exists, lines in range, excerpt matches).
- `npm test` runs the unit tests. The generation pipeline is tested with a stubbed model, so tests need no API key.
- `npm run build` typechecks and builds for production.

## Layout

- `server/` the API: GitHub ingestion, indexing, prompts and grounding
- `src/lesson/` lesson types, validator, file loading, progress and saved lessons
- `src/components/` code viewer, flow diagram and activities
- `src/lessons/` lesson JSON files
- `scripts/validate-lessons.ts` the validator CLI
