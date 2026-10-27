import {Highlight, themes} from 'prism-react-renderer';
import {useEffect, useRef} from 'react';
import {useRepoFile} from '../lesson/useRepoFile';
import type {CodeRef, RepoPin} from '../lesson/types';
import {useDarkMode} from './useDarkMode';

export type LineMark = {line: number; kind: 'correct' | 'wrong'};

type Props = {
  repo: RepoPin;
  focus: CodeRef;
  // Other ranges in the same file worth tinting, such as the rest of the step's refs.
  highlights?: CodeRef[];
  // When set, lines become clickable (the "locate" activity).
  onLineClick?: (line: number) => void;
  marks?: LineMark[];
};

function inRange(line: number, ref: CodeRef) {
  return line >= ref.startLine && line <= ref.endLine;
}

export function CodeViewer({repo, focus, highlights = [], onLineClick, marks = []}: Props) {
  const file = useRepoFile(repo, focus.path);
  const dark = useDarkMode();
  const body = useRef<HTMLDivElement>(null);
  const focusRow = useRef<HTMLDivElement>(null);
  const ready = file.status === 'ready';

  // Scroll only the code pane, vertically, so the focused range sits a little
  // above centre. scrollIntoView would also scroll the page and pan sideways.
  useEffect(() => {
    const container = body.current;
    const row = focusRow.current;
    if (container && row) {
      container.scrollTo({top: Math.max(0, row.offsetTop - container.clientHeight / 3), left: 0, behavior: 'smooth'});
    }
  }, [focus, ready]);

  const githubUrl = `https://github.com/${repo.owner}/${repo.name}/blob/${repo.commit}/${focus.path}#L${focus.startLine}-L${focus.endLine}`;

  return (
    <section className="code-viewer" aria-label={`Source of ${focus.path}`}>
      <header className="code-viewer__header">
        <code className="code-viewer__path">{focus.path}</code>
        <span className="code-viewer__lines">lines {focus.startLine}–{focus.endLine}</span>
        <a href={githubUrl} target="_blank" rel="noreferrer">Open on GitHub</a>
      </header>
      {focus.note && <p className="code-viewer__note">{focus.note}</p>}
      {onLineClick && <p className="code-viewer__note code-viewer__note--action">Click a line to answer.</p>}
      <div className="code-viewer__body" ref={body}>
        {file.status === 'loading' && <p className="muted pad">Loading {focus.path}…</p>}
        {file.status === 'error' && <p className="error pad">Couldn't load this file: {file.message}</p>}
        {file.status === 'ready' && (
          // Repository code is untrusted: it is only ever rendered as text tokens.
          <Highlight code={file.text.replace(/\n$/, '')} language="tsx" theme={dark ? themes.vsDark : themes.github}>
            {({tokens, getLineProps, getTokenProps}) => (
              <pre className="code">
                {tokens.map((line, i) => {
                  const number = i + 1;
                  const mark = marks.find(m => m.line === number);
                  const classes = [
                    'code__line',
                    inRange(number, focus) && 'is-focus',
                    !inRange(number, focus) && highlights.some(ref => ref.path === focus.path && inRange(number, ref)) && 'is-related',
                    onLineClick && 'is-clickable',
                    mark && `is-${mark.kind}`,
                  ].filter(Boolean).join(' ');
                  const lineProps = getLineProps({line});
                  return (
                    <div
                      key={number}
                      {...lineProps}
                      style={undefined}
                      className={classes}
                      ref={number === focus.startLine ? focusRow : undefined}
                      onClick={onLineClick ? () => onLineClick(number) : undefined}
                    >
                      <span className="code__number">{number}</span>
                      <span className="code__text">
                        {line.map((token, key) => <span key={key} {...getTokenProps({token})} />)}
                      </span>
                    </div>
                  );
                })}
              </pre>
            )}
          </Highlight>
        )}
      </div>
    </section>
  );
}
