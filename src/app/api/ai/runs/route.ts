import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';

/** Allowed values for the ?mode= filter — mirrors ai_usage_log.mode. */
const RUN_MODES = new Set(['auto_reply', 'draft']);

/**
 * GET /api/ai/runs?limit=25&mode=auto_reply  (admin+)
 *
 * Recent individual AI runs for the Run History tab — one row per
 * provider call from `ai_usage_log`, newest first. Same admin-only
 * visibility as /api/ai/usage (spend is billing-class).
 *
 * `mode` scopes the list to one agent surface: `auto_reply` for the
 * Auto-Reply Agent, `draft` for the Support Copilot. Omitted → all runs.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(100, Math.floor(rawLimit))
        : 25;
    const mode = url.searchParams.get('mode');

    let query = supabase
      .from('ai_usage_log')
      .select(
        'id, conversation_id, mode, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at'
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (mode && RUN_MODES.has(mode)) {
      query = query.eq('mode', mode);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[ai/runs GET] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load runs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
