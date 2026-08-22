/**
 * src/lib/db/errors.ts
 *
 * Maps driver-level Postgres errors to typed application errors so callers
 * never branch on vendor error codes (ADR-002 §3.2). Extend the map only
 * when a caller has a legitimate need to handle a new class.
 *
 * Postgres SQLSTATE reference:
 *   23505 unique_violation
 *   23503 foreign_key_violation
 *   40001 serialization_failure
 *   40P01 deadlock_detected
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class UniqueViolation extends DatabaseError {
  constructor(cause?: unknown) {
    super('Unique constraint violated', '23505', cause);
    this.name = 'UniqueViolation';
  }
}

export class ForeignKeyViolation extends DatabaseError {
  constructor(cause?: unknown) {
    super('Foreign key constraint violated', '23503', cause);
    this.name = 'ForeignKeyViolation';
  }
}

export class SerializationFailure extends DatabaseError {
  constructor(cause?: unknown) {
    super('Transaction serialization failure — safe to retry', '40001', cause);
    this.name = 'SerializationFailure';
  }
}

/** Narrow an unknown thrown value to a Postgres error shape. */
function pgCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Map a raw driver error to a typed app error (passes through unknowns). */
export function mapDbError(err: unknown): unknown {
  switch (pgCode(err)) {
    case '23505':
      return new UniqueViolation(err);
    case '23503':
      return new ForeignKeyViolation(err);
    case '40001':
    case '40P01':
      return new SerializationFailure(err);
    default:
      return err;
  }
}
