/**
 * Notification chime, synthesised rather than loaded from a file.
 *
 * Why Web Audio and not `new Audio('/ding.mp3')`:
 *   - No binary asset to ship, cache-bust or 404 on.
 *   - No network request on the hot path, so the sound lands with the
 *     toast instead of a beat behind it on a cold cache.
 *
 * The autoplay problem, which is the real constraint here: browsers
 * create an AudioContext in the "suspended" state and refuse to resume it
 * until the user has interacted with the page. A message can arrive
 * before that ever happens, so calling resume() at message time on a
 * fresh tab is silently rejected. We therefore arm the context on the
 * first real user gesture and treat sound as strictly best-effort — the
 * toast is the notification, the chime is a bonus. Never let audio
 * failure surface as an error.
 */

let ctx: AudioContext | null = null;
let armed = false;

type Ctor = typeof AudioContext;

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ??
    null
  );
}

/**
 * Attach one-shot gesture listeners that unlock audio playback.
 *
 * Safe to call repeatedly; only the first call binds. `pointerdown` and
 * `keydown` between them cover mouse, touch and keyboard-only users.
 */
export function armNotificationSound(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;

  const unlock = () => {
    const Ctor = getCtor();
    if (!Ctor) return;
    try {
      ctx ??= new Ctor();
      // Resuming inside the gesture handler is the only reliably
      // permitted moment, so do it here even though nothing plays yet.
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      // Audio unavailable (blocked, no device). Stay silent.
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/**
 * Play a short two-note chime. No-ops when audio was never unlocked,
 * which is the expected state on a tab the user has not touched yet.
 */
export function playNotificationSound(): void {
  if (!ctx || ctx.state !== 'running') return;

  try {
    const now = ctx.currentTime;
    // A rising major sixth (E6 -> C6 inverted): short, bright, and
    // distinct from OS chimes so it is not mistaken for a system alert.
    const notes = [
      { freq: 987.77, at: 0 },
      { freq: 1318.51, at: 0.09 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;

      const start = now + note.at;
      // Percussive envelope. The tiny attack ramp avoids the click that a
      // hard gain jump produces, and exponential decay reads as a bell.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    // Best-effort only.
  }
}
