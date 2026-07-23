import { z } from "zod"

/**
 * Bigin-style "Customize Fields" layout for non-pipeline modules
 * (Appointments, Catalog). Stored per account + module in
 * module_field_settings.layout — the same shape as the per-pipeline
 * deal layout, so every module shares the RecordFieldsEditor design:
 *   { hidden: ["location"], custom: [{ id, label, type }] }
 */

export const MODULE_KEYS = ["appointments", "catalog"] as const
export type ModuleKey = (typeof MODULE_KEYS)[number]

export const moduleKeySchema = z.enum(MODULE_KEYS)

export const moduleFieldLayoutSchema = z.object({
  hidden: z.array(z.string().max(40)).max(30).default([]),
  custom: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1, "Field label is required").max(60),
        type: z.enum(["text", "number", "date"]).default("text"),
      }),
    )
    .max(10, "You can add up to 10 custom fields")
    .default([]),
})

export type ModuleFieldLayout = z.infer<typeof moduleFieldLayoutSchema>

export const EMPTY_MODULE_FIELD_LAYOUT: ModuleFieldLayout = { hidden: [], custom: [] }
