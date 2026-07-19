"use client"

import useSWR from "swr"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import type { CustomTemplateVariable } from "@/lib/templates/studio-types"

// ============================================================
// Custom template variables data layer.
//
// Backed by the account-scoped `template_variables` table (RLS:
// account members only). These power the "Add variable" flow in
// the Template Studio — each row is a reusable {{key}} with a
// friendly label and a sample value for the live preview.
// ============================================================

/** Key rules mirror the DB CHECK constraint: ^[a-z0-9_]{1,40}$ */
export function normalizeVariableKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40)
}

interface DbVariableRow {
  id: string
  key: string
  label: string
  sample_value: string
}

function fromDb(row: DbVariableRow): CustomTemplateVariable {
  return { id: row.id, key: row.key, label: row.label, sampleValue: row.sample_value }
}

export function useTemplateVariables() {
  const { accountId } = useAuth()

  const { data, error, isLoading, mutate } = useSWR(
    accountId ? ["template-variables", accountId] : null,
    async () => {
      const supabase = createClient()
      const { data: rows, error: fetchError } = await supabase
        .from("template_variables")
        .select("id, key, label, sample_value")
        .order("created_at", { ascending: true })
      if (fetchError) throw fetchError
      return (rows as DbVariableRow[]).map(fromDb)
    },
  )

  async function createVariable(input: {
    key: string
    label: string
    sampleValue: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!accountId) return { ok: false, error: "Not signed in" }
    const key = normalizeVariableKey(input.key)
    if (!key) return { ok: false, error: "Key must use lowercase letters, numbers, underscores" }
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from("template_variables").insert({
      account_id: accountId,
      key,
      label: input.label.trim() || key,
      sample_value: input.sampleValue.trim(),
      created_by_user_id: user?.id ?? null,
    })
    if (insertError) {
      return {
        ok: false,
        error: insertError.code === "23505" ? `{{${key}}} already exists` : insertError.message,
      }
    }
    await mutate()
    return { ok: true }
  }

  async function deleteVariable(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const supabase = createClient()
    const { error: deleteError } = await supabase.from("template_variables").delete().eq("id", id)
    if (deleteError) return { ok: false, error: deleteError.message }
    await mutate()
    return { ok: true }
  }

  return {
    variables: data ?? [],
    isLoading,
    error,
    createVariable,
    deleteVariable,
  }
}
