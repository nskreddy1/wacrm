import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { AiEnginePanel } from '@/components/admin/ai-engine-panel'

// ============================================================
// /admin — platform super-admin console.
//
// Server-gated: middleware already requires a session for the
// dashboard group, and this page additionally requires the platform
// super-admin role (seeded admin@wacrm.app, or the SUPER_ADMIN_EMAILS
// escape hatch). Non-admins are bounced to the dashboard — the page
// is intentionally not linked in the sidebar.
//
// First (and currently only) control: the platform-wide AI engine
// flag (direct vs LangChain). Future platform roles/settings land
// here too.
// ============================================================

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!(await isSuperAdmin(user))) redirect('/dashboard')

  return (
    <main className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Platform Admin
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground text-pretty">
        Platform-wide controls. Changes here affect every workspace on this
        deployment.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <AiEnginePanel />
      </div>
    </main>
  )
}
