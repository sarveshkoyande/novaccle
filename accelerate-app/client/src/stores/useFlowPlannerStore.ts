import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

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
  };
}

export const DEFAULT_FLOW_PLANNER_INPUTS: FlowPlannerInputs = emptyInputs();

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
          const cur = s.byCampaign[tactplanId] || emptyInputs();
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, [field]: value } } };
        }),
      setSource: (tactplanId, index, patch) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyInputs();
          const sources = cur.enrollmentSources.map((src, i) => (i === index ? { ...src, ...patch } : src));
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, enrollmentSources: sources } } };
        }),
      addSource: (tactplanId) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyInputs();
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, enrollmentSources: [...cur.enrollmentSources, { name: '', code: '', qna: '' }] } } };
        }),
      setUnbranded: (tactplanId, patch) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyInputs();
          return { byCampaign: { ...s.byCampaign, [tactplanId]: { ...cur, unbranded: { ...cur.unbranded, ...patch } } } };
        }),
      setResult: (tactplanId, svg) =>
        set((s) => ({ results: { ...s.results, [tactplanId]: { svg, generatedAt: Date.now() } } })),
      applyRealInputs: (tactplanId, real) =>
        set((s) => {
          const cur = s.byCampaign[tactplanId] || emptyInputs();
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
  };
}
