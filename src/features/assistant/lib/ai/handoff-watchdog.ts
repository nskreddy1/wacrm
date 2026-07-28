import type { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { enqueueAlertDeliveries } from '@/features/alerts/lib/enqueue';

/**
 * Unattended-handoff watchdog.
 *
 * The caretaker keeps the *customer* company, but it cannot make a human
 * show up. Without this sweep an escalation that nobody opens decays
 * silently: the caretaker spends its 3 messages, goes quiet, and the
 * thread sits in the queue indefinitely. That is precisely the failure
 * the supervised-handoff work set out to remove, so the internal half of
 * the loop has to exist too.
 *
 * Escalation ladder, by wait time:
 *   overdue      → re-notify the assignee (or the whole account if the
 *                  thread is unassigned)
 *   critical     → also notify every OTHER member, on the assumption the
 *                  assignee is unavailable rather than merely slow
 *
 * The sweep is idempotent: `find_overdue_handoffs` filters on a
 * re-notify cool-off and `mark_handoff_sla_notified` records each pass,
 * so running it every minute cannot spam the team about one thread.
 */

/** Tunables. Deliberately conservative — this pings real humans. */
export const HANDOFF_SLA = {
  /** Minutes with no human reply before the first nudge. */
  overdueMinutes: 10,
  /** Minutes before the whole team is pulled in. */
  criticalMinutes: 30,
  /** Minimum gap between nudges for the same thread. */
  renotifyMinutes: 15,
  /** Max threads per tick, so one bad backlog can't melt a run. */
  batchLimit: 100,
} as const;

/** One row from `find_overdue_handoffs`. */
interface OverdueHandoff {
  conversation_id: string;
  account_id: string;
  contact_id: string | null;
  assigned_agent_id: string | null;
  escalated_at: string;
  waiting_minutes: number;
  reminder_count: number;
  escalation_reason: string | null;
  sentiment: string | null;
}

export interface SweepResult {
  scanned: number;
  notified: number;
  escalated: number;
}

/** Human-readable nudge copy. Sharpens as the wait grows. */
function buildNudge(row: OverdueHandoff): { title: string; body: string } {
  const reason = (row.escalation_reason ?? 'handoff').replace(/_/g, ' ');
  const feeling =
    row.sentiment && row.sentiment !== 'neutral'
      ? `, customer seems ${row.sentiment}`
      : '';
  const critical = row.waiting_minutes >= HANDOFF_SLA.criticalMinutes;
  return {
    title: critical
      ? 'Customer still waiting — please pick up'
      : 'Customer waiting on a reply',
    body: critical
      ? `No reply for ${row.waiting_minutes} min after an AI handoff (${reason}${feeling}). The assistant has stopped holding the chat.`
      : `Waiting ${row.waiting_minutes} min since the AI handed off (${reason}${feeling}).`,
  };
}

/**
 * Run one watchdog tick.
 *
 * Exported separately from the route so it can be unit-tested and
 * dry-run without HTTP. Per-thread failures are swallowed and logged so
 * one bad row cannot abort the whole sweep.
 */
export async function sweepOverdueHandoffs(
  db: ReturnType<typeof supabaseAdmin>
): Promise<SweepResult> {
  const { data, error } = await db.rpc('find_overdue_handoffs', {
    p_overdue_minutes: HANDOFF_SLA.overdueMinutes,
    p_renotify_minutes: HANDOFF_SLA.renotifyMinutes,
    p_limit: HANDOFF_SLA.batchLimit,
  });

  if (error) {
    console.error('[handoff-watchdog] find_overdue_handoffs failed:', error);
    return { scanned: 0, notified: 0, escalated: 0 };
  }

  const rows = (data ?? []) as OverdueHandoff[];
  let notified = 0;
  let escalated = 0;

  for (const row of rows) {
    try {
      const { title, body } = buildNudge(row);
      const critical = row.waiting_minutes >= HANDOFF_SLA.criticalMinutes;

      // Who hears about it? The assignee normally; everyone once it is
      // critical or the thread was never assigned (nobody "owns" the
      // silence, so the whole account does).
      let recipients: string[] = [];
      if (row.assigned_agent_id && !critical) {
        recipients = [row.assigned_agent_id];
      } else {
        const { data: members } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', row.account_id);
        recipients = (members ?? []).map(
          (m: { user_id: string }) => m.user_id
        );
        if (critical) escalated += 1;
      }
      if (recipients.length === 0) continue;

      const { data: inserted, error: insErr } = await db
        .from('notifications')
        .insert(
          recipients.map((userId) => ({
            account_id: row.account_id,
            user_id: userId,
            type: 'ai_escalation',
            conversation_id: row.conversation_id,
            contact_id: row.contact_id,
            actor_user_id: null,
            title,
            body,
          }))
        )
        .select('id');
      if (insErr) {
        console.error('[handoff-watchdog] notification insert failed:', insErr);
        // Do NOT mark as notified — let the next tick retry, otherwise a
        // transient insert failure would permanently swallow the nudge.
        continue;
      }

      // Fan out to external alert destinations (team chat, Slack, ...).
      // Anchored on the FIRST inserted notification so each external
      // channel hears about the event exactly once, no matter how many
      // recipients got in-app rows. Failure-isolated: a broken alert pipe
      // must never break the in-app path that already works.
      const anchorId = inserted?.[0]?.id;
      if (anchorId) {
        try {
          await enqueueAlertDeliveries(db, {
            accountId: row.account_id,
            notificationId: anchorId,
            notificationType: 'ai_escalation',
            payload: {
              title,
              body,
              conversation_id: row.conversation_id,
              notification_type: 'ai_escalation',
            },
          });
        } catch (alertErr) {
          console.error(
            '[handoff-watchdog] alert enqueue failed (non-fatal):',
            alertErr instanceof Error ? alertErr.message : alertErr
          );
        }
      }

      // Record the pass so the cool-off applies from here.
      const { error: markErr } = await db.rpc('mark_handoff_sla_notified', {
        p_conversation_id: row.conversation_id,
      });
      if (markErr) {
        console.error('[handoff-watchdog] mark notified failed:', markErr);
      }
      notified += 1;
    } catch (err) {
      console.error(
        '[handoff-watchdog] row failed:',
        row.conversation_id,
        err
      );
    }
  }

  return { scanned: rows.length, notified, escalated };
}
