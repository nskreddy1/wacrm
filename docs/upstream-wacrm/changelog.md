# Changelog (upstream snapshot)

> Source: https://wacrm.tech/docs/changelog
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

Notable user-facing changes to the wacrm template, newest first. For exact release tags and the full commit history, see the GitHub releases.

## July 2026

### AI knowledge base

The AI Assistant can now answer from your own content. Add FAQs, policies, or product details under Settings → AI Assistant → Knowledge base, and the relevant excerpts are retrieved into every draft and auto-reply — so the assistant answers instead of guessing or handing off. Hybrid retrieval: keyword full-text search works for every account with no extra key; add an embeddings key and semantic search turns on (matches by meaning, not just wording). Anthropic-only accounts keep the keyword path with no extra setup. Requires migration `030_ai_knowledge.sql` (enables `pgvector`).

### AI Assistant (bring-your-own-key)

Bring your own OpenAI or Anthropic key — set it under Settings → AI Assistant — and wacrm calls the provider directly. No per-seat AI fee, no wacrm-run service in the middle; your key is stored encrypted and never shown again after saving. Two capabilities:

- Drafted replies — a button in the inbox composer reads the recent conversation and writes a suggested reply for the agent to edit and send. Read-only; nothing sends on its own.
- Auto-reply bot — optionally answers inbound messages that no Flow or Automation already handles and no agent has taken, with a per-conversation cap and a clean handoff to a human when it can't confidently help.

Deterministic responders win: Flows, then Automations, then the AI bot as the fallback. Requires migration `029_ai_reply.sql`.

### Public REST API (/api/v1)

Drive wacrm from your own scripts and automations — no dashboard required. Create a scoped, revocable API key under Settings → API keys, then call the REST endpoints:

- Messages — `POST /api/v1/messages` sends text, template, or media to an E.164 number, finding-or-creating the contact + conversation.
- Contacts — list (with search + tag filters), create (find-or-create by phone), read, and update, including tags.
- Conversations & messages — browse conversations and their message history with delivery status.
- Broadcasts — `POST /api/v1/broadcasts` launches a template campaign to a recipient list; poll for progress.

Keys carry only the scopes you grant, are account-scoped, and are shown exactly once (stored hashed). Every list endpoint shares one cursor-pagination format. Requires migration `026_api_keys.sql`.

### Outbound event webhooks

Register an HTTPS endpoint and wacrm POSTs to it when things happen — `message.received`, `message.status_updated`, `conversation.created` — so your automations can react to inbound activity instead of polling.

- Manage endpoints with `POST /api/v1/webhooks` (scope `webhooks:manage`); the signing secret is returned once and stored encrypted.
- Each delivery is signed (`X-Wacrm-Signature`, HMAC-SHA256) so you can verify authenticity and reject replays, and carries a unique `id` to dedupe on.
- Delivery is best-effort with auto-disable of persistently-failing endpoints; targets must be public `https://` URLs.
- Requires migration `028_webhook_endpoints.sql`.

## June 2026

### Upload an image for template headers

Creating a template with an image header now works — you can upload a JPEG/PNG (≤ 5 MB) right in the builder, or paste a public URL.

- Fixes the long-standing bug where an image-header template failed at submission: Meta only accepts a Resumable-Upload media handle (not a plain URL) as the review sample, so the app now performs that upload for you automatically — for both uploaded files and pasted URLs.
- Approved image templates also send correctly (the public image URL is attached on every send).
- Requires `META_APP_ID`; text/body-only templates are unaffected.

### Send media in chat

Agents can now send photos, videos, documents, and voice notes directly from the inbox composer — previously media could only be received from customers or sent via a Flow.

- Click the paperclip to attach a photo, video, or document, or to record a voice note. Optional caption on everything except voice.
- Voice notes are encoded in the browser (Ogg/Opus), so there's no server-side audio tooling to install — works on any deployment, including Hostinger shared hosting. Recording auto-stops at 5 minutes.
- Per-type size limits mirror WhatsApp's: photos 5 MB; video, documents, and voice 16 MB.
- Uploads land in a dedicated, account-scoped `chat-media` Storage bucket (migration `023_chat_media.sql`).
- Rolled out behind a per-account beta flag first, now available to every account — no opt-in required.
