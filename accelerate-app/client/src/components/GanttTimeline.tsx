import { useRef } from 'react';
import { GANTT_WEEK_PX, ganttInitials, ganttWeekLabels, type GanttData } from '../data/ganttData';
import type { PlanMilestone } from '../api';

// Ported from index.html's ganttInnerHtml() — KPI header, toolbar (filters
// are non-functional selects in the original too), draggable week-grid
// timeline with colored category bars + milestone diamonds, legend, and a
// quick-actions row. Toolbar/Graph/Table tabs and quick actions are mock/
// no-op in the original as well, so a stub here is faithful, not a
// regression.
export default function GanttTimeline({
  data,
  onToast,
  milestone,
  onSaveMilestone,
}: {
  data: GanttData;
  onToast: (msg: string) => void;
  milestone: PlanMilestone | undefined;
  onSaveMilestone: (field: 'discoveryEta' | 'cpfEta' | 'crfEta', value: string) => void;
}) {
  const weeks = ganttWeekLabels();
  const trackWidth = weeks.length * GANTT_WEEK_PX;
  const scrollRef = useRef<HTMLDivElement>(null);

  const monthGroups: { month: string; count: number }[] = [];
  weeks.forEach((w) => {
    const last = monthGroups[monthGroups.length - 1];
    if (!last || last.month !== w.month) monthGroups.push({ month: w.month, count: 1 });
    else last.count++;
  });

  const todayLeft = data.todayWeek * GANTT_WEEK_PX;

  // Click-and-drag panning for the timeline, on top of the native scrollbar
  // a plain overflow-x:auto already gives — "slide" was asked for
  // explicitly, so this adds the grab-and-drag interaction itself.
  function onDragStart(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('button, select, .gantt-bar, .gantt-milestone')) return;
    const el = scrollRef.current;
    if (!el) return;
    const startX = e.pageX;
    const startScroll = el.scrollLeft;
    el.classList.add('dragging');
    function onMove(ev: MouseEvent) {
      if (el) el.scrollLeft = startScroll - (ev.pageX - startX);
    }
    function onUp() {
      el?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <>
      <div className="gantt-card">
        <div className="gantt-title-row">
          <div className="gantt-title-l">
            <h2>{data.title}</h2>
            <span className="gantt-status-badge planning">{data.statusBadge}</span>
          </div>
          <div className="gantt-kpis">
            <div className="gantt-kpi">
              <div className="gantt-kpi-label">Overall Progress</div>
              <div className="gantt-kpi-value">{data.progress}%</div>
              <div className="gantt-kpi-bar">
                <div className="gantt-kpi-bar-fill" style={{ width: `${data.progress}%` }} />
              </div>
            </div>
            <div className="gantt-kpi">
              <div className="gantt-kpi-label">Estimated Go Live</div>
              <div className="gantt-kpi-value">{data.golive}</div>
            </div>
            <div className="gantt-kpi">
              <div className="gantt-kpi-label">Confidence</div>
              <div className="gantt-kpi-value">
                {data.confidence}% <span className="gantt-conf-badge">{data.confidenceLabel}</span>
              </div>
            </div>
            <div className="gantt-kpi">
              <div className="gantt-kpi-label">Overall Status</div>
              <div className="gantt-kpi-value">
                <span className="gantt-status-dot" /> {data.overallStatus}
              </div>
            </div>
          </div>
        </div>
        <div className="gantt-meta-row">
          <span>
            <b>Brand:</b>
            {data.brand || '—'}
          </span>
          <span>
            <b>Channels:</b>
            {data.channels || '—'}
          </span>
        </div>
        {/* Real, saved-to-DB milestone ETAs (PlanMilestone via
            /api/plan-milestones) — the rest of this card is mock/derived,
            but these three fields round-trip to the server, matching the
            original's savePlanMilestone() PUT contract. */}
        <div className="gantt-meta-row">
          <label>
            <b>Discovery ETA:</b>{' '}
            <input
              type="date"
              defaultValue={milestone?.discoveryEta || ''}
              onBlur={(e) => onSaveMilestone('discoveryEta', e.target.value)}
            />
          </label>
          <label>
            <b>Journey ETA:</b>{' '}
            <input type="date" defaultValue={milestone?.cpfEta || ''} onBlur={(e) => onSaveMilestone('cpfEta', e.target.value)} />
          </label>
          <label>
            <b>Execution ETA:</b>{' '}
            <input type="date" defaultValue={milestone?.crfEta || ''} onBlur={(e) => onSaveMilestone('crfEta', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="gantt-card">
        <div className="gantt-toolbar">
          <select disabled>
            <option>{data.brand || 'All brands'}</option>
          </select>
          <select disabled>
            <option>Campaign Owner</option>
          </select>
          <select disabled>
            <option>Team</option>
          </select>
          <select disabled>
            <option>All Statuses</option>
          </select>
          <button className="btn-ghost btn-sm">Jul 2025 - Oct 2025</button>
          <button className="btn-ghost btn-sm">⚙ Filters</button>
          <div className="gantt-view-tabs">
            <button className="on">Timeline</button>
            <button onClick={() => onToast("Graph view isn't built yet.")}>Graph</button>
            <button onClick={() => onToast("Table view isn't built yet.")}>Table</button>
          </div>
        </div>
      </div>

      <div className="gantt-card">
        <div className="gantt-scroll" ref={scrollRef} onMouseDown={onDragStart}>
          <div className="gantt-body" style={{ position: 'relative', width: 260 + trackWidth }}>
            <div className="gantt-month-band">
              <div className="gantt-activities-head">Campaign Activities</div>
              <div className="gantt-weeks" style={{ width: trackWidth }}>
                {monthGroups.map((g, i) => (
                  <div key={i} className="gantt-month-cell" style={{ width: g.count * GANTT_WEEK_PX }}>
                    {g.month}
                  </div>
                ))}
              </div>
            </div>
            <div className="gantt-week-header">
              <div className="gantt-activities-head" />
              <div className="gantt-weeks" style={{ width: trackWidth }}>
                {weeks.map((w, i) => (
                  <div key={i} className="gantt-week-cell" style={{ width: GANTT_WEEK_PX }}>
                    {w.label}
                  </div>
                ))}
              </div>
            </div>
            {data.activities.map((a, i) => {
              const statusLabel =
                a.status === 'complete' ? 'Complete' : a.status === 'inprogress' ? 'In Progress' : a.status === 'milestone' ? '' : 'Not Started';
              const left = a.startW * GANTT_WEEK_PX;
              return (
                <div key={i} className="gantt-row">
                  <div className="gantt-activity-cell">
                    <span className="drag-h">⋮⋮</span>
                    <span className="gantt-owner-av">{ganttInitials(a.owner)}</span>
                    <span className="gantt-activity-name">{a.label}</span>
                    {statusLabel && <span className={`gantt-status-pill ${a.status}`}>{statusLabel}</span>}
                  </div>
                  <div className="gantt-track" style={{ width: trackWidth }}>
                    {a.status === 'milestone' ? (
                      <div className="gantt-milestone" style={{ left }} />
                    ) : (
                      <div className={`gantt-bar ${a.cls || ''}`} style={{ left, width: (a.endW - a.startW) * GANTT_WEEK_PX - 6 }}>
                        <span>{a.label}</span>
                        {a.pct != null && <span className="gantt-bar-tag">{a.pct}%</span>}
                        {a.tag === 'risk' && <span className="gantt-bar-tag gantt-bar-risk">Risk</span>}
                        {a.tag === 'delayed' && <span className="gantt-bar-tag">Delayed +2d</span>}
                        {a.tag === 'confidence' && <span className="gantt-bar-tag">Confidence {a.pct}%</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="gantt-today-line" style={{ left: 260 + todayLeft }} />
          </div>
        </div>
        <div className="gantt-legend">
          <span className="lg-i">
            <span className="lg-dot" style={{ background: 'var(--brand)' }} />
            Discovery
          </span>
          <span className="lg-i">
            <span className="lg-dot" style={{ background: '#7A5AB8' }} />
            Campaign Planning
          </span>
          <span className="lg-i">
            <span className="lg-dot" style={{ background: 'var(--ok)' }} />
            Journey/Assets
          </span>
          <span className="lg-i">
            <span className="lg-dot" style={{ background: '#1E8E9E' }} />
            Audience
          </span>
          <span className="lg-i">
            <span className="lg-dot" style={{ background: '#C23B6B' }} />
            MLR
          </span>
          <span className="lg-i">
            <span className="lg-dot" style={{ background: 'var(--ink4)' }} />
            Deployment
          </span>
          <span className="lg-i">◆ Milestone</span>
          <span className="lg-i">┄ Dependency</span>
          <span className="lg-i">⚠ At Risk</span>
          <span className="lg-i">⏱ Delayed</span>
          <span className="lg-i" style={{ marginLeft: 'auto', color: 'var(--ink4)' }}>
            ↔ Drag to slide the timeline
          </span>
        </div>
      </div>

      <div className="gantt-card gantt-quick-actions">
        <button onClick={() => onToast('Add Activity — not built yet.')}>+ Add Activity</button>
        <button onClick={() => onToast('Add Milestone — not built yet.')}>◆ Add Milestone</button>
        <button onClick={() => onToast('Add Dependency — not built yet.')}>┄ Add Dependency</button>
        <button onClick={() => onToast('Marked complete (demo only).')}>✓ Mark Complete</button>
        <button onClick={() => onToast('AI Recalculate — not built yet.')}>✦ AI Recalculate</button>
      </div>
    </>
  );
}
