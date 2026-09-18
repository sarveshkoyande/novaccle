import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { VB_APPROVER_KEYS } from '../personas';

// Shared source of truth for the Flow Design / Visio Builder workflow — the
// approval lifecycle (ready/sent/decisions/versions) around whatever
// FlowPlannerPanel (real, SOP-driven generation from the campaign's own
// field data) produces. The scripted "answer these fixed multiple-choice
// questions" clarify flow that used to gate this (VB_CLARIFY_QUESTIONS,
// answered in chat or in this panel) has been removed — it asked the same
// four canned questions on every campaign regardless of its actual data,
// which wasn't real segmentation logic, just a fixed script standing in for
// it. FlowPlannerPanel now reads the campaign's real fields directly.
export interface ApprovalDecision {
  status: 'pending' | 'approved' | 'changes_requested';
  comment: string;
}
export interface VersionEntry {
  v: number;
  ts: number;
  authorId: string;
  change: string;
}
interface CampaignVisioState {
  ready: boolean;
  generating: boolean;
  sent: boolean;
  decisions: Record<string, ApprovalDecision>;
  versions: VersionEntry[];
}

function freshDecisions(): Record<string, ApprovalDecision> {
  const d: Record<string, ApprovalDecision> = {};
  VB_APPROVER_KEYS.forEach((k) => {
    d[k] = { status: 'pending', comment: '' };
  });
  return d;
}

function emptyState(): CampaignVisioState {
  return { ready: false, generating: false, sent: false, decisions: freshDecisions(), versions: [] };
}

// A single stable reference for "no state yet" — consumers select
// `byCampaign[tactplanId] ?? DEFAULT_STATE` directly rather than through a
// `get(id)` method that constructs a new object on every call. useSyncExternalStore
// (what Zustand's hook is built on) requires a selector to return a
// referentially stable value when nothing actually changed; a fresh object
// every render fails that check and was driving an infinite render loop
// ("Maximum update depth exceeded"), not just a wasted allocation.
export const DEFAULT_VISIO_STATE: CampaignVisioState = emptyState();

function pushVersion(list: VersionEntry[], authorId: string, change: string): VersionEntry[] {
  return [...list, { v: list.length + 1, ts: Date.now(), authorId, change }];
}

interface VisioState {
  byCampaign: Record<string, CampaignVisioState>;
  startGenerating: (tactplanId: string) => void;
  generateVisio: (tactplanId: string, authorId: string) => void;
  // OMS-sourced path: the enrollment/survey metadata sheet already carries
  // enough detail (source type/name, Q&A pairs) that a draft exists
  // immediately — but (unlike generateVisio) it does NOT auto-send for
  // approval; the Solution Architect still reviews and explicitly sends it,
  // since they didn't author it themselves.
  createDraftFromOms: (tactplanId: string, authorId: string) => void;
  sendForApproval: (tactplanId: string, authorId: string) => void;
  approve: (tactplanId: string, approverKey: string) => void;
  requestChanges: (tactplanId: string, approverKey: string, note: string) => void;
  resend: (tactplanId: string, authorId: string) => void;
}

export const useVisioStore = create<VisioState>()(
  persist(
    (set) => ({
      byCampaign: {},
      // Was never actually flipped to true anywhere before generateVisio
      // flipped it back to false — the left pane's "Generating diagram…"
      // overlay depends on this flag, so it just sat on "Waiting for
      // inputs" the whole time and only jumped straight to the finished PDF,
      // reading as the Generate action being stuck/unresponsive. Call this
      // the moment Generate is clicked, before the async delay.
      startGenerating: (tactplanId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          if (cur.ready || cur.generating) return s;
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, generating: true } } };
        }),
      // Generating the Flow now also sends it for approval in the same
      // step — per the reworked flow, there's no separate manual "Send for
      // Approval" click; the moment the diagram exists, reviewers are
      // notified (the caller posts the notification comment right after
      // this resolves).
      generateVisio: (tactplanId, authorId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const versions = cur.ready
            ? pushVersion(cur.versions, authorId, 'Diagram regenerated.')
            : pushVersion(pushVersion(cur.versions, authorId, 'Initial diagram generated from campaign data.'), authorId, 'Sent for approval.');
          return {
            byCampaign: {
              ...s.byCampaign,
              [tactplanId]: { ...cur, ready: true, generating: false, sent: true, decisions: freshDecisions(), versions },
            },
          };
        }),
      createDraftFromOms: (tactplanId, authorId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          if (cur.ready) return s;
          const versions = pushVersion(cur.versions, authorId, 'Draft segmentation flow generated from OMS enrollment/survey metadata.');
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, ready: true, generating: false, versions } } };
        }),
      sendForApproval: (tactplanId, authorId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          if (!cur.ready || cur.sent) return s;
          const decisions = freshDecisions();
          const versions = pushVersion(cur.versions, authorId, 'Sent for approval.');
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, sent: true, decisions, versions } } };
        }),
      approve: (tactplanId, approverKey) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const decisions = { ...cur.decisions, [approverKey]: { status: 'approved' as const, comment: '' } };
          const versions = pushVersion(cur.versions, approverKey, `Approved by ${approverKey}.`);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, decisions, versions } } };
        }),
      requestChanges: (tactplanId, approverKey, note) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const decisions = { ...cur.decisions, [approverKey]: { status: 'changes_requested' as const, comment: note } };
          const versions = pushVersion(cur.versions, approverKey, `Changes requested by ${approverKey}: "${note}"`);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, decisions, versions } } };
        }),
      resend: (tactplanId, authorId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          const decisions = freshDecisions();
          const versions = pushVersion(cur.versions, authorId, 'Re-sent for approval.');
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, sent: true, decisions, versions } } };
        }),
    }),
    { name: 'accelerate-visio', partialize: (s) => ({ byCampaign: s.byCampaign }) },
  ),
);
