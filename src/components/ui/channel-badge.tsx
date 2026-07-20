import { Mail, MessageCircle, MessageSquareText } from "lucide-react"
import { cn } from "@/lib/utils"

/** Every channel the product can display (conversations: whatsapp/email, broadcasts: whatsapp/sms). */
export type BadgeChannel = "whatsapp" | "sms" | "email"

type ChannelBadgeProps = {
  channel: BadgeChannel
  className?: string
  /** compact = icon + short label, useful in dense tables */
  compact?: boolean
}

const CHANNEL_META = {
  whatsapp: { label: "WhatsApp", Icon: MessageCircle, dot: "bg-channel-whatsapp", text: "text-channel-whatsapp" },
  sms: { label: "SMS", Icon: MessageSquareText, dot: "bg-channel-sms", text: "text-channel-sms" },
  email: { label: "Email", Icon: Mail, dot: "bg-channel-email", text: "text-channel-email" },
} as const

/** Fixed semantic channel identity: icon + label + channel color (never color alone). */
export function ChannelBadge({ channel, className, compact = false }: ChannelBadgeProps) {
  const meta = CHANNEL_META[channel]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card-2 font-medium",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <meta.Icon className={cn("shrink-0", compact ? "size-3" : "size-3.5", meta.text)} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

export function channelColorVar(channel: BadgeChannel) {
  return `var(--channel-${channel})`
}

export function channelLabel(channel: BadgeChannel) {
  return CHANNEL_META[channel].label
}
