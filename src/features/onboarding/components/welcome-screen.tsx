'use client';

/**
 * Post-signup / post-login welcome overlay.
 *
 * Visual design ported from Twenty (twentyhq/twenty, AGPL-3.0): a dark
 * backdrop behind an animated indigo halftone dot field that assembles
 * inward, drifts, then bursts outward on exit. The title reads
 * "Welcome to your workspace <person chip>" with a word-by-word rise.
 *
 * Rendered above the dashboard when the URL carries `?welcome=1`
 * (appended by the login form and the onboarding wizard's finish step).
 * Auto-leaves after a hold, or immediately on click / Escape — the
 * click path also plays a short synthesized chime, since browsers only
 * allow audio after a user gesture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { personDisplayName } from '@/lib/display-name';
import { WelcomeHalftoneCanvas } from './welcome-halftone-canvas';

/** Matches Twenty's WELCOME_HOLD_MIN_DURATION_MS. */
const AUTO_LEAVE_AFTER_MS = 3600;
/** Backdrop + burst run ~0.75s; unmount just after. */
const LEAVE_ANIMATION_MS = 820;

/** Ascending C-major arpeggio via Web Audio — no asset file needed. */
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
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.9);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 2000);
  } catch {
    // Audio is a nicety — never let it break the flow.
  }
}

const TITLE_WORDS = ['Welcome', 'to', 'your', 'workspace'];

export function WelcomeScreen({ onDismiss }: { onDismiss: () => void }) {
  const { profile } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const name = useMemo(
    () => personDisplayName(profile?.full_name, profile?.email),
    [profile?.full_name, profile?.email]
  );
  const initial = name.charAt(0).toUpperCase();

  const leave = useCallback(
    (withSound: boolean) => {
      setLeaving((alreadyLeaving) => {
        if (alreadyLeaving) return true;
        if (withSound) playChime();
        timers.current.push(window.setTimeout(onDismiss, LEAVE_ANIMATION_MS));
        return true;
      });
    },
    [onDismiss]
  );

  // Auto-leave so the overlay is never a dead end, plus click/Escape
  // for anyone who wants past it immediately.
  useEffect(() => {
    timers.current.push(window.setTimeout(() => leave(false), AUTO_LEAVE_AFTER_MS));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') leave(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [leave]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome to your workspace, ${name}`}
      onClick={() => leave(true)}
      className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden"
    >
      {/* Backdrop fades out first so the bursting dots read against
          the dashboard already showing through. */}
      <div
        className={`absolute inset-0 bg-[#141414] ${
          leaving ? 'animate-welcome-backdrop-out' : ''
        }`}
      />
      <div className="absolute inset-0">
        <WelcomeHalftoneCanvas isLeaving={leaving} />
      </div>

      {/* Mobile wraps the title across lines at a smaller size; from
          `sm` up it locks to a single line like the desktop design.
          Each word keeps `whitespace-nowrap` so wrapping only ever
          happens between words, never mid-word. */}
      <div
        className={`relative z-10 flex max-w-[90vw] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 py-4 text-center text-lg font-semibold text-white sm:max-w-none sm:flex-nowrap sm:gap-2 sm:px-8 sm:text-2xl md:text-[26px] ${
          leaving ? 'animate-welcome-title-out' : 'animate-welcome-title-in'
        }`}
      >
        {TITLE_WORDS.map((word, index) => (
          <span
            key={word}
            className="animate-welcome-word-in inline-flex whitespace-nowrap"
            style={{ animationDelay: `${1.1 + index * 0.07}s` }}
          >
            {word}
          </span>
        ))}
        {/* Person chip — the identity payoff of the whole screen. */}
        <span
          className="animate-welcome-word-in inline-flex min-w-0"
          style={{ animationDelay: `${1.1 + TITLE_WORDS.length * 0.07}s` }}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 sm:gap-2">
            <span
              aria-hidden
              className="bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded text-[11px] font-semibold sm:size-6 sm:text-xs"
            >
              {initial}
            </span>
            {/* Matches Twenty's chip cap so a long name truncates
                instead of stretching the title off-screen. */}
            <span className="min-w-0 max-w-[min(40vw,360px)] truncate">
              {name}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
