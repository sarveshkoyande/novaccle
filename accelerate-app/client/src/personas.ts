// Ported 1:1 from accelerate-app/public/index.html's PERSONAS object — the
// six field-owning roles plus the two Visio-approver-only personas (see that
// file's comment on ops2/ops3 for why approvers are real personas rather
// than a bolted-on "viewing as" toggle).
export interface Persona {
  name: string;
  role: string;
  color: string;
  abbr: string;
  scope: string;
}

export type PersonaKey = 'aor' | 'xm' | 'mds' | 'cep' | 'ops' | 'dca' | 'ops2' | 'ops3' | 'oms' | 'solutionArchitect' | 'cdm';

export const PERSONAS: Record<PersonaKey, Persona> = {
  aor: { name: 'Priya Sharma', role: 'AOR · Agency', color: '#E74A21', abbr: 'PS', scope: 'primary owner · 121 of 151 fields' },
  xm: { name: 'Megan Cole', role: 'XM · Novartis', color: '#0460A9', abbr: 'MC', scope: '4 fields · specialty & test decisions' },
  mds: { name: 'Anita Rao', role: 'MDS · Target list', color: '#EC961D', abbr: 'AR', scope: '6 fields · target list & suppressions' },
  cep: { name: 'Tomás Okafor', role: 'CEP · Platform / DC', color: '#5B6B7A', abbr: 'TO', scope: '4 fields · MCI reporting' },
  ops: { name: 'Derek Lin', role: 'Campaign Ops', color: '#0A3D7A', abbr: 'DL', scope: 'orchestration · 6 build-time fields' },
  dca: { name: 'Priya Nair', role: 'Data Cloud Architect', color: '#1E8E5A', abbr: 'PN', scope: '6 fields · Data Cloud details' },
  ops2: { name: 'Alex Kim', role: 'Campaign Ops · Approver', color: '#8B5CF6', abbr: 'AK', scope: 'Flow approver' },
  ops3: { name: 'Sofia Reyes', role: 'Campaign Ops · Approver', color: '#1E8E5A', abbr: 'SR', scope: 'Flow approver' },
  // Owns the Flow Design tab: answers the clarify questions, generates the
  // diagram, and sends it for approval — this used to be Derek's (Campaign
  // Ops) job in the original app; moved here per explicit direction so
  // Campaign Ops stays orchestration-only and Flow authoring has its own
  // dedicated owner.
  solutionArchitect: { name: 'Jordan Blake', role: 'Solution Architect', color: '#9333EA', abbr: 'JB', scope: 'Flow author · Flow Design' },
  // Owns the enrollment-form detail fields (Source Type/Name, Franchise,
  // Program, Survey Q&A, Metadata, Campaign Source Code) — everything in
  // OMS - Enrollment Form Details EXCEPT the one trigger question ("Campaign
  // Triggered by Enrollment Form Sign-Up?"), which stays AOR's: AOR is the
  // one who knows whether enrollment applies at all, OMS only needs to act
  // once the answer is Yes.
  oms: { name: 'Rahul Mehta', role: 'OMS · Enrollment Ops', color: '#0E7490', abbr: 'RM', scope: '15 fields · enrollment form details' },
  // Owns the per-campaign Timeline tab (the same GanttTimeline the standalone
  // Calendar page already uses, embedded here instead) — sequences the
  // campaign's real build activities against a start date and tracks lead time,
  // per direct request. Doesn't own any form fields; every persona can view
  // this tab same as Flow Design, CDM is just who it's built for.
  cdm: { name: 'Naveen Iyer', role: 'CDM · Delivery', color: '#DB2777', abbr: 'NI', scope: 'Timeline · delivery sequencing' },
};

export const VB_APPROVER_KEYS: PersonaKey[] = ['ops2', 'ops3'];
export function isApproverPersona(k: PersonaKey): boolean {
  return VB_APPROVER_KEYS.includes(k);
}
