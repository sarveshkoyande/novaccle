import type { FormSection, FormField, Form, NudgeRule } from './types';
import type { CampaignRequest } from './data/requests';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface FieldEntry {
  sectionId: string;
  fieldId: string;
  phase: string;
  value: string;
}

export const api = {
  getSchema: () => fetch('/api/schema').then((r) => json<{ sections: FormSection[] }>(r)),

  getEntries: (tactplanId: string) =>
    fetch(`/api/entries?tactplanId=${encodeURIComponent(tactplanId)}`).then((r) => json<{ entries: FieldEntry[] }>(r)),

  saveEntries: (tactplanId: string, entries: { sectionId: string; fieldId: string; phase: string; value: string; sectionName?: string; fieldLabel?: string }[]) =>
    fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tactplanId, entries }),
    }).then((r) => json<{ ok: true; count: number }>(r)),

  getSectionState: (tactplanId: string) =>
    fetch(`/api/section-state?tactplanId=${encodeURIComponent(tactplanId)}`).then((r) => json<{ submitted: string[] }>(r)),

  setSectionState: (tactplanId: string, sectionId: string, submitted: boolean) =>
    fetch('/api/section-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tactplanId, sectionId, submitted }),
    }).then((r) => json<{ ok: true }>(r)),

  addField: (sectionId: string, data: Partial<FormField>) =>
    fetch(`/api/admin/sections/${sectionId}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ field: FormField }>(r)),

  updateField: (id: string, data: Partial<FormField>) =>
    fetch(`/api/admin/fields/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ field: FormField }>(r)),

  deleteField: (id: string) =>
    fetch(`/api/admin/fields/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  getPlanMilestones: () =>
    fetch('/api/plan-milestones').then((r) => json<{ milestones: PlanMilestone[] }>(r)),

  updatePlanMilestone: (tactplanId: string, data: Partial<Pick<PlanMilestone, 'discoveryEta' | 'cpfEta' | 'crfEta'>>) =>
    fetch(`/api/plan-milestones/${encodeURIComponent(tactplanId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ milestone: PlanMilestone }>(r)),

  getForms: () => fetch('/api/forms').then((r) => json<{ forms: Form[] }>(r)),

  addForm: (data: Partial<Form>) =>
    fetch('/api/admin/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ form: Form }>(r)),

  updateForm: (id: string, data: Partial<Form>) =>
    fetch(`/api/admin/forms/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ form: Form }>(r)),

  deleteForm: (id: string) =>
    fetch(`/api/admin/forms/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  getSchemaFor: (formId: string) =>
    fetch(`/api/schema?formId=${encodeURIComponent(formId)}`).then((r) => json<{ sections: FormSection[] }>(r)),

  // formId isn't part of FormSection itself (the schema response never
  // includes it — sections are already scoped to a form by the time the
  // client sees them), but the server's create route reads it to know
  // which Form the new section belongs to (defaults to "form-default" if
  // omitted), so the create payload accepts it separately here.
  addSection: (data: Partial<FormSection> & { id: string; name: string; formId?: string }) =>
    fetch('/api/admin/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ section: FormSection }>(r)),

  updateSection: (id: string, data: Partial<FormSection>) =>
    fetch(`/api/admin/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ section: FormSection }>(r)),

  deleteSection: (id: string) =>
    fetch(`/api/admin/sections/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  getNudgeRules: () => fetch('/api/admin/nudge-rules').then((r) => json<{ rules: NudgeRule[] }>(r)),

  // Active-only, no admin gating — used for live evaluation against
  // whichever campaign is open (see nudges.ts).
  getActiveNudgeRules: () => fetch('/api/nudge-rules').then((r) => json<{ rules: NudgeRule[] }>(r)),

  addNudgeRule: (data: Partial<NudgeRule>) =>
    fetch('/api/admin/nudge-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ rule: NudgeRule }>(r)),

  updateNudgeRule: (id: string, data: Partial<NudgeRule>) =>
    fetch(`/api/admin/nudge-rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ rule: NudgeRule }>(r)),

  deleteNudgeRule: (id: string) =>
    fetch(`/api/admin/nudge-rules/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  // ---- Admin: Brand & Indication list ----
  getBrandIndications: () => fetch('/api/admin/brand-indications').then((r) => json<{ rows: BrandIndicationRow[] }>(r)),

  addBrandIndication: (data: { brand: string; indication: string; brandedUnbranded: string }) =>
    fetch('/api/admin/brand-indications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ row: BrandIndicationRow }>(r)),

  updateBrandIndication: (id: number, data: Partial<{ brand: string; indication: string; brandedUnbranded: string }>) =>
    fetch(`/api/admin/brand-indications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ row: BrandIndicationRow }>(r)),

  deleteBrandIndication: (id: number) =>
    fetch(`/api/admin/brand-indications/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  // ---- Admin: user directory (every stakeholder type, organization + brand mapping) ----
  getAppUsers: () => fetch('/api/admin/users').then((r) => json<{ users: AppUser[] }>(r)),

  addAppUser: (data: { name: string; email?: string; roleType: string; organization?: string; brand?: string }) =>
    fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ user: AppUser }>(r)),

  updateAppUser: (id: string, data: Partial<{ name: string; email: string; roleType: string; organization: string; brand: string }>) =>
    fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ user: AppUser }>(r)),

  deleteAppUser: (id: string) => fetch(`/api/admin/users/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  getComments: (tactplanId: string) =>
    fetch(`/api/comments/${encodeURIComponent(tactplanId)}`).then((r) => json<{ comments: Comment[] }>(r)),

  // source: "human" (default) shows up in the Conversations drawer;
  // "agent" is a real notification (still visible in the bell to anyone
  // it @mentions) that's deliberately excluded from that drawer — see
  // schema.prisma's Comment.source doc comment.
  addComment: (data: { tactplanId: string; sectionId: string; authorPersona: string; body: string; mentions: string[]; source?: 'human' | 'agent' }) =>
    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ comment: Comment }>(r)),

  // Every comment that @mentions `role` (manual mentions, notify_stakeholders,
  // or a fired nudge), across every campaign — the notification bell's feed.
  getNotifications: (role: string) =>
    fetch(`/api/notifications?role=${encodeURIComponent(role)}`).then((r) => json<{ notifications: Comment[] }>(r)),

  // Campaigns created at runtime (New Request modal / chat's
  // propose_new_campaign) — durable, unlike the static REQUESTS seed array.
  getCampaigns: () => fetch('/api/campaigns').then((r) => json<{ campaigns: CampaignRequest[] }>(r)),

  createCampaign: (data: CampaignRequest) =>
    fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ campaign: CampaignRequest }>(r)),
};

export interface Comment {
  id: number;
  tactplanId: string;
  sectionId: string;
  authorPersona: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface PlanMilestone {
  tactplanId: string;
  discoveryEta: string | null;
  cpfEta: string | null;
  crfEta: string | null;
}

export interface BrandIndicationRow {
  id: number;
  brand: string;
  indication: string;
  brandedUnbranded: string;
}

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  roleType: string;
  organization: string | null;
  brand: string | null;
  createdAt: string;
}
