// ============================================================
// Template Studio — shared types + client-side helpers.
//
// Backed by `message_templates` via /api/templates (persistence)
// and the provider routes (/api/whatsapp/templates/submit for
// Meta, /api/whatsapp/templates/twilio for Twilio) for carrier
// submission. Mapping between these UI shapes and DB rows lives
// in hooks/use-studio-templates.ts.
// ============================================================

export type TemplateChannel = 'whatsapp' | 'sms';

export type TemplateStatus = 'approved' | 'pending' | 'draft' | 'rejected';

export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

/** Which provider a WhatsApp template submits through. */
export type TemplateProvider = 'meta' | 'twilio' | 'none';

export type HeaderKind = 'none' | 'text' | 'image';

export type TemplateButton =
  | { id: string; kind: 'quick_reply'; label: string }
  | { id: string; kind: 'url'; label: string; url: string }
  | { id: string; kind: 'call'; label: string; phone: string };

export interface WhatsAppDraft {
  headerKind: HeaderKind;
  headerText: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
}

export interface SmsDraft {
  body: string;
}

export interface StudioTemplate {
  id: string;
  name: string;
  channel: TemplateChannel;
  category: TemplateCategory;
  language: string;
  status: TemplateStatus;
  provider: TemplateProvider;
  updatedAt: string;
  whatsapp: WhatsAppDraft;
  sms: SmsDraft;
  /** Provider rejection / submission error, surfaced in the editor. */
  errorMessage?: string | null;
  /** True for rows that only exist locally (never saved). */
  isNew?: boolean;
}

/**
 * Variables members can drop into any template body.
 *
 * `label` is the human name shown in the chip; `sample` is ONLY used
 * to fill the live phone preview so members see realistic output —
 * at send time each token is mapped to real contact data in the
 * broadcast wizard's personalize step.
 */
export const TEMPLATE_VARIABLES = [
  { token: '{{first_name}}', label: 'First name', sample: 'Priya' },
  { token: '{{last_name}}', label: 'Last name', sample: 'Sharma' },
  { token: '{{name}}', label: 'Full name', sample: 'Priya Sharma' },
  {
    token: '{{company}}',
    label: 'Company / school',
    sample: 'Sunrise Public School',
  },
  { token: '{{order_id}}', label: 'Order ID', sample: '#48291' },
  {
    token: '{{appointment_time}}',
    label: 'Appointment time',
    sample: '3:30 PM, Jul 22',
  },
  { token: '{{agent_name}}', label: 'Agent name', sample: 'Ram' },
  { token: '{{otp}}', label: 'One-time code', sample: '482913' },
] as const;

/**
 * An account-defined variable from the template_variables table.
 * Members create these in the studio ("Add variable") so schools and
 * other tenants can model their own data — e.g. {{student_name}},
 * {{class}}, {{fee_due_date}} — beyond the built-in set.
 */
export interface CustomTemplateVariable {
  id: string;
  key: string;
  label: string;
  sampleValue: string;
}

/**
 * Substitute {{tokens}} with sample values for the live preview.
 * Custom (account-defined) variables win over built-ins on key
 * collisions so tenants can override the stock samples.
 */
export function withSampleValues(
  text: string,
  customVariables?: CustomTemplateVariable[]
): string {
  let out = text;
  for (const v of customVariables ?? []) {
    out = out.split(`{{${v.key}}}`).join(v.sampleValue || v.label || v.key);
  }
  for (const v of TEMPLATE_VARIABLES) {
    out = out.split(v.token).join(v.sample);
  }
  return out;
}

// ------------------------------------------------------------
// SMS segmentation — GSM-7 vs UCS-2 detection with the correct
// per-segment budgets (160/153 for GSM-7, 70/67 for Unicode).
// ------------------------------------------------------------

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà';

const GSM7_EXTENDED = '^{}\\[~]|€';

export interface SmsMeta {
  encoding: 'GSM-7' | 'Unicode';
  charCount: number;
  segments: number;
  perSegment: number;
}

export function analyzeSms(text: string): SmsMeta {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    const len = [...text].length;
    const per = len <= 70 ? 70 : 67;
    return {
      encoding: 'Unicode',
      charCount: len,
      segments: len === 0 ? 0 : Math.ceil(len / per),
      perSegment: per,
    };
  }
  const per = units <= 160 ? 160 : 153;
  return {
    encoding: 'GSM-7',
    charCount: units,
    segments: units === 0 ? 0 : Math.ceil(units / per),
    perSegment: per,
  };
}

export const STATUS_META: Record<
  TemplateStatus,
  { label: string; className: string }
> = {
  approved: { label: 'Approved', className: 'bg-primary/15 text-primary' },
  pending: {
    label: 'In review',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  rejected: {
    label: 'Rejected',
    className: 'bg-destructive/15 text-destructive',
  },
};

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
};
