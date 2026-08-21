import { useState } from 'react';

const DRIVE_KEYS = ['assetScope', 'enrollment', 'audience', 'channels', 'metadataSource', 'abTesting', 'sendTimeOptimization', 'personalization'];

interface Rule {
  key: string;
  value: string;
}

function normalize(cond: Record<string, unknown> | undefined | null): { logic: 'and' | 'or'; rules: Rule[] } {
  if (!cond) return { logic: 'and', rules: [] };
  if (Array.isArray((cond as { rules?: unknown[] }).rules)) {
    const c = cond as { logic?: string; rules: { key: string; value: unknown }[] };
    return {
      logic: c.logic === 'or' ? 'or' : 'and',
      rules: c.rules.map((r) => ({ key: r.key, value: Array.isArray(r.value) ? r.value.join(',') : String(r.value ?? '') })),
    };
  }
  return { logic: 'and', rules: Object.entries(cond).map(([key, want]) => ({ key, value: Array.isArray(want) ? want.join(',') : String(want) })) };
}

function toCond(draft: { logic: 'and' | 'or'; rules: Rule[] }): Record<string, unknown> | undefined {
  const rules = draft.rules.filter((r) => r.key && r.value);
  if (!rules.length) return undefined;
  return { logic: draft.logic, rules: rules.map((r) => ({ key: r.key, value: r.value })) };
}

// Ported (simplified) from index.html's renderAdminCondBuilder() — rule rows
// of {key, value} chained by AND/OR. Value stays a plain text input (the
// original's checkbox-per-known-value picker is lower priority per spec).
export default function CondBuilder({ cond, onChange }: { cond: Record<string, unknown> | undefined; onChange: (cond: Record<string, unknown> | undefined) => void }) {
  const [draft, setDraft] = useState(() => normalize(cond));

  function update(next: { logic: 'and' | 'or'; rules: Rule[] }) {
    setDraft(next);
    onChange(toCond(next));
  }

  return (
    <div className="admin-cond-builder">
      {draft.rules.length === 0 && <p className="admin-cond-empty">No condition — this field always shows.</p>}
      {draft.rules.map((r, i) => (
        <div className="admin-cond-rule" key={i}>
          {i > 0 && <span className="admin-cond-logic-tag">{draft.logic.toUpperCase()}</span>}
          <select
            value={r.key}
            onChange={(e) => {
              const rules = draft.rules.slice();
              rules[i] = { ...rules[i], key: e.target.value };
              update({ ...draft, rules });
            }}
          >
            <option value="">Search a condition key…</option>
            {DRIVE_KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <span className="admin-cond-eq">equals</span>
          <input
            className="inp"
            style={{ width: 140, height: 32 }}
            value={r.value}
            placeholder="value"
            onChange={(e) => {
              const rules = draft.rules.slice();
              rules[i] = { ...rules[i], value: e.target.value };
              update({ ...draft, rules });
            }}
          />
          <button
            type="button"
            className="admin-cond-del"
            onClick={() => {
              const rules = draft.rules.slice();
              rules.splice(i, 1);
              update({ ...draft, rules });
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {draft.rules.length > 1 && (
        <div className="admin-cond-logic-toggle">
          Combine rules with:
          <button type="button" className={draft.logic === 'and' ? 'on' : ''} onClick={() => update({ ...draft, logic: 'and' })}>AND</button>
          <button type="button" className={draft.logic === 'or' ? 'on' : ''} onClick={() => update({ ...draft, logic: 'or' })}>OR</button>
        </div>
      )}
      <button type="button" className="admin-cond-add" onClick={() => update({ ...draft, rules: [...draft.rules, { key: '', value: '' }] })}>
        + Add rule
      </button>
    </div>
  );
}
