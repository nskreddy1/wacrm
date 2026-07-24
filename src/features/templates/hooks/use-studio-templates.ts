'use client';

import useSWR from 'swr';

import type {
  StudioTemplate,
  TemplateButton,
  TemplateCategory,
  TemplateProvider,
  TemplateStatus,
} from '@/features/templates/lib/studio-types';
import { TEMPLATE_VARIABLES } from '@/features/templates/lib/studio-types';

// ============================================================
// Template Studio data layer.
//
// Persistence:   GET/POST /api/templates        (drafts + SMS)
// Meta submit:   POST /api/whatsapp/templates/submit
// Twilio submit: POST /api/whatsapp/templates/twilio
// Delete:        DELETE /api/whatsapp/templates/:id
//                (channel-agnostic — deletes on Meta when linked,
//                 local-only otherwise, so SMS rows work too)
//
// The DB speaks "provider dialect" (Meta categories, UPPERCASE
// statuses, numbered {{1}} variables); the studio speaks a
// friendlier dialect (lowercase categories, named {{tokens}}).
// All translation lives here so neither side leaks.
// ============================================================

interface DbTemplateRow {
  id: string;
  name: string;
  channel: 'whatsapp' | 'sms';
  provider: TemplateProvider | null;
  category: string;
  language: string;
  status: string;
  header_type: string | null;
  header_content: string | null;
  header_media_url: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
    text: string;
    url?: string;
    phone_number?: string;
  }> | null;
  sample_values: { body?: string[]; header?: string[] } | null;
  compliance: unknown;
  rejection_reason: string | null;
  submission_error: string | null;
  updated_at: string;
  created_at: string;
}

// ------------------------------------------------------------
// DB row → studio shape
// ------------------------------------------------------------

function statusFromDb(status: string): TemplateStatus {
  switch (status) {
    case 'APPROVED':
      return 'approved';
    case 'PENDING':
      return 'pending';
    case 'DRAFT':
      return 'draft';
    default:
      // REJECTED, PAUSED, DISABLED — all render as "rejected" so the
      // member knows the template can't send without action.
      return 'rejected';
  }
}

function categoryFromDb(
  channel: 'whatsapp' | 'sms',
  category: string
): TemplateCategory {
  if (channel === 'sms') {
    if (category === 'transactional') return 'utility';
    if (category === 'otp') return 'authentication';
    return 'marketing';
  }
  const lower = category.toLowerCase();
  if (lower === 'utility') return 'utility';
  if (lower === 'authentication') return 'authentication';
  return 'marketing';
}

function buttonsFromDb(row: DbTemplateRow): TemplateButton[] {
  if (!row.buttons?.length) return [];
  return row.buttons.flatMap((b, i): TemplateButton[] => {
    const id = `db-${i}`;
    if (b.type === 'QUICK_REPLY')
      return [{ id, kind: 'quick_reply', label: b.text }];
    if (b.type === 'URL')
      return [{ id, kind: 'url', label: b.text, url: b.url ?? '' }];
    if (b.type === 'PHONE_NUMBER')
      return [{ id, kind: 'call', label: b.text, phone: b.phone_number ?? '' }];
    return []; // COPY_CODE isn't editable in the studio yet
  });
}

function rowToStudio(row: DbTemplateRow): StudioTemplate {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    category: categoryFromDb(row.channel, row.category),
    language: row.language,
    status: statusFromDb(row.status),
    provider: row.provider ?? (row.channel === 'sms' ? 'none' : 'meta'),
    updatedAt: (row.updated_at ?? row.created_at ?? '').slice(0, 10),
    errorMessage: row.rejection_reason || row.submission_error || null,
    whatsapp: {
      headerKind:
        row.channel === 'whatsapp' && row.header_type
          ? (row.header_type as 'text' | 'image')
          : 'none',
      headerText: row.header_content ?? '',
      body: row.channel === 'whatsapp' ? row.body_text : '',
      footer: row.footer_text ?? '',
      buttons: buttonsFromDb(row),
    },
    sms: { body: row.channel === 'sms' ? row.body_text : '' },
  };
}

// ------------------------------------------------------------
// Studio shape → API payloads
// ------------------------------------------------------------

/**
 * WhatsApp template names must be lowercase snake_case; the studio
 * lets people type anything. "Order shipped!" → "order_shipped".
 */
export function slugifyTemplateName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 512) || 'untitled_template'
  );
}

/**
 * Meta requires numbered variables ({{1}}, {{2}}) with sample
 * values; the studio uses named tokens ({{first_name}}). Convert
 * in order of first appearance and pull samples from the shared
 * variable list (falling back to the token name).
 */
export function toNumberedVariables(text: string): {
  text: string;
  samples: string[];
} {
  const seen: string[] = [];
  const converted = text.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, token: string) => {
      let idx = seen.indexOf(token);
      if (idx === -1) {
        seen.push(token);
        idx = seen.length - 1;
      }
      return `{{${idx + 1}}}`;
    }
  );
  const samples = seen.map(
    (token) =>
      TEMPLATE_VARIABLES.find((v) => v.token === `{{${token}}}`)?.sample ??
      token.replace(/_/g, ' ')
  );
  return { text: converted, samples };
}

function buttonsToApi(buttons: TemplateButton[]) {
  return buttons.map((b) =>
    b.kind === 'quick_reply'
      ? { type: 'QUICK_REPLY' as const, text: b.label }
      : b.kind === 'url'
        ? { type: 'URL' as const, text: b.label, url: b.url }
        : {
            type: 'PHONE_NUMBER' as const,
            text: b.label,
            phone_number: b.phone,
          }
  );
}

const WHATSAPP_CATEGORY: Record<
  TemplateCategory,
  'Marketing' | 'Utility' | 'Authentication'
> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
};

const SMS_CATEGORY: Record<
  TemplateCategory,
  'marketing' | 'transactional' | 'otp'
> = {
  marketing: 'marketing',
  utility: 'transactional',
  authentication: 'otp',
};

function saveBody(tpl: StudioTemplate) {
  if (tpl.channel === 'sms') {
    return {
      channel: 'sms' as const,
      id: tpl.isNew ? undefined : tpl.id,
      name: tpl.name.trim() || 'Untitled template',
      category: SMS_CATEGORY[tpl.category],
      language: tpl.language,
      body_text: tpl.sms.body,
    };
  }
  const body = toNumberedVariables(tpl.whatsapp.body);
  const header =
    tpl.whatsapp.headerKind === 'text' && tpl.whatsapp.headerText.trim()
      ? toNumberedVariables(tpl.whatsapp.headerText)
      : null;
  return {
    channel: 'whatsapp' as const,
    id: tpl.isNew ? undefined : tpl.id,
    name: slugifyTemplateName(tpl.name),
    category: WHATSAPP_CATEGORY[tpl.category],
    language: tpl.language,
    header_type:
      tpl.whatsapp.headerKind === 'none' ? null : tpl.whatsapp.headerKind,
    header_content: header
      ? header.text
      : tpl.whatsapp.headerKind === 'text'
        ? tpl.whatsapp.headerText
        : null,
    body_text: body.text,
    footer_text: tpl.whatsapp.footer.trim() || null,
    buttons: tpl.whatsapp.buttons.length
      ? buttonsToApi(tpl.whatsapp.buttons)
      : null,
    sample_values:
      body.samples.length || header?.samples.length
        ? {
            body: body.samples,
            ...(header?.samples.length ? { header: header.samples } : {}),
          }
        : null,
    provider:
      tpl.provider === 'twilio' ? ('twilio' as const) : ('meta' as const),
  };
}

/** Payload for the Meta submit + Twilio content routes. */
function submitPayload(tpl: StudioTemplate) {
  const base = saveBody(tpl) as Extract<
    ReturnType<typeof saveBody>,
    { channel: 'whatsapp' }
  >;
  return {
    name: base.name,
    category: base.category,
    language: base.language,
    header_type: base.header_type,
    header_content: base.header_content,
    body_text: base.body_text,
    footer_text: base.footer_text,
    buttons: base.buttons,
    sample_values: base.sample_values,
  };
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

async function postJson(url: string, body: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error || `Request failed (${res.status})`
    );
  }
  return json as Record<string, unknown>;
}

export function useStudioTemplates() {
  const { data, error, isLoading, mutate } = useSWR<{
    templates: DbTemplateRow[];
  }>('/api/templates', {
    revalidateOnFocus: false,
  });

  const templates: StudioTemplate[] = (data?.templates ?? []).map(rowToStudio);

  /** Save a draft (WhatsApp) or save/activate (SMS). Returns the saved id. */
  async function save(tpl: StudioTemplate): Promise<string> {
    const json = await postJson('/api/templates', saveBody(tpl));
    await mutate();
    return (json.template as { id: string }).id;
  }

  /**
   * Submit a WhatsApp template for provider review. Saves first so
   * the draft row exists, then routes by provider. Meta upserts the
   * same row (conflict on user/name/language); Twilio creates its
   * content on the Content API then links the row.
   */
  async function submit(tpl: StudioTemplate): Promise<void> {
    if (tpl.channel !== 'whatsapp') {
      await save(tpl);
      return;
    }
    if (tpl.provider === 'twilio') {
      await postJson('/api/whatsapp/templates/twilio', submitPayload(tpl));
    } else {
      await postJson('/api/whatsapp/templates/submit', submitPayload(tpl));
    }
    await mutate();
  }

  /**
   * Pull the latest WhatsApp approval statuses from the provider
   * (Twilio v2 ContentAndApprovals — one bulk call) so Pending
   * templates flip to Approved/Rejected without a manual refresh.
   * Returns a short human summary for the toast.
   */
  async function syncStatuses(): Promise<string> {
    const json = await postJson('/api/whatsapp/templates/twilio', {
      action: 'sync',
    });
    await mutate();
    const inserted = (json.inserted as number) ?? 0;
    const updated = (json.updated as number) ?? 0;
    if (inserted === 0 && updated === 0)
      return 'Statuses are already up to date.';
    return `Synced from Twilio — ${updated} updated, ${inserted} imported.`;
  }

  /**
   * Import/refresh WhatsApp templates from every connected provider.
   * Tries Twilio (Content API) and Meta (WABA message_templates) in
   * turn; "not configured" responses are skipped, not fatal, so one
   * button works for any setup. Throws only when no provider at all
   * is connected or a connected provider genuinely fails.
   */
  async function importTemplates(): Promise<string> {
    const parts: string[] = [];
    const skips: string[] = [];
    // Twilio Content API sync
    try {
      const json = await postJson('/api/whatsapp/templates/twilio', {
        action: 'sync',
      });
      parts.push(
        `Twilio: ${(json.updated as number) ?? 0} updated, ${(json.inserted as number) ?? 0} imported`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not connected|not configured|no twilio connection/i.test(msg))
        skips.push('Twilio');
      else throw new Error(`Twilio sync failed: ${msg}`);
    }
    // Meta WABA sync
    try {
      const json = await postJson('/api/whatsapp/templates/sync', {});
      parts.push(
        `Meta: ${(json.updated as number) ?? 0} updated, ${(json.inserted as number) ?? 0} imported`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not configured|not connected|Connect your WhatsApp/i.test(msg))
        skips.push('Meta');
      else throw new Error(`Meta sync failed: ${msg}`);
    }
    await mutate();
    if (parts.length === 0) {
      throw new Error(
        'No WhatsApp provider is connected. Connect Twilio or Meta WhatsApp in Settings → Channels first.'
      );
    }
    return `Templates synced — ${parts.join(' · ')}`;
  }

  /** Delete locally and (for Meta-linked rows) on the provider. */
  async function remove(id: string): Promise<void> {
    const res = await fetch(`/api/whatsapp/templates/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Delete failed (${res.status})`);
    }
    await mutate();
  }

  return {
    templates,
    isLoading,
    loadError: error ? "Couldn't load templates. Refresh to retry." : null,
    save,
    submit,
    syncStatuses,
    importTemplates,
    remove,
    refresh: mutate,
  };
}
