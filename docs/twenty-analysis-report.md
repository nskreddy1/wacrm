# Twenty CRM — Architecture, Security, Data Model & UI Analysis

**Sources analysed**
- Docs: `docs.twenty.com` — full page index (`llms.txt`), "Why Twenty", Key Features, and all Core Concepts pages (Data Model, AI, Dashboards, Layout).
- Code: `github.com/twentyhq/twenty` cloned at `/tmp/tw` (468 MB, 21 packages, shallow clone).

**Purpose** — establish exactly what is worth porting into our WhatsApp CRM, what is *not*, and in what order. This is the reference document for the merge work that follows.

---

## 1. What Twenty actually is

Twenty positions itself as **"a production-ready CRM you can reshape as you go"** — explicitly a *platform you build on, not a product you configure*. Their four stated pillars:

| Pillar | Their claim |
| --- | --- |
| Built for Agents | Agents operate inside the data model with real permissions — Skills, Tools, MCP |
| Secured Extensibility | "The flexibility of vibe-coded tools on secured foundations" |
| Modern Stack | React + TypeScript, no proprietary language (vs Salesforce APEX) |
| No Lock-In | Open-source core, self-hostable, export anytime |

**Strategic read for us:** Twenty's differentiator is *runtime user-defined schema* — the user creates objects and fields, and the API, views, permissions and workflow triggers all materialise automatically. That is a genuinely large architectural commitment (see §4). Their agent story is strong and directly relevant to us. Their WhatsApp/omnichannel story is essentially absent — that is *our* differentiator and we should not trade it away.

---

## 2. Monorepo topology

21 Yarn workspace packages. The ones that matter:

| Package | Role |
| --- | --- |
| `twenty-server` | NestJS 11 API — GraphQL + REST + MCP, TypeORM 0.3 (patched), BullMQ 5 queues |
| `twenty-front` | React 19 SPA — Jotai state, Apollo Client 4, AI SDK 6, XYFlow, Nivo charts, Lingui i18n |
| `twenty-ui` | Design system / theme primitives |
| `twenty-shared` | Cross-cutting types & constants (permission flags, UUID registries) |
| `twenty-sdk` / `twenty-cli` / `create-twenty-app` | App-authoring toolchain |
| `twenty-apps` | First-party apps built on that SDK |
| `twenty-claude-skills`, `twenty-codex-plugin` | Agent-tooling integrations |
| `twenty-docker`, `twenty-e2e-testing`, `twenty-emails`, `twenty-website`, `twenty-zapier` | Infra & satellites |

**Server engine layout** (`twenty-server/src/engine/`) is the most instructive part of the repo:

```
api/            graphql | rest | mcp        <- three parallel API surfaces
core-modules/   ~60 modules (auth, billing, ai, messaging, calendar, file, ...)
metadata-modules/  the schema-of-the-schema (objects, fields, roles, views, agents, skills)
twenty-orm/     their own repository layer on top of TypeORM
workspace-datasource/  per-workspace connection + schema resolution
workspace-manager/     migration builders/runners that mutate live tenant schemas
workspace-cache*/      metadata caching
```

The `metadata-modules` / `modules` split is the core idea: **`modules/` = the standard business objects, `metadata-modules/` = the machinery that lets a workspace define its own.**

---

## 3. Multi-tenancy — schema-per-workspace

Confirmed in `engine/workspace-datasource/utils/get-workspace-schema-name.util.ts`:

```ts
export const getWorkspaceSchemaName = (workspaceId: string): string => {
  return `workspace_${uuidToBase36(workspaceId)}`;
};
```

Every workspace gets a **dedicated Postgres schema**. Tenant isolation is therefore structural (separate namespaces), not row-level. `workspace-manager/workspace-migration/` contains migration *builders* and *runners* with action-handlers per entity type (`agent/`, `skill/`, `view/`, …) because adding a custom field literally runs DDL against that tenant's schema at runtime.

**Comparison with ours:** we use **Supabase with a single shared schema + Row Level Security** — 77 tables with RLS enabled and 279 policies. 

| | Twenty | Ours |
| --- | --- | --- |
| Isolation | Separate schema per tenant | Shared tables + RLS |
| Custom fields | Real DDL columns | JSON/EAV via `module-fields` |
| Blast radius of a bad query | Contained by `search_path` | Contained by policy correctness |
| Cost per tenant | Heavy (N schemas, N migrations) | Cheap |
| Cross-tenant analytics | Hard | Trivial |

**Verdict: do NOT port this.** Schema-per-tenant is the right call for self-hosted enterprise Salesforce replacement; it is the wrong call for a multi-tenant SaaS with many small WhatsApp-first tenants. Our RLS model is already strong and Supabase-native. Porting this would be a rewrite with negative user-visible return.

---

## 4. Data model

### Standard objects
From `twenty-server/src/modules/` — Companies, People, Opportunities, Tasks, Notes, plus Attachments, Blocklist, Calendar (events/participants/channels), Call Recording, Connected Account, Dashboard, Emailing/Messaging (message, thread, participant, channel, campaign, list), Timeline Activity, Workflow (+ version, run, automated trigger), Workspace Member.

### Field types (docs + `field-metadata`)
| Category | Types |
| --- | --- |
| Basic | Text, Number, Boolean, Date, Currency, Rating, Select |
| Composite | Address, Full Name, Links, Phones, Emails |
| Special | Relation, File Attachment, JSON, **Actor** (who created/modified) |

Auto system fields on every object: `id`, `createdAt`, `updatedAt`, `createdBy`, `position`.

### The metadata layer — the actual crown jewel
`metadata-modules/` carries a `flat-*` entity family that *is* the schema-of-the-schema:

`flat-object-metadata`, `flat-field-metadata`, `flat-role`, `flat-object-permission`, `flat-field-permission`, `flat-row-level-permission-predicate`, `flat-view`, `flat-view-field`, `flat-page-layout`, `flat-page-layout-tab`, `flat-page-layout-widget`, `flat-navigation-menu-item`, `flat-command-menu-item`, `flat-front-component`, `flat-agent`, `flat-skill`, `flat-index-metadata`, `flat-permission-flag`, …

Note what is modelled as data rather than code: **roles, per-object AND per-field permissions, row-level predicates, views, page layouts, widgets, sidebar entries, command-menu entries, agents, and skills.** That is why their settings UI can offer Data model / Layout / Roles / AI as first-class editable surfaces.

**What we should take:** the *pattern* of promoting layout + permissions + agent config into data, selectively. We already have `module-fields`. The highest-value borrow is **page layouts / widgets as data** (§7) and **granular role permissions** (§5) — not the whole flat-entity framework.

---

## 5. Security model

### Authentication
`core-modules/auth/` — email/password, Google OAuth, Microsoft OAuth, **SAML**, **OIDC**, plus reset-password, email verification, approved access domains, API keys, app tokens, and impersonation.

### Guards (`engine/guards/`)
`jwt-auth`, `user-auth`, `workspace-auth`, `require-access-token`, `settings-permission`, `custom-permission`, `feature-flag`, `billing-disabled`, `admin-panel`, `impersonate-permission`, `no-impersonation`, `server-level-impersonate`, `public-endpoint`. Layered and composable — permission checks are declarative decorators, not scattered `if` statements.

### Permission flags — `twenty-shared/src/constants/PermissionFlagType.ts`
Two families, which is the insight worth stealing:

**Settings permissions:** `API_KEYS_AND_WEBHOOKS, WORKSPACE, WORKSPACE_MEMBERS, ROLES, DATA_MODEL, SECURITY, WORKFLOWS, IMPERSONATE, SSO_BYPASS, APPLICATIONS, MARKETPLACE_APPS, LAYOUTS, BILLING, AI_SETTINGS`

**Tool permissions:** `AI, VIEWS, UPLOAD_FILE, DOWNLOAD_FILE, SEND_EMAIL_TOOL, CREATE_CALENDAR_EVENT_TOOL, HTTP_REQUEST_TOOL, CODE_INTERPRETER_TOOL, IMPORT_CSV, EXPORT_CSV, CONNECTED_ACCOUNTS, PROFILE_INFORMATION`

Each flag has a **stable hard-coded UUID** (`SystemPermissionFlag.ts`) so roles survive migrations.

> **This is the single most important security idea in the repo for us.** A capability like "may send email" or "may run code" is a *permission flag*, and the AI's tools are gated by exactly the same flags as the human UI. There is no separate, weaker AI authorisation path.

### Enforcement at the tool boundary
Verified in `core-modules/tool-provider/providers/`:

```
action-tool.provider.ts     -> HTTP_REQUEST_TOOL, SEND_EMAIL_TOOL,
                               CREATE_CALENDAR_EVENT_TOOL, CODE_INTERPRETER_TOOL
dashboard-tool.provider.ts  -> LAYOUTS
metadata-tool.provider.ts   -> DATA_MODEL
view-tool.provider.ts       -> VIEWS
webhook-tool.provider.ts    -> API_KEYS_AND_WEBHOOKS
workflow-tool.provider.ts   -> WORKFLOWS
```

Tools are *withheld from the model* when the acting role lacks the flag — the model never sees a tool it may not use, rather than being told "no" after asking. Docs confirm: "Agents can only access objects and fields that the user (or role) has permission to view."

### Gaps in our implementation
1. Our 21 agent tools are gated by RLS-through-user-session (good) but there is **no capability-flag layer** — no way to say "this teammate's agent may read but never send".
2. No SAML/OIDC SSO.
3. No impersonation with audit.
4. No field-level permissions.

---

## 6. AI / agentic architecture — the highest-value section

### Server side
`metadata-modules/ai/` splits into: `ai-agent`, `ai-agent-execution`, `ai-agent-monitor`, `ai-agent-role`, `ai-chat`, `ai-billing`, `ai-generate-text`, `ai-models`, `ai-workspace-stats`.

They are on **AI SDK v6** (`ai: 6.0.97`) — same major as ours.

**The loop** (`ai-chat/services/chat-execution.service.ts`, `ai-agent-execution/services/agent-async-executor.service.ts`):
```ts
streamText({ ..., stopWhen: (step) => stepCountIs(AGENT_CONFIG.MAX_STEPS)(step) || ... })
```
with
```ts
AGENT_CONFIG = { MAX_STEPS: 300, REASONING_BUDGET_TOKENS: 12000 }
```

**300 steps.** This is a genuinely long-horizon agent, not a 5-step chat toy. Paired with an *async executor* — turns run detached from the request, so a long build survives the user closing the tab.

**Durable turn persistence** — `ai-agent-execution/entities/`:
- `agent-turn.entity.ts`
- `agent-message.entity.ts`
- `agent-message-part.entity.ts`

Message **parts** are first-class rows, with a `agent-message-part.resolver.ts` streaming them. That is what makes their thinking-steps UI reload-safe: the reasoning trace is persisted data, not ephemeral stream state.

**Tool providers** (9): `action`, `dashboard`, `database`, `logic-function`, `metadata`, `navigation-menu-item`, `view`, `webhook`, `workflow`. Plus `record-crud/` with per-operation Zod schemas (`find-tool`, `find-one-tool`, `group-by-tool`, `delete-tool`, `bulk-delete-tool`) and `to-tool-json-schema.util.ts` which *generates* tool schemas from live object metadata.

Also notable: `output-transforms/compact-tool-output.util.ts` and `strip-empty-values.util.ts` — deliberate token-economy on tool results. And `metrics/` buckets for `tool-execution-duration-ms` and `tool-output-tokens`.

**MCP as a first-class API** (`engine/api/mcp/`) — tools exposed outward with annotations distinguishing `closed-world-read-only`, `open-world-read-only`, and `execute`. Skills are listable (`list-skills.tool.ts`).

### Frontend AI (`twenty-front/src/modules/ai/components/`, ~40 files)
The relevant ones:
- `ThinkingStepsDisplay.tsx`, `ReasoningSummaryDisplay.tsx`, `ToolStepRenderer.tsx` — the "Thought / Loaded Workflow Building / Learning …" trace from the screenshots
- `AiChatEmptyState.tsx`, `AiChatTab.tsx`, `AiChatTabMessageList.tsx`
- `AiChatCompactionIndicator.tsx` — surfaces context compaction to the user
- `AiChatQuestionCard.tsx` / `AiChatQuestionStatusRenderer.tsx` — agent asks the user a question mid-run
- A large family of `*Effect.tsx` files (stream subscription, keep-alive, auto-scroll, parts diff-sync, thread init) — streaming resilience decomposed into single-purpose effects
- `AIChatNoMoreBillingCreditsBanner.tsx`, `AiChatApiKeyNotConfiguredMessage.tsx` — explicit degraded states

### Ours vs theirs
| | Twenty | Ours |
| --- | --- | --- |
| SDK | AI SDK 6 | AI SDK (same major) |
| Max steps | 300 | lower |
| Turn persistence | 3 tables incl. message *parts* | in-flight only |
| Execution | async/detached executor | request-scoped |
| Tool count | 9 providers + generated CRUD | 21 hand-written tools |
| Tool gating | permission flags | user session + RLS |
| Thinking steps | persisted + rendered | **rendered (done last session)** |
| Mid-run questions | yes | no |
| Approval before writes | via permissions | **yes — explicit approval gate** |
| Token economy | compaction + output stripping | partial |
| Multi-provider | model registry | OpenAI/Anthropic/Gemini + LangChain |

We are closer than the gap table suggests, and on one axis — **explicit human approval before any write** — our design is arguably safer than theirs.

---

## 7. UI & design system

### Layout (docs + screenshots)
- **Left sidebar:** workspace switcher (top dropdown), search (`/` focuses), settings top-left, favourites, object shortcuts, workflows. Drag to reorder, folders to group, hide unused.
- **Command menu:** `Cmd+K` — create records, CSV import/export, create views, deleted records, shortcuts.
- **Right side panel:** click a record for a quick overview without leaving the list; "Open" for the full page. Our screenshots show this with `Home / Timeline / Tasks / +4 More` tabs and grouped fields (General / Work / Social / System).
- **Views:** unlimited per object — Table, Kanban, Calendar. Each stores its own filters, sort, field visibility. Shareable or private, favouritable.
- **Record pages:** configurable tabs + widgets on a grid — fields, related records, emails, timeline, tasks, notes, files, charts, iframes.

### Table view specifics worth copying (from screenshots)
- Chip-rendered cells — domains, emails, phones as pills; company avatars with brand colour
- Per-column type icons in the header
- `+` column affordance at the right edge of the header row
- Sticky **aggregate footer**: `Count all 6`, `Empty of Linkedin 100%`, `Not empty of Address 5`, with a `Calculate` dropdown
- `Add New` inline row at the bottom of the data
- Header: `All Companies · 6 ⌄` on the left, `Filter / Sort / Options` on the right, primary `+ New Company` top-right

### Dashboards
Widget = one chart bound to CRM data, configurable by chart type (bar, line, pie, number, gauge, iframe, fields), data source (any object), filters, aggregation (count/sum/avg/min/max), grouping (select fields, dates, relations). Grid layout, resizable, workspace-level sharing, tabs. Charts via **Nivo** (`@nivo/core` 0.99).

### Settings information architecture (from screenshots)
```
User      : Profile, Experience, Accounts > (Emails, Calendars)
Workspace : General, Data model, Layout, Members, Billing, MCP & APIs, Apps, AI
Other     : Community, Support, Documentation, Logout          [Advanced toggle]
```
Nested tree with connector lines, `Advanced` toggle revealing power-user sections, and a persistent close (`X Settings`) — settings is a full-screen mode, not a page.

**Experience settings** = Appearance (Light / Dark / System as visual cards), Language, then Formats: time zone, date format, time format, number format, calendar start day — each showing the resolved `System settings · <value>`.

### Frontend stack notes
React 19, **Jotai** (not Redux/Zustand), Apollo Client 4, XYFlow for the workflow canvas, Nivo for charts, Lingui for i18n, Framer Motion 11. Feature-sliced `src/modules/<domain>/{components,hooks,states,types,utils,graphql}` — the same convention as our `src/features/*`.

---

## 8. Merge plan — recommendation

### Tier 1 — port, high value / low risk
1. **Table view upgrade** — chip cells, column type icons, aggregate footer with `Calculate`, inline `Add New`, `Filter/Sort/Options` header. Pure UI over data we already have.
2. **Dashboard widgets** — donut / bar / line / number widgets on a resizable grid. We have `recharts` + the `charts` skill; Twenty's *widget config model* (type + source + filter + aggregation + grouping) is the part to copy.
3. **Settings IA** — adopt the User / Workspace / Other tree with the `Advanced` toggle, and build the Experience page (appearance cards + format selectors).
4. **Record side panel** — grouped field sections + tabs, opened from any list row.

### Tier 2 — port with adaptation
5. **Permission flags** — introduce a capability-flag layer (`SEND_MESSAGE_TOOL`, `HTTP_REQUEST_TOOL`, `DATA_MODEL`, `AI`, …) with stable UUIDs, and gate both UI and agent tools through it. Highest-value *security* borrow. Keep RLS underneath as defence in depth.
6. **Agent turn persistence** — `agent_turn` / `agent_message` / `agent_message_part` tables so thinking steps and long runs survive reloads. Prerequisite for Tier 3.
7. **Async agent executor** + higher step ceiling — detach long builds from the request.
8. **Token economy** — port the spirit of `compact-tool-output` / `strip-empty-values`.
9. **Mid-run agent questions** — `AiChatQuestionCard` equivalent; complements our approval gate nicely.

### Tier 3 — deliberately NOT porting
- **Schema-per-workspace multi-tenancy** — wrong trade for our SaaS shape (§3). Keep Supabase RLS.
- **Full `flat-*` metadata framework** — enormous; adopt the *pattern* narrowly (layouts, permissions) rather than the framework.
- **App SDK / marketplace / sandboxed front-components** — no user demand for us yet.
- **NestJS/TypeORM server split** — we are Next.js server-first; a second runtime is pure cost.
- **SAML/OIDC** — defer until an enterprise deal actually requires it.

### Sequencing
Tier 1 items are independent and immediately visible — do them first (2, 1, 3, 4). Then 6 → 7 (persistence before async, since async needs somewhere to write). Then 5 as a focused security pass. 8 and 9 opportunistically.

---

## 9. Verified facts quick-reference

| Fact | Value | Source |
| --- | --- | --- |
| Packages | 21 | `ls packages/` |
| Repo size (shallow) | 468 MB | `du -sh` |
| Server framework | NestJS 11.1.24 | `package.json` |
| ORM | TypeORM 0.3.29 (patched) | `package.json` |
| Queues | BullMQ 5.78.0 | `package.json` |
| API surfaces | GraphQL, REST, MCP | `engine/api/` |
| Tenant schema | `workspace_<base36(uuid)>` | `get-workspace-schema-name.util.ts` |
| Agent max steps | 300 | `agent-config.const.ts` |
| Reasoning budget | 12 000 tokens | `agent-config.const.ts` |
| AI SDK | 6.0.97 | `twenty-front/package.json` |
| Permission flags | 14 settings + 12 tool | `PermissionFlagType.ts` |
| Tool providers | 9 | `tool-provider/providers/` |
| Frontend state | Jotai 2.17.1 | `package.json` |
| Charts | Nivo 0.99 | `package.json` |
| Our RLS coverage | 77 tables, 279 policies | `supabase/migrations/*.sql` |
| Our agent tools | 21 | `assistant/lib/tools.ts` |
