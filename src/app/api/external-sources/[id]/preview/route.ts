// ============================================================
// POST /api/external-sources/[id]/preview
//
// "Test connection" — runs the source's fetcher and returns the
// first 5 normalized recipients plus counts, and stamps
// last_tested_at / last_row_count on the row. Any member can
// preview (it exposes 5 rows of data they could already reach by
// sending a broadcast); mutations of the source itself stay admin+.
//
// This is the only place besides /recipients where the secret is
// decrypted, and it never leaves the process.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/features/auth/lib/account';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import {
  ExternalSourceError,
  fetchRecipients,
} from '@/features/external-sources/lib/fetch-recipients';
import type {
  ExternalSourceType,
  FieldMap,
  SourceConfig,
} from '@/features/external-sources/lib/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const PREVIEW_ROWS = 5;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();

    // Previews hit external systems — keep the cadence modest.
    const limit = checkRateLimit(
      `externalSourcePreview:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data: source, error } = await ctx.supabase
      .from('external_sources')
      .select('id, type, config, field_map, encrypted_secret')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[POST …/preview] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load external source' },
        { status: 500 }
      );
    }
    if (!source) {
      return NextResponse.json(
        { error: 'External source not found' },
        { status: 404 }
      );
    }

    let secret: string | null = null;
    if (source.encrypted_secret) {
      try {
        secret = decrypt(source.encrypted_secret);
      } catch (err) {
        console.error('[POST …/preview] decrypt error:', err);
        return NextResponse.json(
          { error: 'Stored credential could not be decrypted — re-save the secret' },
          { status: 500 }
        );
      }
    }

    try {
      const result = await fetchRecipients({
        type: source.type as ExternalSourceType,
        config: source.config as SourceConfig,
        fieldMap: source.field_map as FieldMap,
        secret,
      });

      // Stamp test metadata (best-effort — a failure here shouldn't
      // fail the preview the user is looking at).
      await ctx.supabase
        .from('external_sources')
        .update({
          last_tested_at: new Date().toISOString(),
          last_row_count: result.recipients.length,
        })
        .eq('id', id)
        .eq('account_id', ctx.accountId);

      return NextResponse.json({
        preview: result.recipients.slice(0, PREVIEW_ROWS),
        count: result.recipients.length,
        total: result.total,
        invalid: result.invalid,
        capped: result.capped,
      });
    } catch (err) {
      if (err instanceof ExternalSourceError) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
