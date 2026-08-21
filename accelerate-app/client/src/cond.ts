import type { FormSection } from './types';

// Ported from index.html's condKeyValue()/condRuleMet()/condRefMet()/condMet().
// campaignConfig there is a persistent object written by driveField()
// whenever a field with `drives` changes; here it's derived fresh each
// render from whichever field currently has that `drives` key, using live
// fieldValues — same effective result, no separate store needed.
const DRIVE_KEYS = ['assetScope', 'enrollment', 'audience', 'channels', 'metadataSource', 'abTesting', 'sendTimeOptimization', 'personalization'];

// The original app kept campaignConfig.assetScope as a short slug
// ('newbrand'/'newind'/'update'), separate from the Asset Scope field's
// actual displayed option text — every cond rule referencing assetScope
// (there are dozens, across OMS and elsewhere) is written against those
// slugs. This port's <select> just uses the option text itself as its
// value (see FieldRenderer's <option value={o}>), so without this mapping
// deriveCampaignConfig was writing "New Brand Launch" straight into
// campaignConfig.assetScope — which then never matched any cond rule's
// ["newbrand","newind"], for ANY asset scope, ever. Every assetScope-gated
// field in the whole form was silently unreachable regardless of what the
// user picked.
const ASSET_SCOPE_SLUGS: Record<string, string> = {
  'New Brand Launch': 'newbrand',
  'New Indication Launch': 'newind',
  'Update Existing Campaign': 'update',
};

export function deriveCampaignConfig(sections: FormSection[], fieldValues: Record<string, string>): Record<string, string> {
  const cfg: Record<string, string> = {};
  sections.forEach((s) => {
    s.fields.forEach((f) => {
      if (f.drives && DRIVE_KEYS.includes(f.drives)) {
        const v = fieldValues[f.id];
        if (v === undefined) return;
        if (f.drives === 'enrollment') cfg[f.drives] = v.toLowerCase();
        else if (f.drives === 'assetScope') cfg[f.drives] = ASSET_SCOPE_SLUGS[v] || v;
        else cfg[f.drives] = v;
      }
    });
  });
  return cfg;
}

function condRuleMet(key: string, want: unknown, campaignConfig: Record<string, string>): boolean {
  const val = campaignConfig[key];
  if (val === undefined) return true; // unknown/unset key — same permissive fallback as the original
  return Array.isArray(want) ? want.includes(val) : String(want).toLowerCase() === String(val).toLowerCase();
}

function condRefMet(cond: { ref: string; value: unknown }, fieldValues: Record<string, string>): boolean {
  const val = fieldValues[cond.ref];
  const want = cond.value;
  return Array.isArray(want) ? want.includes(val) : String(want).toLowerCase() === String(val || '').toLowerCase();
}

export function condMet(
  cond: Record<string, unknown> | undefined | null,
  fieldValues: Record<string, string>,
  campaignConfig: Record<string, string>,
): boolean {
  if (!cond) return true;
  if (cond.ref !== undefined) return condRefMet(cond as { ref: string; value: unknown }, fieldValues);
  if (Array.isArray(cond.rules)) {
    if (cond.rules.length === 0) return true;
    const results = (cond.rules as { key: string; value: unknown }[]).map((r) => condRuleMet(r.key, r.value, campaignConfig));
    return cond.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
  }
  return Object.entries(cond).every(([key, want]) => condRuleMet(key, want, campaignConfig));
}
