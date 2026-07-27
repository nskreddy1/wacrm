'use client';

/**
 * Mounts the 3D welcome overlay when the URL carries `?welcome=1`
 * (set by the login form and the onboarding wizard's finish step).
 * On dismiss the param is stripped with history.replaceState — not a
 * router navigation — so the dashboard beneath never re-renders or
 * refetches, and refresh/back never replays the welcome.
 */

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WelcomeScreen } from './welcome-screen';

function WelcomeGateInner() {
  const searchParams = useSearchParams();
  // Latch on first render: once shown, the overlay owns its own
  // lifecycle even though we strip the query param underneath it.
  const [show, setShow] = useState(() => searchParams.get('welcome') === '1');

  const dismiss = useCallback(() => {
    setShow(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  if (!show) return null;
  return <WelcomeScreen onDismiss={dismiss} />;
}

export function WelcomeGate() {
  return (
    // useSearchParams requires a Suspense boundary during prerender.
    <Suspense fallback={null}>
      <WelcomeGateInner />
    </Suspense>
  );
}
