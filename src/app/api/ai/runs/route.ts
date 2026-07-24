import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';

/**
 * GET /api/ai/runs?limit=25  (admin+)
 *
 * Recent individual AI runs for the Run History tab — one row per
 * provider call from `ai_usage_log`, newest first. Same admin-only
 * visibility as /api/ai/usage (spend is billing-class).
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

    const { data, error } = await supabase
      .from('ai_usage_log')
      .select(
        'id, conversation_id, mode, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at'
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

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
