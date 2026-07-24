import { channelAdmin } from '@/features/channels/lib/admin-client';
import {
  decryptProviderCredentials,
  type TwilioCredentials,
} from '@/features/channels/lib/credentials';
import type { ChannelConnection } from '@/types';

// ============================================================
// Account-level Twilio credential resolution.
//
// A Twilio Account SID + Auth Token is ACCOUNT-scoped, not
// channel-scoped: the same credentials drive SMS sends, WhatsApp
// senders, and the Content API (Twilio docs: /docs/content — the
// Content API is authenticated with the account credentials and
// its templates are usable across channels).
//
// Historically we only looked at the row matching the exact
// channel, so a tenant who connected Twilio for SMS couldn't
// submit WhatsApp templates (and vice versa) even though the
// credentials were sitting right there. This resolver fixes that
// inconsistency: prefer the requested channel's connection, then
// fall back to ANY enabled Twilio connection on the account.
// ============================================================

export interface ResolvedTwilio {
  credentials: TwilioCredentials;
  /** The connection row the credentials came from. */
  connection: ChannelConnection;
  /** True when we fell back to a different channel's connection. */
  borrowedFromChannel: string | null;
}

/**
 * Resolve Twilio credentials for an account, preferring the
 * connection for `preferChannel` but falling back to any enabled
 * Twilio connection (same account credentials serve all channels).
 *
 * Throws with an actionable message when no Twilio connection
 * exists at all.
 */
export async function resolveTwilioCredentials(
  accountId: string,
  preferChannel: 'whatsapp' | 'sms'
): Promise<ResolvedTwilio> {
  const { data, error } = await channelAdmin()
    .from('channel_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'twilio')
    .eq('is_enabled', true)
    .order('is_primary', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as (ChannelConnection & {
    credentials_encrypted?: string;
  })[];
  if (rows.length === 0) {
    throw new Error(
      'No Twilio connection found. Connect Twilio (WhatsApp or SMS) in Settings → Channels first — one Twilio account powers both.'
    );
  }

  // Preferred channel first, then primary-ordered fallback.
  const preferred = rows.find((r) => r.channel === preferChannel);
  const chosen = preferred ?? rows[0];

  const credentials = decryptProviderCredentials(chosen);
  if (credentials.provider !== 'twilio') {
    throw new Error('Twilio credentials are unavailable.');
  }

  return {
    credentials: credentials.value,
    connection: chosen,
    borrowedFromChannel:
      chosen.channel === preferChannel ? null : chosen.channel,
  };
}
