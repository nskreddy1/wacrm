import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Global input design system. Every input in the app comes from here —
 * never restyle inputs ad hoc in feature code. Pick a variant instead:
 *
 * - `default`   — boxed input for dense product UI (forms, settings, tables).
 * - `underline` — premium editorial style: no box, just a bottom rule that
 *                 thickens on focus. Used on auth pages and other marketing-
 *                 grade surfaces. Pair with `size="lg"`.
 *
 * Sizes: `default` (h-8, dense) and `lg` (h-12, spacious).
 */
const inputVariants = cva(
  "w-full min-w-0 bg-transparent text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-lg border border-input px-2.5 py-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        underline:
          "rounded-none border-0 border-b border-input px-0 shadow-none placeholder:text-muted-foreground/60 focus-visible:border-b-2 focus-visible:border-foreground focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0",
      },
      size: {
        default: "h-8",
        lg: "h-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Input({
  className,
  type,
  variant,
  size,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
