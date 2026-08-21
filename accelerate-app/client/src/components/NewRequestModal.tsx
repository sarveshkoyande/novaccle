import { useState } from 'react';
import type { CampaignRequest } from '../data/requests';

const NEW_REQ_COLORS = ['#E74A21', '#0460A9', '#EC961D', '#0A3D7A', '#5B6B7A', '#1E8E5A'];

// Ported from index.html's #newReqBackdrop modal + confirmNewRequest()/
// createCampaignRequest() — this modal WAS in the original markup but had
// no button anywhere wired to open it (startNewRequest() was dead code,
// never called). Same fields, same required-field set (NEW_REQ_REQUIRED),
// same "submitting this modal submits Generic/Overview's intake fields too"
// idea, simplified to just seeding the new request at the top of the list
// since the React app's request records aren't backed by a real DB table.
interface FormState {
  tactplanId: string;
  agency: string;
  brand: string;
  indication: string;
  brandedUnbranded: string;
  audience: string;
  assetScope: string;
  campaignName: string;
  channelEmail: boolean;
  channelSms: boolean;
}

const EMPTY: FormState = {
  tactplanId: 'TP-88500',
  agency: '',
  brand: '',
  indication: '',
  brandedUnbranded: '',
  audience: '',
  assetScope: '',
  campaignName: '',
  channelEmail: true,
  channelSms: true,
};

const REQUIRED: (keyof FormState)[] = ['tactplanId', 'agency', 'brand', 'indication', 'brandedUnbranded', 'audience', 'assetScope', 'campaignName'];

export default function NewRequestModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (req: CampaignRequest) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Set<string>>(new Set());

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e.has(key)) return e;
      const next = new Set(e);
      next.delete(key);
      return next;
    });
  }

  function handleSubmit() {
    const missing = REQUIRED.filter((k) => !String(form[k]).trim());
    if (missing.length) {
      setErrors(new Set(missing));
      return;
    }
    const channels = form.channelEmail && form.channelSms ? 'Email + SMS' : form.channelEmail ? 'Email only' : form.channelSms ? 'SMS only' : 'Email + SMS';
    const ic = form.brand.charAt(0).toUpperCase() || 'N';
    const req: CampaignRequest = {
      id: form.tactplanId.trim(),
      name: form.campaignName.trim(),
      brand: form.brand.trim(),
      ic,
      color: NEW_REQ_COLORS[Math.floor(Math.random() * NEW_REQ_COLORS.length)],
      phase: 'preplan',
      phaseLabel: 'Pre-planning',
      updated: 'just now',
      daysOpen: 0,
      status: 'active',
      indication: form.indication.trim(),
      channels,
      golive: '—',
      ready: '0%',
      fieldsResolved: '0 / 151',
      daysToGolive: '—',
      owners: ['aor'],
      action: { aor: 'me', xm: 'wait', mds: 'wait', cep: 'wait', ops: 'wait' },
      actionText: { aor: 'Start intake', xm: '—', mds: '—', cep: '—', ops: '—' },
      mineTo: ['aor'],
    };
    onCreate(req);
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-h">
          <h3>New campaign request</h3>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label className="modal-field">
            <span className="req-label">TactPlan ID</span>
            <input
              className={errors.has('tactplanId') ? 'field-error' : ''}
              placeholder="e.g. TP-88500"
              value={form.tactplanId}
              onChange={(e) => set('tactplanId', e.target.value)}
            />
          </label>
          <div className="modal-field-row">
            <label className="modal-field">
              <span className="req-label">Agency</span>
              <input
                className={errors.has('agency') ? 'field-error' : ''}
                placeholder="e.g. Ogilvy Health"
                value={form.agency}
                onChange={(e) => set('agency', e.target.value)}
              />
            </label>
            <label className="modal-field">
              <span className="req-label">Brand</span>
              <input
                className={errors.has('brand') ? 'field-error' : ''}
                placeholder="Search or type a new brand…"
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
              />
            </label>
          </div>
          <label className="modal-field">
            <span className="req-label">Indication</span>
            <input
              className={errors.has('indication') ? 'field-error' : ''}
              placeholder="Search or type a new indication…"
              value={form.indication}
              onChange={(e) => set('indication', e.target.value)}
            />
          </label>
          <div className="modal-field-row">
            <label className="modal-field">
              <span className="req-label">Branded / Unbranded</span>
              <select
                className={errors.has('brandedUnbranded') ? 'field-error' : ''}
                value={form.brandedUnbranded}
                onChange={(e) => set('brandedUnbranded', e.target.value)}
              >
                <option value="" disabled hidden>Select…</option>
                <option value="Branded">Branded</option>
                <option value="Unbranded">Unbranded</option>
              </select>
            </label>
            <label className="modal-field">
              <span className="req-label">Audience</span>
              <input
                className={errors.has('audience') ? 'field-error' : ''}
                placeholder="e.g. HCP — Medical oncology"
                value={form.audience}
                onChange={(e) => set('audience', e.target.value)}
              />
            </label>
          </div>
          <div className="modal-field-row">
            <label className="modal-field">
              <span className="req-label">Asset Scope</span>
              <select
                className={errors.has('assetScope') ? 'field-error' : ''}
                value={form.assetScope}
                onChange={(e) => set('assetScope', e.target.value)}
              >
                <option value="" disabled hidden>Select…</option>
                <option value="Update Existing Campaign">Update Existing Campaign</option>
                <option value="New Brand Launch">New Brand Launch</option>
                <option value="New Indication Launch">New Indication Launch</option>
              </select>
            </label>
            <label className="modal-field">
              <span className="req-label">Campaign Name</span>
              <input
                className={errors.has('campaignName') ? 'field-error' : ''}
                placeholder="e.g. Kisqali HCP Adjuvant Q3"
                value={form.campaignName}
                onChange={(e) => set('campaignName', e.target.value)}
              />
            </label>
          </div>
          <div className="modal-field">
            <span>Channel Type</span>
            <div className="modal-check-row">
              <label className="modal-check">
                <input type="checkbox" checked={form.channelEmail} onChange={(e) => set('channelEmail', e.target.checked)} /> Email
              </label>
              <label className="modal-check">
                <input type="checkbox" checked={form.channelSms} onChange={(e) => set('channelSms', e.target.checked)} /> SMS
              </label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>Submit</button>
        </div>
      </div>
    </div>
  );
}
