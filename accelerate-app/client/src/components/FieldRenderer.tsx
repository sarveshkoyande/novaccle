import { useState } from 'react';
import type { FormField } from '../types';

// Ported from index.html's renderField() — covers the 6 common field types
// (text/ta/sel/multi/date/file). `metasheet` (a nested sub-grid, used only by
// CMA Metadata Sheet) is deliberately not implemented in this pass — it's
// the one field type this component doesn't yet handle.
export default function FieldRenderer({
  field,
  value,
  editable,
  onChange,
  notMyField,
}: {
  field: FormField;
  value: string;
  editable: boolean;
  onChange: (fieldId: string, value: string) => void;
  notMyField?: boolean;
}) {
  const hardReadonly = !editable || field.locked || !!notMyField;
  const hasValue = !!(value && value.trim());
  // A field you own and can still edit, but that's already answered, reads
  // as a settled fact until you click it — same reasoning as the hard
  // read-only case below, just reversible: click to drop into the real
  // control, click out (blur) to drop back to the readout. onChange already
  // pushes every keystroke up to the parent's controlled `value`, so by the
  // time blur fires the readout has the latest value to show.
  const [forceEdit, setForceEdit] = useState(false);
  const revertToReadout = () => setForceEdit(false);
  const showReadout = (hardReadonly || hasValue) && !forceEdit;

  const isRequired = /\*\s*$/.test(field.label);
  const labelText = isRequired ? field.label.replace(/\*\s*$/, '').trim() : field.label;

  // A settled value being read, not a form control being filled in — plain
  // label above a bold value, no input chrome. Per direct reference: a
  // disabled/greyed input box (or, for an already-answered field, a box at
  // all) reads as "form control," not "fact on record." Locked/submitted/
  // not-your-field values are permanently read-only; an already-filled
  // field you still own is click-to-edit.
  if (showReadout) {
    const editableReadout = !hardReadonly;
    const srcCaption = field.source && field.source !== '—' ? <div className="f-src">{field.source}</div> : null;
    const ownerCaption = notMyField ? <div className="f-src">Owned by {field.owner}</div> : null;
    return (
      <div
        className={`f f-readout ${editableReadout ? 'f-editable-readout' : ''} ${field.wide ? 'wide' : ''}`}
        data-fid={field.id}
        onClick={editableReadout ? () => setForceEdit(true) : undefined}
        title={editableReadout ? 'Click to edit' : undefined}
      >
        <div className="f-readout-lbl">{labelText}</div>
        <div className="f-readout-val">{value || '—'}</div>
        {srcCaption}
        {ownerCaption}
      </div>
    );
  }

  // Past this point the field is genuinely editable and empty (or was just
  // clicked into edit mode) — none of the controls below need a
  // readonly/disabled branch of their own. A field that just dropped out of
  // readout mode (forceEdit) keeps the boxed .inp/.sel/.ta look off — an
  // underline that only appears while actually focused, so it never sits
  // there afterward looking like a permanently "broken" box.
  const inlineCls = forceEdit ? 'f-inline-edit' : '';
  const revertOnBlur = forceEdit ? revertToReadout : undefined;
  let control: React.ReactNode;
  if (field.type === 'ta') {
    control = <textarea className={`ta ${inlineCls}`} autoFocus={forceEdit} value={value} onChange={(e) => onChange(field.id, e.target.value)} onBlur={revertOnBlur} />;
  } else if (field.type === 'sel') {
    control = (
      <select className={`sel ${inlineCls}`} autoFocus={forceEdit} value={value || ''} onChange={(e) => onChange(field.id, e.target.value)} onBlur={revertOnBlur}>
        <option value="" disabled hidden>
          Select…
        </option>
        {(field.opts && field.opts.length ? field.opts : ['Yes', 'No']).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'multi') {
    const emailOn = (value || '').includes('Email');
    const smsOn = (value || '').includes('SMS');
    const toggle = (channel: 'Email' | 'SMS', on: boolean) => {
      const set = new Set((value || '').split('+').map((s) => s.trim()).filter(Boolean));
      if (on) set.add(channel);
      else set.delete(channel);
      onChange(field.id, [...set].join(' + '));
    };
    control = (
      <div className="modal-check-row">
        <label className="modal-check">
          <input type="checkbox" checked={emailOn} onChange={(e) => toggle('Email', e.target.checked)} /> Email
        </label>
        <label className="modal-check">
          <input type="checkbox" checked={smsOn} onChange={(e) => toggle('SMS', e.target.checked)} /> SMS
        </label>
      </div>
    );
  } else if (field.type === 'date') {
    control = <input type="date" className={`inp ${inlineCls}`} autoFocus={forceEdit} value={value || ''} onChange={(e) => onChange(field.id, e.target.value)} onBlur={revertOnBlur} />;
  } else if (field.type === 'file') {
    control = (
      <div className="file-upload">
        <input type="file" id={`file-${field.id}`} onChange={(e) => onChange(field.id, e.target.files?.[0]?.name || '')} />
        <label className="file-btn" htmlFor={`file-${field.id}`}>
          Choose file
        </label>
        <span className="file-name">{value || 'No file chosen'}</span>
      </div>
    );
  } else {
    control = <input className={`inp ${inlineCls}`} autoFocus={forceEdit} value={value || ''} placeholder="Enter value…" onChange={(e) => onChange(field.id, e.target.value)} onBlur={revertOnBlur} />;
  }

  const srcCaption = field.source && field.source !== '—' ? <div className="f-src">{field.source}</div> : null;
  const ownerCaption = notMyField ? <div className="f-src">Owned by {field.owner}</div> : null;

  return (
    <div className={`f ${field.wide ? 'wide' : ''}`} data-fid={field.id}>
      <div className={`f-lbl ${isRequired ? 'req-label' : ''}`}>{labelText}</div>
      {control}
      {srcCaption}
      {ownerCaption}
    </div>
  );
}
