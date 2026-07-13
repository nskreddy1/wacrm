import type { ComponentType, ReactNode } from "react"

import { AlertCircle, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function FeatureState({
  icon: Icon = AlertCircle,
  title,
  description,
  action,
  secondaryAction,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  secondaryAction?: ReactNode
}) {
  return (
    <Card className="mx-auto w-full max-w-xl border-border/80 shadow-sm">
      <CardHeader className="items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <CardTitle className="text-balance text-lg">{title}</CardTitle>
        <CardDescription className="max-w-md text-pretty leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      {(action || secondaryAction) && (
        <CardContent className="flex flex-wrap items-center justify-center gap-2">
          {action && <Button onClick={action.label ? action.onClick : undefined}>{action.label}</Button>}
          {secondaryAction}
        </CardContent>
      )}
    </Card>
  )
}

export function FeatureLoading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          <CardDescription>{label}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-4/5" />
        </CardContent>
      </Card>
    </div>
  )
}
