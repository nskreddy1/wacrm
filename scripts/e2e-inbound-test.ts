import crypto from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { decrypt } from "../src/lib/whatsapp/encryption"

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // 1. Re-enable AI on the test conversation
  const convId = "358ee89b-480a-4454-b3ce-4ade1642ee0c"
  const { error: upErr } = await db
    .from("conversations")
    .update({ assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 0 })
    .eq("id", convId)
  console.log("[v0] reset conversation flags:", upErr ?? "OK")

  // 2. Get Twilio auth token to sign the webhook like Twilio does
  const { data: conn } = await db
    .from("channel_connections")
    .select("credentials_encrypted")
    .eq("provider", "twilio")
    .maybeSingle()
  const creds = JSON.parse(decrypt(conn!.credentials_encrypted))
  const authToken = creds.value?.authToken ?? creds.authToken

  // 3. Build a signed inbound message webhook (simulating Twilio)
  const url = "https://wacrm-fawn-three.vercel.app/api/channels/webhooks/twilio"
  const sid = "SM_e2e_test_" + Date.now()
  const params: Record<string, string> = {
    MessageSid: sid,
    SmsStatus: "received",
    To: "whatsapp:+14155238886",
    From: "whatsapp:+918328510888",
    ProfileName: "Sunil",
    Body: "Hi! This is an end-to-end test. What can you help me with?",
    NumMedia: "0",
  }
  const sorted = Object.keys(params).sort()
  const payload = sorted.reduce((acc, k) => acc + k + params[k], url)
  const signature = crypto.createHmac("sha1", authToken).update(payload).digest("base64")

  const body = new URLSearchParams(params).toString()
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body,
  })
  console.log("[v0] webhook response:", res.status, await res.text())
  console.log("[v0] test MessageSid:", sid)
}

main().catch((e) => {
  console.error("[v0] error:", e)
  process.exit(1)
})
