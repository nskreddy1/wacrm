'use client';

// ============================================================
// ProfilePermissionEditor — Bigin-style permission surface.
//
// Two row shapes, mirroring Zoho Bigin's profile drawer:
//   * Record rows ("Basic Permissions"): a master Switch plus an
//     action picker ("View, Create, Edit, Delete") that maps to
//     the :read / :write / :delete slugs of that entity.
//   * Feature rows (Channels / Automation / Data / Admin): a
//     single Switch per permission slug.
//
// Pure controlled component — owns no state, no I/O. The parent
// passes the current slug set and receives the next set on every
// change, so it slots into create/edit/clone flows unchanged.
// ============================================================

import { ChevronDown } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type { PermissionSlug } from '@/features/auth/lib/permissions';

// ---- Catalog shaping ---------------------------------------------------

interface RecordAction {
  key: 'read' | 'write' | 'delete';
  label: string;
  slug: PermissionSlug;
}

interface RecordRow {
  key: string;
  label: string;
  actions: RecordAction[];
}

/** Record entities shown under "Basic Permissions". */
const RECORD_ROWS: RecordRow[] = (
  [
    ['contacts', 'Contacts'],
    ['companies', 'Companies'],
    ['deals', 'Pipeline Records'],
    ['products', 'Products'],
    ['activities', 'Activities'],
  ] as const
).map(([key, label]) => ({
  key,
  label,
  actions: [
    { key: 'read', label: 'View', slug: `${key}:read` as PermissionSlug },
    {
      key: 'write',
      label: 'Create, Edit',
      slug: `${key}:write` as PermissionSlug,
    },
    {
      key: 'delete',
      label: 'Delete',
      slug: `${key}:delete` as PermissionSlug,
    },
  ],
}));

interface FeatureRow {
  slug: PermissionSlug;
  label: string;
  hint?: string;
}

interface FeatureSection {
  key: string;
  label: string;
  rows: FeatureRow[];
}

/** Non-record permissions grouped the way Bigin groups features. */
const FEATURE_SECTIONS: FeatureSection[] = [
  {
    key: 'channels',
    label: 'Channels',
    rows: [
      {
        slug: 'messages:send',
        label: 'Messages',
        hint: 'Reply in the inbox',
      },
      {
        slug: 'broadcasts:send',
        label: 'Broadcasts',
        hint: 'Send WhatsApp campaigns',
      },
      { slug: 'sms:send', label: 'SMS', hint: 'Send SMS messages' },
      {
        slug: 'templates:manage',
        label: 'Templates',
        hint: 'Create and edit message templates',
      },
      {
        slug: 'quick-replies:manage',
        label: 'Quick Replies',
        hint: 'Create and edit saved replies',
      },
    ],
  },
  {
    key: 'automation',
    label: 'Advanced Features',
    rows: [
      {
        slug: 'automations:manage',
        label: 'Automation',
        hint: 'Manage automation rules',
      },
      {
        slug: 'flows:manage',
        label: 'Flows',
        hint: 'Manage conversation flows',
      },
      {
        slug: 'ai:manage',
        label: 'AI Agents',
        hint: 'Configure AI auto-reply and agents',
      },
      {
        slug: 'data:import',
        label: 'Data Import',
        hint: 'Import contacts and records',
      },
      {
        slug: 'data:export',
        label: 'Data Export',
        hint: 'Export records to files',
      },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    rows: [
      {
        slug: 'members:manage',
        label: 'User Management',
        hint: 'Invite, deactivate and assign profiles',
      },
      {
        slug: 'settings:manage',
        label: 'Workspace Settings',
        hint: 'Edit workspace-wide settings',
      },
      {
        slug: 'channels:manage',
        label: 'Channel Setup',
        hint: 'Configure WhatsApp, SMS and email channels',
      },
      {
        slug: 'api-keys:manage',
        label: 'API Keys',
        hint: 'Create and revoke API keys',
      },
      {
        slug: 'webhooks:manage',
        label: 'Webhooks',
        hint: 'Configure outbound webhooks',
      },
    ],
  },
];

// ---- Component ---------------------------------------------------------

export function ProfilePermissionEditor({
  permissions,
  onChange,
  disabled = false,
}: {
  permissions: ReadonlySet<PermissionSlug>;
  onChange: (next: Set<PermissionSlug>) => void;
  disabled?: boolean;
}) {
  const setSlugs = (slugs: PermissionSlug[], on: boolean) => {
    const next = new Set(permissions);
    for (const slug of slugs) {
      if (on) next.add(slug);
      else next.delete(slug);
    }
    onChange(next);
  };

  return (
    <div className="space-y-6">
      {/* ---- Basic Permissions (record rows) ---- */}
      <section aria-label="Basic Permissions">
        <h3 className="text-foreground mb-1 text-sm font-semibold">
          Basic Permissions
        </h3>
        <div className="divide-y rounded-lg border">
          {RECORD_ROWS.map((row) => {
            const enabledActions = row.actions.filter((a) =>
              permissions.has(a.slug)
            );
            const isOn = enabledActions.length > 0;
            return (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="text-foreground min-w-0 text-sm font-medium">
                  {row.label}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {isOn && (
                    <Popover>
                      <PopoverTrigger
                        disabled={disabled}
                        render={
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs disabled:cursor-not-allowed"
                            aria-label={`Actions for ${row.label}`}
                          >
                            {enabledActions.map((a) => a.label).join(', ')}
                            <ChevronDown className="size-3" />
                          </button>
                        }
                      />
                      <PopoverContent align="end" className="w-48 p-2">
                        <div className="space-y-1.5">
                          {row.actions.map((action) => (
                            <label
                              key={action.key}
                              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
                            >
                              <Checkbox
                                checked={permissions.has(action.slug)}
                                disabled={
                                  disabled ||
                                  // View is required while any other
                                  // action of the entity is on.
                                  (action.key === 'read' &&
                                    enabledActions.some(
                                      (a) => a.key !== 'read'
                                    ))
                                }
                                onCheckedChange={(checked) =>
                                  setSlugs([action.slug], checked === true)
                                }
                              />
                              {action.label}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <Switch
                    checked={isOn}
                    disabled={disabled}
                    aria-label={`${row.label} access`}
                    onCheckedChange={(checked) =>
                      // Toggling on grants the full action set; off
                      // clears every action of the entity.
                      setSlugs(
                        row.actions.map((a) => a.slug),
                        checked
                      )
                    }
                  />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Feature sections (single-switch rows) ---- */}
      {FEATURE_SECTIONS.map((section) => (
        <section key={section.key} aria-label={section.label}>
          <h3 className="text-foreground mb-1 text-sm font-semibold">
            {section.label}
          </h3>
          <div className="divide-y rounded-lg border">
            {section.rows.map((row) => (
              <div
                key={row.slug}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="text-foreground block text-sm font-medium">
                    {row.label}
                  </span>
                  {row.hint && (
                    <span className="text-muted-foreground block text-xs leading-relaxed">
                      {row.hint}
                    </span>
                  )}
                </span>
                <Switch
                  checked={permissions.has(row.slug)}
                  disabled={disabled}
                  aria-label={row.label}
                  onCheckedChange={(checked) =>
                    setSlugs([row.slug], checked === true)
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
