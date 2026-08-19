'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { Sparkles, Hand, Undo2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { ClientAgent } from '@/features/agents/lib/agent-meta';
import { isAutoReplyLive } from '@/features/agents/lib/agent-meta';

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/agents every time the agent opens a chat.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached — a transient failure returns a default without poisoning the
// cache, so it retries on the next thread open rather than hiding the
// banner for the whole session.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(
  accountId: string
): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch('/api/ai/agents', { cache: 'no-store' });
    if (!res.ok) return { autoReplyOn: false }; // don't cache a transient failure
    const j = (await res.json()) as { agent?: ClientAgent | null };
    const status = {
      // ADR-005 D8: derived from the ONE shared definition rather than
      // recomputed here. This was the fourth copy of "is auto-reply
      // live" and the copies had already drifted.
      autoReplyOn: isAutoReplyLive(j?.agent),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false }; // don't cache
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /**
   * `conversations.ai_handoff_state` — handoff lifecycle:
   * `none` | `awaiting_human` (bot is caretaking) | `human_active`.
   */
  handoffState?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - bot active here → "AI is replying automatically" + [Take over]
 *   - bot paused here → the handoff note (if any) + [Resume AI]
 * Renders nothing when the account has no auto-reply configured, or when
 * the bot is active but a human already owns the thread (nothing to do).
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  handoffState,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations('Inbox.aiBanner');
  const { accountId } = useAuth();
  const [busy, setBusy] = useState(false);
  // Optimistic override of the pause flag so the banner flips instantly
  // on click. Derived state (no sync effect): the override applies only
  // to the thread it was set for, so switching threads or a realtime
  // update naturally falls back to the server value.
  const [pausedOverride, setPausedOverride] = useState<{
    conversationId: string;
    paused: boolean;
  } | null>(null);
  const paused =
    pausedOverride?.conversationId === conversationId
      ? pausedOverride.paused
      : disabled;
  // Resuming clears the handoff lifecycle server-side, so mirror that
  // locally too. Without this the banner would keep offering [Resume AI]
  // on a thread that was just resumed, until the realtime UPDATE landed.
  // Same per-conversation guard as `pausedOverride`: switching threads
  // falls back to the server value rather than leaking the override.
  const [resumedOverride, setResumedOverride] = useState<string | null>(null);
  const effectiveHandoffState =
    resumedOverride === conversationId ? 'none' : handoffState;

  // SWR dedupes across threads on top of the module-level cache; the key
  // is null until auth resolves, which pauses fetching.
  const { data: aiStatus } = useSWR(
    accountId ? (['ai-account-status', accountId] as const) : null,
    ([, id]) => fetchAiAccountStatus(id)
  );
  const autoReplyOn = aiStatus?.autoReplyOn ?? null;

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // "Take over" also assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t('updateError'));
          return;
        }
        setPausedOverride({ conversationId, paused });
        // Resume reopens the handoff lifecycle; taking over re-arms it via
        // the DB trigger on the agent's first message.
        setResumedOverride(paused ? null : conversationId);
        onChange?.({
          ai_autoreply_disabled: paused,
          // Take over assigns to the acting agent; resume releases only
          // the caller's own assignment. The realtime UPDATE reconciles
          // the exact value either way.
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(paused ? t('tookOver') : t('resumed'));
      } catch {
        toast.error(t('networkError'));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t]
  );

  // Account has no auto-reply → nothing to show. (Still loading → nothing.)
  if (!autoReplyOn) return null;

  // Paused here (a human took over, or the model handed off).
  if (paused) {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">{t('pausedTitle')}</p>
          {handoffSummary && (
            <p
              className="text-muted-foreground truncate"
              title={handoffSummary}
            >
              {handoffSummary}
            </p>
          )}
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t('resume')}
        </BannerButton>
      </Banner>
    );
  }

  /*
   * Escalated, waiting on a human.
   *
   * Distinct from "paused" on purpose: the assistant is still replying
   * here, on a small budget, so labelling it paused would be wrong and
   * would hide the fact that the customer is being held. Agents need to
   * see this state to know the thread is genuinely unattended.
   */
  if (effectiveHandoffState === 'awaiting_human') {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">
            {t('awaitingHumanTitle')}
          </p>
          {handoffSummary && (
            <p
              className="text-muted-foreground truncate"
              title={handoffSummary}
            >
              {handoffSummary}
            </p>
          )}
        </div>
        <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
          {t('takeOver')}
        </BannerButton>
      </Banner>
    );
  }

  /*
   * A human has replied, so the bot is silent on this thread.
   *
   * This used to `return null`, which made the state unrecoverable from
   * the UI: `human_active` mutes the assistant permanently (see
   * `resolveHandoffPosture`), but with the pause flag clear there was no
   * banner and therefore no [Resume AI] button — the operator could see
   * neither *that* the bot was off nor *why*. Threads reached this state
   * through an ordinary human reply, or wholesale via the
   * supervised-handoff backfill, and then stayed mute forever.
   *
   * Surfacing it with an explicit action is the recovery path.
   */
  if (effectiveHandoffState === 'human_active') {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">{t('humanActiveTitle')}</p>
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t('resume')}
        </BannerButton>
      </Banner>
    );
  }

  // Active, but a human already owns it → the bot won't fire; no banner.
  if (assignedAgentId) return null;

  // Active on this thread.
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="text-primary h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-foreground truncate font-medium">
          {t('activeText')}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t('takeOver')}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'primary' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4',
        tone === 'primary'
          ? 'border-primary/20 bg-primary/5'
          : 'border-border bg-muted/40'
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="border-border bg-card text-foreground hover:bg-muted inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
