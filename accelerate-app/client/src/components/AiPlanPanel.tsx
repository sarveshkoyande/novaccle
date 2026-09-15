import type { GanttData } from '../data/ganttData';

// Ported from index.html's renderAiPlanPanel() — static/rule-based content
// per the approved scope (illustrative activity log + risks/recommendations,
// not a real LLM forecasting engine). Only confidence/progress are actually
// derived from the campaign data passed in; the log/risk/recommendation
// text is the same demo content for every campaign, same as the original.
const LOG = [
  { ic: 'ok', text: 'Discovery completed', time: '10:15 AM' },
  { ic: 'ok', text: 'Campaign Planning started automatically', time: '10:15 AM' },
  { ic: 'ok', text: 'Journey Build started in parallel', time: '10:16 AM' },
  { ic: 'ok', text: 'Asset creation tasks started', time: '10:16 AM' },
  { ic: 'warn', text: 'MLR forecasted delay', time: '10:17 AM' },
  { ic: 'info', text: 'Deployment adjusted', time: '10:18 AM' },
  { ic: 'blue', text: 'Go Live remains unchanged', time: '10:18 AM' },
];
const RISKS = ['Medical review may delay +2 days', 'Brand approval pending', 'Agency dependency for assets', 'Legal review in progress', 'Content localization risk'];
const RECS = ['Compress MLR by 2 days', 'Run Email & SMS in parallel', 'Start Deployment prep early', 'Move Audience segmentation earlier'];

export default function AiPlanPanel({ data, onToast }: { data: GanttData; onToast: (msg: string) => void }) {
  return (
    <div className="chat-panel ai-plan-panel" style={{ display: 'flex' }}>
      <div className="cp-head ai-plan-head">
        <div className="cp-av">✦</div>
        <div>
          <h3>AI Planning Assistant</h3>
        </div>
      </div>
      <div className="cp-body ai-plan-body">
        <div className="ai-plan-section">
          <h4>Activity Log</h4>
          {LOG.map((l, i) => (
            <div className="ai-log-item" key={i}>
              <span className={`ai-log-ic ${l.ic}`}>✓</span>
              <span>
                {l.text}
                <span className="ai-log-time">{l.time}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="ai-plan-section">
          <h4>Forecast Confidence</h4>
          <div>
            <span className="ai-conf-num">{data.confidence}%</span>
            <span className="ai-conf-tag">{data.confidenceLabel} Confidence</span>
          </div>
          <div className="ai-conf-bar">
            <div className="ai-conf-bar-fill" style={{ width: `${data.confidence}%` }} />
          </div>
          <div className="ai-conf-scale">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        <div className="ai-plan-section">
          <h4>⚠ Top Risks</h4>
          <ul className="ai-list risks">
            {RISKS.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="ai-plan-section">
          <h4>✦ Recommendations</h4>
          <ul className="ai-list recs">
            {RECS.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="ai-plan-actions">
          <button className="btn-primary" onClick={() => onToast('Forecast applied (demo only).')}>
            + Apply Forecast
          </button>
          <button className="btn-ghost" onClick={() => onToast('Preview Impact — not built yet.')}>
            Preview Impact
          </button>
        </div>
        <div className="ai-plan-updated">Last updated: 2 min ago</div>
      </div>
    </div>
  );
}
