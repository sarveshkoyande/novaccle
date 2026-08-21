import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PlanMilestone } from '../api';
import { REQUESTS } from '../data/requests';
import { buildGanttData, monthIndexFromGolive, MONTHS } from '../data/ganttData';
import GanttTimeline from '../components/GanttTimeline';
import AiPlanPanel from '../components/AiPlanPanel';

// Ported from index.html's #view-plan ("Calendar" tab) — a left "Open
// activities" table + right "Go-live timeline" 12-month strip, with a
// click-to-expand per-row Gantt (GanttTimeline) and a right-hand AI
// Planning Assistant panel that swaps in while a row is expanded, same as
// toggleGanttRow()/renderAiPlanPanel() in the original.
export default function CalendarPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastSeq = useRef(0);
  const queryClient = useQueryClient();

  const milestonesQuery = useQuery({ queryKey: ['plan-milestones'], queryFn: api.getPlanMilestones });
  const milestonesById: Record<string, PlanMilestone> = {};
  (milestonesQuery.data?.milestones || []).forEach((m) => {
    milestonesById[m.tactplanId] = m;
  });

  function showToast(msg: string) {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }

  async function saveMilestone(tactplanId: string, field: 'discoveryEta' | 'cpfEta' | 'crfEta', value: string) {
    try {
      await api.updatePlanMilestone(tactplanId, { [field]: value || null });
      await queryClient.invalidateQueries({ queryKey: ['plan-milestones'] });
      showToast('✓ Saved.');
    } catch {
      showToast('Could not save ETA.');
    }
  }

  const open = REQUESTS.filter((r) => r.status === 'active');

  // Keeps the right-hand Go-live timeline table's rows pixel-aligned with
  // the left activities table's rows even though they're two separate DOM
  // tables (per original design) — re-measures after every render/expand
  // rather than assuming a fixed row height, since the left table's rows
  // vary (wrapping activity names, an expanded Gantt detail row) while the
  // right table's rows don't.
  const leftBodyRef = useRef<HTMLTableSectionElement>(null);
  const rightBodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    function sync() {
      const leftRows = leftBodyRef.current ? [...leftBodyRef.current.querySelectorAll<HTMLElement>(':scope > tr')] : [];
      const rightRows = rightBodyRef.current ? [...rightBodyRef.current.querySelectorAll<HTMLElement>(':scope > tr')] : [];
      let ri = 0;
      let i = 0;
      while (i < leftRows.length) {
        const row = leftRows[i];
        if (row.classList.contains('admin-frow')) {
          let h = row.getBoundingClientRect().height;
          if (leftRows[i + 1] && leftRows[i + 1].classList.contains('plan-gantt-row')) {
            h += leftRows[i + 1].getBoundingClientRect().height;
            i++;
          }
          if (rightRows[ri]) rightRows[ri].style.height = `${h}px`;
          ri++;
        }
        i++;
      }
    }
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [expandedId, open.length]);

  const expandedRequest = expandedId ? REQUESTS.find((r) => r.id === expandedId) : null;
  const expandedData = expandedRequest ? buildGanttData(expandedRequest) : null;

  return (
    <>
      <div className="stage">
        <div className="view on" id="view-plan">
          <div className="hero ops-hero">
            <div className="hero-l">
              <h1>Calendar</h1>
              <p>Every open activity at a glance — expand a row's Timeline for the full campaign Gantt without leaving this list.</p>
            </div>
            <div className="hero-r">
              <div className="ops-hero-tag">
                <span className="p-av" style={{ borderColor: '#0A3D7A' }}>
                  DL
                </span>{' '}
                Campaign Ops view
              </div>
            </div>
          </div>
          <div className="plan-cols">
            <section className="admin-field-panel plan-left">
              <div className="admin-panel-head">
                <div>
                  <h3>Open activities</h3>
                  <p>
                    {open.length} activit{open.length === 1 ? 'y' : 'ies'}
                  </p>
                </div>
              </div>
              <table className="admin-ftable plan-table">
                <colgroup>
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Phase</th>
                    <th>Progress</th>
                    <th>Go-live</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody ref={leftBodyRef}>
                  {open.map((r) => {
                    const data = buildGanttData(r);
                    const isOpen = expandedId === r.id;
                    const statusClass = data.overallStatus === 'On Track' ? 'sm-status-prog' : 'sm-status-done';
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className={`admin-frow ${isOpen ? 'admin-frow-active' : ''}`}
                          onClick={() => setExpandedId(isOpen ? null : r.id)}
                        >
                          <td>
                            <div className="admin-flabel">{r.name}</div>
                            <div className="admin-fmachine">
                              {r.id} · {r.brand || ''}
                            </div>
                          </td>
                          <td>
                            <span className="admin-ftype-badge">{r.phaseLabel || r.phase}</span>
                          </td>
                          <td>
                            <div className="plan-progress-cell">
                              <span>{data.progress}%</span>
                              <div className="sm-detail-bar" style={{ width: 70 }}>
                                <div className="sm-detail-bar-fill sm-status-prog" style={{ width: `${data.progress}%` }} />
                              </div>
                            </div>
                          </td>
                          <td>{data.golive}</td>
                          <td>
                            <span className={`sm-status-pill ${statusClass}`}>{data.overallStatus}</span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="plan-gantt-row">
                            <td colSpan={5}>
                              <GanttTimeline
                                data={data}
                                onToast={showToast}
                                milestone={milestonesById[r.id]}
                                onSaveMilestone={(field, value) => saveMilestone(r.id, field, value)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
            <section className="admin-field-panel plan-right yt-panel">
              <div className="admin-panel-head">
                <div>
                  <h3>Go-live timeline</h3>
                  <p>Jan – Dec</p>
                </div>
              </div>
              <table className="admin-ftable yt-table">
                <thead>
                  <tr>
                    {MONTHS.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={rightBodyRef}>
                  {open.map((r) => {
                    const data = buildGanttData(r);
                    const hitIdx = monthIndexFromGolive(data.golive);
                    return (
                      <tr key={r.id} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                        {MONTHS.map((m, i) => (
                          <td key={m} className={i === hitIdx ? 'yt-hit' : ''} title={i === hitIdx ? `${m} · Go-live` : m}>
                            <span className="yt-mark" />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>

      {expandedData && <AiPlanPanel data={expandedData} onToast={showToast} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
