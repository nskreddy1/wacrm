# Security Design & Review Playbook

MANDATORY: run the `security-review` skill
(`.agents/skills/security-review/` or team memory skills) on every
diff that touches auth, tenancy, credentials, webhooks, or AI prompts.

## Security architecture (current)

1. **Tenant isolation**: RLS on all tenant tables via
   `is_account_member()`. Service-role usage (`channelAdmin()`)
   requires explicit `account_id` scoping — this is the #1 review rule.
2. **Authentication**: Supabase Auth, but sign-in is server-gated
   (`/api/v1/security/login`): per-email+IP attempt tracking, 5
   fails/15 min → 15 min lockout (`account_lockouts`), uniform error
   messages (no user enumeration), geo captured from `x-vercel-ip-*`.
3. **Session control**: `auth_devices` per-session rows; per-device
   revoke (deletes the `auth.sessions` row = refresh token dead);
   "sign out everywhere" via SECURITY DEFINER RPC
   `admin_revoke_all_auth_sessions` (revoked from public/anon/authenticated,
   granted to service_role only). Access tokens die at JWT expiry
   (~1h max window after revoke).
4. **Credential storage**: provider credentials AES-256-GCM encrypted
   (`src/features/whatsapp/lib/encryption.ts`, `ENCRYPTION_KEY` env).
   Never log, return to client, or embed in prompts. UI shows masked
   identities only.
5. **Webhooks**: Meta HMAC + Twilio `X-Twilio-Signature` verification
   before processing. Any new provider webhook MUST verify signatures.
6. **Public API**: `api_keys` verified by hash comparison; per-key
   rate limiting via `src/lib/rate-limit.ts`.
7. **Platform admin**: `requireSuperAdmin()` on every `/api/admin/*`
   route AND server-side gate in admin layouts (redirect non-admins).
8. **AI surface**: customer message text flows into LLM prompts —
   prompt-injection risk. Model output must never be used unescaped
   in HTML/SQL. Knowledge/config per tenant.
9. **Privacy/consent**: admin Providers page shows counts and masked
   identities only — operators can never read message bodies,
   contact lists, or decrypted credentials. Keep it that way.

## Review checklist for every change

- [ ] New table → RLS enabled + policies + `account_id` column?
- [ ] `channelAdmin()` call → explicit tenant filter?
- [ ] New SECURITY DEFINER fn → revoke public/anon/authenticated, grant service_role, `set search_path = ''`?
- [ ] Client-supplied IDs → verified against session account, never trusted?
- [ ] Errors → generic messages, no stack/PII leakage; no user enumeration?
- [ ] Secrets → encrypted at rest, masked in UI, absent from logs?
- [ ] Webhook → signature verified before body parse side effects?
- [ ] Rate limit on anon-accessible or expensive endpoints?
- [ ] AI: user text into prompts → treated as untrusted; output escaped?

## Known accepted risks / TODO

- Access tokens remain valid up to JWT expiry after revoke (no
  per-request session check middleware). Acceptable now; add a
  session-validity check in proxy.ts if requirements tighten.
- `x-forwarded-for` first hop is client-controlled off-Vercel; geo is
  advisory, not authoritative.
- No 2FA/TOTP yet (see roadmap — top competitive gap for enterprise).
- Signup route does not yet share the lockout/attempt layer (login only).
