# Feature Inventory — In-Depth (as-built, 2026-07-26)

Method: enumerated every `src/features/*` module (file counts + LOC + test
counts), every page and API route, the flow node/trigger unions, the AI tool
registry, and cross-module reference counts. Numbers are measured, not
estimated. Companion docs: `report-app-audit.md` (objective/users/automation),
`report-inbound-scale.md` (message path at scale).

---

## 0. Scale of the codebase

| Metric | Count |
|---|---|
| Feature modules | **26** |
| TS/TSX lines in `src/features` | **~86,200** |
| Pages (`page.tsx`) | **34** |
| API route handlers | **~104** |
| DB tables | **78** |
| Test files | **80** |
| Flow node types | **17** |
| Flow trigger types | **9** |
| AI tools (shared chat + MCP) | **21** |
| LLM providers wired | **4** (OpenAI, Anthropic, Gemini, + Gateway) |

---

## 1. Module-by-module (measured)

Sorted by size. `tsx` = UI files, `ts` = logic files, `T` = test files.

| Module | tsx | ts | T | LOC | What it actually does |
|---|--:|--:|--:|--:|---|
| **settings** | 35 | 2 | **0** | 12,052 | Largest UI surface. 35 panels: profile, workspace, members, roles/profiles, permissions editor, channel connections + setup sheets, API keys, security (devices/sessions/login activity), verified domains, email delivery, AI knowledge, external sources, fields & tags, module fields, deals settings, quick replies, appearance, activity, support |
| **flows** | 11 | 12 | **8** | 12,032 | Visual automation engine. Canvas editor, node palette, edge routing, auto-layout, validator, run inspector, fallback handling, cron scheduler, Meta send path |
| **assistant** | 2 | 33 | **16** | 7,973 | AI core. 4 providers, agent router, auto-reply, persona, schedule gating, handoff, RAG (chunk/embeddings/knowledge/query), 21 tools, usage metering, validation proofs |
| **whatsapp** | 0 | 16 | **19** | 6,980 | Provider layer — best-tested module. Template sync/dedup, Twilio Content API, approvals, media, signature verification, SSRF guards |
| **inbox** | 12 | 3 | 1 | 5,453 | Live agent console. Thread list, message pane, composer, assignment, filters, SMS split view |
| **admin** | 7 | 4 | 1 | 4,699 | Platform (super-admin) console: workspaces, channels, AI agent, tickets, providers, platform config |
| **contacts** | 8 | 3 | 2 | 4,256 | CRM records: list, detail, create/edit, custom fields, tags, notes, import |
| **pipelines** | 6 | 7 | 3 | 4,058 | Deal boards. Configurable stages, drag-drop cards, deal CRUD |
| **templates** | 2 | 5 | **0** | 3,695 | Template Studio UI (multi-channel authoring, provider lock, compliance checks). Logic tested indirectly via `whatsapp` |
| **dashboards** | 19 | 4 | 1 | 3,691 | 16 widgets: KPI cards, volume chart, pipeline/broadcast funnels, lead sources, contacts growth, team performance, tasks, attention panel, appointments, activity feed, custom |
| **agents** | 8 | 1 | **0** | 3,325 | Multi-agent config UI: personas, duty hours, routing, playground |
| **auth** | 6 | 8 | 4 | 2,586 | Login/signup/reset, session, invitations, join-by-token |
| **broadcasts** | 4 | 2 | 1 | 2,643 | Bulk send: audience builder, template pick, schedule, per-broadcast analytics |
| **channels** | 0 | 15 | 4 | 2,255 | Provider-agnostic layer: inbound normalize, orchestrate, tenancy resolve by number, event dedup |
| **appointments** | 2 | 0 | **0** | 1,022 | Booking/calendar list (internal only — no external calendar sync) |
| **team-chat** | 4 | 1 | **0** | 1,197 | Internal staff chat |
| **webhooks** | 0 | 5 | 5 | 799 | Outbound webhook delivery + signing |
| **external-sources** | 0 | 3 | 2 | 837 | External data source connectors for AI grounding |
| **catalog** | 2 | 0 | **0** | 712 | Product catalog (WhatsApp commerce) |
| **interactive** | 2 | 0 | **0** | 597 | Interactive message builders (buttons/lists) |
| **presence** | 1 | 2 | 1 | 419 | Online/typing indicators |
| **api-keys** | 0 | 3 | 2 | 396 | API key issue/verify/scopes |
| **module-fields** | 1 | 2 | **0** | 262 | Per-module custom field config (the vertical-pack primitive) |
| **support** | 0 | 2 | **0** | 182 | Ticket creation |
| **brand** | 1 | 0 | **0** | 105 | Public brand page |

---

## 2. Two major surfaces missing from all prior docs

### 2a. `/api/v1` — 24-route public API + mobile BFF
Not just a "public API" — it contains `session`, `security/devices`,
`security/login`, `security/login-activity`, `workspace/navigation`,
`workspace/inbox/summary`. Navigation and session endpoints mean **a native
mobile client is intended** (server-driven nav). Routes:

- Core CRM: `contacts`, `contacts/[id]`, `conversations`,
  `conversations/[id]`, `conversations/[id]/messages`, `messages`
- Sending: `broadcasts`, `broadcasts/[id]`
- Read models: `dashboard`, `me`, `notifications`
- Workspace: `appointments`, `automation-resources`, `catalog`, `contacts`,
  `inbox/summary`, `navigation`, `tasks`
- Auth/security: `session`, `security/devices`, `security/login`,
  `security/login-activity`
- Integration: `webhooks`, `webhooks/[id]`

**Auth:** uniform — `requireApiKey` appears 28× across the surface. Good
consistency; no route relies on cookie session.

### 2b. MCP server (`/api/mcp/[transport]`)
Exposes the **same 21 assistant tools** to external MCP clients (Claude,
editors). Architecture is notably clean:
- One shared tool registry (`assistant/lib/tools.ts`) serves in-app chat AND MCP
- API key pins the account → every tool call is workspace-scoped
- Scope gating: read tools need `contacts:read`, write tools additionally need
  `contacts:write`; missing scope returns a clear refusal, not a 500
- Server identity: `wacrm-workspace v1.0.0`

This is a real differentiator — the CRM is agent-addressable out of the box.

---

## 3. Automation engine — exact capabilities

**17 node types** (verified from the `FlowNodeConfig` discriminated union):

`start`, `send_message`, `send_buttons`, `send_list`, `send_media`,
`collect_input`, `condition`, `set_tag`, `send_template`,
`update_contact_field`, `assign_conversation`, `create_deal`, `send_webhook`,
`close_conversation`, `wait`, `handoff`, `end`

**9 trigger types** (per `flows.trigger_type`): includes `keyword`, `manual`,
`scheduled`, `tag_added` among others.

Engine files: `engine.ts` (executor), `action-nodes.ts` (node registry),
`edges.ts` + `layout.ts` (graph/auto-layout), `validate.ts` (pre-publish
checks), `fallback.ts` (unmatched input), `templates.ts`, `meta-send.ts`,
`cron-auth.ts` (new). **8 test files** — the most rigorously tested UI-facing
subsystem.

Capability read: this covers genuine conversational automation —
branch on condition, collect + persist input, tag, create deals, call external
webhooks, park on `wait`, and hand off to a human. It is **not** a toy builder.

---

## 4. AI layer — 21 tools, 4 providers

**Read tools (15):** `get_workspace_overview`, `list_contacts`,
`get_contact_details`, `search_contacts`, `get_pipeline_summary`, `list_deals`,
`list_recent_conversations`, `get_conversation_messages`,
`list_upcoming_appointments`, `list_broadcasts`, `list_templates`,
`list_automations`, `list_tasks`, `list_support_tickets`,
`get_ai_agent_status`

**Write tools (6):** `create_contact`, `create_task`, `add_contact_note`,
`create_workflow`, `activate_workflow`, `create_support_ticket`

Note `create_workflow` + `activate_workflow`: **the AI can author and enable
automations**. That is a high-leverage capability and also the highest-risk
write path in the product (an agent can change how the tenant's messaging
behaves). Worth an explicit approval gate review.

**Supporting AI infra:** `router.ts` (multi-agent supervisor), `persona.ts`,
`schedule.ts` (duty hours), `handoff.ts`, `usage.ts` (metering),
`knowledge.ts`/`embeddings.ts`/`chunk.ts`/`query.ts` (RAG),
`validation-proof.ts`, `engine-flag.ts`. 12 AI API routes including
`playground`, `test`, `runs`, `usage`, `knowledge/reindex`.

---

## 5. Test coverage is severely uneven

| Well covered | Thin/none |
|---|---|
| whatsapp (19) | **settings (0)** — 12k LOC, largest UI surface |
| assistant (16) | **agents (0)** — 3.3k LOC AI config |
| flows (8) | **templates (0)** — 3.7k LOC |
| webhooks (5) | **appointments, catalog, interactive, team-chat, module-fields, support, brand (0)** |
| auth (4), channels (4) | dashboards (1), inbox (1), admin (1), broadcasts (1) |

The pattern: **provider/engine code is tested, product UI and config surfaces
are not.** `settings` at 12,052 LOC with zero tests is the single largest
untested blast radius — and it's where channel credentials, roles, permissions
and API keys are managed (i.e. the security-critical surface).

Correction to an earlier claim in this repo's notes: it is **not** true that
there are "no tests" — there are 80 test files. The accurate statement is
"no tenant-isolation/RLS tests, and no tests on the settings/config UI."

---

## 6. Thin-integration modules (candidate risk, not dead code)

Cross-reference counts (imports from outside the module itself):

- `team-chat` — 1 external reference
- `catalog` — 1
- `appointments` — 2, `brand` — 2
- `presence` — 3, `interactive` — 3
- `module-fields` — 4
- `support` — 7 (well integrated)

`team-chat` (1,197 LOC) and `catalog` (712 LOC) are built but barely wired into
the rest of the product — they exist as pages without deep integration. Not
deletable, but they're features users likely can't *reach* through natural
workflows.

---

## 7. What genuinely exists vs. what's missing

**Strong / production-shaped:**
messaging capture + routing (multi-provider, multi-number), agent inbox,
automation engine (17 nodes), AI layer with RAG + 21 tools + MCP, contacts,
pipelines, broadcasts, dashboards (16 widgets), RBAC + roles/profiles,
API keys + scopes, public API + mobile BFF, platform admin console.

**Missing (confirmed absent, not just untested):**
- **Money layer** — no invoices, no payments, no Razorpay. Nothing bills.
- **Client portal** — no client-facing surface at all.
- **Plan/quota enforcement** — no seat or usage limits anywhere (CRITICAL-2 in
  `report-app-audit.md`); tiered pricing is currently unenforceable.
- **External calendar sync** — appointments are internal-only.
- **Projects/tasks depth** — `list_tasks` exists but no project module.
- **Email as a channel** — `email` API route + delivery panel exist, but email
  is transactional only, not a conversation channel.
- **Verified reviews / referral loop** — the Clienter growth mechanism.

---

## 8. Honest read

The product is **much further along than a typical pre-launch MVP** on the
messaging + automation + AI axis: 86k LOC, 78 tables, a real 17-node
automation engine, a 21-tool agent layer that is simultaneously exposed over
MCP, and a 24-route API with a mobile BFF. Those are hard things and they are
built.

The gaps are not in the engine — they are in **commercialization**: nothing
bills, nothing enforces a plan, and there is no client-facing surface. Combined
with `report-app-audit.md`'s finding of 1 user / 0 contacts / 0 messages, the
accurate summary is: **a technically deep, commercially unarmed platform with
zero production validation.**

Priority implication (unchanged from the audit): CRITICAL-2 (plan limits) and
the money layer are worth more than any additional engine capability.
