// ============================================================
// `plans` reads (ADR-002 §A / ARCH-005).
//
// SQL only. Every pricing DECISION — is the amount an integer, is it
// above zero, is the currency well-formed, does a provider ref exist —
// stays in the route handler. This module must never decide what a
// customer can be charged; it only fetches the row that decides.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SessionDb } from './client';

/**
 * The catalogue row backing a checkout (F1).
 *
 * `provider_refs` IS selected here, unlike the display query below: the
 * checkout path needs it to map our tier id onto the provider's plan id.
 */
export interface CheckoutPlanRow {
  id: string;
  name: string | null;
  is_active: boolean | null;
  price_monthly: number | null;
  price_yearly: number | null;
  currency: string | null;
  provider_refs: unknown;
}

/**
 * Load one plan by its tier id for the checkout path.
 *
 * Deliberately does NOT filter on `is_active`: the route distinguishes
 * "unknown" from "inactive" and collapses them into one response itself.
 * Filtering here would make that collapse invisible to a reader of the
 * route and impossible to change without touching SQL.
 *
 * `maybeSingle()` so a missing plan is `null`, not a thrown error.
 */
export async function findPlanForCheckout(
  db: SupabaseClient,
  planId: string
): Promise<{ data: CheckoutPlanRow | null; error: { message: string } | null }> {
  const { data, error } = await db
    .from('plans')
    .select(
      'id, name, is_active, price_monthly, price_yearly, currency, provider_refs'
    )
    .eq('id', planId)
    .maybeSingle();

  return { data: (data as CheckoutPlanRow | null) ?? null, error };
}

/**
 * The purchasable catalogue for the plan picker (11.4/11.5).
 *
 * `provider_refs` is NOT selected. It holds our provider-side plan
 * handles, which the UI never needs and which are exactly what an
 * attacker probing our billing account would want. Prices are read here
 * for DISPLAY only — the amount actually charged is re-resolved
 * server-side from this same table by /api/billing/checkout (F1), so a
 * tampered client cannot turn a displayed number into a charge.
 *
 * Runs on the CALLER'S session client: `plans` is global reference data
 * whose RLS policy is `USING (true)` for `authenticated`, so this needs
 * no service-role escalation.
 */
export function listActivePlans(db: SessionDb) {
  return db
    .from('plans')
    .select(
      'id, display_name, description, price_monthly, price_yearly, currency, features, badge, is_default, sort_order'
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
}
