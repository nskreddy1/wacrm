import { getRequestConfig } from 'next-intl/server';

/**
 * Resolve the app-wide IANA time zone, falling back to UTC.
 *
 * The env value is validated because `Intl` throws a `RangeError` on an
 * unknown zone, and it is consumed during render — a typo like
 * `Asia/Calcutta_` would surface as a 500 on every page rather than as a
 * config error, which is a much worse failure than quietly using UTC.
 */
function resolveTimeZone(): string {
  const configured = process.env.NEXT_PUBLIC_APP_TIME_ZONE?.trim();
  if (!configured) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: configured });
    return configured;
  } catch {
    console.warn(
      `[i18n] Ignoring invalid NEXT_PUBLIC_APP_TIME_ZONE "${configured}"; falling back to UTC.`
    );
    return 'UTC';
  }
}

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to 'en'
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
    // The other half of the `ENVIRONMENT_FALLBACK` fix below.
    //
    // Supplying `now` silenced the `relativeTime` warning, but next-intl
    // emits ENVIRONMENT_FALLBACK from three places and the remaining two
    // are about a missing `timeZone`. One fires from `useTranslations`
    // itself (`!timeZone && isServer`), so *every* server render still
    // logged the error even on pages that format no dates at all.
    //
    // It is the same class of correctness bug as `now`: with no default,
    // the server formats in the container's zone (UTC on Vercel) and the
    // browser in the viewer's local zone, so a timestamp can render as
    // two different days either side of hydration.
    //
    // UTC is the default rather than a guessed local zone because it is
    // the one value guaranteed to match between server and client. An
    // operator serving a single region can override it; per-user zones
    // are a larger change (the preference has to be read per request)
    // and are deliberately not attempted here.
    timeZone: resolveTimeZone(),
    // A global reference point for relative times ("3 minutes ago").
    //
    // Without this, `format.relativeTime(date)` has no `now` to compare
    // against and next-intl falls back to reading the clock inside the
    // formatter, logging an `ENVIRONMENT_FALLBACK` IntlError to the
    // console on every single render. That fallback is also a real
    // correctness problem, not just noise: the server and the browser
    // read their own clocks at different instants, so the same
    // timestamp can render as "1 minute ago" on the server and "2
    // minutes ago" on hydration, which is a markup mismatch.
    //
    // Fixing it once per request makes every relative time on the page
    // agree, and `NextIntlClientProvider` (server variant) forwards this
    // value to the client automatically, so `useNow()` in client
    // components starts from the same instant the server used.
    now: new Date(),
  };
});
