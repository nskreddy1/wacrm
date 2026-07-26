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
 * Email (US CAN-SPAM Act + Gmail/Yahoo/Outlook bulk-sender rules,
 * enforced at SMTP level since 2024 — GDPR/CASL mirror the consent
 * side):
 *  - Marketing email MUST carry a visible unsubscribe mechanism
 *    (CAN-SPAM §316.5; Gmail/Yahoo additionally require RFC 8058
 *    one-click List-Unsubscribe headers at the sender level).
 *  - CAN-SPAM requires the sender's valid physical postal address
 *    in every commercial message.
 *  - Subject lines must not be deceptive (no fake "RE:"/"FWD:",
 *    no misleading claims) — FTC enforcement, fines per email.
 *  - OTP/security emails must not carry links or promo content
 *    (phishing heuristics used by all major mailbox providers).
 *  - Public URL shorteners and spam-trigger punctuation ($$$, !!!)
 *    hurt deliverability and raise the >0.3% spam-rate ceiling.
 *
 * Pure functions — no I/O — so they run identically client-side
 * (live compose feedback) and server-side (enforcement at save).
 */

export type ComplianceLevel = 'error' | 'warning';

export interface ComplianceIssue {
  level: ComplianceLevel;
  /** Stable machine id, e.g. "sms-marketing-missing-stop". */
  code: string;
  message: string;
}

export interface ComplianceResult {
  ok: boolean;
  issues: ComplianceIssue[];
  /** Persisted to message_templates.compliance for auditability. */
  audit: {
    checked_at: string;
    channel: 'whatsapp' | 'sms' | 'email';
    category: string;
    passed: string[];
    failed: string[];
  };
}

const OPT_OUT_RE = /\b(stop|unsubscribe|opt[ -]?out)\b/i;
const URL_RE = /(https?:\/\/|www\.)\S+/i;
const PUBLIC_SHORTENER_RE =
  /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|rb\.gy)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const PROMO_WORDS_RE =
  /\b(sale|discount|% ?off|promo(?:tion)?|deal|offer|coupon|limited[ -]time|buy now|free gift)\b/i;
/** CTIA SHAFT-C restricted content, keyword heuristic. */
const SHAFT_RE =
  /\b(viagra|cialis|casino|gambling|bet(?:ting)? odds|vape|e-?cig(?:arette)?|tobacco|whiskey|vodka|beer bundle|cannabis|cbd|thc|firearm|ammo|ammunition)\b/i;

function issue(
  level: ComplianceLevel,
  code: string,
  message: string
): ComplianceIssue {
  return { level, code, message };
}

/** Any studio variable: named ({{first_name}}) or numbered ({{1}}). */
const VARIABLE_RE = /\{\{\s*[\w.]+\s*\}\}/;
const ADJACENT_VARIABLES_RE = /\}\}\s*\{\{/;

function countEmoji(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

export function checkWhatsAppCompliance(input: {
  category: 'marketing' | 'utility' | 'authentication';
  body: string;
  footer: string;
  hasButtons: boolean;
}): ComplianceIssue[] {
  const { category, body, footer } = input;
  const text = `${body}\n${footer}`;
  const issues: ComplianceIssue[] = [];

  // --- Structural rules (Meta review + Twilio Content API both
  // reject on these; caught here so members never hit a rejection) ---
  const trimmedBody = body.trim();
  if (VARIABLE_RE.test(trimmedBody)) {
    const startsWithVar = /^\{\{\s*[\w.]+\s*\}\}/.test(trimmedBody);
    const endsWithVar = /\{\{\s*[\w.]+\s*\}\}$/.test(trimmedBody);
    if (startsWithVar || endsWithVar) {
      issues.push(
        issue(
          'error',
          'wa-variable-at-edge',
          'The body cannot start or end with a variable — Meta and Twilio both reject templates whose text begins or ends with a placeholder. Add surrounding text.'
        )
      );
    }
    if (ADJACENT_VARIABLES_RE.test(trimmedBody)) {
      issues.push(
        issue(
          'error',
          'wa-adjacent-variables',
          'Two variables cannot sit next to each other (e.g. {{a}}{{b}}) — separate them with words so reviewers have context.'
        )
      );
    }
  }
  if (countEmoji(text) > 10) {
    issues.push(
      issue(
        'warning',
        'wa-excessive-emoji',
        "More than 10 emojis — Meta's automated review flags emoji-heavy templates as spam."
      )
    );
  }
  if (/\n{4,}/.test(body)) {
    issues.push(
      issue(
        'warning',
        'wa-excessive-linebreaks',
        'Excessive consecutive line breaks — a known Meta rejection reason. Tighten the spacing.'
      )
    );
  }

  if (category === 'marketing') {
    if (!OPT_OUT_RE.test(text)) {
      issues.push(
        issue(
          'error',
          'wa-marketing-missing-optout',
          'Marketing templates need an opt-out line (e.g. "Reply STOP to opt out") — Meta\'s review looks for one, and it is required for recipient consent compliance.'
        )
      );
    }
  }

  if (category === 'utility' && PROMO_WORDS_RE.test(text)) {
    issues.push(
      issue(
        'warning',
        'wa-utility-promo-language',
        'Promotional wording detected in a Utility template. Meta will reclassify it as Marketing (higher per-message rates) or reject it.'
      )
    );
  }

  if (category === 'authentication') {
    if (URL_RE.test(text)) {
      issues.push(
        issue(
          'error',
          'wa-auth-contains-url',
          'Authentication templates cannot contain links (Meta fixed-format rule).'
        )
      );
    }
    if (EMOJI_RE.test(text)) {
      issues.push(
        issue(
          'error',
          'wa-auth-contains-emoji',
          'Authentication templates cannot contain emoji (Meta fixed-format rule).'
        )
      );
    }
    if (PROMO_WORDS_RE.test(text)) {
      issues.push(
        issue(
          'error',
          'wa-auth-promo-language',
          'Authentication templates are OTP-only — remove marketing language.'
        )
      );
    }
  }

  if (SHAFT_RE.test(text)) {
    issues.push(
      issue(
        'warning',
        'wa-restricted-content',
        'Possible restricted content (alcohol / gambling / adult / weapons). Meta commerce policy prohibits or restricts these categories.'
      )
    );
  }

  return issues;
}

export function checkSmsCompliance(input: {
  category: 'marketing' | 'transactional' | 'otp';
  body: string;
}): ComplianceIssue[] {
  const { category, body } = input;
  const issues: ComplianceIssue[] = [];

  if (category === 'marketing') {
    if (!OPT_OUT_RE.test(body)) {
      issues.push(
        issue(
          'error',
          'sms-marketing-missing-stop',
          'Marketing SMS must include opt-out instructions (e.g. "Txt STOP to opt out") — required by TCPA / CTIA.'
        )
      );
    }
    if (
      !/\{\{company\}\}/i.test(body) &&
      !/[A-Z][A-Za-z0-9&'. ]{2,}/.test(body)
    ) {
      issues.push(
        issue(
          'warning',
          'sms-marketing-missing-sender',
          'Marketing SMS should identify your brand by name — carriers filter anonymous marketing traffic.'
        )
      );
    }
  }

  if (category === 'otp' && URL_RE.test(body)) {
    issues.push(
      issue(
        'error',
        'sms-otp-contains-url',
        'OTP messages must not contain links — carriers flag them as phishing.'
      )
    );
  }

  if (PUBLIC_SHORTENER_RE.test(body)) {
    issues.push(
      issue(
        'error',
        'sms-public-shortener',
        'Public URL shorteners (bit.ly, tinyurl…) are blocked by US carriers. Use a full branded domain.'
      )
    );
  }

  if (SHAFT_RE.test(body)) {
    issues.push(
      issue(
        'warning',
        'sms-shaft-content',
        'Possible SHAFT-restricted content (sex/hate/alcohol/firearms/tobacco/cannabis). A2P routes prohibit or require special registration for these.'
      )
    );
  }

  return issues;
}

/** US street address or PO Box heuristic — CAN-SPAM postal address. */
const POSTAL_ADDRESS_RE =
  /\b(P\.?\s?O\.?\s?Box\s+\d+|\d{1,6}\s+[A-Za-z0-9'. ]+\s(St(?:reet)?|Ave(?:nue)?|R(?:oa)?d|Blvd|Boulevard|Lane|Ln|Dr(?:ive)?|Suite|Ste|Floor|Fl)\.?\b)/i;
const FAKE_REPLY_SUBJECT_RE = /^\s*(re|fwd?|fw)\s*:/i;
const SPAM_PUNCTUATION_RE = /(!{3,}|\${3,}|100% free|act now|urgent!)/i;

export function checkEmailCompliance(input: {
  /** Compliance tier: newsletter/promotional → marketing,
   *  transactional/onboarding → transactional, otp → otp. */
  category: 'marketing' | 'transactional' | 'otp';
  subject: string;
  body: string;
}): ComplianceIssue[] {
  const { category, subject, body } = input;
  const text = `${subject}\n${body}`;
  const issues: ComplianceIssue[] = [];

  if (category === 'marketing') {
    if (!OPT_OUT_RE.test(body)) {
      issues.push(
        issue(
          'error',
          'email-marketing-missing-unsubscribe',
          'Marketing email must include an unsubscribe link or instructions — required by CAN-SPAM, GDPR and CASL, and Gmail/Yahoo reject bulk mail without one.'
        )
      );
    }
    if (!POSTAL_ADDRESS_RE.test(body) && !/\{\{\s*company_address\s*\}\}/i.test(body)) {
      issues.push(
        issue(
          'warning',
          'email-marketing-missing-postal-address',
          "CAN-SPAM requires your valid physical postal address in every commercial email — add it to the footer (or a {{company_address}} variable)."
        )
      );
    }
  }

  if (FAKE_REPLY_SUBJECT_RE.test(subject)) {
    issues.push(
      issue(
        'error',
        'email-deceptive-subject',
        'Subject lines that fake a reply or forward ("RE:", "FWD:") are deceptive under CAN-SPAM — the FTC fines per email sent.'
      )
    );
  }
  const letters = subject.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) {
    issues.push(
      issue(
        'warning',
        'email-shouting-subject',
        'ALL-CAPS subject lines are a top spam-filter trigger — mailbox providers count them against your <0.3% spam-rate budget.'
      )
    );
  }
  if (SPAM_PUNCTUATION_RE.test(text)) {
    issues.push(
      issue(
        'warning',
        'email-spam-punctuation',
        'Spam-trigger phrasing detected (!!!, $$$, "act now", "100% free") — this hurts deliverability with Gmail/Yahoo/Outlook filters.'
      )
    );
  }
  if (PUBLIC_SHORTENER_RE.test(text)) {
    issues.push(
      issue(
        'error',
        'email-public-shortener',
        'Public URL shorteners (bit.ly, tinyurl…) are heavily penalized by email spam filters. Link your own domain instead.'
      )
    );
  }

  if (category === 'otp') {
    if (URL_RE.test(body)) {
      issues.push(
        issue(
          'error',
          'email-otp-contains-url',
          'OTP/security emails must not contain links — mailbox providers flag them as phishing.'
        )
      );
    }
    if (PROMO_WORDS_RE.test(text)) {
      issues.push(
        issue(
          'error',
          'email-otp-promo-language',
          'OTP emails are security messages — remove marketing language.'
        )
      );
    }
  }

  if (SHAFT_RE.test(text)) {
    issues.push(
      issue(
        'warning',
        'email-restricted-content',
        'Possible restricted content (alcohol / gambling / adult / weapons) — most ESPs (Resend, MSG91, Mailtrap) restrict these categories in their acceptable-use policies.'
      )
    );
  }

  return issues;
}

/** Run the channel-appropriate checks and produce the audit blob. */
export function checkCompliance(input: {
  channel: 'whatsapp' | 'sms' | 'email';
  category: string;
  body: string;
  subject?: string;
  footer?: string;
  hasButtons?: boolean;
}): ComplianceResult {
  const issues =
    input.channel === 'whatsapp'
      ? checkWhatsAppCompliance({
          category: input.category as
            'marketing' | 'utility' | 'authentication',
          body: input.body,
          footer: input.footer ?? '',
          hasButtons: input.hasButtons ?? false,
        })
      : input.channel === 'email'
        ? checkEmailCompliance({
            category: input.category as 'marketing' | 'transactional' | 'otp',
            subject: input.subject ?? '',
            body: input.body,
          })
        : checkSmsCompliance({
            category: input.category as 'marketing' | 'transactional' | 'otp',
            body: input.body,
          });

  const failed = issues.map((i) => i.code);
  const ALL_CODES =
    input.channel === 'whatsapp'
      ? [
          'wa-variable-at-edge',
          'wa-adjacent-variables',
          'wa-excessive-emoji',
          'wa-excessive-linebreaks',
          'wa-marketing-missing-optout',
          'wa-utility-promo-language',
          'wa-auth-contains-url',
          'wa-auth-contains-emoji',
          'wa-auth-promo-language',
          'wa-restricted-content',
        ]
      : input.channel === 'email'
        ? [
            'email-marketing-missing-unsubscribe',
            'email-marketing-missing-postal-address',
            'email-deceptive-subject',
            'email-shouting-subject',
            'email-spam-punctuation',
            'email-public-shortener',
            'email-otp-contains-url',
            'email-otp-promo-language',
            'email-restricted-content',
          ]
        : [
            'sms-marketing-missing-stop',
            'sms-marketing-missing-sender',
            'sms-otp-contains-url',
            'sms-public-shortener',
            'sms-shaft-content',
          ];

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    audit: {
      checked_at: new Date().toISOString(),
      channel: input.channel,
      category: input.category,
      passed: ALL_CODES.filter((c) => !failed.includes(c)),
      failed,
    },
  };
}
