// The Conversations drawer renders Comment.body as plain text (no markdown
// pass, unlike chat's renderMarkdown) — text meant for that surface must
// never contain **bold**/<b>/<br> markup, or it shows up as literal
// asterisks/tags instead of formatting. Nudge messages and the model's own
// notify_stakeholders text both follow the FORMATTING skill's "bold field
// names" convention, which is correct for chat but wrong for a comment —
// this strips that markup down to plain prose before it's ever written to
// a Comment body.
export function toPlainText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?b>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
