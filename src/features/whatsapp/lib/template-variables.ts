// ============================================================
// Template placeholder tokens — positional AND named.
//
// Two placeholder dialects reach us, and conflating them is what made
// `hi {{first_name}}` arrive at the contact verbatim:
//
//   * Meta WhatsApp templates are strictly positional — `{{1}}`, `{{2}}`,
//     contiguous and 1-indexed (see template-validators.ts).
//   * Twilio Content templates and our own SMS Studio rows allow *named*
//     tokens — `{{first_name}}` — which Twilio then maps by key in
//     `ContentVariables`, and which our SMS renderer must substitute
//     locally because SMS has no template object at all.
//
// `extractVariableIndices` only ever understood the positional dialect,
// so a named token produced zero variable slots: the picker collected no
// values, the renderer matched nothing, and the raw `{{first_name}}`
// string went out on the wire.
//
// This module is the single place that understands both. It preserves
// *source order* for named tokens, because that order is what defines
// the positional index Twilio expects when a named template is sent
// through the Content API as `{"1": …}`.
// ============================================================

/** A single placeholder slot found in a template string. */
export interface TemplateVariable {
  /** Raw token text without braces — `"1"` or `"first_name"`. */
  token: string;
  /** `positional` for `{{1}}`, `named` for `{{first_name}}`. */
  kind: 'positional' | 'named';
  /**
   * 1-based index used when the value must be sent positionally
   * (Meta components, Twilio `ContentVariables`). For positional tokens
   * this is the token itself; for named tokens it is the order of first
   * appearance.
   */
  index: number;
  /** Human label for the input field — `"{{1}}"` / `"First name"`. */
  label: string;
}

/** Matches `{{1}}` and `{{first_name}}` (letters, digits, underscore). */
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** `first_name` → `First name`, so the picker shows a real label. */
function humanize(token: string): string {
  const spaced = token.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Extract every placeholder in `text`, deduplicated, in source order.
 *
 * Positional tokens keep their declared number so `{{2}}` stays slot 2
 * even when it appears first. Named tokens are numbered by order of
 * first appearance, which is the mapping Twilio's Content API uses.
 */
export function extractTemplateVariables(
  text: string | null | undefined
): TemplateVariable[] {
  if (!text) return [];

  // Pass 1 — collect distinct tokens in source order and classify them.
  // Positional indices must be reserved before any named token is
  // numbered, otherwise a mixed body like `Hi {{1}}, on {{date}}` assigns
  // `date` index 1 as well and both slots read the same value.
  const order: Array<{ token: string; kind: 'positional' | 'named' }> = [];
  const seen = new Set<string>();
  const reserved = new Set<number>();

  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[1];
    if (seen.has(token)) continue;

    if (/^\d+$/.test(token)) {
      const index = Number(token);
      // `{{0}}` is not a slot in either dialect — treat it as literal text.
      if (index < 1) continue;
      seen.add(token);
      reserved.add(index);
      order.push({ token, kind: 'positional' });
    } else {
      seen.add(token);
      order.push({ token, kind: 'named' });
    }
  }

  // Pass 2 — number named tokens into the lowest slot no positional
  // token claimed, preserving source order among themselves.
  let cursor = 0;
  const nextFreeIndex = (): number => {
    do {
      cursor += 1;
    } while (reserved.has(cursor));
    reserved.add(cursor);
    return cursor;
  };

  return order.map(({ token, kind }) =>
    kind === 'positional'
      ? { token, kind, index: Number(token), label: `{{${token}}}` }
      : { token, kind, index: nextFreeIndex(), label: humanize(token) }
  );
}

/** True when the template uses named tokens (`{{first_name}}`). */
export function hasNamedVariables(text: string | null | undefined): boolean {
  return extractTemplateVariables(text).some((v) => v.kind === 'named');
}

/**
 * Substitute placeholder values into `text`.
 *
 * `values` is keyed by raw token (`"1"`, `"first_name"`), so the same map
 * serves both dialects. An unfilled token is left intact rather than
 * blanked — a visible `{{first_name}}` in a preview is a bug the agent
 * can see and fix, whereas a silent empty string is one they cannot.
 */
export function renderTemplateText(
  text: string,
  values: Record<string, string>
): string {
  return text.replace(TOKEN_RE, (match, token: string) => {
    const value = values[token];
    return value !== undefined && String(value).trim().length > 0
      ? String(value)
      : match;
  });
}

/**
 * Collapse a token-keyed value map into the positional `{"1": …}` shape
 * Twilio's `ContentVariables` and Meta's body `parameters` both expect.
 *
 * Ordering comes from `extractTemplateVariables`, so a named template
 * and its positional Twilio counterpart agree on which value is slot 1.
 */
export function toPositionalValues(
  text: string | null | undefined,
  values: Record<string, string>
): string[] {
  const vars = extractTemplateVariables(text);
  const out: string[] = [];
  for (const v of vars) {
    out[v.index - 1] = values[v.token] ?? '';
  }
  // Fill holes so a sparse array never serializes as `null`.
  for (let i = 0; i < out.length; i += 1) out[i] ??= '';
  return out;
}

/**
 * Build Twilio's `ContentVariables` map from an ordered positional array.
 *
 * Twilio keys `ContentVariables` by whatever token the Content template
 * actually declares: `{"1": …}` for a positional template, but
 * `{"first_name": …}` for a named one. Keying a named template
 * positionally is silently accepted by the API — Twilio just substitutes
 * nothing, and the contact receives the literal `{{first_name}}`. That is
 * the failure this function exists to prevent.
 *
 * The wire format between the composer and this module stays positional
 * (`SendTimeParams.body`), because `toPositionalValues` already ordered
 * those values by `extractTemplateVariables`. Re-extracting the same
 * tokens here recovers each value's original token, so the two functions
 * agree on which value belongs to which slot.
 */
export function toContentVariables(
  text: string | null | undefined,
  positionalValues: ReadonlyArray<string | number>
): Record<string, string> {
  const vars = extractTemplateVariables(text);

  // No parsable tokens (or no local body text — e.g. a Twilio-authored
  // template we only know by SID). Fall back to positional keys, which is
  // the pre-existing behaviour and correct for positional templates.
  if (vars.length === 0) {
    return Object.fromEntries(
      positionalValues.map((value, i) => [String(i + 1), String(value)])
    );
  }

  const out: Record<string, string> = {};
  for (const v of vars) {
    const value = positionalValues[v.index - 1];
    out[v.kind === 'named' ? v.token : String(v.index)] =
      value === undefined ? '' : String(value);
  }
  return out;
}
