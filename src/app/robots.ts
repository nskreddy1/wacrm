import type { MetadataRoute } from 'next';

/**
 * Axon is a private, authenticated CRM — there is no public surface we
 * want indexed. The root layout already sends `robots: noindex, nofollow`
 * on every page, but that meta tag is only seen AFTER a crawler fetches
 * the page. This file stops well-behaved crawlers at the door instead,
 * which also keeps signup/login out of search results where they'd
 * attract credential-stuffing traffic.
 *
 * Deliberately no `sitemap` entry: publishing one would advertise the
 * very routes we're asking crawlers to skip.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
