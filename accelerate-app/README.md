# Novartis Accelerate — real LLM backend

This wraps the requirement-gathering mock with a tiny Express server so the
chat's "fill `<section>`: ..." tool calls a real LLM (Claude on Microsoft
Foundry) instead of the built-in regex parser. The API key lives only in
`server/.env` — it never reaches the browser.

## Setup

```
cd server
npm install
cp .env.example .env
# edit .env and paste in your OWN Foundry key (never one shared in chat/commit)
npm start
```

Then open http://localhost:8000 — that's the same form, served by the
backend instead of opened as a bare file. (`PORT` in `.env` wins over any
port mentioned elsewhere.)

## Provider

Claude on Microsoft Foundry, via `@anthropic-ai/foundry-sdk`. The SDK builds
`https://{ANTHROPIC_FOUNDRY_RESOURCE}.services.ai.azure.com/anthropic/` and
sends `ANTHROPIC_FOUNDRY_API_KEY` as the `x-api-key` header. Model is set by
`CLAUDE_DEPLOYMENT` (the Foundry deployment name, e.g. `claude-opus-4-8`).

Entra ID auth (`DefaultAzureCredential`) is also supported by the SDK via an
`azureADTokenProvider` — not wired up here; this project uses key auth.

## TLS on managed laptops

`npm start` runs `node --use-system-ca`. Corporate TLS interception re-signs
traffic with a root CA that lives in the Windows trust store, which Node
otherwise ignores — without the flag every model call fails with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, surfaced as a generic `fetch failed`.
Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` instead; it disables certificate
validation process-wide.

## How it decides LLM vs. local parser

`public/index.html` always tries the agent endpoint first. If that succeeds,
Claude did the extraction. If the server isn't running, isn't reachable, or
has no key configured yet, it silently falls back to the original local regex
parser (reply says "via local parser") — so the page still works if you just
open the HTML file directly, same as before.

## Files

- `server/server.js` — Express app. Two SSE agent routes, `POST
  /api/agent-fill` (form filling) and `POST /api/visio-agent` (diagram
  editing), both driven by `runAgentTurn()` — one shared Anthropic tool-use
  loop. Tools execute server-side; the model never mutates state directly.
  Also serves `public/` statically.
- `server/.env.example` — copy to `.env`; `ANTHROPIC_FOUNDRY_API_KEY` and
  `ANTHROPIC_FOUNDRY_RESOURCE` are both required.
- `public/index.html` — the mock itself (same file as the standalone
  artifact). Keep the two in sync if you edit form logic — the artifact is
  the source of truth; re-copy it here after changes:
  `cp ../hqe-requirement-studio-mock_2.html public/index.html`

## Conversation history

The Messages API is stateless, so the server returns the full `messages`
array in the SSE `history` event and the client resends it next turn. The
client treats it as an opaque blob, so the format is the server's to change.

## Security notes

- Never put a real API key in `public/index.html` or any client-side code —
  anyone viewing source gets it.
- `.env` is gitignored. `.env.example` has no real value in it.
- If a key was ever pasted in chat or committed, treat it as compromised —
  rotate it in the provider's console immediately.
