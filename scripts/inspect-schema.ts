import { Client } from "pg"

const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING })
await client.connect()

const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
)
console.log("[v0] tables:", tables.rows.map((r) => r.table_name).join(", "))

for (const t of ["messages", "conversations", "webhook_events"]) {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t],
  )
  console.log(`[v0] ${t}:`, cols.rows.map((r) => r.column_name).join(", "))
}

await client.end()
