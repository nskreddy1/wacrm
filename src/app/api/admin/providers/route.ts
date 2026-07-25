// ============================================================
// /api/admin/providers — platform-wide provider governance.
//
//   GET   — the full provider catalog (every provider × channel),
//           each with its platform policy (enabled/disabled + note)
//           and usage counts, PLUS the cross-workspace fleet view:
//           every tenant connection with MASKED sender identity.
//   PATCH — flip a provider's platform-wide availability or edit
//           its operator note. Audited.
//
// Security review notes (per the security-review skill):
//   • requireSuperAdmin() gates both methods — RLS on the policies
//     table has no policies, so the service role is the only path.
//   • The fleet view never selects credentials_encrypted, and
//     sender identities are masked server-side before leaving the
//     API. Consent framing: operators see that a connection exists
//     and its health, not the tenant's secrets.
//   • Disabling a provider does NOT delete tenant rows — it only
//     stops NEW connections/enables (enforced in the workspace
//     settings route), so no tenant data is destroyed silently.
//   • Every PATCH writes platform_audit_log.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { platformAdmin } from '@/features/admin/lib/platform/admin-client';
import { createChannelAdapter } from '@/features/channels/lib/adapters';
import {
  PROVIDER_CHANNELS,
  PROVIDER_LABEL,
} from '@/features/channels/lib/provider-registry';
import type { ChannelKind, ChannelProvider } from '@/types';

const ALL_PROVIDERS = [
  'meta',
  'twilio',
  'google',
  'microsoft',
  'resend',
  'smtp',
  'mailtrap',
] as const;
const ALL_CHANNELS = ['whatsapp', 'sms', 'email'] as const;

const patchSchema = z.object({
  provider: z.enum(ALL_PROVIDERS),
  channel: z.enum(ALL_CHANNELS),
  isEnabled: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** Mask a sender identity: keep enough to recognize, never the whole. */
function maskIdentity(identity: string | null): string {
  if (!identity) return '—';
  if (identity.includes('@')) {
    const [local, domain] = identity.split('@');
    const head = local.slice(0, 2);
    return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }
  if (identity.length <= 6) return `${identity.slice(0, 2)}••••`;
  return `${identity.slice(0, 4)}${'•'.repeat(4)}${identity.slice(-2)}`;
}

export async function GET() {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const [policiesResult, connectionsResult, accountsResult] =
      await Promise.all([
        admin
          .from('platform_provider_policies')
          .select('provider, channel, is_enabled, notes, updated_at'),
        admin
          .from('channel_connections')
          .select(
            'id, account_id, channel, provider, display_name, external_identity, status, is_enabled, is_primary, managed_by, last_connected_at, last_error, created_at'
          )
          .order('created_at', { ascending: false }),
        admin.from('accounts').select('id, name'),
      ]);
    if (policiesResult.error) throw policiesResult.error;
    if (connectionsResult.error) throw connectionsResult.error;
    if (accountsResult.error) throw accountsResult.error;

    const policyMap = new Map(
      (policiesResult.data ?? []).map((row) => [
        `${row.provider}|${row.channel}`,
        row,
      ])
    );
    const accountNames = new Map(
      (accountsResult.data ?? []).map((row) => [row.id, row.name])
    );

    const connections = connectionsResult.data ?? [];

    // Catalog: every provider × compatible channel.
    const catalog = ALL_PROVIDERS.flatMap((provider) =>
      PROVIDER_CHANNELS[provider as ChannelProvider].map((channel) => {
        const policy = policyMap.get(`${provider}|${channel}`);
        const rows = connections.filter(
          (c) => c.provider === provider && c.channel === channel
        );
        return {
          provider,
          channel,
          label: PROVIDER_LABEL[provider as ChannelProvider],
          implemented: Boolean(
            createChannelAdapter(provider as ChannelProvider, channel)
          ),
          // No policy row = enabled by default.
          isEnabled: policy ? policy.is_enabled : true,
          notes: policy?.notes ?? null,
          updatedAt: policy?.updated_at ?? null,
          usage: {
            total: rows.length,
            active: rows.filter((c) => c.is_enabled).length,
            degraded: rows.filter((c) => c.status === 'degraded').length,
          },
        };
      })
    );

    // Fleet: masked, credential-free tenant connections.
    const fleet = connections.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      accountName: accountNames.get(row.account_id) ?? 'Unknown workspace',
      channel: row.channel as ChannelKind,
      provider: row.provider as ChannelProvider,
      providerLabel: PROVIDER_LABEL[row.provider as ChannelProvider],
      displayName: row.display_name,
      maskedIdentity: maskIdentity(row.external_identity),
      status: row.status,
      isEnabled: row.is_enabled,
      isPrimary: row.is_primary,
      managedBy: row.managed_by,
      lastConnectedAt: row.last_connected_at,
      lastError: row.last_error,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ catalog, fleet });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid provider policy payload' },
        { status: 400 }
      );
    }
    const { provider, channel } = parsed.data;

    if (
      !PROVIDER_CHANNELS[provider as ChannelProvider].includes(
        channel as ChannelKind
      )
    ) {
      return NextResponse.json(
        { error: `${provider} does not support ${channel}` },
        { status: 400 }
      );
    }

    const { data: before } = await admin
      .from('platform_provider_policies')
      .select('is_enabled, notes')
      .eq('provider', provider)
      .eq('channel', channel)
      .maybeSingle();

    const values = {
      provider,
      channel,
      is_enabled: parsed.data.isEnabled ?? before?.is_enabled ?? true,
      notes:
        parsed.data.notes !== undefined
          ? parsed.data.notes || null
          : (before?.notes ?? null),
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await admin
      .from('platform_provider_policies')
      .upsert(values, { onConflict: 'provider,channel' })
      .select('provider, channel, is_enabled, notes, updated_at')
      .single();
    if (error || !saved) {
      console.error('[PATCH /api/admin/providers] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save provider policy' },
        { status: 500 }
      );
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId: null,
      action: saved.is_enabled
        ? 'provider.policy_enabled'
        : 'provider.policy_disabled',
      entity: `provider_policy:${provider}:${channel}`,
      before: before
        ? { is_enabled: before.is_enabled, notes: before.notes }
        : null,
      after: { is_enabled: saved.is_enabled, notes: saved.notes },
    });

    return NextResponse.json({ policy: saved });
  } catch (err) {
    return toErrorResponse(err);
  }
}
