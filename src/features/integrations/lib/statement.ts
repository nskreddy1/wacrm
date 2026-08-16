// ============================================================
// Statement validation — runs at DEFINITION time, not call time.
//
// An admin saves a statement once; the model may then only invoke it by
// name. Validating on save means a malformed statement is rejected while
// an admin is looking at the form, rather than failing while a customer
// waits on a reply.
//
// This is defence in depth, NOT the primary injection defence. The
// primary defence is that parameters are bound by the driver ($1) and
// values come from the contact row, never from the model or the
// customer's message. This layer additionally constrains what an admin
// can define, so one careless operation cannot become a destructive one.
//
// Scope note: these are lexical checks, not a SQL parser. They are
// intentionally conservative — reject anything not obviously safe —
// because the cost of a false rejection is an admin rewording a query,
// while the cost of a false accept is data loss in the client's system.
// ============================================================

import {
  BINDING_SOURCES,
  type BindingSource,
  type IntegrationKind,
  type IntegrationMode,
  type OperationBinding,
} from './types';

/** Strip string/identifier literals and comments before lexical checks.
 *
 * Without this, a statement containing the word "delete" inside a
 * legitimate string literal would be rejected, and — worse — a comment
 * could hide a second statement from the checks below. */
function stripLiteralsAndComments(sql: string): string {
  return (
    sql
      // '...' with '' escapes
      .replace(/'(?:[^']|'')*'/g, "''")
      // "..." quoted identifiers
      .replace(/"(?:[^"]|"")*"/g, '""')
      // dollar-quoted blocks ($$ … $$ / $tag$ … $tag$) — these can carry
      // an entire function body, so they must not survive into the
      // keyword checks
      .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, "''")
      // -- line comments
      .replace(/--[^\n]*/g, ' ')
      // /* block */ comments
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
  );
}

/** Statements that must never appear, in any mode. */
const FORBIDDEN = [
  'drop',
  'truncate',
  'alter',
  'grant',
  'revoke',
  'create',
  'vacuum',
  'reindex',
  // Postgres-specific escapes: COPY … FROM PROGRAM executes shell
  // commands, and dblink/pg_read_file reach outside the database.
  'copy',
  'dblink',
  'pg_read_file',
  'pg_sleep',
  'pg_terminate_backend',
  // Stacked-privilege changes / role escalation.
  'set role',
  'set session authorization',
];

export interface StatementIssue {
  message: string;
}

/**
 * Validate a SQL statement for the given mode.
 *
 * Returns a list of problems; empty means acceptable.
 */
export function validateSqlStatement(
  rawStatement: string,
  mode: IntegrationMode
): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const statement = rawStatement.trim().replace(/;+\s*$/, '');

  if (!statement) {
    return [{ message: 'Statement is empty.' }];
  }

  const stripped = stripLiteralsAndComments(statement);
  const lower = stripped.toLowerCase();

  // Multi-statement is rejected outright. `pg` will happily run
  // "select 1; delete from orders" in a single call, so a stray
  // semicolon is a privilege-escalation primitive, not a style issue.
  if (stripped.includes(';')) {
    issues.push({
      message:
        'Only a single statement is allowed — remove the ";" and any statement after it.',
    });
  }

  for (const word of FORBIDDEN) {
    // \b so "created_at" does not trip "create".
    const re = new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) {
      issues.push({
        message: `"${word.toUpperCase()}" is not allowed in an integration statement.`,
      });
    }
  }

  if (mode === 'read') {
    if (!/^\s*(select|with)\b/i.test(stripped)) {
      issues.push({
        message: 'A read operation must start with SELECT or WITH.',
      });
    }
    // A CTE can hide a write: WITH x AS (DELETE … RETURNING *) SELECT …
    if (/\b(insert|update|delete|merge)\b/i.test(lower)) {
      issues.push({
        message:
          'A read operation must not contain INSERT, UPDATE, DELETE or MERGE (including inside a WITH clause).',
      });
    }
  } else {
    if (!/^\s*(insert|update|delete|with)\b/i.test(stripped)) {
      issues.push({
        message:
          'A write operation must start with INSERT, UPDATE, DELETE or WITH.',
      });
    }
    // An UPDATE/DELETE with no WHERE rewrites or empties a whole table.
    // Requiring a parameterised WHERE also forces the statement to be
    // scoped to the bound contact rather than to everyone.
    if (/^\s*(update|delete)\b/i.test(stripped) && !/\bwhere\b/i.test(lower)) {
      issues.push({
        message:
          'UPDATE and DELETE must include a WHERE clause so the change is scoped to one record.',
      });
    }
  }

  return issues;
}

/**
 * Validate that `bindings` covers exactly the placeholders used by the
 * statement.
 *
 * A missing binding would make the driver throw at call time; an extra
 * one usually means the admin edited the SQL and forgot the parameter
 * list, which is worth catching while they can still see the form.
 */
export function validateBindings(
  rawStatement: string,
  bindings: OperationBinding[]
): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const stripped = stripLiteralsAndComments(rawStatement);

  // Collect $1..$n actually referenced.
  const used = new Set<number>();
  for (const match of stripped.matchAll(/\$(\d+)/g)) {
    used.add(Number(match[1]));
  }

  const declared = new Set<number>();
  for (const binding of bindings) {
    if (!Number.isInteger(binding.param) || binding.param < 1) {
      issues.push({
        message: `Parameter positions start at 1 (got "${binding.param}").`,
      });
      continue;
    }
    if (declared.has(binding.param)) {
      issues.push({ message: `Parameter $${binding.param} is declared twice.` });
    }
    declared.add(binding.param);

    if (!BINDING_SOURCES.includes(binding.source)) {
      issues.push({
        message: `"${binding.source}" is not a bindable contact field.`,
      });
    }
  }

  for (const param of used) {
    if (!declared.has(param)) {
      issues.push({
        message: `The statement uses $${param} but no contact field is bound to it.`,
      });
    }
  }
  for (const param of declared) {
    if (!used.has(param)) {
      issues.push({
        message: `$${param} is bound to a contact field but never used in the statement.`,
      });
    }
  }

  // Positions must be contiguous from 1, because we pass values as a
  // positional array to the driver.
  if (issues.length === 0 && declared.size > 0) {
    const max = Math.max(...declared);
    if (max !== declared.size) {
      issues.push({
        message: `Parameters must be numbered consecutively from $1 (found ${declared.size} bindings with highest $${max}).`,
      });
    }
  }

  return issues;
}

/**
 * REST path template validation.
 *
 * The template may interpolate `{contact.phone}`-style placeholders. Any
 * interpolated value is URL-encoded by the caller; here we only check
 * that the placeholders name real bindable fields and that the template
 * cannot escape its connection's `base_url`.
 */
export function validateRestTemplate(rawTemplate: string): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const template = rawTemplate.trim();

  if (!template) return [{ message: 'Path template is empty.' }];

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(template)) {
    issues.push({
      message:
        'Use a path relative to the connection base URL, not a full URL.',
    });
  }

  // `..` would climb above base_url and defeat the allow-list; a
  // protocol-relative "//host" would leave the origin entirely.
  if (template.includes('..')) {
    issues.push({ message: 'Path must not contain "..".' });
  }
  if (template.startsWith('//')) {
    issues.push({ message: 'Path must not start with "//".' });
  }

  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    const field = match[1].trim();
    if (!BINDING_SOURCES.includes(field as BindingSource)) {
      issues.push({
        message: `"{${field}}" is not a bindable contact field.`,
      });
    }
  }

  return issues;
}

/** Validate an operation definition end-to-end for the given kind. */
export function validateOperation(input: {
  kind: IntegrationKind;
  mode: IntegrationMode;
  statement: string;
  bindings: OperationBinding[];
}): StatementIssue[] {
  if (input.kind === 'rest') {
    return validateRestTemplate(input.statement);
  }
  return [
    ...validateSqlStatement(input.statement, input.mode),
    ...validateBindings(input.statement, input.bindings),
  ];
}
