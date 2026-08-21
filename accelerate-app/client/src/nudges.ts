import type { FormSection, NudgeRule } from './types';

// Ported from index.html's runReactCheckpoint() hardcoded branches, now
// driven by NudgeRule rows (see seed-nudge-rules.js for the trigger
// semantics this mirrors) instead of inline ifs — the React port never
// actually evaluated these, so every nudge rule sat in the admin CRUD
// unused until this.
export interface NudgeContext {
  sections: FormSection[];
  fieldValues: Record<string, string>;
  submittedSections: Set<string>;
  currentPhase: string;
  // Reuses the SAME resolved drives-field values (assetScope/channels/
  // enrollment/...) that cond.ts's condMet() already computes for gating —
  // several fields can share one `drives` key (e.g. both "Channel Type"
  // and "Campaign Channels Select" drive `channels`), and campaignConfig is
  // the one place that resolution already happens consistently. Evaluating
  // `field_value_equals` against a locally re-derived lookup instead of
  // this would silently pick whichever matching field happens to come
  // first in section order rather than the one actually holding a value.
  campaignConfig: Record<string, string>;
}

export interface NudgeFiring {
  rule: NudgeRule;
  message: string;
}

function conditionsMet(rule: NudgeRule, fieldsByKey: Record<string, string>): boolean {
  if (!rule.conditionsJson) return true;
  try {
    const parsed = JSON.parse(rule.conditionsJson) as { logic?: string; rules?: { key: string; value: string }[] };
    if (!parsed.rules?.length) return true;
    return parsed.rules.every((r) => fieldsByKey[r.key] === r.value);
  } catch {
    return true;
  }
}

function interpolate(message: string, vars: Record<string, string | number>) {
  return message.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

export function evaluateNudgeRules(rules: NudgeRule[], ctx: NudgeContext): NudgeFiring[] {
  const { sections, fieldValues, submittedSections, currentPhase, campaignConfig } = ctx;
  const allFields = sections.flatMap((s) => s.fields);
  const fieldsByKey: Record<string, string> = {};
  allFields.forEach((f) => {
    if (fieldValues[f.id]) fieldsByKey[f.fieldKey] = fieldValues[f.id];
  });

  const fired: NudgeFiring[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!conditionsMet(rule, fieldsByKey)) continue;

    if (rule.trigger === 'section_submitted') {
      if (rule.triggerSectionId && submittedSections.has(rule.triggerSectionId)) {
        fired.push({ rule, message: rule.message });
      }
    } else if (rule.trigger === 'field_value_equals') {
      const resolved = rule.triggerFieldDrives ? campaignConfig[rule.triggerFieldDrives] : undefined;
      if (resolved !== undefined && rule.triggerValue !== undefined && rule.triggerValue !== null && resolved.toLowerCase() === String(rule.triggerValue).toLowerCase()) {
        fired.push({ rule, message: rule.message });
      }
    } else if (rule.trigger === 'phase_complete') {
      const relevant = allFields.filter((f) => !f.locked && f.phase === rule.triggerPhase);
      if (relevant.length > 0 && relevant.every((f) => !!fieldValues[f.id])) {
        fired.push({ rule, message: rule.message });
      }
    } else if (rule.trigger === 'section_group_complete') {
      let sectionIds: string[] = [];
      try {
        sectionIds = rule.triggerSectionIds ? (JSON.parse(rule.triggerSectionIds) as string[]) : [];
      } catch {
        sectionIds = [];
      }
      if (sectionIds.length && sectionIds.every((sid) => submittedSections.has(sid))) {
        fired.push({ rule, message: rule.message });
      }
    } else if (rule.trigger === 'fields_remaining') {
      const relevant = allFields.filter(
        (f) => !f.locked && f.sectionId === rule.triggerSectionId && !!rule.triggerFieldKey && f.fieldKey.startsWith(rule.triggerFieldKey),
      );
      const remaining = relevant.filter((f) => !fieldValues[f.id]).length;
      if (relevant.length > 0 && remaining > 0) {
        fired.push({ rule, message: interpolate(rule.message, { remaining, total: relevant.length }) });
      }
    }
  }
  // currentPhase is accepted for parity with the trigger vocabulary (a
  // future per-phase trigger could use it) even though nothing above reads
  // it yet — keeping the param avoids a signature change when one does.
  void currentPhase;
  return fired;
}

const firedKey = (tactplanId: string) => `accelerate-nudges-fired:${tactplanId}`;

export function getFiredRuleIds(tactplanId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(firedKey(tactplanId)) || '[]'));
  } catch {
    return new Set();
  }
}

export function markRulesFired(tactplanId: string, ruleIds: string[]) {
  const current = getFiredRuleIds(tactplanId);
  ruleIds.forEach((id) => current.add(id));
  localStorage.setItem(firedKey(tactplanId), JSON.stringify([...current]));
}
