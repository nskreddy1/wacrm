import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onStoreChange);
  return () => mql.removeEventListener('change', onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** SSR renders desktop; the client corrects on hydration if needed. */
function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
