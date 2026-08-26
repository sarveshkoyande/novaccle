import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { PERSONAS, VB_APPROVER_KEYS, isApproverPersona, type PersonaKey } from '../personas';
import { useVisioStore, VB_CLARIFY_QUESTIONS, DEFAULT_VISIO_STATE } from '../stores/useVisioStore';

// The form-pane half of Flow Design — purely a VIEW onto useVisioStore.
// The clarify Q&A that used to live here now happens as chat cards in
// ChatPanel (Solution Architect persona only, see useVisioClarifyChat) —
// this panel just shows where that's at: waiting for inputs, generating,
// or the resulting PDF + approval workflow + version history.
function authorName(id: string): { name: string; color: string } {
  const p = PERSONAS[id as PersonaKey];
  return p ? { name: p.name, color: p.color } : { name: id, color: 'var(--ink3)' };
}

export default function VisioBuilderPanel({ tactplanId, currentPersona }: { tactplanId: string; currentPersona: PersonaKey }) {
  const queryClient = useQueryClient();
  const state = useVisioStore((s) => s.byCampaign[tactplanId] ?? DEFAULT_VISIO_STATE);
  const answerClarifyAction = useVisioStore((s) => s.answerClarify);
  const startGeneratingAction = useVisioStore((s) => s.startGenerating);
  const generateVisioAction = useVisioStore((s) => s.generateVisio);
  const approveAction = useVisioStore((s) => s.approve);
  const requestChangesAction = useVisioStore((s) => s.requestChanges);
  const resendAction = useVisioStore((s) => s.resend);

  const [showSuggestBox, setShowSuggestBox] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [pdfZoom, setPdfZoom] = useState<'fit' | number>('fit');

  const { ready, generating, sent, decisions, versions, answers } = state;
  const answeredCount = Object.keys(answers).length;
  const isApprover = isApproverPersona(currentPersona);
  const canAuthor = currentPersona === 'solutionArchitect';

  // Answering here (instead of in chat) writes straight into the same
  // useVisioStore state the chat clarify cards use — both surfaces read
  // and write the identical (persisted, per-campaign) answers, so
  // whichever one the Solution Architect happens to use, the other stays
  // in sync automatically.
  function answerClarify(qid: string, value: string, label: string) {
    answerClarifyAction(tactplanId, qid, value, label);
  }

  async function generate() {
    if (state.generating || state.ready) return;
    startGeneratingAction(tactplanId);
    await new Promise((r) => setTimeout(r, 2200));
    generateVisioAction(tactplanId, 'solutionArchitect');
    const names = VB_APPROVER_KEYS.map((k) => PERSONAS[k].name).join(' and ');
    await api.addComment({
      tactplanId,
      sectionId: 'flow',
      authorPersona: currentPersona,
      body: `The Flow for this campaign is ready for your review — sent for approval to ${names}.`,
      mentions: VB_APPROVER_KEYS,
      source: 'agent',
    });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function approve() {
    const a = authorName(currentPersona);
    approveAction(tactplanId, currentPersona);
    setShowSuggestBox(false);
    await api.addComment({
      tactplanId,
      sectionId: 'flow',
      authorPersona: currentPersona,
      body: `${a.name} approved the Flow.`,
      mentions: ['solutionArchitect'],
      source: 'agent',
    });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function submitSuggestion() {
    const note = suggestText.trim();
    if (!note) return;
    const a = authorName(currentPersona);
    requestChangesAction(tactplanId, currentPersona, note);
    setShowSuggestBox(false);
    setSuggestText('');
    await api.addComment({
      tactplanId,
      sectionId: 'flow',
      authorPersona: currentPersona,
      body: `${a.name} requested changes to the Flow: "${note}"`,
      mentions: ['solutionArchitect'],
      source: 'agent',
    });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function resend() {
    resendAction(tactplanId, 'solutionArchitect');
    await api.addComment({
      tactplanId,
      sectionId: 'flow',
      authorPersona: currentPersona,
      body: 'The Flow was updated and re-sent for approval.',
      mentions: VB_APPROVER_KEYS,
      source: 'agent',
    });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  function pdfFrameSrc() {
    const zoomParam = pdfZoom === 'fit' ? 'view=FitH' : `zoom=${pdfZoom}`;
    return `/visio-cropped.pdf#toolbar=0&${zoomParam}`;
  }
  function zoomBy(delta: number) {
    setPdfZoom((z) => (z === 'fit' ? 100 + delta : Math.max(25, Math.min(400, z + delta))));
  }

  if (!ready) {
    const nextIdx = VB_CLARIFY_QUESTIONS.findIndex((q) => !(q.id in answers));
    const allAnswered = nextIdx === -1;
    return (
      <div className="vb-root">
        <div className="vb-empty-overlay" style={{ position: 'static', padding: '48px 16px' }}>
          {generating ? (
            <>
              <span>Generating diagram…</span>
              <span>The Flow is being put together from the Solution Architect's answers.</span>
            </>
          ) : canAuthor ? (
            <>
              <span>Answer these to generate the Flow ({answeredCount}/{VB_CLARIFY_QUESTIONS.length})</span>
              <span>Same questions as in chat — answering here keeps both in sync.</span>
              <div className="vb-cq-list">
                {VB_CLARIFY_QUESTIONS.map((q) => {
                  const answered = answers[q.id];
                  const isNext = q.id === (allAnswered ? undefined : VB_CLARIFY_QUESTIONS[nextIdx].id);
                  if (!answered && !isNext) return null;
                  return (
                    <div className="msg bot vb-cq" key={q.id}>
                      <div className="vb-cq-q">{q.q}</div>
                      <div className="vb-cq-opts">
                        {q.options.map((o) => (
                          <button
                            key={o.value}
                            className="vb-cq-opt"
                            disabled={!!answered}
                            style={answered && answered.value !== o.value ? { opacity: 0.5 } : undefined}
                            onClick={() => answerClarify(q.id, o.value, o.label)}
                          >
                            <span className="vb-cq-opt-label">
                              {answered?.value === o.value ? '✓ ' : ''}
                              {o.label}
                            </span>
                            {o.recommended && !answered && <span className="vb-cq-rec">Recommended</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {allAnswered && (
                <button className="btn-primary" onClick={generate}>
                  Generate Flow
                </button>
              )}
            </>
          ) : (
            <>
              <span>Waiting for inputs</span>
              <span>
                {`${PERSONAS.solutionArchitect.name} (Solution Architect) is answering clarifying questions (${answeredCount}/${VB_CLARIFY_QUESTIONS.length} so far) before the Flow can be generated.`}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="vb-root">
      <div className="vb-toolbar">
        <div className="vb-tool-group">
          <button className="vb-tool" onClick={() => zoomBy(-10)}>
            −
          </button>
          <span className="vb-zoom-pct">{pdfZoom === 'fit' ? 'Fit' : `${pdfZoom}%`}</span>
          <button className="vb-tool" onClick={() => zoomBy(10)}>
            +
          </button>
        </div>
        <a className="vb-pdf-action" href="/visio-cropped.pdf" download>
          Download
        </a>
      </div>
      <div className="vb-pdf-wrap">
        <iframe key={pdfZoom} className="vb-pdf-frame" src={pdfFrameSrc()} title="Flow diagram" />
      </div>

      <div className="vb-approval-panel">
        <div className="vb-approval-status">
          {sent && isApprover && (() => {
            const mine = decisions[currentPersona] || { status: 'pending', comment: '' };
            if (mine.status === 'pending') {
              return (
                <>
                  <span className="sm-status-pill sm-status-prog">Your review is pending</span>
                  <div className="vb-approval-actions">
                    <button className="btn-primary" onClick={approve}>
                      Approve
                    </button>
                    <button className="btn-ghost" onClick={() => setShowSuggestBox((v) => !v)}>
                      Suggest modifications
                    </button>
                  </div>
                  {showSuggestBox && (
                    <div className="vb-suggest-box">
                      <textarea className="ta" placeholder="What needs to change?" value={suggestText} onChange={(e) => setSuggestText(e.target.value)} />
                      <button className="btn-primary" onClick={submitSuggestion}>
                        Submit
                      </button>
                    </div>
                  )}
                </>
              );
            }
            if (mine.status === 'approved') {
              return <span className="sm-status-pill sm-status-done">You approved this</span>;
            }
            return (
              <>
                <span className="sm-status-pill sm-status-mine">You requested changes</span>
                <span className="vb-approval-note">&quot;{mine.comment}&quot;</span>
              </>
            );
          })()}

          {sent && !isApprover && (
            <div className="vb-approver-rows">
              {VB_APPROVER_KEYS.map((k) => {
                const d = decisions[k] || { status: 'pending', comment: '' };
                const a = PERSONAS[k];
                return (
                  <div className="vb-approver-row" key={k}>
                    <span className="vb-approver-name" style={{ color: a.color }}>
                      {a.name}
                    </span>
                    {d.status === 'approved' && <span className="sm-status-pill sm-status-done">Approved</span>}
                    {d.status === 'changes_requested' && <span className="sm-status-pill sm-status-mine">Changes requested</span>}
                    {d.status === 'pending' && <span className="sm-status-pill sm-status-prog">Pending</span>}
                    {d.status === 'changes_requested' && <span className="vb-approval-note">&quot;{d.comment}&quot;</span>}
                  </div>
                );
              })}
              {canAuthor && VB_APPROVER_KEYS.some((k) => decisions[k]?.status === 'changes_requested') && (
                <button className="btn-primary" onClick={resend}>
                  Resend for approval
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {versions.length > 0 && (
        <div className="vb-version-history">
          <div className="vb-version-history-head">Version history</div>
          {[...versions].reverse().map((v) => {
            const a = authorName(v.authorId);
            const d = new Date(v.ts);
            const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            return (
              <div className="vb-version-row" key={v.v}>
                <span className="vb-version-num">v{v.v}</span>
                <div className="vb-version-body">
                  <div className="vb-version-change">{v.change}</div>
                  <div className="vb-version-meta">
                    <span style={{ color: a.color }}>{a.name}</span> · {when}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
