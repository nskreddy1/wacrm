import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reliability contract for the outbox dispatcher.
 *
 * These tests exist because the failure modes they cover are invisible in
 * normal use and catastrophic at scale: a duplicate send spams every admin
 * in a workspace, and a lost dead-letter silently stops all alerting for a
 * tenant. Each test pins one guarantee.
 */

// --- Adapter stubs (hoisted: vi.mock is lifted above imports) --------------
const { teamChatSend, slackSend } = vi.hoisted(() => ({
  teamChatSend: vi.fn(),
  slackSend: vi.fn(),
}));

vi.mock('./adapters/team-chat', () => ({
  teamChatAlertAdapter: { provider: 'team_chat', send: teamChatSend },
}));
vi.mock('./adapters/slack', () => ({
  slackAlertAdapter: { provider: 'slack', send: slackSend },
}));

// Every adapter the dispatcher imports must be stubbed, not only the ones
// these tests drive: the real modules pull in `server-only` and live
// provider clients, which makes this suite non-hermetic (and unloadable
// under Vitest). Each provider has its own adapters/*.test.ts.
vi.mock('./adapters/whatsapp', () => ({
  whatsappAlertAdapter: { provider: 'whatsapp', send: vi.fn() },
}));
vi.mock('./adapters/telegram', () => ({
  telegramAlertAdapter: { provider: 'telegram', send: vi.fn() },
}));
vi.mock('./adapters/email', () => ({
  emailAlertAdapter: { provider: 'email', send: vi.fn() },
}));

import { dispatchPendingAlerts } from './dispatcher';
import { MAX_ATTEMPTS } from './types';

// --- Minimal chainable Supabase test double -------------------------------
interface Recorded {
  table: string;
  op: 'select' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/**
 * Routes each terminal query to a caller-supplied handler. Mirrors the
 * PostgREST builder shape the dispatcher actually uses (chained filters
 * that resolve either on `.select()` or on await).
 */
function makeDb(opts: {
  due: unknown[];
  destinations: unknown[];
  /** Rows returned by the CAS claim update; [] simulates a lost race. */
  claimResult?: unknown[];
}) {
  const recorded: Recorded[] = [];

  const builder = (table: string) => {
    const state: Recorded = { table, op: 'select', filters: [] };
    let resolved: unknown[] | null = null;

    const api: Record<string, unknown> = {
      select() {
        // On an update chain, .select() is the CAS "did it match?" read.
        if (state.op === 'update') {
          resolved = opts.claimResult ?? [{ id: 'claimed' }];
          recorded.push({ ...state, filters: [...state.filters] });
          return Promise.resolve({ data: resolved, error: null });
        }
        return api;
      },
      update(payload: Record<string, unknown>) {
        state.op = 'update';
        state.payload = payload;
        return api;
      },
      in(col: string, val: unknown) {
        state.filters.push([col, val]);
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters.push([col, val]);
        return api;
      },
      lte(col: string, val: unknown) {
        state.filters.push([col, val]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      // Awaiting a chain that never called .select() (plain updates) or the
      // terminal read for select chains.
      then(onFulfilled: (v: unknown) => unknown) {
        recorded.push({ ...state, filters: [...state.filters] });
        const data =
          state.op === 'update'
            ? null
            : state.table === 'alert_deliveries'
              ? opts.due
              : opts.destinations;
        return Promise.resolve({ data, error: null }).then(onFulfilled);
      },
    };
    return api;
  };

  return {
    db: { from: (t: string) => builder(t) } as never,
    recorded,
    /** Last update payload written to a table (the outcome write). */
    updatesTo(table: string) {
      return recorded
        .filter((r) => r.table === table && r.op === 'update')
        .map((r) => r.payload as Record<string, unknown>);
    },
  };
}

const DEST_ID = 'dest-1';
const dueRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'del-1',
  account_id: 'acc-1',
  notification_id: 'note-1',
  destination_id: DEST_ID,
  status: 'pending',
  payload: { title: 'Customer waiting', body: '5 min', notification_type: 'x' },
  attempts: 0,
  next_attempt_at: new Date(Date.now() - 1000).toISOString(),
  last_error: null,
  ...over,
});

const destination = (over: Partial<Record<string, unknown>> = {}) => ({
  id: DEST_ID,
  account_id: 'acc-1',
  provider: 'team_chat',
  display_name: 'Team chat',
  config: {},
  credentials_encrypted: null,
  event_types: ['ai_escalation'],
  enabled: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('dispatchPendingAlerts', () => {
  it('marks a delivery sent when the adapter succeeds', async () => {
    teamChatSend.mockResolvedValue({ ok: true });
    const { db, updatesTo } = makeDb({
      due: [dueRow()],
      destinations: [destination()],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ claimed: 1, sent: 1, failed: 0, dead: 0 });
    expect(updatesTo('alert_deliveries')).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'sent' })])
    );
  });

  it('skips the row when another tick already claimed it (no double send)', async () => {
    teamChatSend.mockResolvedValue({ ok: true });
    // CAS matched zero rows => a concurrent tick owns this delivery.
    const { db } = makeDb({
      due: [dueRow()],
      destinations: [destination()],
      claimResult: [],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ claimed: 0, sent: 0 });
    expect(teamChatSend).not.toHaveBeenCalled();
  });

  it('schedules a backoff retry on a transient failure', async () => {
    teamChatSend.mockResolvedValue({
      ok: false,
      retryable: true,
      error: 'timeout',
    });
    const { db, updatesTo } = makeDb({
      due: [dueRow()],
      destinations: [destination()],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ failed: 1, dead: 0, sent: 0 });
    const retry = updatesTo('alert_deliveries').find(
      (u) => u.status === 'failed'
    );
    expect(retry).toBeDefined();
    // Backoff must push the next attempt into the future, not retry hot.
    expect(
      new Date(retry!.next_attempt_at as string).getTime()
    ).toBeGreaterThan(Date.now());
  });

  it('dead-letters immediately on a permanent provider error', async () => {
    teamChatSend.mockResolvedValue({
      ok: false,
      retryable: false,
      error: 'channel_not_found',
    });
    const { db, updatesTo } = makeDb({
      due: [dueRow()],
      destinations: [destination()],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ dead: 1, failed: 0 });
    expect(updatesTo('alert_deliveries')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'dead',
          last_error: 'channel_not_found',
        }),
      ])
    );
  });

  it('dead-letters once attempts are exhausted, even if retryable', async () => {
    teamChatSend.mockResolvedValue({
      ok: false,
      retryable: true,
      error: 'timeout',
    });
    const { db, updatesTo } = makeDb({
      due: [dueRow({ attempts: MAX_ATTEMPTS - 1 })],
      destinations: [destination()],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ dead: 1, failed: 0 });
    const deadWrite = updatesTo('alert_deliveries').find(
      (u) => u.status === 'dead'
    );
    expect(deadWrite!.last_error).toContain('max attempts');
  });

  it('dead-letters when the destination was disabled after enqueue', async () => {
    const { db, updatesTo } = makeDb({
      due: [dueRow()],
      destinations: [destination({ enabled: false })],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res).toMatchObject({ dead: 1 });
    expect(teamChatSend).not.toHaveBeenCalled();
    expect(updatesTo('alert_deliveries')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ last_error: 'Destination is disabled' }),
      ])
    );
  });

  it('defers instead of failing when no adapter exists for the provider', async () => {
    const { db, updatesTo } = makeDb({
      due: [dueRow()],
      destinations: [destination({ provider: 'telegram' })],
    });

    const res = await dispatchPendingAlerts(db);

    // Not dead, not failed — parked until the adapter ships.
    expect(res).toMatchObject({ dead: 0, failed: 0, sent: 0 });
    const deferred = updatesTo('alert_deliveries').find((u) =>
      String(u.last_error ?? '').includes('No adapter')
    );
    expect(deferred).toBeDefined();
    // The claim attempt is rolled back so no retry budget is burned.
    expect(deferred!.attempts).toBe(0);
  });

  it('loads destinations in one batched query regardless of batch size', async () => {
    teamChatSend.mockResolvedValue({ ok: true });
    const { db, recorded } = makeDb({
      due: [
        dueRow({ id: 'd1' }),
        dueRow({ id: 'd2' }),
        dueRow({ id: 'd3' }),
        dueRow({ id: 'd4' }),
      ],
      destinations: [destination()],
    });

    await dispatchPendingAlerts(db);

    const destReads = recorded.filter(
      (r) => r.table === 'alert_destinations' && r.op === 'select'
    );
    expect(destReads).toHaveLength(1);
  });

  it('returns a zero result when nothing is due', async () => {
    const { db } = makeDb({ due: [], destinations: [] });

    await expect(dispatchPendingAlerts(db)).resolves.toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      dead: 0,
    });
  });

  it('isolates a poisoned row so the rest of the batch still sends', async () => {
    teamChatSend
      .mockRejectedValueOnce(new Error('adapter exploded'))
      .mockResolvedValue({ ok: true });
    const { db } = makeDb({
      due: [dueRow({ id: 'bad' }), dueRow({ id: 'good' })],
      destinations: [destination()],
    });

    const res = await dispatchPendingAlerts(db);

    expect(res.claimed).toBe(2);
    expect(res.sent).toBe(1);
  });
});
