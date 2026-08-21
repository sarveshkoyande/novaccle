import { create } from 'zustand';

// Request-detail's chat/form split, controlled from the app bar so the
// toggle survives being generic to whichever request happens to be open.
// 'chat' and 'split' reuse the original's own collapsed/open CSS states
// (data-details="collapsed"/"open"); 'form' is new — the original never
// had a form-full mode, only chat-full.
export type LayoutMode = 'chat' | 'split' | 'form';

interface LayoutState {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mode: 'split',
  setMode: (mode) => set({ mode }),
}));
