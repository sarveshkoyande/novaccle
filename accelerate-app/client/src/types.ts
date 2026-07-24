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
