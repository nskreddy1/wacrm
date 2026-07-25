# 100 known problems — ranked audit (Jul 2026)

Grounded in code review of this repo (102 API routes, 77 tables,
16 feature domains). Severity: **S1** ship-blocker before production,
**S2** serious, fix soon, **S3** quality debt, **S4** polish.
Cross-reference `roadmap.md` for fix order of the top items.

## Bugs & correctness (1–15)

1. **S1** `mailtrap` missing from `channel_provider` enum — saving a Mailtrap connection fails at insert while the catalog offers it (roadmap #0)
2. **S1** Sign-out-everywhere revokes refresh tokens but outstanding access tokens live until JWT expiry (~1h) — no JWT-level denylist check in middleware
3. **S2** Device dedup groups by user-agent+IP — two identical laptops on one office network collapse into one row; revoke kills both
4. **S2** Login-attempt lockout counts by email+IP; attacker rotating IPs is only caught by the email-total threshold, which then locks out the victim too (DoS-on-victim tradeoff undocumented)
5. **S2** Geo headers (`x-vercel-ip-city`) are spoofable if the app is ever hosted off Vercel — location display trusts them blindly
6. **S2** `admin_provider_activity` RPC scans `messages` by `created_at` with no partial index on failed status — will slow at scale
7. **S2** Broadcast sends have no dead-letter handling: a provider 500 mid-batch leaves recipients silently unsent
8. **S2** Workflow engine retries are not idempotent — a retried send step can double-message a customer
9. **S3** Conversation unread counts drift when messages arrive during an open session (no realtime reconciliation)
10. **S3** Optimistic UI on message send lacks rollback on provider rejection — ghost messages until refresh
11. **S3** Timezone handling: appointments store UTC but some reminder workflows compute offsets from server time, not contact timezone
12. **S3** Phone normalization inconsistent: some paths E.164, webhook paths store raw — duplicate contacts possible
13. **S3** Email channel lacks threading — every reply opens a new conversation
14. **S4** Relative timestamps ("4 minutes ago") never live-update without refetch
15. **S4** Some toasts show raw error strings from Postgres (constraint names leak)

## Security (16–32)

16. **S1** No 2FA/TOTP — enterprise procurement gate, and roadmap P0
17. **S1** No outbound-webhook HMAC signing — receivers can't verify payloads came from us
18. **S1** AI prompt-injection surface: customer message text flows into LLM prompts; guardrails are prompt-level only, no output filter for PII/credentials
19. **S2** No IP allowlisting per workspace
20. **S2** No session idle timeout / max-age policy (sessions live until sign-out)
21. **S2** v1 API keys have no scopes — a key for reading contacts can send messages
22. **S2** v1 API keys never expire; no rotation reminder surface
23. **S2** No CSP headers configured — XSS blast radius larger than needed
24. **S2** Service-role usage audit: ~30 routes use `channelAdmin()`; each is hand-checked for account_id scoping with no lint rule enforcing it
25. **S2** Invitation tokens don't expire aggressively (7 days) and survive inviter's permission downgrade
26. **S2** No anomaly alerts (new-country login triggers no email to the user)
27. **S3** Audit events table has no immutability guarantee (service role could UPDATE; no trigger blocking it)
28. **S3** Rate limiter is in-memory per serverless instance — resets on cold start, inconsistent across concurrent lambdas
29. **S3** Encrypted credential fields share one master key — no per-tenant key derivation or rotation story
30. **S3** File uploads: MIME type checked client-side only on some paths
31. **S3** No security.txt, no responsible-disclosure page
32. **S4** Login error messages distinguish "wrong password" from "locked" — minor enumeration aid

## Enterprise gaps (33–42)

33. **S1** No SSO (SAML/OIDC) — hard procurement gate
34. **S1** No billing/subscription system — cannot charge customers at all
35. **S2** No SCIM provisioning
36. **S2** Audit log has no UI viewer, no export
37. **S2** Roles are fixed owner/admin/member — no custom roles
38. **S2** No data-residency story documented
39. **S2** No SOC 2 evidence pack / trust page
40. **S3** No per-workspace data export (GDPR portability) self-serve
41. **S3** No account deletion self-serve flow (GDPR erasure)
42. **S3** No DPA template or subprocessor list published

## Architecture & scalability (43–58)

43. **S1** All provider sends are synchronous in request handlers — no queue; a slow Meta API call blocks the route and risks timeout mid-broadcast
44. **S2** No background job system (broadcasts loop in a single invocation; 10k recipients will exceed function limits)
45. **S2** Workflow scheduler relies on cron-triggered polling — minimum latency one minute, and a missed cron tick skips work silently
46. **S2** `messages` table unpartitioned — largest table, will need time partitioning past ~10M rows
47. **S2** No read replicas / all dashboard aggregates hit the primary
48. **S2** Realtime uses Supabase channels per conversation — connection count grows linearly with open inbox tabs
49. **S3** `getCurrentAccount()` runs on every request — RPC + claims check; no edge caching of membership
50. **S3** Webhook processing is inline — a burst of Meta webhooks fans out directly to DB writes with no buffer
51. **S3** AI calls have no token budget guard per workspace — one tenant can burn the platform's gateway quota
52. **S3** No circuit breaker on provider adapters — a down provider gets hammered by every send
53. **S3** Media stored in Supabase storage with public-ish signed URLs of long TTL
54. **S3** Search is Postgres ILIKE — no trigram/FTS index on contacts or messages
55. **S3** Bundle: some admin pages import recharts eagerly — no dynamic import splitting
56. **S4** No CDN caching strategy for avatar/media thumbnails
57. **S4** Several N+1 patterns in team/member listings (per-member profile fetch)
58. **S4** Monolithic `en.json` (1800+ lines) loaded for every page

## Data model (59–68)

59. **S2** `contacts.phone` not unique per account — dedupe relies on app logic that isn't everywhere
60. **S2** Custom fields are JSONB with no schema versioning — renaming a field orphans old data silently
61. **S2** No soft-delete convention: some tables hard-delete (contacts), losing conversation attribution
62. **S3** `deals` has no currency column — amounts assume one currency per workspace
63. **S3** Appointment ↔ deal ↔ conversation links are nullable FKs with no integrity rules on merge
64. **S3** Tags are free-text per table (contact_tags, conversation JSON) — no unified tag entity
65. **S3** No `updated_by` on most tables — audit events capture some, not all
66. **S3** Enum sprawl: status enums differ per table (`active/inactive` vs `enabled/disabled`)
67. **S4** Some FKs lack covering indexes (flagged in schema doc)
68. **S4** `platform_provider_policies.provider` is text+check while `channel_connections.provider` is enum — same concept, two types (caused problem #1)

## Testing & quality (69–78)

69. **S1** No E2E tests at all — inbox send/receive, auth, broadcasts are untested end to end
70. **S2** Unit coverage concentrated in lib/ — most API routes have zero tests
71. **S2** No webhook signature-verification tests with real provider fixtures
72. **S2** No load tests — broadcast and webhook burst behaviour unknown
73. **S3** No visual regression testing
74. **S3** No contract tests for the v1 public API (breaking changes undetected)
75. **S3** TypeScript `any` escape hatches in workflow engine payloads
76. **S3** No CI gate for `pnpm exec tsc --noEmit` + vitest on PRs (relies on discipline)
77. **S4** No accessibility audit run (keyboard nav through inbox untested)
78. **S4** Seed script drifts from schema (manual fixes needed after migrations)

## Observability & ops (79–86)

79. **S1** No error tracking (Sentry or similar) — production errors invisible
80. **S2** No structured logging with request IDs — cross-route tracing impossible
81. **S2** No uptime monitoring / status page
82. **S2** Webhook delivery failures from providers aren't surfaced anywhere admin-visible
83. **S3** No metrics on AI latency/cost per workspace
84. **S3** No slow-query monitoring hooked to alerts
85. **S3** Migrations applied via script with no drift detection between environments
86. **S4** No runbooks for common incidents (provider outage, webhook flood)

## UX & product (87–100)

87. **S2** No mobile apps; responsive web only — competitor table stakes
88. **S2** Onboarding drops user into empty workspace — no guided setup or demo data
89. **S2** No global search across contacts/conversations/deals
90. **S2** Inbox lacks keyboard shortcuts (j/k navigation, r to reply)
91. **S3** No bulk actions on contacts list (bulk tag, bulk assign, bulk delete)
92. **S3** Broadcast composer has no test-send-to-self
93. **S3** No undo window after destructive actions (delete contact is instant)
94. **S3** Workflow builder has no dry-run/simulator
95. **S3** No notification preferences (every event emails everyone)
96. **S3** Template approval status from Meta not auto-refreshed — manual sync button only
97. **S4** Empty states inconsistent — some helpful, some blank panels
98. **S4** Dark-mode contrast issues in chart tooltips
99. **S4** No i18n beyond English despite next-intl scaffolding
100. **S4** Settings information architecture is deep (5 levels) — frequently-used toggles buried

## Summary

| Severity | Count | Meaning |
| --- | --- | --- |
| S1 | 8 | Ship-blockers: #1, 2, 16, 17, 18, 33, 34, 43, 69, 79 |
| S2 | 34 | Fix within the next cycle |
| S3 | 40 | Scheduled debt |
| S4 | 18 | Polish backlog |

Fix order for S1s: billing (#34) and error tracking (#79) unlock
revenue and visibility; enum bug (#1) is a 5-minute migration; then
2FA (#16), queue for sends (#43), webhook signing (#17), AI
guardrails (#18), SSO (#33), E2E tests (#69), JWT denylist (#2).
