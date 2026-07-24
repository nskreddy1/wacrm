// ============================================================
// /api/external-sources/[id]
//
//   PATCH  — update name/config/fieldMap; secret is replace-only
//            (send a new one) or cleared with secret: "".
//   DELETE — hard delete (unlike api-keys there's no audit need:
//            a source grants nothing by itself; the secret dies
//            with the row).
//
// Admin+ for both, mirrored by the external_sources RLS policies.
// Every query filters by account_id as belt-and-braces on top of
// RLS so a guessed UUID can never cross accounts.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import {
  isSourceType,
  validateConfig,
  validateFieldMap,
  validateName,
} from '@/features/external-sources/lib/validate';
import type { ExternalSourceType } from '@/features/external-sources/lib/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const LIST_COLUMNS =
  'id, name, type, config, field_map, encrypted_secret, last_tested_at, last_row_count, created_at, updated_at';

function stripSecret<T extends { encrypted_secret?: string | null }>(row: T) {
  const { encrypted_secret, ...rest } = row;
  return { ...rest, has_secret: Boolean(encrypted_secret) };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:externalSourceUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      type?: unknown;
      config?: unknown;
      fieldMap?: unknown;
      secret?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Fetch the existing row first — config validation depends on the
    // (possibly updated) type, and we must not let a type change slip
    // through without a matching config re-validation.
    const { data: existing, error: fetchError } = await ctx.supabase
      .from('external_sources')
      .select('id, type, encrypted_secret')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (fetchError) {
      console.error(
        '[PATCH /api/external-sources/[id]] fetch error:',
        fetchError
      );
      return NextResponse.json(
        { error: 'Failed to load external source' },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'External source not found' },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      const name = validateName(body.name);
      if (!name.ok) {
        return NextResponse.json({ error: name.error }, { status: 400 });
      }
      updates.name = name.value;
    }

    let effectiveType = existing.type as ExternalSourceType;
    if (body.type !== undefined) {
      if (!isSourceType(body.type)) {
        return NextResponse.json(
          { error: "'type' must be 'rest', 'postgres' or 'google_sheet'" },
          { status: 400 }
        );
      }
      effectiveType = body.type;
      updates.type = body.type;
      // Changing type invalidates the old config shape — require one.
      if (body.config === undefined && body.type !== existing.type) {
        return NextResponse.json(
          { error: 'Changing the source type requires a new config' },
          { status: 400 }
        );
      }
    }

    if (body.config !== undefined) {
      const config = validateConfig(effectiveType, body.config);
      if (!config.ok) {
        return NextResponse.json({ error: config.error }, { status: 400 });
      }
      updates.config = config.value;
    }

    if (body.fieldMap !== undefined) {
      const fieldMap = validateFieldMap(body.fieldMap);
      if (!fieldMap.ok) {
        return NextResponse.json({ error: fieldMap.error }, { status: 400 });
      }
      updates.field_map = fieldMap.value;
    }

    if (body.secret !== undefined) {
      if (typeof body.secret !== 'string') {
        return NextResponse.json(
          { error: "'secret' must be a string" },
          { status: 400 }
        );
      }
      const trimmed = body.secret.trim();
      // Empty string clears the secret; non-empty replaces it.
      updates.encrypted_secret = trimmed ? encrypt(trimmed) : null;
    }

    // Postgres sources cannot end up secret-less.
    const finalSecret =
      body.secret !== undefined
        ? (updates.encrypted_secret as string | null)
        : (existing.encrypted_secret as string | null);
    if (effectiveType === 'postgres' && !finalSecret) {
      return NextResponse.json(
        { error: 'Postgres sources need a connection string' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('external_sources')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(LIST_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      console.error('[PATCH /api/external-sources/[id]] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update external source' },
        { status: 500 }
      );
    }

    return NextResponse.json({ source: stripSecret(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:externalSourceDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('external_sources')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/external-sources/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete external source' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'External source not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
