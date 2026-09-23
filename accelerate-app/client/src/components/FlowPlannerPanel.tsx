import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useFlowPlannerStore, DEFAULT_FLOW_PLANNER_INPUTS, normalizeFlowPlannerInputs, toGenerateRequest, type FlowPlannerInputs } from '../stores/useFlowPlannerStore';
import type { FormSection } from '../types';

// The real segmentation-diagram generator for the Flow tab — ported server
// logic (accelerate-app/server/segmentation/*, itself ported from the
// campaign-accelerator-api reference project) renders an inline SVG from the
// campaign's OWN field data and offers a genuine .vsdx download. Replaces
// both the old static /visio-cropped.pdf reference image AND the scripted
// four-question clarify gate that used to sit in front of it — this reads
// straight from the campaign's real Intake/Journey fields (same SOP field
// numbering, see FIELD_MAP below) instead of asking the Solution Architect
// to re-type the same handful of facts through a fixed multiple-choice
// script.

// Where each segmentation input actually lives in this app's real schema
// (accelerate-app/server's own field keys — confirmed live via
// GET /api/schema, not assumed from the reference project's numbering,
// which drifted by a field or two from this app's own history).
const FIELD_MAP = {
  branded: { section: 'generic', key: '1.1.5' },
  audience: { section: 'generic', key: '1.1.6' },
  campaignName: { section: 'generic', key: '1.1.8' },
  goal: { section: 'generic', key: '1.1.9' },
  campaignCode: { section: 'generic', key: '1.1.10' },
  campaignType: { section: 'generic', key: '1.1.12' },
  segments: { section: 'generic', key: '1.1.13' },
  metadataSheet: { section: 'cma', key: '1.4.6' },
  businessRules: { section: 'dc', key: '1.8.5' },
  specialtyInclusion: { section: 'dc', key: '1.8.6' },
  specialtyExclusion: { section: 'dc', key: '1.8.7' },
} as const;
const OMS_SOURCE_NAME = (i: number) => ({ section: 'oms', key: `1.4.3.${i}` });
const OMS_SOURCE_QNA = (i: number) => ({ section: 'oms', key: `1.4.4.${i}` });
const OMS_SOURCE_CODE = { section: 'oms', key: '1.4.5' };

async function readRealInputs(tactplanId: string): Promise<Partial<FlowPlannerInputs> | null> {
  const [{ sections }, { entries }] = await Promise.all([api.getSchema(), api.getEntries(tactplanId)]);
  const fieldIdByKey = new Map<string, string>(); // "sectionId/fieldKey" -> field.id
  for (const sec of sections as FormSection[]) for (const f of sec.fields) fieldIdByKey.set(`${sec.id}/${f.fieldKey}`, f.id);
  const valueByFieldId = new Map<string, string>();
  for (const e of entries) if (e.value) valueByFieldId.set(e.fieldId, e.value);

  const get = (ref: { section: string; key: string }) => {
    const fid = fieldIdByKey.get(`${ref.section}/${ref.key}`);
    return fid ? valueByFieldId.get(fid) || '' : '';
  };

  const audienceRaw = get(FIELD_MAP.audience).trim().toUpperCase();
  const audience = audienceRaw === 'DTC' || audienceRaw === 'HCP' ? (audienceRaw as 'DTC' | 'HCP') : '';
  const goal = get(FIELD_MAP.goal);
  const branded = get(FIELD_MAP.branded);
  const campaignCode = get(FIELD_MAP.campaignCode);

  const sources = [];
  for (let i = 1; i <= 6; i++) {
    const name = get(OMS_SOURCE_NAME(i));
    const qna = get(OMS_SOURCE_QNA(i));
    if (!name && !qna) continue;
    sources.push({ name, code: i === 1 ? get(OMS_SOURCE_CODE) : '', qna });
  }

  const unbrandedPresent = branded.trim().toLowerCase() === 'unbranded' || /unbranded/i.test(goal);

  return {
    audience,
    campaignName: get(FIELD_MAP.campaignName),
    campaignCode,
    campaignType: get(FIELD_MAP.campaignType),
    goal,
    enrollmentSources: sources.length ? sources : [{ name: '', code: '', qna: '' }],
    qna: sources.map((s) => s.qna).filter(Boolean).join('; '),
    metadataSheet: get(FIELD_MAP.metadataSheet),
    segments: get(FIELD_MAP.segments).replace(/\n+/g, ', '),
    unbranded: {
      present: unbrandedPresent,
      campaignCode,
      lastTouchpointQuestion: '',
      lastTouchpointMetadataId: '',
      answerCodes: '',
    },
    suppressionAnswers: {
      businessRules: get(FIELD_MAP.businessRules),
      specialtyInclusion: get(FIELD_MAP.specialtyInclusion),
      specialtyExclusion: get(FIELD_MAP.specialtyExclusion),
    },
  };
}

export default function FlowPlannerPanel({ tactplanId, canAuthor, onGenerated }: { tactplanId: string; canAuthor: boolean; onGenerated?: () => void }) {
  // Selector returns the raw stored entry (or undefined) so its reference
  // only changes when the store itself actually updates it; normalizing
  // happens in the memo below rather than inline in the selector, which
  // would otherwise build a new merged object — and so a new reference —
  // on every single store update, unrelated ones included.
  const rawInputs = useFlowPlannerStore((s) => s.byCampaign[tactplanId]);
  const inputs = useMemo(() => (rawInputs ? normalizeFlowPlannerInputs(rawInputs) : DEFAULT_FLOW_PLANNER_INPUTS), [rawInputs]);
  const result = useFlowPlannerStore((s) => s.results[tactplanId]);
  const setField = useFlowPlannerStore((s) => s.setField);
  const setSource = useFlowPlannerStore((s) => s.setSource);
  const addSource = useFlowPlannerStore((s) => s.addSource);
  const setUnbranded = useFlowPlannerStore((s) => s.setUnbranded);
  const setResult = useFlowPlannerStore((s) => s.setResult);
  const setCodeAssignments = useFlowPlannerStore((s) => s.setCodeAssignments);
  const applyRealInputs = useFlowPlannerStore((s) => s.applyRealInputs);

  const [showInputs, setShowInputs] = useState(!result);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncedOnce, setSyncedOnce] = useState(false);

  async function syncFromCampaign(silent = false) {
    if (!silent) setSyncing(true);
    setError('');
    try {
      const real = await readRealInputs(tactplanId);
      if (real) applyRealInputs(tactplanId, real);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Could not read campaign data');
    } finally {
      if (!silent) setSyncing(false);
    }
  }

  // Pull the campaign's real field data in automatically the first time this
  // tab is opened for a campaign that hasn't had its flow-planner inputs
  // touched yet — no manual step needed for the common case. The "Sync from
  // campaign data" button below covers re-syncing after Intake changes.
  useEffect(() => {
    if (syncedOnce || !canAuthor) return;
    setSyncedOnce(true);
    if (!inputs.audience && !inputs.campaignName) syncFromCampaign(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tactplanId, canAuthor]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/flow-planner/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toGenerateRequest(inputs)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Generation failed');
      const data = await res.json();
      setResult(tactplanId, data.svg);
      if (data.codeAssignments) setCodeAssignments(tactplanId, data.codeAssignments);
      setShowInputs(false);
      onGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function downloadVsdx() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/flow-planner/vsdx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toGenerateRequest(inputs)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(inputs.campaignName || 'segmentation-flow').replace(/[^a-z0-9-]+/gi, '-')}.vsdx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fp-root">
      <div className="fp-toolbar">
        <div className="fp-tool-group">
          {canAuthor && (
            <>
              <button className="vb-tool" onClick={() => setShowInputs((v) => !v)}>
                {showInputs ? 'Hide inputs' : 'Edit inputs'}
              </button>
              <button className="vb-tool" onClick={() => syncFromCampaign(false)} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync from campaign data'}
              </button>
            </>
          )}
        </div>
        {result && (
          <button className="vb-pdf-action" onClick={downloadVsdx} disabled={busy}>
            Download .vsdx
          </button>
        )}
      </div>

      {canAuthor && showInputs && (
        <div className="fp-inputs">
          <div className="fp-hint">Pulled from this campaign&apos;s own Intake/Journey/Data Cloud fields — edit here only to fill a gap those sections don&apos;t cover yet (SOP row 6 &amp; row 7 details).</div>
          <div className="fp-row">
            <label className="fp-field">
              <span>Audience</span>
              <select value={inputs.audience} onChange={(e) => setField(tactplanId, 'audience', e.target.value as 'DTC' | 'HCP' | '')}>
                <option value="">Not set</option>
                <option value="DTC">DTC</option>
                <option value="HCP">HCP</option>
              </select>
            </label>
            <label className="fp-field">
              <span>Campaign type</span>
              <input value={inputs.campaignType} onChange={(e) => setField(tactplanId, 'campaignType', e.target.value)} placeholder="Ad Hoc / Cadenced / Automation" />
            </label>
          </div>
          <div className="fp-row">
            <label className="fp-field">
              <span>Campaign name</span>
              <input value={inputs.campaignName} onChange={(e) => setField(tactplanId, 'campaignName', e.target.value)} />
            </label>
            <label className="fp-field">
              <span>Campaign code</span>
              <input value={inputs.campaignCode} onChange={(e) => setField(tactplanId, 'campaignCode', e.target.value)} />
            </label>
          </div>
          <label className="fp-field fp-field-wide">
            <span>Campaign goal</span>
            <input value={inputs.goal} onChange={(e) => setField(tactplanId, 'goal', e.target.value)} />
          </label>

          {inputs.audience !== 'HCP' && (
            <div className="fp-sources">
              <span className="fp-section-label">Enrollment sources</span>
              {inputs.enrollmentSources.map((src, i) => (
                <div className="fp-row" key={i}>
                  <input placeholder="Source name" value={src.name} onChange={(e) => setSource(tactplanId, i, { name: e.target.value })} />
                  <input placeholder="Source code" value={src.code} onChange={(e) => setSource(tactplanId, i, { code: e.target.value })} />
                  <input placeholder="QnA" value={src.qna} onChange={(e) => setSource(tactplanId, i, { qna: e.target.value })} />
                </div>
              ))}
              <button className="btn-ghost" onClick={() => addSource(tactplanId)}>
                + Add source
              </button>
            </div>
          )}

          <div className="fp-row">
            <label className="fp-field fp-field-wide">
              <span>Survey / metadata sheet QnA</span>
              <input value={inputs.qna} onChange={(e) => setField(tactplanId, 'qna', e.target.value)} />
            </label>
          </div>
          <label className="fp-field fp-field-wide">
            <span>Segment names (comma-separated, leave blank for TBD)</span>
            <input value={inputs.segments} onChange={(e) => setField(tactplanId, 'segments', e.target.value)} placeholder="PsO Bio Naive, PsO Bio Experienced" />
          </label>

          <div className="fp-unbranded">
            <label className="fp-checkbox">
              <input type="checkbox" checked={inputs.unbranded.present} onChange={(e) => setUnbranded(tactplanId, { present: e.target.checked })} />
              <span>Campaign goal requires capture from an unbranded source</span>
            </label>
            {inputs.unbranded.present && (
              <div className="fp-row">
                <input placeholder="Unbranded campaign code" value={inputs.unbranded.campaignCode} onChange={(e) => setUnbranded(tactplanId, { campaignCode: e.target.value })} />
                <input placeholder="Last touchpoint question code" value={inputs.unbranded.lastTouchpointQuestion} onChange={(e) => setUnbranded(tactplanId, { lastTouchpointQuestion: e.target.value })} />
                <input placeholder="Answer codes (comma-separated)" value={inputs.unbranded.answerCodes} onChange={(e) => setUnbranded(tactplanId, { answerCodes: e.target.value })} />
              </div>
            )}
          </div>

          {error && <div className="fp-error">{error}</div>}
          <button className="btn-primary" onClick={generate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate diagram'}
          </button>
        </div>
      )}

      <div className="fp-canvas-wrap">
        {result ? (
          <div className="fp-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
        ) : (
          <div className="vb-empty-overlay" style={{ position: 'static', padding: '48px 16px' }}>
            <span>No diagram generated yet</span>
            <span>{canAuthor ? 'Review the inputs above (pulled from this campaign\'s own fields) and generate the Segmentation flow.' : 'Waiting for the Solution Architect to generate the Segmentation flow.'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
