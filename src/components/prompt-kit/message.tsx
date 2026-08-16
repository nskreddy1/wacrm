import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown"

export type MessageProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("flex gap-3", className)} {...props}>
    {children}
  </div>
)

export type MessageAvatarProps = {
  src: string
  alt: string
  fallback?: string
  className?: string
}

const MessageAvatar = ({
  src,
  alt,
  fallback,
  className,
}: MessageAvatarProps) => {
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      <AvatarImage src={src} alt={alt} />
      {/* Base UI's Avatar.Fallback exposes `delay`, not Radix's `delayMs`,
          so the prop is dropped rather than leaking onto the DOM node. */}
      {fallback && <AvatarFallback>{fallback}</AvatarFallback>}
    </Avatar>
  )
}

export type MessageContentProps = {
  children: React.ReactNode
  markdown?: boolean
  className?: string
} & React.ComponentProps<typeof Markdown> &
  React.HTMLProps<HTMLDivElement>

const MessageContent = ({
  children,
  markdown = false,
  className,
  ...props
}: MessageContentProps) => {
  const classNames = cn(
    // Upstream also lists `prose` here, but @tailwindcss/typography isn't
    // installed in this project, so it styles nothing and only implies
    // that it does. Markdown element spacing comes from markdown.tsx's
    // own component map instead.
    //
    // `wrap-break-word` (overflow-wrap) rather than `break-words`: it only
    // breaks words that genuinely can't fit, and — importantly — a
    // long-word break-anywhere rule makes an element's min-content width
    // one character, which lets it collapse into a vertical sliver in any
    // shrink-to-fit parent.
    "rounded-lg p-2 text-foreground bg-secondary wrap-break-word whitespace-normal",
    className
  )

  return markdown ? (
    <Markdown className={classNames} {...props}>
      {children as string}
    </Markdown>
  ) : (
    <div className={classNames} {...props}>
      {children}
    </div>
  )
}

export type MessageActionsProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

const MessageActions = ({
  children,
  className,
  ...props
}: MessageActionsProps) => (
  <div
    className={cn("text-muted-foreground flex items-center gap-2", className)}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionProps = {
  className?: string
  tooltip: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
} & React.ComponentProps<typeof Tooltip>

const MessageAction = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}: MessageActionProps) => {
  return (
    <TooltipProvider>
      <Tooltip {...props}>
        {/* Base UI merges a trigger into its child via `render`, not `asChild`. */}
        <TooltipTrigger
          render={children as React.ReactElement<Record<string, unknown>>}
        />
        <TooltipContent side={side} className={className}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction }
