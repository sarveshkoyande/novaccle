import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { FormSection } from '../types';
import { PERSONAS, type PersonaKey } from '../personas';
import EditPanel from './EditPanel';

const PHASES = ['preplan', 'plan', 'exec'] as const;
const PERSONA_KEYS = Object.keys(PERSONAS) as PersonaKey[];

interface DraftSection {
  id: string;
  name: string;
  num: string;
  icon: string;
  note: string;
  audienceGate: boolean;
  needs: { preplan: string[]; plan: string[]; exec: string[] };
}

const EMPTY: DraftSection = { id: '', name: '', num: '', icon: '▣', note: '', audienceGate: false, needs: { preplan: [], plan: [], exec: [] } };

function toggleNeed(needs: DraftSection['needs'], phase: (typeof PHASES)[number], key: string): DraftSection['needs'] {
  const list = needs[phase];
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  return { ...needs, [phase]: next };
}

// Ported from index.html's renderAdminSectionsTable()/renderAdminSectionDrawer()
// — full CRUD via a real drawer form, "needs" per phase as a PERSONAS
// multi-select instead of a comma-separated text input.
export default function AdminSectionsTab({ formId }: { formId: string }) {
  const queryClient = useQueryClient();
  const schemaQuery = useQuery({ queryKey: ['admin-schema', formId], queryFn: () => api.getSchemaFor(formId) });
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<DraftSection>(EMPTY);

  const sections = schemaQuery.data?.sections || [];

  function openAdd() {
    setDraft(EMPTY);
    setEditing({ mode: 'add' });
  }

  function openEdit(s: FormSection) {
    setDraft({ id: s.id, name: s.name, num: s.num || '', icon: s.icon || '▣', note: s.note || '', audienceGate: s.audienceGate, needs: { preplan: s.needs.preplan || [], plan: s.needs.plan || [], exec: s.needs.exec || [] } });
    setEditing({ mode: 'edit', id: s.id });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (editing.mode === 'add') await api.addSection({ ...draft, formId });
      else await api.updateSection(editing.id, draft);
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-schema', formId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-schema', formId] }),
  });

  function needsLabel(s: FormSection) {
    const parts = PHASES.map((p) => (s.needs[p] || []).length ? `${p}: ${(s.needs[p] || []).join(', ')}` : null).filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr' }}>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Sections</h3>
            <p>{sections.length} sections, rendered on the live form in this order · form: {formId}</p>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add section</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Section</th><th>Num</th><th>Fields</th><th>Needs (who, per phase)</th><th>Audience gate</th><th></th></tr>
          </thead>
          <tbody>
            {sections.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No sections yet.</td></tr>
            )}
            {sections.map((s) => (
              <tr className="admin-frow" key={s.id}>
                <td>
                  <div className="admin-flabel">{s.icon} {s.name}</div>
                  <div className="admin-fmachine">{s.id}{s.parentId ? ` · child of ${s.parentId}` : ''}</div>
                </td>
                <td>{s.num || '—'}</td>
                <td>{s.fields.length}</td>
                <td style={{ fontSize: '.76rem', color: 'var(--ink3)' }}>{needsLabel(s)}</td>
                <td>{s.audienceGate ? '✓' : '—'}</td>
                <td>
                  <div className="admin-fops">
                    <button onClick={() => openEdit(s)}>Edit</button>
                    <button className="danger" onClick={() => { if (confirm(`Delete section "${s.id}" and all its fields? This can't be undone.`)) deleteMutation.mutate(s.id); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditPanel title={editing.mode === 'add' ? 'Add section' : 'Edit section'} subtitle={editing.mode === 'add' ? 'New section' : editing.id} onClose={() => setEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            {editing.mode === 'add' && (
              <label>Id (machine key — lowercase, no spaces)<input className="inp" placeholder="e.g. warehousing" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></label>
            )}
            <label>Name<input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Num (display order label)<input className="inp" value={draft.num} onChange={(e) => setDraft({ ...draft, num: e.target.value })} /></label>
            <label>Icon (one character/emoji)<input className="inp" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} /></label>
            <label className="wide">Note (shown under the section header on the live form)<input className="inp" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            {PHASES.map((p) => (
              <label className="wide" key={p}>
                Needs — {p} (who owns fields in this phase)
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  {PERSONA_KEYS.map((k) => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                      <input type="checkbox" checked={draft.needs[p].includes(k)} onChange={() => setDraft({ ...draft, needs: toggleNeed(draft.needs, p, k) })} /> {k}
                    </label>
                  ))}
                </div>
              </label>
            ))}
            <label className="admin-drawer-check"><input type="checkbox" checked={draft.audienceGate} onChange={(e) => setDraft({ ...draft, audienceGate: e.target.checked })} /> Audience gate (MDS-style — content lives per-tactic, not on this base card)</label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={!draft.name.trim() || (editing.mode === 'add' && !draft.id.trim())} onClick={() => saveMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
