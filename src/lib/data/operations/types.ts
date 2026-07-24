// ============================================================
// Operations domain — catalog items, appointments, and tasks.
//
// These are the "work to do" primitives behind the dashboard's
// operational widgets (Upcoming appointments, Tasks, Needs
// attention). All rows are account-scoped; see migration 054.
// ============================================================

export type AppointmentStatus =
  'scheduled' | 'completed' | 'cancelled' | 'no_show';

export type TaskStatus = 'open' | 'done' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high';

/** Values for account-defined custom fields, keyed by field id. */
export type CustomValues = Record<string, string>;

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: string;
  isActive: boolean;
  customValues: CustomValues;
  createdAt: string;
}

export interface Appointment {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  status: AppointmentStatus;
  contactId: string;
  contactName: string | null;
  catalogItemId: string | null;
  catalogItemName: string | null;
  assignedTo: string | null;
  dealId: string | null;
  customValues: CustomValues;
  createdAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  assignedTo: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ---- Write inputs (validated in validation.ts before reaching the repository) ----

export interface CatalogItemInput {
  name: string;
  description?: string | null;
  category?: string | null;
  price?: number;
  currency?: string;
  isActive?: boolean;
  customValues?: CustomValues | null;
}

export interface AppointmentInput {
  title: string;
  contactId: string;
  notes?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  catalogItemId?: string | null;
  assignedTo?: string | null;
  dealId?: string | null;
  customValues?: CustomValues | null;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  priority?: TaskPriority;
  contactId?: string | null;
  dealId?: string | null;
  assignedTo?: string | null;
}
