"use client"

import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Markdown } from "./markdown"

type ReasoningContextType = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

const ReasoningContext = createContext<ReasoningContextType | undefined>(
  undefined
)

function useReasoningContext() {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error(
      "useReasoningContext must be used within a Reasoning provider"
    )
  }
  return context
}

export type ReasoningProps = {
  children: React.ReactNode
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isStreaming?: boolean
}
function Reasoning({
  children,
  className,
  open,
  onOpenChange,
  isStreaming,
}: ReasoningProps) {
  // `null` = the user hasn't expressed a preference yet, so the panel
  // simply follows `isStreaming` (open while the model reasons, closed
  // once it's done). The first explicit toggle pins it to a real
  // boolean and streaming stops overriding it.
  //
  // Upstream tracked this with a second `wasAutoOpened` state and an
  // effect that called setState on every isStreaming flip, which
  // triggered a cascading re-render each time and also clobbered a
  // manual open the moment streaming ended. Deriving open-ness during
  // render removes both the effect and that surprise.
  const [internalOpen, setInternalOpen] = useState<boolean | null>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled
    ? open
    : (internalOpen ?? Boolean(isStreaming))

  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  return (
    <ReasoningContext.Provider
      value={{
        isOpen,
        onOpenChange: handleOpenChange,
      }}
    >
      <div className={className}>{children}</div>
    </ReasoningContext.Provider>
  )
}

export type ReasoningTriggerProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLButtonElement>

function ReasoningTrigger({
  children,
  className,
  ...props
}: ReasoningTriggerProps) {
  const { isOpen, onOpenChange } = useReasoningContext()

  return (
    <button
      className={cn("flex cursor-pointer items-center gap-2", className)}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      <span className="text-primary">{children}</span>
      <div
        className={cn(
          "transform transition-transform",
          isOpen ? "rotate-180" : ""
        )}
      >
        <ChevronDownIcon className="size-4" />
      </div>
    </button>
  )
}

export type ReasoningContentProps = {
  children: React.ReactNode
  className?: string
  markdown?: boolean
  contentClassName?: string
} & React.HTMLAttributes<HTMLDivElement>

function ReasoningContent({
  children,
  className,
  contentClassName,
  markdown = false,
  ...props
}: ReasoningContentProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const { isOpen } = useReasoningContext()
  // The inner content's measured height, kept in state so the collapse
  // animation is driven by a rendered value.
  //
  // Upstream read `contentRef.current?.scrollHeight` directly inside the
  // style prop. On first render that ref is still null, so the panel got
  // `max-height: undefined` and jumped open with no transition; and
  // because a ref mutation doesn't re-render, later growth was only
  // picked up by imperatively assigning .style in the observer, fighting
  // the same inline style React owns. Measuring into state means one
  // source of truth and a transition that always runs.
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return

    // Measure regardless of open state: reasoning text streams in while
    // the panel is open, and having a current height ready also means
    // re-opening animates from the correct target immediately.
    const measure = () => setContentHeight(inner.scrollHeight)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  const content = markdown ? (
    <Markdown>{children as string}</Markdown>
  ) : (
    children
  )

  return (
    <div
      className={cn(
        "overflow-hidden transition-[max-height] duration-150 ease-out",
        className
      )}
      style={{ maxHeight: isOpen ? contentHeight : 0 }}
      {...props}
    >
      <div
        ref={innerRef}
        className={cn(
          "text-muted-foreground prose prose-sm dark:prose-invert",
          contentClassName
        )}
      >
        {content}
      </div>
    </div>
  )
}

export { Reasoning, ReasoningTrigger, ReasoningContent }
