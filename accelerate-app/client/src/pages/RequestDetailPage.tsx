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
  const [viewedGateOverride, setViewedGateOverride] = useState<'preplan' | 'planning' | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
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
  // live purely in local state until Save writes them back.
  useEffect(() => {
    if (!entriesQuery.data) return;
    const seeded: Record<string, string> = {};
    entriesQuery.data.entries.forEach((e) => {
      seeded[e.fieldId] = e.value;
    });
    setFieldValues(seeded);
  }, [entriesQuery.data]);

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
    sections.forEach((s) => {
      s.fields.forEach((f) => {
        const v = fieldValues[f.id];
        if (v) byLabel[f.label.trim().toLowerCase()] = v;
      });
    });
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
        }
      });
    });
    const derived = remaining
      .map((r) => {
        const value = byLabel[r.field.trim().toLowerCase()];
        return value ? { sectionId: r.sectionId, sectionName: r.sectionName, field: r.field, value } : null;
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
  const gatePhases = viewedGate === 'preplan' ? (['preplan'] as const) : (['plan', 'exec'] as const);

  function sectionRemaining(s: FormSection) {
    const relevant = s.fields.filter(
      (f) => !f.locked && (gatePhases as readonly string[]).includes(f.phase) && condMet(f.cond, fieldValues, campaignConfig),
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
  function handleSelectGate(gate: 'preplan' | 'planning') {
    setViewedGateOverride(gate);
    const targetPhase = gate === 'preplan' ? 'preplan' : 'plan';
    setTimeout(() => {
      const el = document.getElementById(`pg-${targetPhase}`);
      if (!el) return;
      const details = el.querySelector('details');
      if (details) details.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function handleFieldChange(fieldId: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
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

  function handleApplyProposal(assignments: { fieldId: string; value: string }[]) {
    setFieldValues((prev) => {
      const next = { ...prev };
      assignments.forEach((a) => {
        next[a.fieldId] = a.value;
      });
      return next;
    });
  }

  const heroReady = useMemo(() => {
    if (!sections.length) return request?.ready || '0%';
    const allFields = sections.flatMap((s) => s.fields.filter((f) => !f.locked));
    const filled = allFields.filter((f) => !!fieldValues[f.id]).length;
    return allFields.length ? `${Math.round((filled / allFields.length) * 100)}%` : '0%';
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
      <CampaignBar request={{ ...request, ready: heroReady }} />
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
        />
        {commentsOpen && id && <CommentsDrawer tactplanId={id} onClose={() => setCommentsOpen(false)} />}

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
              // Ported from index.html's restrictOwner logic: a field is
              // read-only for anyone but its own owner ONLY when the
              // section's current-phase owner list has more than one
              // distinct persona — single-owner sections stay editable by
              // whoever can reach them at all.
              const phaseNeeds = selected.needs?.[currentPhase] || [];
              const restrictOwner = phaseNeeds.length > 1;
              const notMyField = (f: { owner: string }) => restrictOwner && f.owner !== currentPersona;
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
                        Pre-planning gate showed only pre-planning fields, the
                        Planning gate showed planning+execution fields, as two
                        distinct destinations rather than one long scrolling
                        list. Here that's the same stacked panel filtered by
                        the active gate, so switching tabs visibly changes
                        what's on screen instead of just scrolling to it. */}
                    {PHASES.filter((phase) => (viewedGate === 'preplan' ? phase === 'preplan' : phase !== 'preplan')).map((phase) => {
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
                        <button className="btn-primary" onClick={handleSave}>
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
      </div>
      </div>

      <DetailsResizer />
      <ChatPanel
        sections={sections}
        tactplanId={id || null}
        onApplyProposal={handleApplyProposal}
        onOpenCampaign={(tactplanId) => navigate(`/requests/${tactplanId}`)}
        interviewData={interviewData}
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
