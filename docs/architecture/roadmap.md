# Problems, Pre-Production Checklist & Competitive Roadmap

## Ranked problems (fix order — highest impact first)

0. **BUG — `mailtrap` missing from the `channel_provider` enum**
   (P0, broken feature). Found while documenting the schema. The live
   enum is `meta, twilio, google, resend, smtp, microsoft`. A Mailtrap
   adapter exists (`features/channels/lib/adapters/mailtrap.ts`) and
   the admin catalog offers Mailtrap because
   `platform_provider_policies.provider` is a **text column with a
   check constraint** that does include it — but
   `channel_connections.provider` is the **enum**, so actually saving
   a Mailtrap connection fails at insert time. Fix: migration with
   `ALTER TYPE channel_provider ADD VALUE 'mailtrap';` (must run
   outside a transaction block), then re-verify the settings save
   path end to end.

1. **No 2FA/TOTP** — table stakes for enterprise CRM buyers; login
   security layer exists, extend it (P0, security).
2. **Signup not gated** — signup/password-reset don't share the
   attempt/lockout layer that login has (P0, security).
3. **No background job runner** — broadcasts/flows run in request
   context or cron polling; long sends risk timeouts. Need queue
   (Vercel Queues / Supabase cron + claim pattern) (P0, reliability).
4. **No E2E tests** — vitest units only; auth, inbox send/receive,
   and broadcast paths have no browser coverage (P1, quality).
5. **Observability gaps** — pino exists but no error tracker (Sentry),
   no webhook-delivery health monitor, no provider failure alerting
   (P1, ops).
6. **Access-token revoke lag** — revoked sessions live until JWT
   expiry; add session check in proxy for sensitive routes (P1).
7. **i18n single-locale** — `messages/en.json` only; structure is
   ready, no other locales shipped (P2).
8. **`admin-channels.tsx` is 1000+ lines** — needs the same split
   treatment the Providers page got (P2, maintainability).
9. **No data export/GDPR tooling** — contact export exists per-module
   but no full workspace export/delete flows (P2, compliance).
10. **Provider activity is 14-day fixed** — no custom ranges, no
    per-provider drill-down, no cost attribution (P3).

## Before production checklist

- [ ] 2FA + signup gating (items 1–2)
- [ ] Queue for broadcasts/flows; idempotent send with retry + DLQ
- [ ] Sentry (or similar) + uptime checks on webhooks
- [ ] Load-test inbox realtime + broadcast fan-out
- [ ] Backup/restore drill for Supabase; PITR confirmed
- [ ] Rotate `ENCRYPTION_KEY` procedure documented
- [ ] Full `security-review` skill pass over `/api/v1/*` public surface
- [ ] Rate limits reviewed per route (esp. `/api/v1/security/login`, invite redeem, webhooks)
- [ ] Terms/privacy/DPA pages; email opt-out honored on all sends

## Competitive feature gaps (vs Wati / respond.io / Zoko)

Differentiator to protect: **AI-agent-first messaging CRM** — agents
that actually resolve conversations, not just canned auto-replies.

1. **WhatsApp Flows / interactive forms** in conversations (Wati has basic; do it better with AI pre-fill).
2. **Campaign analytics** — delivery/read/reply funnels per broadcast, CTR on template buttons.
3. **Commerce**: catalog → cart → payment link inside WhatsApp (Zoko's moat; we have catalog already).
4. **Team performance dashboards** — response time, resolution rate, CSAT per agent (human + AI side by side).
5. **Omnichannel widening** — Instagram DM + Messenger + Telegram adapters on the existing channel abstraction.
6. **AI copilot for the whole CRM** — assistant exists; extend to "do" actions (create deal, schedule, broadcast draft) via MCP tools.
7. **Template library marketplace** — pre-built flow + template packs per industry (respond.io weak spot).
8. **Provider failover** (roadmap item from Providers page): auto-switch email/SMS provider on failure.
9. **Public API + webhooks parity** — v1 exists; document it and add OAuth apps for an integrations ecosystem.
10. **White-label / multi-workspace agency mode** — platform admin console already halfway there.
