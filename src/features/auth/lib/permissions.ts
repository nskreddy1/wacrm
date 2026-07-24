// ============================================================
// Permission catalog — the single source of truth for the
// permission-based profile model (Zoho/Bigin style).
//
// A workspace profile ("Administrator", "Standard", or a custom
// one) is a named set of permission slugs. Members get exactly
// the permissions of their assigned profile; the workspace owner
// ("Super Admin") implicitly holds every permission.
//
// The slugs here MUST stay in sync with:
//   * supabase/migrations/20260724100000_profiles_permissions_and_status.sql
//     (seeded Administrator/Standard profiles + is_account_member shim)
//   * has_permission(account_id, slug) SQL helper
//
// Pure module — no I/O — safe to import from client and server.
// ============================================================

export type PermissionSlug =
  // Records
  | "contacts:read"
  | "contacts:write"
  | "contacts:delete"
  | "companies:read"
  | "companies:write"
  | "companies:delete"
  | "deals:read"
  | "deals:write"
  | "deals:delete"
  | "products:read"
  | "products:write"
  | "products:delete"
  | "activities:read"
  | "activities:write"
  | "activities:delete"
  // Messaging
  | "messages:send"
  | "broadcasts:send"
  | "sms:send"
  | "templates:manage"
  | "quick-replies:manage"
  // Automation & AI
  | "automations:manage"
  | "flows:manage"
  | "ai:manage"
  // Data
  | "data:import"
  | "data:export"
  // Administration
  | "members:manage"
  | "settings:manage"
  | "channels:manage"
  | "api-keys:manage"
  | "webhooks:manage";

export interface PermissionDef {
  slug: PermissionSlug;
  label: string;
  description: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

/**
 * Grouped catalog — drives the Create/Edit Profile permission
 * matrix UI and doubles as documentation of every slug.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "records",
    label: "Records",
    permissions: [
      { slug: "contacts:read", label: "View contacts", description: "See contacts and their timelines" },
      { slug: "contacts:write", label: "Edit contacts", description: "Create and update contacts" },
      { slug: "contacts:delete", label: "Delete contacts", description: "Remove contacts permanently" },
      { slug: "companies:read", label: "View companies", description: "See company records" },
      { slug: "companies:write", label: "Edit companies", description: "Create and update companies" },
      { slug: "companies:delete", label: "Delete companies", description: "Remove companies permanently" },
      { slug: "deals:read", label: "View deals", description: "See pipelines and deals" },
      { slug: "deals:write", label: "Edit deals", description: "Create, update and move deals" },
      { slug: "deals:delete", label: "Delete deals", description: "Remove deals permanently" },
      { slug: "products:read", label: "View products", description: "See the product catalog" },
      { slug: "products:write", label: "Edit products", description: "Create and update products" },
      { slug: "products:delete", label: "Delete products", description: "Remove products permanently" },
      { slug: "activities:read", label: "View activities", description: "See tasks and appointments" },
      { slug: "activities:write", label: "Edit activities", description: "Create and update tasks and appointments" },
      { slug: "activities:delete", label: "Delete activities", description: "Remove activities permanently" },
    ],
  },
  {
    key: "messaging",
    label: "Messaging",
    permissions: [
      { slug: "messages:send", label: "Send messages", description: "Reply to conversations in the inbox" },
      { slug: "broadcasts:send", label: "Send broadcasts", description: "Create and send WhatsApp broadcast campaigns" },
      { slug: "sms:send", label: "Send SMS", description: "Send SMS messages and campaigns" },
      { slug: "templates:manage", label: "Manage templates", description: "Create and edit message templates" },
      { slug: "quick-replies:manage", label: "Manage quick replies", description: "Create and edit saved replies" },
    ],
  },
  {
    key: "automation",
    label: "Automation & AI",
    permissions: [
      { slug: "automations:manage", label: "Manage automations", description: "Create and edit automation rules" },
      { slug: "flows:manage", label: "Manage flows", description: "Create and edit conversation flows" },
      { slug: "ai:manage", label: "Manage AI agents", description: "Configure AI auto-reply and agents" },
    ],
  },
  {
    key: "data",
    label: "Data",
    permissions: [
      { slug: "data:import", label: "Import data", description: "Import contacts and records from files" },
      { slug: "data:export", label: "Export data", description: "Export records to files" },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    permissions: [
      { slug: "members:manage", label: "Manage users", description: "Invite, deactivate and assign profiles to users" },
      { slug: "settings:manage", label: "Manage settings", description: "Edit workspace-wide settings" },
      { slug: "channels:manage", label: "Manage channels", description: "Configure WhatsApp, SMS and email channels" },
      { slug: "api-keys:manage", label: "Manage API keys", description: "Create and revoke API keys" },
      { slug: "webhooks:manage", label: "Manage webhooks", description: "Configure outbound webhooks" },
    ],
  },
];

/** Flat list of every permission slug. */
export const ALL_PERMISSIONS: readonly PermissionSlug[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.slug),
);

/** Slugs seeded into the system "Administrator" profile (all of them). */
export const ADMINISTRATOR_PERMISSIONS: readonly PermissionSlug[] = ALL_PERMISSIONS;

/** Slugs seeded into the system "Standard" profile (no administration). */
export const STANDARD_PERMISSIONS: readonly PermissionSlug[] = ALL_PERMISSIONS.filter(
  (slug) =>
    !["members:manage", "settings:manage", "channels:manage", "api-keys:manage", "webhooks:manage", "ai:manage"].includes(
      slug,
    ),
);

/** Type-narrow an unknown string into a valid `PermissionSlug`. */
export function isPermissionSlug(value: unknown): value is PermissionSlug {
  return typeof value === "string" && (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * True iff the holder of `permissions` may perform `slug`.
 * Owners (`isOwner`) hold every permission implicitly — mirrors
 * the `a.owner_user_id = auth.uid()` branch in the SQL helpers.
 */
export function hasPermission(
  permissions: readonly string[],
  slug: PermissionSlug,
  isOwner = false,
): boolean {
  return isOwner || permissions.includes(slug);
}

// ============================================================
// Capability derivation — bridges existing call sites onto the
// permission model. UI gates and route guards call these instead
// of comparing role strings.
// ============================================================

export interface MemberCapabilities {
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
  canViewOnly: boolean;
  canDeleteAccount: boolean;
  canTransferOwnership: boolean;
}

const WRITE_SLUGS: readonly PermissionSlug[] = [
  "contacts:write",
  "companies:write",
  "deals:write",
  "products:write",
  "activities:write",
  "messages:send",
];

export function deriveCapabilities(
  permissions: readonly string[],
  isOwner: boolean,
): MemberCapabilities {
  const has = (slug: PermissionSlug) => hasPermission(permissions, slug, isOwner);
  const canWrite = isOwner || WRITE_SLUGS.some((slug) => permissions.includes(slug));
  return {
    canManageMembers: has("members:manage"),
    canEditSettings: has("settings:manage"),
    canSendMessages: canWrite,
    canViewOnly: !canWrite,
    canDeleteAccount: isOwner,
    canTransferOwnership: isOwner,
  };
}
