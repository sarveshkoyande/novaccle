import { useTimelineStore, DEFAULT_TIMELINE_STATE, type SeqStatus } from '../stores/useTimelineStore';
import { PERSONAS, type PersonaKey } from '../personas';

// The real per-campaign Timeline tab — a lead-time sequence over the app's own
// sections (BU Setup, Source Details, Journey Details, Email Details, Flow
// Design, Execution Handoff — no invented activity names), with a Gantt
// overview, a working Pause Project control, and cascading close dates.
// Replaces the earlier reuse of the standalone Calendar page's
// GanttTimeline/PlanMilestone data, which named generic prototype
// activities (Discovery, CPF, Journey Build, ...) that don't correspond to
// anything in this app.

function fmtShort(d: Date) {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function parseISO(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function FlowTimelinePanel({ tactplanId, currentPersona }: { tactplanId: string; currentPersona: PersonaKey }) {
  const state = useTimelineStore((s) => s.byCampaign[tactplanId] ?? DEFAULT_TIMELINE_STATE);
  const setStartDate = useTimelineStore((s) => s.setStartDate);
  const setTat = useTimelineStore((s) => s.setTat);
  const togglePause = useTimelineStore((s) => s.togglePause);

  const actorName = PERSONAS[currentPersona]?.name || currentPersona;
  const start = parseISO(state.startDate);

  // Cascade: each item starts the day after the previous one ends.
  let cursor = start;
  const ranges = state.items.map((item) => {
    const itemStart = cursor;
    const itemEnd = addDays(itemStart, item.tat - 1);
    cursor = addDays(itemEnd, 1);
    return { ...item, start: itemStart, end: itemEnd };
  });
  const closeDate = ranges.length ? ranges[ranges.length - 1].end : start;
  const totalTat = state.items.reduce((sum, i) => sum + i.tat, 0);
  const totalSpanDays = Math.max(1, Math.round((closeDate.getTime() - start.getTime()) / 86400000) + 1);

  const doneCount = state.items.filter((i) => i.status === 'done').length;
  const pct = state.items.length ? Math.round((doneCount / state.items.length) * 100) : 0;
  const today = new Date();
  const daysElapsed = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  const daysRemaining = Math.max(0, Math.round((closeDate.getTime() - today.getTime()) / 86400000));
  const todayOffsetPct = Math.min(100, Math.max(0, ((today.getTime() - start.getTime()) / 86400000 / totalSpanDays) * 100));

  const statusLabel: Record<SeqStatus, string> = { done: 'Completed', active: 'In progress', pending: 'Pending' };

  return (
    <div className="tl-root">
      <div className="tl-card">
        <div className="tl-card-h">
          <h3>Flow Sequence</h3>
          <span className="tl-count">{state.items.length} flows</span>
        </div>

        <div className="tl-meta">
          <div className="tl-meta-item">
            <label>Project Start Date</label>
            <input type="date" value={state.startDate} onChange={(e) => setStartDate(tactplanId, e.target.value)} disabled={state.paused} />
          </div>
          <div className="tl-meta-item">
            <label>Total Lead Time</label>
            <div className="tl-meta-val">{totalTat} business days</div>
          </div>
          <div className="tl-meta-item">
            <label>Estimated Close Date</label>
            <div className="tl-meta-val accent">{fmtShort(closeDate)}</div>
          </div>
        </div>

        <div className="tl-gantt">
          <div className="tl-gantt-body">
            <div className="tl-gantt-today" style={{ left: `calc(220px + (100% - 220px) * ${todayOffsetPct / 100})` }}>
              <span className="tl-gantt-today-tag">Today</span>
            </div>
            {ranges.map((r, idx) => {
              const leftPct = ((r.start.getTime() - start.getTime()) / 86400000 / totalSpanDays) * 100;
              const widthPct = (r.tat / totalSpanDays) * 100;
              return (
                <div className="tl-gantt-row" key={r.key}>
                  <div className="tl-gantt-label">
                    <span className="tl-idx">{idx + 1}</span>
                    {r.name}
                  </div>
                  <div className="tl-gantt-track">
                    <div
                      className={`tl-gantt-bar tl-${r.status}`}
                      style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 3)}%` }}
                      title={`${fmtShort(r.start)} – ${fmtShort(r.end)}`}
                    >
                      {fmtShort(r.start)}–{fmtShort(r.end)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="tl-legend">
          <span><i className="tl-done" />Completed</span>
          <span><i className="tl-active" />In progress</span>
          <span><i className="tl-pending" />Pending</span>
        </div>

        <div className="tl-list">
          {ranges.map((r, idx) => {
            const owner = PERSONAS[r.owner as PersonaKey];
            return (
              <div className={`tl-row tl-${r.status}`} key={r.key}>
                <div className="tl-row-idx">{idx + 1}</div>
                <div className="tl-row-name">
                  <span className="n">{r.name}</span>
                  <span className="owner">{owner ? `${owner.name} · ${owner.role}` : r.owner}</span>
                </div>
                <label className="tl-tat">
                  <input
                    type="number"
                    min={1}
                    value={r.tat}
                    disabled={state.paused}
                    onChange={(e) => setTat(tactplanId, r.key, Math.max(1, Number(e.target.value) || 1), actorName)}
                  />
                  <span>days</span>
                </label>
                <div className="tl-range">
                  <b>{fmtShort(r.start)}</b>
                  <span className="arrow">→</span>
                  <b className={r.status === 'active' ? 'due' : ''}>{fmtShort(r.end)}</b>
                </div>
                <span className={`tl-chip tl-chip-${r.status}`}>
                  <span className="dot" />
                  {statusLabel[r.status]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tl-rail">
        <div className="tl-card">
          <div className="tl-card-h">
            <h3>Project Timeline</h3>
          </div>
          <div className="tl-progress-wrap">
            <div className="tl-progress-label">
              <span><b>{doneCount}</b> of {state.items.length} flows complete</span>
              <span>{pct}%</span>
            </div>
            <div className="tl-progress-track">
              <div className="tl-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="tl-summary-row"><span>Start date</span><b>{fmtShort(start)}</b></div>
          <div className="tl-summary-row"><span>Close date</span><b>{fmtShort(closeDate)}</b></div>
          <div className="tl-summary-row"><span>Days elapsed</span><b>{daysElapsed}</b></div>
          <div className="tl-summary-row"><span>Days remaining</span><b className="accent">{daysRemaining}</b></div>
        </div>

        <div className="tl-card">
          <div className="tl-card-h">
            <h3>Project Controls</h3>
          </div>
          <div className={`tl-status-banner ${state.paused ? 'paused' : ''}`}>
            <span className="dot" />
            {state.paused ? 'Project is paused — lead time edits are locked' : 'Project is active — no pause in effect'}
          </div>
          <div className="tl-actions">
            <button className={`tl-btn ${state.paused ? 'tl-btn-resume' : 'tl-btn-pause'}`} onClick={() => togglePause(tactplanId, actorName)}>
              {state.paused ? (
                <>▶ Resume Project</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <rect x="6" y="5" width="4" height="14" />
                    <rect x="14" y="5" width="4" height="14" />
                  </svg>
                  Pause Project
                </>
              )}
            </button>
          </div>
        </div>

        <div className="tl-card">
          <div className="tl-card-h">
            <h3>Recent Activity</h3>
          </div>
          {state.activity.length === 0 && <div className="tl-activity-empty">No changes yet.</div>}
          {state.activity.map((a) => (
            <div className="tl-activity-row" key={a.id}>
              <span className="t">{new Date(a.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
