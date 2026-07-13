import { z } from "zod"

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
})

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ data })
}

export type ApiError = z.infer<typeof apiErrorSchema>
