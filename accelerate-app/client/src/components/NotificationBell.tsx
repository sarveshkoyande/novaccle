import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Comment } from '../api';
import { REQUESTS } from '../data/requests';
import { toPlainText } from '../plainText';
import { isApproverPersona, type PersonaKey } from '../personas';
import { useChatStore } from '../stores/useChatStore';
import { useVisioStore, DEFAULT_VISIO_STATE } from '../stores/useVisioStore';

let nbSeq = 0;
const nbNextId = () => `msg-nb-${Date.now()}-${nbSeq++}`;

const readKey = (persona: PersonaKey) => `accelerate-notifications-read:${persona}`;

function getReadIds(persona: PersonaKey): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(readKey(persona)) || '[]'));
  } catch {
    return new Set();
  }
}

// The essence of a notification, not the full multi-paragraph body — drops
// any "Next: ..." follow-up paragraph (useful in the full chat/Conversations
// view, just noise in a one-line preview) before the shared toPlainText()
// strips markup and collapses it to a single line.
function simplifyNotification(body: string): string {
  const firstParagraph = body.split(/\n\s*\n/)[0] || body;
  return toPlainText(firstParagraph);
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// A plain black-lineart bell — same "outline only, no fill until active"
// language as the layout-toggle glyphs next to it in the app bar (see
// AppShell's LayoutGlyph), rather than a mismatched filled icon.
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M6 10a6 6 0 1 1 12 0c0 3.2 1 5 1.8 6.2.3.4 0 1-.5 1H4.7c-.5 0-.8-.6-.5-1C5 15 6 13.2 6 10Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.5 19.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

// Real notifications, not a mock feed: every row here is an actual
// Comment the server persisted, either from a manual @mention, a fired
// nudge (see nudges.ts), or notify_stakeholders — this just polls the
// current persona's slice of that same stream and tracks read/unread
// locally, same pattern as guidedMode/archives before those moved server-side.
export default function NotificationBell({ persona }: { persona: PersonaKey }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<number>>(() => getReadIds(persona));
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ['notifications', persona],
    queryFn: () => api.getNotifications(persona),
    refetchInterval: 20000,
  });
  const addChatMessage = useChatStore((s) => s.addMessage);
  const chatThreads = useChatStore((s) => s.threads);
  const visioByCampaign = useVisioStore((s) => s.byCampaign);

  useEffect(() => setReadIds(getReadIds(persona)), [persona]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const notifications: Comment[] = query.data?.notifications || [];
  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  function markRead(id: number) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(readKey(persona), JSON.stringify([...next]));
      return next;
    });
  }

  function markAllRead() {
    const next = new Set(readIds);
    notifications.forEach((n) => next.add(n.id));
    setReadIds(next);
    localStorage.setItem(readKey(persona), JSON.stringify([...next]));
  }

  // A Flow "ready for review" notification, opened by one of its
  // approvers, drops an inline Approve / Suggest modifications prompt into
  // that approver's own chat thread for this campaign — the click-through
  // now leads straight into the decision instead of just landing on the
  // page and leaving them to go find the Flow Design tab's static buttons.
  function handleOpen(n: Comment) {
    markRead(n.id);
    setOpen(false);
    navigate(`/requests/${n.tactplanId}`);
    if (n.sectionId !== 'flow') return;
    const visio = visioByCampaign[n.tactplanId] ?? DEFAULT_VISIO_STATE;
    const thread = chatThreads[persona]?.[n.tactplanId] || [];
    if (isApproverPersona(persona)) {
      const mine = visio.decisions[persona];
      if (visio.sent && mine && mine.status === 'pending') {
        const alreadyPrompted = thread.some((m) => m.kind === 'visio_review' && !m.visioReview?.resolved);
        if (!alreadyPrompted) {
          addChatMessage(persona, n.tactplanId, { id: nbNextId(), role: 'bot', kind: 'visio_review', visioReview: { tactplanId: n.tactplanId } });
        }
      }
    } else if (persona === 'solutionArchitect' && n.mentions?.includes('solutionArchitect') && n.authorPersona === 'oms') {
      // The OMS metadata-sheet handoff — a draft already exists (ready)
      // but hasn't been sent for approval yet; this is what kickstarts
      // the SA's confirm/describe-changes/send-for-approval chat card.
      if (visio.ready && !visio.sent) {
        const alreadyPrompted = thread.some((m) => m.kind === 'visio_sa_review' && !m.visioSaReview?.sentForApproval);
        if (!alreadyPrompted) {
          addChatMessage(persona, n.tactplanId, { id: nbNextId(), role: 'bot', kind: 'visio_sa_review', visioSaReview: { tactplanId: n.tactplanId } });
        }
      }
    }
  }

  return (
    <div className={`notif-wrap ${open ? 'open' : ''}`} ref={wrapRef}>
      <button className="notif-btn" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        <BellIcon />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-menu">
          <div className="notif-menu-h">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 && <div className="notif-empty">Nothing yet — you're all caught up.</div>}
          {notifications.map((n) => {
            const req = REQUESTS.find((r) => r.id === n.tactplanId);
            const unread = !readIds.has(n.id);
            return (
              <button key={n.id} className={`notif-item ${unread ? 'unread' : ''}`} onClick={() => handleOpen(n)}>
                {unread && <span className="notif-dot" />}
                <div className="notif-item-body">
                  <div className="notif-item-title">{req ? req.name : n.tactplanId}</div>
                  {/* title= gives a native hover tooltip with the FULL
                      message — simplifyNotification() only shows the
                      essence (drops the "Next: ..." paragraph, clamped to
                      2 lines by CSS) because the dropdown has limited
                      space, but nothing about the complete text should be
                      lost, just deferred to hover. */}
                  <div className="notif-item-text" title={toPlainText(n.body)}>
                    {simplifyNotification(n.body)}
                  </div>
                  <div className="notif-item-meta">{timeAgo(n.createdAt)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
