import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppUser } from '../api';
import EditPanel from './EditPanel';

// Every real stakeholder type — not just XM/CDM. Brand mapping still makes
// the most sense for XM/CDM (one brand each, per direct instruction), but
// the field stays open to any role since organization + an optional brand
// is useful bookkeeping for the whole roster, not just those two.
const ROLE_TYPES = ['aor', 'xm', 'mds', 'cep', 'ops', 'dca', 'oms', 'solutionArchitect', 'cdm'];
const ROLE_LABEL: Record<string, string> = {
  aor: 'AOR',
  xm: 'XM',
  mds: 'MDS',
  cep: 'CEP',
  ops: 'Campaign Ops',
  dca: 'Data Cloud Architect',
  oms: 'OMS',
  solutionArchitect: 'Solution Architect',
  cdm: 'CDM',
};

interface DraftUser {
  name: string;
  email: string;
  roleType: string;
  organization: string;
  brand: string;
}

const EMPTY: DraftUser = { name: '', email: '', roleType: ROLE_TYPES[0], organization: '', brand: '' };

// The user directory — real named people across every stakeholder type,
// each with their organization and (where it applies) the one brand
// they're mapped to. Replaces the earlier separate Agency/brand-access
// admin tab: organization plus this same mapping already said who has
// access to what, so a second access-list was redundant.
export default function AdminUsersTab() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: api.getAppUsers });
  const brandsQuery = useQuery({ queryKey: ['admin-brand-indications'], queryFn: api.getBrandIndications });
  const users = usersQuery.data?.users || [];
  const brandNames = Array.from(new Set((brandsQuery.data?.rows || []).map((r) => r.brand))).sort();

  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<DraftUser>(EMPTY);

  function openAdd() {
    setDraft(EMPTY);
    setEditing({ mode: 'add' });
  }

  function openEdit(u: AppUser) {
    setDraft({ name: u.name, email: u.email || '', roleType: u.roleType, organization: u.organization || '', brand: u.brand || '' });
    setEditing({ mode: 'edit', id: u.id });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const payload = {
        name: draft.name.trim(),
        email: draft.email.trim() || undefined,
        roleType: draft.roleType,
        organization: draft.organization.trim() || undefined,
        brand: draft.brand || undefined,
      };
      if (editing.mode === 'add') await api.addAppUser(payload);
      else await api.updateAppUser(editing.id, payload);
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr' }}>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Users</h3>
            <p>{users.length} user{users.length === 1 ? '' : 's'} · XM and CDM are each mapped to exactly one brand.</p>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add user</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Organization</th><th>Brand</th><th>Email</th><th></th></tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No users yet.</td></tr>
            )}
            {users.map((u) => (
              <tr className="admin-frow" key={u.id}>
                <td><div className="admin-flabel">{u.name}</div></td>
                <td><span className="admin-ftype-badge">{ROLE_LABEL[u.roleType] || u.roleType}</span></td>
                <td>{u.organization || <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                <td>{u.brand || <span style={{ color: 'var(--ink3)' }}>Unassigned</span>}</td>
                <td>{u.email || '—'}</td>
                <td>
                  <div className="admin-fops">
                    <button onClick={() => openEdit(u)}>Edit</button>
                    <button className="danger" onClick={() => { if (confirm(`Remove ${u.name}?`)) deleteMutation.mutate(u.id); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditPanel title={editing.mode === 'add' ? 'Add user' : 'Edit user'} subtitle={draft.name || 'New user'} onClose={() => setEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            <label className="wide">Name<input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="wide">Email (optional)<input className="inp" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
            <label>
              Role
              <select className="sel" value={draft.roleType} onChange={(e) => setDraft({ ...draft, roleType: e.target.value })}>
                {ROLE_TYPES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label className="wide">Organization (optional)<input className="inp" placeholder="e.g. Ogilvy, Novartis" value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} /></label>
            <label>
              Mapped brand
              <select className="sel" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}>
                <option value="">(unassigned)</option>
                {brandNames.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
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
