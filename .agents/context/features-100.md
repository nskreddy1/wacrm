# 100 features to build — enterprise + verticals + 2026 AI

Researched Jan–Jul 2026 against: respond.io, Wati, Zoko, HubSpot,
Salesforce, Twenty, EspoCRM, SuiteCRM; enterprise procurement gates
(SSO/SCIM/SOC2); vertical CRM reviews (real estate, healthcare,
education, automotive). Competitor weak spots worth attacking:
Wati (no SOC 2, 20% Meta fee markup, silent workflow failures),
respond.io (pricing complexity, steep learning curve), Zoko
(Shopify-only, no omnichannel depth).

Scoring: **[P0]** = enterprise procurement gate or direct revenue,
**[P1]** = competitive differentiator, **[P2]** = valuable, later.

## A. Enterprise readiness (procurement gates) — 12

1. [P0] SAML 2.0 SSO per workspace (Okta, Entra ID, Google IdP)
2. [P0] OIDC SSO as lighter alternative per workspace
3. [P0] SCIM 2.0 user provisioning/deprovisioning (orphan-account audit control)
4. [P0] TOTP 2FA + recovery codes (extends existing login-security layer)
5. [P0] Tenant-scoped immutable audit log viewer with JSON/CSV export to SIEM
6. [P0] SOC 2 Type II readiness pack (trust page, pentest report, IR plan)
7. [P1] Data residency disclosure + region pinning per workspace
8. [P1] IP allowlist per workspace (login + API)
9. [P1] Session policies per workspace: max age, idle timeout, device limit
10. [P1] Custom roles (beyond owner/admin/member) with per-module permissions
11. [P2] Field-level permissions (hide revenue fields from junior agents)
12. [P2] Legal hold + configurable data-retention policies per workspace

## B. Messaging & omnichannel depth — 12

13. [P0] Instagram DM channel (adapter pattern already supports it)
14. [P0] Facebook Messenger channel
15. [P1] Telegram channel
16. [P1] Web chat widget (embeddable, feeds same inbox)
17. [P1] Voice calls via Twilio with recording + AI transcription
18. [P2] Email threading view (proper conversation threading for email channel)
19. [P1] Message failover chains (Resend fails → SMTP retry; per-channel primary/backup)
20. [P1] Per-workspace rate limits + sending windows/quiet hours (compliance)
21. [P1] WhatsApp Flows (in-chat forms: bookings, lead qualification)
22. [P1] WhatsApp Catalog + cart sync (attack Zoko's niche)
23. [P2] WhatsApp Payments (UPI in India, cards elsewhere)
24. [P2] RCS Business Messaging (Google's iMessage-alternative, growing in 2026)

## C. AI & agentic (2026 differentiators) — 14

25. [P0] AI agent handoff rules: confidence threshold → human takeover with full context
26. [P0] Prompt-injection hardening + AI output guardrails (block PII/credential leaks)
27. [P1] Agentic follow-ups: AI schedules and sends follow-up sequences autonomously with approval queue
28. [P1] Conversation intelligence: auto-extract deal amount, intent, objections, next step into CRM fields
29. [P1] AI lead scoring from message content + response latency + engagement
30. [P1] AI-suggested replies with one-tap send (inbox copilot)
31. [P1] Auto-summarize long conversations on agent handoff
32. [P1] Sentiment tracking per conversation with escalation trigger
33. [P1] AI translation layer: agent writes English, customer reads their language, both ways
34. [P2] Voice-note transcription + AI reply drafting
35. [P2] AI knowledge-base builder: ingest docs/URLs → agent answers grounded with citations
36. [P2] Revenue forecasting from pipeline + conversation signals
37. [P2] Churn-risk prediction per contact (no reply in N days, sentiment decline)
38. [P2] AI compliance monitor: flags agents promising discounts, sharing PII, policy violations

## D. Sales & pipeline (compete with HubSpot/Twenty) — 12

39. [P0] Multiple pipelines per workspace (sales, onboarding, support each get one)
40. [P0] Products/line items on deals (quantity × price, currency)
41. [P1] Quotes & invoices generation from deals (PDF + WhatsApp send)
42. [P1] E-signature on documents via WhatsApp link
43. [P1] Round-robin + rule-based lead assignment (by territory, language, load)
44. [P1] SLA timers on conversations (first-response, resolution) with breach alerts
45. [P1] Meeting scheduler page per agent (Calendly-style, feeds appointments)
46. [P1] Win/loss reasons taxonomy + reporting
47. [P2] Sales sequences: multi-step WhatsApp/SMS/email cadences with exit conditions
48. [P2] Commission tracking per agent per closed deal
49. [P2] Duplicate detection + merge for contacts (fuzzy phone/email match)
50. [P2] Territory management (geo/industry-based ownership)

## E. Automation & integrations — 10

51. [P0] Public REST API v1 expansion: deals, appointments, workflows CRUD (partial today)
52. [P0] Outbound webhooks with HMAC signatures + retry/dead-letter
53. [P1] Zapier/Make connectors (top-requested integration everywhere)
54. [P1] Native Shopify integration (orders → conversations, abandoned cart)
55. [P1] Google Sheets two-way sync for contacts
56. [P1] Calendar sync (Google/Outlook) for appointments
57. [P2] Accounting sync (QuickBooks/Xero) for invoices
58. [P2] Workflow marketplace: shareable workflow templates across workspaces
59. [P2] Custom functions in workflows (sandboxed JS step)
60. [P2] iPaaS embedded (Paragon/Merge-style) for long-tail integrations

## F. Vertical: Real estate — 8

61. [P1] Property listings module (photos, price, location, status)
62. [P1] Listing card sender: share property carousels in WhatsApp
63. [P1] Site-visit scheduling with reminder sequences
64. [P1] Buyer preference matching: auto-notify matching contacts on new listing
65. [P2] Document collection flows (KYC, loan docs) via WhatsApp with checklist
66. [P2] Commission calculator per deal
67. [P2] Portal integrations (Zillow/99acres/MagicBricks lead import)
68. [P2] Virtual tour link tracking (who watched, how long)

## G. Vertical: Healthcare / clinics — 7

69. [P1] Appointment reminders with confirm/reschedule buttons (cuts no-shows)
70. [P1] Patient intake forms via WhatsApp Flows
71. [P1] Recall campaigns (vaccination due, checkup due) from custom fields
72. [P2] HIPAA-mode workspace: stricter retention, BAA, PHI masking in AI
73. [P2] Prescription refill request flow with pharmacy handoff
74. [P2] Lab-result notification with secure document link
75. [P2] Waitlist auto-fill: cancellation → notify next patient

## H. Vertical: Education / coaching — 6

76. [P1] Course/batch module (schedule, capacity, fees)
77. [P1] Enrollment flows: inquiry → counseling call → fee payment → onboarding
78. [P1] Fee reminder sequences with payment links
79. [P2] Attendance notifications to parents
80. [P2] Certificate delivery via WhatsApp document
81. [P2] Alumni re-engagement campaigns

## I. Vertical: Automotive, retail, services — 6

82. [P2] Vehicle inventory module + test-drive booking (automotive)
83. [P2] Service reminder by vehicle age/mileage (automotive)
84. [P2] Order status notifications from Shopify/WooCommerce (retail)
85. [P2] Back-in-stock alerts via WhatsApp subscription (retail)
86. [P2] Job/technician dispatch with live location share (field services)
87. [P2] Review collection flow post-purchase (Google review link, NPS)

## J. Analytics & reporting — 6

88. [P0] Custom report builder (pick metric, dimension, date range, save)
89. [P1] Agent performance dashboard (response time, resolution, CSAT, volume)
90. [P1] Campaign ROI tracking (broadcast → replies → deals → revenue)
91. [P1] Scheduled report emails (weekly digest to owner)
92. [P2] Cohort retention analysis for contacts
93. [P2] Cost dashboards: per-provider message costs + AI token spend per workspace

## K. Platform & operations — 7

94. [P0] Billing + subscription tiers with usage metering (messages, seats, AI tokens)
95. [P1] White-label/agency mode: partner manages multiple client workspaces
96. [P1] Sandbox workspace with seeded demo data for trials
97. [P1] In-app onboarding checklists per vertical template
98. [P2] Mobile apps (React Native) — Wati's app instability is a known complaint
99. [P2] Offline-first inbox PWA for spotty connections
100. [P2] Status page + per-workspace incident notifications

## Vertical template strategy

Package D+F/G/H/I as **workspace templates**: at onboarding, picking
"Real estate" pre-creates pipelines, custom fields, workflows, and
message templates for that industry. One codebase, many verticals —
this is how vertical CRMs win without forking.
