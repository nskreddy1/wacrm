// ============================================================
// Template Studio — shared types + hardcoded sample data.
//
// The studio is UI-only for now (no persistence). These shapes
// deliberately mirror what WhatsApp Cloud API template payloads
// and SMS provider payloads will need, so wiring real
// integrations later is a mapping exercise, not a rewrite.
// ============================================================

export type TemplateChannel = "whatsapp" | "sms"

export type TemplateStatus = "approved" | "pending" | "draft" | "rejected"

export type TemplateCategory = "marketing" | "utility" | "authentication"

export type HeaderKind = "none" | "text" | "image"

export type TemplateButton =
  | { id: string; kind: "quick_reply"; label: string }
  | { id: string; kind: "url"; label: string; url: string }
  | { id: string; kind: "call"; label: string; phone: string }

export interface WhatsAppDraft {
  headerKind: HeaderKind
  headerText: string
  body: string
  footer: string
  buttons: TemplateButton[]
}

export interface SmsDraft {
  body: string
}

export interface StudioTemplate {
  id: string
  name: string
  channel: TemplateChannel
  category: TemplateCategory
  language: string
  status: TemplateStatus
  updatedAt: string
  whatsapp: WhatsAppDraft
  sms: SmsDraft
}

/** Variables members can drop into any template body. */
export const TEMPLATE_VARIABLES = [
  { token: "{{first_name}}", sample: "Priya" },
  { token: "{{company}}", sample: "Axon" },
  { token: "{{order_id}}", sample: "#48291" },
  { token: "{{booking_time}}", sample: "3:30 PM, Jul 22" },
  { token: "{{agent_name}}", sample: "Ram" },
  { token: "{{otp}}", sample: "482913" },
] as const

/** Substitute {{tokens}} with sample values for the live preview. */
export function withSampleValues(text: string): string {
  let out = text
  for (const v of TEMPLATE_VARIABLES) {
    out = out.split(v.token).join(v.sample)
  }
  return out
}

// ------------------------------------------------------------
// SMS segmentation — GSM-7 vs UCS-2 detection with the correct
// per-segment budgets (160/153 for GSM-7, 70/67 for Unicode).
// ------------------------------------------------------------

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà"

const GSM7_EXTENDED = "^{}\\[~]|€"

export interface SmsMeta {
  encoding: "GSM-7" | "Unicode"
  charCount: number
  segments: number
  perSegment: number
}

export function analyzeSms(text: string): SmsMeta {
  let gsm = true
  let units = 0
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1
    else if (GSM7_EXTENDED.includes(ch)) units += 2
    else {
      gsm = false
      break
    }
  }
  if (!gsm) {
    const len = [...text].length
    const per = len <= 70 ? 70 : 67
    return {
      encoding: "Unicode",
      charCount: len,
      segments: len === 0 ? 0 : Math.ceil(len / per),
      perSegment: per,
    }
  }
  const per = units <= 160 ? 160 : 153
  return {
    encoding: "GSM-7",
    charCount: units,
    segments: units === 0 ? 0 : Math.ceil(units / per),
    perSegment: per,
  }
}

// ------------------------------------------------------------
// Hardcoded starter templates
// ------------------------------------------------------------

export const SAMPLE_TEMPLATES: StudioTemplate[] = [
  {
    id: "tpl-order-update",
    name: "Order shipped",
    channel: "whatsapp",
    category: "utility",
    language: "en_US",
    status: "approved",
    updatedAt: "2026-07-15",
    whatsapp: {
      headerKind: "text",
      headerText: "Your order is on the way",
      body:
        "Hi {{first_name}}, great news — order {{order_id}} has shipped and will arrive within 2 business days.\n\nTrack it anytime using the button below.",
      footer: "Reply STOP to opt out",
      buttons: [
        { id: "b1", kind: "url", label: "Track order", url: "https://axon.app/track" },
        { id: "b2", kind: "quick_reply", label: "Need help" },
      ],
    },
    sms: {
      body:
        "Hi {{first_name}}, your order {{order_id}} has shipped! Track: https://axon.app/track — {{company}}",
    },
  },
  {
    id: "tpl-booking-reminder",
    name: "Booking reminder",
    channel: "whatsapp",
    category: "utility",
    language: "en_US",
    status: "pending",
    updatedAt: "2026-07-17",
    whatsapp: {
      headerKind: "none",
      headerText: "",
      body:
        "Hello {{first_name}}, this is a reminder about your appointment at {{booking_time}} with {{agent_name}}.\n\nSee you soon!",
      footer: "",
      buttons: [
        { id: "b1", kind: "quick_reply", label: "Confirm" },
        { id: "b2", kind: "quick_reply", label: "Reschedule" },
      ],
    },
    sms: {
      body:
        "Reminder: your appointment is at {{booking_time}} with {{agent_name}}. Reply C to confirm or R to reschedule.",
    },
  },
  {
    id: "tpl-otp",
    name: "Login code",
    channel: "sms",
    category: "authentication",
    language: "en_US",
    status: "approved",
    updatedAt: "2026-07-10",
    whatsapp: {
      headerKind: "none",
      headerText: "",
      body: "{{otp}} is your {{company}} verification code. It expires in 10 minutes.",
      footer: "",
      buttons: [],
    },
    sms: {
      body: "{{otp}} is your {{company}} verification code. It expires in 10 minutes.",
    },
  },
  {
    id: "tpl-summer-promo",
    name: "Summer sale blast",
    channel: "sms",
    category: "marketing",
    language: "en_US",
    status: "draft",
    updatedAt: "2026-07-18",
    whatsapp: {
      headerKind: "image",
      headerText: "",
      body:
        "Hey {{first_name}}! Our summer sale is live — up to 40% off everything at {{company}}. Ends Sunday.",
      footer: "Reply STOP to opt out",
      buttons: [{ id: "b1", kind: "url", label: "Shop now", url: "https://axon.app/sale" }],
    },
    sms: {
      body:
        "{{company}} Summer Sale! Up to 40% off everything, ends Sunday. Shop: https://axon.app/sale Txt STOP to opt out",
    },
  },
]

export const STATUS_META: Record<TemplateStatus, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-primary/15 text-primary" },
  pending: { label: "In review", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  rejected: { label: "Rejected", className: "bg-destructive/15 text-destructive" },
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  marketing: "Marketing",
  utility: "Utility",
  authentication: "Authentication",
}
