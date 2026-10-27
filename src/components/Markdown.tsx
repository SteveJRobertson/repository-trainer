import ReactMarkdown from 'react-markdown';

// Lesson text is Markdown. react-markdown ignores raw HTML by default, which
// matters once lessons are generated from untrusted repository content.
export function Markdown({children, inline = false, className}: {children: string; inline?: boolean; className?: string}) {
  if (inline) {
    return (
      <span className="md-inline">
        <ReactMarkdown allowedElements={['code', 'strong', 'em']} unwrapDisallowed>
          {children}
        </ReactMarkdown>
      </span>
    );
  }

  return (
    <div className={className}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
