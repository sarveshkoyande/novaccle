# Novartis Accelerate — Full Feature & Architecture Reference

**Purpose of this document:** a ground-truth, implementation-level inventory of every feature currently built in this application, intended as source material for another system/team to design a "suggest feature" UI and a from-scratch PRD. Every section states what's real (backed by a database and persisted) versus what's a UI mock/demo placeholder, since conflating the two would produce a PRD for the wrong system. Function names and file locations are cited throughout so specific behavior can be verified directly in source rather than taken on faith.

**Primary source files:**
- `hqe-requirement-studio-mock_2.html` — canonical frontend. ~5,300 lines, single file, no build step, no framework (vanilla JS + inline CSS). This is the live, user-facing application — it's what runs at the app's root URL, served statically.
- `accelerate-app/server/server.js` — Express backend (~830 lines), real business logic, not a stub.
- `accelerate-app/server/prisma/schema.prisma` — SQLite schema via Prisma ORM.
- `accelerate-app/client/` — a scaffolded but unused Vite+React+TypeScript shell from an earlier "rebuild as React" effort. Not routed to, not styled, exists only as groundwork. Ignore for feature-inventory purposes; the single HTML file is the real product today.

---

## 0. Big-Picture Summary

Novartis Accelerate is a **campaign requirement-gathering platform**: a structured, multi-phase intake form (originally an Excel-based process) that different roles (Agency AOR, Novartis XM, MDS, CEP, Campaign Ops, Data Cloud Architect) fill out collaboratively across three lifecycle phases — **Pre-planning (CPF)**, **Planning (CRF)**, and **Execution** — to spec out a marketing campaign (email/SMS journeys) before it's built in downstream systems (SFMC, MDS, MCI, Data Cloud, Automatrix).

It is not a generic form builder. It encodes a specific, real operational workflow (with real jargon: TactPlan, FUSE ID, CMA Metadata Sheet, BU Setup, Visio diagrams) and a specific real org structure (the 6 personas above, each owning a defined slice of ~151 fields).

The system has two audiences baked into the UI:
1. **Requesters/contributors** (AOR/XM/MDS/CEP/DCA) — fill the form, see a chat assistant, track progress.
2. **Admins** — configure the form's structure, its conditional logic, and its automated nudges without needing a code change.
3. **Campaign Ops** — gets its own extra UI (BU Setup toggle, Visio Builder canvas, a dedicated "Plan" tab, orchestration prose) since its role is coordination/scheduling rather than filling fields.

---

## 1. Architecture & Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Single static HTML file, vanilla JS, inline CSS | No build step, no bundler, no framework. All state is in-memory JS variables (`SECTIONS`, `campaignConfig`, `fieldValues`, etc.), re-rendered via full-innerHTML-replace functions (`renderAll()`, `renderSections()`, etc.) rather than a virtual DOM. |
| Backend | Node.js + Express | `accelerate-app/server/server.js`. Real REST API, not mocked. |
| Database | SQLite via Prisma ORM | `accelerate-app/server/prisma/dev.db`, adapter `@prisma/adapter-better-sqlite3`. File-based; fine for single-instance deployment, would need a swap (Postgres, etc.) for multi-instance/HA. |
| Chat/AI | Google Gemini (`@google/genai`, model `gemini-2.5-flash`) | Real tool-calling agent loop, server-side, streamed via SSE. Requires `GEMINI_API_KEY` env var — without it, `/api/agent-fill` returns 503 and the rest of the app still works (chat degrades, forms don't). |
| File parsing | `pdf-parse`, `mammoth` (docx), `xlsx` (SheetJS) | For the chat's "attach a brief" upload feature. |
| Excel export | `xlsx` (SheetJS) | Server-side, real file generation. |
| Deployment | Node process + static file serving, own server/VM/Docker | `Dockerfile`/`docker-compose.yml` exist but were never build-verified in this environment; app runs fine without Docker. No cloud-specific dependencies. |
| Auth | None (dummy) | See Section 3. |

**Data flow model:** the frontend is the source of truth for what the form *looks like at render time* (it holds `SECTIONS`, computed from database-backed schema plus in-memory campaign state), but the database is the source of truth for *what the form's structure and rules are* (`FormSection`/`FormField`/`TacticFieldTemplate`/`NudgeRule`) and for *what's actually been entered* (`FieldEntry`). On app load, the client fetches schema/templates/rules from the database and overwrites its own hardcoded fallback arrays — the hardcoded arrays only serve as a fallback if the API is unreachable, and as the literal source that was originally migrated into the database (see Section 8).

---

## 2. Data Model (Prisma / SQLite)

### `BrandIndication`
Stand-in for a real brand-master feed (TactPlan/MDS). Backs the New Campaign Request modal's brand/indication autocomplete and Asset Scope inference.
- `id`, `brand`, `indication`, `brandedUnbranded`. Unique on `(brand, indication)`.

### `FieldEntry`
Every field value actually entered in the requirement-gathering form. This is real, persisted campaign data — not schema.
- `id`, `tactplanId`, `sectionId`, `sectionName`, `phase` (preplan/plan/exec), `fieldId`, `fieldLabel`, `value` (string), `updatedAt`.
- Unique on `(tactplanId, sectionId, fieldId)`. Indexed on `(tactplanId, phase)`.
- Consumed by: the chat agent's `get_entries` tool (grounds "what's already entered" questions in real data), and bulk-written by `POST /api/entries`.

### `AgentSkill`
A persisted behavioral correction the chat agent learned from a real conversation (not hardcoded, not scoped to one session).
- `id`, `title`, `rule` (free text), `active` (bool), `createdAt`.
- Every active row's `rule` is injected into the agent's system prompt on every future turn — this is the actual mechanism by which "don't do X" corrections stick permanently. Admin can view all (`GET /api/skills`) and retract one (`DELETE /api/skills/:id`).

### `FormSection`
The form's structure — one row per top-level section (Generic/Overview, Journey, OMS, MCI, Email, MDS, Data Cloud, Automatrix, SMS, CMA Metadata Sheet). This is what used to be a hardcoded JS array (`BASE_SECTIONS`) and is now real, admin-editable, and actually consumed by the live form.
- `id` (string PK, e.g. `"generic"`), `num` (display order label, e.g. `"03"`), `name`, `icon` (single emoji), `parentId` (nullable, self-referential — used for Journey's Touch Point children), `audienceGate` (bool — whether this section's card shows an HCP/DTC toggle; today only meaningful on `mds`, see Section 12 for why), `note` (nullable, shown as a callout under the section header on the live form), `needsJson` (serialized `{preplan:[owners], plan:[owners], exec:[owners]}` — which persona(s) have obligations in each phase), `order` (int).
- Does **not** include the per-tactic CRF #N content (Email #1, SMS #2, MDS Suppression #N, Automatrix #N, Touch Point #N) — that's a separate concept, `TacticFieldTemplate` (below), because those aren't single sections, they're templates that fan out into N real sections per campaign depending on how many tactics/touchpoints the user specifies.

### `FormField`
One row per field belonging to a `FormSection` (cascade-deletes with its section).
- `id` (cuid), `sectionId` (FK), `fieldKey` (the original dotted field id scheme, e.g. `"1.1.3"`, preserved verbatim from the pre-database era so nothing downstream that references field ids by string breaks), `phase`, `label`, `type` (`text|ta|sel|multi|date|file|metasheet`), `owner` (persona key), `bucket` (nullable, a data-provenance tag: `newapp|auto|default|tactplan|xm|ops|tbd|unmapped`), `source` (nullable, the human caption shown under the field, e.g. `"⇢ TactPlan"`), `optionsJson` (for `type=sel`), `condJson` (visibility condition, see Section 9), `drives` (nullable — this field's value writes into a named `campaignConfig` key, making it a "driver" other fields/conditions can read), `cascadeFromField` (nullable — this field mirrors another field's value read-only), `locked`/`lockedValue` (auto-filled, non-editable), `wide` (full-width layout), `groupsJson` (only populated on the CMA Metadata Sheet's one `metasheet`-type field — an array of `{label, fields:[...]}` groups representing its 45 sub-fields; needed to round-trip the metasheet's nested structure through the database), `order`.
- Indexed on `sectionId`.

### `NudgeRule`
Standardizes what used to be scattered hardcoded `if` branches deciding "who gets nudged when, and what counts as phase-complete" into real, admin-editable, ordered rows.
- `id`, `trigger` (one of 5 types, below), `triggerSectionId` (for `section_submitted`/`fields_remaining`), `triggerPhase` (for `phase_complete`/`section_group_complete` — this is literally where "CPF complete" gets *defined*, as data, not code), `triggerFieldDrives`/`triggerValue` (for `field_value_equals`), `triggerSectionIds` (JSON array, for `section_group_complete` — a named subset of sections, not the whole phase), `triggerFieldKey` (for `fields_remaining` — the metasheet field to count against), `conditionsJson` (optional extra AND-gate on top of any trigger, reusing the same `{logic,rules}` shape as field conditions), `message` (the chat callout text, may contain `{{remaining}}`/`{{total}}` tokens), `nudgeMessage` (nullable follow-up "Nudge" callout), `nudgeToOwner` (nullable persona key named in the nudge), `active`, `order`.
- The 5 trigger types:
  1. `section_submitted` — fires when a named section is saved.
  2. `field_value_equals` — fires when a driver field equals a specific value.
  3. `phase_complete` — fires once, the moment every applicable field across an *entire phase* (all sections, all owners) is filled.
  4. `section_group_complete` — fires once, the moment a *named subset* of sections (not the whole phase) all have zero fields remaining — finer-grained than #3.
  5. `fields_remaining` — fires while a specific metasheet field still has unfilled sub-fields (e.g. "CMA Metadata Sheet still needs 12 of 45 fields"), gated by `conditionsJson` so it only fires under the right compound conditions.

### `TacticFieldTemplate`
CRF #N per-tactic field templates — Email/SMS/MDS Suppression/Automatrix/Touch Point content. Previously 100% hardcoded in JS generator functions; now real rows.
- `id`, `tacticType` (`email|sms|mds|automx|touchpoint`), `fieldKey` (template key with a literal `{n}` placeholder, e.g. `"1.6.t{n}.1"` — substituted with the real tactic instance number at render time), `phase`, `label`, `type`, `owner`, `bucket`, `source`, `optionsJson`, `condJson` (this is where MDS Suppression's real HCP/DTC audience gating lives, e.g. `{"logic":"and","rules":[{"key":"audience","value":"hcp"}]}`), `drives`, `cascadeFromField` (also `{n}`-templated when it references another per-tactic field), `locked`/`lockedValue`, `wide`, `order`.
- Indexed on `tacticType`. Not attached to a single `FormSection` because one template fans out into N real sections per campaign (Email #1, Email #2, ... — however many the user specifies via the "# of Emails" driver field).

### `PlanMilestone`
Campaign Ops' planning timeline for one request — set from the "Plan" tab.
- `id`, `tactplanId` (unique), `discoveryEta`, `cpfEta`, `crfEta` (all nullable date strings, `"YYYY-MM-DD"`), `updatedAt`.
- Currently exactly 3 milestones are tracked (Discovery session, CPF completion, CRF completion) — explicitly scoped as "for now," implying more milestones (Build, Asset Handoff, Deployment, Monitoring — see `MILESTONES` in Section 6) are a natural extension.

---

## 3. Authentication

**Entirely a mock — no real auth exists.** `doLogin()` (client) always succeeds regardless of what's typed, always signs the user in as the AOR persona (Priya Sharma), and transitions to the landing page after a 260ms CSS animation. There is no `/api/login` or session/token mechanism anywhere in `server.js`. Persona switching (Section 7) is the only "identity" concept, and it's a pure UI dropdown with no backend enforcement — any user can click into any persona's view/permissions at will. **A real PRD must treat authn/authz as fully greenfield.**

---

## 4. Landing Page (Requests List)

Route: default view after login, reachable via "Requests" nav item, function `showLanding()`.

- **Stat cards** (4): Total active (static, 14), Needing my input (live — recomputed per persona from the `REQUESTS` array's `mineTo` field, with a persona-specific subtitle string), AI-drafted values (static, cosmetic demo number, 327/"82% confirmed unchanged"), Live campaigns (static, 28).
- **Filter row**: All / Needing my input / Pre-planning / Planning / Execution / Completed, each a pill button with a live count, plus a free-text search box (client-side filter, presumably matches name/brand/id — not confirmed against a persisted search endpoint since `REQUESTS` is in-memory only).
- **Requests table**: Campaign name+icon+"updated X ago", TactPlan ID, Phase (colored dot+label), Owners (persona avatar chips), Days open (sortable), "Your action" (per-persona: "me" / "block" / "wait" with matching action text), row highlight if the current persona has action needed. Clicking a row opens that request.
- **`REQUESTS` data itself is a 9-row hardcoded in-memory array**, not database-backed — this is the single biggest "mock vs real" gap in the whole app: there is no `Campaign`/`Request` Prisma model. `FieldEntry` persists *field values* keyed by a `tactplanId` string, but the requests list itself (name, brand, phase, owners, days-open, etc.) is not stored anywhere — reloading the server resets nothing here (it's baked into the HTML), but there is also no way to actually create a new persisted request end-to-end; the "New Campaign Request" modal (below) collects inputs but doesn't currently write a new row anywhere durable.

### New Campaign Request Modal
- Real, working brand/indication autocomplete against the database: `GET /api/brands?q=`, `GET /api/indications?brand=`, `GET /api/brand-lookup?brand=&indication=` (backed by `BrandIndication`). Debounced (200ms) custom dropdown (not native `<datalist>`, for stylability).
- **Asset Scope auto-inference**: brand+indication both already known in `BrandIndication` ⇒ forces "Update Existing Campaign" (a brand-new launch can't already exist); brand known, indication not ⇒ infers "New Indication Launch"; brand unknown ⇒ leaves the field open, doesn't force anything. This is real business logic, not decorative.
- Channel Type defaults to Email+SMS both checked.
- Submission behavior/persistence: not confirmed to write a new request anywhere durable — likely opens directly into a fresh in-memory request state (a gap consistent with the "requests list is a mock array" point above).

---

## 5. Request Detail Page

Route: opened via `openRequest(id)` from the landing page's requests table.

### 5.1 Header
Breadcrumb, request icon/color, title, subtitle (TactPlan ID, brand, indication, channels, go-live date), and 3 metrics: brief-readiness %, fields resolved (`X / 151`), days to go-live.

### 5.2 Phase Stepper ("Requirement Gathering Progression")
3-node stepper: Pre-planning → Planning → Execution, with a proportional fill bar. Governs **field editability only** (which phase's fields are unlockable) — the finer-grained "where exactly are we in the process" detail lives in the flow map below it. Clickable nodes jump directly to that phase.

### 5.3 Flow Map ("Requirement Gathering Process Map")
A 6-milestone horizontal flow visualization (`MILESTONES`: CPF & Visio → CRF & Tactic Build → Build & Proofing → Asset Handoff → Deployment → Monitoring), each with real orchestration prose describing what Campaign Ops actually does at that stage (e.g. CPF: "Campaign Operations drafts the Visio... routes it to MDS... For a New Brand/Indication launch, the SFMC Product Owner and MDS/Data Cloud set up the new Business Unit in parallel"). Renders one column per stage up to the current one, with parallel-track nodes where applicable, a pulsing indicator on the active/attention-needed node, and a collapsed "ghost" node summarizing all future stages (since their exact shape depends on undecided upstream choices — clicking it explains this rather than pretending to show detail that doesn't exist yet). Clicking a node jumps to and opens the relevant section, and is CRF-tab-aware (see Section 10) so it lands on a tab that actually contains the target field.

Below the flow map, a plain "Orchestration" card shows the current milestone's prose description directly.

### 5.4 Your Focus Panel
Persistent sidebar summary of exactly what the *current persona* still needs to do across the currently open request — computed live from real field-fill state (`sectionRemainingForPersona`), not hardcoded. Hidden entirely outside an open request (since the chat panel itself is a persistent fixed element that would otherwise show stale content on the landing page).

### 5.5 Ownership View
A sidebar list of all 6 personas with a hand-authored, plain-English description of what each one owns (e.g. "AOR: Generic, Journey, OMS, Email, SMS, Automatrix"). **This is a static, hand-maintained summary — not derived live from the actual per-field `owner` values.** A real PRD should flag this as a candidate for becoming a live, computed view instead (risk: it can drift out of sync with the real per-field ownership as fields are added/edited in Admin).

### 5.6 Campaign Ops-Exclusive Features
Visible only when `currentPersona === 'ops'`:
- **BU Setup** — a plain completion checkbox/toggle (not a form section with fields), persisted in browser `localStorage` per-tactplanId (not server-side — a real PRD should flag this as needing to move to the database if BU Setup status needs to be visible to other users/sessions).
- **Visio Builder** — a genuine free-form node-and-connector diagram canvas (trigger/action/wait/loop/end node types), seeded with 8 default nodes representing the real CPF→Journey→Touchpoints→MDS-routing→Build-handoff pipeline, fully editable (add/remove/rename nodes, presumably edges too), persisted to `localStorage` per-tactplanId. **Explicitly not an execution engine** — it's a planning/documentation tool, nothing in it actually triggers real work. Reachable from the flow map's "Visio Diagram" node; attempting to reach it as a non-Ops persona shows a toast prompting a persona switch rather than silently failing.

### 5.7 Plan at a Glance (alternate section view)
A toggle (pill switch: "☰ Sections" / "▦ Plan at a Glance") on the request page that swaps the normal editable section list for a read-only card-grid summary — one card per top-level section, each showing an icon, name, short subtitle, status (Completed/In progress/Not started/Not applicable, computed live), a "filled / total fields" count, and a progress bar. Cards aggregate progress across whatever a section fans out into (e.g. the MDS card sums fields across every currently-generated "MDS Suppression #N" CRF tab, not just its own empty base card). Clicking a card jumps back to the normal section view, scrolled to that section. Purely a display convenience — no separate data model, computed on the fly from the same `SECTIONS`/`fieldValues` state the normal view uses.

---

## 6. The Section/Field Rendering System

### 6.1 Field Types
`text` (default), `ta` (textarea), `sel` (dropdown, options from `opts`), `multi` (currently hardcoded to exactly Email/SMS checkboxes — not a generic multi-select), `date`, `file` (stores just the filename string, not the actual file binary), `metasheet` (special nested-grid renderer for the CMA Metadata Sheet's 45 sub-fields across 10 groups).

### 6.2 Field Behaviors
- **`locked`** — auto-filled, always shown read-only with a fixed `lockedValue`, always counted as "filled" for progress purposes (the owning persona has nothing to do).
- **`cascadeFrom` / `cascadeFromField`** — read-only mirror of another field's value; never independently editable, excluded from "remaining fields for persona X" counts (the obligation lives on the source field, not duplicated on every mirror).
- **`drives`** — this field's value writes into a shared `campaignConfig` object under a named key (e.g. `assetScope`, `channels`, `enrollment`, `emailCount`) rather than into the plain per-field value store. Other fields' visibility conditions and the tactic fan-out logic (how many Email #N sections exist) read from `campaignConfig`, not from the driver field directly — this indirection is what makes conditions/fan-out react live as soon as a driver value changes, anywhere in the form.
- **`wide`** — full-width layout.
- **`cond`** — visibility condition (Section 9).
- **`ai`** flag — visually marks a field the chat agent proposed a value for (ties into the landing page's "AI-drafted values" stat).
- **`src`** caption — every field can show a small explanatory caption under its control (e.g. `"⇢ TactPlan"`, `"⏳ Filled after submission"`, `"⚠ TBD — unresolved in source"`) so a readonly/blank field is self-explanatory instead of looking broken.
- **Owner-based editability** — every field belongs to exactly one persona (`owner`); a field only renders editable if the current persona matches (and the section/phase is unlocked).

### 6.3 The 10 Base Sections
Generic/Overview, Journey, OMS – Enrollment Form Details, MCI – Campaign Performance Reporting, Email, MDS – Target List and Suppressions, Data Cloud details, Automatrix, SMS, CMA Metadata Sheet.

Two of these (MDS, Automatrix) intentionally carry **zero static fields of their own** — all their real content lives entirely per-tactic in CRF #N tabs (see 6.4). Journey has zero preplan fields and dynamically nests generated "Touch Point #N" child sections beneath its own card.

### 6.4 Per-Tactic Fan-Out (CRF #N)
Four of the base sections (Email, SMS, MDS, Automatrix) plus Journey's Touch Points don't show their real content on their own base card — instead, a driver field (e.g. "# of Emails") determines how many numbered instances get generated (Email #1, Email #2, ...), each an independent, fully fillable section with its own Save button. This fan-out is computed client-side (`computeSections()`) from `TacticFieldTemplate` rows, substituting the real instance number into each template's `{n}`-placeholder field key. **MDS Suppression's fields are the one place real audience (HCP vs. DTC) conditional gating exists today** — roughly half its fields show only for HCP campaigns, the other half only for DTC.

### 6.5 The "Audience Gate" Toggle
A per-section boolean (`FormSection.audienceGate`) controlling whether that section's card shows a "Showing: HCP / DTC Enrollment" dropdown. This dropdown writes to a single global (`campaignConfig.audience`), read by any field's condition that checks the `audience` key — today, only MDS Suppression's fields do. **It is easy to mis-set this flag on a section whose own fields aren't actually audience-conditioned** (this exact mistake was made and corrected during earlier development on Email/SMS/Automatrix) — it doesn't break anything, it's just a redundant/confusing extra toggle with no functional effect on that section's own content. A future PRD might consider deriving this automatically (show the toggle only where a section's own templates actually carry an audience condition) rather than leaving it a manually-set flag.

---

## 7. Personas

6 fixed personas, each with a name, role label, brand color, avatar initials, and a one-line scope description:

| Key | Name | Role | Scope |
|---|---|---|---|
| `aor` | Priya Sharma | AOR · Agency | Primary owner — 121 of 151 fields |
| `xm` | Megan Cole | XM · Novartis | 4 fields — specialty & test decisions |
| `mds` | Anita Rao | MDS · Target list | 6 fields — target list & suppressions |
| `cep` | Tomás Okafor | CEP · Platform/DC | 4 fields — MCI reporting |
| `ops` | Derek Lin | Campaign Ops | Orchestration — 6 build-time fields |
| `dca` | Priya Nair | Data Cloud Architect | 6 fields — Data Cloud details |

Switching (a dropdown menu, no auth behind it — see Section 3) affects: which fields render editable vs. read-only; "Your Focus"/remaining-field counts; which sections auto-unlock on arrival; the landing page's "needing my input" stats/row highlighting; the Ownership view's highlighted row; whether Ops-only UI (BU Setup, Visio Builder) is reachable at all; and **the chat panel's entire color theme and conversation thread** — each persona maintains an independent chat history (switching personas swaps in that persona's own saved conversation, or starts fresh) and the chat header/accent colors re-theme to that persona's brand color.

---

## 8. Admin Console

Reachable via the "Admin" nav item, function `showAdmin()`. Replaces the chat/edit panels with a dedicated editor panel (same fixed-width slot the chat normally occupies — not shown on this page at all, since it's irrelevant to admin work). Three sub-tabs, all sharing the same table + inline side-drawer editing pattern:

### 8.1 Manage Sections (default tab)
CRUD for `FormSection` rows: add/edit/delete a section (name, num/display-order label, icon, note, per-phase "needs" — which personas owe work in each phase — and the audience-gate checkbox). A "Manage fields" shortcut per row jumps straight to that section in the Fields tab. Every mutation immediately updates both the admin table and the *live form* (not just the database) — verified end-to-end (an edit here changes what real users see on the actual form, with no code deploy).

### 8.2 Manage Form Fields
CRUD for `FormField` rows scoped to the currently selected section — add/edit/delete, including:
- A **visual condition builder** (replacing free-typed `key:value` text): search a fixed list of known condition keys (Asset Scope, Channel Type, Enrollment Sign-Up, Audience, Metadata Source, A/B Testing), tick which value(s) it should equal, chain multiple rules with AND/OR — no need to memorize internal `campaignConfig` key names or valid values.
- Folded into this same tab (not a separate tab), a second block appears when the selected section is one of the 5 fan-out types (Email/SMS/MDS/Automatrix/Journey): **"Per-tactic template (CRF #N)"**, listing that tactic type's `TacticFieldTemplate` rows with the same add/edit/delete/condition-builder UI. This is what makes MDS Suppression's real HCP/DTC gating, and every other per-tactic field, actually admin-editable — previously these ~76 fields were 100% hardcoded JS with no admin surface at all.
- Excel export button (`GET /api/admin/export`) — downloads the live `FormField` table as `.xlsx`.

### 8.3 Manage Nudges
CRUD for `NudgeRule` rows — trigger type, the section/phase/field/value/section-group/metasheet-field it's keyed on, an optional extra AND-gate condition, the message text (with `{{remaining}}`/`{{total}}` templating support for `fields_remaining` rules), an optional follow-up nudge message and target owner, and active/inactive. This is the literal, data-driven answer to "how is CPF completion defined" and "who gets nudged when" — previously scattered hardcoded branches in the chat's checkpoint logic.

### 8.4 What "Admin" Does *Not* Yet Cover
- No UI to reorder sections (only add/edit/delete).
- No way to configure the `REQUESTS` list itself (it's not database-backed at all — see Section 4).
- No permissions/roles concept — anyone who can reach the Admin nav item can do everything in it (ties back to Section 3's total absence of auth).
- The Ownership view (Section 5.5) is not editable from Admin despite being a hand-written summary that can drift from the real per-field owners.

---

## 9. The Condition System (Field & Nudge Visibility)

Shared shape used both by `FormField.condJson`/`TacticFieldTemplate.condJson` (field visibility) and `NudgeRule.conditionsJson` (nudge gating):
```json
{ "logic": "and", "rules": [ { "key": "assetScope", "value": "newbrand" } ] }
```
`logic` is `"and"` or `"or"`, applied flatly across all rules (no nested groups). Operator is always equality (no "not equals," "greater than," etc. — not needed by anything in the current form). Evaluated against a fixed, known set of `campaignConfig` keys that some driver field writes into: `assetScope`, `channels`, `enrollment`, `audience`, `metadataSource`, `abTesting`. An older flat-object shape (`{"audience":"hcp"}`, implicitly AND) is still read correctly for backward compatibility with any data saved before the visual builder existed.

---

## 10. The Nudge/Chat-Checkpoint System

Every time a section is saved, `evaluateNudgeRules()` checks all active `NudgeRule` rows against current state and posts any matches as chat callouts (a "Major change" message, optionally followed by a separate "Nudge" callout naming who needs to act). This is what makes the chat feel reactive to form state — e.g. saving Generic/Overview with Asset Scope = New Brand Launch fires both a "CPF journey initiated" message and a "BU Setup task assigned to CEP/MDS" nudge, entirely from `NudgeRule` data, zero hardcoded logic. `phase_complete` rules are how "CPF is fully complete" gets defined and detected at all — there is no other mechanism for phase-completion detection in the app.

---

## 11. CRF View Tabs

When in the Planning phase and at least one tactic exists (Email/SMS count > 0), the section list switches from one long scroll to a tab bar: a fixed "CRF details" tab (shared/non-tactic-scoped sections) plus one tab per tactic instance ("CRF #1 · Email", "CRF #2 · SMS", ...), each showing only that instance's Email/SMS + MDS Suppression + Automatrix content together. Navigation from the flow map or Your Focus panel is tab-aware — it switches to whichever tab actually contains the target field before scrolling to it.

---

## 12. Chat / "Requirement Agent"

A genuine tool-calling LLM agent (Google Gemini `gemini-2.5-flash`), not a scripted chatbot — real server-side agentic loop with streamed reasoning/tool-call/result events over SSE.

### 12.1 Tools Available to the Agent
1. **`match_section(query)`** — finds which form section a message is about and returns its real field list. Executed deterministically server-side against the actual section/field names (not left to the model to hallucinate), with specific safeguards against accidental substring collisions between unrelated words.
2. **`propose_fill(sectionId, assignments[])`** — stages field:value pairs for user confirmation; **never writes directly**. Enforces a 10-fields-per-call chunking rule for large asks (e.g. "fill the whole CMA sheet") to avoid silently dropping fields when a single call would need 30-45 assignments.
3. **`get_entries(sectionId?, phase?)`** — read-only lookup against real persisted `FieldEntry` data, so "what did we already put for X" is answered from truth, not conversational memory or guesswork.
4. **`learn_skill(title, rule)`** — persists a behavioral correction as an `AgentSkill` row, folded into the system prompt on every subsequent turn, forever (until an admin deletes it). This is the real mechanism behind "the agent remembers being corrected."
5. **`navigate_stage(stage)`** — requests the client jump to a milestone (cpf/crf/build/deploy/monitor).

### 12.2 System Prompt Behavior
Explicit rules govern tool-selection discipline: only propose fills for genuine new-value requests; always resolve a section via `match_section` before proposing a fill; never invent a value the user didn't state; ask rather than guess if no section matches; never claim a value was "applied" (only ever "staged, awaiting confirmation"); reuse an established section from earlier in the conversation for corrections rather than re-matching a bare fragment. The agent's identity is explicitly locked to "the Novartis Accelerate assistant," with an instruction never to reveal it's a general LLM.

### 12.3 File Upload
Users can attach a PDF/.docx/.xlsx/.csv brief; server-side parsing extracts plain text (truncated ~24k chars) and feeds it into the same chat flow as if typed — no separate ingestion pipeline.

### 12.4 What's Real vs. What Might Be Legacy
There are two client-side code paths referencing "fill from chat" — the real SSE/tool-calling flow against `/api/agent-fill`, and an older deterministic keyword/alias matcher (`parseFillCommand`/`matchSectionByQuery`) that may be dead legacy code from before the real agent existed. **This needs a direct verification pass before a PRD assumes only one fill mechanism exists.**

---

## 13. The "Plan" Tab (Campaign Ops Timeline)

A dedicated nav item (distinct from the request detail page), styled in Campaign Ops' own brand color, showing every currently open (non-completed) request as a row with three date-picker inputs: Discovery session ETA, CPF completion ETA, CRF completion ETA. Each edit persists immediately (`PlanMilestone`, per-`tactplanId`). Explicitly scoped to only these 3 milestones "for now" — a natural next step is extending it to the other `MILESTONES` (Build & Proofing, Asset Handoff, Deployment, Monitoring).

---

## 14. Export Features

- **Real**: `GET /api/admin/export` — genuine server-side Excel (.xlsx) export of the live `FormField` schema table (structure/config, not entered campaign data).
- **Mock/demo only**: `downloadCpfDetailsPdf()` and `downloadCmaMetadataPdf()` generate a real, valid, but placeholder-content single-page PDF client-side (no library, hand-built PDF byte format) — the text inside is literally hardcoded ("Placeholder CPF details export," "All 45 fields complete") and does **not** pull actual entered field values. These exist as UI affordance/proof-of-concept for a "download my completed brief" feature, not the feature itself.
- There is currently no way to export a request's actual entered `FieldEntry` values to Excel/PDF — only the schema (Admin export) and dummy PDFs exist.

---

## 15. Full API Reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload` | Parse an uploaded PDF/docx/xlsx/csv to plain text for the chat |
| GET | `/api/brands?q=` | Brand autocomplete |
| GET | `/api/indications?brand=` | Indication autocomplete for a brand |
| GET | `/api/brand-lookup?brand=&indication=` | Asset Scope inference support |
| POST | `/api/entries` | Bulk upsert entered field values |
| GET | `/api/entries?tactplanId=&phase=&sectionId=` | Query entered field values |
| GET | `/api/admin/export` | Excel export of FormField schema |
| GET | `/api/schema` | Full FormSection+FormField tree (live form source) |
| POST/PUT/DELETE | `/api/admin/sections[/:id]` | Section CRUD |
| POST | `/api/admin/sections/:id/fields` | Create a field under a section |
| PUT/DELETE | `/api/admin/fields/:id` | Field update/delete |
| GET | `/api/nudge-rules` | Active nudge rules (live form consumes this) |
| GET/POST/PUT/DELETE | `/api/admin/nudge-rules[/:id]` | Nudge rule CRUD (admin) |
| GET | `/api/tactic-templates` | All CRF #N templates (live form consumes this) |
| GET/POST/PUT/DELETE | `/api/admin/tactic-templates[/:id]` | Tactic template CRUD (admin) |
| GET | `/api/plan-milestones` | All Plan tab rows |
| PUT | `/api/plan-milestones/:tactplanId` | Upsert a request's ETA dates |
| GET | `/api/skills` | All learned agent behavioral corrections |
| DELETE | `/api/skills/:id` | Retract a learned correction |
| POST | `/api/agent-fill` | SSE chat/tool-calling agent loop |
| GET | `/api/health` | Health check |

---

## 16. Known Gaps / Explicitly Out of Scope Today

These are the honest, current limitations a from-scratch PRD should treat as open questions rather than assume are solved:

1. **No authentication or authorization** at all — anyone can act as any persona, reach any admin function.
2. **The requests list (`REQUESTS`) is not database-backed** — it's a static in-memory array. There's no real "create a new campaign request" persistence path, no real request-level status transitions, no multi-user concurrency handling.
3. **The Ownership view is a hand-maintained static summary**, not derived from real per-field owner data — can silently drift out of sync with Admin edits.
4. **BU Setup and Visio Builder state live in browser `localStorage`**, not the server — not visible across users/sessions/devices, lost if browser storage is cleared.
5. **No real export of entered campaign data** — only schema export (Excel) and placeholder-content PDFs exist.
6. **The "audience gate" toggle is a manually-set flag**, not derived from whether a section's content is actually audience-conditioned — easy to mis-configure (happened once already).
7. **Possible legacy/dead chat-fill code path** alongside the real Gemini tool-calling agent — needs verification.
8. **Plan tab covers only 3 of the app's 6 milestones** (Discovery, CPF, CRF) — Build/Handoff/Deployment/Monitoring aren't tracked there yet.
9. **No section reordering UI**, no bulk-import for form structure beyond the one-time historical migration scripts.
10. **Docker packaging exists but was never build-verified** in this environment.

---

## 17. Suggested Framing for a Downstream "Suggest Feature" PRD Tool

Given the above, a system generating feature suggestions/PRDs from this reference should reason in terms of:
- **Who** (which of the 6 personas, or "admin," or "unauthenticated/all") a feature serves.
- **Which phase** (preplan/CPF, plan/CRF, exec) or milestone (of the 6) it applies to.
- **Whether it's schema-level** (something Admin should be able to configure without code) **or workflow-level** (something that changes what happens when a user takes an action).
- **What's already data-driven** (sections, fields, tactic templates, nudges, conditions, plan milestones) versus **what's still hardcoded/mock** (Section 16) — a suggested feature that extends something already data-driven is far cheaper to ship than one that requires first migrating a mock into real data.
