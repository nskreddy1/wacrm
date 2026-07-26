'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary. Catches failures that escape every nested
 * boundary — including errors thrown in the root layout itself, which is
 * why this file must render its own <html>/<body>.
 *
 * Without it, an uncaught render error shows a blank white screen in
 * production (the stack is stripped), which reads as "the app is down".
 *
 * Note: no `next/font` or `globals.css` reliance for the critical text.
 * If the root layout is what crashed, those may be exactly what failed,
 * so the recovery UI uses inline styles and stays legible regardless.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in Vercel logs / error tracking with the digest that
    // correlates this render to the server-side stack trace.
    console.error('[axon] unhandled application error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100svh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          background: '#fbfbfa',
          color: '#1c1c1a',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0 0 0.75rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              margin: '0 0 1.5rem',
              lineHeight: 1.6,
              color: '#5c5c58',
            }}
          >
            An unexpected error interrupted this page. Your data is safe —
            trying again usually resolves it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#073b4c',
              color: '#fff',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: '1.5rem',
                fontSize: '0.75rem',
                fontFamily: 'ui-monospace, monospace',
                color: '#8a8a85',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
