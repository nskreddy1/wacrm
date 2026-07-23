import { NextResponse } from 'next/server'

/**
 * Twilio Connect authorize callback.
 *
 * Configured as the "Authorize URL" of our Twilio Connect App
 * (Twilio Console → Settings → Connect applications). After a
 * customer authorizes (or denies) the Connect App in the popup,
 * Twilio redirects the popup here with `AccountSid` (on success) or
 * `error=unauthorized_client` (on deny).
 *
 * The popup shares no React state with the opener, so it reports the
 * result via postMessage and closes itself. Origin is locked to this
 * deployment, and the opener validates event.origin symmetrically.
 */
export function GET(request: Request) {
  const url = new URL(request.url)
  const accountSid = url.searchParams.get('AccountSid') ?? ''
  const denied = url.searchParams.get('error') === 'unauthorized_client'
  // AccountSid shape guard — never inject unvalidated values into HTML.
  const safeSid = /^AC[0-9a-fA-F]{32}$/.test(accountSid) ? accountSid : ''

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Twilio authorization</title></head>
  <body style="font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh;">
    <p>${denied ? 'Authorization was cancelled. You can close this window.' : safeSid ? 'Twilio account linked. Returning to settings…' : 'Missing account details. You can close this window.'}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage(
          { source: 'twilio-connect', accountSid: ${JSON.stringify(safeSid)}, denied: ${denied ? 'true' : 'false'} },
          ${JSON.stringify(url.origin)},
        );
        setTimeout(function () { window.close(); }, 800);
      }
    </script>
  </body>
</html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
