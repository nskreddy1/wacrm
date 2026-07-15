import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import pg from "pg"

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations")
const files = (await readdir(migrationsDirectory)).filter((f) => /^\d+.*\.sql$/.test(f)).sort()

const cs = new URL(process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL)
cs.searchParams.delete("sslmode")
const client = new pg.Client({ connectionString: cs.toString(), ssl: { rejectUnauthorized: false } })
await client.connect()

await client.query("CREATE SCHEMA IF NOT EXISTS wacrm_internal")
await client.query(
  "CREATE TABLE IF NOT EXISTS wacrm_internal.schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
)
for (const f of files) {
  const sql = await readFile(path.join(migrationsDirectory, f), "utf8")
  const checksum = createHash("sha256").update(sql).digest("hex")
  await client.query(
    "INSERT INTO wacrm_internal.schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [f, checksum],
  )
}
const { rows } = await client.query("SELECT count(*)::int AS n FROM wacrm_internal.schema_migrations")
console.log("[v0] tracker restored:", rows[0].n, "migrations recorded of", files.length, "files")

await client.end()
