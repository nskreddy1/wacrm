import { createClient } from "@supabase/supabase-js"

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Find the test inbound message by provider id prefix
  const { data: inbound, error: inErr } = await db
    .from("messages")
    .select("id, conversation_id, direction, sender_type, body, status, provider_message_id, created_at")
    .like("provider_message_id", "SM_e2e_test_%")
    .order("created_at", { ascending: false })
    .limit(2)
  console.log("[v0] inbound err:", inErr)
  console.log("[v0] inbound test messages:", JSON.stringify(inbound, null, 2))

  const convId = inbound?.[0]?.conversation_id
  if (convId) {
    const { data: msgs } = await db
      .from("messages")
      .select("direction, sender_type, body, status, provider_message_id, created_at")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(5)
    for (const m of msgs ?? []) {
      console.log(
        `[v0] ${m.created_at} | ${m.direction}/${m.sender_type} | status=${m.status} | provider=${m.provider_message_id ?? "-"} | ${String(m.body).slice(0, 140)}`,
      )
    }
    const { data: conv } = await db
      .from("conversations")
      .select("id, ai_reply_count, ai_autoreply_disabled, assigned_agent_id, last_message_at")
      .eq("id", convId)
      .single()
    console.log("[v0] conversation:", JSON.stringify(conv))
  } else {
    console.log("[v0] no inbound test message found — checking webhook_events")
    const { data: events } = await db
      .from("webhook_events")
      .select("id, provider, event_type, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
    console.log("[v0] recent webhook events:", JSON.stringify(events, null, 2))
  }
}

main().catch((e) => {
  console.error("[v0] error:", e)
  process.exit(1)
})
