import 'server-only';

import type { AccountContext } from '@/features/auth/lib/account';
import type { Notification } from '@/types';

const selection =
  'id, account_id, user_id, type, title, body, conversation_id, contact_id, actor_user_id, metadata, email_status, email_sent_at, read_at, created_at';

export async function listSupabaseNotifications(
  ctx: AccountContext
): Promise<Notification[]> {
  const { data, error } = await ctx.supabase
    .from('notifications')
    .select(selection)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

export async function markSupabaseNotificationsRead(
  ctx: AccountContext,
  ids?: string[]
): Promise<Notification[]> {
  let query = ctx.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .is('read_at', null);
  if (ids?.length) query = query.in('id', ids);
  const { error } = await query;
  if (error) throw new Error(error.message);
  return listSupabaseNotifications(ctx);
}
