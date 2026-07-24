// ============================================================
// /api/v1/workspace/appointments — session-scoped appointment CRUD.
//
// GET    ?status=scheduled&from=<iso>&limit=<n>  — list
// POST   { title, contactId, startsAt, ... }     — create
// PATCH  { id, ...fields }                        — update
// DELETE { ids: [...] }                           — bulk delete
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  createAppointment,
  deleteAppointments,
  listAppointments,
  updateAppointment,
} from '@/lib/data/operations/supabase-repository';
import type { AppointmentStatus } from '@/lib/data/operations/types';
import {
  appointmentCreateSchema,
  appointmentUpdateSchema,
  idListSchema,
} from '@/lib/data/operations/validation';

export const dynamic = 'force-dynamic';

function response(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: { source: 'supabase' } }, { status });
}

function validationFailure(error: z.ZodError) {
  return NextResponse.json(
    {
      error: {
        code: 'validation_failed',
        message: error.issues[0]?.message ?? 'Invalid request body',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    },
    { status: 422 }
  );
}

const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'scheduled',
  'completed',
  'cancelled',
  'no_show',
];

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const status = APPOINTMENT_STATUSES.includes(
      statusParam as AppointmentStatus
    )
      ? (statusParam as AppointmentStatus)
      : undefined;
    const from = url.searchParams.get('from') ?? undefined;
    const limitParam = Number(url.searchParams.get('limit'));
    const limit =
      Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 200
        ? limitParam
        : undefined;

    return response(await listAppointments(ctx, { status, from, limit }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const parsed = appointmentCreateSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailure(parsed.error);
    return response(await createAppointment(ctx, parsed.data), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const parsed = appointmentUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailure(parsed.error);
    const { id, ...fields } = parsed.data;
    return response(await updateAppointment(ctx, id, fields));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const parsed = idListSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailure(parsed.error);
    return response({
      deleted: await deleteAppointments(ctx, parsed.data.ids),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
