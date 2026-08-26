import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { VB_APPROVER_KEYS } from '../personas';

// Shared source of truth for the Flow Design / Visio Builder workflow —
// the clarify Q&A now happens as chat cards (ChatPanel, solutionArchitect
// persona only) while the form-pane canvas (VisioBuilderPanel) only ever
// DISPLAYS the result (waiting -> generating -> PDF). Both need to react
// to the same state the instant it changes, which plain per-component
// localStorage reads (the first pass of this feature) can't do — this
// store is what makes them reactive, same recipe as useChatStore/
// useSessionStore.
export interface ClarifyAnswer {
  value: string;
  label: string;
}
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
  answers: Record<string, ClarifyAnswer>;
  ready: boolean;
  generating: boolean;
  sent: boolean;
  decisions: Record<string, ApprovalDecision>;
  versions: VersionEntry[];
  // Has the chat-embedded clarify intro already been posted for this
  // campaign this session? Prevents re-posting the intro/question every
  // time the Solution Architect reopens the same campaign.
  chatIntroPosted: boolean;
}

function freshDecisions(): Record<string, ApprovalDecision> {
  const d: Record<string, ApprovalDecision> = {};
  VB_APPROVER_KEYS.forEach((k) => {
    d[k] = { status: 'pending', comment: '' };
  });
  return d;
}

function emptyState(): CampaignVisioState {
  return { answers: {}, ready: false, generating: false, sent: false, decisions: freshDecisions(), versions: [], chatIntroPosted: false };
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
  markChatIntroPosted: (tactplanId: string) => void;
  answerClarify: (tactplanId: string, qid: string, value: string, label: string) => void;
  startGenerating: (tactplanId: string) => void;
  generateVisio: (tactplanId: string, authorId: string) => void;
  // OMS-sourced path: the enrollment/survey metadata sheet already carries
  // enough detail (source type/name, Q&A pairs) that the clarify Q&A
  // and Solution-Architect-authored generation are skipped — a draft
  // exists immediately, but (unlike generateVisio) it does NOT auto-send
  // for approval; the Solution Architect still reviews and explicitly
  // sends it, since they didn't author it themselves.
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
      markChatIntroPosted: (tactplanId) =>
        set((s) => ({ byCampaign: { ...s.byCampaign, [tactplanId]: { ...(s.byCampaign[tactplanId] || emptyState()), chatIntroPosted: true } } })),
      answerClarify: (tactplanId, qid, value, label) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyState();
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, answers: { ...cur.answers, [qid]: { value, label } } } } };
        }),
      // Was never actually flipped to true anywhere before generateVisio
      // flipped it back to false — the left pane's "Generating diagram…"
      // overlay depends on this flag, so it just sat on "Waiting for
      // inputs" the whole time and only jumped straight to the finished PDF,
      // reading as the Generate action being stuck/unresponsive. Call this
      // the moment Generate is clicked, from either surface (chat or the
      // left pane), before the async delay.
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
          if (cur.ready) return s;
          let versions = pushVersion(cur.versions, authorId, 'Initial diagram generated from clarification answers.');
          versions = pushVersion(versions, authorId, 'Sent for approval.');
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

export const VB_CLARIFY_QUESTIONS: {
  id: string;
  q: string;
  options: { value: string; label: string; recommended?: boolean }[];
}[] = [
  {
    id: 'segment',
    q: 'Which source should we use for the segment?',
    options: [{ value: 'ZOL_SMAshing_my_limits_UB', label: 'ZOL_SMAshing_my_limits_UB', recommended: true }],
  },
  {
    id: 'cutoff',
    q: 'When does the audience for this send close?',
    options: [
      { value: '15 Aug 2026', label: '15 Aug 2026 — three days before the send', recommended: true },
      { value: '18 Aug 2026', label: '18 Aug 2026 — the send date itself' },
    ],
  },
  {
    id: 'lastTouch',
    q: 'Which send should be shown as the last touch?',
    options: [
      { value: '2026 Kick Off Email (FA-11630163_1001A)', label: '2026 Kick Off Email — FA-11630163_1001A', recommended: true },
      { value: 'Welcome Email (FA-11409681_1001A)', label: 'Welcome Email — FA-11409681_1001A' },
      { value: 'none', label: 'Do not show a last touch' },
    ],
  },
  {
    id: 'fulfilmentCode',
    q: 'What is the fulfilment campaign code?',
    options: [{ value: '20252054', label: 'Same as source code — 20252054', recommended: true }],
  },
];
