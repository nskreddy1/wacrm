/**
 * Channel compliance validation for the Template Studio.
 *
 * Encodes the regulations both providers enforce (and the ones
 * carriers fine for), so members find out at compose time — not
 * after a rejected submission or a carrier audit:
 *
 * WhatsApp (Meta Business Policy, enforced by AI review at submit):
 *  - MARKETING templates require documented opt-in and SHOULD carry
 *    an opt-out mechanism ("STOP") — Meta's reviewer looks for it.
 *  - UTILITY templates must be strictly transactional; promotional
 *    wording gets the template reclassified to Marketing (higher
 *    rates) or rejected outright.
 *  - AUTHENTICATION templates are OTP-only: no URLs, no emoji, no
 *    marketing language (Meta enforces a fixed format).
 *
 * SMS (US TCPA + CTIA Messaging Principles, mirrored by most
 * jurisdictions — Twilio enforces via carrier filtering):
 *  - Marketing messages MUST include opt-out instructions (STOP)
 *    and identify the sender (brand name).
 *  - SHAFT content (sex/hate/alcohol/firearms/tobacco + cannabis)
 *    is prohibited or heavily restricted on A2P routes.
 *  - Public URL shorteners (bit.ly etc.) trigger carrier filters.
 *  - OTP messages should not contain links (phishing heuristics).
 *
 * Pure functions — no I/O — so they run identically client-side
 * (live compose feedback) and server-side (enforcement at save).
 */

export type ComplianceLevel = "error" | "warning"

export interface ComplianceIssue {
  level: ComplianceLevel
  /** Stable machine id, e.g. "sms-marketing-missing-stop". */
  code: string
  message: string
}

export interface ComplianceResult {
  ok: boolean
  issues: ComplianceIssue[]
  /** Persisted to message_templates.compliance for auditability. */
  audit: {
    checked_at: string
    channel: "whatsapp" | "sms"
    category: string
    passed: string[]
    failed: string[]
  }
}

const OPT_OUT_RE = /\b(stop|unsubscribe|opt[ -]?out)\b/i
const URL_RE = /(https?:\/\/|www\.)\S+/i
const PUBLIC_SHORTENER_RE = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|rb\.gy)\b/i
const EMOJI_RE = /\p{Extended_Pictographic}/u
const PROMO_WORDS_RE =
  /\b(sale|discount|% ?off|promo(?:tion)?|deal|offer|coupon|limited[ -]time|buy now|free gift)\b/i
/** CTIA SHAFT-C restricted content, keyword heuristic. */
const SHAFT_RE =
  /\b(viagra|cialis|casino|gambling|bet(?:ting)? odds|vape|e-?cig(?:arette)?|tobacco|whiskey|vodka|beer bundle|cannabis|cbd|thc|firearm|ammo|ammunition)\b/i

function issue(level: ComplianceLevel, code: string, message: string): ComplianceIssue {
  return { level, code, message }
}

export function checkWhatsAppCompliance(input: {
  category: "marketing" | "utility" | "authentication"
  body: string
  footer: string
  hasButtons: boolean
}): ComplianceIssue[] {
  const { category, body, footer } = input
  const text = `${body}\n${footer}`
  const issues: ComplianceIssue[] = []

  if (category === "marketing") {
    if (!OPT_OUT_RE.test(text)) {
      issues.push(
        issue(
          "error",
          "wa-marketing-missing-optout",
          'Marketing templates need an opt-out line (e.g. "Reply STOP to opt out") — Meta\'s review looks for one, and it is required for recipient consent compliance.',
        ),
      )
    }
  }

  if (category === "utility" && PROMO_WORDS_RE.test(text)) {
    issues.push(
      issue(
        "warning",
        "wa-utility-promo-language",
        "Promotional wording detected in a Utility template. Meta will reclassify it as Marketing (higher per-message rates) or reject it.",
      ),
    )
  }

  if (category === "authentication") {
    if (URL_RE.test(text)) {
      issues.push(
        issue(
          "error",
          "wa-auth-contains-url",
          "Authentication templates cannot contain links (Meta fixed-format rule).",
        ),
      )
    }
    if (EMOJI_RE.test(text)) {
      issues.push(
        issue(
          "error",
          "wa-auth-contains-emoji",
          "Authentication templates cannot contain emoji (Meta fixed-format rule).",
        ),
      )
    }
    if (PROMO_WORDS_RE.test(text)) {
      issues.push(
        issue(
          "error",
          "wa-auth-promo-language",
          "Authentication templates are OTP-only — remove marketing language.",
        ),
      )
    }
  }

  if (SHAFT_RE.test(text)) {
    issues.push(
      issue(
        "warning",
        "wa-restricted-content",
        "Possible restricted content (alcohol / gambling / adult / weapons). Meta commerce policy prohibits or restricts these categories.",
      ),
    )
  }

  return issues
}

export function checkSmsCompliance(input: {
  category: "marketing" | "transactional" | "otp"
  body: string
}): ComplianceIssue[] {
  const { category, body } = input
  const issues: ComplianceIssue[] = []

  if (category === "marketing") {
    if (!OPT_OUT_RE.test(body)) {
      issues.push(
        issue(
          "error",
          "sms-marketing-missing-stop",
          'Marketing SMS must include opt-out instructions (e.g. "Txt STOP to opt out") — required by TCPA / CTIA.',
        ),
      )
    }
    if (!/\{\{company\}\}/i.test(body) && !/[A-Z][A-Za-z0-9&'. ]{2,}/.test(body)) {
      issues.push(
        issue(
          "warning",
          "sms-marketing-missing-sender",
          "Marketing SMS should identify your brand by name — carriers filter anonymous marketing traffic.",
        ),
      )
    }
  }

  if (category === "otp" && URL_RE.test(body)) {
    issues.push(
      issue(
        "error",
        "sms-otp-contains-url",
        "OTP messages must not contain links — carriers flag them as phishing.",
      ),
    )
  }

  if (PUBLIC_SHORTENER_RE.test(body)) {
    issues.push(
      issue(
        "error",
        "sms-public-shortener",
        "Public URL shorteners (bit.ly, tinyurl…) are blocked by US carriers. Use a full branded domain.",
      ),
    )
  }

  if (SHAFT_RE.test(body)) {
    issues.push(
      issue(
        "warning",
        "sms-shaft-content",
        "Possible SHAFT-restricted content (sex/hate/alcohol/firearms/tobacco/cannabis). A2P routes prohibit or require special registration for these.",
      ),
    )
  }

  return issues
}

/** Run the channel-appropriate checks and produce the audit blob. */
export function checkCompliance(input: {
  channel: "whatsapp" | "sms"
  category: string
  body: string
  footer?: string
  hasButtons?: boolean
}): ComplianceResult {
  const issues =
    input.channel === "whatsapp"
      ? checkWhatsAppCompliance({
          category: input.category as "marketing" | "utility" | "authentication",
          body: input.body,
          footer: input.footer ?? "",
          hasButtons: input.hasButtons ?? false,
        })
      : checkSmsCompliance({
          category: input.category as "marketing" | "transactional" | "otp",
          body: input.body,
        })

  const failed = issues.map((i) => i.code)
  const ALL_CODES =
    input.channel === "whatsapp"
      ? ["wa-marketing-missing-optout", "wa-utility-promo-language", "wa-auth-contains-url", "wa-auth-contains-emoji", "wa-auth-promo-language", "wa-restricted-content"]
      : ["sms-marketing-missing-stop", "sms-marketing-missing-sender", "sms-otp-contains-url", "sms-public-shortener", "sms-shaft-content"]

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    audit: {
      checked_at: new Date().toISOString(),
      channel: input.channel,
      category: input.category,
      passed: ALL_CODES.filter((c) => !failed.includes(c)),
      failed,
    },
  }
}
