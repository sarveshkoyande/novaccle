// Mirrors server.js's /api/schema + /api/admin/* JSON shapes.
export interface FormField {
  id: string;
  sectionId: string;
  fieldKey: string;
  phase: 'preplan' | 'plan' | 'exec';
  label: string;
  type: string;
  owner: string;
  bucket?: string | null;
  source?: string | null;
  opts?: string[];
  cond?: Record<string, unknown>;
  drives?: string | null;
  cascadeFromField?: string | null;
  // The fieldKey this field's value can be inferred from (e.g. OMS's
  // "Brand" derivesFrom Generic's "1.1.3"). Only ever PROPOSED — see
  // propose_derived_fills — never silently applied.
  derivesFrom?: string | null;
  locked: boolean;
  lockedValue?: string | null;
  wide: boolean;
  order: number;
}

export interface Form {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  order: number;
}

export interface NudgeRule {
  id: string;
  trigger: string;
  triggerSectionId?: string | null;
  triggerPhase?: string | null;
  triggerFieldDrives?: string | null;
  triggerValue?: string | null;
  triggerSectionIds?: string | null;
  triggerFieldKey?: string | null;
  conditionsJson?: string | null;
  message: string;
  nudgeMessage?: string | null;
  nudgeToOwner?: string | null;
  active: boolean;
  order: number;
}

export interface TacticFieldTemplate {
  id: string;
  tacticType: string;
  fieldKey: string;
  phase: 'preplan' | 'plan' | 'exec';
  label: string;
  type: string;
  owner: string;
  bucket?: string | null;
  source?: string | null;
  opts?: string[];
  cond?: Record<string, unknown>;
  drives?: string | null;
  cascadeFromField?: string | null;
  locked: boolean;
  lockedValue?: string | null;
  wide: boolean;
  order: number;
}

export interface FormSection {
  id: string;
  num: string;
  name: string;
  icon: string;
  parentId?: string | null;
  audienceGate: boolean;
  note?: string | null;
  needs: { preplan: string[]; plan: string[]; exec: string[] };
  order: number;
  fields: FormField[];
}
