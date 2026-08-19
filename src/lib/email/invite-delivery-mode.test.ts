import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// The security property under test: email is sent ONLY when a
// platform operator has explicitly enabled it. Every other
// state — missing row, unreadable table, garbage value — must
// resolve to 'link_only'.
// ============================================================

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

import {
  getInviteDeliveryMode,
  resetInviteDeliveryModeCache,
  isInviteDeliveryMode,
  DEFAULT_INVITE_DELIVERY_MODE,
} from './invite-delivery-mode';

describe('invite delivery mode', () => {
  beforeEach(() => {
    resetInviteDeliveryModeCache();
    maybeSingle.mockReset();
    delete process.env.INVITE_DELIVERY_MODE;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInviteDeliveryModeCache();
  });

  it('defaults to link_only (fail closed)', () => {
    expect(DEFAULT_INVITE_DELIVERY_MODE).toBe('link_only');
  });

  it('returns link_only when no setting row exists', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
  });

  it('returns email only when an operator explicitly enabled it', async () => {
    maybeSingle.mockResolvedValue({ data: { value: 'email' }, error: null });
    await expect(getInviteDeliveryMode()).resolves.toBe('email');
  });

  it('returns link_only when the stored value is garbage', async () => {
    // A typo'd or tampered value must not be read as consent to send.
    maybeSingle.mockResolvedValue({ data: { value: 'EMAIL yes' }, error: null });
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
  });

  it('returns link_only when the settings table errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
  });

  it('returns link_only when the read throws', async () => {
    maybeSingle.mockRejectedValue(new Error('network down'));
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
  });

  it('does not cache a failed read (recovers on next call)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
    // Table recovers and an operator had it enabled all along.
    maybeSingle.mockResolvedValueOnce({ data: { value: 'email' }, error: null });
    await expect(getInviteDeliveryMode()).resolves.toBe('email');
  });

  it('env var applies only when no DB row exists', async () => {
    process.env.INVITE_DELIVERY_MODE = 'email';
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getInviteDeliveryMode()).resolves.toBe('email');
  });

  it('DB row beats the env var', async () => {
    process.env.INVITE_DELIVERY_MODE = 'email';
    maybeSingle.mockResolvedValue({
      data: { value: 'link_only' },
      error: null,
    });
    await expect(getInviteDeliveryMode()).resolves.toBe('link_only');
  });

  it('caches within the TTL (one read for repeat calls)', async () => {
    maybeSingle.mockResolvedValue({ data: { value: 'email' }, error: null });
    await getInviteDeliveryMode();
    await getInviteDeliveryMode();
    await getInviteDeliveryMode();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('validates the mode type guard', () => {
    expect(isInviteDeliveryMode('email')).toBe(true);
    expect(isInviteDeliveryMode('link_only')).toBe(true);
    expect(isInviteDeliveryMode('true')).toBe(false);
    expect(isInviteDeliveryMode(true)).toBe(false);
    expect(isInviteDeliveryMode(null)).toBe(false);
    expect(isInviteDeliveryMode(undefined)).toBe(false);
  });
});
