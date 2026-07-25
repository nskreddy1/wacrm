# wacrm — Agent Context Pack

Read this folder before doing any feature work. It is the handoff from
previous build sessions. Keep it updated when you change architecture,
routes, schema, or security posture.

| File | What it covers |
| --- | --- |
| `system-design.md` | Tech stack, project structure, feature map, system design |
| `database.md` | Schema domains, key tables, RLS model, migration conventions |
| `api-routes.md` | Every API namespace, its auth gate, and conventions |
| `security.md` | Security architecture, review checklist, known patterns |
| `roadmap.md` | Ranked problems, pre-production checklist, competitive feature gaps |

Also mandatory reading:
- `.agents/skills/` — installed skill library (security-review, emil-design-eng, etc.). Team memory says: check for a relevant skill before ANY feature work.
- `v0_memories/team/crm-strategy.md` — product strategy (EspoCRM analysis, "AI-agent-first messaging CRM" positioning).

Product motto: **make user work simple.**
