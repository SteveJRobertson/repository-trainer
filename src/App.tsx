import {useMemo, useState} from 'react';
import {ChoiceView, isLocateHit, LocateView, OrderView} from './components/Activities';
import {CodeViewer, type LineMark} from './components/CodeViewer';
import {FlowDiagram} from './components/FlowDiagram';
import {Markdown} from './components/Markdown';
import kyLesson from './lessons/ky-request-failure.json';
import {useProgress} from './lesson/progress';
import type {Claim, CodeRef, Lesson, Step} from './lesson/types';

const lesson = kyLesson as Lesson;

function sameRef(a: CodeRef, b: CodeRef) {
  return a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;
}

function overlaps(a: CodeRef, b: CodeRef) {
  return a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function stepRefs(step: Step): CodeRef[] {
  const refs = [...step.code ?? []];
  const activity = step.activity;
  // A locate answer must be visible somewhere, or the activity can't be done.
  if (activity?.kind === 'locate' && !refs.some(ref => overlaps(ref, activity.answer))) {
    refs.push(activity.answer);
  }

  return refs;
}

export function App() {
  const [progress, setProgress, reset] = useProgress(lesson.id);
  const {stepIndex} = progress;
  const step = lesson.steps[stepIndex] as Step | undefined;
  const [opened, setOpened] = useState<CodeRef>();
  const [showMap, setShowMap] = useState(false);
  const [locateClicks, setLocateClicks] = useState<number[]>([]);

  const goTo = (index: number) => {
    setProgress(p => ({...p, stepIndex: index}));
    setOpened(undefined);
    setLocateClicks([]);
    window.scrollTo({top: 0});
  };

  const done = step ? progress.completed.includes(step.id) : false;
  const complete = () => step && setProgress(p => (p.completed.includes(step.id) ? p : {...p, completed: [...p.completed, step.id]}));
  const attempt = () => step && setProgress(p => ({...p, attempts: {...p.attempts, [step.id]: (p.attempts[step.id] ?? 0) + 1}}));

  const refs = step ? stepRefs(step) : [];
  const focus = opened ?? refs[0] ?? lesson.diagram.nodes[0].ref;

  // Diagram boxes whose code this step shows are highlighted on the map.
  const activeNodes = useMemo(
    () => new Set(lesson.diagram.nodes.filter(node => refs.some(ref => overlaps(ref, node.ref))).map(node => node.id)),
    [refs],
  );

  // The locate activity turns the viewer into the answer surface while its
  // target file is open.
  const locate = step?.activity?.kind === 'locate' ? step.activity : undefined;
  const locating = locate && !done && focus.path === locate.answer.path;
  const marks: LineMark[] = locate
    ? [
      ...locateClicks.map(line => ({line, kind: isLocateHit(locate, line) ? 'correct' as const : 'wrong' as const})),
      ...(done ? [{line: locate.answer.startLine, kind: 'correct' as const}] : []),
    ]
    : [];

  const onLineClick = (line: number) => {
    if (!locate || done) {
      return;
    }

    setLocateClicks(clicks => [...clicks, line]);
    if (isLocateHit(locate, line)) {
      complete();
    } else {
      attempt();
    }
  };

  if (stepIndex < 0) {
    return <Overview onStart={() => goTo(0)} onOpen={setOpened} opened={opened} />;
  }

  if (!step) {
    return <Finish attempts={progress.attempts} onRestart={() => { reset(); setOpened(undefined); }} onReview={() => goTo(0)} />;
  }

  return (
    <div className="app">
      <LessonHeader stepIndex={stepIndex} completed={progress.completed} onJump={goTo} />
      <main className="layout">
        <div className="panel">
          <p className="eyebrow">Step {stepIndex + 1} of {lesson.steps.length}</p>
          <h2>{step.title}</h2>
          <Markdown className="explanation">{step.explanation}</Markdown>

          {refs.length > 1 && (
            <div className="ref-tabs" role="tablist" aria-label="Code in this step">
              {refs.map(ref => (
                <button
                  key={`${ref.path}:${ref.startLine}`}
                  type="button"
                  role="tab"
                  aria-selected={sameRef(ref, focus)}
                  className={`ref-tab${sameRef(ref, focus) ? ' is-selected' : ''}`}
                  onClick={() => setOpened(ref)}
                >
                  {ref.path.split('/').at(-1)}:{ref.startLine}
                </button>
              ))}
            </div>
          )}

          {step.activity?.kind === 'choice' || step.activity?.kind === 'predict'
            ? <ChoiceView key={step.id} activity={step.activity} done={done} onAttempt={attempt} onComplete={complete} onOpen={setOpened} />
            : null}
          {locate && (
            <LocateView
              key={step.id}
              activity={locate}
              done={done}
              clicks={locateClicks}
              onShowAnswer={() => { complete(); setOpened(locate.answer); }}
            />
          )}
          {step.activity?.kind === 'order' && (
            <OrderView key={step.id} activity={step.activity} done={done} onAttempt={attempt} onComplete={complete} onOpen={setOpened} />
          )}

          {step.claims && step.claims.length > 0 && <Claims claims={step.claims} onOpen={setOpened} />}

          <div className="nav">
            <button type="button" onClick={() => goTo(stepIndex - 1)}>Back</button>
            <button type="button" className="primary" onClick={() => goTo(stepIndex + 1)} disabled={Boolean(step.activity) && !done}>
              {stepIndex === lesson.steps.length - 1 ? 'Finish' : 'Continue'}
            </button>
          </div>

          <details className="map" open={showMap} onToggle={event => setShowMap((event.target as HTMLDetailsElement).open)}>
            <summary>Lesson map</summary>
            <FlowDiagram diagram={lesson.diagram} active={activeNodes} onOpen={setOpened} />
          </details>
        </div>
        <CodeViewer
          repo={lesson.repo}
          focus={focus}
          highlights={refs}
          onLineClick={locating ? onLineClick : undefined}
          marks={focus.path === locate?.answer.path ? marks : []}
        />
      </main>
    </div>
  );
}

function LessonHeader({stepIndex, completed, onJump}: {stepIndex: number; completed: string[]; onJump: (index: number) => void}) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        <button type="button" className="link-button" onClick={() => onJump(-1)}>Repository Trainer</button>
        <span className="muted"> / {lesson.repo.owner}/{lesson.repo.name}</span>
      </div>
      <ol className="dots" aria-label="Lesson progress">
        {lesson.steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`dot${i === stepIndex ? ' is-current' : ''}${completed.includes(s.id) ? ' is-done' : ''}`}
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === stepIndex ? 'step' : undefined}
              onClick={() => onJump(i)}
              disabled={i > stepIndex && !completed.includes(lesson.steps[i - 1]?.id ?? '')}
            />
          </li>
        ))}
      </ol>
    </header>
  );
}

function Claims({claims, onOpen}: {claims: Claim[]; onOpen: (ref: CodeRef) => void}) {
  return (
    <section className="claims" aria-label="What this step claims">
      <h3>What the code shows</h3>
      <ul>
        {claims.map(claim => (
          <li key={claim.text} className="claim">
            <span className={`badge badge--${claim.evidence}`}>{claim.evidence}</span>
            <Markdown inline>{claim.text}</Markdown>
            {claim.refs.map(ref => (
              <button key={`${ref.path}:${ref.startLine}`} type="button" className="link-button small" onClick={() => onOpen(ref)}>
                {ref.path.split('/').at(-1)}:{ref.startLine}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Overview({onStart, onOpen, opened}: {onStart: () => void; onOpen: (ref: CodeRef) => void; opened?: CodeRef}) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">Repository Trainer</div>
      </header>
      <main className="layout">
        <div className="panel">
          <p className="eyebrow">
            <a href={`https://github.com/${lesson.repo.owner}/${lesson.repo.name}/tree/${lesson.repo.commit}`} target="_blank" rel="noreferrer">
              {lesson.repo.owner}/{lesson.repo.name}
            </a>{' '}
            at <code>{lesson.repo.commit.slice(0, 7)}</code>
          </p>
          <h1>{lesson.title}</h1>
          <Markdown className="explanation">{lesson.feature}</Markdown>
          <p className="muted">{lesson.steps.length} short steps · about {lesson.estimatedMinutes} minutes</p>
          <button type="button" className="primary large" onClick={onStart}>Start lesson</button>
          <h3>The route you'll follow</h3>
          <FlowDiagram diagram={lesson.diagram} onOpen={onOpen} />
        </div>
        {opened
          ? <CodeViewer repo={lesson.repo} focus={opened} />
          : (
            <section className="code-viewer code-viewer--empty">
              <p className="muted pad">Click a box on the map to peek at its code, or start the lesson.</p>
            </section>
          )}
      </main>
    </div>
  );
}

function Finish({attempts, onRestart, onReview}: {attempts: Record<string, number>; onRestart: () => void; onReview: () => void}) {
  const firstTry = lesson.steps.filter(s => s.activity && !attempts[s.id]).length;
  const total = lesson.steps.filter(s => s.activity).length;
  const files = [...new Set(lesson.steps.flatMap(s => stepRefs(s).map(ref => ref.path)))];
  return (
    <div className="app">
      <header className="topbar"><div className="topbar__title">Repository Trainer</div></header>
      <main className="finish">
        <h1>Lesson complete</h1>
        <p>You answered {firstTry} of {total} activities on the first try.</p>
        <h3>Files you worked through</h3>
        <ul className="file-list">
          {files.map(path => (
            <li key={path}>
              <a href={`https://github.com/${lesson.repo.owner}/${lesson.repo.name}/blob/${lesson.repo.commit}/${path}`} target="_blank" rel="noreferrer"><code>{path}</code></a>
            </li>
          ))}
        </ul>
        <p>Next, try opening <code>source/core/Ky.ts</code> on its own and following a timeout instead of a 500.</p>
        <div className="nav">
          <button type="button" onClick={onReview}>Review steps</button>
          <button type="button" className="primary" onClick={onRestart}>Start again</button>
        </div>
      </main>
    </div>
  );
}
