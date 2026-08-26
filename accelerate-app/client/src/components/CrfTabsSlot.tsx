// Ported (simplified) from index.html's renderCrfViewTabs() — the two-gate
// Pre-planning/Planning strip (per this session's earlier fix: gates must
// read the request's real currentPhase, not a milestone lookup). Per-CRF-#N
// sub-tabs aren't implemented in this pass. Conversations now opens the
// real project comment thread (CommentsDrawer) — was a disabled stub.
// The old per-page "Hide details"/"Show details" control was removed —
// the app-bar's chat/split/form layout toggle (useLayoutStore) already
// covers the same "collapse the form" job, so this was a second, redundant
// way to do the same thing.
// Redesigned: "Form details" eyebrow and the 1/2 step-number badges are
// gone, and the active gate is no longer marked with orange text/underline
// — this whole strip is now read as one mini-header, with the selected
// gate's OWN segment taking a grey background instead of a colored accent.
// Focus/Show all — the original's formScope simple/full switch
// (scopeToggleMarkup/"Show only what needs me") is back, as a real toggle
// instead of a text link, sitting left of Conversations.
const ICON_CONVO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 9a3 3 0 0 1-3 3H7l-4 3V5a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3z" />
    <path d="M18 8h.5A2.5 2.5 0 0 1 21 10.5v10l-3.5-2.5H12a2.5 2.5 0 0 1-2.5-2.5V15" />
  </svg>
);

export default function CrfTabsSlot({
  viewedGate,
  onSelectGate,
  scopeMode,
  onToggleScope,
  commentCount,
  commentsOpen,
  onToggleComments,
  showFlowDesign,
}: {
  viewedGate: 'preplan' | 'planning' | 'flow';
  onSelectGate: (gate: 'preplan' | 'planning' | 'flow') => void;
  scopeMode: 'focus' | 'all';
  onToggleScope: () => void;
  commentCount: number;
  commentsOpen?: boolean;
  onToggleComments: () => void;
  // Flow Design (the Visio Builder) only makes sense once the campaign has
  // enough context to diagram — same "past intake" gate the rest of the
  // stage-driven UI already uses.
  showFlowDesign?: boolean;
}) {
  return (
    <div className="crf-tabs-slot">
      <div className="crf-view-tabs">
        <div className="stage-track">
          <button className={`crf-tab ${viewedGate === 'preplan' ? 'active' : ''}`} onClick={() => onSelectGate('preplan')}>
            Pre-planning
          </button>
          <button className={`crf-tab ${viewedGate === 'planning' ? 'active' : ''}`} onClick={() => onSelectGate('planning')}>
            Planning
          </button>
          {showFlowDesign && (
            <button className={`crf-tab ${viewedGate === 'flow' ? 'active' : ''}`} onClick={() => onSelectGate('flow')}>
              Flow Design
            </button>
          )}
        </div>
      </div>
      <button className={`crf-scope-toggle ${scopeMode === 'focus' ? 'on' : ''}`} onClick={onToggleScope} title="Show only sections that need your input">
        {scopeMode === 'focus' ? 'Focus' : 'Show all'}
      </button>
      <button className={`crf-comments-trigger ${commentsOpen ? 'on' : ''}`} title="Project conversation" onClick={onToggleComments}>
        {ICON_CONVO}
        <span>Conversations</span>
        {commentCount > 0 && <span className="crf-comments-badge">{commentCount}</span>}
      </button>
    </div>
  );
}
