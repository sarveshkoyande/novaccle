import type { ReactNode } from 'react';

// Reuses .chat-panel (fixed right-side, 340px) exactly as index.html's
// #adminEditPanel did — same slot the Requirement agent chat occupies
// elsewhere, unused on this page.
export default function EditPanel({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="chat-panel admin-edit-panel" style={{ display: 'flex' }}>
      <div className="cp-head admin-edit-head">
        <div className="cp-av">✎</div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button className="admin-edit-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="cp-body admin-edit-body">{children}</div>
    </div>
  );
}
