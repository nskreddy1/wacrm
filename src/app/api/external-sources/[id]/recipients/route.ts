// ============================================================
// POST /api/external-sources/[id]/recipients
//
// Full fetch for broadcast sending: returns every normalized
// recipient (≤ EXTERNAL_FETCH_CAP). When the source holds more rows
// than the cap we REJECT with 422 rather than silently sending a
// partial audience — the user must filter at the source (query
// params / SQL WHERE / sheet ranges) or split into segments.
//
// Member-level access (same as sending a broadcast). The decrypted
// secret never leaves this process.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/features/auth/lib/account';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import {
  ExternalSourceError,
  fetchRecipients,
} from '@/features/external-sources/lib/fetch-recipients';
import {
  EXTERNAL_FETCH_CAP,
  type ExternalSourceType,
  type FieldMap,
  type SourceConfig,
} from '@/features/external-sources/lib/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();

    // Same cadence as starting broadcasts — this endpoint is only
    // called at send time.
    const limit = checkRateLimit(
      `externalSourceRecipients:${ctx.userId}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data: source, error } = await ctx.supabase
      .from('external_sources')
      .select('id, name, type, config, field_map, encrypted_secret')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[POST …/recipients] fetch error:', error);
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
        console.error('[POST …/recipients] decrypt error:', err);
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

      if (result.capped) {
        return NextResponse.json(
          {
            error:
              `This source returned more than ${EXTERNAL_FETCH_CAP.toLocaleString()} rows. ` +
              'Filter at the source (query parameters, SQL WHERE, or a smaller sheet range) ' +
              'or split the audience into segments, then try again.',
            capped: true,
            total: result.total,
          },
          { status: 422 }
        );
      }

      return NextResponse.json({
        sourceName: source.name,
        recipients: result.recipients,
        count: result.recipients.length,
        invalid: result.invalid,
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
