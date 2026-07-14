#!/usr/bin/env node
/**
 * Backfill workspace defaults for EXISTING accounts.
 *
 * New accounts are provisioned automatically by the signup trigger
 * (migration 042). This script covers accounts created before the
 * migration — and can be safely re-run any time (e.g. after adding a
 * new default template): the account_provisioned_templates log makes
 * every re-run a no-op for already-provisioned templates.
 *
 * Usage:
 *   node --env-file=.env.development.local scripts/provision-default-workspaces.mjs [--dry-run]
 */

import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

function getConnectionString() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!raw) {
    console.error(
      "Missing POSTGRES_URL. Run with: node --env-file=.env.development.local scripts/provision-default-workspaces.mjs",
    );
    process.exit(1);
  }
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  return url.toString();
}

async function main() {
  const client = new pg.Client({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: templates } = await client.query(
      "SELECT slug, kind FROM workspace_templates WHERE is_default AND is_active ORDER BY created_at",
    );
    console.log(
      `Default templates in catalog: ${templates.length} (${templates.map((t) => t.slug).join(", ")})`,
    );
    if (templates.length === 0) {
      console.log("Nothing to provision — is migration 042 applied?");
      return;
    }

    // Accounts and how many default templates each still needs.
    const { rows: accounts } = await client.query(`
      SELECT a.id, a.name, a.owner_user_id,
             (SELECT COUNT(*) FROM workspace_templates wt
               WHERE wt.is_default AND wt.is_active
                 AND NOT EXISTS (
                   SELECT 1 FROM account_provisioned_templates apt
                   WHERE apt.account_id = a.id AND apt.template_id = wt.id
                 )) AS pending
      FROM accounts a
      ORDER BY a.created_at
    `);

    let scanned = 0;
    let applied = 0;
    let skipped = 0;

    for (const account of accounts) {
      scanned += 1;
      const pending = Number(account.pending);
      if (pending === 0) {
        skipped += 1;
        continue;
      }
      if (DRY_RUN) {
        console.log(
          `[dry-run] would provision ${pending} template(s) for "${account.name}" (${account.id})`,
        );
        applied += pending;
        continue;
      }
      const { rows } = await client.query(
        "SELECT provision_account_defaults($1, $2) AS applied",
        [account.id, account.owner_user_id],
      );
      const count = Number(rows[0].applied);
      applied += count;
      console.log(
        `Provisioned ${count} template(s) for "${account.name}" (${account.id})`,
      );
    }

    console.log("---");
    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}Accounts scanned: ${scanned}, templates ${
        DRY_RUN ? "to apply" : "applied"
      }: ${applied}, accounts already up to date: ${skipped}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
