# Current `main` vs upstream v0.8

| Area             | Upstream v0.8                        | Current `main`                                                                           | Classification                    |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------- |
| Web runtime      | Next 16 App Router                   | Next 16 App Router                                                                       | Retained                          |
| Backend          | Next routes call Supabase directly   | Direct routes plus Express 5 internal API and `/api/service/*` BFF                       | Added/changed                     |
| Auth             | Supabase email/password              | Supabase email/password, proxy refresh, account membership context                       | Extended                          |
| Tenancy          | Primarily user ownership             | `account_id`, memberships, invitations, owner/admin/agent/viewer roles                   | Changed                           |
| Database history | Earlier core migration set           | Ordered `001`–`040`                                                                      | Extended                          |
| Live DB proof    | Setup instructions                   | Connected baseline not proven                                                            | Blocked                           |
| WhatsApp         | Meta Cloud API                       | Meta remains mature                                                                      | Retained                          |
| Omnichannel      | Not central                          | channel contracts/schema/settings for Meta, Twilio, SMTP, Resend, Gmail, M365            | Added, partial                    |
| Inbox            | WhatsApp realtime shared inbox       | reactions, replies, quick replies, AI, presence, media, channel foundation               | Extended                          |
| Contacts         | contacts/tags/custom fields/import   | account scope, phone dedupe, contact identities                                          | Extended                          |
| Pipelines        | Supabase Kanban                      | legacy + enterprise routes; Supabase, SQLite and demo repositories                       | Changed/mixed                     |
| Broadcasts       | Meta templates/audience/status       | Meta lifecycle plus public API                                                           | Extended; channel-neutral partial |
| Automations      | trigger/action/wait/cron             | same plus account scope and stronger tests                                               | Retained/extended                 |
| Visual flows     | not core upstream snapshot           | graph editor, runs, templates, cron                                                      | Added                             |
| AI               | assistant feature                    | OpenAI/Anthropic BYO config, knowledge, usage, handoff, auto-reply                       | Extended                          |
| Settings         | profile/WhatsApp/templates/tags      | team, keys, AI, security, quick replies, generic channels                                | Extended                          |
| Public API       | documented REST                      | broader `/api/v1`, scoped hashed keys, signed outbound webhooks                          | Extended                          |
| MCP              | absent                               | standalone public-API consumer                                                           | Added                             |
| State            | Supabase + local UI                  | Supabase plus SWR, contexts, editor state, local preferences, demo/SQLite/process caches | Extended/mixed                    |
| Operations       | single application deployment        | supervised web + API processes, probes/logging/BFF                                       | Changed                           |
| Security         | RLS, AES-GCM, Meta HMAC, cron secret | adds key hashing/scopes, signed webhooks, Helmet, request IDs and BFF allowlists         | Extended                          |

## Truth notes

1. “Schema exists in migrations” is not the same as “schema is applied live.”
2. “Provider is in a TypeScript union/registry” is not the same as “provider lifecycle is production-ready.”
3. Demo and SQLite repositories are useful development paths, not substitutes for account-scoped production Supabase persistence.
4. Compatibility URLs are current behavior but not the preferred canonical architecture.
5. Existing `architecture-delta.md` and `enterprise-v1-architecture.md` are valuable historical reports; this document’s commit pin makes it the comparison artifact for this audit.

## Major call-flow differences

```mermaid
flowchart TB
  subgraph Upstream
    UBrowser[Browser] --> UNext[Next route]
    UNext --> USupabase[(Supabase)]
    UMeta[Meta] <--> UNext
  end
  subgraph Current
    CBrowser[Browser] --> CProxy[Next proxy]
    CProxy --> CNext[Next page/API]
    CNext --> CSupabase[(Supabase)]
    CNext --> CBFF[/api/service]
    CBFF --> CExpress[Express API]
    CExpress --> CSupabase
    CMCP[MCP] --> CV1[/api/v1]
    CV1 --> CSupabase
    CProviders[Meta / SMTP / staged providers] <--> CNext
  end
```
