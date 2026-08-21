import { useRef } from 'react';

const MIN_VW = 25;
const MAX_VW = 75;

// Ported (actually implemented — the CSS for this was already in the file,
// .details-resizer, but nothing in the React port ever rendered it or drove
// --chat-w from a drag) from index.html's initDetailsResizer(): a drag
// handle sitting on the chat/form boundary in split mode, writing --chat-w
// (the single CSS variable both sides read) directly from pointer position.
export default function DetailsResizer() {
  const draggingRef = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    document.body.dataset.resizing = 'true';
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const vw = Math.min(MAX_VW, Math.max(MIN_VW, (e.clientX / window.innerWidth) * 100));
    document.documentElement.style.setProperty('--chat-w', `${vw}vw`);
  }

  function endDrag(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    delete document.body.dataset.resizing;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }

  return (
    <div
      className="details-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and form"
    />
  );
}
