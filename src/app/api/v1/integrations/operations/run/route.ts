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
import { runNamedOperation } from '@/features/integrations/lib/run';
import { IntegrationError } from '@/features/integrations/lib/types';

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

    const result = await runNamedOperation({
      db: ctx.supabase,
      accountId: ctx.accountId,
      name,
      contactId,
      dryRun,
      // A write-mode operation needs the stronger scope. Resolved here
      // rather than inside the runner so the HTTP transport owns its own
      // authorization decision.
      allowWrite: hasScope(ctx.scopes, 'integrations:write'),
    });

    return ok({
      operation: result.operation,
      mode: result.mode,
      contact_id: result.contactId,
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
