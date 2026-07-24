# Novartis Accelerate — real LLM backend

This wraps the requirement-gathering mock with a tiny Express server so the
chat's "fill `<section>`: ..." tool calls a real LLM (Gemini) instead of the
built-in regex parser. The API key lives only in `server/.env` — it never
reaches the browser.

## Setup

```
cd server
npm install
cp .env.example .env
# edit .env and paste in your OWN Gemini key (never one shared in chat/commit)
npm start
```

Then open http://localhost:4300 — that's the same form, served by the
backend instead of opened as a bare file.

## How it decides LLM vs. local parser

`public/index.html` always tries `fetch('/api/fill-section', ...)` first. If
that succeeds, Gemini did the extraction (the chat reply says "via Gemini").
If the server isn't running, isn't reachable, or has no key configured yet,
it silently falls back to the original local regex parser (reply says "via
local parser") — so the page still works if you just open the HTML file
directly, same as before.

## Files

- `server/server.js` — Express app. One route, `POST /api/fill-section`,
  proxies to Gemini (`gemini-2.5-flash`) with a prompt constraining it to
  return `[{"field": "...", "value": "..."}]` for known field names only.
  Also serves `public/` statically.
- `server/.env.example` — copy to `.env`; only `GEMINI_API_KEY` is required.
- `public/index.html` — the mock itself (same file as the standalone
  artifact). Keep the two in sync if you edit form logic — the artifact is
  the source of truth; re-copy it here after changes:
  `cp ../hqe-requirement-studio-mock_2.html public/index.html`

## Security notes

- Never put a real API key in `public/index.html` or any client-side code —
  anyone viewing source gets it.
- `.env` is not committed (add it to `.gitignore` if this becomes a real
  repo). `.env.example` has no real value in it.
- If a key was ever pasted in chat or committed, treat it as compromised —
  rotate it in the provider's console immediately.
