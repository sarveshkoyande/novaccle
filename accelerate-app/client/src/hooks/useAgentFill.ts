import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, LANDING_PROJECT, type ChatMessage } from '../stores/useChatStore';
import { REQUESTS } from '../data/requests';
import type { PersonaKey } from '../personas';
import type { FormSection } from '../types';

let seq = 0;
const nextId = () => `msg-${Date.now()}-${seq++}`;

// Ported from index.html's SECTION_ALIASES — sectionsPayload below was
// always sending an empty aliases array (a gap from the original React
// port, never actually wired up), so match_section's tier-2 fallback
// (server.js) never had anything to fall back to. Silently broke matching
// on any message that names a section by a synonym rather than its literal
// id/full name — e.g. "enrollment" alone doesn't contain the full phrase
// "oms enrollment form details", so an enrollment metadata sheet upload
// with no literal word "OMS" in it had no way to resolve to the OMS
// section without this.
const SECTION_ALIASES: Record<string, string[]> = {
  generic: ['generic', 'overview'],
  journey: ['journey'],
  oms: ['oms', 'enrollment'],
  mci: ['mci', 'performance reporting', 'campaign performance'],
  email: ['email'],
  mds: ['mds', 'target list', 'suppressions', 'suppression'],
  dc: ['data cloud', 'dc'],
  automx: ['automatrix', 'automx'],
  sms: ['sms'],
  cma: ['cma', 'metadata sheet'],
  busetup: ['bu setup', 'business unit setup', 'business unit'],
};

// Sent on every turn, from every page — the full portfolio (same shape
// useHomeAgent used to send only from the landing page) plus which page is
// currently open. This is what makes the ONE shared chat session (see
// useChatStore) portfolio-aware everywhere instead of only when no
// campaign happens to be open: the model always has the whole list, and is
// told which campaign (if any) is currently in view so it can favor that
// one without being unable to answer about any other.
function buildPortfolioContext(tactplanId: string | null, persona: PersonaKey) {
  const portfolio = REQUESTS.map((r) => ({ id: r.id, name: r.name, brand: r.brand, phase: r.phaseLabel, status: r.status }));
  const current = tactplanId ? REQUESTS.find((r) => r.id === tactplanId) : null;
  // Real, computed "what's pending with me" data — not something the model
  // is asked to infer or invent. Sourced from the same mineTo/actionText
  // fields the portfolio table's own "assigned to me" stat and per-row
  // status text already use, so the answer to "what's pending with me?"
  // can never drift from what the table itself shows. dueDate is
  // deliberately left blank (not guessed) when golive is unset ("—").
  const myPending = REQUESTS.filter((r) => r.mineTo.includes(persona)).map((r) => ({
    tactplanId: r.id,
    name: r.name,
    pending: r.actionText[persona] || '',
    dueDate: r.golive === '—' ? '' : r.golive,
  }));
  return {
    portfolio,
    currentPage: current ? { tactplanId: current.id, name: current.name, brand: current.brand } : null,
    myPending,
  };
}

// Ported from index.html's handleFillCommand()/sendChat() — same SSE event
// shape (reasoning/proposal/final/history) parsed the same way (buffer,
// split on blank-line-delimited frames, `event:`/`data:` lines).
interface InterviewData {
  remaining: { sectionId: string; sectionName: string; field: string }[];
  blocked: { sectionId: string; sectionName: string; field: string; reason: string }[];
  derived: { sectionId: string; sectionName: string; field: string; fieldId: string; value: string }[];
  interview: { stage: string; stageOpen: { sectionId: string; field: string }[]; nextQuestions: unknown[]; derivableCount: number };
}

export function useAgentFill(
  persona: PersonaKey,
  tactplanId: string | null,
  onOpenCampaign?: (tactplanId: string) => void,
  guidedMode = false,
  interviewData?: InterviewData,
  onQuizAnswer?: (sectionId: string, field: string, value: string) => void,
  onNotifyStakeholders?: (tactplanId: string, opsMessage: string, otherTeamsMessage: string) => void,
) {
  const projectKey = tactplanId || LANDING_PROJECT;
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setHistory = useChatStore((s) => s.setHistory);
  const histories = useChatStore((s) => s.histories);
  const newCampaignDrafts = useChatStore((s) => s.newCampaignDrafts);
  const setNewCampaignField = useChatStore((s) => s.setNewCampaignField);

  // Fixes a real, reported bug: toggling Guided Mode ON calls
  // setGuidedMode(next) then IMMEDIATELY sends the "let's go one question
  // at a time" message in the same synchronous click handler — React
  // doesn't re-render between those two calls, so `send` (created from
  // THIS render's closure) still saw the OLD guidedMode value, and that
  // very first guided-mode turn's server request went out with
  // guidedMode:false. The server correctly downgraded ask_choice per that
  // flag, so the FIRST question after turning guided mode on came back as
  // plain text with no buttons — looking exactly like the toggle didn't
  // work. A ref written to synchronously (see ChatPanel's toggle handler)
  // sidesteps React's render cycle entirely for this one value.
  const guidedModeRef = useRef(guidedMode);
  useEffect(() => {
    guidedModeRef.current = guidedMode;
  }, [guidedMode]);

  const send = useCallback(
    async (text: string, sections: FormSection[], displayText?: string) => {
      if (!text.trim()) return;
      // Silent system sentinels (e.g. [[system:campaign_created]], fired
      // automatically after Create Campaign — see ChatPanel's continuation
      // effect) still go to the model as a real user turn, but must never
      // show up as a fake "user" bubble in the transcript; the system
      // prompt already tells the model not to echo the literal text back,
      // this is the client-side half of that same contract.
      // displayText lets a caller (e.g. file upload) show a short bubble
      // ("Uploaded file X.pdf") while the model still receives the full
      // parsed document text as the real turn content.
      if (!text.startsWith('[[system:')) {
        addMessage(persona, projectKey, { id: nextId(), role: 'user', kind: 'text', text: displayText ?? text });
      }

      const thinkingId = nextId();
      addMessage(persona, projectKey, { id: thinkingId, role: 'bot', kind: 'text', text: 'Thinking…' });

      const sectionsPayload = sections.map((s) => ({
        id: s.id,
        name: s.name,
        aliases: SECTION_ALIASES[s.id] || [],
        fields: s.fields.map((f) => ({ id: f.id, n: f.label, phase: f.phase, owner: f.owner, type: f.type })),
      }));

      const { portfolio, currentPage, myPending } = buildPortfolioContext(tactplanId, persona);

      let res: Response;
      try {
        res = await fetch('/api/agent-fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sections: sectionsPayload,
            text,
            history: histories[persona]?.[projectKey] || [],
            tactplanId,
            portfolio,
            currentPage,
            myPending,
            persona,
            guidedMode: guidedModeRef.current,
            remaining: interviewData?.remaining,
            blocked: interviewData?.blocked,
            derived: interviewData?.derived,
            interview: interviewData?.interview,
            newCampaignDraft: newCampaignDrafts[persona]?.[projectKey] || {},
          }),
        });
      } catch {
        updateMessage(persona, projectKey, thinkingId, { text: "Couldn't reach the agent — is the server running?" });
        return;
      }

      if (!res.ok || !res.body) {
        updateMessage(persona, projectKey, thinkingId, {
          text: res.status === 503 ? 'Agent not configured on the server (missing Foundry API key).' : `Agent returned an error (${res.status}).`,
        });
        return;
      }

      // Where the REST of this turn's messages land — starts as the
      // project the turn began in, but an open_campaign event mid-stream
      // reassigns it. Without this, the tail of a turn that just switched
      // projects (typically the model's own "you're now in X" reply) kept
      // writing into the project the turn STARTED in — landing, usually —
      // even after that thread had just been deliberately cleared for the
      // switch, silently repopulating it with exactly the reply that was
      // supposed to continue in the new project instead.
      let activeProject = projectKey;

      updateMessage(persona, activeProject, thinkingId, { text: '' });
      let gotAnyText = false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evMatch = raw.match(/^event:\s*(.+)$/m);
          const dataMatch = raw.match(/^data:\s*(.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const event = evMatch[1].trim();
          const data = JSON.parse(dataMatch[1]);

          if (event === 'reasoning' || event === 'final') {
            const chunk: string = data.text || '';
            if (!chunk) continue;
            if (!gotAnyText) {
              updateMessage(persona, activeProject, thinkingId, { text: chunk });
              gotAnyText = true;
            } else {
              addMessage(persona, activeProject, { id: nextId(), role: 'bot', kind: 'text', text: chunk });
            }
          } else if (event === 'proposal') {
            const msg: ChatMessage = {
              id: nextId(),
              role: 'bot',
              kind: 'proposal',
              proposal: { sectionId: data.sectionId, sectionName: data.sectionName, assignments: data.assignments || [] },
            };
            if (!gotAnyText) {
              // Replace the "thinking" bubble outright rather than leaving an
              // empty text bubble sitting above the proposal card.
              updateMessage(persona, activeProject, thinkingId, { text: '' });
              gotAnyText = true;
            }
            addMessage(persona, activeProject, msg);
          } else if (event === 'ask_choice') {
            const msg: ChatMessage = {
              id: nextId(),
              role: 'bot',
              kind: 'choice',
              choice: { question: data.question || '', options: Array.isArray(data.options) ? data.options : [] },
            };
            if (!gotAnyText) {
              updateMessage(persona, activeProject, thinkingId, { text: '' });
              gotAnyText = true;
            }
            addMessage(persona, activeProject, msg);
          } else if (event === 'new_campaign_proposal') {
            const f = data.fields || {};
            const msg: ChatMessage = {
              id: nextId(),
              role: 'bot',
              kind: 'new_campaign_proposal',
              newCampaign: {
                tactplanId: f.tactplanId || undefined,
                agency: f.agency || '',
                brand: f.brand || '',
                indication: f.indication || '',
                brandedUnbranded: f.brandedUnbranded || '',
                audience: f.audience || '',
                assetScope: f.assetScope || '',
                campaignName: f.campaignName || '',
                channels: Array.isArray(f.channels) ? f.channels : [],
              },
            };
            if (!gotAnyText) {
              updateMessage(persona, activeProject, thinkingId, { text: '' });
              gotAnyText = true;
            }
            addMessage(persona, activeProject, msg);
          } else if (event === 'notify_stakeholders') {
            if (data.tactplanId && data.opsMessage && data.otherTeamsMessage) {
              onNotifyStakeholders?.(data.tactplanId, data.opsMessage, data.otherTeamsMessage);
            }
          } else if (event === 'quiz_answer') {
            // record_quiz_answer's whole premise is "no staging, recorded
            // immediately" — the server always emitted this event, but
            // nothing on the client ever listened for it, so every guided-
            // quiz answer silently went nowhere while the model (correctly,
            // per its own tool result) told the user it had been saved.
            if (data.sectionId && data.field && data.value !== undefined) {
              onQuizAnswer?.(data.sectionId, data.field, data.value);
            }
          } else if (event === 'new_campaign_field') {
            // record_new_campaign_field's whole premise, same as quiz_answer
            // above: recorded immediately into the store (see useChatStore's
            // newCampaignDrafts), so it's back in the NEXT turn's request
            // body as authoritative state the model checks instead of
            // re-deriving progress from its own memory of the conversation.
            if (data.field && data.value !== undefined) {
              setNewCampaignField(persona, activeProject, data.field, data.value);
            }
          } else if (event === 'history') {
            setHistory(persona, activeProject, data.history || []);
          } else if (event === 'open_campaign') {
            if (data.tactplanId) {
              onOpenCampaign?.(data.tactplanId);
              // The rest of THIS turn (the model's own "you're now in X"
              // follow-up, usually right after this) continues in the
              // project just switched to, not the one the turn started in.
              activeProject = data.tactplanId;
            }
          } else if (event === 'error') {
            updateMessage(persona, activeProject, thinkingId, { text: `Agent error: ${data.error}` });
            gotAnyText = true;
          }
        }
      }
      if (!gotAnyText) updateMessage(persona, activeProject, thinkingId, { text: '(no response)' });
    },
    [persona, tactplanId, projectKey, addMessage, updateMessage, setHistory, histories, onOpenCampaign, guidedMode, interviewData, onQuizAnswer, onNotifyStakeholders, newCampaignDrafts, setNewCampaignField],
  );

  return { send, guidedModeRef };
}
