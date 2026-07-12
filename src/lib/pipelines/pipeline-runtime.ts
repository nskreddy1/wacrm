import "server-only"

import { getDatabaseProvider } from "@/lib/config/database-provider"
import { getCurrentAccount } from "@/lib/auth/account"
import { hasSupabaseConfig } from "@/lib/supabase/server"
import type { PipelineRepository } from "./pipeline-repository"
import { SqlitePipelineRepository, DEMO_ACCOUNT_ID } from "./sqlite-pipeline-repository"
import { SupabasePipelineRepository } from "./supabase-pipeline-repository"

export interface PipelineRuntime {
  accountId: string
  repository: PipelineRepository
  source: "supabase" | "neon" | "sqlite-demo"
}

export async function getPipelineRuntime(): Promise<PipelineRuntime> {
  if (getDatabaseProvider() === "neon") {
    const [{ getCurrentNeonAccount }, { NeonPipelineRepository }] = await Promise.all([
      import("@/lib/neon/account"),
      import("./neon-pipeline-repository"),
    ])
    const context = await getCurrentNeonAccount()
    return { accountId: context.accountId, repository: new NeonPipelineRepository(context), source: "neon" }
  }

  if (!hasSupabaseConfig()) {
    return { accountId: DEMO_ACCOUNT_ID, repository: new SqlitePipelineRepository(DEMO_ACCOUNT_ID), source: "sqlite-demo" }
  }

  const context = await getCurrentAccount()
  return { accountId: context.accountId, repository: new SupabasePipelineRepository(context), source: "supabase" }
}
