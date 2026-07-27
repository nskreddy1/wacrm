'use client';

/**
 * Post-signup / post-login 3D welcome screen.
 *
 * Rendered as a full-screen overlay above the dashboard when the URL
 * carries `?welcome=1` (appended by the login form and the onboarding
 * wizard's finish step). Greets the member by name over an animated
 * Three.js background and plays a short synthesized chime when the
 * member clicks through (browsers only allow audio after a gesture).
 *
 * Dismissal strips the query param via history.replaceState so a
 * refresh or back-navigation never replays the welcome.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { personDisplayName } from '@/lib/display-name';

// Three.js is heavy (~1MB) and only needed for this one overlay —
// load it lazily so the dashboard bundle stays lean and the overlay
// still appears instantly (the HTML greeting renders while the 3D
// canvas streams in behind it).
const WelcomeCanvas = dynamic(
  () => import('./welcome-canvas').then((m) => m.WelcomeCanvas),
  { ssr: false }
);

/** Two-bar ascending chime via Web Audio — no asset file needed. */
function playChime() {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
    // C5 → E5 → G5 → C6 arpeggio with a soft triangle timbre.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 1);
    });
    // Close the context once the chime finishes to free the device.
    window.setTimeout(() => void ctx.close().catch(() => {}), 2000);
  } catch {
    // Audio is a nicety — never let it break the flow.
  }
}

export function WelcomeScreen({ onDismiss }: { onDismiss: () => void }) {
  const { profile, loading } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  const name = useMemo(
    () => personDisplayName(profile?.full_name, profile?.email),
    [profile?.full_name, profile?.email]
  );

  const handleEnter = useCallback(() => {
    if (leaving) return;
    playChime();
    setLeaving(true);
    // Let the fade-out play before unmounting the overlay.
    dismissTimer.current = window.setTimeout(onDismiss, 700);
  }, [leaving, onDismiss]);

  // Escape dismisses too — an overlay the keyboard can't leave is a trap.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') handleEnter();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleEnter]);

  useEffect(
    () => () => {
      if (dismissTimer.current !== null)
        window.clearTimeout(dismissTimer.current);
    },
    []
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome, ${name}`}
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a14] transition-opacity duration-700 ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      {/* Animated 3D background */}
      <div className="absolute inset-0" aria-hidden>
        <Suspense fallback={null}>
          <WelcomeCanvas />
        </Suspense>
      </div>

      {/* Greeting overlay */}
      <div className="animate-in fade-in zoom-in-95 relative z-10 flex max-w-2xl flex-col items-center gap-6 px-6 text-center duration-1000">
        <p className="text-sm font-medium tracking-[0.3em] text-white/60 uppercase">
          Your workspace is ready
        </p>
        <h1 className="text-balance font-sans text-5xl font-bold text-white md:text-7xl">
          Welcome,{' '}
          <span className="text-primary">
            {loading && !profile ? '…' : name}
          </span>
        </h1>
        <p className="text-pretty max-w-md leading-relaxed text-white/70">
          Every conversation — WhatsApp, SMS and email — lands in one shared
          inbox your whole team works from. Let&apos;s get you in.
        </p>
        <Button size="xl" onClick={handleEnter} className="mt-2 gap-2">
          Enter your dashboard
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        <p className="text-xs text-white/40">
          Press <kbd className="rounded border border-white/20 px-1">Esc</kbd>{' '}
          to skip
        </p>
      </div>
    </div>
  );
}
