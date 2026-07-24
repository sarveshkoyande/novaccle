# HQE Accelerate — Requirement Platform
## UX research, design rationale, and platform specification

**Purpose.** This document captures the end-to-end thinking behind the HQE Accelerate Requirement Platform — a system for collecting a 173-field pharma campaign brief from multiple stakeholders across pre-planning, planning, and execution phases, backed by an AI briefing agent. It brings together the UX research grounding, the 14 best practices we derived, and how each one manifests in the platform design.

Use it as a reference for stakeholder walkthroughs, engineering handoff, or as the source-of-truth rationale when future design decisions are contested.

---

## 1. The problem

We are designing an intake system where:

- **200+ fields** must be collected across ~9 sections (Generic/Overview, Journey, OMS Enrollment, MCI Reporting, Email, MDS Target List, Data Cloud, Automatrix, SMS).
- **Multiple stakeholders** own different slices: AOR (agency), XM (experience/brand), MDS (target list), CEP (platform/data cloud), and Campaign Ops.
- **Phases** progress from pre-planning → planning → execution → monitoring, with dependencies between fields (channels drive downstream sections; FUSE IDs unlock Automatrix; go-live cascades into MLR back-planning).
- **Conditional logic** removes or reveals whole sections (e.g., SMS setup only exists if SMS is a selected channel).
- **Cognitive load** is the enemy — no stakeholder should confront the full 173-field surface.

**The instinct** with an "agent" is to make it conversational. The research says don't — at least not as the primary surface.

---

## 2. The core insight

Neither a chatbot nor a form survives 200 fields.

- **Conversational one-question-at-a-time formats** start actively hurting completion around 12–14 questions.
- **B2B environments** where accuracy, speed, and trust matter, chat replacing forms actively hurts usability. Forms remain the most efficient pattern for structured, repeatable data.
- **2026 generative-UI research** goes further: chat alone is a poor medium for structured, stateful human-agent work, because linear conversations break down on visibility, spatial memory, and user control.

But a flat 200-field form is equally dead on arrival — over **67% of respondents abandon a form** if they encounter complications, and the intimidation of seeing full scope up front is itself a complication.

**The winning architecture is a third thing:** an orchestration platform where the agent's job is to minimise how many of the 200 fields any human ever has to touch, and structured micro-forms handle the rest. The agent isn't the form. The agent is the producer who pre-fills, routes, chases, reconciles, and asks only what it genuinely cannot infer.

**Guiding philosophy for the whole platform:** *the user's job is to correct and confirm, not to fill.* Every design decision — pre-fill, branching, scoping, sequencing — should serve reducing the human's perceived workload from 200 fields to a couple dozen judgments.

---

## 3. The 14 UX best practices

Each practice below is tied to the research that grounds it and to the specific mechanism in the platform that delivers it.

### Practice 1 — Persona-scoped lens
Field-level ownership + role visibility: every stakeholder sees only their slice. Nobody ever faces all 173 fields.

- **In the platform:** persona dropdown top-right of the app bar (not a centerpiece). Switching personas rescopes the workspace: the requests list, the "Your action" column, the "Needs your input" highlights on sections.

### Practice 2 — Effective field count
Perceived workload stated up front. Perceived length drives completion more than actual length.

- **In the platform:** the request hero states "80 of 173 fields resolved"; the section header states "X fields to fill" per phase; the SME micro-session opens with "~5 min" and a specific count.

### Practice 3 — Task-list hub (GOV.UK pattern)
Sections as tasks with statuses; any-order completion; the re-entry point across sessions; grouped by real phases.

- **In the platform:** the request detail is one continuous list of 9 sections, always in the same order, with per-section status, ownership, and field counts. Sessions resume where the user left off.

### Practice 4 — Dependency-aware statuses
"Cannot start yet" names the blocker and what unlocks it — users plan instead of guessing.

- **In the platform:** Automatrix section shows "Section unlocks only after Email provides FUSE ID. 9 of 14 fields will then cascade automatically." The Section note explains why, not just that.

### Practice 5 — AI pre-fill with provenance
Confidence-triaged: auto-accept / confirm / manual. Every AI value carries a source, a timestamp, and a visible tint until a human confirms it.

- **In the platform:** AI-drafted fields render on an orange-tinted background with the source line below ("AI draft · Q3 Strategy deck p.14"). Confirmed values leave provenance in the audit log but shed the tint.

### Practice 6 — Conditional branching
Channel and yes/no choices add or remove whole sections and route their owners. Irrelevant fields never render.

- **In the platform:** Email section carries the note "appears because Email was selected in Campaign channels. If deselected, all fields release automatically." Data Cloud section: "Exists only because this campaign activates through Data Cloud."

### Practice 7 — Small steps, single column
4–7 fields per screen (Baymard). Bidirectional stepper — never a one-way wizard; inputs preserved on back-navigation.

- **In the platform:** each phase group inside a section renders as a two-column grid of 6–8 fields max. All navigation is bidirectional; autosave preserves state at every keystroke.

### Practice 8 — Inline + cross-field validation
Errors at the field, at entry time (shown +22% completion in Zuko research); the agent also back-plans dates and checks totals across sections and stakeholders.

- **In the platform:** campaign code format is validated on entry (CXPO vs OMS); go-live dates trigger back-planned manuscript deadlines with warnings; audience-size discrepancies surface as explicit conflicts.

### Practice 9 — Hybrid conversation
Chat for ambiguity, distribution, and why; structured fields remain the source of truth. Neither chat-only nor form-only.

- **In the platform:** the chatbot occupies a persistent 30vw right column. It accepts pasted paragraphs and distributes them into the right structured fields with source and confidence. The form remains the record.

### Practice 10 — Explain-why on demand
Every question carries its business reason; explaining why yields more complete answers (intake research).

- **In the platform:** field help text and the chatbot both articulate downstream impact ("The campaign code is the join key across MDS, MCI and Automatrix — capture it once and I cascade it into 6 fields").

### Practice 11 — SME micro-session
Scoped, time-boxed, review-and-confirm visits. The SME corrects and confirms — they do not fill.

- **In the platform:** when an SME opens a request, only sections needing their input auto-expand, with a "Your focus" card that lists exactly the sections they must touch — nothing else demands attention.

### Practice 12 — Conflict reconciliation
Cross-stakeholder contradictions become explicit decisions with context, and land in an auditable discrepancy log.

- **In the platform:** audience-size mismatch between AOR (~48,000 estimated) and MDS (31,204 post-suppression count) surfaces as a conflict card with three resolution options and a written explanation of the delta.

### Practice 13 — Autosave & resume
Continuous save, no lost work, resume from the hub. Long transactions assume interruption.

- **In the platform:** the top bar always shows "All changes saved." Sessions resume mid-form; returning users land back on the request list, not stranded on a half-completed step.

### Practice 14 — Check your answers
Assembled brief with gaps named, provenance per value, and a submit gate that lists exactly what remains and who owns it.

- **In the platform:** the brief summary view renders every field with its source line and named gaps; submit is gated until each open item is resolved by name — not by generic "form incomplete."

---

## 4. Platform architecture

The system has three surfaces, tied together by one continuous artefact (the brief) and one persistent agent.

### 4.1 The landing page

The home of the platform. Users land here on every visit and after every completed session.

**Elements:**
- **App bar** — brand mark, top nav (Requests · Templates · Reports · Admin), autosave indicator, notifications, and **persona dropdown top-right**.
- **Hero** — "Campaign requests" headline, scope-explained subtitle, and a prominent **+ New campaign request** button.
- **Stats strip** — active count, needing-my-input count, AI-drafted values, live campaigns.
- **Filter chips** — All, Needing my input, by phase, Completed.
- **Requests table** — rows with brand icon, name, TactPlan ID, current phase, owner avatars, and a persona-scoped "Your action" pill. Rows needing the current persona's input are marked with an orange left-edge.

### 4.2 The request detail

Every campaign request opens into the same layout. The layout does not change across phases — only content editability and visibility do.

**Elements, top to bottom:**
1. **Breadcrumb** back to Requests.
2. **Request hero** — campaign name, TactPlan ID, brand/indication, channels, go-live, plus at-a-glance metrics (brief readiness %, fields resolved, days to go-live).
3. **Phase timeline** — Pre-planning · Planning · Execution · Monitoring, with the current phase visible and clickable (in the mock) to preview scoping in other phases. Legend strip below explains the four field states.
4. **Sections list** — all 9 sections rendered in a fixed sequence, always. Each is expand/collapse; sections needing input auto-expand.
5. **Right sidebar** (inside the 70vw content column) — "Your focus" card and "Section ownership" reference.

### 4.3 The persistent AI chatbot

A **30vw right-hand column, fixed** from the top of the app bar to the bottom of the viewport, visible on every screen.

**Elements:**
- **Header** — agent name, availability indicator, grounding sources ("knows TactPlan, brand strategy, playbooks").
- **Message stream** — bot and user messages; bot replies include structured cards when placing values into fields.
- **Suggestion chips** — "Fill from last Kisqali wave", "What's left for me?", "Explain the current phase", "Draft the campaign goal".
- **Input** — free-text with Enter-to-send, accepts pasted paragraphs and distributes them into fields.

The chatbot is never dismissed. It is not a FAB, not a modal, not a slide-out. It is a permanent part of the workspace, because the research finding is that structured fields need chat *alongside*, not chat *instead of*.

---

## 5. Section structure (exact Excel names, fixed order)

| # | Section name | Primary owners | Approx fields |
|---|---|---|---|
| 01 | Generic/Overview | AOR, XM | 29 |
| 02 | Journey | AOR, Ops (build fields) | 20 |
| 03 | OMS - Enrollment Form Details | AOR | 16 (conditional) |
| 04 | MCI - Campaign Performance Reporting | CEP, Ops | 5 |
| 05 | Email | AOR | 26 (channel-conditional) |
| 06 | MDS - Target List and Supressions | MDS, XM | 20 |
| 07 | Data Cloud details | CEP | 9 (conditional) |
| 08 | Automatrix | AOR | 14 (locked until FUSE ID) |
| 09 | SMS | AOR, XM | 30 (channel-conditional) |

The order is fixed across every request, every phase, every persona. This is deliberate: **cognitive orientation** is preserved — users learn "MDS is section 6" once, and that lookup never changes.

---

## 6. Phase-gated field visibility

The single most important structural rule in the platform.

**All 9 sections are always visible.** What changes across phases is which *fields* inside each section are visible and editable.

| Phase | Pre-planning fields | Planning fields | Execution fields |
|---|---|---|---|
| Pre-planning (current) | Editable | Hidden | Hidden |
| Planning (current) | **Locked (read-only)** | Editable | Hidden |
| Execution (current) | **Locked (read-only)** | **Locked (read-only)** | Editable |
| Monitoring (current) | Locked | Locked | Locked |

**When a section has no fields in the current phase**, the section header still renders in its usual slot with an inline note: *"This section has no fields in the [Phase] phase. It stays visible so the form structure never shifts."* This preserves the spatial map users build over time.

**Visual encoding:**
- Editable-phase groups: white background, solid borders, brand-tinted focus states.
- Locked-phase groups: grey background, dashed borders, muted text, small padlock badges.
- AI-drafted values (in editable groups only): orange-tinted background until confirmed.
- Never-yet-unlocked fields: not rendered.

---

## 7. Persona-based scoping

Five personas are modelled:

- **AOR** (Priya, Ogilvy Health) — primary owner of ~116 of 173 fields.
- **XM** (Megan, Novartis) — 12 fields, mostly decisions and specialty rules.
- **MDS** (Anita) — 23 fields, all target-list and suppressions.
- **CEP** (Tomás) — 14 fields, Data Cloud and MCI.
- **Campaign Ops** (Derek) — 9 build-time fields at execution.

**How persona affects the UI:**
- Requests list rows highlight when the persona's action is required.
- "Your action" column changes text and colour per persona.
- Sections requiring the persona's input get an orange left-edge and "Needs your input" tag; they also auto-expand on load.
- "Your focus" sidebar lists only the sections the persona needs to touch this phase.
- Empty-lane personas see an "All clear" empty state — the platform never manufactures work.

**What persona does not affect:**
- The section list — all 9 sections show for everyone, in the same order.
- The phase timeline — every persona sees the same campaign progression.
- The brief itself — one source of truth, one shared artefact.

---

## 8. Visual system

**Palette (Novartis brand + semantic accents):**
- **Primary blue** `#0460A9` — brand, actions, active states, links, progress rings.
- **Orange** `#E74A21` — AI provenance, "needs your input" highlights, current-phase node.
- **Gold** `#EC961D` — warnings, in-progress states, planning-phase dot.
- **Semantic:** green for completed, red for errors/conflicts, grey for locked, blue tint for read-only-cascaded.

**Typography:** Nunito, exclusively. 400 for body, 500 for controls, 600–700 for emphasis, 800 for display and headings. IDs and codes use tabular numerals with tight letter-spacing for a monospace feel while staying inside the family.

**Layout grid:**
- App bar: full width, 60px tall, sticky.
- Content stage: `100vw` minus `30vw` (chatbot). Padded 26px.
- Chatbot: fixed right, `30vw` wide, top to bottom.
- Below 900px viewport: chatbot drops to a bottom drawer (45vh); content reclaims full width.

**Elevation:** conservative. Cards use a 4px + 14px stacked shadow. The chatbot header uses a slight inset shadow to feel anchored. Floating elements (toasts) sit bottom-left to avoid colliding with the fixed chat column.

---

## 9. Key interaction patterns

### Pre-fill and cascade
- On new request, agent extracts values from TactPlan and prior waves.
- One entered field cascades into multiple downstream fields (Campaign code → MDS, MCI, Automatrix).
- Cascaded values render with a "⇢ Cascaded" source line — they are not editable in the receiving field; they follow the source.

### Confirmation
- AI drafts render on an orange tint.
- A single click on the field's Confirm mini-button converts the tint to a confirmed-and-committed state.
- Confirmation is captured in the audit log with the persona name and timestamp.

### Conflict resolution
- When two stakeholders provide contradictory values on related fields, the platform surfaces a conflict card with the two values, the reason for the delta, and 2–3 resolution options.
- Resolution routes to the correct owner (typically XM for cross-team conflicts) and lands in the discrepancy log.

### Reminders and workflow
- Agent-driven nudges based on due dates back-planned from go-live (MLR needs 6 weeks, manuscript deadline auto-calculated).
- Workflow triggers fire automatically when upstream sections are confirmed: e.g., campaign overview confirmed → Campaign Ops notified → intake task created.

### Section notes
- Certain sections (SMS, OMS, Automatrix, Data Cloud) render a persistent note explaining why they exist or why they are locked.
- Notes use gold-tinted callouts to distinguish from field errors (red) and AI drafts (orange).

---

## 10. What's illustrated in the mock

The interactive HTML mock demonstrates:

- **Landing screen** with 7 sample requests across brands (Kisqali, Cosentyx, Entresto, Leqvio, Pluvicto, Scemblix, Kesimpta).
- **Persona switcher** — dropdown top-right, switches between 5 personas; whole workspace rescopes.
- **Request detail** for TP-88213 (Kisqali HCP Adjuvant Q3 Wave 2) with all 9 sections in fixed order.
- **Phase timeline** — click any phase pill to preview how field visibility and editability rescope.
- **Persistent chatbot** — 30vw right column, always visible, with functional suggestion chips.
- **Section notes**, AI-drafted values, cascaded values, locked-until-dependency states.
- **Persona-scoped highlighting** — orange edge, "Needs your input" tag, "Your focus" card.

---

## 11. Sources cited

The research grounding drew from:

- **Baymard Institute** — form design research on single-column layouts, error handling, and abandonment triggers.
- **Nielsen Norman Group** — wizard patterns, complex application design, interrupted-workflow resilience.
- **GOV.UK Design System** — task list pattern for multi-session transactions; "Cannot start yet" dependency status vocabulary.
- **Zuko form analytics** — inline validation impact on completion (+22%).
- **Typeform text-sentiment research** — positive-tone forms complete at ~55% vs 38% for negative tones.
- **Salesforce, Workday, Notion** documentation on workflow forms with field-level permissions and multi-submitter patterns.
- **LogicGate** — AI pre-fill with review-and-confirm badging.
- **Generative UI research (2026)** — chat as poor primary surface for structured stateful work.

---

## 12. Open questions and next iterations

**Known open items** for future rounds:

1. **Ownership matrix as a configurable admin surface** — currently modelled statically; needs UI to let admins reassign fields.
2. **Templates library** — pre-approved briefs by brand and use case; not yet designed.
3. **Reports** — cycle time, drop-off, and discrepancy trends; placeholder in top nav.
4. **Approvals and sign-offs** — MLR and XM approval steps; workflow hooks stubbed but not yet visualised.
5. **Mobile experience** — the mock adapts below 900px, but SME micro-sessions on mobile need dedicated design.
6. **Version history and change tracking** — audit log exists conceptually; UI to browse it is not built.
7. **Enrollment form (OMS) expansion** — 15 additional fields render only when "triggered = Yes"; branching logic and field content need product review.
8. **New CI creation sub-form in Data Cloud** — 4-field sub-form referenced but not built.

---

## 13. Chat conversation summary

For posterity, this document consolidates the design work across a multi-turn conversation:

- **Turn 1** — commissioned deep UX research on requirement collection agents; delivered the core insight (neither chat nor flat form) and 14 practices with citations.
- **Turn 2** — built the first interactive mock: persona lens as chips, phase task hub, field capture stepper, agent side panel.
- **Turn 3** — applied Novartis brand colours (blue `#0460A9`, orange `#E74A21`, gold `#EC961D`) across the palette.
- **Turn 4** — major architectural rework: converted to a proper platform with landing screen, persona dropdown top-right, all 9 sections always visible in fixed sequence, phase-gated field editability, and a persistent floating chatbot.
- **Turn 5** — final polish: exact Excel section names in specified order; Nunito font throughout; chatbot promoted to persistent 30vw right column (no FAB, always visible).

The final artefact — `hqe-requirement-studio-mock.html` — is the definitive reference for the platform design.

---

*Document version: v1.0 · Prepared for internal design and engineering handoff.*
