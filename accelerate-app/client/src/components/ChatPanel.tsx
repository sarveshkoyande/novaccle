import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore, LANDING_PROJECT } from '../stores/useChatStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useAgentFill } from '../hooks/useAgentFill';
import { PERSONAS } from '../personas';
import { renderMarkdown } from '../markdown';
import { pendingIntakeContinuations } from '../pendingIntake';
import type { FormSection } from '../types';

// How many of the most recent messages stay visible by default — the rest
// collapse behind the "earlier messages" toggle below. Bumped up from 8,
// which collapsed the current back-and-forth (a reasoning line, a tool
// call, a proposal, a reply — 4+ messages per turn) after just one or two
// real exchanges. Still bounded so a returning user isn't handed a full
// session-ago wall of scrollback by default.
const VISIBLE_TAIL = 24;

// Composer auto-grows with what you type, capped at 7 lines by default;
// past that a maximize toggle appears to expand further (up to a generous
// ceiling, still internally scrollable beyond it) or collapse back to 7.
const INPUT_LINE_PX = 20;
const INPUT_COLLAPSED_LINES = 7;
const INPUT_COLLAPSED_MAX = INPUT_LINE_PX * INPUT_COLLAPSED_LINES;
const INPUT_EXPANDED_MAX = INPUT_LINE_PX * 22;

// Ported from index.html's #chatPanel — same "Campaign Navigator" pane,
// persistent per persona (chatStateByPersona). Proposal cards (propose_fill
// results) render inline with real Confirm/Cancel — confirming calls
// onApplyProposal, which the Request Detail page uses to write values into
// its own field-value state and persist via /api/entries.
export default function ChatPanel({
  sections,
  tactplanId,
  onApplyProposal,
  onOpenCampaign,
  onCreateCampaign,
  interviewData,
  onQuizAnswer,
  onNotifyStakeholders,
  variant = 'panel',
}: {
  sections: FormSection[];
  tactplanId: string | null;
  onApplyProposal: (assignments: { fieldId: string; value: string }[]) => void;
  onOpenCampaign?: (tactplanId: string) => void;
  // Confirming a new_campaign_proposal card calls this with the staged
  // fields — the page decides how "creating" a campaign actually works
  // (REQUESTS.unshift + navigate, same as the New Request modal).
  // Returns the new campaign's real TactPlan id — ChatPanel needs it back
  // to relocate the live thread onto that project's own key.
  onCreateCampaign?: (fields: {
    tactplanId?: string;
    agency: string;
    brand: string;
    indication: string;
    brandedUnbranded: string;
    audience: string;
    assetScope: string;
    campaignName: string;
    channels: string[];
  }) => Promise<string> | string;
  // Feeds get_interview_state/get_missing_fields/propose_derived_fills —
  // undefined on the landing page (no specific campaign open, nothing to
  // compute this from).
  interviewData?: {
    remaining: { sectionId: string; sectionName: string; field: string }[];
    blocked: { sectionId: string; sectionName: string; field: string; reason: string }[];
    derived: { sectionId: string; sectionName: string; field: string; value: string }[];
    interview: { stage: string; stageOpen: { sectionId: string; field: string }[]; nextQuestions: unknown[]; derivableCount: number };
  };
  // record_quiz_answer's real, immediate write (no staging) — sectionId +
  // the field LABEL (not a fieldId; that's all the tool ever had) + value.
  onQuizAnswer?: (sectionId: string, field: string, value: string) => void;
  // notify_stakeholders — posts real @mention comments to the target
  // campaign's Conversations thread (tactplanId is the newly created
  // campaign's, which may differ from this panel's own tactplanId prop
  // right after creation, before navigation has actually landed).
  onNotifyStakeholders?: (tactplanId: string, opsMessage: string, otherTeamsMessage: string) => void;
  // 'panel' = the original fixed right-hand #chatPanel (request-detail view).
  // 'inline' = fills whatever parent it's given (the landing page's
  // .hm-agent grid column) — same component, same store/thread, so the
  // conversation is literally the same session on both pages instead of
  // two different chats that happen to look similar.
  variant?: 'panel' | 'inline';
}) {
  const currentPersona = useSessionStore((s) => s.currentPersona);
  // One real thread per (persona, project) — landing gets its own project
  // key instead of sharing whatever project happens to be open. Derived
  // straight from tactplanId rather than a separate prop: null (landing)
  // maps to LANDING_PROJECT, an open campaign maps to its own tactplanId.
  const projectKey = tactplanId || LANDING_PROJECT;
  const thread = useChatStore((s) => s.threads[currentPersona]?.[projectKey]) || [];
  const archives = useChatStore((s) => s.archives[currentPersona]?.[projectKey]) || [];
  const updateMessage = useChatStore((s) => s.updateMessage);
  const startNewChat = useChatStore((s) => s.startNewChat);
  const restoreSession = useChatStore((s) => s.restoreSession);
  const relocateThreadToNewProject = useChatStore((s) => s.relocateThreadToNewProject);
  const clearNewCampaignDraft = useChatStore((s) => s.clearNewCampaignDraft);
  const clearAllChats = useChatStore((s) => s.clearAllChats);
  const discardAndSwitchToProject = useChatStore((s) => s.discardAndSwitchToProject);
  // Guided Mode — an explicit toggle rather than something that only ever
  // shows up if the model happens to offer it: while on, every turn tells
  // the agent to ask exactly one thing at a time and lean on ask_choice.
  // Lives in the store (not local useState) so navigating away — e.g. the
  // auto-navigate right after creating a campaign — doesn't silently turn
  // it back off mid-conversation.
  const guidedMode = useChatStore((s) => s.guidedMode[currentPersona]) || false;
  const setGuidedModeStore = useChatStore((s) => s.setGuidedMode);
  const setGuidedMode = useCallback((v: boolean) => setGuidedModeStore(currentPersona, v), [setGuidedModeStore, currentPersona]);
  // An existing project was identified mid-conversation on the landing
  // screen (the agent called open_campaign) — the messages spent figuring
  // out which project was meant are identification chatter, not real
  // content, so they're discarded rather than carried anywhere. Only
  // applies when the switch is actually FROM the landing thread; jumping
  // between two already-real project threads isn't this case.
  const handleOpenCampaign = useCallback(
    (targetTactplanId: string) => {
      if (projectKey === LANDING_PROJECT) discardAndSwitchToProject(currentPersona, LANDING_PROJECT);
      onOpenCampaign?.(targetTactplanId);
    },
    [projectKey, currentPersona, discardAndSwitchToProject, onOpenCampaign],
  );
  const { send, guidedModeRef } = useAgentFill(currentPersona, tactplanId, handleOpenCampaign, guidedMode, interviewData, onQuizAnswer, onNotifyStakeholders);
  // Auto-continues a New Campaign Intake right after Create Campaign is
  // clicked — that click is a client-side action with no message attached,
  // so without this the agent had no way to know the campaign existed until
  // the user happened to type something next, which read as the
  // conversation just stopping mid-flow instead of finishing (notifying
  // stakeholders, asking the first Pre-planning question). Fires once, the
  // moment THIS campaign's own ChatPanel instance mounts with its sections
  // loaded — see pendingIntakeContinuations' own comment for why the flag
  // lives outside the persisted store.
  useEffect(() => {
    if (!tactplanId || !sections.length || !pendingIntakeContinuations.has(tactplanId)) return;
    pendingIntakeContinuations.delete(tactplanId);
    send('[[system:campaign_created]]', sections);
  }, [tactplanId, sections, send]);
  const [input, setInput] = useState('');
  // The server's /api/upload (PDF/Word/Excel -> text) already existed and
  // worked — nothing in the UI ever called it. A CSV/Excel upload is how
  // the CMA Metadata Sheet's "attach existing metadata instead of
  // re-typing it" path is meant to work.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Starts collapsed once there's actually scrollback to hide — persisted
  // history (useChatStore) means a returning user can have dozens of old
  // messages waiting; those stay tucked behind this toggle instead of
  // dumping the whole session on screen at once.
  const [scrollbackOpen, setScrollbackOpen] = useState(false);
  // Separate from the above: this is the "New chat" archive list — past
  // conversations this persona ended (via New chat), not just older
  // messages within the CURRENT one. Collapsed by default, same reasoning.
  const [archivesOpen, setArchivesOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const guidedRowRef = useRef<HTMLDivElement>(null);
  const guidedSwitchRef = useRef<HTMLButtonElement>(null);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputOverflowing, setInputOverflowing] = useState(false);
  const hiddenCount = Math.max(0, thread.length - VISIBLE_TAIL);
  const visibleThread = scrollbackOpen ? thread : thread.slice(hiddenCount);

  // Re-measure on every keystroke (and when the expand/collapse toggle
  // flips) — textarea auto-height has no native equivalent, so height is
  // driven from scrollHeight by hand, capped at whichever ceiling is
  // currently active.
  //
  // Floored at one line: scrollHeight can genuinely read 0 if this runs
  // while the panel is mid-transition at width:0 (chat-full/form-full
  // toggle, or the very first paint) — Math.min(0, cap) then bakes in
  // height:0px, and since this effect only re-runs on [input,
  // inputExpanded], nothing ever fixes it if the user doesn't happen to
  // type before that measurement (a 0-height textarea is present but has
  // no clickable area at all — looks exactly like "the chat box doesn't
  // respond to clicks").
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const full = el.scrollHeight;
    setInputOverflowing(full > INPUT_COLLAPSED_MAX);
    const cap = inputExpanded ? INPUT_EXPANDED_MAX : INPUT_COLLAPSED_MAX;
    el.style.height = `${Math.max(INPUT_LINE_PX, Math.min(full, cap))}px`;
  }, [input, inputExpanded]);

  // Re-measure whenever the panel itself resizes (chat/split/form toggle,
  // window resize) — this is what actually fixes a stale 0px measurement
  // rather than just flooring the symptom: ResizeObserver catches the
  // panel becoming visible/wide again and re-runs the same measurement.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      el.style.height = 'auto';
      const full = el.scrollHeight;
      if (full > 0) {
        setInputOverflowing(full > INPUT_COLLAPSED_MAX);
        el.style.height = `${Math.max(INPUT_LINE_PX, Math.min(full, inputExpanded ? INPUT_EXPANDED_MAX : INPUT_COLLAPSED_MAX))}px`;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The composer shell's top-right step-down (see .cp-composer-shell) has
  // to land right after the Guided Mode switch, wherever that actually
  // renders — not a hardcoded offset, since "Guided mode" label width and
  // panel width both vary. Measured against the shell's own left edge and
  // written as a CSS var the clip-path reads, re-measured on resize.
  useEffect(() => {
    const shell = composerShellRef.current;
    const sw = guidedSwitchRef.current;
    const row = guidedRowRef.current;
    if (!shell || !sw || !row || typeof ResizeObserver === 'undefined') return;
    // Clamped well above the left chamfer's own 16px — a measurement taken
    // before layout has actually settled (seen on mount, before the switch
    // has a real position yet) can read as 0, which produces a notch to
    // the LEFT of the chamfer and a self-intersecting, invisible clip-path.
    const measure = () => {
      const shellRect = shell.getBoundingClientRect();
      const swRect = sw.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const notchY = Math.max(20, Math.round(rowRect.bottom - shellRect.top));
      // The 45° run (notchX to notchX+notchY) has to actually fit before
      // the right edge, or the diagonal's end point lands past the box.
      const notchX = Math.min(
        Math.max(60, Math.round(swRect.right - shellRect.left - 4)),
        Math.round(shellRect.width) - notchY - 8,
      );
      shell.style.setProperty('--guided-notch-x', `${notchX}px`);
      shell.style.setProperty('--guided-notch-y', `${notchY}px`);
    };
    // A single rAF got close but not exact in testing (still mid-transition
    // one frame in on some routes) — rAF handles the common case, the
    // timeout is a second pass once layout/fonts have genuinely settled.
    requestAnimationFrame(measure);
    const settleTimer = setTimeout(measure, 150);
    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    ro.observe(sw);
    ro.observe(row);
    return () => {
      clearTimeout(settleTimer);
      ro.disconnect();
    };
  }, []);

  // Was a one-off scroll fired only right after the user's own message —
  // missed every later update in the same turn (reasoning text, a tool
  // result, the final reply streaming in), and missed the panel simply
  // mounting fresh with existing history already in it (e.g. right after
  // the auto-navigate onCreateCampaign does — the new page's chat panel is
  // a brand-new mount, so the browser's own default scroll position — top
  // — is what showed, reading as "the chat scrolled to the top"). Keyed on
  // the thread itself so it re-fires on every add/update, not just sends.
  useEffect(() => {
    // A single rAF wasn't enough on a fresh mount with existing history
    // already in the thread — scrollHeight still read short of the real
    // bottom (same class of timing issue as the composer notch
    // measurement above). rAF covers the common case; the timeout is a
    // second pass once layout has genuinely settled.
    const scrollToBottom = () => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    };
    const raf = requestAnimationFrame(scrollToBottom);
    const settleTimer = setTimeout(scrollToBottom, 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
    };
  }, [thread]);

  const handleSendText = (text: string) => {
    if (!text.trim()) return;
    setInput('');
    setInputExpanded(false);
    send(text, sections);
  };
  const handleSend = () => handleSendText(input);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status}).`);
      handleSendText(`Uploaded file "${body.filename}":\n\n${body.text}`);
    } catch (err) {
      handleSendText(`(File upload failed: ${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setUploading(false);
    }
  };

  const persona = PERSONAS[currentPersona];

  const archiveRows = archives.map((a) => {
    // A pointer left behind after its content moved to live under a
    // project (see relocateThreadToNewProject) — not really "a past
    // conversation to restore here"; clicking it takes you to that
    // project instead, where the real, continuing thread actually lives.
    if (a.movedToProject) {
      return (
        <button
          key={a.id}
          className="cp-archive-row"
          onClick={() => {
            onOpenCampaign?.(a.movedToProject!);
            setArchivesOpen(false);
          }}
        >
          <span className="cp-archive-label">{a.movedToLabel || a.movedToProject} →</span>
          <span className="cp-archive-meta">Continued in {a.movedToProject} · {new Date(a.startedAt).toLocaleDateString()}</span>
        </button>
      );
    }
    const firstUserMsg = a.messages.find((m) => m.role === 'user' && m.text)?.text;
    const label = firstUserMsg || a.messages.find((m) => m.text)?.text || 'Conversation';
    return (
      <button
        key={a.id}
        className="cp-archive-row"
        onClick={() => {
          restoreSession(currentPersona, projectKey, a.id);
          setArchivesOpen(false);
          setScrollbackOpen(false);
        }}
      >
        <span className="cp-archive-label">{label}</span>
        <span className="cp-archive-meta">
          {a.messages.length} message{a.messages.length === 1 ? '' : 's'} · {new Date(a.startedAt).toLocaleDateString()}
        </span>
      </button>
    );
  });

  return (
    <div className={`chat-panel ${variant === 'inline' ? 'chat-panel-inline' : ''}`} id={variant === 'panel' ? 'chatPanel' : undefined}>
      {/* Width-animates open only in full-screen chat mode (see the
          data-details/data-landing-layout "collapsed" rules) — same New
          chat / History content as the header dropdown below, just laid
          out ChatGPT-sidebar style once there's room for it, sliding in
          rather than popping. */}
      <div className="cp-sidebar" id="cpSidebar">
        <button
          className="cp-sidebar-new"
          onClick={() => {
            startNewChat(currentPersona, projectKey);
            setScrollbackOpen(false);
          }}
        >
          + New chat
        </button>
        <div className="cp-sidebar-list">{archiveRows}</div>
      </div>
      <div className="cp-main">
        <div className="cp-head" id="cpHead">
          <div className="cp-head-actions">
            <button
              className="cp-head-btn"
              title="Start a new chat"
              onClick={() => {
                startNewChat(currentPersona, projectKey);
                setScrollbackOpen(false);
              }}
            >
              + New chat
            </button>
            {/* Shown whenever there's ANYTHING to act on — archives OR a
                live thread. Gating this on archives alone made the panel's
                only "clear all history" control unreachable for exactly the
                people who needed it: someone whose chats are all live
                threads that were never archived had no History button to
                open in the first place. */}
            {(archives.length > 0 || thread.length > 0) && (
              <button className={`cp-head-btn ${archivesOpen ? 'on' : ''}`} title="Past conversations" onClick={() => setArchivesOpen((v) => !v)}>
                History{archives.length > 0 ? ` (${archives.length})` : ''}
              </button>
            )}
          </div>
        </div>
        {archivesOpen && (
          <div className="cp-archives">
            {archiveRows}
            {/* Wipes conversations for every persona and project, not just
                this one — the "start clean" escape hatch, since clearing
                storage by hand doesn't help if another open tab still holds
                the old state in memory and re-persists it. */}
            <button
              className="cp-archive-row cp-archive-clear"
              onClick={() => {
                if (!confirm('Clear all chat history for every persona and campaign? This cannot be undone.')) return;
                clearAllChats();
                setArchivesOpen(false);
                setScrollbackOpen(false);
              }}
            >
              <span className="cp-archive-label">Clear all chat history</span>
              <span className="cp-archive-meta">Every persona and campaign · can't be undone</span>
            </button>
          </div>
        )}
        <div className="cp-body" id="chatBody" ref={bodyRef}>
        {thread.length === 0 && (
          <div className="cp-empty">
            <div className="cp-av" style={{ margin: '0 auto 14px' }}>✦</div>
            <h4>Hello, {persona.name}</h4>
            <p>Would you like to get started filling out the form, see what's pending with you, or something else?</p>
            <div className="cp-suggest">
              <button onClick={() => handleSendText('Get started filling out the form')}>Get started filling out the form</button>
              {/* Answered from real, computed data (see MY PENDING ITEMS in
                  the system prompt) — mineTo/actionText across the whole
                  portfolio, not the model guessing — same on the Dashboard
                  and inside any open campaign's chat, since both mount this
                  same ChatPanel. */}
              <button onClick={() => handleSendText("What's pending with me?")}>What's pending with me</button>
              <button onClick={() => document.getElementById('chatInput')?.focus()}>Something else</button>
            </div>
          </div>
        )}
        {hiddenCount > 0 && (
          <button className="cp-history-toggle" onClick={() => setScrollbackOpen((v) => !v)}>
            <span className="cp-history-chev" aria-hidden="true">{scrollbackOpen ? '▾' : '▸'}</span>
            {scrollbackOpen ? 'Hide earlier messages' : `Show ${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )}
        {visibleThread.map((m) => {
          if (m.kind === 'proposal' && m.proposal) {
            const p = m.proposal;
            return (
              <div className="msg bot" key={m.id}>
                <div className="m-card">
                  <div className="foot" style={{ marginBottom: 6 }}>
                    Proposed for <b>{p.sectionName}</b>
                  </div>
                  {p.assignments.map((a) => (
                    <div className="m-row" key={a.fieldId}>
                      <span>{a.fieldLabel || a.fieldId}</span>
                      <b>{a.value}</b>
                    </div>
                  ))}
                  {!p.resolved && (
                    <div className="foot" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => {
                          onApplyProposal(p.assignments.map((a) => ({ fieldId: a.fieldId, value: a.value })));
                          updateMessage(currentPersona, projectKey, m.id, { proposal: { ...p, resolved: 'confirmed' } });
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => updateMessage(currentPersona, projectKey, m.id, { proposal: { ...p, resolved: 'cancelled' } })}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {p.resolved && <div className="foot">{p.resolved === 'confirmed' ? '✓ Applied to the form.' : 'Cancelled — nothing applied.'}</div>}
                </div>
              </div>
            );
          }
          if (m.kind === 'choice' && m.choice) {
            const c = m.choice;
            return (
              <div className="msg bot" key={m.id}>
                <div>{c.question}</div>
                <div className="cp-choice-options">
                  {c.options.map((opt) => (
                    <button
                      key={opt}
                      disabled={!!c.answered}
                      style={c.answered && c.answered !== opt ? { opacity: 0.5 } : undefined}
                      onClick={() => {
                        updateMessage(currentPersona, projectKey, m.id, { choice: { ...c, answered: opt } });
                        handleSendText(opt);
                      }}
                    >
                      {c.answered === opt ? '✓ ' : ''}
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (m.kind === 'new_campaign_proposal' && m.newCampaign) {
            const nc = m.newCampaign;
            const rows: [string, string][] = [
              ...(nc.tactplanId ? ([['TactPlan ID', nc.tactplanId]] as [string, string][]) : []),
              ['Brand', nc.brand],
              ['Indication', nc.indication],
              ['Branded / Unbranded', nc.brandedUnbranded],
              ['Audience', nc.audience],
              ['Asset Scope', nc.assetScope],
              ['Campaign Name', nc.campaignName],
              ['Channels', nc.channels.join(' + ') || '—'],
              ['Agency', nc.agency],
            ];
            return (
              <div className="msg bot" key={m.id}>
                <div className="m-card m-card-campaign">
                  <div className="m-card-title">New campaign request</div>
                  <div className="msg-table-wrap">
                    <table>
                      <tbody>
                        {rows.map(([label, value]) => (
                          <tr key={label}>
                            <td>{label}</td>
                            <td><b>{value}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!nc.resolved && (
                    <div className="foot" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn-primary btn-sm"
                        onClick={async () => {
                          // Baked into the thread BEFORE relocating it — once
                          // the thread moves to the new project's key, this
                          // message only exists under that key, so updating
                          // it against the old projectKey afterward would hit
                          // nothing.
                          updateMessage(currentPersona, projectKey, m.id, { newCampaign: { ...nc, resolved: 'confirmed' } });
                          const newTactplanId = await onCreateCampaign?.({
                            tactplanId: nc.tactplanId,
                            agency: nc.agency,
                            brand: nc.brand,
                            indication: nc.indication,
                            brandedUnbranded: nc.brandedUnbranded,
                            audience: nc.audience,
                            assetScope: nc.assetScope,
                            campaignName: nc.campaignName,
                            channels: nc.channels,
                          });
                          // The whole live thread WAS the intake conversation
                          // — none of it is discardable — so it becomes the
                          // new project's own thread, with a pointer left on
                          // the landing screen instead of the full transcript.
                          if (newTactplanId && projectKey === LANDING_PROJECT) {
                            relocateThreadToNewProject(currentPersona, projectKey, newTactplanId, nc.campaignName);
                          }
                          // Intake's done — clear its draft so a stray
                          // leftover value never bleeds into the NEXT New
                          // Campaign Intake run in this same (persona, project).
                          clearNewCampaignDraft(currentPersona, newTactplanId || projectKey);
                          // The freshly mounted ChatPanel on the new
                          // campaign's own page (after navigation lands)
                          // picks this up and auto-continues — see the
                          // effect below — instead of the conversation
                          // just sitting there until the user happens to
                          // type something.
                          if (newTactplanId) pendingIntakeContinuations.add(newTactplanId);
                        }}
                      >
                        Create campaign
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          updateMessage(currentPersona, projectKey, m.id, { newCampaign: { ...nc, resolved: 'cancelled' } });
                          clearNewCampaignDraft(currentPersona, projectKey);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {nc.resolved && <div className="foot">{nc.resolved === 'confirmed' ? '✓ Campaign created.' : 'Cancelled — nothing created.'}</div>}
                </div>
              </div>
            );
          }
          return (
            <div className={`msg ${m.role}`} key={m.id}>
              {m.role === 'bot' ? renderMarkdown(m.text || '') : m.text}
            </div>
          );
        })}
      </div>
      {/* Floats over the tail of the message list (position:absolute inside
          the panel, which is already the containing block) with a blurred
          backdrop — not pushed into the normal flow above/below the thread.
          "On top" meant this, not literally relocated in DOM order (that
          version also broke click/type — went back to the composer being
          last in the DOM like it always was, just visually overlaid now). */}
      <div className="cp-input-card" id="cpAssistantInputCard">
        <div className="cp-composer-shell" ref={composerShellRef}>
          <div className="cp-guided-row" ref={guidedRowRef}>
            <span className="cp-guided-label">Guided mode</span>
            <button
              ref={guidedSwitchRef}
              type="button"
              role="switch"
              aria-checked={guidedMode}
              className={`cp-guided-switch ${guidedMode ? 'on' : ''}`}
              title="Guided mode — ask one question at a time, with clickable options where possible"
              onClick={() => {
                const next = !guidedMode;
                // Written synchronously, ahead of the store update below —
                // setGuidedMode(next) doesn't take effect in THIS closure
                // until React re-renders, but handleSendText fires before
                // that happens, in the same tick. Without this, that very
                // first "let's go one question at a time" turn went out
                // with the OLD guidedMode value, so the server correctly
                // downgraded its own response's ask_choice per that stale
                // flag — the toggle visually flipped on, but the first
                // question after it still came back as plain text with no
                // buttons, reading as if guided mode silently didn't work.
                guidedModeRef.current = next;
                setGuidedMode(next);
                if (next) handleSendText("Let's go one question at a time — guide me through it and give me clickable choices where you can, instead of asking for several things at once.");
              }}
            >
              <span className="cp-guided-switch-thumb" />
            </button>
          </div>
          <div className="cp-input">
          <textarea
            ref={textareaRef}
            id="chatInput"
            rows={1}
            placeholder="Ask anything or paste content…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="cp-input-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleFileUpload(file);
              }}
            />
            <button
              className="cp-input-expand"
              type="button"
              title="Attach a file — PDF, Word, or Excel/CSV"
              aria-label="Attach a file"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <svg viewBox="0 0 16 16" width="13" height="13" className="cp-spin" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M8 2a6 6 0 1 1-6 6" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5.5 6.2 10.3a2 2 0 0 1-2.8-2.8L8.5 2.3a3 3 0 0 1 4.2 4.2L7.4 11.8" />
                </svg>
              )}
            </button>
            {inputOverflowing && (
              <button
                className="cp-input-expand"
                title={inputExpanded ? 'Collapse to 7 lines' : 'Expand'}
                aria-label={inputExpanded ? 'Collapse input' : 'Expand input'}
                onClick={() => setInputExpanded((v) => !v)}
              >
                {inputExpanded ? (
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 6 6 10M6 6.8V10h3.2M6 10 10 6M10 9.2V6H6.8" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 5.5h-3v3M9.5 10.5h3v-3M3.5 3.5l3.3 3.3M12.5 12.5l-3.3-3.3" />
                  </svg>
                )}
              </button>
            )}
            <span className="cp-input-hint">Enter to send · Shift+Enter for a new line</span>
            <button className="send" title="Send" aria-label="Send" onClick={handleSend}>
              <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3.2 20.5 19c.35.66-.34 1.38-1.02 1.05L12 16.7l-7.48 3.35c-.68.33-1.37-.39-1.02-1.05L12 3.2Z" />
              </svg>
            </button>
          </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
