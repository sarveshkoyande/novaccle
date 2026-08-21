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
  const readonly = !editable || field.locked || !!notMyField;
  const isRequired = /\*\s*$/.test(field.label);
  const labelText = isRequired ? field.label.replace(/\*\s*$/, '').trim() : field.label;

  let control: React.ReactNode;
  if (field.type === 'ta') {
    control = (
      <textarea className="ta" readOnly={readonly} value={value} onChange={(e) => onChange(field.id, e.target.value)} />
    );
  } else if (field.type === 'sel') {
    control = (
      <select
        className="sel"
        disabled={readonly}
        value={value || ''}
        onChange={(e) => onChange(field.id, e.target.value)}
      >
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
          <input type="checkbox" checked={emailOn} disabled={readonly} onChange={(e) => toggle('Email', e.target.checked)} /> Email
        </label>
        <label className="modal-check">
          <input type="checkbox" checked={smsOn} disabled={readonly} onChange={(e) => toggle('SMS', e.target.checked)} /> SMS
        </label>
      </div>
    );
  } else if (field.type === 'date') {
    control = <input type="date" className="inp" readOnly={readonly} value={value || ''} onChange={(e) => onChange(field.id, e.target.value)} />;
  } else if (field.type === 'file') {
    control = (
      <div className={`file-upload ${readonly ? 'readonly' : ''}`}>
        <input
          type="file"
          id={`file-${field.id}`}
          disabled={readonly}
          onChange={(e) => onChange(field.id, e.target.files?.[0]?.name || '')}
        />
        <label className="file-btn" htmlFor={`file-${field.id}`}>
          Choose file
        </label>
        <span className="file-name">{value || 'No file chosen'}</span>
      </div>
    );
  } else {
    control = (
      <input
        className="inp"
        value={value || ''}
        readOnly={readonly}
        placeholder={readonly ? '' : 'Enter value…'}
        onChange={(e) => onChange(field.id, e.target.value)}
      />
    );
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
