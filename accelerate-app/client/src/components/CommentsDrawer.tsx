import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { PERSONAS, type PersonaKey } from '../personas';
import { useSessionStore } from '../stores/useSessionStore';

const PROJECT_COMMENT_SECTION = 'project';

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Ported from index.html's project conversation drawer (openCommentsDrawer/
// renderProjectDrawer et al.) — one @mention-able comment thread per whole
// campaign request (server: Comment model, already had real /api/comments
// routes this whole time; the "Conversations" trigger was just wired to a
// disabled button in this pass). Positioning is simplified: anchored via
// plain absolute positioning under the trigger's wrapping container rather
// than the original's own scroll/resize-tracked recompute.
export default function CommentsDrawer({ tactplanId, onClose }: { tactplanId: string; onClose: () => void }) {
  const currentPersona = useSessionStore((s) => s.currentPersona);
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['comments', tactplanId], queryFn: () => api.getComments(tactplanId) });
  const comments = data?.comments || [];

  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<PersonaKey[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleInput(value: string) {
    setDraft(value);
    const upToCaret = value.slice(0, inputRef.current?.selectionStart ?? value.length);
    setPickerOpen(/(^|\s)@(\w*)$/.test(upToCaret));
  }

  function pickMention(key: PersonaKey) {
    const firstName = PERSONAS[key].name.split(' ')[0];
    setDraft((d) => d.replace(/(^|\s)@(\w*)$/, `$1@${firstName} `));
    setPickerOpen(false);
    setMentions((m) => (m.includes(key) ? m : [...m, key]));
    inputRef.current?.focus();
  }

  async function submit() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await api.addComment({ tactplanId, sectionId: PROJECT_COMMENT_SECTION, authorPersona: currentPersona, body, mentions });
      setDraft('');
      setMentions([]);
      await queryClient.invalidateQueries({ queryKey: ['comments', tactplanId] });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="project-drawer-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="project-drawer" style={{ top: 100, right: 26 }}>
        <div className="project-drawer-head">
          <div>
            <h3>Project conversation</h3>
            <p>Everyone working this request, in one thread</p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="project-drawer-body">
          {comments.length ? (
            <div className="cm-list">
              {comments.map((c) => {
                const p = PERSONAS[c.authorPersona as PersonaKey] || { name: c.authorPersona, role: '', abbr: '?' };
                return (
                  <div className="cm-item" key={c.id}>
                    <span className="cm-av">{p.abbr}</span>
                    <div className="cm-body">
                      <div className="cm-meta">
                        <b>{p.name}</b>
                        <span className="cm-role">{p.role}</span>
                        <span className="cm-time">{timeAgo(c.createdAt)}</span>
                      </div>
                      <div className="cm-section-tag">General</div>
                      <div className="cm-text">{c.body}</div>
                      {c.mentions.length > 0 && (
                        <div className="cm-mentions">
                          {c.mentions.map((m) => (
                            <span className="cm-mention" key={m}>@{(PERSONAS[m as PersonaKey] || { name: m }).name.split(' ')[0]}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cm-empty">No comments yet on this request — start the conversation.</div>
          )}
        </div>
        <div className="project-drawer-compose">
          <textarea
            ref={inputRef}
            className="cm-input"
            placeholder="Comment… type @ to tag someone"
            value={draft}
            onChange={(e) => handleInput(e.target.value)}
          />
          {pickerOpen && (
            <div className="cm-mention-picker">
              {(Object.entries(PERSONAS) as [PersonaKey, (typeof PERSONAS)[PersonaKey]][]).map(([k, p]) => (
                <button className="cm-picker-item" key={k} onClick={() => pickMention(k)}>
                  <span className="p-av" style={{ width: 22, height: 22, fontSize: '.6rem', borderColor: p.color }}>{p.abbr}</span>
                  {p.name} <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>· {p.role}</span>
                </button>
              ))}
            </div>
          )}
          <div className="cm-compose-foot">
            <div className="cm-tagged">
              {mentions.map((k) => (
                <span className="cm-tag-chip" key={k}>
                  @{PERSONAS[k].name.split(' ')[0]}
                  <button onClick={() => setMentions((m) => m.filter((x) => x !== k))}>✕</button>
                </span>
              ))}
            </div>
            <button className="btn-primary btn-sm" onClick={submit} disabled={posting}>
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
