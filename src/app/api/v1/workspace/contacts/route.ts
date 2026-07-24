import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  createSupabaseContact,
  createSupabaseContactField,
  deleteSupabaseContactFields,
  deleteSupabaseContacts,
  getSupabaseContactWorkspace,
  updateSupabaseContact,
  updateSupabaseContactField,
} from '@/lib/data/contacts/supabase-repository';
import type {
  ContactPreferences,
  ContactValue,
  FieldType,
} from '@/lib/data/contacts/types';
import { getDataSource } from '@/lib/data/runtime';

export const dynamic = 'force-dynamic';

function response(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: { source: 'supabase' } }, { status });
}

function failure(error: unknown, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: 'request_failed',
        message: error instanceof Error ? error.message : 'Request failed',
      },
    },
    { status }
  );
}

export async function GET(request: Request) {
  try {
    getDataSource();
    const contactId = new URL(request.url).searchParams.get('id');
    const workspace = await getSupabaseContactWorkspace(
      await getCurrentAccount()
    );
    if (contactId) {
      const contact = workspace.contacts.find((item) => item.id === contactId);
      if (!contact) return failure(new Error('Contact not found'), 404);
      return response(contact);
    }
    return response(workspace);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    getDataSource();
    const body = (await request.json()) as {
      kind?: string;
      values?: Record<string, ContactValue>;
      field?: {
        label: string;
        type: FieldType;
        options?: string[];
        width?: number;
        required?: boolean;
        unique?: boolean;
      };
    };
    if (body.kind === 'field') {
      if (!body.field) throw new Error('Field details are required');
      return response(
        await createSupabaseContactField(await getCurrentAccount(), body.field),
        201
      );
    }
    if (!body.values) throw new Error('Contact values are required');
    return response(
      await createSupabaseContact(await getCurrentAccount(), body.values),
      201
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    getDataSource();
    const body = (await request.json()) as {
      kind?: string;
      id?: string;
      values?: Partial<Record<string, ContactValue>>;
      preferences?: Partial<ContactPreferences>;
      field?: {
        label?: string;
        type?: FieldType;
        options?: string[];
        required?: boolean;
        unique?: boolean;
      };
    };
    if (body.kind === 'preferences') return response(body.preferences ?? {});
    if (body.kind === 'field') {
      if (!body.id || !body.field)
        throw new Error('Field id and details are required');
      return response(
        await updateSupabaseContactField(
          await getCurrentAccount(),
          body.id,
          body.field
        )
      );
    }
    if (!body.id || !body.values)
      throw new Error('Contact id and values are required');
    return response(
      await updateSupabaseContact(
        await getCurrentAccount(),
        body.id,
        body.values
      )
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    getDataSource();
    const body = (await request.json()) as { kind?: string; ids?: string[] };
    if (!Array.isArray(body.ids)) throw new Error('Record ids are required');
    const context = await getCurrentAccount();
    if (body.kind === 'field')
      return response({
        deleted: await deleteSupabaseContactFields(context, body.ids),
      });
    return response({
      deleted: await deleteSupabaseContacts(context, body.ids),
    });
  } catch (error) {
    return failure(error);
  }
}
