'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

type SectionProps = {
  children: ReactNode;
  className?: string;
  /** entrance order — each step adds a 40ms delay */
  index?: number;
};

/**
 * Staggered entrance wrapper for dashboard sections.
 * translateY(8px) + fade, 240ms, --ease-pipeline curve, 40ms stagger.
 * Reduced motion: no transform, quick fade only.
 */
export function Section({ children, className, index = 0 }: SectionProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      className={className}
      initial={
        reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, transform: 'translateY(8px)' }
      }
      animate={
        reducedMotion
          ? { opacity: 1 }
          : { opacity: 1, transform: 'translateY(0px)' }
      }
      transition={{
        duration: 0.24,
        ease: [0.22, 1, 0.36, 1],
        delay: index * 0.04,
      }}
    >
      {children}
    </motion.section>
  );
}
