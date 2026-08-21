import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { NudgeRule } from '../types';
import EditPanel from './EditPanel';

const TRIGGERS = ['section_submitted', 'field_value_equals', 'phase_complete', 'section_group_complete', 'fields_remaining'];
const PHASES = ['', 'preplan', 'plan', 'exec'];
const OWNERS = ['', 'aor', 'xm', 'mds', 'cep', 'ops', 'dca', 'oms'];

interface DraftNudge {
  trigger: string;
  triggerSectionId: string;
  triggerPhase: string;
  triggerFieldDrives: string;
  triggerValue: string;
  triggerSectionIds: string;
  triggerFieldKey: string;
  conditions: string;
  nudgeToOwner: string;
  message: string;
  nudgeMessage: string;
  active: boolean;
}

const EMPTY: DraftNudge = { trigger: TRIGGERS[0], triggerSectionId: '', triggerPhase: '', triggerFieldDrives: '', triggerValue: '', triggerSectionIds: '', triggerFieldKey: '', conditions: '', nudgeToOwner: '', message: '', nudgeMessage: '', active: true };

function parseConditions(text: string): string | null {
  const rules = text.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return null;
    return { key: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
  }).filter((r): r is { key: string; value: string } => !!r);
  return rules.length ? JSON.stringify({ logic: 'and', rules }) : null;
}

function conditionsToText(json: string | null | undefined): string {
  try {
    const c = JSON.parse(json || 'null');
    return c && Array.isArray(c.rules) ? c.rules.map((r: { key: string; value: string }) => `${r.key}=${r.value}`).join(', ') : '';
  } catch {
    return '';
  }
}

function toPayload(d: DraftNudge) {
  const sectionIds = d.triggerSectionIds.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    trigger: d.trigger, triggerSectionId: d.triggerSectionId || null, triggerPhase: d.triggerPhase || null,
    triggerFieldDrives: d.triggerFieldDrives || null, triggerValue: d.triggerValue || null,
    triggerSectionIds: sectionIds.length ? JSON.stringify(sectionIds) : null,
    triggerFieldKey: d.triggerFieldKey || null, conditionsJson: parseConditions(d.conditions),
    nudgeToOwner: d.nudgeToOwner || null, message: d.message, nudgeMessage: d.nudgeMessage || null,
    active: d.active,
  };
}

function triggerLabel(r: NudgeRule) {
  return `${r.trigger}${r.triggerSectionId ? ` · ${r.triggerSectionId}` : ''}${r.triggerPhase ? ` · ${r.triggerPhase}` : ''}`;
}

// Ported from index.html's renderAdminNudgesTable()/renderAdminNudgeDrawer().
export default function AdminNudgesTab() {
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ['admin-nudge-rules'], queryFn: api.getNudgeRules });
  const rules = rulesQuery.data?.rules || [];
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<DraftNudge>(EMPTY);

  function openAdd() {
    setDraft(EMPTY);
    setEditing({ mode: 'add' });
  }

  function openEdit(r: NudgeRule) {
    setDraft({
      trigger: r.trigger, triggerSectionId: r.triggerSectionId || '', triggerPhase: r.triggerPhase || '',
      triggerFieldDrives: r.triggerFieldDrives || '', triggerValue: r.triggerValue || '',
      triggerSectionIds: (() => { try { return JSON.parse(r.triggerSectionIds || '[]').join(','); } catch { return ''; } })(),
      triggerFieldKey: r.triggerFieldKey || '', conditions: conditionsToText(r.conditionsJson),
      nudgeToOwner: r.nudgeToOwner || '', message: r.message, nudgeMessage: r.nudgeMessage || '', active: r.active,
    });
    setEditing({ mode: 'edit', id: r.id });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (editing.mode === 'add') await api.addNudgeRule(toPayload(draft));
      else await api.updateNudgeRule(editing.id, toPayload(draft));
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['admin-nudge-rules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteNudgeRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-nudge-rules'] }),
  });

  return (
    <div className="admin-layout" style={{ gridTemplateColumns: '1fr' }}>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Nudge rules</h3>
            <p>{rules.length} rules, evaluated in order on every section submit.</p>
          </div>
          <button className="btn-primary" onClick={openAdd}>+ Add rule</button>
        </div>
        <table className="admin-ftable">
          <thead>
            <tr><th>Trigger</th><th>Message</th><th>Nudge to</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink3)', padding: 24 }}>No nudge rules yet.</td></tr>
            )}
            {rules.map((r) => {
              const plainMsg = (r.message || '').replace(/<[^>]+>/g, '');
              return (
                <tr className="admin-frow" key={r.id}>
                  <td><div className="admin-flabel">{triggerLabel(r)}</div></td>
                  <td>{plainMsg.slice(0, 70)}{plainMsg.length > 70 ? '…' : ''}</td>
                  <td>{r.nudgeToOwner || '—'}</td>
                  <td>{r.active ? '✓ Active' : 'Inactive'}</td>
                  <td>
                    <div className="admin-fops">
                      <button onClick={() => openEdit(r)}>Edit</button>
                      <button className="danger" onClick={() => { if (confirm('Delete this nudge rule?')) deleteMutation.mutate(r.id); }}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditPanel title={editing.mode === 'add' ? 'Add nudge rule' : 'Edit nudge rule'} subtitle={editing.mode === 'add' ? 'New rule' : triggerLabel({ ...draft } as unknown as NudgeRule)} onClose={() => setEditing(null)}>
          <div className="admin-drawer-grid admin-drawer-grid-stacked">
            <label>Trigger type<select className="sel" value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>{TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Section id (for section_submitted / fields_remaining)<input className="inp" value={draft.triggerSectionId} onChange={(e) => setDraft({ ...draft, triggerSectionId: e.target.value })} /></label>
            <label>Phase (for phase_complete / section_group_complete)<select className="sel" value={draft.triggerPhase} onChange={(e) => setDraft({ ...draft, triggerPhase: e.target.value })}>{PHASES.map((p) => <option key={p} value={p}>{p || '(none)'}</option>)}</select></label>
            <label>Drives key (for field_value_equals)<input className="inp" value={draft.triggerFieldDrives} onChange={(e) => setDraft({ ...draft, triggerFieldDrives: e.target.value })} /></label>
            <label>Value (for field_value_equals)<input className="inp" value={draft.triggerValue} onChange={(e) => setDraft({ ...draft, triggerValue: e.target.value })} /></label>
            <label>Section ids (for section_group_complete — comma-separated)<input className="inp" value={draft.triggerSectionIds} onChange={(e) => setDraft({ ...draft, triggerSectionIds: e.target.value })} /></label>
            <label>Metasheet field key (for fields_remaining)<input className="inp" value={draft.triggerFieldKey} onChange={(e) => setDraft({ ...draft, triggerFieldKey: e.target.value })} /></label>
            <label className="wide">Extra conditions (optional AND-gate — key=value, key=value)<input className="inp" placeholder="enrollment=Yes, metadataSource=New metadata" value={draft.conditions} onChange={(e) => setDraft({ ...draft, conditions: e.target.value })} /></label>
            <label>Nudge to owner<select className="sel" value={draft.nudgeToOwner} onChange={(e) => setDraft({ ...draft, nudgeToOwner: e.target.value })}>{OWNERS.map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}</select></label>
            <label className="wide">Message<input className="inp" value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} /></label>
            <label className="wide">Nudge message (optional follow-up)<input className="inp" value={draft.nudgeMessage} onChange={(e) => setDraft({ ...draft, nudgeMessage: e.target.value })} /></label>
            <label className="admin-drawer-check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
          </div>
          <div className="admin-drawer-actions">
            <button className="btn-primary" disabled={!draft.message.trim()} onClick={() => saveMutation.mutate()}>Save changes</button>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </EditPanel>
      )}
    </div>
  );
}
