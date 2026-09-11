import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BrandIndicationRow } from '../api';
import EditPanel from './EditPanel';

const BRANDED_OPTIONS = ['Branded', 'Unbranded'];

interface DraftBrandRow {
  brand: string;
  indication: string;
  brandedUnbranded: string;
}

const EMPTY_ROW: DraftBrandRow = { brand: '', indication: '', brandedUnbranded: BRANDED_OPTIONS[0] };

// The brand list itself — each brand's indications nested under it, same
// BrandIndication rows the New Campaign modal's autofill already reads.
// Branded/Unbranded still has to be set per indication (Asset Scope
// inference depends on it), so it stays in the add/edit form, but it's
// dropped as its own table column — it was cluttering the list view
// without earning its place there. Agency/brand-access management used to
// live in this tab too; per direct instruction that was redundant with the
// Users tab's own organization + brand mapping, so it's gone from here —
// see AdminUsersTab.
export default function AdminBrandsTab() {
  const queryClient = useQueryClient();
  const rowsQuery = useQuery({ queryKey: ['admin-brand-indications'], queryFn: api.getBrandIndications });
  const rows = rowsQuery.data?.rows || [];

  const brandGroups = new Map<string, BrandIndicationRow[]>();
  rows.forEach((r) => {
    if (!brandGroups.has(r.brand)) brandGroups.set(r.brand, []);
    brandGroups.get(r.brand)!.push(r);
  });
  const brandNames = Array.from(brandGroups.keys()).sort();

  const [rowEditing, setRowEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: number } | null>(null);
  const [rowDraft, setRowDraft] = useState<DraftBrandRow>(EMPTY_ROW);

  function openAddRow(brand?: string) {
    setRowDraft({ ...EMPTY_ROW, brand: brand || '' });
    setRowEditing({ mode: 'add' });
  }
  function openEditRow(r: BrandIndicationRow) {
    setRowDraft({ brand: r.brand, indication: r.indication, brandedUnbranded: r.brandedUnbranded });
    setRowEditing({ mode: 'edit', id: r.id });
  }

  const saveRowMutation = useMutation({
    mutationFn: async () => {
      if (!rowEditing) return;
      const payload = { brand: rowDraft.brand.trim(), indication: rowDraft.indication.trim(), brandedUnbranded: rowDraft.brandedUnbranded };
      if (rowEditing.mode === 'add') await api.addBrandIndication(payload);
      else await api.updateBrandIndication(rowEditing.id, payload);
    },
    onSuccess: () => {
      setRowEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-brand-indications'] });
    },
  });

  const deleteRowMutation = useMutation({
    mutationFn: (id: number) => api.deleteBrandIndication(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-brand-indications'] }),
  });

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr' }}>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Brands &amp; Indications</h3>
            <p>{brandNames.length} brand{brandNames.length === 1 ? '' : 's'} · {rows.length} indication{rows.length === 1 ? '' : 's'} total</p>
          </div>
          <button className="btn-primary" onClick={() => openAddRow()}>+ Add brand / indication</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Brand</th><th>Indication</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No brands yet.</td></tr>
            )}
            {brandNames.map((brand) => (
              brandGroups.get(brand)!.map((r, i) => (
                <tr className="admin-frow" key={r.id}>
                  <td><div className="admin-flabel">{i === 0 ? brand : ''}</div></td>
                  <td>{r.indication}</td>
                  <td>
                    <div className="admin-fops">
                      <button onClick={() => openEditRow(r)}>Edit</button>
                      <button className="danger" onClick={() => { if (confirm(`Delete ${r.brand} / ${r.indication}?`)) deleteRowMutation.mutate(r.id); }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </section>

      {rowEditing && (
        <EditPanel title={rowEditing.mode === 'add' ? 'Add brand / indication' : 'Edit indication'} subtitle={rowDraft.brand || 'New brand'} onClose={() => setRowEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            <label className="wide">Brand<input className="inp" value={rowDraft.brand} onChange={(e) => setRowDraft({ ...rowDraft, brand: e.target.value })} /></label>
            <label className="wide">Indication<input className="inp" value={rowDraft.indication} onChange={(e) => setRowDraft({ ...rowDraft, indication: e.target.value })} /></label>
            <label>
              Branded / Unbranded
              <select className="sel" value={rowDraft.brandedUnbranded} onChange={(e) => setRowDraft({ ...rowDraft, brandedUnbranded: e.target.value })}>
                {BRANDED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={!rowDraft.brand.trim() || !rowDraft.indication.trim()} onClick={() => saveRowMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setRowEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
