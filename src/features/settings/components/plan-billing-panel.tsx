'use client';

// ============================================================
// Subscription & billing — ADR-009 Task 11 (11.1–11.6).
//
// The customer-facing half of the payments feature: what plan this
// workspace is on, what it costs, what has actually been charged,
// and the two actions available (upgrade, cancel).
//
// THE RULE THIS COMPONENT EXISTS TO RESPECT: the client is a
// display surface, never an authority.
//
//   - Every price rendered here is DISPLAY ONLY. `/api/billing/checkout`
//     re-resolves the amount server-side from `plans` and ignores any
//     number a client could send (F1). A tampered price in this file
//     changes what the user *reads*, never what they are *charged*.
//   - "Cancel" sends a REQUEST. It does not flip entitlement, and this
//     UI must not claim it did (8.2). Copy says "Cancellation
//     requested" until a signed provider event confirms it.
//   - Role checks here are cosmetic. `requireRole('admin')` guards the
//     GET and `requireRole('owner')` guards the DELETE server-side; we
//     mirror them only so members are not shown controls that would
//     403. Hiding a button is not the security boundary.
//   - `paymentsEnabled` (D3) decides between a real Upgrade button and
//     a "contact us" line, so a deployment with no provider credentials
//     never shows a control whose only outcome is a 503.
//
// Money is INTEGER MINOR UNITS everywhere on the wire (149900 =
// ₹1,499.00), matching `plans.price_monthly` and
// `payment_transactions.amount_minor`. It is divided by 100 exactly
// once, at the render boundary, by `formatMinor`.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { formatCurrencyPrecise } from '@/lib/currency';

type Interval = 'monthly' | 'yearly';

interface Subscription {
  id: string;
  plan_id: string;
  status: string;
  interval: Interval | null;
  amount_minor: number | null;
  currency: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  cancel_request_status: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  cancellationPending: boolean;
}

interface Transaction {
  id: string;
  kind: 'charge' | 'refund' | 'chargeback';
  amount_minor: number | null;
  currency: string | null;
  occurred_at: string | null;
  created_at: string;
}

interface PendingCheckout {
  id: string;
  plan_id: string;
  interval: Interval;
  amount_minor: number | null;
  currency: string | null;
  status: string;
  created_at: string;
}

interface Plan {
  id: string;
  display_name: string;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  currency: string | null;
  features: unknown;
  badge: string | null;
  is_default: boolean | null;
  sort_order: number | null;
}

interface BillingPayload {
  subscription: Subscription | null;
  transactions: Transaction[];
  pendingCheckout: PendingCheckout | null;
  plans: Plan[];
  paymentsEnabled: boolean;
}

const fetcher = async (url: string): Promise<BillingPayload> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? 'Failed to load billing details');
  }
  return (await res.json()) as BillingPayload;
};

/**
 * Minor units → localised money. The ONLY place the /100 happens.
 *
 * `null` is rendered as an em dash rather than 0: a missing amount and
 * a zero amount mean very different things on a billing screen, and
 * showing "₹0.00" for "we don't know" would be a lie about money.
 */
function formatMinor(minor: number | null, currency: string | null): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '—';
  return formatCurrencyPrecise(minor / 100, currency ?? undefined);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Subscription status → how loudly to say it.
 *
 * Unknown statuses fall through to the neutral badge rather than being
 * dropped: a status we do not recognise is still information the
 * customer should see, and silently hiding it would mask exactly the
 * divergence reconciliation exists to surface.
 */
const STATUS_TONE: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  active: { label: 'Active', variant: 'default' },
  trialing: { label: 'Trialing', variant: 'secondary' },
  past_due: { label: 'Past due', variant: 'destructive' },
  unpaid: { label: 'Unpaid', variant: 'destructive' },
  paused: { label: 'Paused', variant: 'secondary' },
  canceled: { label: 'Canceled', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
  incomplete: { label: 'Incomplete', variant: 'secondary' },
  expired: { label: 'Expired', variant: 'secondary' },
};

const LEDGER_TONE: Record<
  Transaction['kind'],
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  charge: { label: 'Charge', variant: 'secondary' },
  refund: { label: 'Refund', variant: 'outline' },
  chargeback: { label: 'Chargeback', variant: 'destructive' },
};

/**
 * Only ever hand the browser an http(s) destination.
 *
 * `authorizeUrl` originates from the payment provider and reaches us
 * through our own API, so it is two hops from trusted. If either hop
 * were ever compromised, a `javascript:` or `data:` URL assigned to
 * `location` would execute in the session's origin. Parsing and
 * whitelisting the scheme costs nothing and removes that class
 * entirely.
 */
function isSafeRedirect(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function PlanBillingPanel() {
  const { accountRole } = useAuth();

  // Mirrors the server's `requireRole('admin')` on GET. Financial
  // history is settings-level data, so agents/viewers get no fetch at
  // all rather than a 403 rendered as an error.
  const canViewBilling = accountRole === 'owner' || accountRole === 'admin';
  const isOwner = accountRole === 'owner';

  const { data, error, isLoading, mutate } = useSWR<BillingPayload>(
    canViewBilling ? '/api/billing/subscription' : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // A checkout in flight or a subscription mid-transition is state
      // the PROVIDER owns and will resolve out-of-band via webhook.
      // Poll until it settles; stay quiet once it has.
      refreshInterval: (latest) =>
        latest?.pendingCheckout ||
        latest?.subscription?.status === 'incomplete' ||
        latest?.subscription?.cancellationPending
          ? 5000
          : 0,
    }
  );

  const [interval, setInterval] = useState<Interval>('monthly');
  // Guards against a double-click becoming two checkout journeys. The
  // server is idempotent per account (it resumes an in-flight intent
  // rather than creating a second), but not asking twice is cheaper
  // than relying on that.
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!canViewBilling) {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        Billing is managed by workspace owners and admins.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-muted-foreground text-sm">
        {error instanceof Error
          ? error.message
          : 'Billing details are unavailable right now. Try again in a moment.'}
      </p>
    );
  }

  const { subscription, transactions, pendingCheckout, plans, paymentsEnabled } =
    data;

  const currentPlanId = subscription?.plan_id ?? null;
  const status = subscription?.status ?? null;
  const statusTone = status
    ? (STATUS_TONE[status] ?? { label: status, variant: 'secondary' as const })
    : null;

  async function startCheckout(planId: string) {
    setBusyPlanId(planId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Exactly the two fields the server's `.strict()` schema
        // accepts. Notably NOT the amount — the server resolves that
        // itself and any extra key here is a 400 by design (F1).
        body: JSON.stringify({ planId, interval }),
      });
      const body = (await res.json().catch(() => null)) as {
        authorizeUrl?: string;
        message?: string;
      } | null;

      if (!res.ok) {
        toast.error(body?.message ?? 'Could not start checkout.');
        return;
      }
      if (!isSafeRedirect(body?.authorizeUrl)) {
        toast.error('Received an invalid payment link. Please contact support.');
        return;
      }
      // Full navigation, not a new tab: the provider owns this journey
      // and returns the user to our return page when it completes.
      window.location.assign(body.authorizeUrl);
    } catch {
      toast.error('Could not reach the payment provider. Please try again.');
    } finally {
      setBusyPlanId(null);
    }
  }

  async function requestCancel() {
    setCancelling(true);
    try {
      const res = await fetch('/api/billing/subscription', {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!res.ok) {
        toast.error(body?.message ?? 'Could not request cancellation.');
        return;
      }
      // Deliberately NOT "Subscription cancelled". We have recorded a
      // request; the provider has not confirmed it yet (8.2).
      toast.success('Cancellation requested.');
      setConfirmOpen(false);
      await mutate();
    } catch {
      toast.error('Could not request cancellation. Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Current subscription ---------- */}
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Subscription</span>
          <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {subscription
              ? (plans.find((p) => p.id === subscription.plan_id)
                  ?.display_name ?? subscription.plan_id)
              : 'No paid subscription'}
            {statusTone && (
              <Badge variant={statusTone.variant}>{statusTone.label}</Badge>
            )}
          </span>
          {subscription && (
            <span className="text-muted-foreground text-sm tabular-nums">
              {formatMinor(subscription.amount_minor, subscription.currency)}
              {subscription.interval ? ` / ${subscription.interval}` : ''}
            </span>
          )}
        </div>

        {subscription?.current_period_end && (
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-muted-foreground text-xs">
              {subscription.cancellationPending ? 'Access until' : 'Renews'}
            </span>
            <span className="text-sm tabular-nums">
              {formatDate(subscription.current_period_end)}
            </span>
          </div>
        )}
      </header>

      {/* Honest state notices. Each says only what we actually know. */}
      {subscription?.cancellationPending && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-relaxed">
          Cancellation requested. Your workspace keeps full access until{' '}
          {formatDate(subscription.current_period_end)}. We are confirming this
          with the payment provider — nothing changes until then.
        </p>
      )}

      {(status === 'past_due' || status === 'unpaid') && (
        <p className="border-destructive/40 text-foreground rounded-lg border p-4 text-sm leading-relaxed">
          We could not collect your last payment. Your workspace is still
          active, but please update your payment method with the provider to
          avoid interruption.
        </p>
      )}

      {pendingCheckout && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-relaxed">
          A checkout for{' '}
          <span className="text-foreground font-medium">
            {plans.find((p) => p.id === pendingCheckout.plan_id)
              ?.display_name ?? pendingCheckout.plan_id}
          </span>{' '}
          is still in progress. This page updates automatically once the
          provider confirms it.
        </p>
      )}

      {/* ---------- Plan picker ---------- */}
      <section className="flex flex-col gap-4" aria-label="Available plans">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Plans</h3>
          {paymentsEnabled && (
            <div
              role="group"
              aria-label="Billing interval"
              className="bg-muted flex items-center gap-1 rounded-md p-1"
            >
              {(['monthly', 'yearly'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  aria-pressed={interval === value}
                  className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
                    interval === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>

        {!paymentsEnabled && (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-relaxed">
            Online purchase is not available on this deployment. Contact us to
            change your plan.
          </p>
        )}

        <ul className="grid gap-3 md:grid-cols-2">
          {plans.map((plan) => {
            const priceMinor =
              interval === 'monthly' ? plan.price_monthly : plan.price_yearly;
            const isCurrent = plan.id === currentPlanId;
            // A NULL price is a "contact sales" tier and a 0 price is
            // the granted free tier. Neither is purchasable, and NULL
            // must never be coerced to 0 — that would render a paid
            // plan as free.
            const isContactSales =
              typeof priceMinor !== 'number' || !Number.isFinite(priceMinor);
            const isFree = !isContactSales && priceMinor <= 0;
            const purchasable =
              paymentsEnabled && !isCurrent && !isContactSales && !isFree;

            return (
              <li
                key={plan.id}
                className="flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {plan.display_name}
                    {plan.badge && (
                      <Badge variant="secondary" className="text-[11px]">
                        {plan.badge}
                      </Badge>
                    )}
                    {isCurrent && <Badge variant="outline">Current</Badge>}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {isContactSales
                      ? 'Custom'
                      : isFree
                        ? 'Free'
                        : formatMinor(priceMinor, plan.currency)}
                    {!isContactSales && !isFree && (
                      <span className="text-muted-foreground text-xs font-normal">
                        {interval === 'monthly' ? ' / month' : ' / year'}
                      </span>
                    )}
                  </span>
                  {plan.description && (
                    <span className="text-muted-foreground text-xs leading-relaxed">
                      {plan.description}
                    </span>
                  )}
                </div>

                {purchasable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyPlanId !== null || Boolean(pendingCheckout)}
                    onClick={() => startCheckout(plan.id)}
                  >
                    {busyPlanId === plan.id ? 'Redirecting…' : 'Choose plan'}
                  </Button>
                ) : isContactSales ? (
                  <span className="text-muted-foreground text-xs">
                    Contact us for pricing
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- Ledger ---------- */}
      <section className="flex flex-col gap-3" aria-label="Billing history">
        <h3 className="text-sm font-semibold">Billing history</h3>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No payments yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {transactions.map((tx) => {
              const tone = LEDGER_TONE[tx.kind] ?? {
                label: tx.kind,
                variant: 'secondary' as const,
              };
              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <Badge variant={tone.variant} className="text-[11px]">
                      {tone.label}
                    </Badge>
                    <span className="text-muted-foreground tabular-nums">
                      {formatDate(tx.occurred_at ?? tx.created_at)}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {/* Refunds and chargebacks move money AWAY from us;
                        showing them unsigned alongside charges would
                        misrepresent the account's history. */}
                    {tx.kind === 'charge' ? '' : '−'}
                    {formatMinor(tx.amount_minor, tx.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Cancel ---------- */}
      {subscription &&
        !subscription.cancellationPending &&
        status !== 'canceled' &&
        status !== 'cancelled' &&
        status !== 'expired' && (
          <section className="flex flex-col gap-3" aria-label="Cancel plan">
            <h3 className="text-sm font-semibold">Cancel subscription</h3>
            {isOwner ? (
              <>
                <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
                  Your workspace keeps full access until the end of the current
                  billing period. Nothing is deleted, and you can resubscribe
                  at any time.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setConfirmOpen(true)}
                >
                  Cancel subscription
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-sm leading-relaxed">
                Only the workspace owner can cancel the subscription.
              </p>
            )}
          </section>
        )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              We will ask the payment provider to stop future charges. Your
              workspace keeps full access until{' '}
              {formatDate(subscription?.current_period_end ?? null)}, and no
              data is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>
              Keep subscription
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(event) => {
                // Keep the dialog mounted until the request settles so
                // the button can show progress and cannot be re-fired.
                event.preventDefault();
                void requestCancel();
              }}
            >
              {cancelling ? 'Requesting…' : 'Request cancellation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
