# WACRM source audit: upstream v0.8 vs current `main`

> Audit date: 2026-07-13  
> Current commit: `28cd0f3f7b3f5b106162bf3811abc1d5d99f376b`  
> Branch at audit: `main`  
> Package: `wacrm@0.8.0`  
> Scope: all 551 Git-tracked files; generated/private directories excluded.

## Purpose

This is the pinned, source-linked documentation set for WACRM. It separates the preserved upstream documentation snapshot from executable behavior in the current repository. It does not modify product code or reinterpret target-state claims as completed implementation.

## Evidence and status legend

Evidence is ranked: live connected Supabase schema/RLS, ordered SQL migrations, executable source and tests, current local reports, then upstream snapshots. At audit time the connected Supabase state could not be proven as containing the repository baseline; migrations `001`–`040` therefore describe repository intent until applied and checked live.

| Status        | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Implemented   | Executable source exists and the flow is wired.                                                  |
| Partial       | Some contracts/UI/adapter code exists, but the end-to-end lifecycle is incomplete or unverified. |
| Demo/mock     | Process-local, seeded, SQLite, or test-oriented behavior; not production authority.              |
| Compatibility | Retained to support older URLs or data shapes.                                                   |
| Target-only   | Described or typed, but not operational end-to-end.                                              |
| Blocked       | Cannot be verified from the available repository/integration state.                              |

## Documentation map

1. [Upstream v0.8 index](upstream-v0.8/README.md) — interpretation of every preserved snapshot.
2. [Current architecture](current-main/architecture.md) — runtime topology, boundaries, processes, domains and provider maturity.
3. [Pages and user flows](current-main/pages-and-flows.md) — every page family, route ownership and user-facing flow.
4. [Methods, APIs and call graphs](current-main/methods-and-apis.md) — method responsibilities, endpoint families and invocation paths.
5. [Data, security and stores](current-main/data-security-stores.md) — migrations, RLS, persistence, cache and trust boundaries.
6. [Configuration and pinning](current-main/configuration-and-operations.md) — env names, consumers, dependency pins, runtime and operations.
7. [Current vs upstream matrix](comparison/current-vs-upstream.md) — retained, changed, added, partial and target-only capabilities.
8. [Coverage manifest](inventories/coverage-manifest.md) — counts, source areas, known unknowns and verification results.

## System in one diagram

```mermaid
flowchart LR
  Browser -->|same origin| Next[Next.js 16 App Router]
  Next -->|cookie session / RLS| Supabase[(Supabase Auth + Postgres + Storage + Realtime)]
  Next -->|/api/service/* + bearer + request id| Express[Express 5 internal API]
  Express --> Supabase
  Meta[Meta Cloud API] -->|signed webhook| Next
  Next --> Meta
  MCP[MCP server] -->|scoped API key| PublicAPI[/api/v1]
  PublicAPI --> Supabase
  Next --> Providers[SMTP / Resend / Twilio boundaries]
```

## Audit constraints

Secret values are intentionally never copied. Environment-variable names, precedence and consumers are documented. External provider behavior and a live migrated Supabase schema cannot be asserted solely from source; those facts are labeled unverified rather than guessed.
