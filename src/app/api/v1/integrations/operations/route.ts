// ============================================================
// GET /api/v1/integrations/operations — list runnable operations
//                                       (scope: integrations:read)
//
// Discovery endpoint: an agent calls this to learn what lookups this
// account has configured, then calls the run endpoint by name.
//
// Deliberately does NOT return `statement`. The SQL is an internal
// implementation detail; exposing it would let a key holder learn the
// shape of the client's schema, and would tempt a model into trying to
// edit it. Name, description, mode and the bound fields are everything
// a caller needs to choose an operation.
// ============================================================

import { requireApiKey } from '@/features/auth/lib/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import type { OperationBinding } from '@/features/integrations/lib/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'integrations:read');

    const { data, error } = await ctx.supabase
      .from('integration_operations')
      .select(
        'id, name, description, mode, requires_confirmation, row_limit, enabled, bindings, integration_connections(name, kind, read_only, enabled)'
      )
      .eq('account_id', ctx.accountId)
      .eq('enabled', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[api/v1/integrations/operations] list error:', error);
      return fail('internal', 'Failed to list operations', 500);
    }

    const rows = (data ?? []) as unknown as {
      id: string;
      name: string;
      description: string | null;
      mode: 'read' | 'write';
      requires_confirmation: boolean;
      row_limit: number;
      bindings: OperationBinding[] | null;
      integration_connections: {
        name: string;
        kind: string;
        read_only: boolean;
        enabled: boolean;
      } | null;
    }[];

    return okList(
      rows
        // An operation whose connection is disabled cannot run, so
        // listing it would only produce a confusing failure later.
        .filter((r) => r.integration_connections?.enabled !== false)
        .map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? '',
          mode: r.mode,
          requires_confirmation: r.requires_confirmation,
          row_limit: r.row_limit,
          connection: r.integration_connections
            ? {
                name: r.integration_connections.name,
                kind: r.integration_connections.kind,
                read_only: r.integration_connections.read_only,
              }
            : null,
          // Tells the caller which contact fields must be present for
          // this operation to run at all.
          requires_contact_fields: (r.bindings ?? []).map((b) => b.source),
        })),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
