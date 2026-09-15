import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { REQUESTS, buildCampaignRequest, buildGenericOverviewEntries } from '../data/requests';
import { useSessionStore } from '../stores/useSessionStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import PhaseGroup from '../components/PhaseGroup';
import ChatPanel from '../components/ChatPanel';
import CampaignBar from '../components/CampaignBar';
import CrfTabsSlot from '../components/CrfTabsSlot';
import DetailsResizer from '../components/DetailsResizer';
import CommentsDrawer from '../components/CommentsDrawer';
import VisioBuilderPanel from '../components/VisioBuilderPanel';
import FlowTimelinePanel from '../components/FlowTimelinePanel';
import { condMet, deriveCampaignConfig } from '../cond';
import { evaluateNudgeRules, getFiredRuleIds, markRulesFired } from '../nudges';
import { toPlainText } from '../plainText';
import { useChatStore } from '../stores/useChatStore';
import type { FormSection } from '../types';

const PHASES = ['preplan', 'plan', 'exec'] as const;
const PHASE_ORDER: Record<string, number> = { preplan: 0, plan: 1, exec: 2 };

// Ported from index.html's #view-request + renderSections()'s "glance"
// (master-detail) mode — the accordion layout mode isn't implemented in
// this pass. Chat/details split reuses the ORIGINAL app's own CSS
// (body[data-view="request"][data-details] rules in legacy-design-system.css)
// by stamping the same data attributes onto <body>, rather than
// reimplementing that layout in React.
export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentPersona = useSessionStore((s) => s.currentPersona);
  const queryClient = useQueryClient();
  // Chat/split/form layout is shared app-bar state (useLayoutStore) rather
  // than local to this page, since the three-way toggle lives in the app
  // bar, not here — the old per-page "Hide/Show details" button was a
  // second, redundant control for the same thing and has been removed.
  const layoutMode = useLayoutStore((s) => s.mode);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  // null = "not yet touched by the user" — defaults to whichever gate
  // actually has editable content for this request instead of always
  // opening on Pre-planning, which would land a mid/late-phase request on
  // an empty-looking board.
  const [viewedGateOverride, setViewedGateOverride] = useState<'preplan' | 'planning' | 'exec' | 'flow' | 'timeline' | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // Flips true in the SAME effect run that seeds fieldValues (below), not
  // merely when entriesQuery.data first arrives — those aren't the same
  // moment. Passed to ChatPanel as entriesLoaded, gating its
  // [[system:campaign_created]] auto-continuation: firing it as soon as
  // entriesQuery.data existed (regardless of whether fieldValues had
  // actually been populated from it yet) was still racy in exactly the way
  // this flag exists to prevent — see ChatPanel's own comment on it.
  const [fieldValuesSeeded, setFieldValuesSeeded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const commentsQuery = useQuery({ queryKey: ['comments', id], queryFn: () => api.getComments(id!), enabled: !!id });
  // Ported back from the original's formScope simple/full switch
  // ("Show only what needs me" / scopeToggleMarkup) — 'focus' filters the
  // section list to just what's still waiting on you (plus whichever
  // section is currently open, so it never vanishes out from under you the
  // moment you finish it); 'all' shows the whole list unfiltered.
  const [scopeMode, setScopeMode] = useState<'focus' | 'all'>('focus');

  const request = REQUESTS.find((r) => r.id === id);
  // currentPhase comes straight from the request's own seeded phase — see
  // this session's earlier fix to the original app for exactly why NOT to
  // derive it from a milestone lookup instead.
  const currentPhase = request?.phase || 'preplan';
  const viewedGate = viewedGateOverride ?? (currentPhase === 'preplan' ? 'preplan' : 'planning');

  useEffect(() => {
    document.body.dataset.view = 'request';
    document.body.dataset.details = layoutMode === 'chat' ? 'collapsed' : layoutMode === 'form' ? 'formfull' : 'open';
    // "compact" list mode is the ONLY mode in the current design (per
    // legacy-design-system.css's own comment: "data-list is pinned to
    // compact ... there is no switch any more") — its .sm-detail-panel
    // pops out as a sliding overlay over the list, gated by data-detail.
    // Missing this second, differently-named attribute (data-detail, not
    // data-details) was the real bug behind "I click a section and nothing
    // opens" — .sm-detail-panel is CSS `display:none` by default
    // (`body:not([data-detail="open"]) .sm-detail-panel{display:none}`)
    // until this is set, regardless of what React state says.
    document.body.dataset.list = 'compact';
    return () => {
      delete document.body.dataset.view;
      delete document.body.dataset.details;
      delete document.body.dataset.list;
    };
  }, [layoutMode]);

  useEffect(() => {
    if (openSectionId) document.body.dataset.detail = 'open';
    else delete document.body.dataset.detail;
    return () => {
      delete document.body.dataset.detail;
    };
  }, [openSectionId]);

  const schemaQuery = useQuery({ queryKey: ['schema'], queryFn: api.getSchema });
  const entriesQuery = useQuery({
    queryKey: ['entries', id],
    queryFn: () => api.getEntries(id!),
    enabled: !!id,
  });
  const sectionStateQuery = useQuery({
    queryKey: ['section-state', id],
    queryFn: () => api.getSectionState(id!),
    enabled: !!id,
  });
  const nudgeRulesQuery = useQuery({ queryKey: ['nudge-rules-active'], queryFn: api.getActiveNudgeRules });
  const chatAddMessage = useChatStore((s) => s.addMessage);

  const sections: FormSection[] = schemaQuery.data?.sections || [];
  const submittedSections = new Set(sectionStateQuery.data?.submitted || []);
  const campaignConfig = useMemo(() => deriveCampaignConfig(sections, fieldValues), [sections, fieldValues]);

  // evaluateNudgeRules() ports the trigger logic that used to be hardcoded
  // branches in the original app's runReactCheckpoint() — never previously
  // wired up in this rewrite, so every NudgeRule row sat in the admin CRUD
  // completely inert. Fires at most once per rule per campaign (tracked in
  // localStorage): the rule's own `message` lands as a normal chat message
  // in this campaign's thread, and if it names a `nudgeToOwner`, a real
  // @mention comment goes out to that role too — the same persisted
  // Conversations-thread mechanism notify_stakeholders uses, which is what
  // makes it show up in that role's notification bell.
  useEffect(() => {
    if (!id || !nudgeRulesQuery.data || !sections.length) return;
    const fired = evaluateNudgeRules(nudgeRulesQuery.data.rules, { sections, fieldValues, submittedSections, currentPhase, campaignConfig });
    if (!fired.length) return;
    const already = getFiredRuleIds(id);
    const newlyFired = fired.filter((f) => !already.has(f.rule.id));
    if (!newlyFired.length) return;
    markRulesFired(id, newlyFired.map((f) => f.rule.id));
    newlyFired.forEach((f) => {
      chatAddMessage(currentPersona, id, { id: `nudge-${f.rule.id}-${Date.now()}`, role: 'bot', kind: 'text', text: f.message });
      if (f.rule.nudgeToOwner) {
        api.addComment({
          tactplanId: id,
          sectionId: 'project',
          authorPersona: currentPersona,
          body: toPlainText(f.rule.nudgeMessage || f.message),
          mentions: [f.rule.nudgeToOwner],
          source: 'agent',
        }).then(() => {
          // Same immediacy fix as handleNotifyStakeholders — some rules
          // (e.g. the CMA Metadata Sheet reminder) target 'aor', which can
          // be the CURRENT persona, so their own bell needs this right away
          // rather than waiting out the 20s poll.
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nudgeRulesQuery.data, sections, fieldValues, submittedSections, currentPhase, currentPersona, campaignConfig]);

  // Seed local field-value state from the fetched entries once, then edits
  // live purely in local state until Save writes them back — that was
  // always the intent (see the comment), but the code didn't actually
  // enforce "once": this effect's only dependency was entriesQuery.data,
  // so it re-ran and clobbered ALL local unsaved state (every chat-
  // confirmed proposal, every quiz answer) on every background refetch of
  // the same campaign — and with a bare `new QueryClient()` (App.tsx),
  // React Query's defaults (staleTime 0, refetchOnWindowFocus true) mean
  // that's not rare: switching browser tabs and back was enough to wipe
  // an entire in-progress chat session's worth of confirmed-but-unsaved
  // fields back to whatever was last actually persisted. Verified this was
  // the real cause of a reported "it confirmed my values, then later
  // erased everything" bug — a background refetch landed between
  // confirmations. Now seeds once per campaign (tracked by id) and never
  // again for that same campaign, so only a genuine campaign switch
  // re-seeds; a refetch of the SAME campaign's entries no longer touches
  // in-progress local state at all.
  const seededForId = useRef<string | null>(null);
  useEffect(() => {
    if (!entriesQuery.data || !id) return;
    if (seededForId.current === id) return;
    seededForId.current = id;
    const seeded: Record<string, string> = {};
    entriesQuery.data.entries.forEach((e) => {
      seeded[e.fieldId] = e.value;
    });
    setFieldValues(seeded);
    setFieldValuesSeeded(true);
  }, [entriesQuery.data, id]);

  // Auto-select the first section only ONCE, when the list first loads —
  // not on every re-render where openSectionId happens to be null, or
  // clicking Close (which sets it null on purpose) would immediately
  // re-open section 1 right back up.
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (!hasAutoSelected.current && sections.length) {
      hasAutoSelected.current = true;
      setOpenSectionId(sections[0].id);
    }
  }, [sections]);

  const selected = sections.find((s) => s.id === openSectionId) || null;

  // Feeds get_interview_state/get_missing_fields/propose_derived_fills —
  // useAgentFill was never actually sending any of this (the tools always
  // got ctx.remaining/blocked/interview/derived as null/empty, no matter
  // which campaign was open), so "let's pull up the interview" or "what's
  // still needed" always failed even on a real, in-progress campaign, not
  // just a freshly created one. This computes it from the same field data
  // the section list/detail panel already use.
  const interviewData = useMemo(() => {
    const remaining: { sectionId: string; sectionName: string; field: string }[] = [];
    const blocked: { sectionId: string; sectionName: string; field: string; reason: string }[] = [];
    const byLabel: Record<string, string> = {};
    // fieldKey -> answered value, so a field with an explicit derivesFrom
    // (set via the admin schema, e.g. OMS Brand derivesFrom "1.1.3") can be
    // matched reliably instead of only by coincidentally-identical label
    // text — label matching alone missed anything where the source and
    // target fields are phrased differently (Campaign <- Campaign Name).
    const byFieldKey: Record<string, string> = {};
    sections.forEach((s) => {
      s.fields.forEach((f) => {
        const v = fieldValues[f.id];
        if (v) {
          byLabel[f.label.trim().toLowerCase()] = v;
          if (f.fieldKey) byFieldKey[f.fieldKey] = v;
        }
      });
    });
    // The remaining-fields loop below also needs each field's own fieldKey
    // and derivesFrom, so track the FormField alongside its display row
    // rather than re-scanning sections to look it up afterward.
    const remainingFields: { sectionId: string; sectionName: string; field: string; fieldId: string; fieldKey: string; derivesFrom?: string | null }[] = [];
    sections.forEach((s) => {
      const submitted = submittedSections.has(s.id);
      s.fields.forEach((f) => {
        if (f.locked || f.owner !== currentPersona || fieldValues[f.id] || !condMet(f.cond, fieldValues, campaignConfig)) return;
        if (submitted) {
          blocked.push({ sectionId: s.id, sectionName: s.name, field: f.label, reason: 'Submitted and read-only.' });
        } else if (f.phase !== currentPhase) {
          blocked.push({ sectionId: s.id, sectionName: s.name, field: f.label, reason: `Not editable until the ${f.phase} stage.` });
        } else {
          remaining.push({ sectionId: s.id, sectionName: s.name, field: f.label });
          remainingFields.push({ sectionId: s.id, sectionName: s.name, field: f.label, fieldId: f.id, fieldKey: f.fieldKey, derivesFrom: f.derivesFrom });
        }
      });
    });
    const derived = remainingFields
      .map((r) => {
        const value = (r.derivesFrom && byFieldKey[r.derivesFrom]) || byLabel[r.field.trim().toLowerCase()];
        // fieldId travels alongside the label so propose_derived_fills'
        // Confirm button can write straight into fieldValues (keyed by
        // fieldId, same as every other proposal) instead of silently
        // writing to fieldValues[undefined] when only the label was sent.
        return value ? { sectionId: r.sectionId, sectionName: r.sectionName, field: r.field, fieldId: r.fieldId, value } : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const interview = {
      stage: currentPhase,
      stageOpen: remaining.map((r) => ({ sectionId: r.sectionId, field: r.field })),
      nextQuestions: remaining.slice(0, 5),
      derivableCount: derived.length,
    };
    return { remaining, blocked, derived, interview };
  }, [sections, fieldValues, campaignConfig, submittedSections, currentPersona, currentPhase]);

  // Ported from renderSections()'s row-building loop — top-level sections
  // (no parentId) in order, each immediately followed by its own children
  // (e.g. Journey -> Touch Point #1/#2), indented. A flat sections.map()
  // silently dropped every child section (Touch Points etc.) entirely.
  const listRows = useMemo(() => {
    const topLevel = sections.filter((s) => !s.parentId);
    const out: { section: FormSection; indent: boolean }[] = [];
    topLevel.forEach((s) => {
      out.push({ section: s, indent: false });
      sections.filter((k) => k.parentId === s.id).forEach((k) => out.push({ section: k, indent: true }));
    });
    return out;
  }, [sections]);

  // Which phases the active gate tab actually shows — mirrors the filter
  // used for the detail panel's PhaseGroups below, so the section list's
  // counts move in lockstep with whatever gate is selected instead of
  // always reporting the same all-phases total regardless of tab.
  const gatePhases = viewedGate === 'preplan' ? (['preplan'] as const) : viewedGate === 'exec' ? (['exec'] as const) : (['plan'] as const);

  // This drives the row badge, "N need your input", and the Focus filter
  // itself — all three are framed as "what's on ME", so this has to be
  // owner-scoped. It wasn't: it counted ANY unfilled relevant field
  // regardless of who owned it, so e.g. AOR's Focus view showed sections
  // fully owned by OMS/CEP/XM/DCA as "needing input" — really someone
  // else's open work, not theirs. sectionDetailMeta's "X / Y filled · all
  // owners" line is deliberately NOT owner-scoped (it's a whole-section
  // progress readout, says so right in its own label) — this one is the
  // "is this actually mine to do" count, a different question.
  function sectionRemaining(s: FormSection) {
    const relevant = s.fields.filter(
      (f) =>
        !f.locked &&
        f.owner === currentPersona &&
        (gatePhases as readonly string[]).includes(f.phase) &&
        condMet(f.cond, fieldValues, campaignConfig),
    );
    const filled = relevant.filter((f) => !!fieldValues[f.id]);
    return { total: relevant.length, remaining: relevant.length - filled.length };
  }

  // Submission completeness is about the WHOLE section, not just whichever
  // gate happens to be on screen — otherwise saving while parked on the
  // Pre-planning tab could mark a section "submitted" while its Planning/
  // Execution fields are still empty.
  function sectionOverallRemaining(s: FormSection) {
    const relevant = s.fields.filter((f) => !f.locked && condMet(f.cond, fieldValues, campaignConfig));
    const filled = relevant.filter((f) => !!fieldValues[f.id]);
    return { total: relevant.length, remaining: relevant.length - filled.length };
  }

  // Ported from computeSectionRenderData()'s meta-array construction —
  // "N of M fields shown" only appears when a cond hid at least one field;
  // "K still on you" only appears when the current persona owns unfilled
  // fields, bold like the original.
  function sectionDetailMeta(s: FormSection) {
    const notLocked = s.fields.filter((f) => !f.locked);
    const relevant = notLocked.filter((f) => condMet(f.cond, fieldValues, campaignConfig));
    const filled = relevant.filter((f) => !!fieldValues[f.id]);
    const mine = relevant.filter((f) => f.owner === currentPersona);
    const mineFilled = mine.filter((f) => !!fieldValues[f.id]);
    const mineRemaining = mine.length - mineFilled.length;
    return {
      totalFields: notLocked.length,
      relevantCount: relevant.length,
      filledCount: filled.length,
      mineRemaining,
      isMine: mineRemaining > 0,
    };
  }

  const needingCount = listRows.filter((r) => sectionRemaining(r.section).remaining > 0).length;
  const visibleListRows =
    scopeMode === 'all' ? listRows : listRows.filter((r) => r.section.id === openSectionId || sectionRemaining(r.section).remaining > 0);

  // Ported (simplified) from renderCrfViewTabs()'s crfNavGoCpf()/setCrfView()
  // — the original swaps to a whole different board view per gate; here,
  // with a single stacked panel, "switching gates" scrolls the matching
  // phase group into view and pops it open if it's currently collapsed.
  function handleSelectGate(gate: 'preplan' | 'planning' | 'exec' | 'flow' | 'timeline') {
    setViewedGateOverride(gate);
    if (gate === 'flow' || gate === 'timeline') return;
    const targetPhase = gate === 'preplan' ? 'preplan' : gate === 'exec' ? 'exec' : 'plan';
    setTimeout(() => {
      const el = document.getElementById(`pg-${targetPhase}`);
      if (!el) return;
      const details = el.querySelector('details');
      if (details) details.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  // Looks up a field's own section/phase/label by id — every autosave path
  // below needs this to build the {sectionId, fieldId, phase, ...} shape
  // saveEntries expects, given only a fieldId.
  function findFieldMeta(fieldId: string) {
    for (const s of sections) {
      const f = s.fields.find((x) => x.id === fieldId);
      if (f) return { section: s, field: f };
    }
    return null;
  }

  // Debounced per-field autosave for direct typing — saving on every
  // keystroke would spam the API, but typing should still end up durable
  // without a separate save action, same as everything else now is.
  const typingSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function handleFieldChange(fieldId: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    if (!id) return;
    const meta = findFieldMeta(fieldId);
    if (!meta) return;
    clearTimeout(typingSaveTimers.current[fieldId]);
    typingSaveTimers.current[fieldId] = setTimeout(async () => {
      await api.saveEntries(id, [
        { sectionId: meta.section.id, fieldId, phase: meta.field.phase, value, sectionName: meta.section.name, fieldLabel: meta.field.label },
      ]);
      await queryClient.invalidateQueries({ queryKey: ['entries', id] });
    }, 600);
  }

  // record_quiz_answer's contract is "recorded immediately, no staging" —
  // unlike propose_fill (which only stages into local fieldValues until an
  // explicit Save & Continue), this writes straight through to the server
  // the moment it arrives, matching what the agent already tells the user
  // happened. The tool only ever has a field LABEL (never a fieldId), so
  // this looks it up in the given section by label.
  async function handleQuizAnswer(sectionId: string, fieldLabel: string, value: string) {
    if (!id) return;
    const section = sections.find((s) => s.id === sectionId);
    const field = section?.fields.find((f) => f.label.trim().toLowerCase() === fieldLabel.trim().toLowerCase());
    if (!section || !field) return;
    setFieldValues((prev) => ({ ...prev, [field.id]: value }));
    await api.saveEntries(id, [
      { sectionId: section.id, fieldId: field.id, phase: field.phase, value, sectionName: section.name, fieldLabel: field.label },
    ]);
    await queryClient.invalidateQueries({ queryKey: ['entries', id] });
  }

  // notify_stakeholders — a real @mention comment in the campaign's own
  // Conversations thread (the same PROJECT_COMMENT_SECTION sentinel
  // CommentsDrawer itself posts to), not just something said in chat.
  // Three posts: Campaign Ops (project setup/timeline/team allocation), the
  // other stakeholder roles (intake done, timelines TBD), and a short
  // self-confirmation mentioning whoever just ran the intake — without it
  // their own notification bell never shows anything for an action they
  // themselves triggered (the other two posts deliberately don't mention
  // them, since they're the sender, not a recipient), which read as
  // "nothing happened" even though the handoff notes were posted correctly.
  // Comment bodies are plain text in the Conversations drawer (no markdown
  // pass, unlike chat) — toPlainText() strips the **bold**/<b> markup the
  // model's own FORMATTING skill adds, which is correct for chat but shows
  // up as literal asterisks/tags here.
  async function handleNotifyStakeholders(tactplanId: string, opsMessage: string, otherTeamsMessage: string) {
    const req = REQUESTS.find((r) => r.id === tactplanId);
    const selfMessage = `Your new campaign intake for "${req?.name || tactplanId}" is complete — Campaign Ops and the other stakeholder teams have been notified.`;
    await Promise.all([
      api.addComment({ tactplanId, sectionId: 'project', authorPersona: currentPersona, body: toPlainText(opsMessage), mentions: ['ops'], source: 'agent' }),
      api.addComment({ tactplanId, sectionId: 'project', authorPersona: currentPersona, body: toPlainText(otherTeamsMessage), mentions: ['xm', 'mds', 'cep', 'dca'], source: 'agent' }),
      api.addComment({ tactplanId, sectionId: 'project', authorPersona: currentPersona, body: selfMessage, mentions: [currentPersona], source: 'agent' }),
    ]);
    await queryClient.invalidateQueries({ queryKey: ['comments', tactplanId] });
    // Without this the bell only picked up a comment mentioning the CURRENT
    // persona on its next 20s poll — the self-confirmation above just added
    // is exactly that case, and sat invisible in the dropdown for up to 20s
    // after an action the user just took themselves.
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function handleSave() {
    if (!selected || !id) return;
    const entries = selected.fields
      .filter((f) => !f.locked && condMet(f.cond, fieldValues, campaignConfig))
      .map((f) => ({
        sectionId: selected.id,
        fieldId: f.id,
        phase: f.phase,
        value: fieldValues[f.id] || '',
        sectionName: selected.name,
        fieldLabel: f.label,
      }));
    await api.saveEntries(id, entries);
    const { remaining } = sectionOverallRemaining(selected);
    if (remaining === 0) {
      await api.setSectionState(id, selected.id, true);
      await queryClient.invalidateQueries({ queryKey: ['section-state', id] });
    }
    await queryClient.invalidateQueries({ queryKey: ['entries', id] });
  }

  // The real bug this was fixing: clicking Confirm on a chat proposal card
  // only ever wrote to local fieldValues, never the server — unlike
  // record_quiz_answer (handleQuizAnswer above), which always saved
  // immediately. "Confirmed" fields sat as local-only state, invisible to
  // and indistinguishable from genuinely-empty fields the moment
  // entriesQuery refetched in the background (window focus, etc.) and
  // reset fieldValues to what the server actually had — which was never
  // updated. Every propose_fill/derived-fill confirmation is now durable
  // the instant it's confirmed, same guarantee the quiz path already had.
  async function handleApplyProposal(assignments: { fieldId: string; value: string }[]) {
    setFieldValues((prev) => {
      const next = { ...prev };
      assignments.forEach((a) => {
        next[a.fieldId] = a.value;
      });
      return next;
    });
    if (!id) return;
    const entries = assignments
      .map((a) => {
        const meta = findFieldMeta(a.fieldId);
        if (!meta) return null;
        return { sectionId: meta.section.id, fieldId: a.fieldId, phase: meta.field.phase, value: a.value, sectionName: meta.section.name, fieldLabel: meta.field.label };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    if (!entries.length) return;
    await api.saveEntries(id, entries);
    await queryClient.invalidateQueries({ queryKey: ['entries', id] });
  }

  // Both read off the exact same allFields/filled counts — heroFieldsResolved
  // used to just echo the seed data's frozen "0 / 151" default forever, even
  // once a runtime-created campaign had real entries saved, because nothing
  // here ever recomputed it the way heroReady already did for the percentage.
  const { heroReady, heroFieldsResolved } = useMemo(() => {
    if (!sections.length) return { heroReady: request?.ready || '0%', heroFieldsResolved: request?.fieldsResolved || '0 / 0' };
    const allFields = sections.flatMap((s) => s.fields.filter((f) => !f.locked));
    const filled = allFields.filter((f) => !!fieldValues[f.id]).length;
    const pct = allFields.length ? `${Math.round((filled / allFields.length) * 100)}%` : '0%';
    return { heroReady: pct, heroFieldsResolved: `${filled} / ${allFields.length}` };
  }, [sections, fieldValues, request]);

  if (!request) {
    return (
      <div className="view on">
        <div className="hero">
          <div className="hero-l">
            <h1>Request not found</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <CampaignBar request={{ ...request, ready: heroReady, fieldsResolved: heroFieldsResolved }} />
      <div className="stage">
      <div className="view on" id="view-request">
        <CrfTabsSlot
          viewedGate={viewedGate}
          onSelectGate={handleSelectGate}
          scopeMode={scopeMode}
          onToggleScope={() => setScopeMode((m) => (m === 'focus' ? 'all' : 'focus'))}
          commentCount={commentsQuery.data?.comments.length || 0}
          commentsOpen={commentsOpen}
          onToggleComments={() => setCommentsOpen((v) => !v)}
          showFlowDesign
        />
        {commentsOpen && id && <CommentsDrawer tactplanId={id} onClose={() => setCommentsOpen(false)} />}

        {viewedGate === 'flow' && id ? (
          <div className="vb-flow-wrap" style={{ padding: 16 }}>
            <VisioBuilderPanel tactplanId={id} currentPersona={currentPersona} />
          </div>
        ) : viewedGate === 'timeline' && id ? (
          <div className="vb-flow-wrap" style={{ padding: 16 }}>
            <FlowTimelinePanel tactplanId={id} currentPersona={currentPersona} />
          </div>
        ) : (
        <div className="sm-wrap" id="smWrap">
          <aside className="sm-list-panel" id="smListPanel">
            {schemaQuery.isLoading && <div style={{ padding: 16 }}>Loading sections…</div>}
            <div className="sm-list-head">
              Sections <span>({listRows.length})</span>
              {scopeMode === 'focus' && visibleListRows.length !== listRows.length && (
                <span className="sm-list-scope">{visibleListRows.length} of {listRows.length} shown</span>
              )}
              {needingCount > 0 && (
                <span className="sm-list-need">
                  {needingCount} need{needingCount === 1 ? 's' : ''} your input
                </span>
              )}
            </div>
            {scopeMode === 'focus' && visibleListRows.length === 0 && (
              <div className="sm-list-empty">
                Nothing in this phase is waiting on you. <b>Show all</b> above to see all {listRows.length} sections.
              </div>
            )}
            <div className="sm-rows">
              {visibleListRows.map(({ section: s, indent }) => {
                const { remaining } = sectionRemaining(s);
                const isOpen = s.id === openSectionId;
                const isDone = submittedSections.has(s.id) || remaining === 0;
                return (
                  <button
                    key={s.id}
                    className={`sm-row ${isOpen ? 'on' : ''} ${indent ? 'sm-row-indent' : ''}`}
                    onClick={() => setOpenSectionId(s.id)}
                  >
                    <span className="sm-row-num">{s.num}</span>
                    <span className="sm-row-name">{s.name}</span>
                    {remaining > 0 && (
                      <span className="sm-row-rem">
                        <b>{remaining}</b>
                        <i> remaining</i>
                      </span>
                    )}
                    {isDone ? <span className="sm-row-check">✓</span> : <span className="sm-row-dot sm-dot-mine" />}
                    <span className="sm-row-chev">›</span>
                  </button>
                );
              })}
            </div>
          </aside>
          <section className="sm-detail-panel" id="smDetailPanel">
            {selected && (() => {
              const meta = sectionDetailMeta(selected);
              const isSubmitted = submittedSections.has(selected.id);
              // BU Setup only exists for new-BU launches (same
              // assetScope-gated cond as its own fields), and per the CEP/XM
              // handoff it can't be submitted until the CMA Metadata Sheet
              // section is complete — CMA is what actually stands up the
              // brand/program/campaign records BU Setup's own fields
              // reference. Gated on the section being relevant at all
              // (its fields pass their cond) so this never blocks a
              // campaign that doesn't even need BU Setup.
              const cmaGateActive =
                selected.id === 'busetup' &&
                selected.fields.some((f) => condMet(f.cond, fieldValues, campaignConfig)) &&
                !submittedSections.has('cma');
              // Was ported from index.html's restrictOwner logic — read-only
              // for anyone but a field's own owner ONLY when the section's
              // current-phase needsJson lists more than one distinct
              // persona, on the theory that a single-owner section is only
              // ever looked at by its own owner anyway. That premise is
              // false here: every persona can open every section to see
              // what others have filled (confirmed, deliberate — see the
              // "each person should see others' filled details" agreement),
              // so a single-owner section left this gate permanently off
              // and let ANY viewer edit fields that weren't theirs —
              // caught live with Solution Architect editing AOR's Generic/
              // Overview fields. Ownership restriction has to hold
              // regardless of how many owners a section's needsJson lists;
              // that list was never a reliable signal for this anyway (see
              // the earlier OMS/generic needsJson data-drift bugs).
              const notMyField = (f: { owner: string }) => f.owner !== currentPersona;
              const metaParts: string[] = [meta.isMine ? 'To fill' : 'Read-only'];
              if (meta.totalFields !== meta.relevantCount) metaParts.push(`${meta.relevantCount} of ${meta.totalFields} fields shown`);
              return (
                <>
                  <CrfTabsSlot
                    viewedGate={viewedGate}
                    onSelectGate={handleSelectGate}
                    scopeMode={scopeMode}
                    onToggleScope={() => setScopeMode((m) => (m === 'focus' ? 'all' : 'focus'))}
                    commentCount={commentsQuery.data?.comments.length || 0}
                    commentsOpen={commentsOpen}
                    onToggleComments={() => setCommentsOpen((v) => !v)}
                    showFlowDesign
                  />
                  <div className="sm-detail-head">
                    <div className="sm-detail-head-top">
                      <span className="sm-detail-num">{selected.num}</span>
                      <span className="sm-detail-title">{selected.name}</span>
                      <button type="button" className="sm-detail-x" aria-label="Close" onClick={() => setOpenSectionId(null)}>
                        ✕
                      </button>
                    </div>
                    <div className="sm-detail-sub">
                      {metaParts.join(' · ')}
                      {meta.mineRemaining > 0 && (
                        <>
                          {' · '}
                          <b>{meta.mineRemaining}</b> still on you
                        </>
                      )}
                    </div>
                    <div className="sm-detail-progress-row">
                      <div className="sm-detail-bar">
                        <div
                          className={`sm-detail-bar-fill ${meta.isMine ? 'sm-status-prog' : 'sm-status-done'}`}
                          style={{ width: meta.relevantCount ? `${Math.round((meta.filledCount / meta.relevantCount) * 100)}%` : '0%' }}
                        />
                      </div>
                      <span className="sm-count">
                        {meta.filledCount} / {meta.relevantCount} filled · all owners
                      </span>
                    </div>
                  </div>
                  <div className="sm-detail-body">
                    {/* Ported from the original's separate CPF vs Planning boards
                        (renderCrfViewTabs()/crfNavGoCpf()/setCrfView()) — the
                        Intake gate showed only pre-planning fields, the
                        Journey gate showed planning+execution fields, as two
                        distinct destinations rather than one long scrolling
                        list. Now a third gate (Execution) splits that
                        combined bucket further: Journey = plan phase only,
                        Execution = exec phase only. Here that's the same
                        stacked panel filtered by the active gate, so
                        switching tabs visibly changes what's on screen
                        instead of just scrolling to it. */}
                    {PHASES.filter((phase) => (viewedGate === 'preplan' ? phase === 'preplan' : viewedGate === 'exec' ? phase === 'exec' : phase === 'plan')).map((phase) => {
                      const fields = selected.fields.filter((f) => f.phase === phase && condMet(f.cond, fieldValues, campaignConfig));
                      const editable = phase === currentPhase && !isSubmitted;
                      const when: 'future' | 'submitted' | 'past' | null = isSubmitted
                        ? 'submitted'
                        : PHASE_ORDER[phase] > PHASE_ORDER[currentPhase]
                          ? 'future'
                          : PHASE_ORDER[phase] < PHASE_ORDER[currentPhase]
                            ? 'past'
                            : null;
                      return (
                        <div key={phase} id={`pg-${phase}`}>
                          <PhaseGroup
                            phase={phase}
                            fields={fields}
                            editable={editable}
                            when={when}
                            values={fieldValues}
                            onChange={handleFieldChange}
                            notMyField={notMyField}
                          />
                        </div>
                      );
                    })}
                    {!isSubmitted && (
                      <div className="sec-submit">
                        {cmaGateActive && (
                          <div className="sec-submit-blocked-note">
                            Blocked until the CMA Metadata Sheet section is submitted.
                          </div>
                        )}
                        <button className="btn-primary" onClick={handleSave} disabled={cmaGateActive}>
                          Save &amp; Continue
                        </button>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
        )}
      </div>
      </div>

      <DetailsResizer />
      <ChatPanel
        sections={sections}
        tactplanId={id || null}
        onApplyProposal={handleApplyProposal}
        onOpenCampaign={(tactplanId) => navigate(`/requests/${tactplanId}`)}
        interviewData={interviewData}
        entriesLoaded={fieldValuesSeeded}
        onQuizAnswer={handleQuizAnswer}
        onNotifyStakeholders={handleNotifyStakeholders}
        onCreateCampaign={async (fields) => {
          const req = buildCampaignRequest(fields);
          REQUESTS.unshift(req);
          // Fire-and-forget: makes the portfolio row survive a reload/restart
          // (see bootstrapPersistedCampaigns) instead of only living in this
          // tab's in-memory REQUESTS array.
          api.createCampaign(req).catch(() => {});
          const entries = buildGenericOverviewEntries(sections, req.id, fields);
          if (entries.length) await api.saveEntries(req.id, entries);
          navigate(`/requests/${req.id}`);
          return req.id;
        }}
      />
    </>
  );
}
