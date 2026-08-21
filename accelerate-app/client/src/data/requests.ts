import type { PersonaKey } from '../personas';
import { api } from '../api';

// Ported 1:1 from accelerate-app/public/index.html's REQUESTS seed array —
// there's no /api/requests endpoint (confirmed against server.js), this is
// genuinely static mock data in the original app too.
export interface CampaignRequest {
  id: string;
  name: string;
  brand: string;
  ic: string;
  color: string;
  phase: 'preplan' | 'plan' | 'exec';
  phaseLabel: string;
  updated: string;
  daysOpen: number;
  status: 'active' | 'completed';
  indication: string;
  channels: string;
  golive: string;
  ready: string;
  fieldsResolved: string;
  daysToGolive: string;
  owners: PersonaKey[];
  action: Partial<Record<PersonaKey, 'me' | 'block' | 'wait'>>;
  actionText: Partial<Record<PersonaKey, string>>;
  mineTo: PersonaKey[];
}

export const REQUESTS: CampaignRequest[] = [
  { id: 'TP-88213', name: 'Kisqali HCP Adjuvant — Q3 Wave 2 (eBC)', brand: 'Kisqali', ic: 'K', color: '#E74A21',
    phase: 'plan', phaseLabel: 'Planning', updated: '2 h ago', daysOpen: 18, status: 'active',
    indication: 'HR+/HER2− early breast cancer', channels: 'Email + SMS', golive: '14 Sep 2026', ready: '46%', fieldsResolved: '80 / 151', daysToGolive: '62 days',
    owners: ['aor', 'xm', 'mds'], action: { aor: 'me', xm: 'block', mds: 'me', cep: 'wait', ops: 'wait' }, actionText: { aor: '2 sections', xm: 'Resolve conflict', mds: 'Validate cascade', cep: '—', ops: '—' }, mineTo: ['aor', 'xm', 'mds'] },
  { id: 'TP-88155', name: 'Cosentyx PsO Refills Nurture — DTC', brand: 'Cosentyx', ic: 'C', color: '#0460A9',
    phase: 'preplan', phaseLabel: 'Pre-planning', updated: 'yesterday', daysOpen: 46, status: 'active',
    indication: 'Plaque psoriasis', channels: 'Email only', golive: '02 Oct 2026', ready: '12%', fieldsResolved: '18 / 151', daysToGolive: '80 days',
    owners: ['aor', 'xm'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: 'Complete intake', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: ['aor'] },
  { id: 'TP-88289', name: 'Entresto Q4 HFpEF Congress Alerts — HCP', brand: 'Entresto', ic: 'E', color: '#EC961D',
    phase: 'plan', phaseLabel: 'Planning', updated: '3 h ago', daysOpen: 12, status: 'active',
    indication: 'Heart failure with preserved ejection fraction', channels: 'Email + SMS', golive: '21 Sep 2026', ready: '58%', fieldsResolved: '96 / 151', daysToGolive: '69 days',
    owners: ['aor', 'cep', 'mds'], action: { aor: 'wait', xm: 'wait', mds: 'me', cep: 'me', ops: 'wait' }, actionText: { aor: 'With MDS', xm: '—', mds: 'Segmentation logic', cep: 'DC refresh + CI', ops: '—' }, mineTo: ['mds', 'cep'] },
  { id: 'TP-88104', name: 'Leqvio LDL-C Nurture Series — DTC Enrollment', brand: 'Leqvio', ic: 'L', color: '#0A3D7A',
    phase: 'exec', phaseLabel: 'Execution', updated: '4 h ago', daysOpen: 63, status: 'active',
    indication: 'High LDL cholesterol', channels: 'Email + SMS', golive: '28 Aug 2026', ready: '81%', fieldsResolved: '122 / 151', daysToGolive: '45 days',
    owners: ['aor', 'ops', 'cep'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'me' }, actionText: { aor: 'Personalization', xm: '—', mds: '—', cep: '—', ops: 'Build fields' }, mineTo: ['aor', 'ops'] },
  { id: 'TP-88332', name: 'Pluvicto Reactivation — Site-of-Care Nurture', brand: 'Pluvicto', ic: 'P', color: '#5B6B7A',
    phase: 'plan', phaseLabel: 'Planning', updated: 'today 09:12', daysOpen: 9, status: 'active',
    indication: 'Metastatic castration-resistant prostate cancer', channels: 'Email only', golive: '19 Oct 2026', ready: '34%', fieldsResolved: '52 / 151', daysToGolive: '96 days',
    owners: ['aor', 'xm', 'mds', 'cep'], action: { aor: 'wait', xm: 'me', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: 'With XM', xm: 'STO + specialty', mds: '—', cep: '—', ops: '—' }, mineTo: ['xm'] },
  { id: 'TP-87991', name: 'Scemblix CML Congress Follow-up — HCP', brand: 'Scemblix', ic: 'S', color: '#1E8E5A',
    phase: 'exec', phaseLabel: 'Execution', updated: '6 h ago', daysOpen: 71, status: 'active',
    indication: 'Chronic myeloid leukemia', channels: 'Email only', golive: '05 Sep 2026', ready: '88%', fieldsResolved: '133 / 151', daysToGolive: '53 days',
    owners: ['aor', 'ops'], action: { aor: 'wait', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'me' }, actionText: { aor: 'MLR done', xm: '—', mds: '—', cep: '—', ops: 'Deployment' }, mineTo: ['ops'] },
  { id: 'TP-88401', name: 'Kesimpta MS Q4 Reminder — DTC', brand: 'Kesimpta', ic: 'K', color: '#B23417',
    phase: 'preplan', phaseLabel: 'Pre-planning', updated: 'this morning', daysOpen: 3, status: 'active',
    indication: 'Relapsing multiple sclerosis', channels: 'SMS only', golive: '11 Nov 2026', ready: '8%', fieldsResolved: '11 / 151', daysToGolive: '119 days',
    owners: ['aor'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: 'Enrollment source', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: ['aor'] },
  { id: 'TP-87820', name: 'Jakafi Myelofibrosis Refill Reminder — HCP', brand: 'Jakafi', ic: 'J', color: '#7A5AB8',
    phase: 'exec', phaseLabel: 'Completed', updated: '2 weeks ago', daysOpen: 104, status: 'completed',
    indication: 'Myelofibrosis', channels: 'Email + SMS', golive: '01 Jul 2026', ready: '100%', fieldsResolved: '151 / 151', daysToGolive: 'Live',
    owners: ['aor', 'ops'], action: { aor: 'wait', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: '—', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: [] },
  { id: 'TP-87699', name: 'Tafinlar+Mekinist Adjuvant Melanoma — HCP', brand: 'Tafinlar', ic: 'T', color: '#1E8E9E',
    phase: 'exec', phaseLabel: 'Completed', updated: '5 weeks ago', daysOpen: 151, status: 'completed',
    indication: 'Adjuvant melanoma', channels: 'Email only', golive: '02 Jun 2026', ready: '100%', fieldsResolved: '151 / 151', daysToGolive: 'Live',
    owners: ['aor', 'ops'], action: { aor: 'wait', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: '—', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: [] },
  { id: 'TP-88477', name: 'Fabhalta PNH Adherence Nudge — DTC', brand: 'Fabhalta', ic: 'F', color: '#B23417',
    phase: 'plan', phaseLabel: 'Planning', updated: '1 h ago', daysOpen: 22, status: 'active',
    indication: 'Paroxysmal nocturnal hemoglobinuria', channels: 'Email + SMS', golive: '30 Sep 2026', ready: '41%', fieldsResolved: '62 / 151', daysToGolive: '78 days',
    owners: ['aor', 'xm'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: '3 sections', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: ['aor'] },
  { id: 'TP-88512', name: 'Iptacopan CKD IgAN Launch Wave 1 — HCP', brand: 'Fabhalta', ic: 'I', color: '#0460A9',
    phase: 'preplan', phaseLabel: 'Pre-planning', updated: 'today 11:40', daysOpen: 5, status: 'active',
    indication: 'IgA nephropathy', channels: 'Email only', golive: '15 Nov 2026', ready: '6%', fieldsResolved: '9 / 151', daysToGolive: '123 days',
    owners: ['aor'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: 'Kickoff intake', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: ['aor'] },
  { id: 'TP-88390', name: 'Xolair Severe Asthma Refill Reminder — DTC', brand: 'Xolair', ic: 'X', color: '#EC961D',
    phase: 'exec', phaseLabel: 'Execution', updated: 'today 08:05', daysOpen: 57, status: 'active',
    indication: 'Severe persistent asthma', channels: 'SMS only', golive: '04 Sep 2026', ready: '74%', fieldsResolved: '112 / 151', daysToGolive: '27 days',
    owners: ['aor', 'ops'], action: { aor: 'wait', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'me' }, actionText: { aor: '—', xm: '—', mds: '—', cep: '—', ops: 'QA deployment' }, mineTo: ['ops'] },
  { id: 'TP-88266', name: 'Zolgensma SMA Newborn Screening Outreach — HCP', brand: 'Zolgensma', ic: 'Z', color: '#7A5AB8',
    phase: 'plan', phaseLabel: 'Planning', updated: '2 h ago', daysOpen: 15, status: 'active',
    indication: 'Spinal muscular atrophy', channels: 'Email only', golive: '25 Oct 2026', ready: '29%', fieldsResolved: '44 / 151', daysToGolive: '102 days',
    owners: ['aor', 'mds'], action: { aor: 'wait', xm: 'wait', mds: 'me', cep: 'wait', ops: 'wait' }, actionText: { aor: 'With MDS', xm: '—', mds: 'Eligibility logic', cep: '—', ops: '—' }, mineTo: ['mds'] },
  { id: 'TP-88348', name: 'Lutathera NET Infusion Reminder Series — HCP', brand: 'Lutathera', ic: 'L', color: '#1E8E5A',
    phase: 'preplan', phaseLabel: 'Pre-planning', updated: 'yesterday', daysOpen: 2, status: 'active',
    indication: 'Neuroendocrine tumors', channels: 'Email + SMS', golive: '02 Dec 2026', ready: '4%', fieldsResolved: '6 / 151', daysToGolive: '140 days',
    owners: ['aor'], action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' }, actionText: { aor: 'Enrollment source', xm: '—', mds: '—', cep: '—', ops: '—' }, mineTo: ['aor'] },
  { id: 'TP-88221', name: 'Promacta ITP Adherence Check-in — DTC', brand: 'Promacta', ic: 'P', color: '#0A3D7A',
    phase: 'exec', phaseLabel: 'Execution', updated: '4 h ago', daysOpen: 39, status: 'active',
    indication: 'Immune thrombocytopenia', channels: 'Email only', golive: '12 Sep 2026', ready: '93%', fieldsResolved: '140 / 151', daysToGolive: '35 days',
    owners: ['aor', 'ops'], action: { aor: 'wait', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'me' }, actionText: { aor: '—', xm: '—', mds: '—', cep: '—', ops: 'Final QA' }, mineTo: ['ops'] },
  { id: 'TP-88176', name: 'Rydapt AML Maintenance Refill Series — HCP', brand: 'Rydapt', ic: 'R', color: '#5B6B7A',
    phase: 'plan', phaseLabel: 'Planning', updated: '3 h ago', daysOpen: 26, status: 'active',
    indication: 'Acute myeloid leukemia', channels: 'Email + SMS', golive: '08 Oct 2026', ready: '51%', fieldsResolved: '77 / 151', daysToGolive: '85 days',
    owners: ['aor', 'xm', 'cep'], action: { aor: 'wait', xm: 'me', mds: 'wait', cep: 'me', ops: 'wait' }, actionText: { aor: 'With XM/CEP', xm: 'Segment build', mds: '—', cep: 'DC refresh', ops: '—' }, mineTo: ['xm', 'cep'] },
];

const NEW_REQ_COLORS = ['#E74A21', '#0460A9', '#EC961D', '#0A3D7A', '#5B6B7A', '#1E8E5A'];

export interface NewCampaignFields {
  tactplanId?: string;
  agency: string;
  brand: string;
  indication: string;
  brandedUnbranded: string;
  audience: string;
  assetScope: string;
  campaignName: string;
  channels: string[];
}

// Shared with NewRequestModal's own handleSubmit — same seeding shape,
// just driven by the chat's propose_new_campaign flow instead of the modal
// form. REQUESTS has no backing table, so "creating" a campaign here is
// the same client-side seed-and-navigate every other creation path does.
export function buildCampaignRequest(fields: NewCampaignFields): CampaignRequest {
  const tactplanId = fields.tactplanId?.trim() || `TP-${Math.floor(80000 + Math.random() * 9999)}`;
  const channels = fields.channels.length >= 2 ? 'Email + SMS' : fields.channels[0] ? `${fields.channels[0]} only` : 'Email + SMS';
  const ic = fields.brand.trim().charAt(0).toUpperCase() || 'N';
  return {
    id: tactplanId,
    name: fields.campaignName.trim(),
    brand: fields.brand.trim(),
    ic,
    color: NEW_REQ_COLORS[Math.floor(Math.random() * NEW_REQ_COLORS.length)],
    phase: 'preplan',
    phaseLabel: 'Pre-planning',
    updated: 'just now',
    daysOpen: 0,
    status: 'active',
    indication: fields.indication.trim(),
    channels,
    golive: '—',
    ready: '0%',
    fieldsResolved: '0 / 151',
    daysToGolive: '—',
    owners: ['aor'],
    action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' },
    actionText: { aor: 'Start intake', xm: '—', mds: '—', cep: '—', ops: '—' },
    mineTo: ['aor'],
  };
}

// Creating a campaign (either via this modal or the chat's propose_new_campaign
// flow) only ever seeded the REQUESTS list entry — the portfolio-table summary
// (name/brand/indication/phase). It never wrote anything into the actual
// Generic/Overview form fields, so a freshly created campaign always opened
// looking like nothing had been answered yet, even though the same values
// (agency, brand, indication, audience, asset scope, campaign name, channels)
// had already been gathered during intake. This builds the matching
// FieldEntry rows so the caller can pass them straight to api.saveEntries —
// same "write real data, not just staged state" outcome propose_fill gets
// from a Confirm click, just triggered by campaign creation instead.
export function buildGenericOverviewEntries(
  sections: { id: string; name: string; fields: { id: string; label: string; phase: string }[] }[],
  tactplanId: string,
  fields: NewCampaignFields,
) {
  const section = sections.find((s) => s.name.trim().toLowerCase() === 'generic/overview' || s.id === 'generic');
  if (!section) return [];
  const valueByLabel: Record<string, string> = {
    'tactplan id': tactplanId,
    agency: fields.agency.trim(),
    brand: fields.brand.trim(),
    indication: fields.indication.trim(),
    'branded/unbranded': fields.brandedUnbranded,
    audience: fields.audience.trim(),
    'channel type': fields.channels.join(', '),
    'asset scope* (request type)': fields.assetScope,
    'campaign name': fields.campaignName.trim(),
  };
  return section.fields
    .map((f) => {
      const key = f.label.trim().toLowerCase();
      const value = valueByLabel[key];
      if (value === undefined) return null;
      return { sectionId: section.id, fieldId: f.id, phase: f.phase, value, sectionName: section.name, fieldLabel: f.label };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

// Runtime-created campaigns (New Request modal / chat's propose_new_campaign)
// are now persisted server-side (see server.js's /api/campaigns) — this
// fetches them once at app boot and folds any not already present into this
// same REQUESTS array every read site already reads synchronously, so
// nothing else in the app needs to change to see them survive a reload.
// Awaited in main.tsx before the first render, so a synchronous
// REQUESTS.find() (e.g. RequestDetailPage on a deep link) never runs before
// a previously-created campaign is back in the array. Before this, REQUESTS
// was the ONLY place a newly created campaign lived — a server restart or
// full reload silently erased it from the portfolio, even though its
// FieldEntry/Comment rows were already durable.
export async function bootstrapPersistedCampaigns(): Promise<void> {
  try {
    const { campaigns } = await api.getCampaigns();
    const existingIds = new Set(REQUESTS.map((r) => r.id));
    campaigns.forEach((c) => {
      if (!existingIds.has(c.id)) REQUESTS.unshift(c);
    });
  } catch {
    // Demo app, offline-tolerant: if the server's unreachable at boot, fall
    // back to the static seed list rather than blocking the first render.
  }
}
