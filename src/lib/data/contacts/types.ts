export type FieldType =
  | "text"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "url"
  | "single_select"
  | "multi_select"
  | "checkbox"
  | "currency"

export type ContactField = {
  id: string
  label: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  options?: string[]
  width: number
  custom?: boolean
}

export type ContactValue = string | number | boolean | string[]

export type WorkspaceContact = {
  id: string
  accountId: string
  createdAt: string
  updatedAt: string
  values: Record<string, ContactValue>
}

export type ContactPreferences = {
  visible: string[]
  order: string[]
  frozen: string[]
  widths: Record<string, number>
}

export type ContactWorkspaceData = {
  contacts: WorkspaceContact[]
  fields: ContactField[]
  preferences: ContactPreferences
}
