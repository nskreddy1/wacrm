import { createClient } from "@supabase/supabase-js"

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const email = process.argv[2] ?? "v0-shell-test@example.com"

const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (error) {
  console.log("[v0] listUsers error:", error.message)
  process.exit(1)
}

const user = data.users.find((u) => u.email === email)
if (!user) {
  console.log("[v0] user not found:", email)
  process.exit(1)
}

const { data: updated, error: upErr } = await db.auth.admin.updateUserById(user.id, {
  email_confirm: true,
})

if (upErr) {
  console.log("[v0] update error:", upErr.message)
  process.exit(1)
}

console.log("[v0] user:", updated.user.email)
console.log("[v0] email_confirmed_at:", updated.user.email_confirmed_at)
