import {useEffect, useState, type FormEvent} from 'react';
import {generateLesson, listProviders, suggestFeatures, type ProviderInfo, type SuggestResponse} from './api';
import {LessonPlayer} from './LessonPlayer';
import kyLesson from './lessons/ky-request-failure.json';
import {loadProviderChoice, loadSavedLessons, saveLesson, saveProviderChoice, type SavedLesson} from './lesson/store';
import type {FeatureSuggestion, Lesson} from './lesson/types';

const sample: SavedLesson = {lesson: kyLesson as Lesson, warnings: [], savedAt: ''};

type Screen =
  | {name: 'home'}
  | {name: 'suggestions'; data: SuggestResponse; provider: ProviderInfo}
  | {name: 'lesson'; entry: SavedLesson};

export function App() {
  const [screen, setScreen] = useState<Screen>({name: 'home'});
  const [saved, setSaved] = useState(loadSavedLessons);
  const home = () => setScreen({name: 'home'});

  // Braces matter: newer browsers return a promise from scrollTo, which React
  // would mistake for a cleanup function.
  useEffect(() => {
    window.scrollTo({top: 0});
  }, [screen]);

  if (screen.name === 'lesson') {
    return <LessonPlayer key={screen.entry.lesson.id} lesson={screen.entry.lesson} warnings={screen.entry.warnings} onHome={home} />;
  }

  if (screen.name === 'suggestions') {
    return (
      <Suggestions
        data={screen.data}
        provider={screen.provider}
        onHome={home}
        onLesson={entry => {
          setSaved(saveLesson(entry));
          setScreen({name: 'lesson', entry});
        }}
      />
    );
  }

  return (
    <Home
      saved={saved}
      onSuggestions={(data, provider) => setScreen({name: 'suggestions', data, provider})}
      onOpen={entry => setScreen({name: 'lesson', entry})}
    />
  );
}

function Home({saved, onSuggestions, onOpen}: {saved: SavedLesson[]; onSuggestions: (data: SuggestResponse, provider: ProviderInfo) => void; onOpen: (entry: SavedLesson) => void}) {
  const [repo, setRepo] = useState('');
  const [goal, setGoal] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>();
  const [choice, setChoice] = useState(loadProviderChoice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listProviders().then(setProviders, () => setProviders([]));
  }, []);

  // The remembered choice if it still has a key, otherwise the first that does.
  const available = providers?.filter(option => option.available) ?? [];
  const provider = available.find(option => option.id === choice) ?? available[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      onSuggestions(await suggestFeatures(repo, provider.id, goal.trim() || undefined), provider);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar"><div className="topbar__title">Repository Trainer</div></header>
      <main className="home">
        <h1>Learn a codebase by working through it</h1>
        <p className="muted">Paste a public TypeScript or JavaScript repository and, if you like, say what you want to learn. You'll get a few lessons to choose from, each built from the real code.</p>
        <form className="repo-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="repo" className="field__label">GitHub repository</label>
            <input
              id="repo"
              value={repo}
              onChange={event => setRepo(event.target.value)}
              placeholder="https://github.com/owner/repo"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="goal" className="field__label">What do you want to learn? <span className="muted">(optional)</span></label>
            <textarea
              id="goal"
              value={goal}
              onChange={event => setGoal(event.target.value)}
              placeholder="For example: how retries work, or walk me through adding a new option"
              rows={2}
              maxLength={500}
              disabled={busy}
            />
            <span className="muted small">Leave it empty to get the features most useful for a first contribution.</span>
          </div>
          <fieldset className="field provider-picker" disabled={busy}>
            <legend className="field__label">AI model</legend>
            <div className="provider-picker__options">
              {(providers ?? []).map(option => (
                <label key={option.id} className="provider-option" title={option.available ? undefined : `Add ${option.keyVar} to .env.local to use ${option.label}`}>
                  <input
                    type="radio"
                    name="provider"
                    value={option.id}
                    checked={option.id === provider?.id}
                    disabled={!option.available}
                    onChange={() => {
                      setChoice(option.id);
                      saveProviderChoice(option.id);
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {providers && (
              provider
                ? available.length < providers.length && <span className="muted small">To enable the others, add {providers.filter(option => !option.available).map(option => option.keyVar).join(' or ')} to .env.local and restart.</span>
                : <span className="error small">No AI model is set up. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or OLLAMA_MODEL to .env.local and restart the dev server.</span>
            )}
          </fieldset>
          <button type="submit" className="primary" disabled={busy || repo.trim() === '' || !provider}>{busy ? 'Reading the repository…' : goal.trim() ? 'Find lessons' : 'Find features'}</button>
        </form>
        {busy && <p className="muted small">Fetching files from GitHub and mapping the project. This usually takes under a minute.</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <h3>Lessons</h3>
        <ul className="lesson-list">
          {[...saved, sample].map(entry => (
            <li key={entry.lesson.id}>
              <button type="button" className="lesson-card" onClick={() => onOpen(entry)}>
                <span className="lesson-card__repo">{entry.lesson.repo.owner}/{entry.lesson.repo.name}{entry === sample ? ' · sample, written by hand' : entry.provider ? ` · written by ${entry.provider}` : ''}</span>
                <span className="lesson-card__title">{entry.lesson.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function Suggestions({data, provider, onHome, onLesson}: {data: SuggestResponse; provider: ProviderInfo; onHome: () => void; onLesson: (entry: SavedLesson) => void}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const {repo} = data;

  const pick = async (suggestion: FeatureSuggestion) => {
    setBusy(suggestion.id);
    setError(undefined);
    try {
      const {lesson, warnings} = await generateLesson(repo, suggestion, provider.id, data.goal);
      onLesson({lesson, warnings, savedAt: new Date().toISOString(), provider: provider.label});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(undefined);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title"><button type="button" className="link-button" onClick={onHome}>Repository Trainer</button></div>
      </header>
      <main className="home">
        <p className="eyebrow">
          <a href={`https://github.com/${repo.owner}/${repo.name}/tree/${repo.commit}`} target="_blank" rel="noreferrer">{repo.owner}/{repo.name}</a>
          {' '}at <code>{repo.commit.slice(0, 7)}</code> · {provider.label}
        </p>
        <h1>What do you want to learn?</h1>
        {data.goal && <p className="goal-echo">You asked: “{data.goal}”</p>}
        <p>{data.summary}</p>
        {data.skipped > 0 && <p className="muted small">{data.skipped} files were skipped because of size limits.</p>}

        <ul className="suggestions">
          {data.suggestions.map(suggestion => (
            <li key={suggestion.id} className="suggestion">
              <h2>{suggestion.title}</h2>
              <p>{suggestion.why}</p>
              <p className="muted small">
                Starts at{' '}
                {suggestion.entryPoints.map((ref, i) => (
                  <span key={`${ref.path}:${ref.startLine}`}>
                    {i > 0 && ', '}
                    <a href={`https://github.com/${repo.owner}/${repo.name}/blob/${repo.commit}/${ref.path}#L${ref.startLine}`} target="_blank" rel="noreferrer">
                      <code>{ref.path}:{ref.startLine}</code>
                    </a>
                  </span>
                ))}
              </p>
              {suggestion.relatedIssues && (
                <p className="muted small">
                  Related issues:{' '}
                  {suggestion.relatedIssues.map((issue, i) => (
                    <span key={issue.number}>
                      {i > 0 && ', '}
                      <a href={`https://github.com/${repo.owner}/${repo.name}/issues/${issue.number}`} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a>
                    </span>
                  ))}
                </p>
              )}
              <button type="button" className="primary" onClick={() => pick(suggestion)} disabled={busy !== undefined}>
                {busy === suggestion.id ? 'Writing your lesson…' : 'Build this lesson'}
              </button>
              {busy === suggestion.id && <p className="muted small">Reading the code and checking every reference. This can take a couple of minutes.</p>}
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
