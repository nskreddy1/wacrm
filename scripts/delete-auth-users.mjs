import { createClient } from "@supabase/supabase-js"

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (error) {
  console.error("[v0] failed to list users:", error.message)
  process.exit(1)
}

console.log(`[v0] found ${data.users.length} auth user(s)`)
for (const user of data.users) {
  const { error: delErr } = await db.auth.admin.deleteUser(user.id)
  console.log(
    `[v0] delete ${user.email ?? user.id}:`,
    delErr ? `${delErr.status ?? ""} ${delErr.code ?? ""} ${delErr.message ?? JSON.stringify(delErr)}` : "OK",
  )
}

const { data: after } = await db.auth.admin.listUsers({ page: 1, perPage: 10 })
console.log(`[v0] remaining auth users: ${after?.users.length ?? "unknown"}`)
