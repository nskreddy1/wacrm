'use client';

/**
 * Full-bleed canvas hosting the welcome halftone animation.
 *
 * Design ported from Twenty (twentyhq/twenty, AGPL-3.0). Owns the
 * canvas element and its DPR-correct backing store; the animation
 * itself lives in welcome-halftone-renderer. Calling with
 * `isLeaving` triggers the outward burst.
 */

import { useEffect, useRef } from 'react';
import { WELCOME_HALFTONE_DASHES } from '../lib/welcome-halftone-dots';
import { createWelcomeHalftoneRenderer } from '../lib/welcome-halftone-renderer';

const DOT_COLOR = '#4a38f5';
const DOT_HIGHLIGHT_COLOR = '#9b91f9';

export function WelcomeHalftoneCanvas({ isLeaving }: { isLeaving: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<
    typeof createWelcomeHalftoneRenderer
  > | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Cap at 2x: beyond that the extra pixels cost more than they show.
    const readDevicePixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

    const syncCanvasBackingStore = () => {
      const ratio = readDevicePixelRatio();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      return { width, height, ratio };
    };

    const initial = syncCanvasBackingStore();
    const renderer = createWelcomeHalftoneRenderer({
      context,
      dashes: WELCOME_HALFTONE_DASHES,
      width: initial.width,
      height: initial.height,
      devicePixelRatio: initial.ratio,
      color: DOT_COLOR,
      highlightColor: DOT_HIGHLIGHT_COLOR,
      reducedMotion: prefersReducedMotion,
    });
    rendererRef.current = renderer;

    // ResizeObserver over window.resize: it also catches orientation
    // changes and mobile browser-chrome collapse, which resize the
    // element without always firing a window resize event.
    const handleResize = () => {
      const next = syncCanvasBackingStore();
      if (next.width === 0 || next.height === 0) return;
      renderer.resize(next.width, next.height, next.ratio);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);
    // DPR can change when a window moves between displays; ResizeObserver
    // won't see that because the CSS size is unchanged.
    const dprQuery = window.matchMedia(
      `(resolution: ${readDevicePixelRatio()}dppx)`
    );
    dprQuery.addEventListener?.('change', handleResize);

    return () => {
      observer.disconnect();
      dprQuery.removeEventListener?.('change', handleResize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Hand the burst off to the renderer rather than re-mounting it, so
  // the dots explode from their current positions.
  useEffect(() => {
    if (isLeaving) rendererRef.current?.leave();
  }, [isLeaving]);

  return <canvas ref={canvasRef} aria-hidden className="block size-full" />;
}
