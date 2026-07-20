// ============================================================
// Support ticketing — shared domain types + constants.
//
// Single source of truth for the category / priority / status
// vocabularies. The DB CHECK constraints in 056_support_tickets.sql
// enforce the same lists; keeping them here means the API routes,
// the user-facing Settings tab and the /admin/tickets queue can't
// drift from each other or from the schema.
// ============================================================

export const TICKET_CATEGORIES = [
  'billing',
  'technical',
  'channel_setup',
  'agent_help',
  'other',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses a ticket creator may set on their OWN ticket. */
export const CREATOR_ALLOWED_STATUSES: readonly TicketStatus[] = ['closed'];

/** Subject length bounds — mirror the DB CHECK (3..200). */
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 200;
/** Message body bounds — mirror the DB CHECK (1..10000). */
export const BODY_MAX = 10_000;

export function isTicketCategory(v: unknown): v is TicketCategory {
  return (
    typeof v === 'string' &&
    (TICKET_CATEGORIES as readonly string[]).includes(v)
  );
}
export function isTicketPriority(v: unknown): v is TicketPriority {
  return (
    typeof v === 'string' &&
    (TICKET_PRIORITIES as readonly string[]).includes(v)
  );
}
export function isTicketStatus(v: unknown): v is TicketStatus {
  return (
    typeof v === 'string' && (TICKET_STATUSES as readonly string[]).includes(v)
  );
}

export interface SupportTicket {
  id: string;
  account_id: string;
  created_by: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_admin: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  author_id: string;
  is_admin_reply: boolean;
  body: string;
  created_at: string;
  /** Resolved display name (server-attached; not a DB column). */
  author_name?: string | null;
}
