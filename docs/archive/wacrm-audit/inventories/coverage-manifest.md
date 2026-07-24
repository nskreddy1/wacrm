# Coverage and validation manifest

> Baseline commit: `28cd0f3f7b3f5b106162bf3811abc1d5d99f376b`  
> Audit date: 2026-07-13

## Source-controlled baseline

| Area          | Tracked files before this audit | Documentation coverage                                                                                         |
| ------------- | ------------------------------: | -------------------------------------------------------------------------------------------------------------- |
| `src/`        |                             429 | Architecture, all page/route families, component/domain groups, hooks/stores, methods and security boundaries. |
| `supabase/`   |                              40 | Every migration `001`–`040` represented chronologically with object/capability groups.                         |
| `docs/`       |                              20 | All 15 upstream snapshots indexed; existing local reports compared.                                            |
| `mcp-server/` |                              16 | Runtime, config, API client, read/write/broadcast tools and security gates documented.                         |
| `.github/`    |                              10 | CI/governance/operations classified.                                                                           |
| `server/`     |                               7 | Every Express file and request stage documented.                                                               |
| `public/`     |                               7 | Static assets classified as UI/runtime support.                                                                |
| `scripts/`    |                               1 | Web launcher and port behavior documented.                                                                     |
| `messages/`   |                               1 | English message catalog classified.                                                                            |
| root          |                              20 | Package/config/lock/build/contribution/legal files classified.                                                 |
| **Total**     |                         **551** | Generated/private files intentionally excluded.                                                                |

## Executable surface counts

- 30 page files.
- 12 layout files and 3 loading files.
- 65 route-handler files, including auth callback and BFF handlers.
- 40 SQL migration files.
- Static scan found 346 TypeScript source files with exported symbols across `src`, `server`, and `mcp-server/src`; domain grouping and invocation conventions are in `methods-and-apis.md`.
- 15 upstream Markdown snapshot files.
- This audit adds 9 Markdown reports under `docs/wacrm-audit/`.

## Validation performed

| Check               | Result                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`    | Passed with exit code 0.                                                                                                                                                                                                |
| `pnpm test`         | Passed with exit code 0. Expected stderr from negative-path tests and Node’s experimental SQLite warning were observed.                                                                                                 |
| Git baseline/status | Commit and branch captured before documentation writes.                                                                                                                                                                 |
| Route extraction    | All `page.tsx`, `layout.tsx`, `loading.tsx`, and `route.ts` paths scanned. The service catch-all exports handlers through an alias/pattern not detected by the simple named-method regex, so it is documented manually. |
| Symbol extraction   | Exported functions, values and types scanned from non-test TypeScript source and mapped by domain. Dynamic/local callbacks are covered by owning page/component flow rather than falsely presented as public API.       |
| SQL extraction      | CREATE TABLE/FUNCTION/POLICY/INDEX/TRIGGER and bucket statements scanned in migration order. ALTER-only corrections are represented by migration purpose.                                                               |
| Secret safety       | No environment values read into or written to documentation.                                                                                                                                                            |

## Environment and Supabase finding

The v0 project environment files available to shell validation currently report all checked Supabase names as **not set**, including `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, and publishable-key aliases. Meta/encryption/cron variables are also not set in that environment copy. The Supabase MCP connection visible in v0 is a separate tool connection; it does not automatically prove that this Vercel project has runtime variables or that migrations are applied.

This explains why adding MCP alone cannot fix application signup. The reported 403 “Signup is not allowed” is additionally an Auth policy response from whichever Supabase endpoint was called. Runtime credentials must be synchronized to this exact Vercel project, and Auth signup must be allowed in that same Supabase project.

## Known unknowns / blockers

1. The live target Supabase schema, RLS policies, grants, extensions, buckets and migration table were not proven against repository migrations.
2. Real Meta, Twilio, SMTP, Resend, Gmail and Microsoft provider accounts were not invoked; source maturity labels are not live-delivery certification.
3. No production traffic, scale, latency or multi-instance behavior was measured.
4. SQLite pipeline behavior is covered by tests but is not production Supabase convergence.
5. The audit does not alter old reports; stale branch/file counts in them remain historical evidence.
6. Secrets and raw credential values are intentionally excluded.

## Completion checklist

- [x] Upstream snapshots preserved unchanged and indexed.
- [x] Current report pinned to exact commit/package/date.
- [x] Runtime processes and trust boundaries documented.
- [x] Every page family and API family documented.
- [x] Exported method groups and principal call graphs documented.
- [x] All migration ranges, stores, caches and persistence paths documented.
- [x] All observed environment-variable names and fallback behavior documented.
- [x] Provider maturity separated into implemented/partial/target-only.
- [x] Current-vs-upstream truth matrix completed.
- [x] Typecheck and test suite executed successfully.
