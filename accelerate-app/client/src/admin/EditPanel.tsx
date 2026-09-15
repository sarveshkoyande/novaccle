import { useEffect, type ReactNode } from 'react';

// Was a fixed right-side drawer borrowing .chat-panel's geometry — on a page
// with no chat panel of its own, it read as an unrelated slab bolted onto
// the corner of the screen, disconnected from the row you clicked. Now a
// centered modal instead, per direct request: same content, but it opens
// where your eyes already are.
export default function EditPanel({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  // Escape closes, same as clicking the backdrop or the × — a modal with
  // only one of the three would be the surprising one.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="admin-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-modal-head">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="admin-modal-close" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>
        <div className="admin-modal-body">{children}</div>
      </div>
    </div>
  );
}
