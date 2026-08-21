import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { FormField } from '../types';
import EditPanel from './EditPanel';
import CondBuilder from './CondBuilder';

const PHASES = ['preplan', 'plan', 'exec'] as const;
const TYPES = ['text', 'ta', 'sel', 'multi', 'date', 'file', 'metasheet'];
const OWNERS = ['aor', 'xm', 'mds', 'cep', 'ops', 'dca', 'oms'];

interface DraftField {
  fieldKey: string;
  label: string;
  type: string;
  phase: FormField['phase'];
  owner: string;
  bucket: string;
  source: string;
  opts: string;
  cond: Record<string, unknown> | undefined;
  drives: string;
  cascadeFromField: string;
  derivesFrom: string;
  locked: boolean;
  lockedValue: string;
  wide: boolean;
}

const EMPTY: DraftField = { fieldKey: '', label: '', type: 'text', phase: 'plan', owner: 'aor', bucket: '', source: '', opts: '', cond: undefined, drives: '', cascadeFromField: '', derivesFrom: '', locked: false, lockedValue: '', wide: false };

function toPayload(d: DraftField) {
  const opts = d.opts.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    fieldKey: d.fieldKey, label: d.label, type: d.type, phase: d.phase, owner: d.owner,
    bucket: d.bucket || null, source: d.source || null,
    opts: opts.length ? opts : undefined, cond: d.cond,
    drives: d.drives || null, cascadeFromField: d.cascadeFromField || null, derivesFrom: d.derivesFrom || null,
    locked: d.locked, lockedValue: d.lockedValue || null, wide: d.wide,
  };
}

// Ported from index.html's renderAdminFieldPanel()/renderAdminFieldDrawer()
// — pick a section from the sidebar, CRUD its fields via drawer including
// the condition builder. Tactic field templates block is deferred (spec:
// lower priority, don't let it block finishing the 4 tabs).
export default function AdminFieldsTab({ formId }: { formId: string }) {
  const queryClient = useQueryClient();
  const schemaQuery = useQuery({ queryKey: ['admin-schema', formId], queryFn: () => api.getSchemaFor(formId) });
  const sections = schemaQuery.data?.sections || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<DraftField>(EMPTY);
  const [condKey, setCondKey] = useState(0);

  useEffect(() => {
    if (!selectedId && sections.length) setSelectedId(sections[0].id);
  }, [sections, selectedId]);

  const selected = sections.find((s) => s.id === selectedId) || null;

  function openAdd() {
    setDraft(EMPTY);
    setCondKey((k) => k + 1);
    setEditing({ mode: 'add' });
  }

  function openEdit(f: FormField) {
    setDraft({
      fieldKey: f.fieldKey, label: f.label, type: f.type, phase: f.phase, owner: f.owner,
      bucket: f.bucket || '', source: f.source || '', opts: (f.opts || []).join(', '), cond: f.cond,
      drives: f.drives || '', cascadeFromField: f.cascadeFromField || '', derivesFrom: '',
      locked: f.locked, lockedValue: f.lockedValue || '', wide: f.wide,
    });
    setCondKey((k) => k + 1);
    setEditing({ mode: 'edit', id: f.id });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing || !selected) return;
      if (editing.mode === 'add') await api.addField(selected.id, toPayload(draft));
      else await api.updateField(editing.id, toPayload(draft));
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-schema', formId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteField(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-schema', formId] }),
  });

  return (
    <div className="admin-layout">
      <aside className="admin-sec-list">
        {sections.map((s) => (
          <button key={s.id} className={`admin-sec-item ${s.id === selectedId ? 'on' : ''}`} onClick={() => { setSelectedId(s.id); setEditing(null); }}>
            <span>{s.icon}</span><span>{s.name}</span><span className="n">{s.fields.length}</span>
          </button>
        ))}
      </aside>

      <section className="admin-field-panel">
        {selected && (
          <>
            <div className="admin-panel-head">
              <div>
                <h3>{selected.name}</h3>
                <p>{selected.note || `Machine name: ${selected.id} · ${selected.fields.length} fields`}</p>
              </div>
              <button className="btn-primary" onClick={openAdd}>+ Add field</button>
            </div>
            <table className="admin-ftable">
              <thead>
                <tr><th>Label / machine name</th><th>Type</th><th>Phase</th><th>Owner</th><th></th></tr>
              </thead>
              <tbody>
                {selected.fields.map((f) => (
                  <tr className="admin-frow" key={f.id}>
                    <td>
                      <div className="admin-flabel">{f.label}</div>
                      <div className="admin-fmachine">{f.fieldKey}</div>
                    </td>
                    <td><span className="admin-ftype-badge">{f.type}</span></td>
                    <td>{f.phase}</td>
                    <td>{f.owner}</td>
                    <td>
                      <div className="admin-fops">
                        <button onClick={() => openEdit(f)}>Edit</button>
                        <button className="danger" onClick={() => { if (confirm(`Delete "${f.label}"?`)) deleteMutation.mutate(f.id); }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {editing && selected && (
        <EditPanel title={editing.mode === 'add' ? 'Add field' : 'Edit field'} subtitle={editing.mode === 'add' ? selected.id : `${draft.fieldKey} — ${selected.id}`} onClose={() => setEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            <label>Label<input className="inp" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
            <label>Field key (machine name)<input className="inp" value={draft.fieldKey} onChange={(e) => setDraft({ ...draft, fieldKey: e.target.value })} /></label>
            <label>Type<select className="sel" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Phase<select className="sel" value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value as FormField['phase'] })}>{PHASES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label>Owner<select className="sel" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}>{OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
            <label>Bucket<input className="inp" value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value })} /></label>
            <label>Source (shown as caption)<input className="inp" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /></label>
            <label>Options (comma-separated, for type=sel)<input className="inp" value={draft.opts} onChange={(e) => setDraft({ ...draft, opts: e.target.value })} /></label>
            <label className="wide">
              Condition (only show this field when…)
              <CondBuilder key={condKey} cond={draft.cond} onChange={(cond) => setDraft((d) => ({ ...d, cond }))} />
            </label>
            <label>Drives (campaignConfig key)<input className="inp" value={draft.drives} onChange={(e) => setDraft({ ...draft, drives: e.target.value })} /></label>
            <label>Cascade from field key<input className="inp" value={draft.cascadeFromField} onChange={(e) => setDraft({ ...draft, cascadeFromField: e.target.value })} /></label>
            <label className="admin-drawer-check"><input type="checkbox" checked={draft.locked} onChange={(e) => setDraft({ ...draft, locked: e.target.checked })} /> Locked (read-only, auto-filled)</label>
            <label>Locked value (if locked)<input className="inp" value={draft.lockedValue} onChange={(e) => setDraft({ ...draft, lockedValue: e.target.value })} /></label>
            <label className="admin-drawer-check"><input type="checkbox" checked={draft.wide} onChange={(e) => setDraft({ ...draft, wide: e.target.checked })} /> Wide (full-width field)</label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={!draft.fieldKey.trim() || !draft.label.trim()} onClick={() => saveMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
