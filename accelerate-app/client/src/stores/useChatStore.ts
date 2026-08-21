import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersonaKey } from '../personas';

export interface ChatMessage {
  id: string;
  role: 'bot' | 'user';
  kind: 'text' | 'proposal' | 'new_campaign_proposal' | 'choice';
  text?: string;
  proposal?: { sectionId: string; sectionName: string; assignments: { fieldId: string; fieldLabel?: string; value: string }[]; resolved?: 'confirmed' | 'cancelled' };
  // Guided Mode — one question, optionally with clickable choices, instead
  // of a paragraph the user has to read and reply to in full sentences.
  // Clicking a choice sends its label back as a normal user message, so
  // the model needs no special-casing to understand the answer.
  choice?: { question: string; options: string[]; answered?: string };
  newCampaign?: {
    tactplanId?: string;
    agency: string;
    brand: string;
    indication: string;
    brandedUnbranded: string;
    audience: string;
    assetScope: string;
    campaignName: string;
    channels: string[];
    resolved?: 'confirmed' | 'cancelled';
  };
}

export interface ChatSession {
  id: string;
  startedAt: number;
  messages: ChatMessage[];
  // Set when this archive entry isn't really "a past conversation you can
  // restore here" — it's a pointer left behind on the landing screen after
  // its content moved to live under a project instead (see
  // relocateThreadToNewProject). ChatPanel renders these specially and
  // routes a click through onOpenCampaign rather than restoring inline.
  movedToProject?: string;
  movedToLabel?: string;
}

interface AgentHistoryMsg {
  role: 'user' | 'assistant';
  content: unknown;
}

// The landing screen's own persistent session — a real thread in its own
// right (per the product decision here), just scoped under this key
// instead of a tactplanId so it lives alongside, not inside, any project.
export const LANDING_PROJECT = '__landing__';

type ByProject<T> = Partial<Record<string, T>>;
type ByPersonaProject<T> = Partial<Record<PersonaKey, ByProject<T>>>;

interface ChatState {
  // Was one thread per PERSONA, shared across the landing page and every
  // project — continuing a conversation into a different project silently
  // mixed it into whatever you'd been discussing anywhere else. Now one
  // thread per (persona, project) pair, landing included as its own project
  // key, so each project's conversation is genuinely its own, long-running
  // session instead of a shared scratchpad that happens to follow you.
  threads: ByPersonaProject<ChatMessage[]>;
  histories: ByPersonaProject<AgentHistoryMsg[]>;
  archives: ByPersonaProject<ChatSession[]>;
  // Guided Mode stays global per persona (not per project) — it's a
  // standing behavior preference ("ask me one thing at a time"), not
  // something tied to which project happens to be open.
  guidedMode: Partial<Record<PersonaKey, boolean>>;
  // The New Campaign Intake flow's ONLY memory of which of the 8 fields are
  // already answered — sent back to the server every turn (see server.js's
  // NEW CAMPAIGN INTAKE STATE block) so the model checks this authoritative
  // record instead of re-deriving progress from its own read of the chat
  // transcript, which is what kept breaking down under guided-mode's rapid
  // one-click turns (re-asking answered fields, confusing one field's
  // answer for a different field's).
  newCampaignDrafts: ByPersonaProject<Record<string, string>>;
  addMessage: (persona: PersonaKey, project: string, msg: ChatMessage) => void;
  updateMessage: (persona: PersonaKey, project: string, id: string, patch: Partial<ChatMessage>) => void;
  setHistory: (persona: PersonaKey, project: string, history: AgentHistoryMsg[]) => void;
  setGuidedMode: (persona: PersonaKey, on: boolean) => void;
  startNewChat: (persona: PersonaKey, project: string) => void;
  restoreSession: (persona: PersonaKey, project: string, sessionId: string) => void;
  // A brand-new campaign was just created out of a conversation that was
  // happening on the landing screen: the whole live thread so far becomes
  // that project's own thread (it WAS the intake conversation, nothing in
  // it is discardable), and landing gets a short pointer left in its
  // history list instead of the full transcript, so it's still findable
  // from the main screen without duplicating the live conversation there.
  relocateThreadToNewProject: (persona: PersonaKey, fromProject: string, toProject: string, label: string) => void;
  // The opposite case: an EXISTING project was identified mid-conversation
  // (e.g. the user said "actually this is about TP-88213" and the agent
  // called open_campaign) — the few messages spent figuring out which
  // project was meant are just identification chatter, not real content.
  // Discard them outright (not archived, not moved) and continue in the
  // target project's own, already-existing thread untouched.
  discardAndSwitchToProject: (persona: PersonaKey, fromProject: string) => void;
  // Nukes every thread, history, archive and intake draft for EVERY persona
  // and project — the "start clean" escape hatch. A persist-version bump can
  // do the same thing, but only for browsers that actually load the new
  // bundle; this is a real control the user can click, which also handles
  // the case of a second tab still holding old state in memory and
  // re-persisting it. Deliberately does NOT touch guidedMode (a standing
  // preference, not conversation data).
  clearAllChats: () => void;
  setNewCampaignField: (persona: PersonaKey, project: string, field: string, value: string) => void;
  // Called once propose_new_campaign's card is confirmed or cancelled, and
  // on relocate/discard — a stale draft from a finished or abandoned intake
  // must never bleed into the next one on the same (persona, project).
  clearNewCampaignDraft: (persona: PersonaKey, project: string) => void;
}

const emptyProjectMap = <T,>(): ByProject<T> => ({});

// Persisted to localStorage — the "chat history service" this store now is:
// conversations survive a page reload instead of resetting every time, the
// same way the request-detail field values already round-trip through the
// server. Only threads/histories/archives/guidedMode are persisted (not UI
// state like which persona is selected), so a stale open dropdown etc.
// never gets restored.
export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      threads: {},
      histories: {},
      archives: {},
      guidedMode: {},
      newCampaignDrafts: {},
      setGuidedMode: (persona, on) => set((s) => ({ guidedMode: { ...s.guidedMode, [persona]: on } })),
      clearAllChats: () => set({ threads: {}, histories: {}, archives: {}, newCampaignDrafts: {} }),
      setNewCampaignField: (persona, project, field, value) =>
        set((s) => {
          const forPersona = s.newCampaignDrafts[persona] || emptyProjectMap<Record<string, string>>();
          return {
            newCampaignDrafts: { ...s.newCampaignDrafts, [persona]: { ...forPersona, [project]: { ...(forPersona[project] || {}), [field]: value } } },
          };
        }),
      clearNewCampaignDraft: (persona, project) =>
        set((s) => {
          const forPersona = s.newCampaignDrafts[persona] || emptyProjectMap<Record<string, string>>();
          if (!forPersona[project]) return s;
          return { newCampaignDrafts: { ...s.newCampaignDrafts, [persona]: { ...forPersona, [project]: {} } } };
        }),
      addMessage: (persona, project, msg) =>
        set((s) => {
          const forPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          return { threads: { ...s.threads, [persona]: { ...forPersona, [project]: [...(forPersona[project] || []), msg] } } };
        }),
      updateMessage: (persona, project, id, patch) =>
        set((s) => {
          const forPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          const current = forPersona[project] || [];
          return {
            threads: {
              ...s.threads,
              [persona]: { ...forPersona, [project]: current.map((m) => (m.id === id ? { ...m, ...patch } : m)) },
            },
          };
        }),
      setHistory: (persona, project, history) =>
        set((s) => {
          const forPersona = s.histories[persona] || emptyProjectMap<AgentHistoryMsg[]>();
          return { histories: { ...s.histories, [persona]: { ...forPersona, [project]: history } } };
        }),
      // Archives the current thread (if it has anything in it — an empty
      // "new chat" click on an already-empty thread is a no-op, not a
      // pointless empty archive entry) and clears both the visible thread
      // and the agent's own conversation memory, so the next message starts
      // a genuinely fresh context rather than one that still remembers the
      // old thread server-side.
      startNewChat: (persona, project) =>
        set((s) => {
          const threadsForPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          const current = threadsForPersona[project] || [];
          if (!current.length) return s;
          const archived: ChatSession = { id: `chat-${Date.now()}`, startedAt: Date.now(), messages: current };
          const archivesForPersona = s.archives[persona] || emptyProjectMap<ChatSession[]>();
          const historiesForPersona = s.histories[persona] || emptyProjectMap<AgentHistoryMsg[]>();
          // newCampaignDrafts was missed here originally — the visible
          // thread and agent history both reset, but a stale intake draft
          // (agency/brand/indication/...) kept getting sent to the server
          // on every turn regardless, since it's read straight off this
          // store rather than derived from the (now-empty) history. The
          // server trusted it outright because its own history-based
          // inference had nothing fresher to override it with, so "+ New
          // chat" followed by "start a new campaign" silently resumed the
          // PREVIOUS campaign's already-answered fields instead of
          // actually starting fresh.
          const draftsForPersona = s.newCampaignDrafts[persona] || emptyProjectMap<Record<string, string>>();
          return {
            threads: { ...s.threads, [persona]: { ...threadsForPersona, [project]: [] } },
            histories: { ...s.histories, [persona]: { ...historiesForPersona, [project]: [] } },
            newCampaignDrafts: { ...s.newCampaignDrafts, [persona]: { ...draftsForPersona, [project]: {} } },
            archives: {
              ...s.archives,
              [persona]: { ...archivesForPersona, [project]: [archived, ...(archivesForPersona[project] || [])] },
            },
          };
        }),
      // Swaps an archived session back to being the active thread — the
      // current thread (if non-empty) is archived in its place first, same
      // as startNewChat, so nothing is ever silently dropped by restoring.
      restoreSession: (persona, project, sessionId) =>
        set((s) => {
          const archivesForPersona = s.archives[persona] || emptyProjectMap<ChatSession[]>();
          const archives = archivesForPersona[project] || [];
          const target = archives.find((a) => a.id === sessionId);
          if (!target) return s;
          const threadsForPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          const current = threadsForPersona[project] || [];
          const rest = archives.filter((a) => a.id !== sessionId);
          const nextArchives = current.length
            ? [{ id: `chat-${Date.now()}`, startedAt: Date.now(), messages: current }, ...rest]
            : rest;
          const historiesForPersona = s.histories[persona] || emptyProjectMap<AgentHistoryMsg[]>();
          // Same leak startNewChat had — the restored session's own intake
          // draft was never archived alongside it (only histories/threads
          // are), so leaving the CURRENT draft in place would silently
          // attach whatever campaign was being intake'd just before this
          // restore onto the reopened, unrelated conversation.
          const draftsForPersona = s.newCampaignDrafts[persona] || emptyProjectMap<Record<string, string>>();
          return {
            threads: { ...s.threads, [persona]: { ...threadsForPersona, [project]: target.messages } },
            histories: { ...s.histories, [persona]: { ...historiesForPersona, [project]: [] } },
            newCampaignDrafts: { ...s.newCampaignDrafts, [persona]: { ...draftsForPersona, [project]: {} } },
            archives: { ...s.archives, [persona]: { ...archivesForPersona, [project]: nextArchives } },
          };
        }),
      relocateThreadToNewProject: (persona, fromProject, toProject, label) =>
        set((s) => {
          const threadsForPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          const movingMessages = threadsForPersona[fromProject] || [];
          const historiesForPersona = s.histories[persona] || emptyProjectMap<AgentHistoryMsg[]>();
          const movingHistory = historiesForPersona[fromProject] || [];
          const archivesForPersona = s.archives[persona] || emptyProjectMap<ChatSession[]>();
          const pointer: ChatSession = {
            id: `chat-${Date.now()}`,
            startedAt: Date.now(),
            messages: movingMessages,
            movedToProject: toProject,
            movedToLabel: label,
          };
          return {
            threads: {
              ...s.threads,
              [persona]: { ...threadsForPersona, [fromProject]: [], [toProject]: movingMessages },
            },
            histories: {
              ...s.histories,
              [persona]: { ...historiesForPersona, [fromProject]: [], [toProject]: movingHistory },
            },
            archives: {
              ...s.archives,
              [persona]: { ...archivesForPersona, [fromProject]: [pointer, ...(archivesForPersona[fromProject] || [])] },
            },
          };
        }),
      discardAndSwitchToProject: (persona, fromProject) =>
        set((s) => {
          const threadsForPersona = s.threads[persona] || emptyProjectMap<ChatMessage[]>();
          const historiesForPersona = s.histories[persona] || emptyProjectMap<AgentHistoryMsg[]>();
          const draftsForPersona = s.newCampaignDrafts[persona] || emptyProjectMap<Record<string, string>>();
          if (!(threadsForPersona[fromProject] || []).length) return s;
          return {
            threads: { ...s.threads, [persona]: { ...threadsForPersona, [fromProject]: [] } },
            histories: { ...s.histories, [persona]: { ...historiesForPersona, [fromProject]: [] } },
            newCampaignDrafts: { ...s.newCampaignDrafts, [persona]: { ...draftsForPersona, [fromProject]: {} } },
          };
        }),
    }),
    {
      name: 'accelerate-chat-history',
      version: 4,
      partialize: (s) => ({ threads: s.threads, histories: s.histories, archives: s.archives, guidedMode: s.guidedMode, newCampaignDrafts: s.newCampaignDrafts }),
      // v1 was one flat thread per persona (no project scoping) — folded
      // straight into the landing project key so nobody's existing
      // conversation just vanishes on upgrade.
      //
      // v3: a deliberate full wipe, not a data-preserving migration — every
      // conversation accumulated across this session's testing (several
      // stuck-loop bugs, repeated intake runs) gets cleared for every
      // browser on next load, including sessions that never touched this
      // one. Also resets guidedMode to {} (off for everyone), since a
      // migration that preserves old keys would otherwise carry forward
      // whichever persona happened to have it toggled on during testing.
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          const wrap = <T,>(flat: Partial<Record<PersonaKey, T>> | undefined) => {
            const out: ByPersonaProject<T> = {};
            Object.entries(flat || {}).forEach(([persona, value]) => {
              out[persona as PersonaKey] = { [LANDING_PROJECT]: value as T };
            });
            return out;
          };
          return {
            ...state,
            threads: wrap(state.threads as Partial<Record<PersonaKey, ChatMessage[]>>),
            histories: wrap(state.histories as Partial<Record<PersonaKey, AgentHistoryMsg[]>>),
            archives: wrap(state.archives as Partial<Record<PersonaKey, ChatSession[]>>),
          };
        }
        // v4: another deliberate full wipe — a fresh round of test
        // campaigns/chats accumulated after v3, and clearing them from just
        // this session's own browser wouldn't reach whatever browser the
        // user is actually testing in; bumping the version does.
        if (version < 4) {
          return { threads: {}, histories: {}, archives: {}, guidedMode: {}, newCampaignDrafts: {} };
        }
        return state;
      },
    },
  ),
);
