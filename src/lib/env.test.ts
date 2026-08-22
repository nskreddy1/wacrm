import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MissingEnvError,
  automationCronSecret,
  cronAuthEnv,
  databaseUrl,
  deploymentHost,
  emailFrom,
  encryptionKey,
  isProductionRelease,
  metaAppSecret,
  redisCredentials,
  siteUrl,
  superAdminEmails,
  supabaseAdminCredentials,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
  vercelCronSecret,
} from './env';

/**
 * Every name this module is allowed to read. Each test starts from a
 * blank slate for all of them so a value leaking in from the dev VM's
 * real environment (or vitest.config.ts's dummy secrets) cannot make an
 * assertion pass for the wrong reason.
 */
const MANAGED_NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'ENCRYPTION_KEY',
  'SUPER_ADMIN_EMAILS',
  'CRON_SECRET',
  'AUTOMATION_CRON_SECRET',
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'META_APP_ID',
  'META_APP_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'EMAIL_FROM',
  'RELEASE_VERSION',
  'GIT_SHA',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of MANAGED_NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('required getters', () => {
  it('reads the canonical name', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://canonical.supabase.co';
    expect(supabaseUrl()).toBe('https://canonical.supabase.co');
  });

  it('throws MissingEnvError naming every accepted spelling', () => {
    expect(() => supabaseServiceRoleKey()).toThrow(MissingEnvError);
    // The operator has to know WHICH names are searched, otherwise the
    // error sends them hunting through the codebase.
    expect(() => supabaseServiceRoleKey()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => supabaseServiceRoleKey()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('exposes the searched names on the error for programmatic handling', () => {
    try {
      encryptionKey();
      expect.unreachable('encryptionKey() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as MissingEnvError).names).toEqual(['ENCRYPTION_KEY']);
    }
  });
});

describe('alias resolution', () => {
  it('prefers the canonical name over the legacy alias', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'canonical';
    process.env.SUPABASE_SECRET_KEY = 'legacy';
    expect(supabaseServiceRoleKey()).toBe('canonical');
  });

  it('falls back to the legacy alias so existing deployments keep booting', () => {
    process.env.SUPABASE_SECRET_KEY = 'legacy';
    expect(supabaseServiceRoleKey()).toBe('legacy');
  });

  it('accepts the unprefixed SUPABASE_URL used by server-only contexts', () => {
    process.env.SUPABASE_URL = 'https://server.supabase.co';
    expect(supabaseUrl()).toBe('https://server.supabase.co');
  });

  it('accepts the publishable-key spelling of the anon key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';
    expect(supabaseAnonKey()).toBe('publishable');
  });

  it('resolves the database URL in documented order', () => {
    process.env.POSTGRES_URL_NON_POOLING = 'postgres://direct';
    expect(databaseUrl()).toBe('postgres://direct');
    process.env.POSTGRES_URL = 'postgres://pooled';
    expect(databaseUrl()).toBe('postgres://pooled');
    process.env.DATABASE_URL = 'postgres://canonical';
    expect(databaseUrl()).toBe('postgres://canonical');
  });
});

describe('blank handling', () => {
  it('treats an empty value as absent', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_URL = 'https://fallback.supabase.co';
    // A blank secret in a CI matrix is a MISSING secret. Treating it as
    // present would hand `createClient('')` to the SDK and fail far
    // from the cause.
    expect(supabaseUrl()).toBe('https://fallback.supabase.co');
  });

  it('treats a whitespace-only value as absent', () => {
    process.env.KV_REST_API_URL = '   ';
    process.env.KV_REST_API_TOKEN = 'token';
    expect(redisCredentials()).toBeUndefined();
  });

  it('trims surrounding whitespace from a real value', () => {
    process.env.EMAIL_FROM = '  crm@example.com \n';
    expect(emailFrom()).toBe('crm@example.com');
  });
});

describe('optional getters', () => {
  it('returns undefined rather than throwing', () => {
    expect(metaAppSecret()).toBeUndefined();
    expect(databaseUrl()).toBeUndefined();
    expect(siteUrl()).toBeUndefined();
    expect(redisCredentials()).toBeUndefined();
  });

  it('re-reads process.env on every call', () => {
    expect(siteUrl()).toBeUndefined();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://auxelon.in';
    // Module-scope caching would freeze the first (absent) read — the
    // Workers runtime populates process.env per isolate.
    expect(siteUrl()).toBe('https://auxelon.in');
  });
});

describe('redisCredentials', () => {
  it('requires both halves', () => {
    process.env.KV_REST_API_URL = 'https://redis.upstash.io';
    expect(redisCredentials()).toBeUndefined();
    process.env.KV_REST_API_TOKEN = 'token';
    expect(redisCredentials()).toEqual({
      url: 'https://redis.upstash.io',
      token: 'token',
    });
  });
});

describe('cron secrets', () => {
  it('keeps the two transports separate', () => {
    process.env.CRON_SECRET = 'bearer-secret';
    process.env.AUTOMATION_CRON_SECRET = 'header-secret';
    // Collapsing these into one value would let a leaked header secret
    // authorize the Bearer transport (see features/flows/lib/cron-auth).
    expect(vercelCronSecret()).toBe('bearer-secret');
    expect(automationCronSecret()).toBe('header-secret');
    expect(cronAuthEnv()).toEqual({
      vercelCronSecret: 'bearer-secret',
      automationCronSecret: 'header-secret',
    });
  });

  it('reports undefined for an unconfigured secret so routes fail closed', () => {
    expect(cronAuthEnv()).toEqual({
      vercelCronSecret: undefined,
      automationCronSecret: undefined,
    });
  });
});

describe('origin getters', () => {
  it('prefers the production URL over the per-deployment URL', () => {
    process.env.VERCEL_URL = 'preview-abc.vercel.app';
    expect(deploymentHost()).toBe('preview-abc.vercel.app');
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'auxelon.in';
    expect(deploymentHost()).toBe('auxelon.in');
  });
});

describe('superAdminEmails', () => {
  it('returns an empty list when unset', () => {
    expect(superAdminEmails()).toEqual([]);
  });

  it('splits, trims, lowercases and drops blanks', () => {
    process.env.SUPER_ADMIN_EMAILS = ' Ops@Example.com , ,admin@example.com ';
    expect(superAdminEmails()).toEqual([
      'ops@example.com',
      'admin@example.com',
    ]);
  });
});

describe('release identity', () => {
  it('treats a set RELEASE_VERSION as the production signal', () => {
    expect(isProductionRelease()).toBe(false);
    process.env.RELEASE_VERSION = '0.8.0';
    expect(isProductionRelease()).toBe(true);
  });
});

describe('supabaseAdminCredentials', () => {
  it('resolves both halves together', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://p.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    expect(supabaseAdminCredentials()).toEqual({
      url: 'https://p.supabase.co',
      key: 'service-role',
    });
  });

  it('throws when the service-role key is absent', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://p.supabase.co';
    expect(() => supabaseAdminCredentials()).toThrow(MissingEnvError);
  });
});
