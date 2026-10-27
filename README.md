# repository-trainer

Learn-By-Doing tool to learn a repo using AI instead of throwing an agent at a problem

## Status

Proof of concept. See [docs/poc-spec.md](docs/poc-spec.md) for scope and the lesson format.

Right now the app plays one hand-written lesson, "What happens when a ky request fails?", grounded in [`sindresorhus/ky`](https://github.com/sindresorhus/ky) at a pinned commit. Source files are fetched live from that commit on GitHub.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

- `npm run validate` checks every code reference in `src/lessons/*.json` against the pinned commit on GitHub (file exists, lines in range, excerpt matches).
- `npm test` runs the unit tests.
- `npm run build` typechecks and builds for production.

## Layout

- `src/lesson/` lesson types, validator, file loading and progress
- `src/components/` code viewer, flow diagram and activities
- `src/lessons/` lesson JSON files
- `scripts/validate-lessons.ts` the validator CLI
