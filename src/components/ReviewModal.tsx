import { useEffect, useMemo } from 'react';

type Props = {
  open: boolean;
  loading: boolean;
  markdown: string | null;
  error: string | null;
  meta?: { handCount: number; model: string; latencyMs: number } | null;
  onClose: () => void;
  onCopy: () => void;
};

// Lightweight modal that renders the coaching review. No external markdown
// dependency — we render a safe subset (headings, paragraphs, bullet lists,
// inline bold/italic/code). Anything else is rendered as plain text so the
// model can't smuggle markup into the page (React escapes strings by default).
export function ReviewModal({
  open,
  loading,
  markdown,
  error,
  meta,
  onClose,
  onCopy,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const blocks = useMemo(() => (markdown ? renderMarkdown(markdown) : null), [markdown]);

  if (!open) return null;
  return (
    <div className="review-overlay" onClick={onClose} role="presentation">
      <div
        className="review-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Training review"
      >
        <header className="review-header">
          <h2>Training review</h2>
          {meta && (
            <div className="review-meta">
              {meta.handCount} hand{meta.handCount === 1 ? '' : 's'} · {meta.model} · {Math.round(meta.latencyMs / 100) / 10}s
            </div>
          )}
          <button className="review-close" onClick={onClose} aria-label="Close review">×</button>
        </header>
        <div className="review-body">
          {loading && (
            <div className="review-loading">
              <div className="review-spinner" />
              <div>Reviewing your session… this can take 30-60s.</div>
            </div>
          )}
          {!loading && error && (
            <div className="review-error">
              <div className="review-error-title">Review failed</div>
              <div className="review-error-body">{error}</div>
              <div className="review-error-hint">
                Make sure <code>POKERCLAW_AGENT_API_KEY</code> is set in your <code>.env</code> and that
                the dealer is running with it loaded.
              </div>
            </div>
          )}
          {!loading && !error && blocks}
        </div>
        {!loading && !error && markdown && (
          <footer className="review-footer">
            <button className="review-btn" onClick={onCopy}>Copy to clipboard</button>
            <button className="review-btn review-btn-primary" onClick={onClose}>Close</button>
          </footer>
        )}
      </div>
    </div>
  );
}

// ---- Minimal markdown renderer --------------------------------------------
// Supports: ATX headings (#, ##, ###, ####), bullet lists (- or *), ordered
// lists (1.), bold/italic/inline code, blockquotes, blank-line paragraphs.
// Anything unrecognized falls through as a plain paragraph rendered as text.

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'h4'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'p'; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (line.trim() === '') {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#### (.+)$/))) { out.push({ kind: 'h4', text: m[1] }); i++; continue; }
    if ((m = line.match(/^### (.+)$/))) { out.push({ kind: 'h3', text: m[1] }); i++; continue; }
    if ((m = line.match(/^## (.+)$/))) { out.push({ kind: 'h2', text: m[1] }); i++; continue; }
    if ((m = line.match(/^# (.+)$/))) { out.push({ kind: 'h1', text: m[1] }); i++; continue; }
    if (line.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2));
        i++;
      }
      out.push({ kind: 'blockquote', text: buf.join(' ') });
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*] /, ''));
        i++;
      }
      out.push({ kind: 'ul', items });
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      out.push({ kind: 'ol', items });
      continue;
    }
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].startsWith('> ')
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ kind: 'p', text: buf.join(' ') });
  }
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) { out.push(buf); buf = ''; }
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push(<code key={out.length}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        flush();
        out.push(<strong key={out.length}>{renderInline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (c === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i) {
        flush();
        out.push(<em key={out.length}>{renderInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function renderMarkdown(md: string): React.ReactNode {
  const blocks = parseBlocks(md);
  return (
    <div className="review-md">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'h1': return <h1 key={idx}>{renderInline(b.text)}</h1>;
          case 'h2': return <h2 key={idx}>{renderInline(b.text)}</h2>;
          case 'h3': return <h3 key={idx}>{renderInline(b.text)}</h3>;
          case 'h4': return <h4 key={idx}>{renderInline(b.text)}</h4>;
          case 'ul':
            return (
              <ul key={idx}>
                {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx}>
                {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
              </ol>
            );
          case 'blockquote': return <blockquote key={idx}>{renderInline(b.text)}</blockquote>;
          case 'p': return <p key={idx}>{renderInline(b.text)}</p>;
        }
      })}
    </div>
  );
}
