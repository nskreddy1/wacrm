# Inbox (upstream snapshot)

> Source: https://wacrm.tech/docs/inbox
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

The Inbox is your team's shared workspace for every WhatsApp conversation. One thread per contact, real-time as messages arrive, template-aware composer, reactions and quote-replies.

If you're new to wacrm, this is the surface you'll spend most of your day on.

## Layout

Three panes on desktop:

| Pane                     | What's in it                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Left — Conversation list | All conversations, newest reply first. Search, status filter (Open / Pending / Closed), unread badges.                    |
| Middle — Message thread  | Selected conversation's messages, oldest at top. Composer at the bottom. Manual refresh icon next to the status dropdown. |
| Right — Contact sidebar  | Phone, tags, notes, deal cards, recent conversation history. Edit-in-place fields.                                        |

On mobile the right pane collapses into a "Contact" button at the top of the thread; the conversation list becomes a back arrow once you open a thread.

Deep-links work: `/inbox?c=<conversation_id>` opens straight to a specific thread. Useful when an automation toast or a teammate's Slack link points at a specific customer.

## Conversation statuses

| Status  | When to use                                                                                             | Visible badge |
| ------- | ------------------------------------------------------------------------------------------------------- | ------------- |
| Open    | Active back-and-forth. Default for any new inbound.                                                     | Green dot     |
| Pending | Customer is waiting on you / handed off to an agent. The agent who picks it up changes it back to Open. | Amber dot     |
| Closed  | Resolved. Hidden from the default filter; still searchable.                                             | Slate dot     |

Changing status is a one-tap action in the thread header. A Flow's `handoff` node sets status to Pending automatically.

## Sending a message

The composer supports five kinds of outbound:

1. Plain text — type and hit Enter (Shift+Enter for newline).
2. Pre-approved template — click the template picker, search by name or category, fill in any body `{{1}}`, `{{2}}` variables (plus a header variable or URL-button value if the template uses them) in the inline preview, send. Build and approve templates in Settings → Templates.
3. Media — photo, video, document, or voice note. Click the paperclip, pick a type (or record a voice note), add an optional caption, send.
4. Reply-to-quote — hover or long-press a message, pick the reply icon. The composer shows the quoted preview above the text field; the recipient sees the same quote tile in WhatsApp.
5. Reaction — hover or long-press a message, tap an emoji from the picker. Reactions also forward to WhatsApp and round-trip: customer-side reactions appear here within ~1s of the webhook.

Within the 24-hour customer-service window WhatsApp accepts free-form text and media. Outside that window Meta enforces template-only sends. The composer warns when the window is closed.

## Sending media

Click the paperclip in the composer to attach a photo, video, or document, or to record a voice note. The file uploads to Supabase Storage (the `chat-media` bucket, scoped to your account) and WhatsApp fetches it from there when the message sends.

| Type       | Formats                           | Size limit | Caption |
| ---------- | --------------------------------- | ---------- | ------- |
| Photo      | PNG, JPEG, WebP                   | 5 MB       | Yes     |
| Video      | MP4, 3GP                          | 16 MB      | Yes     |
| Document   | PDF, Word, Excel, PowerPoint, TXT | 16 MB      | Yes     |
| Voice note | recorded in-app                   | 16 MB      | —       |

- Captions are optional on photo/video/document (Meta caps them at 1024 characters). Voice notes carry no caption.
- Voice notes are recorded straight in the browser and encoded to Ogg/Opus locally — no server-side conversion — so WhatsApp renders them as a true voice note. Recording auto-stops at 5 minutes; mic access is requested the first time you record.
- Preview before sending. After you pick a file (or stop a recording) the composer shows a preview with the caption field and a send button. Discard it with the ✕ and the upload is cleaned up.
- The 24-hour customer-service window applies to media exactly as it does to text — outside the window, send an approved template first.

## Real time

Two Supabase realtime subscriptions wire the page:

- messages — new INSERTs from the webhook appear in the thread without a refresh. If the new message belongs to a conversation not yet in your list (a brand-new contact's first inbound), the conversation is hydrated inline.
- conversations — status changes, unread counter bumps, and last-message updates flow into the conversation list.

The page also runs a resync token that bumps when the tab regains focus or the websocket reconnects. A bump re-fetches the last 50 messages of the active thread to catch anything missed during disconnect.

## Message bubbles

Each bubble shows: the text (or media affordance), the timestamp, and a delivery status icon on outbound messages:

| Icon        | Meaning                                      |
| ----------- | -------------------------------------------- |
| ◦           | Sending — request queued, no Meta ack yet    |
| ✓           | Sent — Meta accepted the message             |
| ✓✓          | Delivered — phone confirmed receipt          |
| ✓✓ (filled) | Read — customer opened the chat              |
| !           | Failed — see the error tooltip; tap to retry |

Reactions appear as small chips at the bottom-right of a bubble. Quote-replies show a left-bordered quote tile above the reply text (scroll-into-view if you tap the quote to find the original).

Interactive replies — when a customer taps a button or list row sent by a Flow, the bubble renders with a small `"Button reply"` label so agents can tell at a glance the customer chose an option (didn't type the words).

## Contact sidebar

Lives in the right pane. Inline-editable fields:

- Name, email, company — click to edit, blur to save.
- Tags — add/remove from the chip row; tags are managed in Settings → Tags.
- Notes — free-form scratch pad, internal-only.
- Active deals — small cards linking to the pipelines view, with stage + value.
- Recent conversations — last 5 threads with this contact.

Edits hit the same RLS-scoped API the contacts page uses; changes are immediately reflected wherever the contact appears.

## Search

Top-of-list search runs `ilike` across the contact's name, phone, and the last message preview. It does NOT full-text search every message body — that's intentional to keep the inbox snappy on large tenants. For message-body search use a Supabase SQL query against `messages.content_text`.

## Bulk actions

Not in 0.2.0. Multi-select + bulk close / assign / tag is on the v0.3 list. For now: open a conversation, change its status, move on.

## Limits & notes

- Conversation list is paginated server-side. First page = 50 rows; scroll or load-more for older threads.
- Message thread loads 50 messages per fetch. Earlier messages load on scroll.
- WhatsApp delivery receipts depend on the customer's privacy settings. If they've disabled read receipts you'll see ✓✓ but never the filled (read) variant.
- Media in messages. Inbound media downloads on demand the first time a bubble renders, then caches in Supabase Storage (`message-media` bucket). The first view of a heavy file can lag. Outbound media you send is uploaded to the `chat-media` bucket and served from there.
- 24-hour window. Meta's customer-service window: once the customer messages you, you have 24 hours of free-form replies. After that, only approved templates send. The window resets on every inbound from that customer.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `inbox`.
