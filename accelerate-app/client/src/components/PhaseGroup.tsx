import type { FormField } from '../types';
import FieldRenderer from './FieldRenderer';

const DOT_CLASS: Record<string, string> = { preplan: 'pdot-pp', plan: 'pdot-p', exec: 'pdot-e' };
const LABEL: Record<string, string> = { preplan: 'Pre-planning fields', plan: 'Planning fields', exec: 'Execution fields' };

// Ported from index.html's renderPhaseGroup() — editable groups render open,
// locked/future/submitted groups collapse into a <details> since nothing in
// them is actionable.
export default function PhaseGroup({
  phase,
  fields,
  editable,
  when,
  values,
  onChange,
  notMyField,
}: {
  phase: 'preplan' | 'plan' | 'exec';
  fields: FormField[];
  editable: boolean;
  when: 'future' | 'submitted' | 'past' | null;
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  notMyField?: (field: FormField) => boolean;
}) {
  if (!fields.length) return null;

  const state = editable ? (
    <span className="pg-state pg-editable">Editable this phase</span>
  ) : when === 'future' ? (
    <span className="pg-state pg-locked">Not yet unlocked</span>
  ) : when === 'submitted' ? (
    <span className="pg-state pg-locked" title="This section has been submitted">
      Submitted — read-only
    </span>
  ) : (
    <span className="pg-state pg-locked" title="Read-only — previous phase">
      Read-only
    </span>
  );

  const head = (
    <>
      <span className="pg-label">
        <span className={`pdot ${DOT_CLASS[phase]}`} />
        {LABEL[phase]}
      </span>
      {state}
      <span className="pg-count">
        {fields.length} field{fields.length === 1 ? '' : 's'}
      </span>
    </>
  );

  const body = (
    <div className="fields">
      {fields.map((f) => (
        <FieldRenderer
          key={f.id}
          field={f}
          value={values[f.id] || ''}
          editable={editable}
          onChange={onChange}
          notMyField={notMyField ? notMyField(f) : false}
        />
      ))}
    </div>
  );

  if (editable) {
    return (
      <div className="phase-group">
        <div className="pg-head">{head}</div>
        {body}
      </div>
    );
  }
  return (
    <details className="phase-group locked">
      <summary className="pg-head">{head}</summary>
      {body}
    </details>
  );
}
