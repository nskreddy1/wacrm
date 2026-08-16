// ============================================================
// Governed integration layer — shared types.
//
// Lets an account ground the AI in data that lives in the CLIENT's own
// system (an orders DB, a fees table, an internal REST API) so a
// support reply can answer "where is my order?" truthfully.
//
// See supabase/migrations/20260816120000_integration_layer.sql for the
// schema and the full rationale, especially the identity-binding rule.
// ============================================================

/** Synchronous request/response backends only. */
export type IntegrationKind = 'postgres' | 'mysql' | 'rest';

export type IntegrationMode = 'read' | 'write';

/**
 * Where a statement parameter's value comes from.
 *
 * Every source is a field of the ALREADY-RESOLVED contact row. There is
 * deliberately no `literal` or `from_message` variant: the model must
 * not be able to influence a parameter, because on the support path the
 * inbound message is untrusted and a model-supplied id would let
 * customer A address customer B's rows.
 */
export type BindingSource =
  | 'contact.id'
  | 'contact.phone'
  | 'contact.phone_normalized'
  | 'contact.email'
  | 'contact.name'
  | 'contact.company'
  | 'contact.account_id';

export const BINDING_SOURCES: readonly BindingSource[] = [
  'contact.id',
  'contact.phone',
  'contact.phone_normalized',
  'contact.email',
  'contact.name',
  'contact.company',
  'contact.account_id',
];

/** One positional parameter: `$param` receives `source`. */
export interface OperationBinding {
  /** 1-based position matching `$1`, `$2`, … in the statement. */
  param: number;
  source: BindingSource;
}

export interface IntegrationConnection {
  id: string;
  account_id: string;
  name: string;
  kind: IntegrationKind;
  base_url: string | null;
  read_only: boolean;
  enabled: boolean;
  last_tested_at: string | null;
  last_error: string | null;
}

export interface IntegrationOperation {
  id: string;
  account_id: string;
  connection_id: string;
  name: string;
  description: string;
  mode: IntegrationMode;
  statement: string;
  bindings: OperationBinding[];
  expose_to_autoreply: boolean;
  requires_confirmation: boolean;
  row_limit: number;
  timeout_ms: number;
  enabled: boolean;
}

/** The contact fields the engine can resolve bindings from. */
export interface BindableContact {
  id: string;
  account_id: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}
