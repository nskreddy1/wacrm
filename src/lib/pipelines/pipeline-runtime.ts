import "server-only"

import { getCurrentAccount } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"
import type { PipelineRepository } from "./pipeline-repository"
import { SqlitePipelineRepository, DEMO_ACCOUNT_ID } from "./sqlite-pipeline-repository"
import { SupabasePipelineRepository } from "./supabase-pipeline-repository"

export interface PipelineRuntime {
  accountId: string
  repository: PipelineRepository
  source: "supabase" | "mock"
}

export async function getPipelineRuntime(): Promise<PipelineRuntime> {
  if (getDataSource() === "mock") {
    return { accountId: DEMO_ACCOUNT_ID, repository: new SqlitePipelineRepository(DEMO_ACCOUNT_ID), source: "mock" }
  }

  const context = await getCurrentAccount()
  return { accountId: context.accountId, repository: new SupabasePipelineRepository(context), source: "supabase" }
}
