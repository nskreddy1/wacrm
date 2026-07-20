"use client"

import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

type AnimatedBarProps = {
  /** 0–100 */
  percent: number
  /** CSS color for the fill, e.g. `var(--channel-whatsapp)` */
  color?: string
  className?: string
  /** seconds, staggers multiple bars */
  delay?: number
}

/**
 * Horizontal progress bar whose fill animates from 0 to `percent`
 * on mount and re-animates when the value changes.
 * Reduced motion: renders at final width immediately.
 */
export function AnimatedBar({ percent, color, className, delay = 0 }: AnimatedBarProps) {
  const reducedMotion = useReducedMotion()
  const width = `${Math.max(0, Math.min(100, percent))}%`
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color ?? "var(--primary)" }}
        initial={reducedMotion ? { width } : { width: "0%" }}
        animate={{ width }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      />
    </div>
  )
}
