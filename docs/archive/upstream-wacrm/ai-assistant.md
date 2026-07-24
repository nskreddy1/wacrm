# AI Assistant (upstream snapshot)

> Source: https://wacrm.tech/docs/ai-assistant
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

The AI Assistant brings a large-language model into your inbox in two ways:

- Draft replies — an agent clicks ✨ in the composer and the model reads the recent conversation and writes a suggested reply, ready to edit and send.
- Auto-reply bot — inbound messages are answered automatically when no Flow or Automation already handles them and no agent has taken the thread, with a clean handoff to a human when the model can't help.

Both are grounded in an optional knowledge base — your own FAQs, policies, and product details — so the assistant answers from your content instead of guessing or handing off.

It is bring-your-own-key. You paste your own OpenAI or Anthropic API key under Settings → AI Assistant, and wacrm calls that provider directly with your key. There is no wacrm-run AI service in the middle, no per-seat AI fee, and no markup — you pay your provider at cost. Your key is stored AES-256-GCM-encrypted at rest (the same way WhatsApp access tokens are) and is never shown again after you save it.

Requires migrations `029_ai_reply.sql` and `030_ai_knowledge.sql`. Apply them against your Supabase project before using the feature — `029` adds the `ai_configs` table plus two auto-reply columns on `conversations`; `030` enables `pgvector` and adds the knowledge-base tables plus an `embeddings_api_key` column.

## Setup

1. Go to Settings → AI Assistant (admin or owner only).
2. Pick a provider — OpenAI or Anthropic — and a model. The model field is free text with a sensible default pre-filled, so you can point it at any current model your key can access.
3. Paste your API key.
4. Click Test key — wacrm makes one tiny call to the provider and tells you immediately whether the key and model work, before you save.
5. Optionally add business context & instructions (see below).
6. Optionally add an embeddings key to turn on semantic knowledge-base search. Leave it blank and the knowledge base still works via keyword search.
7. Toggle Enable AI assistant on. This is the master switch — it turns on the ✨ Draft button in the inbox. Auto-reply is a separate toggle underneath and stays off until you enable it.
8. Save.
9. Optionally open the Knowledge base card and add documents.

### Business context & instructions

The free-text prompt is where you tell the model about your business — who you are, your tone, what it may and may not say. It is prepended to every draft and every auto-reply. Good things to include:

- What the business does and the voice to use ("warm and concise").
- Facts the model may state (hours, return window, shipping regions).
- Hard limits ("never quote prices or delivery dates — hand off to a human for those").

The model is instructed to treat everything in a customer's message as content to respond to, never as instructions to itself, so a customer can't talk it out of your rules.

## Draft replies

In any conversation, the composer shows a ✨ button next to the templates and send buttons. Click it and wacrm:

1. Reads the recent messages of the thread.
2. Sends them, plus your business context, to your provider.
3. Drops the suggested reply straight into the composer.

The draft is only a suggestion — nothing is sent until the agent reviews, edits if needed, and hits Send. Any agent (or higher) can use it; viewers cannot send, so they don't see it as actionable.

If AI isn't set up yet, the button points the agent to Settings. Drafts are rate-limited per agent and per account to bound spend on your key.

## Auto-reply bot

When Auto-reply is on, wacrm answers qualifying inbound messages by itself. For each inbound message it checks, in order, and stands down silently unless every condition holds:

- The AI assistant and auto-reply are both enabled for the account.
- No Flow consumed the message, and the account has no active message-level Automation (`new_message_received` / `keyword_match`) — deterministic, you-configured responders always win, so the customer never gets two replies.
- No agent is assigned to the conversation (a human has it).
- Auto-reply hasn't been switched off for this specific conversation (see handoff below).
- The conversation is under its reply cap (see below).

If all pass, the model generates a reply and wacrm sends it as a bot message on your WhatsApp number.

### Handoff to a human

If the model decides it can't confidently help — the customer asks for a person, is upset, or the request needs information it doesn't have — it hands off instead of guessing. wacrm then stops auto-replying on that conversation and leaves the message unanswered so it surfaces in the inbox for a human to pick up. Handoff is sticky: once a thread is handed off, the bot stays quiet on it until an admin re-enables it.

### Per-conversation cap

Max auto-replies per conversation (default 3) limits how many times the bot will answer one thread before going quiet. This prevents a chatty customer — or a reply loop — from running up your provider bill, and nudges long back-and-forths toward a human. The cap is enforced atomically, so two messages arriving at once can't push it over.

## Knowledge base

The knowledge base is where you give the assistant your own content — FAQs, return/shipping policies, product details, opening hours. When drafting or auto-replying, wacrm retrieves the most relevant pieces and puts them in front of the model, so it answers from your facts instead of guessing (or handing off).

Manage it under Settings → AI Assistant → Knowledge base (admin or owner). Add a document with a title and content (paste plain text), edit or delete it anytime. Each document is split into chunks and indexed automatically on save.

### Hybrid retrieval

wacrm uses two retrieval methods and picks based on your setup:

- Keyword search (always on). Postgres full-text search over your documents. Works for every account with no extra credentials, and it's language-neutral.
- Semantic search (optional). When you set an embeddings key, wacrm embeds your documents and the incoming question and matches by meaning — so "can I send it back?" finds a doc titled Returns policy. Semantic results are used first, then topped up with keyword matches.

The embeddings key is an OpenAI key (semantic search uses `text-embedding-3-small`). If you use OpenAI for chat too, it can be the same key. Anthropic has no embeddings API, so Anthropic-only accounts keep the keyword path — no extra setup, and the knowledge base still works. Like every key, it's stored encrypted and never shown again.

### Adding a key later, and Reindex

Documents are embedded when you save them if an embeddings key is set. If you add documents first and the embeddings key later, click Reindex (in the Knowledge base card) to embed everything that was stored keyword-only. Reindex also recovers any document whose embedding failed at save time — for example if your provider was briefly rate-limited.

If a document's embedding fails, it's still saved and stays findable via keyword search; the UI tells you semantic indexing didn't complete so you can Reindex later.

### How the model uses it

Retrieved excerpts are handed to the model as reference, not as instructions (the same prompt-injection guard as customer messages applies). The model is told to answer from them and, when they don't cover the question, to hand off (auto-reply) or say it will follow up (draft) rather than invent an answer.

## Precedence: Flows → Automations → AI

wacrm runs deterministic, explicitly-configured logic first and treats the AI as the fallback:

| Order | Responder     | Wins because                                                                                         |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | Flows         | A button-driven conversation you designed. If a Flow consumes the message, nothing else replies.     |
| 2     | Automations   | Keyword/event rules you wrote. If an active message-level automation exists, the AI bot stands down. |
| 3     | AI auto-reply | The catch-all for everything your Flows and Automations don't cover.                                 |

Draft replies sit outside this entirely — they're agent-initiated and never send on their own.

## Providers, models & cost

- OpenAI (Chat Completions API) and Anthropic (Messages API) are supported. Pick whichever you already have a key for.
- The model is yours to choose; the defaults are a fast, low-cost model per provider. Point it at a larger model for higher-quality replies at higher cost.
- You pay the provider directly for every draft and auto-reply, metered by your own account. wacrm adds nothing. Only recent text messages of the relevant conversation (a bounded window, 20 messages by default), your business-context prompt, and any retrieved knowledge-base excerpts are sent to the provider.
- Semantic search adds embeddings cost (on your embeddings key): each document is embedded once at save/reindex, and each question is embedded at retrieval. `text-embedding-3-small` is inexpensive, but it's billed to your OpenAI account like everything else.

Two optional environment variables tune behaviour — `AI_REQUEST_TIMEOUT_MS` (default `30000`) and `AI_CONTEXT_MESSAGE_LIMIT` (default `20`).

## Privacy note

Because you bring your own key, conversation text — and any knowledge-base content used for a reply — is sent to your OpenAI or Anthropic account, not to wacrm or any third party. With semantic search on, your documents and questions are also embedded via your OpenAI key. It's all subject to that provider's data-handling terms. If you'd rather no message content ever leave your infrastructure, leave the AI Assistant disabled; every other wacrm feature works without it.

## Limits

- Media, template, and interactive messages aren't sent to the model — only text is used as context.
- Beyond the recent-message window of the current conversation and your knowledge base, the assistant has no memory — it doesn't see contacts, deals, or other threads.
- The knowledge base is text you paste in; there's no file upload or URL import yet, and semantic search uses a single embedding model (`text-embedding-3-small`).
- Auto-reply only fires inside WhatsApp's 24-hour customer service window (it's reacting to a message the customer just sent), and sends plain text — not templates.
