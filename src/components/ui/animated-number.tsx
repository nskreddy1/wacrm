'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';

type AnimatedNumberProps = {
  value: number;
  /** Intl.NumberFormat options, e.g. { style: "currency", currency: "USD" } */
  format?: Intl.NumberFormatOptions;
  locale?: string;
  className?: string;
};

/**
 * Number ticker that rolls to new values (e.g. on realtime refresh).
 * - Renders the final value immediately on first mount (no count-up on load).
 * - Animates only on subsequent value *changes*.
 * - Uses tabular-nums so digits never shift layout.
 * - Respects prefers-reduced-motion (snaps instead of rolling).
 */
export function AnimatedNumber({
  value,
  format,
  locale = 'en',
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const isFirstRender = useRef(true);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const formatter = new Intl.NumberFormat(locale, format);

    if (isFirstRender.current || reducedMotion) {
      isFirstRender.current = false;
      motionValue.jump(value);
      node.textContent = formatter.format(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = formatter.format(Math.round(latest));
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale, reducedMotion]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {new Intl.NumberFormat(locale, format).format(value)}
    </span>
  );
}
