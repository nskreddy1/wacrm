import { z } from 'zod';

export const uuidSchema = z
  .string()
  .uuid('Select a valid record and try again');

export function formatPipelineError(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error
      ? error.message
      : 'The change could not be saved';
  }

  return error.issues
    .map((issue) => {
      const field = issue.path.at(-1);
      return field ? `${String(field)}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
export const pipelineModeSchema = z.enum(['board', 'list', 'sheet']);
export const dealPrioritySchema = z.enum(['low', 'normal', 'high', 'hot']);

export const dealInputSchema = z.object({
  id: uuidSchema.optional(),
  pipelineId: uuidSchema,
  stageId: uuidSchema,
  contactId: uuidSchema.nullable().optional(),
  catalogItemId: uuidSchema.nullable().optional(),
  assignedTo: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1, 'Deal name is required').max(160),
  value: z.coerce.number().finite().min(0),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  company: z.string().trim().max(160).nullable().optional(),
  priority: dealPrioritySchema.default('normal'),
  probability: z.coerce.number().int().min(0).max(100),
  source: z.string().trim().max(120).nullable().optional(),
  activity: z.string().trim().max(240).nullable().optional(),
  nextStep: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  due: z.iso.date().nullable().optional(),
  status: z.enum(['open', 'won', 'lost']).default('open'),
  position: z.coerce.number().int().min(0).default(0),
  customValues: z.record(z.string().max(60), z.string().max(500)).optional(),
});

// A single "Associated Catalog" line item on a deal (Bigin's Associated Products)
export const dealItemInputSchema = z.object({
  id: uuidSchema.optional(),
  catalogItemId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1, 'Pick a catalog item').max(160),
  listPrice: z.coerce.number().finite().min(0),
  quantity: z.coerce
    .number()
    .finite()
    .gt(0, 'Quantity must be above zero')
    .max(99999),
  discountPct: z.coerce.number().finite().min(0).max(100),
  position: z.coerce.number().int().min(0).default(0),
});

export const dealItemsSaveSchema = z.object({
  pipelineId: uuidSchema,
  dealId: uuidSchema,
  items: z.array(dealItemInputSchema).max(50),
});

// Customize Fields layout stored per pipeline in deal_field_settings.layout
export const dealFieldLayoutSchema = z.object({
  hidden: z.array(z.string().max(40)).max(30).default([]),
  custom: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1, 'Field label is required').max(60),
        type: z.enum(['text', 'number', 'date']).default('text'),
      })
    )
    .max(10, 'You can add up to 10 custom fields')
    .default([]),
});

export const savedViewInputSchema = z.object({
  id: uuidSchema.optional(),
  pipelineId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: z.record(z.string(), z.unknown()).default({}),
  visibleFields: z.array(z.string().max(80)).max(30).default([]),
  favorite: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

export const subPipelineInputSchema = z.object({
  id: uuidSchema.optional(),
  pipelineId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).default(0),
});

export type DealInput = z.infer<typeof dealInputSchema>;
export type DealItemInput = z.infer<typeof dealItemInputSchema>;
export type DealFieldLayout = z.infer<typeof dealFieldLayoutSchema>;
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;
export type SubPipelineInput = z.infer<typeof subPipelineInputSchema>;
