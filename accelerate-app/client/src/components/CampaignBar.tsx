import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CampaignRequest } from '../data/requests';

const TICKS = (r: CampaignRequest) => [
  { value: r.ready, label: 'brief ready' },
  { value: r.fieldsResolved, label: 'fields resolved' },
  { value: r.daysToGolive, label: 'to go-live' },
];
const TICK_MS = 3400;

// Ported from index.html's #campaignBar — the black strip under the app bar,
// replacing .req-hero (which the original CSS hides entirely on this
// screen — display:none — once this bar exists). The three readiness
// metrics rotate one at a time, same cadence as the original (syncCampaignBar
// / startCampaignTicker, CB_TICK_MS=3400).
export default function CampaignBar({ request }: { request: CampaignRequest }) {
  const navigate = useNavigate();
  const [tickIndex, setTickIndex] = useState(0);
  const ticks = TICKS(request);

  useEffect(() => {
    const id = setInterval(() => setTickIndex((i) => (i + 1) % ticks.length), TICK_MS);
    return () => clearInterval(id);
  }, [ticks.length]);

  return (
    <div className="campaign-bar" id="campaignBar">
      <button className="cb-back" onClick={() => navigate('/')} title="Back to campaign requests" aria-label="Back to campaign requests">
        ←
      </button>
      <div className="cb-id">
        <div className="cb-name">{request.name}</div>
        <div className="cb-meta">
          <span className="mono">{request.id}</span> &nbsp;·&nbsp; {request.indication} &nbsp;·&nbsp; {request.channels} &nbsp;·&nbsp; Go-live {request.golive}
        </div>
      </div>
      <div className="cb-ticker">
        {ticks.map((t, i) => (
          <span className={`cb-tick ${i === tickIndex ? 'on' : ''}`} key={t.label}>
            <b>{t.value}</b>
            <i>{t.label}</i>
          </span>
        ))}
      </div>
    </div>
  );
}
