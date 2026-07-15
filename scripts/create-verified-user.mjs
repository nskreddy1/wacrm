import { createClient } from "@supabase/supabase-js"

const email = process.argv[2]
const password = process.argv[3]
if (!email || !password) {
  console.log("[v0] usage: node scripts/create-verified-user.mjs <email> <password>")
  process.exit(1)
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})

if (error) {
  console.log("[v0] create failed:", error.status ?? "", error.code ?? "", error.message)
  process.exit(1)
}

console.log("[v0] created user:", data.user.id, data.user.email, "confirmed:", data.user.email_confirmed_at)
