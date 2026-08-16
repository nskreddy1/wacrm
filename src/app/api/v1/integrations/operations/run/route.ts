// ============================================================
// POST /api/v1/integrations/operations/run — run one operation
//        (scope: integrations:read, plus integrations:write for a write)
//
// The caller names an operation and a contact. It cannot supply the
// statement, the parameter values, or the connection: those come from
// the stored definition and the contact row. That is the whole point —
// see the identity-binding rationale in the migration and bindings.ts.
//
// Scope model: `integrations:read` authenticates the request, and a
// write-mode operation additionally requires `integrations:write`. So a
// key issued for lookups can never mutate the client's system, even if
// an admin later flips an operation from read to write.
// ============================================================

import { requireApiKey } from '@/features/auth/lib/api-context';
import { hasScope } from '@/features/api-keys/lib/scopes';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import { executeOperation } from '@/features/integrations/lib/execute';
import {
  IntegrationError,
  type BindableContact,
  type IntegrationConnection,
  type IntegrationOperation,
} from '@/features/integrations/lib/types';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'integrations:read');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.operation === 'string' ? body.operation.trim() : '';
    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id.trim() : '';
    const dryRun = body.dry_run === true;

    if (!name) {
      return fail('bad_request', "'operation' is required", 400);
    }
    if (!contactId) {
      return fail(
        'bad_request',
        "'contact_id' is required — an operation always runs against one contact",
        400
      );
    }

    const { data: operationRow } = await ctx.supabase
      .from('integration_operations')
      .select(
        'id, account_id, connection_id, name, description, mode, statement, bindings, expose_to_autoreply, requires_confirmation, row_limit, timeout_ms, enabled'
      )
      .eq('account_id', ctx.accountId)
      .eq('name', name)
      .eq('enabled', true)
      .maybeSingle();

    const operation = operationRow as IntegrationOperation | null;
    if (!operation) {
      return fail('not_found', `No enabled operation named "${name}"`, 404);
    }

    if (
      operation.mode === 'write' &&
      !hasScope(ctx.scopes, 'integrations:write')
    ) {
      return fail(
        'forbidden',
        `"${name}" is a write operation and requires the integrations:write scope`,
        403
      );
    }

    const { data: connectionRow } = await ctx.supabase
      .from('integration_connections')
      .select(
        'id, account_id, name, kind, base_url, read_only, enabled, last_tested_at, last_error, encrypted_secret'
      )
      .eq('account_id', ctx.accountId)
      .eq('id', operation.connection_id)
      .maybeSingle();

    const connection = connectionRow as
      | (IntegrationConnection & { encrypted_secret: string | null })
      | null;
    if (!connection) {
      return fail('not_found', 'Connection for this operation is missing', 404);
    }

    // Scoped by account_id as well as id: the contact must belong to
    // this key's account, or one tenant could look up another's records.
    const { data: contactRow } = await ctx.supabase
      .from('contacts')
      .select('id, account_id, phone, phone_normalized, email, name, company')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const contact = contactRow as BindableContact | null;
    if (!contact) {
      return fail('not_found', 'Contact not found', 404);
    }

    let secret: string | null = null;
    if (connection.encrypted_secret) {
      try {
        secret = decrypt(connection.encrypted_secret);
      } catch {
        return fail(
          'internal',
          'Stored credential for this connection could not be read',
          500
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

    return ok({
      operation: operation.name,
      mode: operation.mode,
      contact_id: contact.id,
      row_count: result.rowCount,
      truncated: result.truncated,
      rolled_back: result.rolledBack,
      rows: result.rows,
    });
  } catch (err) {
    // An IntegrationError is a caller-actionable configuration or data
    // problem ("this contact has no email on record"), not a server
    // fault, so it gets a 400 with the real message rather than an
    // opaque 500 the caller cannot act on.
    if (err instanceof IntegrationError) {
      return fail('bad_request', err.message, 400);
    }
    return toApiErrorResponse(err);
  }
}
