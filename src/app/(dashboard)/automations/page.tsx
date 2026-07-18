import { redirect } from "next/navigation"

/**
 * The Automations list was unified into the Flows page
 * (see docs/superpowers/plans/2026-07-18-unify-automations-into-flows.md).
 * Deep routes (/automations/new, /automations/[id]/edit,
 * /automations/[id]/logs) remain active — only the list moved.
 */
export default function AutomationsPage() {
  redirect("/flows")
}
