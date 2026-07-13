import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const projectRoot = process.cwd()
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations')
const connectionString =
  process.env.SUPABASE_DB_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL

if (!connectionString) {
  console.error(
    'Missing SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL. Set one to the Supabase Postgres connection string.',
  )
  process.exit(1)
}

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))

if (migrationFiles.length === 0) {
  console.error(`No SQL migrations found in ${migrationsDirectory}`)
  process.exit(1)
}

const isLocalDatabase = /localhost|127\.0\.0\.1/.test(connectionString)
const normalizedConnectionString = new URL(connectionString)

// Supabase pooler certificates can include a managed self-signed chain.
// Remove URL-level sslmode so this explicit pg TLS configuration takes effect.
if (!isLocalDatabase) normalizedConnectionString.searchParams.delete('sslmode')

const client = new Client({
  connectionString: normalizedConnectionString.toString(),
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
})

try {
  await client.connect()
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS wacrm_internal;
    CREATE TABLE IF NOT EXISTS wacrm_internal.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const { rows } = await client.query(
    'SELECT filename, checksum FROM wacrm_internal.schema_migrations',
  )
  const applied = new Map(rows.map(({ filename, checksum }) => [filename, checksum]))

  let appliedCount = 0

  for (const filename of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previousChecksum = applied.get(filename)

    if (previousChecksum === checksum) {
      console.log(`skip  ${filename}`)
      continue
    }

    if (previousChecksum) {
      throw new Error(
        `${filename} changed after it was applied. Add a new migration instead of editing migration history.`,
      )
    }

    console.log(`apply ${filename}`)
    await client.query('BEGIN')

    try {
      await client.query(sql)
      await client.query(
        `INSERT INTO wacrm_internal.schema_migrations (filename, checksum)
         VALUES ($1, $2)`,
        [filename, checksum],
      )
      await client.query('COMMIT')
      appliedCount += 1
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${filename} failed`, { cause: error })
    }
  }

  console.log(
    `Schema is current: ${migrationFiles.length} migrations found, ${appliedCount} applied.`,
  )
} catch (error) {
  console.error(error)
  if (error.cause) console.error(error.cause)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
