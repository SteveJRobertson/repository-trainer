import {useState} from 'react';
import type {ChoiceActivity, CodeRef, LocateActivity, OrderActivity, PredictActivity} from '../lesson/types';
import {Markdown} from './Markdown';

// Every activity reports two things to the step: a wrong attempt, and
// completion (answered correctly, or the learner chose to see the answer).
type Outcome = {onAttempt: () => void; onComplete: () => void; onOpen: (ref: CodeRef) => void; done: boolean};

export function ChoiceView({activity, onAttempt, onComplete, onOpen, done}: {activity: ChoiceActivity | PredictActivity} & Outcome) {
  const [picked, setPicked] = useState<string[]>([]);
  const correct = activity.options.find(option => option.correct)!;
  const last = activity.options.find(option => option.id === picked.at(-1));
  const solved = done || picked.includes(correct.id);

  const pick = (id: string) => {
    if (solved || picked.includes(id)) {
      return;
    }

    const option = activity.options.find(o => o.id === id)!;
    setPicked([...picked, id]);
    if (activity.kind === 'predict') {
      onOpen(activity.reveal);
    }

    if (option.correct) {
      onComplete();
    } else {
      onAttempt();
    }
  };

  return (
    <div className="activity">
      <p className="activity__kind">{activity.kind === 'predict' ? 'Predict' : 'Choose'}</p>
      <Markdown className="activity__prompt">{activity.prompt}</Markdown>
      <ul className="options">
        {activity.options.map(option => {
          const state = picked.includes(option.id) || (solved && option.correct)
            ? (option.correct ? 'is-correct' : 'is-wrong')
            : '';
          return (
            <li key={option.id}>
              <button type="button" className={`option ${state}`} onClick={() => pick(option.id)} disabled={solved && !picked.includes(option.id) && !option.correct}>
                <Markdown inline>{option.label}</Markdown>
              </button>
            </li>
          );
        })}
      </ul>
      {last && (
        <Feedback good={last.correct} text={last.feedback} ref_={last.ref} onOpen={onOpen} />
      )}
      {activity.kind === 'predict' && picked.length > 0 && (
        <p className="muted small">The code that decides this is now open on the right.</p>
      )}
    </div>
  );
}

export function isLocateHit({answer, tolerance}: LocateActivity, line: number) {
  return line >= answer.startLine - tolerance && line <= answer.endLine + tolerance;
}

// The clicks happen in the code viewer, so the step judges them and passes
// the clicked lines in here for display.
export function LocateView({activity, done, clicks, onShowAnswer}: {
  activity: LocateActivity;
  done: boolean;
  clicks: number[];
  onShowAnswer: () => void;
}) {
  const {answer} = activity;
  const clicked = clicks.at(-1);
  const hit = clicked !== undefined && isLocateHit(activity, clicked);
  const wrong = clicks.filter(line => !isLocateHit(activity, line)).length;

  return (
    <div className="activity">
      <p className="activity__kind">Find it</p>
      <Markdown className="activity__prompt">{activity.prompt}</Markdown>
      {clicked === undefined && !done && <p className="muted small">Click a line in the code on the right.</p>}
      {clicked !== undefined && !hit && !done && (
        <div className="feedback is-wrong">
          <p>Line {clicked} isn't it. {wrong >= 2 && activity.hint ? activity.hint : 'Try another line.'}</p>
        </div>
      )}
      {done && (
        <div className="feedback is-correct">
          <p>{hit ? `Yes, line ${clicked}.` : 'Here it is.'} Line {answer.startLine} is the gate:</p>
          <pre className="excerpt">{answer.excerpt.trim()}</pre>
        </div>
      )}
      {!done && wrong >= 2 && (
        <button type="button" className="link-button" onClick={onShowAnswer}>Show me the answer</button>
      )}
    </div>
  );
}

export function OrderView({activity, onAttempt, onComplete, onOpen, done}: {activity: OrderActivity} & Outcome) {
  // Start from a fixed shuffle so the answer is never the starting order.
  const [order, setOrder] = useState(() => {
    const ids = activity.items.map(item => item.id);
    return [...ids.slice(1).reverse(), ids[0]];
  });
  const [checked, setChecked] = useState(false);
  const [tries, setTries] = useState(0);
  const shown = done ? activity.correct : order;
  const allRight = shown.every((id, i) => id === activity.correct[i]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || done) {
      return;
    }

    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    setOrder(next);
    setChecked(false);
  };

  const check = () => {
    setChecked(true);
    if (order.every((id, i) => id === activity.correct[i])) {
      onComplete();
    } else {
      setTries(tries + 1);
      onAttempt();
    }
  };

  return (
    <div className="activity">
      <p className="activity__kind">Put in order</p>
      <Markdown className="activity__prompt">{activity.prompt}</Markdown>
      <ol className="order">
        {shown.map((id, i) => {
          const item = activity.items.find(it => it.id === id)!;
          const state = (checked || done) ? (id === activity.correct[i] ? 'is-correct' : 'is-wrong') : '';
          return (
            <li key={id} className={`order__item ${state}`}>
              <span className="order__label"><Markdown inline>{item.label}</Markdown></span>
              {item.ref && <button type="button" className="link-button small" onClick={() => onOpen(item.ref!)}>code</button>}
              {!done && (
                <span className="order__moves">
                  <button type="button" aria-label="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>↑</button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, i + 1)} disabled={i === shown.length - 1}>↓</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!done && <button type="button" className="primary" onClick={check}>Check order</button>}
      {checked && !allRight && !done && (
        <div className="feedback is-wrong"><p>Not quite. Green items are in the right place.</p></div>
      )}
      {!done && tries >= 2 && (
        <button type="button" className="link-button" onClick={onComplete}>Show me the answer</button>
      )}
      {done && <Feedback good text={activity.feedback} onOpen={onOpen} />}
    </div>
  );
}

function Feedback({good, text, ref_, onOpen}: {good: boolean; text: string; ref_?: CodeRef; onOpen: (ref: CodeRef) => void}) {
  return (
    <div className={`feedback ${good ? 'is-correct' : 'is-wrong'}`} role="status">
      <Markdown>{text}</Markdown>
      {ref_ && (
        <button type="button" className="link-button small" onClick={() => onOpen(ref_)}>
          See {ref_.path}:{ref_.startLine}
        </button>
      )}
    </div>
  );
}
