# Public API (upstream snapshot)

> Source: https://wacrm.tech/docs/public-api
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's `docs/public-api.md` is the richer local authoritative API reference; use this snapshot for upstream comparison only. See `docs/architecture-delta.md`.

---

The public REST API lets you drive your wacrm instance from your own scripts and automations — send messages, manage contacts, browse conversations, launch broadcasts, and subscribe to events — without going through the dashboard UI. Everything lives under `/api/v1` on your own deployment (e.g. `https://your-crm.example.com/api/v1`).

Migrations required. The API ships in two migrations — apply `026_api_keys.sql` (keys) and `028_webhook_endpoints.sql` (webhooks) against your Supabase project.

## Authentication

Every request authenticates with an API key, sent as a bearer token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are account-scoped: a key acts on exactly one account — the one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: Settings → API keys → New API key (only admins and owners can create keys).

1. Name the key after the integration that will use it.
2. Grant only the scopes it needs (see below).
3. Copy the key. It's shown exactly once — wacrm stores only a SHA-256 hash. If you lose it, revoke and create a new one.

Revoke under Settings → API keys → Revoke; revocation takes effect on the key's next request.

## Scopes

A key can do only what its scopes allow. Grant the minimum.

| Scope                | Allows                                |
| -------------------- | ------------------------------------- |
| `messages:send`      | Send WhatsApp messages                |
| `messages:read`      | Read messages and delivery status     |
| `contacts:read`      | List and read contacts                |
| `contacts:write`     | Create and update contacts            |
| `conversations:read` | List and read conversations           |
| `broadcasts:send`    | Launch broadcast campaigns            |
| `webhooks:manage`    | Register and manage outbound webhooks |

A key with no scopes still authenticates and can call `GET /api/v1/me` — handy for verifying a key works.

## Response format

Every response is one of two shapes:

```
// success
{ "data": { /* ... */ } }
// failure
{ "error": { "code": "forbidden", "message": "…" } }
```

Branch on `error.code` (stable); `message` is for humans. Codes: `unauthorized` (401), `forbidden` (403, missing scope), `rate_limited` (429), `bad_request` (400), `not_found` (404), `internal` (500). Send endpoints add domain codes like `whatsapp_not_configured` and `meta_error` (502 — Meta rejected the send).

Requests are rate-limited per key at 120/minute; a `429` returns `Retry-After` and `X-RateLimit-*` headers.

## Pagination

List endpoints return a `meta.next_cursor` and take `?limit=` (default 50, max 100) and `?cursor=`:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }
GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are opaque and keyset-based (stable under concurrent inserts). Pass the cursor back verbatim; `null` means the last page.

## Endpoints

### GET /api/v1/me

Returns the account a key is bound to and its scopes. No scope required — the quickest way to verify a key.

### POST /api/v1/messages

Send a message to a phone number (`messages:send`). You pass an E.164 number, not an internal id — the endpoint finds-or-creates the contact and conversation, then sends.

```
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi" }'
```

`type` is `text` (default), `template`, or a media kind (`image` / `video` / `document` / `audio`). Templates take a `template` object (`name`, `language`, `params`); media takes `media_url` (+ optional `filename`), with `text` as the caption. Returns `201` with `message_id`, `whatsapp_message_id`, `conversation_id`, `contact_id`, and `contact_created`.

### Contacts

- `GET /api/v1/contacts` — list, newest first (`contacts:read`). Filters: `?search=` (name/phone), `?tag=<name>`.
- `POST /api/v1/contacts` — create by `phone` (E.164); optional `name`, `email`, `company`, `tags` (`contacts:write`). Find-or-create: an existing match returns `200`, a new contact `201`.
- `GET` / `PATCH /api/v1/contacts/{id}` — read / update. `PATCH` changes only the fields you send; `null` clears a field, and `tags` (an array of names) replaces the contact's tags.

### Conversations & messages

- `GET /api/v1/conversations` — list (`conversations:read`). Filters: `?status=`, `?contact_id=`. Each embeds its contact + tags.
- `GET /api/v1/conversations/{id}` — read one.
- `GET /api/v1/conversations/{id}/messages` — the thread's messages, newest first, with delivery `status` and `direction` (`messages:read`).

### POST /api/v1/broadcasts

Launch a template broadcast (`broadcasts:send`). Persists the broadcast and its recipients, then sends in the background — returns `202` right away; poll `GET /api/v1/broadcasts/{id}` for progress.

```
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Capped at 1000 recipients per request; invalid numbers are dropped and reported as `rejected`.

## Webhooks

Instead of polling, register an HTTPS endpoint and wacrm POSTs to it when things happen. (This is distinct from the `webhook` step inside Automations, which calls out mid-flow.)

Events: `message.received`, `message.status_updated`, `conversation.created`.

Manage (all `webhooks:manage`):

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": [ … ] }`. `url` must be `https://`. The response includes the signing `secret` exactly once — store it; wacrm keeps only an encrypted copy.
- `GET /api/v1/webhooks` and `GET /api/v1/webhooks/{id}` — list / read (never returns the secret).
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active`.
- `DELETE /api/v1/webhooks/{id}` — remove.

### Delivery payload

```
{
  "id": "8f3c…",                 // unique per delivery — dedupe on this
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* varies by event */ }
}
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the raw request body, compare in constant time, and reject a `t` more than a few minutes old (replay protection).

```
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/)
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex')
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
```

### Delivery semantics

Delivery is best-effort: one attempt per event, no redirects followed. Providers re-send and re-order status callbacks, so an event may arrive more than once or out of order — dedupe on `id` and don't assume ordering. Repeated failures auto-disable an endpoint (`is_active: false`); re-enable it with `PATCH`. For durability, reconcile with the read endpoints when it matters.

For security, webhook targets must be public `https://` URLs — requests to `localhost`, private ranges, and link-local addresses (including cloud metadata) are refused.
