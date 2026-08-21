import type { ReactNode } from 'react';

// Ported (and extended) from index.html's renderBotMarkdown() — that
// version only handled bold/em/code/bullets/numbered-lists/hr/paragraphs
// (returned as an HTML string for innerHTML). This is a from-scratch React
// port of the same block-splitting approach, plus two block types the
// original never needed: headings (#/##/###) and pipe tables — both come up
// in agent replies (e.g. a comparison table of options) that previously
// just printed as literal "| a | b |" text with the pipes and asterisks
// showing raw.
let keySeq = 0;
const nextKey = () => `md-${keySeq++}`;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass, longest-token-first: **bold** and `code` are unambiguous
  // delimiters; *em*/_em_ only trigger with a preceding boundary
  // (start-of-string or whitespace/paren) so mid-word underscores/asterisks
  // (file_name, 3*4) don't get swallowed.
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|(^|[\s(])\*([^*\n]+)\*|(^|[\s(])_([^_\n]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={nextKey()}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<code key={nextKey()}>{m[2]}</code>);
    else if (m[4] !== undefined) nodes.push(m[3], <em key={nextKey()}>{m[4]}</em>);
    else if (m[6] !== undefined) nodes.push(m[5], <em key={nextKey()}>{m[6]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function renderMarkdown(text: string): ReactNode {
  const src = String(text || '').trim();
  if (!src) return null;

  const lines = src.split(/\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let list: { type: 'ul' | 'ol'; items: ReactNode[] } | null = null;

  const flushList = () => {
    if (!list) return;
    blocks.push(
      list.type === 'ul' ? (
        <ul key={nextKey()}>{list.items}</ul>
      ) : (
        <ol key={nextKey()}>{list.items}</ol>
      ),
    );
    list = null;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      flushList();
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      blocks.push(
        level === 1 ? (
          <h4 key={nextKey()}>{content}</h4>
        ) : level === 2 ? (
          <h5 key={nextKey()}>{content}</h5>
        ) : (
          <h6 key={nextKey()}>{content}</h6>
        ),
      );
      i++;
      continue;
    }

    // Table: a "| a | b |" row immediately followed by a "|---|---|"
    // separator row starts a table; every following pipe-row is a body row.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const headerCells = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes('|')) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      blocks.push(
        // Wrapped so a table with more columns than the chat column can fit
        // scrolls sideways within itself, instead of forcing the table (and
        // its ancestors) wider than the panel.
        <div className="msg-table-wrap" key={nextKey()}>
          <table>
            <thead>
              <tr>
                {headerCells.map((c) => (
                  <th key={nextKey()}>{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={nextKey()}>
                  {r.map((c) => (
                    <td key={nextKey()}>{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j;
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const want: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      if (!list || list.type !== want) {
        flushList();
        list = { type: want, items: [] };
      }
      list.items.push(<li key={nextKey()}>{renderInline(bullet ? bullet[1] : numbered![2])}</li>);
      i++;
      continue;
    }

    if (/^---+$/.test(line)) {
      flushList();
      blocks.push(<hr key={nextKey()} />);
      i++;
      continue;
    }

    flushList();
    blocks.push(<p key={nextKey()}>{renderInline(line)}</p>);
    i++;
  }
  flushList();

  return blocks;
}
