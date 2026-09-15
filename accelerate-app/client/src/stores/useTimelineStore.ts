import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The per-campaign Timeline tab's own state — a real lead-time sequence
// (start date + per-item lead time, cascading close dates, pause control),
// not the old ported-from-the-prototype GanttTimeline/PlanMilestone reused
// data. Persisted the same way useVisioStore is: this is genuinely
// per-browser demo state, not something that needs a server round-trip to
// feel real.

export type SeqStatus = 'done' | 'active' | 'pending';

export interface SeqItem {
  key: string;
  name: string;
  owner: string;
  tat: number; // business days
  status: SeqStatus;
}

export interface ActivityEntry {
  id: string;
  text: string;
  ts: number;
}

interface CampaignTimelineState {
  startDate: string; // ISO yyyy-mm-dd
  items: SeqItem[];
  paused: boolean;
  activity: ActivityEntry[];
}

// The real sections/tabs this app actually has, in build order — replaces
// the old prototype's generic Discovery/CPF/Journey Build/Asset Creation/
// Audience Segmentation/MLR/Deployment/Go Live activity list, which named
// things that don't exist anywhere else in this product. Discovery
// specifically was dropped per direct instruction, not folded into
// anything else.
const DEFAULT_ITEMS: SeqItem[] = [
  { key: 'busetup', name: 'BU Setup', owner: 'xm', tat: 4, status: 'done' },
  { key: 'sources', name: 'Source Details', owner: 'oms', tat: 5, status: 'done' },
  { key: 'journey', name: 'Journey Details', owner: 'aor', tat: 6, status: 'active' },
  { key: 'email', name: 'Email Details', owner: 'aor', tat: 4, status: 'pending' },
  { key: 'flow', name: 'Flow Design', owner: 'solutionArchitect', tat: 5, status: 'pending' },
  { key: 'execution', name: 'Execution Handoff', owner: 'ops', tat: 3, status: 'pending' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): CampaignTimelineState {
  return { startDate: todayISO(), items: DEFAULT_ITEMS.map((i) => ({ ...i })), paused: false, activity: [] };
}

export const DEFAULT_TIMELINE_STATE: CampaignTimelineState = emptyState();

let seq = 0;
function pushActivity(list: ActivityEntry[], text: string): ActivityEntry[] {
  return [{ id: `act-${Date.now()}-${seq++}`, text, ts: Date.now() }, ...list].slice(0, 20);
}

interface TimelineStoreState {
  byCampaign: Record<string, CampaignTimelineState>;
  setStartDate: (tactplanId: string, date: string) => void;
  setTat: (tactplanId: string, itemKey: string, tat: number, actorName: string) => void;
  setStatus: (tactplanId: string, itemKey: string, status: SeqStatus) => void;
  togglePause: (tactplanId: string, actorName: string) => void;
}

export const useTimelineStore = create<TimelineStoreState>()(
  persist(
    (set) => ({
      byCampaign: {},
      setStartDate: (tactplanId, date) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, startDate: date } } };
        }),
      setTat: (tactplanId, itemKey, tat, actorName) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const item = cur.items.find((i) => i.key === itemKey);
          const items = cur.items.map((i) => (i.key === itemKey ? { ...i, tat } : i));
          const activity = item ? pushActivity(cur.activity, `${item.name} lead time updated to ${tat} day${tat === 1 ? '' : 's'} by ${actorName}.`) : cur.activity;
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, items, activity } } };
        }),
      setStatus: (tactplanId, itemKey, status) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const items = cur.items.map((i) => (i.key === itemKey ? { ...i, status } : i));
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, items } } };
        }),
      togglePause: (tactplanId, actorName) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const paused = !cur.paused;
          const activity = pushActivity(cur.activity, paused ? `Project paused by ${actorName}.` : `Project resumed by ${actorName}.`);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, paused, activity } } };
        }),
    }),
    { name: 'accelerate-timeline', partialize: (s) => ({ byCampaign: s.byCampaign }) },
  ),
);
