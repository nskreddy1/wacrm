export const cacheKeys = {
  pipelineSnapshot: (accountId: string, pipelineId: string) => ["account", accountId, "pipeline", pipelineId, "snapshot"] as const,
  contacts: (accountId: string) => ["account", accountId, "contacts"] as const,
}
