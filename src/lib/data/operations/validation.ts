// ============================================================
// Zod schemas for the operations domain (catalog, appointments,
// tasks). Routes parse request bodies with these BEFORE any data
// access so the repository can assume shape-valid input.
// ============================================================

import { z } from "zod"

const uuid = z.string().uuid()
const isoTimestamp = z.string().datetime({ offset: true })

// Trimmed, non-empty, bounded text — applied to every user-facing string.
const requiredText = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : null))
    .nullish()

/** Values for account-defined custom fields, keyed by field id. */
export const customValuesSchema = z
  .record(z.string().max(60), z.string().max(500))
  .refine((value) => Object.keys(value).length <= 10, {
    message: "Too many custom field values",
  })

export const catalogItemCreateSchema = z.object({
  name: requiredText(160),
  description: optionalText(2000),
  category: optionalText(80),
  price: z.number().min(0).max(999_999_999).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  isActive: z.boolean().default(true),
  customValues: customValuesSchema.nullish(),
})

export const catalogItemUpdateSchema = catalogItemCreateSchema
  .partial()
  .extend({ id: uuid })

export const appointmentCreateSchema = z
  .object({
    title: requiredText(200),
    contactId: uuid,
    notes: optionalText(2000),
    location: optionalText(200),
    startsAt: isoTimestamp,
    endsAt: isoTimestamp.nullish(),
    catalogItemId: uuid.nullish(),
    assignedTo: uuid.nullish(),
    dealId: uuid.nullish(),
    customValues: customValuesSchema.nullish(),
  })
  .refine(
    (value) => !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt),
    { message: "End time must be after start time", path: ["endsAt"] },
  )

export const appointmentUpdateSchema = z.object({
  id: uuid,
  title: requiredText(200).optional(),
  notes: optionalText(2000),
  location: optionalText(200),
  startsAt: isoTimestamp.optional(),
  endsAt: isoTimestamp.nullish(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional(),
  catalogItemId: uuid.nullish(),
  assignedTo: uuid.nullish(),
  dealId: uuid.nullish(),
  customValues: customValuesSchema.nullish(),
})

export const taskCreateSchema = z.object({
  title: requiredText(200),
  notes: optionalText(2000),
  dueAt: isoTimestamp.nullish(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  contactId: uuid.nullish(),
  dealId: uuid.nullish(),
  assignedTo: uuid.nullish(),
})

export const taskUpdateSchema = z.object({
  id: uuid,
  title: requiredText(200).optional(),
  notes: optionalText(2000),
  dueAt: isoTimestamp.nullish(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
  contactId: uuid.nullish(),
  dealId: uuid.nullish(),
  assignedTo: uuid.nullish(),
})

export const idListSchema = z.object({ ids: z.array(uuid).min(1).max(100) })
