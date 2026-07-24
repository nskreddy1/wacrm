# Phase 2 — Sidebar Real Data + Grouped Navigation (DONE)

`src/components/layout/sidebar.tsx` currently hardcodes "Sam Silva",
"sam@relaycrm.demo", "Acme Support", and a fake `badge: "18"` on Inbox.
`useAuth()` already exposes real `profile` + `account`, and
`/api/v1/workspace/inbox/summary` already returns unread counts.

## Work items

1. Brand block: replace "Acme Support" with `account.name` (skeleton while loading).
2. Account menu: real `profile.full_name`, `profile.email`, computed initials,
   real role label (`accountRole`), "Sign out" without the word "demo".
3. Inbox badge: real unread count via SWR from `/api/v1/workspace/inbox/summary`
   (hide when 0; revalidate on focus/interval).
4. Grouping (visible labels when expanded, keep current visual style):
   - **Engage**: Pipelines, Inbox, Contacts, Bookings
   - **Automate**: Broadcasts, Automations, Flows, AI agents
   - **Insights**: Dashboard
5. Apply the same changes to the mobile panel variant in the same file.

## Verification

Load the app signed in → sidebar shows real name/account/role and live unread
count; badge hidden at 0; groups render only when expanded.
