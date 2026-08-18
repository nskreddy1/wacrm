import { getRequestConfig } from 'next-intl/server';

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
