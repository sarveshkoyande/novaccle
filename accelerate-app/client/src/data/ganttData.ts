import type { CampaignRequest } from './requests';

// Ported from index.html's buildGanttData() — visual layout + realistic mock
// data per the approved scope, not yet backed by real persisted
// activity/date data (PlanMilestone only tracks Discovery/CPF/CRF ETAs
// today). Kisqali (TP-88213) gets the exact hand-authored reference
// numbers; every other campaign gets a plausible schedule derived from its
// real ready%/phase so the page isn't just one hardcoded example.

export interface GanttActivity {
  label: string;
  owner: string;
  status: 'complete' | 'inprogress' | 'notstarted' | 'milestone';
  startW: number;
  endW: number;
  cls?: string;
  tag?: 'risk' | 'delayed' | 'confidence';
  pct?: number;
}

export interface GanttData {
  title: string;
  statusBadge: string;
  brand: string;
  channels: string;
  progress: number;
  golive: string;
  confidence: number;
  confidenceLabel: string;
  overallStatus: string;
  todayWeek: number;
  activities: GanttActivity[];
}

export function ganttWeekLabels() {
  const months = ['July 2025', 'August 2025', 'September 2025', 'October 2025'];
  const weeks: { label: string; month: string }[] = [];
  let wn = 27;
  months.forEach((m) => {
    for (let i = 0; i < 4; i++) {
      weeks.push({ label: `W${wn}`, month: m });
      wn++;
    }
  });
  return weeks;
}

export const GANTT_WEEK_PX = 64;

function mk(label: string, owner: string, startW: number, len: number, cls: string, todayWeek: number): GanttActivity {
  const endW = startW + len;
  return {
    label,
    owner,
    startW,
    endW,
    cls,
    status: endW < todayWeek ? 'complete' : startW <= todayWeek ? 'inprogress' : 'notstarted',
  };
}

export function buildGanttData(r: CampaignRequest): GanttData {
  if (r.id === 'TP-88213') {
    return {
      title: r.name,
      statusBadge: 'Planning',
      brand: r.brand,
      channels: r.channels,
      progress: 62,
      golive: 'Oct 15, 2025',
      confidence: 89,
      confidenceLabel: 'High',
      overallStatus: 'On Track',
      todayWeek: 3,
      activities: [
        { label: 'Discovery', owner: 'R. Mehta', status: 'complete', startW: 0, endW: 2, cls: 'c-discovery' },
        { label: 'CPF (Campaign Planning Form)', owner: 'A. Chen', status: 'inprogress', startW: 1, endW: 5, cls: 'c-cpf', tag: 'risk', pct: 78 },
        { label: 'Journey Build', owner: 'P. Shah', status: 'inprogress', startW: 3, endW: 8, cls: 'c-journey', tag: 'risk' },
        { label: 'Asset Creation (Email)', owner: 'S. Menon', status: 'inprogress', startW: 3, endW: 7, cls: 'c-assets' },
        { label: 'Asset Creation (SMS)', owner: 'S. Dsouza', status: 'inprogress', startW: 3, endW: 7, cls: 'c-assets' },
        { label: 'Audience Segmentation', owner: 'M. Ali', status: 'inprogress', startW: 5, endW: 9, cls: 'c-audience', tag: 'confidence', pct: 82 },
        { label: 'Medical Review (MLR)', owner: 'D. Kapoor', status: 'notstarted', startW: 8, endW: 11, cls: 'c-mlr', tag: 'delayed' },
        { label: 'Deployment', owner: 'N. Kapoor', status: 'notstarted', startW: 11, endW: 13, cls: 'c-deploy' },
        { label: 'Go Live', owner: '—', status: 'milestone', startW: 13, endW: 13 },
      ],
    };
  }
  const readyPct = parseInt(r.ready) || 10;
  const phaseIdx = { preplan: 0, plan: 1, exec: 2 }[r.phase] ?? 0;
  const todayWeek = 2 + phaseIdx * 2;
  return {
    title: r.name,
    statusBadge: r.phaseLabel || r.phase,
    brand: r.brand,
    channels: r.channels,
    progress: readyPct,
    golive: r.golive,
    confidence: Math.min(95, Math.floor(60 + readyPct / 2)),
    confidenceLabel: readyPct > 60 ? 'High' : readyPct > 30 ? 'Medium' : 'Low',
    overallStatus: r.status === 'active' ? 'On Track' : 'Complete',
    todayWeek,
    activities: [
      mk('Discovery', 'AOR', 0, 2, 'c-discovery', todayWeek),
      mk('CPF (Campaign Planning Form)', 'AOR', 1, 4, 'c-cpf', todayWeek),
      mk('Journey Build', 'XM', 3, 5, 'c-journey', todayWeek),
      mk('Asset Creation (Email)', 'AOR', 3, 4, 'c-assets', todayWeek),
      mk('Asset Creation (SMS)', 'AOR', 3, 4, 'c-assets', todayWeek),
      mk('Audience Segmentation', 'MDS', 5, 4, 'c-audience', todayWeek),
      mk('Medical Review (MLR)', 'CEP', 8, 3, 'c-mlr', todayWeek),
      mk('Deployment', 'Ops', 11, 2, 'c-deploy', todayWeek),
      { label: 'Go Live', owner: '—', status: 'milestone', startW: 13, endW: 13 },
    ],
  };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parses "14 Sep 2026" / "Oct 15, 2025" down to a 0-11 month index — just
// enough to place the go-live marker in the right column of the Jan-Dec
// strip. Returns -1 (no marker) if the string has no recognizable month name.
export function monthIndexFromGolive(golive: string | undefined): number {
  if (!golive) return -1;
  const m = String(golive).match(/[A-Za-z]{3}/);
  if (!m) return -1;
  return MONTH_ABBR.findIndex((a) => a.toLowerCase() === m[0].toLowerCase());
}

export const MONTHS = MONTH_ABBR;

export function ganttInitials(name: string | undefined) {
  if (!name || name === '—') return '—';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
