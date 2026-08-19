import { NextResponse } from 'next/server';
import {
  requireRole,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { channelAdmin } from '@/lib/supabase/admin';
import { decryptProviderCredentials } from '@/features/channels/lib/credentials';
import type { ChannelConnection } from '@/types';

/**
 * Authenticated proxy for provider-hosted inbound media (Twilio MMS /
 * WhatsApp-over-Twilio).
 *
 * Why this route exists: Twilio serves media from api.twilio.com behind
 * HTTP Basic auth. Rendering that URL straight into <img>/<video>/<audio>
 * makes the *browser* perform the request, Twilio answers
 * `401 WWW-Authenticate: Basic`, and Chrome responds by showing its
 * native username/password dialog over the inbox. The credentials live
 * encrypted server-side and must never reach the browser, so the fetch
 * has to happen here instead.
 *
 * Security posture:
 *  - The client passes a *message id*, never a URL, so this cannot be
 *    used as an open redirector / SSRF pivot.
 *  - The URL is read from the row and re-validated against a provider
 *    host allowlist, defending against a poisoned `media_url` value.
 *  - Twilio 307-redirects media to a pre-signed CDN URL. Redirects are
 *    handled manually so the `Authorization` header is never replayed
 *    to the redirect target (that would leak the auth token to a third
 *    party).
 */

/** Hosts we will authenticate against with Twilio credentials. */
const TWILIO_API_HOSTS = new Set(['api.twilio.com']);

/**
 * Pre-signed CDN hosts Twilio redirects media to. These carry their own
 * signature in the query string and must be fetched *without* our
 * Authorization header.
 */
const TWILIO_CDN_HOST_SUFFIXES = [
  '.twiliocdn.com',
  '.s3.amazonaws.com',
  '.media.twiliocdn.com',
];

function isTwilioApiHost(url: URL): boolean {
  return url.protocol === 'https:' && TWILIO_API_HOSTS.has(url.hostname);
}

function isTwilioCdnHost(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    (TWILIO_CDN_HOST_SUFFIXES.some((suffix) =>
      url.hostname.endsWith(suffix)
    ) ||
      url.hostname === 'media.twiliocdn.com')
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params;
    if (!messageId) {
      return NextResponse.json(
        { error: 'Message id is required' },
        { status: 400 }
      );
    }

    // Any member of the account may view media in the shared inbox.
    const { supabase, accountId } = await requireRole('viewer');

    // Read through the RLS-scoped client and *also* filter on the
    // account explicitly — belt and braces, per the repo's tenancy rule
    // that the UI/RLS is never the only boundary.
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select(
        'id, media_url, content_type, channel_connection_id, conversations!inner(account_id)'
      )
      .eq('id', messageId)
      .eq('conversations.account_id', accountId)
      .maybeSingle();

    if (messageError) {
      console.error('[channels/media] message lookup failed:', messageError);
      return NextResponse.json(
        { error: 'Failed to load media' },
        { status: 500 }
      );
    }
    if (!message?.media_url) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    let target: URL;
    try {
      target = new URL(message.media_url);
    } catch {
      return NextResponse.json(
        { error: 'Stored media URL is malformed' },
        { status: 422 }
      );
    }

    // Anything already publicly readable (our own Supabase storage, a
    // Blob URL, an email inline asset) needs no proxying — send the
    // caller straight there rather than tunnelling bytes.
    if (!isTwilioApiHost(target) && !isTwilioCdnHost(target)) {
      return NextResponse.redirect(target.toString(), 302);
    }

    if (!message.channel_connection_id) {
      return NextResponse.json(
        { error: 'Message is not linked to a channel connection' },
        { status: 409 }
      );
    }

    // credentials_encrypted is deliberately excluded from the columns
    // the RLS client may read, so use the service-role client — still
    // filtered by account_id, per the service-role rule.
    const { data: connection, error: connectionError } = await channelAdmin()
      .from('channel_connections')
      .select('id, account_id, provider, credentials_encrypted')
      .eq('id', message.channel_connection_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (connectionError) {
      console.error(
        '[channels/media] connection lookup failed:',
        connectionError
      );
      return NextResponse.json(
        { error: 'Failed to load media' },
        { status: 500 }
      );
    }
    if (!connection || connection.provider !== 'twilio') {
      return NextResponse.json(
        { error: 'Twilio is not configured for this message' },
        { status: 409 }
      );
    }

    let authHeader: string;
    try {
      const credentials = decryptProviderCredentials(
        connection as unknown as ChannelConnection & {
          credentials_encrypted?: string;
        }
      );
      if (credentials.provider !== 'twilio') {
        return NextResponse.json(
          { error: 'Twilio is not configured for this message' },
          { status: 409 }
        );
      }
      const { accountSid, authToken } = credentials.value;
      authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    } catch (error) {
      console.error('[channels/media] credential decrypt failed:', error);
      return NextResponse.json(
        { error: 'Stored Twilio credentials could not be read' },
        { status: 409 }
      );
    }

    // First hop: authenticate to api.twilio.com. Handle the redirect by
    // hand so credentials are not replayed to the CDN.
    let upstream = await fetch(target.toString(), {
      headers: isTwilioApiHost(target) ? { Authorization: authHeader } : {},
      redirect: 'manual',
      cache: 'no-store',
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) {
        return NextResponse.json(
          { error: 'Provider returned a redirect without a target' },
          { status: 502 }
        );
      }
      let redirectTarget: URL;
      try {
        redirectTarget = new URL(location, target);
      } catch {
        return NextResponse.json(
          { error: 'Provider returned a malformed redirect' },
          { status: 502 }
        );
      }
      if (!isTwilioCdnHost(redirectTarget) && !isTwilioApiHost(redirectTarget)) {
        return NextResponse.json(
          { error: 'Provider redirected to an unexpected host' },
          { status: 502 }
        );
      }
      // Pre-signed CDN URL: no Authorization header.
      upstream = await fetch(redirectTarget.toString(), {
        redirect: 'follow',
        cache: 'no-store',
      });
    }

    if (!upstream.ok || !upstream.body) {
      console.error(
        '[channels/media] upstream fetch failed:',
        upstream.status,
        upstream.statusText
      );
      return NextResponse.json(
        { error: 'Provider could not return this media' },
        { status: 502 }
      );
    }

    // Stream rather than buffer so a large video does not sit in memory.
    // `Content-Disposition: inline` keeps images/video previewable while
    // still naming the file for a download.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') || 'application/octet-stream',
        ...(upstream.headers.get('content-length')
          ? { 'Content-Length': upstream.headers.get('content-length')! }
          : {}),
        'Content-Disposition': 'inline',
        // Media is tenant data: keep it out of shared caches.
        'Cache-Control': 'private, max-age=300',
        'Vercel-CDN-Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
