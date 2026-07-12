import "server-only"

import { getCurrentAccount } from "@/lib/auth/account"
import { hasSupabaseConfig } from "@/lib/supabase/server"
import type { PipelineRepository } from "./pipeline-repository"
import { SqlitePipelineRepository, DEMO_ACCOUNT_ID } from "./sqlite-pipeline-repository"
import { SupabasePipelineRepository } from "./supabase-pipeline-repository"

export interface PipelineRuntime {
  accountId: string
  repository: PipelineRepository
  source: "supabase" | "sqlite-demo"
}

export async function getPipelineRuntime(): Promise<PipelineRuntime> {
  if (!hasSupabaseConfig()) {
    return {
      accountId: DEMO_ACCOUNT_ID,
      repository: new SqlitePipelineRepository(DEMO_ACCOUNT_ID),
      source: "sqlite-demo",
    }
  }

  const context = await getCurrentAccount()
  return {
    accountId: context.accountId,
    repository: new SupabasePipelineRepository(context),
    source: "supabase",
  }
}
