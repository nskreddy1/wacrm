"use server"

import { revalidatePath } from "next/cache"
import { requireRole } from "@/lib/auth/account"
import {
  moduleFieldLayoutSchema,
  moduleKeySchema,
  type ModuleFieldLayout,
  type ModuleKey,
} from "./validation"

export type ModuleFieldsActionResult =
  | { ok: true; data: ModuleFieldLayout }
  | { ok: false; error: string }

function fail(error: unknown): ModuleFieldsActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" }
}

/** Paths that render each module's records — revalidated after a layout change. */
const MODULE_PATHS: Record<ModuleKey, string[]> = {
  appointments: ["/appointments"],
  catalog: ["/catalog"],
}

export async function getModuleFieldLayoutAction(rawModule: string): Promise<ModuleFieldsActionResult> {
  try {
    const moduleKey = moduleKeySchema.parse(rawModule)
    const { supabase, accountId } = await requireRole("viewer")
    const { data, error } = await supabase
      .from("module_field_settings")
      .select("layout")
      .eq("account_id", accountId)
      .eq("module", moduleKey)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return { ok: true, data: moduleFieldLayoutSchema.parse(data?.layout ?? {}) }
  } catch (error) {
    return fail(error)
  }
}

export async function saveModuleFieldLayoutAction(rawModule: string, raw: unknown): Promise<ModuleFieldsActionResult> {
  try {
    const moduleKey = moduleKeySchema.parse(rawModule)
    const layout = moduleFieldLayoutSchema.parse(raw)
    const { supabase, accountId, userId } = await requireRole("agent")
    const { error } = await supabase.from("module_field_settings").upsert({
      account_id: accountId,
      module: moduleKey,
      layout,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    if (error) throw new Error(error.message)
    for (const path of MODULE_PATHS[moduleKey]) revalidatePath(path)
    return { ok: true, data: layout }
  } catch (error) {
    return fail(error)
  }
}
