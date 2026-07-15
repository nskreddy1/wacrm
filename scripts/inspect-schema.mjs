import { createClient } from "@supabase/supabase-js"

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

for (const t of ["messages", "conversations", "contacts", "webhook_events", "channel_connections"]) {
  const { data, error } = await db.from(t).select("*").limit(1)
  if (error) {
    console.log(`[v0] ${t}: ERROR ${error.message}`)
  } else if (!data || data.length === 0) {
    console.log(`[v0] ${t}: exists but empty`)
  } else {
    console.log(`[v0] ${t} columns:`, Object.keys(data[0]).join(", "))
  }
}
