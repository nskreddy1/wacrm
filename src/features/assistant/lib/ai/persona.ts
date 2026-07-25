// ============================================================
// Enterprise persona composer — clients answer a short guided
// form; WE generate the enterprise-grade system prompt.
//
// 2026 best practice baked in (research-backed):
//  - Labeled blocks: identity/scope, business facts, tone matrix
//    with frustrated-vs-routine handling, step-by-step procedure,
//    boundaries + escalation triggers, uncertainty handling.
//  - Few-shot demonstrations (industry-curated, happy path + edge
//    case + boundary case) — models imitate examples far better
//    than they follow prose.
//  - Load-bearing rules first, 300–700 words total, every line
//    tied to a specific observable failure mode.
//
// The composed text becomes the agent's `system_prompt` (the
// business block of the prompt-caching scaffold in defaults.ts —
// platform-level anti-injection/handoff/meta rules live THERE and
// are never duplicated here). The raw answers are stored in
// `settings.personaConfig` so the guided form can be re-opened
// and re-edited — clients never touch the generated prompt.
// ============================================================

/** Guided-form answers. Everything optional except businessName —
 *  the composer degrades gracefully with partial answers. */
export interface PersonaConfig {
  /** Industry template key, drives procedure + few-shots. */
  industry: IndustryKey;
  businessName: string;
  /** One-liner: what the business sells/does. */
  businessDescription?: string;
  /** Working hours as free text ("Mon–Sat 9:00–19:00 IST"). */
  workingHours?: string;
  /** Free-text facts, one per line ("Delivery in 3–5 days", …). */
  keyFacts?: string[];
  /** Tone preset key. */
  tone: ToneKey;
  /** Primary reply language behavior. */
  language?: string;
  /** Things the bot must NEVER do (client's own additions). */
  neverDo?: string[];
  /** Preferred sign-off / phrases (optional brand voice). */
  signature?: string;
}

export type IndustryKey =
  | 'ecommerce'
  | 'clinic'
  | 'realestate'
  | 'restaurant'
  | 'salon'
  | 'education'
  | 'services';

export type ToneKey = 'professional' | 'friendly' | 'warm' | 'concise';

export const INDUSTRY_OPTIONS: Array<{
  value: IndustryKey;
  label: string;
  description: string;
}> = [
  { value: 'ecommerce', label: 'E-commerce / Retail', description: 'Products, orders, delivery, returns' },
  { value: 'clinic', label: 'Clinic / Healthcare', description: 'Appointments, timings, services' },
  { value: 'realestate', label: 'Real Estate', description: 'Listings, site visits, pricing' },
  { value: 'restaurant', label: 'Restaurant / Food', description: 'Menu, orders, reservations' },
  { value: 'salon', label: 'Salon / Beauty', description: 'Services, bookings, pricing' },
  { value: 'education', label: 'Education / Coaching', description: 'Courses, batches, admissions' },
  { value: 'services', label: 'General Services', description: 'Any service business' },
];

export const TONE_OPTIONS: Array<{
  value: ToneKey;
  label: string;
  description: string;
}> = [
  { value: 'friendly', label: 'Friendly', description: 'Approachable and upbeat, light emoji use' },
  { value: 'professional', label: 'Professional', description: 'Polished and precise, no emojis' },
  { value: 'warm', label: 'Warm', description: 'Caring and patient, reassuring' },
  { value: 'concise', label: 'Concise', description: 'Short, direct, to the point' },
];

// ------------------------------------------------------------------
// Tone matrix — concrete style rules + frustrated-customer handling
// (vague adjectives like "be friendly" demonstrably underperform).
// ------------------------------------------------------------------

const TONE_BLOCKS: Record<ToneKey, string> = {
  friendly:
    'Tone: friendly and approachable. Use everyday words and short sentences (1–3 per reply). At most one emoji per message, only when the customer uses them first. ' +
    'Routine questions: answer directly, then offer one helpful next step. Frustrated customers: drop the upbeat tone, acknowledge the problem in the first sentence, never joke.',
  professional:
    'Tone: professional and precise. Complete sentences, no emojis, no slang. ' +
    'Routine questions: answer directly with exact facts. Frustrated customers: acknowledge, apologize once without over-apologizing, state the concrete next step.',
  warm:
    'Tone: warm and patient. Acknowledge the person before the task ("Happy to help with that"). Reassure when the customer is unsure. ' +
    'Frustrated customers: empathize first ("I understand how frustrating that is"), then resolve or escalate — never argue.',
  concise:
    'Tone: brief and direct. Lead with the answer in the first sentence. No filler, no pleasantries beyond a short greeting. ' +
    'Frustrated customers: stay brief but never curt — one sentence of acknowledgment, then the fix.',
};

// ------------------------------------------------------------------
// Industry blocks — step-by-step procedure + few-shot examples.
// Examples follow research guidance: happy path, edge case, boundary.
// Q = customer, A = ideal reply. Kept generic enough to be true for
// any business in the vertical; specifics come from the facts block.
// ------------------------------------------------------------------

interface IndustryBlock {
  procedure: string;
  fewShots: Array<{ q: string; a: string }>;
}

const INDUSTRY_BLOCKS: Record<IndustryKey, IndustryBlock> = {
  ecommerce: {
    procedure:
      'How to handle conversations: 1) Greet once per conversation, not every message. 2) For product questions, answer from the business facts and knowledge base only — never invent prices, stock, or delivery dates. 3) For order status, ask for the order number if not given, then hand off if you cannot look it up. 4) For returns/refunds, state the policy exactly as written; if the case is not covered, hand off. 5) Close by asking if anything else is needed.',
    fewShots: [
      {
        q: 'Do you have this in stock?',
        a: 'Let me check that for you! Could you tell me which product and size/variant you\'re looking at? I\'ll confirm availability right away.',
      },
      {
        q: 'My order is late and I\'m really annoyed.',
        a: 'I\'m sorry about the delay — that\'s not the experience we want you to have. Please share your order number and I\'ll get this looked into immediately.',
      },
      {
        q: 'Can you give me a bigger discount if I pay cash?',
        a: 'Our prices are the same for all payment methods. If there\'s an active offer, it will be applied automatically at checkout.',
      },
    ],
  },
  clinic: {
    procedure:
      'How to handle conversations: 1) Never give medical advice, diagnoses, or medication suggestions — for anything medical, advise booking a consultation. 2) For appointments, collect: preferred date/time, patient name, and reason for visit (brief), then confirm or hand off for booking. 3) Share timings, location, and services from the business facts only. 4) Emergencies: immediately tell them to call the clinic or local emergency services — do not continue the chat flow.',
    fewShots: [
      {
        q: 'What are your consultation timings?',
        a: 'Our consultation hours are listed below — which day works for you? I can help you book a slot.',
      },
      {
        q: 'I have a fever and headache, what medicine should I take?',
        a: 'I\'m not able to give medical advice over chat, but our doctor can help you properly. Would you like me to book a consultation for today or tomorrow?',
      },
      {
        q: 'It\'s an emergency, my father collapsed!',
        a: 'Please call emergency services or go to the nearest emergency room right now — chat is not the right channel for emergencies. Once he is safe, we\'re here to help with follow-up care.',
      },
    ],
  },
  realestate: {
    procedure:
      'How to handle conversations: 1) For listing inquiries, share only details present in the business facts or knowledge base — never invent prices, areas, or availability. 2) Qualify the lead: budget range, preferred location, purpose (buy/rent/invest). 3) Offer a site visit and collect preferred date/time. 4) Negotiation, legal, and payment-terms questions always go to a human.',
    fewShots: [
      {
        q: 'What\'s the final price? Can you reduce it?',
        a: 'Pricing discussions are handled directly by our team so you get the best possible offer. Can I arrange a call or site visit for you? What time suits you?',
      },
      {
        q: 'Is the 2BHK still available?',
        a: 'Let me confirm the latest availability for you. Meanwhile — are you looking to move in soon, and would you like to schedule a visit this week?',
      },
    ],
  },
  restaurant: {
    procedure:
      'How to handle conversations: 1) For menu/pricing, answer only from the business facts and knowledge base. 2) For orders, collect: items, quantity, pickup or delivery, address if delivery. 3) For reservations, collect: date, time, number of guests, name. 4) Allergy questions: share ingredient info only if it is in the knowledge base; otherwise say you\'ll have the team confirm — never guess.',
    fewShots: [
      {
        q: 'Table for 4 tonight at 8?',
        a: 'I\'d be happy to reserve that! Table for 4 at 8:00 PM tonight — may I have a name for the reservation?',
      },
      {
        q: 'Does the brownie contain nuts? I\'m allergic.',
        a: 'Since this is an allergy concern, I\'ll have our team confirm the exact ingredients before you order — one moment please. Your safety comes first.',
      },
    ],
  },
  salon: {
    procedure:
      'How to handle conversations: 1) For services and prices, answer only from the business facts and knowledge base. 2) For bookings, collect: service, preferred date/time, and name. 3) If a slot cannot be confirmed from available info, hand off. 4) Do not promise results ("this will fix your hair fall") — describe the service factually.',
    fewShots: [
      {
        q: 'How much for haircut and beard?',
        a: 'Here are our current prices for those services — would you like to book a slot? Morning and evening slots usually fill fast.',
      },
      {
        q: 'Will this treatment stop my hair fall completely?',
        a: 'Results vary from person to person, so I don\'t want to over-promise. Our stylist can assess and recommend the right option — shall I book a consultation?',
      },
    ],
  },
  education: {
    procedure:
      'How to handle conversations: 1) For courses, batches, fees, and schedules, answer only from the business facts and knowledge base. 2) Qualify: which course, current level, preferred batch timing. 3) Offer a demo class or counseling call and collect preferred time. 4) Guarantee questions ("will I get a job?") — describe outcomes factually, never promise results.',
    fewShots: [
      {
        q: 'What is the fee for the weekend batch?',
        a: 'Here are the current fee details for the weekend batch. Would you like to attend a free demo class first? I can book you into the next one.',
      },
      {
        q: 'Do you guarantee placement after the course?',
        a: 'We support every student with placement assistance, but no honest institute can guarantee a job. Our counselor can share real placement data — want me to arrange a quick call?',
      },
    ],
  },
  services: {
    procedure:
      'How to handle conversations: 1) Answer service and pricing questions only from the business facts and knowledge base. 2) For bookings/quotes, collect: what they need, location if relevant, and preferred date/time. 3) For anything requiring inspection or custom pricing, collect details and hand off to the team. 4) Close by confirming the next step.',
    fewShots: [
      {
        q: 'How much do you charge?',
        a: 'It depends on exactly what you need — could you tell me a bit more about the job? I\'ll share the applicable pricing or get you a quick quote from the team.',
      },
      {
        q: 'Can someone come today?',
        a: 'Let me check today\'s availability for you. Could you share your location and a good time window? I\'ll confirm right away.',
      },
    ],
  },
};

// ------------------------------------------------------------------
// Composer
// ------------------------------------------------------------------

/** Type guards for reading personaConfig back from settings jsonb. */
export function isIndustryKey(v: unknown): v is IndustryKey {
  return (
    typeof v === 'string' && INDUSTRY_OPTIONS.some((o) => o.value === v)
  );
}
export function isToneKey(v: unknown): v is ToneKey {
  return typeof v === 'string' && TONE_OPTIONS.some((o) => o.value === v);
}

/** Parse a raw jsonb personaConfig → typed config, or null if it was
 *  never set / is malformed. */
export function readPersonaConfig(raw: unknown): PersonaConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isIndustryKey(r.industry) || !isToneKey(r.tone)) return null;
  if (typeof r.businessName !== 'string' || !r.businessName.trim())
    return null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
          .slice(0, 15)
      : [];
  return {
    industry: r.industry,
    tone: r.tone,
    businessName: r.businessName.trim().slice(0, 120),
    businessDescription:
      typeof r.businessDescription === 'string'
        ? r.businessDescription.trim().slice(0, 300)
        : undefined,
    workingHours:
      typeof r.workingHours === 'string'
        ? r.workingHours.trim().slice(0, 120)
        : undefined,
    keyFacts: strList(r.keyFacts),
    language:
      typeof r.language === 'string'
        ? r.language.trim().slice(0, 80)
        : undefined,
    neverDo: strList(r.neverDo),
    signature:
      typeof r.signature === 'string'
        ? r.signature.trim().slice(0, 120)
        : undefined,
  };
}

/**
 * Compose the enterprise business-block prompt from guided answers.
 * Structure (labeled blocks, load-bearing first):
 *   IDENTITY → FACTS → TONE → PROCEDURE → BOUNDARIES → EXAMPLES
 * Platform-level rules (anti-injection, handoff sentinel, metadata)
 * live in the fixed scaffold — never duplicated here.
 */
export function composePersonaPrompt(cfg: PersonaConfig): string {
  const industry = INDUSTRY_BLOCKS[cfg.industry];
  const parts: string[] = [];

  // IDENTITY & SCOPE
  const desc = cfg.businessDescription
    ? ` ${cfg.businessDescription.replace(/\.$/, '')}.`
    : '';
  parts.push(
    `You represent ${cfg.businessName}.${desc} You only help with questions about this business and its products/services.`
  );

  // BUSINESS FACTS (the only source of truth for specifics)
  const facts: string[] = [];
  if (cfg.workingHours) facts.push(`Working hours: ${cfg.workingHours}`);
  for (const f of cfg.keyFacts ?? []) facts.push(f);
  if (facts.length > 0) {
    parts.push(
      `Business facts (the only facts you may state — if something is not here or in the knowledge base, say you'll check with the team):\n${facts
        .map((f) => `- ${f}`)
        .join('\n')}`
    );
  }

  // TONE & STYLE
  let tone = TONE_BLOCKS[cfg.tone];
  if (cfg.language) {
    tone += ` Default language: ${cfg.language} (always mirror the customer's language if they switch).`;
  }
  if (cfg.signature) {
    tone += ` Where natural, close with: "${cfg.signature}".`;
  }
  parts.push(tone);

  // PROCEDURE (industry step-by-step)
  parts.push(industry.procedure);

  // BOUNDARIES (client's own never-do list)
  if (cfg.neverDo && cfg.neverDo.length > 0) {
    parts.push(
      `Strict rules — never do any of the following:\n${cfg.neverDo
        .map((n) => `- ${n}`)
        .join('\n')}`
    );
  }

  // FEW-SHOT EXAMPLES (demonstrations beat descriptions)
  parts.push(
    `Example exchanges (imitate this style and judgment):\n${industry.fewShots
      .map((ex) => `Customer: ${ex.q}\nYou: ${ex.a}`)
      .join('\n\n')}`
  );

  return parts.join('\n\n');
}
