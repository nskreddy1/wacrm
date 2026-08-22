'use client';

/**
 * AnalyticsProvider (plan Task 6 Steps 7–8, NFR-003).
 *
 * Two independent, env-gated telemetry paths — either can be disabled
 * without touching the other (review §15):
 *
 *   1. Cloudflare Web Analytics — third-party browser analytics beacon.
 *      Loads ONLY when NEXT_PUBLIC_CF_ANALYTICS_TOKEN is set; no-ops
 *      (renders nothing) otherwise. Free, cookieless, no consent banner
 *      required.
 *
 *   2. web-vitals → POST /api/vitals — OUR Core Web Vitals telemetry
 *      (LCP/CLS/INP/TTFB/FCP), shipped to Loki via the structured
 *      logger. Always on: it rides existing free quota and is
 *      fire-and-forget (sendBeacon / keepalive), so it can never block
 *      or break the UI.
 *
 * Rendered once from the root layout, after children, so it cannot
 * delay first paint.
 */
import { useEffect } from 'react';
import Script from 'next/script';
import { onCLS, onINP, onLCP, onTTFB, onFCP, type Metric } from 'web-vitals';

const CF_TOKEN = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;

function report(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    path: window.location.pathname,
    navigationType: metric.navigationType,
  });
  // sendBeacon survives page unload; fetch(keepalive) is the fallback.
  if (navigator.sendBeacon?.('/api/vitals', body)) return;
  void fetch('/api/vitals', {
    method: 'POST',
    body,
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {
    // Telemetry must never surface as a user-facing error (NFR-003).
  });
}

export function AnalyticsProvider() {
  useEffect(() => {
    onCLS(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
    onFCP(report);
  }, []);

  if (!CF_TOKEN) return null;

  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: CF_TOKEN })}
      strategy="afterInteractive"
    />
  );
}
