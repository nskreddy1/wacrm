// ============================================================
// Supabase repository for the operations domain.
//
// Every function receives an AccountContext (RLS-scoped client +
// accountId) and additionally filters by account_id explicitly —
// defense in depth on top of RLS, matching the repository pattern
// used by contacts/dashboard.
// ============================================================

import type { AccountContext } from '@/features/auth/lib/account';

import type {
  Appointment,
  AppointmentInput,
  AppointmentStatus,
  CatalogItem,
  CatalogItemInput,
  TaskInput,
  TaskItem,
  TaskPriority,
  TaskStatus,
} from './types';

// ------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase domain objects)
// ------------------------------------------------------------

type Row = Record<string, unknown>;

function relationName(value: unknown): string | null {
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function mapCustomValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

function mapCatalogItem(row: Row): CatalogItem {
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    price: Number(row.price ?? 0),
    currency: String(row.currency ?? 'USD'),
    isActive: Boolean(row.is_active),
    customValues: mapCustomValues(row.custom_values),
    createdAt: String(row.created_at),
  };
}

function mapAppointment(row: Row): Appointment {
  return {
    id: String(row.id),
    title: String(row.title),
    notes: (row.notes as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    startsAt: String(row.starts_at),
    endsAt: (row.ends_at as string | null) ?? null,
    status: String(row.status) as AppointmentStatus,
    contactId: String(row.contact_id),
    contactName: relationName(row.contact),
    catalogItemId: (row.catalog_item_id as string | null) ?? null,
    catalogItemName: relationName(row.catalog_item),
    assignedTo: (row.assigned_to as string | null) ?? null,
    dealId: (row.deal_id as string | null) ?? null,
    customValues: mapCustomValues(row.custom_values),
    createdAt: String(row.created_at),
  };
}

function mapTask(row: Row): TaskItem {
  return {
    id: String(row.id),
    title: String(row.title),
    notes: (row.notes as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    priority: String(row.priority) as TaskPriority,
    status: String(row.status) as TaskStatus,
    contactId: (row.contact_id as string | null) ?? null,
    contactName: relationName(row.contact),
    dealId: (row.deal_id as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

const APPOINTMENT_SELECT =
  'id, title, notes, location, starts_at, ends_at, status, contact_id, catalog_item_id, assigned_to, deal_id, custom_values, created_at, contact:contacts(name), catalog_item:catalog_items(name)';

const TASK_SELECT =
  'id, title, notes, due_at, priority, status, contact_id, deal_id, assigned_to, completed_at, created_at, contact:contacts(name)';

const CATALOG_SELECT =
  'id, name, description, category, price, currency, is_active, custom_values, created_at';

class OperationsError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OperationsError';
    if (cause) console.error(`[operations] ${message}:`, cause);
  }
}

// ------------------------------------------------------------
// Catalog items
// ------------------------------------------------------------

export async function listCatalogItems(
  ctx: AccountContext,
  options: { includeInactive?: boolean } = {}
): Promise<CatalogItem[]> {
  let query = ctx.supabase
    .from('catalog_items')
    .select(CATALOG_SELECT)
    .eq('account_id', ctx.accountId)
    .order('name', { ascending: true });

  if (!options.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw new OperationsError('Failed to list catalog items', error);
  return (data ?? []).map(mapCatalogItem);
}

export async function createCatalogItem(
  ctx: AccountContext,
  input: CatalogItemInput
): Promise<CatalogItem> {
  const { data, error } = await ctx.supabase
    .from('catalog_items')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      price: input.price ?? 0,
      currency: input.currency ?? 'USD',
      is_active: input.isActive ?? true,
      custom_values: input.customValues ?? {},
    })
    .select(CATALOG_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to create catalog item', error);
  return mapCatalogItem(data);
}

export async function updateCatalogItem(
  ctx: AccountContext,
  id: string,
  input: Partial<CatalogItemInput>
): Promise<CatalogItem> {
  const patch: Row = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.price !== undefined) patch.price = input.price;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.customValues !== undefined)
    patch.custom_values = input.customValues ?? {};

  const { data, error } = await ctx.supabase
    .from('catalog_items')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select(CATALOG_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to update catalog item', error);
  return mapCatalogItem(data);
}

export async function deleteCatalogItems(
  ctx: AccountContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('catalog_items')
    .delete()
    .in('id', ids)
    .eq('account_id', ctx.accountId)
    .select('id');

  if (error) throw new OperationsError('Failed to delete catalog items', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------------
// Appointments
// ------------------------------------------------------------

export async function listAppointments(
  ctx: AccountContext,
  options: { status?: AppointmentStatus; from?: string; limit?: number } = {}
): Promise<Appointment[]> {
  let query = ctx.supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('account_id', ctx.accountId)
    .order('starts_at', { ascending: true })
    .limit(options.limit ?? 50);

  if (options.status) query = query.eq('status', options.status);
  if (options.from) query = query.gte('starts_at', options.from);

  const { data, error } = await query;
  if (error) throw new OperationsError('Failed to list appointments', error);
  return (data ?? []).map(mapAppointment);
}

export async function createAppointment(
  ctx: AccountContext,
  input: AppointmentInput
): Promise<Appointment> {
  const { data, error } = await ctx.supabase
    .from('appointments')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      title: input.title,
      contact_id: input.contactId,
      notes: input.notes ?? null,
      location: input.location ?? null,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      catalog_item_id: input.catalogItemId ?? null,
      assigned_to: input.assignedTo ?? null,
      deal_id: input.dealId ?? null,
      custom_values: input.customValues ?? {},
    })
    .select(APPOINTMENT_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to create appointment', error);
  return mapAppointment(data);
}

export async function updateAppointment(
  ctx: AccountContext,
  id: string,
  input: Partial<AppointmentInput> & { status?: AppointmentStatus }
): Promise<Appointment> {
  const patch: Row = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.location !== undefined) patch.location = input.location;
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
  if (input.status !== undefined) patch.status = input.status;
  if (input.catalogItemId !== undefined)
    patch.catalog_item_id = input.catalogItemId;
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
  if (input.dealId !== undefined) patch.deal_id = input.dealId;
  if (input.customValues !== undefined)
    patch.custom_values = input.customValues ?? {};

  const { data, error } = await ctx.supabase
    .from('appointments')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select(APPOINTMENT_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to update appointment', error);
  return mapAppointment(data);
}

export async function deleteAppointments(
  ctx: AccountContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('appointments')
    .delete()
    .in('id', ids)
    .eq('account_id', ctx.accountId)
    .select('id');

  if (error) throw new OperationsError('Failed to delete appointments', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------------
// Tasks
// ------------------------------------------------------------

export async function listTasks(
  ctx: AccountContext,
  options: { status?: TaskStatus; limit?: number } = {}
): Promise<TaskItem[]> {
  let query = ctx.supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('account_id', ctx.accountId)
    // Open tasks first by nearest due date; tasks without a due date last.
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);

  if (options.status) query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw new OperationsError('Failed to list tasks', error);
  return (data ?? []).map(mapTask);
}

export async function createTask(
  ctx: AccountContext,
  input: TaskInput
): Promise<TaskItem> {
  const { data, error } = await ctx.supabase
    .from('tasks')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      title: input.title,
      notes: input.notes ?? null,
      due_at: input.dueAt ?? null,
      priority: input.priority ?? 'medium',
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      assigned_to: input.assignedTo ?? null,
    })
    .select(TASK_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to create task', error);
  return mapTask(data);
}

export async function updateTask(
  ctx: AccountContext,
  id: string,
  input: Partial<TaskInput> & { status?: TaskStatus }
): Promise<TaskItem> {
  const patch: Row = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.contactId !== undefined) patch.contact_id = input.contactId;
  if (input.dealId !== undefined) patch.deal_id = input.dealId;
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.completed_at =
      input.status === 'done' ? new Date().toISOString() : null;
  }

  const { data, error } = await ctx.supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select(TASK_SELECT)
    .single();

  if (error) throw new OperationsError('Failed to update task', error);
  return mapTask(data);
}

export async function deleteTasks(
  ctx: AccountContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('tasks')
    .delete()
    .in('id', ids)
    .eq('account_id', ctx.accountId)
    .select('id');

  if (error) throw new OperationsError('Failed to delete tasks', error);
  return data?.length ?? 0;
}
