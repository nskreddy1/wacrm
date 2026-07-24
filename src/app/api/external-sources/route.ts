// ============================================================
// /api/external-sources
//
//   GET  — list this account's external sources (no secrets).
//   POST — create a source; optional secret is encrypted at rest.
//
// Mirrors the api-keys dashboard endpoints: cookie session auth via
// the RLS client, viewer+ can list, admin+ mutates (enforced here
// AND by the external_sources RLS policies). The secret (bearer
// token / pg connection string) is write-only — GET exposes only a
// `has_secret` boolean derived server-side.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import {
  isSourceType,
  validateConfig,
  validateFieldMap,
  validateName,
} from '@/features/external-sources/lib/validate';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// `encrypted_secret` is selected only to derive `has_secret`; the
// raw value is stripped before the response leaves the server.
const LIST_COLUMNS =
  'id, name, type, config, field_map, encrypted_secret, last_tested_at, last_row_count, created_at, updated_at';

function stripSecret<T extends { encrypted_secret?: string | null }>(row: T) {
  const { encrypted_secret, ...rest } = row;
  return { ...rest, has_secret: Boolean(encrypted_secret) };
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('external_sources')
      .select(LIST_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/external-sources] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load external sources' },
        { status: 500 }
      );
    }

    return NextResponse.json({ sources: (data ?? []).map(stripSecret) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:externalSourceCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      type?: unknown;
      config?: unknown;
      fieldMap?: unknown;
      secret?: unknown;
    } | null;

    const name = validateName(body?.name);
    if (!name.ok) {
      return NextResponse.json({ error: name.error }, { status: 400 });
    }

    if (!isSourceType(body?.type)) {
      return NextResponse.json(
        { error: "'type' must be 'rest', 'postgres' or 'google_sheet'" },
        { status: 400 }
      );
    }

    const config = validateConfig(body.type, body?.config);
    if (!config.ok) {
      return NextResponse.json({ error: config.error }, { status: 400 });
    }

    const fieldMap = validateFieldMap(body?.fieldMap);
    if (!fieldMap.ok) {
      return NextResponse.json({ error: fieldMap.error }, { status: 400 });
    }

    const rawSecret =
      typeof body?.secret === 'string' && body.secret.trim()
        ? body.secret.trim()
        : null;

    if (body.type === 'postgres' && !rawSecret) {
      return NextResponse.json(
        { error: 'Postgres sources need a connection string' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('external_sources')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name: name.value,
        type: body.type,
        config: config.value,
        field_map: fieldMap.value,
        encrypted_secret: rawSecret ? encrypt(rawSecret) : null,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/external-sources] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create external source' },
        { status: 500 }
      );
    }

    return NextResponse.json({ source: stripSecret(data) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
