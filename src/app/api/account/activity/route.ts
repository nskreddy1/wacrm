import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';

/**
 * Workspace audit trail — read side.
 *
 * Admin+ only (enforced twice: `requireRole('admin')` here AND the
 * SELECT RLS policy on audit_events). Cursor-paginated by created_at
 * so the Activity panel can "Load more" without offset drift when new
 * events arrive between pages.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100)
      : 50;
    const before = url.searchParams.get('before');

    let query = supabase
      .from('audit_events')
      .select('id, actor_id, actor_label, action, entity, meta, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    // Cursor: strictly older than the last row the client has.
    if (before) {
      const cursor = new Date(before);
      if (!Number.isNaN(cursor.getTime()))
        query = query.lt('created_at', cursor.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error('[account/activity] query failed:', error);
      return NextResponse.json(
        { error: 'Failed to load activity' },
        { status: 500 }
      );
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;

    // Resolve actor display names for rows without a denormalized
    // label (single IN query, not N+1).
    const unlabeled = Array.from(
      new Set(
        events
          .filter((event) => !event.actor_label && event.actor_id)
          .map((event) => event.actor_id as string)
      )
    );
    let names = new Map<string, string>();
    if (unlabeled.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .eq('account_id', accountId)
        .in('user_id', unlabeled);
      names = new Map(
        (profiles ?? []).map((profile) => [
          profile.user_id as string,
          (profile.full_name as string) ||
            (profile.email as string) ||
            'Unknown member',
        ])
      );
    }

    return NextResponse.json({
      events: events.map((event) => ({
        id: event.id,
        actor:
          event.actor_label ??
          names.get(event.actor_id as string) ??
          'Unknown member',
        action: event.action,
        entity: event.entity,
        meta: event.meta ?? null,
        created_at: event.created_at,
      })),
      has_more: hasMore,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
