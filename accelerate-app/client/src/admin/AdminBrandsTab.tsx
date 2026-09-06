import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Agency, type BrandIndicationRow } from '../api';
import EditPanel from './EditPanel';

const BRANDED_OPTIONS = ['Branded', 'Unbranded'];

interface DraftBrandRow {
  brand: string;
  indication: string;
  brandedUnbranded: string;
}

const EMPTY_ROW: DraftBrandRow = { brand: '', indication: '', brandedUnbranded: BRANDED_OPTIONS[0] };

// Two coherent halves of the same "who can see/run which brand" picture:
// the brand list itself (each brand's indications nested under it — the
// same BrandIndication rows the New Campaign modal's autofill already
// reads), and which agencies have access to which of those brands
// (many-to-many — two agencies can share a brand, one agency can hold
// several). The XM/CDM-to-brand mapping lives in the Users tab instead,
// since that's a one-brand-per-person rule, not a checklist.
export default function AdminBrandsTab() {
  const queryClient = useQueryClient();
  const rowsQuery = useQuery({ queryKey: ['admin-brand-indications'], queryFn: api.getBrandIndications });
  const agenciesQuery = useQuery({ queryKey: ['admin-agencies'], queryFn: api.getAgencies });
  const rows = rowsQuery.data?.rows || [];
  const agencies = agenciesQuery.data?.agencies || [];

  const brandGroups = new Map<string, BrandIndicationRow[]>();
  rows.forEach((r) => {
    if (!brandGroups.has(r.brand)) brandGroups.set(r.brand, []);
    brandGroups.get(r.brand)!.push(r);
  });
  const brandNames = Array.from(brandGroups.keys()).sort();

  // ---- Brand/indication drawer ----
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

  // ---- Agency drawer (name + brand-access checklist) ----
  const [agencyEditing, setAgencyEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [agencyName, setAgencyName] = useState('');
  const [agencyBrands, setAgencyBrands] = useState<string[]>([]);

  function openAddAgency() {
    setAgencyName('');
    setAgencyBrands([]);
    setAgencyEditing({ mode: 'add' });
  }
  function openEditAgency(a: Agency) {
    setAgencyName(a.name);
    setAgencyBrands(a.access.map((x) => x.brand));
    setAgencyEditing({ mode: 'edit', id: a.id });
  }
  function toggleAgencyBrand(brand: string) {
    setAgencyBrands((prev) => (prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]));
  }

  const saveAgencyMutation = useMutation({
    mutationFn: async () => {
      if (!agencyEditing) return;
      if (agencyEditing.mode === 'add') {
        const { agency } = await api.addAgency(agencyName.trim());
        if (agencyBrands.length) await api.setAgencyBrands(agency.id, agencyBrands);
      } else {
        await api.setAgencyBrands(agencyEditing.id, agencyBrands);
      }
    },
    onSuccess: () => {
      setAgencyEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-agencies'] });
    },
  });

  const deleteAgencyMutation = useMutation({
    mutationFn: (id: string) => api.deleteAgency(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-agencies'] }),
  });

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr', display: 'flex', flexDirection: 'column', gap: 20 }}>
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
            <tr><th>Brand</th><th>Indication</th><th>Branded / Unbranded</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No brands yet.</td></tr>
            )}
            {brandNames.map((brand) => (
              brandGroups.get(brand)!.map((r, i) => (
                <tr className="admin-frow" key={r.id}>
                  <td><div className="admin-flabel">{i === 0 ? brand : ''}</div></td>
                  <td>{r.indication}</td>
                  <td>{r.brandedUnbranded}</td>
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

      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Agencies &amp; Brand Access</h3>
            <p>{agencies.length} agenc{agencies.length === 1 ? 'y' : 'ies'} · a brand can be shared across several agencies.</p>
          </div>
          <button className="btn-primary" onClick={openAddAgency}>+ Add agency</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Agency</th><th>Brand access</th><th></th></tr>
          </thead>
          <tbody>
            {agencies.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No agencies yet.</td></tr>
            )}
            {agencies.map((a) => (
              <tr className="admin-frow" key={a.id}>
                <td><div className="admin-flabel">{a.name}</div></td>
                <td>{a.access.length ? a.access.map((x) => x.brand).join(', ') : <span style={{ color: 'var(--ink3)' }}>No brands yet</span>}</td>
                <td>
                  <div className="admin-fops">
                    <button onClick={() => openEditAgency(a)}>Edit access</button>
                    <button className="danger" onClick={() => { if (confirm(`Remove ${a.name}?`)) deleteAgencyMutation.mutate(a.id); }}>Delete</button>
                  </div>
                </td>
              </tr>
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

      {agencyEditing && (
        <EditPanel title={agencyEditing.mode === 'add' ? 'Add agency' : 'Edit agency access'} subtitle={agencyName || 'New agency'} onClose={() => setAgencyEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            {agencyEditing.mode === 'add' && (
              <label className="wide">Agency name<input className="inp" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} /></label>
            )}
            <label className="wide">
              Brand access
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {brandNames.length === 0 && <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>Add a brand above first.</span>}
                {brandNames.map((b) => (
                  <label key={b} className="admin-drawer-check" style={{ fontWeight: 400 }}>
                    <input type="checkbox" checked={agencyBrands.includes(b)} onChange={() => toggleAgencyBrand(b)} /> {b}
                  </label>
                ))}
              </div>
            </label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={agencyEditing.mode === 'add' && !agencyName.trim()} onClick={() => saveAgencyMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setAgencyEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
