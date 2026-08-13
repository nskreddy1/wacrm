import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Agentic CRM awareness — level 1 of the agentic ladder.
//
// Instead of answering purely from the knowledge base, the agent gets
// a live snapshot of WHO it is talking to: the contact's CRM profile
// and their open deals. This is provider- and engine-agnostic (plain
// prompt context), so it works identically for the direct adapters
// and the LangChain engine without per-provider function-calling.
//
// The snapshot rides in the VOLATILE context (after history, next to
// retrieved knowledge) so the stable system prefix — and therefore
// provider prompt caches — are never invalidated by CRM changes.
//
// Privacy guardrail: only fields the customer already knows about
// themselves (their own name, company, their own deals) are included.
// Internal notes are deliberately excluded.
// ============================================================

interface CrmDealRow {
  title: string;
  value: number | null;
  currency: string | null;
  status: string | null;
  expected_close_date: string | null;
  pipeline_stages: { name: string | null } | null;
}

/**
 * Build a compact CRM snapshot block for the prompt, or `null` when
 * nothing useful exists. Best-effort: any DB error degrades to `null`
 * so a CRM hiccup can never block a reply.
 */
export async function buildCrmContext(
  db: SupabaseClient,
  contactId: string
): Promise<string | null> {
  try {
    const [{ data: contact }, { data: deals }] = await Promise.all([
      db
        .from('contacts')
        .select('name, company, email, phone')
        .eq('id', contactId)
        .maybeSingle(),
      db
        .from('deals')
        .select(
          'title, value, currency, status, expected_close_date, pipeline_stages(name)'
        )
        .eq('contact_id', contactId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(5),
    ]);

    const lines: string[] = [];

    if (contact) {
      const identity = [
        contact.name ? `Name: ${contact.name}` : null,
        contact.company ? `Company: ${contact.company}` : null,
      ].filter(Boolean);
      if (identity.length > 0) lines.push(identity.join(' · '));
    }

    const dealRows = (deals ?? []) as unknown as CrmDealRow[];
    if (dealRows.length > 0) {
      lines.push(
        'Open deals with us:',
        ...dealRows.map((d) => {
          const bits = [
            `- ${d.title}`,
            d.pipeline_stages?.name ? `stage: ${d.pipeline_stages.name}` : null,
            d.value != null && d.value > 0
              ? `value: ${d.currency ?? 'USD'} ${Number(d.value).toLocaleString()}`
              : null,
            d.expected_close_date
              ? `expected close: ${d.expected_close_date}`
              : null,
          ].filter(Boolean);
          return bits.join(' · ');
        })
      );
    }

    if (lines.length === 0) return null;

    return (
      'Customer record — our CRM data about this customer. Use it to ' +
      'personalize the reply (greet by name, reference their deal when ' +
      'relevant). Never recite the whole record back, and never reveal ' +
      'data about anyone other than this customer.\n\n' +
      lines.join('\n')
    );
  } catch {
    // CRM enrichment is a bonus, never a blocker.
    return null;
  }
}
