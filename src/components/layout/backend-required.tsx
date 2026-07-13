import { Database, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

export function BackendRequired({ module }: { module: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <section className="flex max-w-lg flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm" aria-labelledby="backend-required-title">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-primary"><Database aria-hidden="true" /></span>
        <div className="flex flex-col gap-2">
          <h1 id="backend-required-title" className="text-balance text-xl font-semibold text-foreground">{module} needs the application service</h1>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            The page is available, but its Supabase connection is not configured in this preview. Connect the project variables, then reload; no demo records are substituted for live data.
          </p>
        </div>
        <Button render={<a href="" />} nativeButton={false}><RefreshCw data-icon="inline-start" />Reload</Button>
      </section>
    </main>
  )
}

export function hasSupabaseEnvironment() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
