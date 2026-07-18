# WACRM Architecture Analysis

## Decision

WACRM should keep both Next.js and Express, but they must not become two competing backends.

- **Next.js** is the browser-facing backend-for-frontend (BFF). It owns cookie-based Supabase sessions, Server Components and Actions, webhooks, lightweight CRUD, and the same-origin `/api/service/*` gateway.
- **Express** is a bounded service tier for reusable domain APIs or workloads that need to scale independently from the web UI. It is not a second copy of every Next.js route.
- **Supabase** remains the system of record for authentication, PostgreSQL, RLS, and realtime data.

The current Express integration is real but intentionally narrow. Browser code calls `/api/service/<path>`. The Next.js route authenticates the Supabase session, forwards an allowlisted request with the access token and request ID to `<EXPRESS_API_URL>/v1/<path>`, and maps upstream timeouts/unavailability to stable gateway errors. Express verifies the bearer token and currently exposes the account domain plus health endpoints.

## Why Express remains useful

Express becomes valuable when a domain needs one or more of the following:

- independent horizontal scaling;
- a stable API shared by web, mobile, or integrations;
- longer request processing than should be coupled to page rendering;
- separate deployment, release, or observability boundaries;
- sustained high-throughput domain traffic.

Express alone does not make Automation or Flow execution durable. At larger scale, web processes should enqueue idempotent jobs and separate workers should execute them. A durable queue/worker, retry policy, dead-letter handling, and idempotency keys are the appropriate next step; moving the same synchronous logic from a Next.js handler into Express is not sufficient.

## Proxy boundary findings and fixes

Verified protections already present:

- same-origin browser endpoint;
- Supabase session requirement before forwarding;
- bearer-token handoff to Express;
- request/response header allowlists;
- 30-second upstream timeout;
- request ID propagation/generation;
- Helmet, JSON body limit, and authorization/cookie log redaction in Express.

This change additionally validates `EXPRESS_API_URL`: only HTTP(S) URLs are accepted and embedded credentials are rejected. Tests cover unsafe schemes and credentials. Production should configure a stable internal HTTPS service URL and deploy Express independently; `API_HOST`/`API_PORT` are local-development fallbacks.

## Automation findings and fixes

### Fixed

- Automation detail reads, updates, and deletes are now scoped by `account_id`, not the authoring `user_id`. This restores account-sharing semantics while preventing service-role cross-tenant access.
- Manual execution now rejects unknown trigger types, malformed `contact_id`, malformed context, and invalid JSON instead of casting arbitrary input into a trigger.
- Active automation edits continue to run trigger and step-tree validation.
- Step replacement now uses a transaction-backed PostgreSQL function. A failed insert rolls back the delete, so an active automation cannot lose its existing steps due to a partial save.
- The atomic function verifies the expected account even though it is invoked through the service-role client, uses `SECURITY INVOKER`, and grants execution only to `service_role`.

### Existing safeguards confirmed

- Trigger dispatch is account-scoped and validates contact ownership before service-role execution.
- Wait steps persist resumable pending executions.
- Execution logs retain step results and failures.
- Execution counters use an atomic SQL increment function.
- Interactive payload validation and webhook SSRF protection exist.
- Keyword, inbound-message, contact, assignment, tag, time, interactive-reply, and manual dispatch types exist in the current code paths.

### Remaining scale work

Automation dispatch is still synchronous/fire-and-forget inside web request lifecycles. Before high-volume production use, add a durable queue, per-event idempotency keys, bounded retries, dead-letter inspection, and worker concurrency controls.

## Flow findings and fixes

### Fixed

- Flow graph saves are now atomic. The flow envelope and optional node replacement execute in one PostgreSQL transaction, so failed node validation or insertion preserves the prior graph.
- The database function checks `flow_id` and `account_id` together and is executable only by `service_role`.
- Editing an active flow now validates the effective merged flow and graph before persistence. Invalid active edits return validation issues; drafts remain intentionally permissive.
- Existing node-key uniqueness, entry-node, edge-reference, node-type, trigger, reachability, and WhatsApp payload rules remain enforced by the shared validator and database constraints.

### Existing safeguards confirmed

- One active run per account/contact is protected by a partial unique index.
- Run-event history supplies message-level idempotency and audit data.
- Run history is bounded to 50 recent runs.
- Timeout and terminal states are represented explicitly.
- RLS uses account membership after migration `017_account_sharing.sql`.

### Remaining scale work

Flow execution still depends on application processes and database polling/cron paths. Large-scale operation should move advancement and timeout work to durable workers while preserving the existing partial unique index and event idempotency checks.

## Database migration

`20260718062514_atomic_automation_flow_saves.sql` adds:

- `replace_automation_steps_atomic`;
- `save_flow_graph_atomic`.

Both functions are `SECURITY INVOKER`, pin `search_path`, verify tenant ownership, revoke default/public execution, and grant only `service_role`. The migration was created using the Supabase CLI migration workflow. It must be applied to the target Supabase project before deploying application code that calls these RPCs.

## Verification status

- Targeted Automation, Flow, and service URL verification passed: 68 tests across 4 files.
- Changed-file ESLint passed with no findings.
- `pnpm typecheck` was run. The changed Automation/Flow/proxy files introduced no reported TypeScript errors, but the repository currently has unrelated pre-existing failures in `src/lib/ai/auto-reply.test.ts` and `src/lib/ai/generate.test.ts` (missing `./model`).
- The full test suite was run; unrelated AI tests remain failing in `auto-reply.test.ts` and `generate.test.ts`. Repository-wide lint also remains blocked by pre-existing React effect and hook findings outside the changed backend files.
- Live schema application and database advisors were not run from this workspace. Apply the migration in the connected Supabase environment, then run advisors and transaction smoke tests before production release.
