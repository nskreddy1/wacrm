import "server-only"

import { getCurrentAccount } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"
import type { PipelineRepository } from "./pipeline-repository"
import { SupabasePipelineRepository } from "./supabase-pipeline-repository"

export interface PipelineRuntime {
  accountId: string
  repository: PipelineRepository
  source: "supabase"
}

export async function getPipelineRuntime(): Promise<PipelineRuntime> {
  // Fails fast with a clear error when Supabase is not configured —
  // the SQLite demo repository fallback has been removed.
  getDataSource()

  const context = await getCurrentAccount()
  return { accountId: context.accountId, repository: new SupabasePipelineRepository(context), source: "supabase" }
}
