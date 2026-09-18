import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { PERSONAS, VB_APPROVER_KEYS, isApproverPersona, type PersonaKey } from '../personas';
import { useVisioStore, DEFAULT_VISIO_STATE } from '../stores/useVisioStore';
import FlowPlannerPanel from './FlowPlannerPanel';

// The form-pane half of Flow Design — purely a VIEW onto useVisioStore's
// approval lifecycle around whatever FlowPlannerPanel generates (real,
// SOP-driven generation straight from the campaign's own field data — no
// scripted clarify Q&A gate in front of it anymore).
function authorName(id: string): { name: string; color: string } {
  const p = PERSONAS[id as PersonaKey];
  return p ? { name: p.name, color: p.color } : { name: id, color: 'var(--ink3)' };
}

export default function VisioBuilderPanel({ tactplanId, currentPersona }: { tactplanId: string; currentPersona: PersonaKey }) {
  const queryClient = useQueryClient();
  const state = useVisioStore((s) => s.byCampaign[tactplanId] ?? DEFAULT_VISIO_STATE);
  const generateVisioAction = useVisioStore((s) => s.generateVisio);
  const approveAction = useVisioStore((s) => s.approve);
  const requestChangesAction = useVisioStore((s) => s.requestChanges);
  const resendAction = useVisioStore((s) => s.resend);

  const [showSuggestBox, setShowSuggestBox] = useState(false);
  const [suggestText, setSuggestText] = useState('');

  const { sent, decisions, versions } = state;
  const isApprover = isApproverPersona(currentPersona);
  const canAuthor = currentPersona === 'solutionArchitect';

  // Called by FlowPlannerPanel once it has a real generated diagram — moves
  // the approval lifecycle forward the same way the old scripted "Generate
  // Flow" button used to, minus the fake questions in front of it.
  async function onDiagramGenerated() {
    generateVisioAction(tactplanId, currentPersona);
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

  return (
    <div className="vb-root">
      <FlowPlannerPanel tactplanId={tactplanId} canAuthor={canAuthor} onGenerated={onDiagramGenerated} />

      {!sent && !canAuthor && (
        <div className="vb-empty-overlay" style={{ position: 'static', padding: '24px 16px' }}>
          <span>Waiting on the Solution Architect</span>
          <span>{`${PERSONAS.solutionArchitect.name} (Solution Architect) hasn't generated the Flow for this campaign yet.`}</span>
        </div>
      )}

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
