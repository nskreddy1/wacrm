// Validation for super-admin plan catalog writes (/api/admin/plans).
// Lives outside the route files because Next.js route modules may
// only export HTTP handlers.

/** Columns a super admin may set. Everything else is server-owned. */
export const EDITABLE_PLAN_FIELDS = [
  'display_name',
  'description',
  'price_monthly',
  'price_yearly',
  'currency',
  'features',
  'badge',
  'is_active',
  'is_default',
  'sort_order',
  'max_contacts',
  'max_active_flows',
  'max_members',
  'max_channels',
  'monthly_messages',
  'monthly_broadcast_recipients',
  'monthly_ai_replies',
] as const;

const INT_FIELDS = new Set([
  'price_monthly',
  'price_yearly',
  'sort_order',
  'max_contacts',
  'max_active_flows',
  'max_members',
  'max_channels',
  'monthly_messages',
  'monthly_broadcast_recipients',
  'monthly_ai_replies',
]);

/**
 * Validates and narrows an incoming plan payload to editable fields.
 * Returns an error string on the first invalid field.
 */
export function sanitizePlanPatch(
  body: Record<string, unknown>
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_PLAN_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];

    if (INT_FIELDS.has(field)) {
      // NULL = unlimited (limits) or "contact us" (prices).
      if (
        value !== null &&
        (!Number.isInteger(value) || (value as number) < 0)
      ) {
        return { error: `${field} must be a non-negative integer or null` };
      }
      patch[field] = value;
    } else if (field === 'features') {
      if (
        !Array.isArray(value) ||
        value.some((f) => typeof f !== 'string' || f.length > 200)
      ) {
        return {
          error: 'features must be an array of strings (≤200 chars each)',
        };
      }
      if (value.length > 30) {
        return { error: 'features list is capped at 30 entries' };
      }
      patch[field] = value;
    } else if (field === 'is_active' || field === 'is_default') {
      if (typeof value !== 'boolean') {
        return { error: `${field} must be a boolean` };
      }
      patch[field] = value;
    } else {
      // Text fields: display_name, description, currency, badge.
      if (value !== null && typeof value !== 'string') {
        return { error: `${field} must be a string or null` };
      }
      if (typeof value === 'string' && value.length > 300) {
        return { error: `${field} is capped at 300 characters` };
      }
      if (field === 'display_name' && (value as string)?.trim() === '') {
        return { error: 'display_name cannot be empty' };
      }
      if (
        field === 'currency' &&
        value &&
        !/^[A-Z]{3}$/.test(value as string)
      ) {
        return { error: 'currency must be a 3-letter ISO code (e.g. INR)' };
      }
      patch[field] = value;
    }
  }

  return { patch };
}
