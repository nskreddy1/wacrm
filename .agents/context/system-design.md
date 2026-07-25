# System Design

## What this is

Multi-tenant WhatsApp/SMS/Email messaging CRM ("wacrm") with an
AI-agent-first angle: shared team inboxes, contacts/pipelines,
broadcasts, workflow automation, AI reply agents, and a platform
admin console — competing with Wati, respond.io, Zoko.

## Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript
- **UI**: Tailwind v4, shadcn/ui (Base UI variant — `@base-ui/react`), lucide-react, recharts, motion, sonner
- **Data**: Supabase (Postgres + Auth + RLS + Realtime), raw SQL migrations in `supabase/migrations/`, NO ORM
- **AI**: Vercel AI SDK (`ai`) + LangChain adapters (Anthropic/OpenAI/Google), MCP server via `mcp-handler` at `/api/mcp`
- **Messaging providers**: Meta Cloud API (WhatsApp), Twilio (WhatsApp/SMS), Resend/SMTP/Mailtrap (email via nodemailer)
- **i18n**: next-intl, strings in `messages/en.json` (~2000 lines)
- **State**: SWR everywhere for client fetching; no Redux/Zustand
- **Testing**: vitest (`pnpm exec vitest run`); typecheck with `pnpm exec tsc --noEmit`

## Project structure

```
src/
  app/
    (auth)/            login, signup, forgot/reset password
    (dashboard)/       all product pages (sidebar shell)
      admin/(console)/ admin console tabs: workspaces, tickets, channels, ai-agent, platform
      admin/providers/ standalone Providers page (own sidebar entry, NOT a console tab)
      inbox/ contacts/ pipelines/ broadcasts/ flows/ templates/ agents/ ...
    api/               see api-routes.md
  features/<domain>/   components + hooks + lib per domain (admin, inbox, contacts, ...)
  components/ui/       shadcn primitives (chart.tsx is CUSTOM, not stock shadcn)
  components/layout/   app-sidebar.tsx (main nav), header, etc.
  lib/                 supabase clients, rate-limit, routing, utils
supabase/migrations/   ordered SQL; applied via scripts/push-supabase-schema.mjs
```

## Key architectural decisions

1. **Tenancy**: every domain table has `account_id`. RLS enforces
   membership via `is_account_member()` SQL helper. Service-role
   client (`channelAdmin()`) bypasses RLS — every use MUST manually
   scope by `account_id`.
2. **Roles**: workspace roles (owner/admin/member + custom profiles
   with permissions) + platform-level super admin (`isSuperAdmin`,
   gated by `requireSuperAdmin()` / `platform_admins` check).
3. **Channel abstraction**: `createChannelAdapter(provider, channel)`
   in `src/features/channels/` — one adapter per provider×channel.
   Connections live in `channel_connections` (credentials encrypted
   AES-256-GCM via `src/features/whatsapp/lib/encryption.ts`).
4. **Provider policy layer**: `platform_provider_policies` — platform
   operators can withdraw a provider from the catalog; enforced at
   connection-save time in `/api/settings/channels`.
5. **Login security**: custom gated login route
   (`/api/v1/security/login`) wraps Supabase password auth with
   attempt tracking (`login_attempts`), lockout
   (5 fails → `account_lockouts`), and geo capture (Vercel
   `x-vercel-ip-*` headers). Devices tracked in `auth_devices`;
   "sign out everywhere" deletes `auth.sessions` rows via
   `admin_revoke_all_auth_sessions` RPC (refresh-token blacklist).
6. **Workflows**: unified `flows` tables + cron route
   (`/api/flows/cron`) + event ingestion (`/api/flows/events`).
7. **Audit**: `tenant_audit_events` for workspace actions; admin
   console actions audited via `/api/admin/audit`.

## Design system conventions

- Settings pages: split label/content cards, section side rails with
  anchor links ("sidecar" pattern — see `/settings?section=security`
  and `/admin/providers`).
- Follow `.agents/skills/emil-design-eng/SKILL.md`: 4px spacing grid,
  padding on every page shell (`p-4 md:p-6`), max-width containers
  (`max-w-6xl` list pages, `max-w-3xl` settings), borders on cards,
  `ease-out` transitions under 200ms, no gratuitous animation.
- Enterprise tone: no explanatory paragraphs under page titles; short
  one-line helper text only where a decision is being made.
- Colors via design tokens only (`bg-background`, `text-foreground`,
  `var(--chart-N)`); never raw white/black.
