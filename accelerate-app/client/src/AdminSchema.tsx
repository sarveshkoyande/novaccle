import { useEffect, useState } from 'react';
import { api } from './api';
import type { FormField, FormSection } from './types';
import './AdminSchema.css';

const PHASES = ['preplan', 'plan', 'exec'] as const;
const TYPES = ['text', 'ta', 'sel', 'multi', 'date', 'file', 'metasheet'];
const OWNERS = ['aor', 'xm', 'mds', 'cep', 'ops', 'dca'];

// Minimal admin UI for FormSection/FormField (Phase 1) — proves the schema
// is genuinely editable via the API, not a code change. Full polish
// (drag-reorder, section CRUD, bulk import) is Phase 4+.
export default function AdminSchema() {
  const [sections, setSections] = useState<FormSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newField, setNewField] = useState({ fieldKey: '', label: '', phase: 'plan' as FormField['phase'], type: 'text', owner: 'aor' });

  const load = () => {
    api
      .getSchema()
      .then((d) => {
        setSections(d.sections);
        setError(null);
        setSelectedId((prev) => prev ?? d.sections[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const selected = sections?.find((s) => s.id === selectedId) ?? null;

  const handleAddField = async () => {
    if (!selected || !newField.fieldKey.trim() || !newField.label.trim()) return;
    try {
      await api.addField(selected.id, newField);
      setNewField({ fieldKey: '', label: '', phase: 'plan', type: 'text', owner: 'aor' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleFieldEdit = async (field: FormField, patch: Partial<FormField>) => {
    try {
      await api.updateField(field.id, patch);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (field: FormField) => {
    if (!confirm(`Delete "${field.label}"?`)) return;
    try {
      await api.deleteField(field.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <div className="admin-error">Couldn't load schema: {error}</div>;
  if (!sections) return <div className="admin-loading">Loading schema…</div>;

  return (
    <div className="admin-schema">
      <aside className="admin-sections">
        <h2>Sections</h2>
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <button className={s.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(s.id)}>
                <span className="admin-sec-ic">{s.icon}</span>
                <span>{s.name}</span>
                <span className="admin-sec-count">{s.fields.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="admin-fields">
        {selected && (
          <>
            <h2>{selected.name} <span className="admin-sec-id">{selected.id}</span></h2>
            {selected.note && <p className="admin-note">{selected.note}</p>}
            <table>
              <thead>
                <tr>
                  <th>Field key</th>
                  <th>Label</th>
                  <th>Phase</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selected.fields.map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{f.fieldKey}</td>
                    <td>
                      <input
                        defaultValue={f.label}
                        onBlur={(e) => e.target.value !== f.label && handleFieldEdit(f, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <select defaultValue={f.phase} onChange={(e) => handleFieldEdit(f, { phase: e.target.value as FormField['phase'] })}>
                        {PHASES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select defaultValue={f.type} onChange={(e) => handleFieldEdit(f, { type: e.target.value })}>
                        {TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select defaultValue={f.owner} onChange={(e) => handleFieldEdit(f, { owner: e.target.value })}>
                        {OWNERS.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="admin-del" onClick={() => handleDelete(f)}>✕</button>
                    </td>
                  </tr>
                ))}
                <tr className="admin-add-row">
                  <td>
                    <input
                      placeholder="e.g. 1.1.99"
                      value={newField.fieldKey}
                      onChange={(e) => setNewField({ ...newField, fieldKey: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      placeholder="New field label"
                      value={newField.label}
                      onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                    />
                  </td>
                  <td>
                    <select value={newField.phase} onChange={(e) => setNewField({ ...newField, phase: e.target.value as FormField['phase'] })}>
                      {PHASES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value })}>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={newField.owner} onChange={(e) => setNewField({ ...newField, owner: e.target.value })}>
                      {OWNERS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="admin-add" onClick={handleAddField}>Add</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
