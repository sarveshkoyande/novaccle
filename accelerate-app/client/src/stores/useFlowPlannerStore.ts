import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useVisioStore, DEFAULT_VISIO_STATE } from './useVisioStore';

// Dedicated inputs for the segmentation-diagram generator — deliberately a
// separate field set from the Intake tab's own fields (see
// docs/plans/2026-09-09-2019-feat-segmentation-diagram-generator-plan.md),
// mirroring the shape the ported campaign-accelerator-api reference project
// reads (app/flow/inputs.py's FlowInputs), so the generator isn't coupled to
// whatever the Intake form happens to be shaped like today. Persisted the
// same way useVisioStore/useTimelineStore are: per-browser demo state.

export interface EnrollmentSource {
  name: string;
  code: string;
  qna: string;
}

export interface UnbrandedFork {
  present: boolean;
  campaignCode: string;
  lastTouchpointQuestion: string;
  lastTouchpointMetadataId: string;
  answerCodes: string; // comma-separated in the UI, split on generate
}

export interface FlowPlannerInputs {
  audience: 'DTC' | 'HCP' | '';
  campaignName: string;
  campaignCode: string;
  campaignType: string;
  goal: string;
  enrollmentSources: EnrollmentSource[];
  qna: string;
  metadataSheet: string;
  segments: string; // comma-separated in the UI, split on generate
  unbranded: UnbrandedFork;
  suppressionAnswers: Record<string, string>; // keyed by field_ref's field id (optOut, specialtyInclusion, specialtyExclusion, businessRules)
  // Direct text overrides for a printed block (node id -> replacement
  // detail text) — most blocks (suppression checks, Dedupe, the QnA
  // blocks) are fixed SOP boilerplate with no other input to change, so
  // editing them by their diagram code (e.g. "B12") only works this way.
  // See server/segmentation/index.js's applyOverrides.
  nodeOverrides: Record<string, string>;
  // Node ids removed from the diagram (e.g. "delete B6") — the generator
  // drops these nodes and reconnects their neighbours directly. See
  // server/segmentation/index.js's applyDeletion.
  deletedNodeIds: string[];
  // Brand-new blocks added via chat ("add a decision block asking X") —
  // appended to the generated node list as-is. See applyCustomNodes.
  customNodes: CustomNode[];
  // Structural edits beyond a single block's own text/existence: inserting
  // a new block into an existing connection, swapping two blocks' content,
  // recolouring, or a raw connect/disconnect. Applied in order. See
  // server/segmentation/index.js's applyGraphOp for the op shapes.
  graphOps: GraphOp[];
}

export interface CustomNode {
  id: string;
  type: string;
  label: string;
  detail: string;
  status: string | null;
}

export type GraphOp =
  | { kind: 'insertBetween'; fromId: string; toId: string; newNodeId: string }
  | { kind: 'insertAfter'; afterId: string; newNodeId: string }
  | { kind: 'connect'; fromId: string; toId: string; label?: string }
  | { kind: 'disconnect'; fromId: string; toId: string }
  | { kind: 'swap'; idA: string; idB: string }
  | { kind: 'setStatus'; id: string; status: string | null };

function emptyInputs(): FlowPlannerInputs {
  return {
    audience: '',
    campaignName: '',
    campaignCode: '',
    campaignType: '',
    goal: '',
    enrollmentSources: [{ name: '', code: '', qna: '' }],
    qna: '',
    metadataSheet: '',
    segments: '',
    unbranded: { present: false, campaignCode: '', lastTouchpointQuestion: '', lastTouchpointMetadataId: '', answerCodes: '' },
    suppressionAnswers: {},
    nodeOverrides: {},
    deletedNodeIds: [],
    customNodes: [],
    graphOps: [],
  };
}

export const DEFAULT_FLOW_PLANNER_INPUTS: FlowPlannerInputs = emptyInputs();

// A campaign's stored inputs may predate a field added here later (e.g.
// deletedNodeIds/nodeOverrides didn't exist until block-level edits were
// added) — localStorage persistence just replays the old shape verbatim, it
// doesn't run through emptyInputs() again. Reading `cur.deletedNodeIds`
// straight off a pre-existing entry then throws on the first array method
// call instead of just seeing an empty list. Every read of a stored entry
// goes through this so an old campaign gets the new fields' defaults
// without needing a migration step.
export function normalizeFlowPlannerInputs(raw: Partial<FlowPlannerInputs> | undefined): FlowPlannerInputs {
  return { ...emptyInputs(), ...raw };
}

interface GeneratedResult {
  svg: string;
  generatedAt: number;
}

interface FlowPlannerState {
  byCampaign: Record<string, FlowPlannerInputs>;
  results: Record<string, GeneratedResult>;
  setField: <K extends keyof FlowPlannerInputs>(tactplanId: string, field: K, value: FlowPlannerInputs[K]) => void;
  setSource: (tactplanId: string, index: number, patch: Partial<EnrollmentSource>) => void;
  addSource: (tactplanId: string) => void;
  setUnbranded: (tactplanId: string, patch: Partial<UnbrandedFork>) => void;
  setResult: (tactplanId: string, svg: string) => void;
  /** Overlays values read straight from the campaign's real fields (see
   * FlowPlannerPanel's readRealInputs) onto the stored inputs — used both
   * for the automatic first-open sync and the manual "Sync from campaign
   * data" button. Only overwrites keys the real read actually produced. */
  applyRealInputs: (tactplanId: string, real: Partial<FlowPlannerInputs>) => void;
}

export const useFlowPlannerStore = create<FlowPlannerState>()(
  persist(
    (set) => ({
      byCampaign: {},
      results: {},
      setField: (tactplanId, field, value) =>
        set((s) => {
          const cur = normalizeFlowPlannerInputs(s.byCampaign[tactplanId]);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, [field]: value } } };
        }),
      setSource: (tactplanId, index, patch) =>
        set((s) => {
          const cur = normalizeFlowPlannerInputs(s.byCampaign[tactplanId]);
          const sources = cur.enrollmentSources.map((src, i) => (i === index ? { ...src, ...patch } : src));
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, enrollmentSources: sources } } };
        }),
      addSource: (tactplanId) =>
        set((s) => {
          const cur = normalizeFlowPlannerInputs(s.byCampaign[tactplanId]);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, enrollmentSources: [...cur.enrollmentSources, { name: '', code: '', qna: '' }] } } };
        }),
      setUnbranded: (tactplanId, patch) =>
        set((s) => {
          const cur = normalizeFlowPlannerInputs(s.byCampaign[tactplanId]);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, unbranded: { ...cur.unbranded, ...patch } } } };
        }),
      setResult: (tactplanId, svg) =>
        set((s) => ({ results: { ...s.results, [tactplanId]: { svg, generatedAt: Date.now() } } })),
      applyRealInputs: (tactplanId, real) =>
        set((s) => {
          const cur = normalizeFlowPlannerInputs(s.byCampaign[tactplanId]);
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, ...real } } };
        }),
    }),
    { name: 'accelerate-flow-planner', partialize: (s) => ({ byCampaign: s.byCampaign, results: s.results }) },
  ),
);

/** The wire shape the server's /api/flow-planner routes expect. */
export function toGenerateRequest(inputs: FlowPlannerInputs) {
  return {
    audience: inputs.audience || undefined,
    campaignName: inputs.campaignName,
    campaignCode: inputs.campaignCode,
    campaignType: inputs.campaignType,
    goal: inputs.goal,
    enrollmentSources: inputs.enrollmentSources.filter((s) => s.name || s.code || s.qna),
    qna: inputs.qna,
    metadataSheet: inputs.metadataSheet,
    segments: inputs.segments.split(',').map((s) => s.trim()).filter(Boolean),
    unbranded: {
      present: inputs.unbranded.present,
      campaignCode: inputs.unbranded.campaignCode,
      lastTouchpointQuestion: inputs.unbranded.lastTouchpointQuestion,
      lastTouchpointMetadataId: inputs.unbranded.lastTouchpointMetadataId,
      answerCodes: inputs.unbranded.answerCodes.split(',').map((s) => s.trim()).filter(Boolean),
    },
    suppressionAnswers: inputs.suppressionAnswers,
    nodeOverrides: inputs.nodeOverrides,
    deletedNodeIds: inputs.deletedNodeIds,
    customNodes: inputs.customNodes,
    graphOps: inputs.graphOps,
  };
}

// The flat shape /api/flow-planner/chat-edit's tool call returns — mirrors
// FlowPlannerInputs but with the nested unbranded/suppressionAnswers
// objects flattened, because a forced single tool call is far more reliable
// at filling a flat field list than a nested one.
interface ChatEditPatch {
  audience?: 'DTC' | 'HCP' | '';
  campaignName?: string;
  campaignCode?: string;
  campaignType?: string;
  goal?: string;
  segments?: string;
  qna?: string;
  metadataSheet?: string;
  enrollmentSources?: EnrollmentSource[];
  unbrandedPresent?: boolean;
  unbrandedCampaignCode?: string;
  unbrandedLastTouchpointQuestion?: string;
  unbrandedAnswerCodes?: string;
  businessRules?: string;
  specialtyInclusion?: string;
  specialtyExclusion?: string;
  nodeOverrideId?: string;
  nodeOverrideText?: string;
  nodeDeleteId?: string;
  customNodes?: CustomNode[];
  graphOps?: GraphOp[];
}

function patchToInputs(patch: ChatEditPatch, cur: FlowPlannerInputs): Partial<FlowPlannerInputs> {
  const real: Partial<FlowPlannerInputs> = {};
  if (patch.audience !== undefined) real.audience = patch.audience;
  if (patch.campaignName !== undefined) real.campaignName = patch.campaignName;
  if (patch.campaignCode !== undefined) real.campaignCode = patch.campaignCode;
  if (patch.campaignType !== undefined) real.campaignType = patch.campaignType;
  if (patch.goal !== undefined) real.goal = patch.goal;
  if (patch.segments !== undefined) real.segments = patch.segments;
  if (patch.qna !== undefined) real.qna = patch.qna;
  if (patch.metadataSheet !== undefined) real.metadataSheet = patch.metadataSheet;
  if (patch.enrollmentSources !== undefined) real.enrollmentSources = patch.enrollmentSources;
  const unbrandedChanged = patch.unbrandedPresent !== undefined || patch.unbrandedCampaignCode !== undefined || patch.unbrandedLastTouchpointQuestion !== undefined || patch.unbrandedAnswerCodes !== undefined;
  if (unbrandedChanged) {
    real.unbranded = {
      present: patch.unbrandedPresent ?? cur.unbranded.present,
      campaignCode: patch.unbrandedCampaignCode ?? cur.unbranded.campaignCode,
      lastTouchpointQuestion: patch.unbrandedLastTouchpointQuestion ?? cur.unbranded.lastTouchpointQuestion,
      lastTouchpointMetadataId: cur.unbranded.lastTouchpointMetadataId,
      answerCodes: patch.unbrandedAnswerCodes ?? cur.unbranded.answerCodes,
    };
  }
  const suppressionChanged = patch.businessRules !== undefined || patch.specialtyInclusion !== undefined || patch.specialtyExclusion !== undefined;
  if (suppressionChanged) {
    real.suppressionAnswers = {
      ...cur.suppressionAnswers,
      ...(patch.businessRules !== undefined ? { businessRules: patch.businessRules } : {}),
      ...(patch.specialtyInclusion !== undefined ? { specialtyInclusion: patch.specialtyInclusion } : {}),
      ...(patch.specialtyExclusion !== undefined ? { specialtyExclusion: patch.specialtyExclusion } : {}),
    };
  }
  if (patch.nodeOverrideId) {
    real.nodeOverrides = { ...cur.nodeOverrides, [patch.nodeOverrideId]: patch.nodeOverrideText ?? '' };
  }
  if (patch.nodeDeleteId && !cur.deletedNodeIds.includes(patch.nodeDeleteId)) {
    real.deletedNodeIds = [...cur.deletedNodeIds, patch.nodeDeleteId];
  }
  if (patch.customNodes?.length) {
    real.customNodes = [...cur.customNodes, ...patch.customNodes];
  }
  if (patch.graphOps?.length) {
    real.graphOps = [...cur.graphOps, ...patch.graphOps];
  }
  return real;
}

// Two edits typed in quick succession (before the first one's regenerate
// round-trip has finished) would otherwise both read the SAME starting
// `cur`, apply their own patch on top of it independently, and race to
// call setResult — whichever fetch happens to come back last wins,
// silently discarding the other edit's change even though both showed a
// success message in chat. Queued per campaign so each edit only starts
// once the previous one (success or failure) has fully landed.
const flowEditQueues = new Map<string, Promise<unknown>>();

/**
 * Turns a plain-English edit request into a real patch on this campaign's
 * Flow Planner inputs, then regenerates the diagram from the merged result.
 * Used by ChatPanel when the Solution Architect types an edit while viewing
 * the Flow tab — a distinct, real data model from the old canvas-based
 * /api/visio-agent, which edited an mxGraph node/edge graph this UI no
 * longer has.
 */
export function runFlowPlannerChatEdit(tactplanId: string, text: string, authorId: string): Promise<{ summary: string; applied: boolean }> {
  const prior = (flowEditQueues.get(tactplanId) ?? Promise.resolve()).catch(() => {});
  const result = prior.then(() => runFlowPlannerChatEditNow(tactplanId, text, authorId));
  flowEditQueues.set(tactplanId, result.catch(() => {}));
  return result;
}

async function runFlowPlannerChatEditNow(tactplanId: string, text: string, authorId: string): Promise<{ summary: string; applied: boolean }> {
  const store = useFlowPlannerStore.getState();
  const cur = normalizeFlowPlannerInputs(store.byCampaign[tactplanId]);
  const res = await fetch('/api/flow-planner/chat-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, currentInputs: toGenerateRequest(cur) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Flow edit failed (${res.status})`);
  }
  const { patch, summary } = (await res.json()) as { patch: ChatEditPatch; summary: string };
  const real = patchToInputs(patch || {}, cur);
  if (Object.keys(real).length === 0) return { summary, applied: false };

  store.applyRealInputs(tactplanId, real);
  const merged = { ...cur, ...real };

  const genRes = await fetch('/api/flow-planner/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toGenerateRequest(merged)),
  });
  if (genRes.ok) {
    const { svg } = await genRes.json();
    useFlowPlannerStore.getState().setResult(tactplanId, svg);
    // Only log a new version if a diagram was already generated once —
    // matches VisioBuilderPanel's onGenerated, which fires the FIRST time.
    const visio = useVisioStore.getState().byCampaign[tactplanId] ?? DEFAULT_VISIO_STATE;
    if (visio.ready) useVisioStore.getState().generateVisio(tactplanId, authorId);
  }
  return { summary, applied: true };
}
