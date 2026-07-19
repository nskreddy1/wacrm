# Twilio setup — WhatsApp, SMS, and Broadcasts

This guide covers everything to configure in the **Twilio Console** and
in **this app** to run WhatsApp and SMS as independent channels, plus
what that means for broadcasts. A tenant can run SMS-only (e.g. a
school sending fee reminders), WhatsApp-only, or both.

---

## 1. What you need from Twilio

| Item | Where to find it | Used for |
| --- | --- | --- |
| **Account SID** (`AC…`) | Twilio Console → Account Info | Both channels |
| **Auth Token** | Twilio Console → Account Info | Both channels (also validates inbound webhooks) |
| **Phone number** (E.164, e.g. `+15551234567`) | Console → Phone Numbers → Manage → Active numbers | The sender identity per connection |
| **Messaging Service SID** (`MG…`, optional but recommended) | Console → Messaging → Services | Enterprise sending: sender pooling, Sticky Sender, Advanced Opt-Out, queue pacing |

> **India / cost note:** SMS to India over Twilio is priced per segment
> and is comparatively expensive. Keep messages inside one GSM-7
> segment (160 chars — the Template Studio shows a live segment meter),
> and consider a Messaging Service so Twilio manages throughput. For
> very high volume, the provider layer is pluggable — additional SMS
> providers can be added later without changing conversations or
> broadcasts.

---

## 2. Connect the channels in the app

Go to **Settings → Channels**. Email, WhatsApp, and SMS are separate
tabs — each connection is configured, tested, and enabled
independently.

### SMS (Twilio)

1. Open the **SMS** tab → *Add SMS provider* → provider **Twilio**.
2. Fill in:
   - **Connection name** — anything, e.g. `School SMS`.
   - **SMS number** — your Twilio number in E.164 (`+1…`).
   - **Account SID** / **Auth token** — from the Console.
   - **Messaging Service SID** *(optional, recommended)* — an `MG…`
     SID. When set, sends use `MessagingServiceSid` instead of a bare
     `From` number, so Twilio picks the best sender from the service's
     pool and applies Sticky Sender + Advanced Opt-Out.
3. **Save securely** → **Test connection** → toggle **Enabled**.

### WhatsApp (Twilio)

1. Open the **WhatsApp** tab → *Add WhatsApp provider* → **Twilio**.
2. Same fields as SMS; the number must be a **WhatsApp-enabled sender**
   (Console → Messaging → Senders → WhatsApp senders).
3. The optional Messaging Service SID also works here — add the
   WhatsApp sender to the service's **Sender Pool** in the Console
   first.
4. **Save securely** → **Test connection** → **Enabled**.

---

## 3. Configure webhooks in the Twilio Console

All inbound messages and delivery receipts arrive on **one endpoint**:

```
https://YOUR-DOMAIN/api/channels/webhooks/twilio
```

Requests are verified with `X-Twilio-Signature` against your Auth
Token — no extra secret to configure.

### If you use a plain phone number (no Messaging Service)

Console → Phone Numbers → Active numbers → your number → **Messaging
Configuration**:

- **Configure with**: `Webhook, TwiML Bin, Function, Studio Flow, Proxy Service`
- **A message comes in**: `Webhook` → `https://YOUR-DOMAIN/api/channels/webhooks/twilio` → `HTTP POST`
- **Primary handler fails**: optional fallback; leave blank or point
  to the same URL.

### If you use a Messaging Service (recommended)

When a number is added to a Messaging Service, the service's
**Integration** settings take over inbound handling (the number page
will say the service "will handle incoming messages", as in the
screenshot above):

1. Console → Messaging → Services → your service → **Integration**.
2. Select **Send a webhook** and set the Request URL to
   `https://YOUR-DOMAIN/api/channels/webhooks/twilio` (`HTTP POST`).
3. Under **Sender Pool**, add your phone number(s) and/or WhatsApp
   sender(s).
4. In **Opt-Out Management** keep **Advanced Opt-Out** enabled —
   Twilio then handles STOP/START/HELP replies at carrier level; the
   app additionally mirrors STOP onto the contact so broadcasts skip
   opted-out numbers up front.

### Delivery status callbacks

No Console setup needed: every outbound message sets `StatusCallback`
automatically (derived from `NEXT_PUBLIC_SITE_URL` or your Vercel
production URL), so sent → delivered → read/failed states flow back
into conversations and broadcast stats. Make sure
`NEXT_PUBLIC_SITE_URL` is set to your public `https://` domain in
production.

### WhatsApp sandbox (development)

Console → Messaging → Try it out → WhatsApp sandbox: set "When a
message comes in" to the same webhook URL. Sandbox conversations work
end-to-end but require joining via the sandbox code.

---

## 4. Templates (Template Studio)

Open **Templates** in the sidebar. The studio designs both template
kinds with a live phone preview:

- **WhatsApp templates** require **approval** before business-initiated
  sends (broadcasts, reminders). Statuses flow
  `Draft → Pending → Approved/Rejected`. For Twilio connections use
  **Submit for review** (Content API) and **Sync statuses** to pull
  the latest approval states. Only replies inside a 24-hour customer
  service window can be freeform.
- **SMS templates** need **no approval** — they're plain text, saved as
  ready-to-send. Watch the **segment meter**: one emoji switches
  encoding from GSM-7 (160 chars/segment) to UCS-2 (70 chars/segment)
  and roughly doubles cost.
- **Variables**: use built-in chips (`{{first_name}}`, `{{company}}`, …)
  or **Add variable** to define your own key + sample value (e.g.
  `{{student_name}}`, `{{fee_due_date}}`). Samples only feed the
  preview; real values are mapped per contact in the broadcast wizard.

---

## 5. Broadcasts

**Broadcasts → New broadcast**:

1. **Channel** — pick WhatsApp or SMS first; the template list is
   scoped to that channel.
2. **Template** — only sendable templates appear (approved WhatsApp
   templates; any saved SMS template).
3. **Audience** — pick contacts/segments. For SMS, contacts that have
   replied STOP are **skipped automatically** (and any Twilio 21610
   "unsubscribed recipient" rejection backfills the opt-out flag).
4. **Personalize** — map each `{{variable}}` to a contact field.
5. **Review & send** — per-recipient delivery states (queued → sent →
   delivered → failed) land on the broadcast detail page via the
   status callbacks.

### Compliance checklist for bulk SMS

- Send only to recipients who consented (schools: parent opt-in).
- Identify yourself in the message body (school/company name).
- Honor quiet hours local to your recipients.
- Keep STOP language available — with Advanced Opt-Out, Twilio appends
  and processes it automatically on long codes.
- India: DLT registration is required for A2P SMS to Indian numbers —
  register your headers/templates with your DLT operator, or routes
  will be filtered by carriers regardless of Twilio settings.

---

## 6. Quick troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Inbound messages not appearing | Webhook URL wrong or connection disabled; check Console → Monitor → Logs → Errors |
| `401` in Twilio error logs for webhook | Auth Token mismatch (signature validation failed) — re-save credentials |
| Sends fail with `21610` | Recipient texted STOP; the app marks them opted out and skips them next time |
| Sends fail with `63016` (WhatsApp) | Freeform message outside the 24-hour window — use an approved template |
| Statuses stuck at "sent" | `NEXT_PUBLIC_SITE_URL` not set to a public https domain, so no StatusCallback |
| WhatsApp template stuck Pending | Use **Sync statuses** in the studio; Meta review can take up to 24h |
