import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/features/auth/lib/account';

// ============================================================
// Sendable templates for one conversation.
//
// The inbox template picker used to read `message_templates` straight
// from the browser with a single `status = APPROVED` filter. That is
// wrong in two directions:
//
//   * it offered SMS templates inside a WhatsApp thread (the send then
//     failed at the provider with "template messages are not supported
//     on the whatsapp twilio channel"), and
//   * it hid Twilio Content templates, which are sendable the moment
//     they carry a `twilio_content_sid` even while our mirrored status
//     row still reads PENDING.
//
// Sendability depends on the conversation's channel AND the provider
// actually wired to it, neither of which the client can resolve. So it
// is resolved here, server-side, using the same precedence as the
// outbound orchestrator: pinned connection → enabled connection for
// the channel (primary first) → legacy Meta `whatsapp_config`.
// ============================================================

/** How a given template must be handed to the provider. */
export type TemplateSendMode =
  /** Twilio Content API template (`ContentSid` + `ContentVariables`). */
  | 'twilio_content'
  /** Meta WhatsApp template (name + language + components). */
  | 'meta_components'
  /** No native template concept — rendered to plain text before sending. */
  | 'text';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const conversationId = new URL(request.url).searchParams.get(
      'conversation_id'
    );
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      );
    }

    // RLS-scoped read, additionally filtered by account_id (V2-safe).
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, channel, channel_connection_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Legacy rows (pre-omnichannel) have no channel — WhatsApp was the
    // only channel that existed then.
    const channel = (conversation.channel ?? 'whatsapp') as
      | 'whatsapp'
      | 'sms'
      | 'email';

    // ---- provider resolution (mirrors orchestration/outbound.ts) ----
    let provider: string | null = null;

    if (conversation.channel_connection_id) {
      const { data } = await supabase
        .from('channel_connections')
        .select('provider')
        .eq('id', conversation.channel_connection_id)
        .eq('account_id', accountId)
        .eq('is_enabled', true)
        .maybeSingle();
      provider = data?.provider ?? null;
    }
    if (!provider) {
      const { data } = await supabase
        .from('channel_connections')
        .select('provider')
        .eq('account_id', accountId)
        .eq('channel', channel)
        .eq('is_enabled', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();
      provider = data?.provider ?? null;
    }
    if (!provider && channel === 'whatsapp') {
      // Legacy Meta-direct accounts never got a channel_connections row.
      const { data } = await supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();
      if (data) provider = 'meta';
    }

    const { data: rows, error } = await supabase
      .from('message_templates')
      .select(
        'id, name, channel, provider, category, language, status, header_type, header_content, header_media_url, body_text, footer_text, buttons, sample_values, twilio_content_sid, updated_at, created_at'
      )
      .eq('account_id', accountId)
      .eq('channel', channel)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    type Row = {
      channel: string;
      provider: string | null;
      status: string;
      twilio_content_sid: string | null;
    };

    /**
     * `null` = not sendable in this conversation. Deliberately strict:
     * anything returned here must survive the orchestrator's
     * strict-provider check, otherwise the agent gets a failed bubble.
     */
    const sendModeFor = (row: Row): TemplateSendMode | null => {
      // SMS/email have no provider template object — an approved row is
      // rendered to text at send time.
      if (row.channel !== 'whatsapp') {
        return row.status === 'APPROVED' ? 'text' : null;
      }
      const templateProvider = row.provider ?? 'meta';
      if (provider === 'twilio') {
        // Twilio owns approval inside the Content Template Builder; the
        // SID is the only proof the object exists on their side.
        return templateProvider === 'twilio' && row.twilio_content_sid
          ? 'twilio_content'
          : null;
      }
      if (provider === 'meta' || provider === null) {
        return templateProvider === 'meta' && row.status === 'APPROVED'
          ? 'meta_components'
          : null;
      }
      return null;
    };

    const templates = (rows ?? [])
      .map((row) => ({
        row,
        send_mode: sendModeFor(row as Row),
      }))
      .filter((entry) => entry.send_mode !== null)
      .map((entry) => ({ ...entry.row, send_mode: entry.send_mode }));

    return NextResponse.json({ channel, provider, templates });
  } catch (error) {
    return toErrorResponse(error);
  }
}
