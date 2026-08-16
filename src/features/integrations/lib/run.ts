// ============================================================
// runNamedOperation — the single entry point for invoking a published
// integration operation.
//
// Every caller goes through here: the public API route, the assistant
// tools, and (phase 3) the Flows node. Sharing one path matters more
// than the small amount of code it saves, because this function is
// where the security decisions live:
//
//   - the operation is looked up BY NAME, scoped to the account, and
//     must be `enabled`;
//   - the contact is re-read scoped to the same account, so one tenant
//     can never name another tenant's contact id;
//   - write mode requires the caller to pass `allowWrite`, which the
//     transports only set once they have proved the right scope /
//     approval;
//   - parameter values come from the contact row via bindings.ts, never
//     from the caller.
//
// If any of those move into the callers, they will drift apart and one
// of them will end up being the weak one.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import { executeOperation } from './execute';
import {
  IntegrationError,
  type BindableContact,
  type IntegrationConnection,
  type IntegrationOperation,
} from './types';

const OPERATION_COLUMNS =
  'id, account_id, connection_id, name, description, mode, statement, bindings, expose_to_autoreply, requires_confirmation, row_limit, timeout_ms, enabled';

const CONNECTION_COLUMNS =
  'id, account_id, name, kind, base_url, read_only, enabled, last_tested_at, last_error, encrypted_secret';

const CONTACT_COLUMNS =
  'id, account_id, phone, phone_normalized, email, name, company';

export interface RunNamedOperationArgs {
  db: SupabaseClient;
  accountId: string;
  /** Operation `name` (the stable key admins publish), not its id. */
  name: string;
  contactId: string;
  dryRun?: boolean;
  /**
   * Whether this caller is permitted to run a write-mode operation.
   * Defaults to false so a new transport is read-only until it opts in
   * deliberately — the safe direction to fail.
   */
  allowWrite?: boolean;
}

export interface RunNamedOperationResult {
  operation: string;
  mode: 'read' | 'write';
  contactId: string;
  rowCount: number;
  truncated: boolean;
  rolledBack: boolean;
  rows: Array<Record<string, unknown>>;
}

export async function runNamedOperation(
  args: RunNamedOperationArgs
): Promise<RunNamedOperationResult> {
  const { db, accountId, name, contactId, dryRun = false } = args;
  const allowWrite = args.allowWrite === true;

  const { data: operationRow } = await db
    .from('integration_operations')
    .select(OPERATION_COLUMNS)
    .eq('account_id', accountId)
    .eq('name', name)
    .eq('enabled', true)
    .maybeSingle();

  const operation = operationRow as IntegrationOperation | null;
  if (!operation) {
    throw new IntegrationError(`No enabled operation named "${name}"`);
  }

  if (operation.mode === 'write' && !allowWrite) {
    throw new IntegrationError(
      `"${name}" is a write operation and this caller is not permitted to run writes`
    );
  }

  const { data: connectionRow } = await db
    .from('integration_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .eq('id', operation.connection_id)
    .maybeSingle();

  const connection = connectionRow as
    | (IntegrationConnection & { encrypted_secret: string | null })
    | null;
  if (!connection) {
    throw new IntegrationError('Connection for this operation is missing');
  }

  // Scoped by account_id as well as id: without that, a caller could
  // name any contact uuid in the database and read their records.
  const { data: contactRow } = await db
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  const contact = contactRow as BindableContact | null;
  if (!contact) {
    throw new IntegrationError('Contact not found');
  }

  let secret: string | null = null;
  if (connection.encrypted_secret) {
    try {
      secret = decrypt(connection.encrypted_secret);
    } catch {
      throw new IntegrationError(
        'Stored credential for this connection could not be read'
      );
    }
  }

  const result = await executeOperation({
    connection,
    operation,
    contact,
    secret,
    dryRun,
  });

  return {
    operation: operation.name,
    mode: operation.mode,
    contactId: contact.id,
    rowCount: result.rowCount,
    truncated: result.truncated,
    rolledBack: result.rolledBack,
    rows: result.rows,
  };
}
