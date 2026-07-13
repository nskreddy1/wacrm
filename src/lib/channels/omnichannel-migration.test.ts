import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/038_omnichannel_foundation.sql'),
  'utf8',
)

describe('omnichannel migration', () => {
  it('enables RLS on every new tenant table', () => {
    for (const table of [
      'channel_connections',
      'contact_identities',
      'channel_webhook_events',
      'oauth_connection_states',
      'notification_preferences',
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    }
  })

  it('does not grant browser clients access to provider secrets', () => {
    expect(sql).toContain(
      'REVOKE SELECT ON channel_connections FROM anon, authenticated',
    )
    const grant = sql.match(
      /GRANT SELECT \(([\s\S]*?)\) ON channel_connections TO authenticated/,
    )?.[1]
    expect(grant).toBeDefined()
    expect(grant).not.toContain('credentials_encrypted')
    expect(grant).not.toContain('webhook_secret_encrypted')
  })

  it('requires a phone or email for every contact', () => {
    expect(sql).toContain(
      "NULLIF(BTRIM(phone), '') IS NOT NULL OR NULLIF(BTRIM(email), '') IS NOT NULL",
    )
  })

  it('enforces valid provider and channel pairs', () => {
    expect(sql).toContain("channel = 'whatsapp' AND provider IN ('meta', 'twilio')")
    expect(sql).toContain("channel = 'email' AND provider IN ('google', 'resend')")
  })
})
