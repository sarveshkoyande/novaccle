import { create } from 'zustand';
import type { PersonaKey } from '../personas';

// "Who am I" — mock auth. Persona is now chosen AT login (a picker on the
// sign-in screen, not a switcher inside the app) — logging in as someone
// fixes currentPersona for that session; the only way to become a
// different persona is to log out and pick again from the sign-in screen.
// This replaced an in-app "viewing the platform as" dropdown that let you
// silently swap identities mid-session without ever signing out, which
// didn't match how a real per-account login would behave.
interface SessionState {
  loggedIn: boolean;
  currentPersona: PersonaKey;
  login: (persona: PersonaKey) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  loggedIn: false,
  currentPersona: 'aor',
  login: (persona) => set({ loggedIn: true, currentPersona: persona }),
  logout: () => set({ loggedIn: false }),
}));
