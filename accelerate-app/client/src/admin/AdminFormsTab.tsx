import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Form } from '../types';
import EditPanel from './EditPanel';

interface DraftForm {
  name: string;
  description: string;
  active: boolean;
}

const EMPTY: DraftForm = { name: '', description: '', active: true };

// Ported from index.html's renderAdminFormsTable()/prompt()-based add/edit —
// here as a real drawer form instead of window.prompt().
export default function AdminFormsTab({ onManageSections }: { onManageSections: (formId: string) => void }) {
  const queryClient = useQueryClient();
  const formsQuery = useQuery({ queryKey: ['admin-forms'], queryFn: api.getForms });
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<DraftForm>(EMPTY);

  const forms = formsQuery.data?.forms || [];

  function openAdd() {
    setDraft(EMPTY);
    setEditing({ mode: 'add' });
  }

  function openEdit(f: Form) {
    setDraft({ name: f.name, description: f.description || '', active: f.active });
    setEditing({ mode: 'edit', id: f.id });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (editing.mode === 'add') await api.addForm(draft);
      else await api.updateForm(editing.id, draft);
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-forms'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteForm(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-forms'] }),
  });

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr' }}>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Forms</h3>
            <p>{forms.length} form{forms.length === 1 ? '' : 's'}</p>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add form</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Form</th><th>Description</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {forms.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No forms yet.</td></tr>
            )}
            {forms.map((f) => (
              <tr className="admin-frow" key={f.id}>
                <td>
                  <div className="admin-flabel">{f.name}</div>
                  <div className="admin-fmachine">{f.id}</div>
                </td>
                <td>{f.description || '—'}</td>
                <td><span className="admin-ftype-badge" style={{ opacity: f.active ? 1 : 0.5 }}>{f.active ? 'Active' : 'Inactive'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="admin-fops">
                    <button onClick={() => onManageSections(f.id)}>Manage sections</button>
                    <button onClick={() => openEdit(f)}>Edit</button>
                    <button className="danger" disabled={f.id === 'form-default'} onClick={() => { if (confirm(`Delete "${f.name}"? This also deletes every section and field that belongs to it.`)) deleteMutation.mutate(f.id); }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditPanel title={editing.mode === 'add' ? 'Add form' : 'Edit form'} subtitle={editing.mode === 'add' ? 'New form' : editing.id} onClose={() => setEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            <label>Name<input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Description<input className="inp" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            <label className="admin-drawer-check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={!draft.name.trim()} onClick={() => saveMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
