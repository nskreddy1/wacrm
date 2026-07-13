import "server-only"

import type { Notification } from "@/types"
import type {
  ContactField,
  ContactPreferences,
  ContactValue,
  FieldType,
  WorkspaceContact,
} from "@/lib/data/contacts/types"
import { DEMO_ACCOUNT_ID, DEMO_USER_ID } from "@/lib/data/runtime"

export type MockAccount = {
  id: string
  name: string
  ownerUserId: string
  defaultCurrency: string
}

export type MockProfile = {
  id: string
  userId: string
  accountId: string
  fullName: string
  email: string
  avatarUrl: string | null
  role: "owner" | "admin" | "agent" | "viewer"
}

export type MockPipelineStage = {
  id: string
  accountId: string
  pipelineId: string
  name: string
  position: number
  color: string
}

export type MockDeal = {
  id: string
  accountId: string
  pipelineId: string
  stageId: string
  contactId: string | null
  title: string
  value: number
  currency: string
  status: "open" | "won" | "lost"
  createdAt: string
  updatedAt: string
}

export type MockDatabase = {
  accounts: MockAccount[]
  profiles: MockProfile[]
  contactFields: ContactField[]
  contactPreferences: Record<string, ContactPreferences>
  contacts: WorkspaceContact[]
  pipelineStages: MockPipelineStage[]
  deals: MockDeal[]
  notifications: Notification[]
}

const CONTACT_NAMES = [
  "Ted Watson", "Ava Rodriguez", "Noah Williams", "Mia Chen", "Liam Anderson",
  "Sophia Patel", "Ethan Martinez", "Olivia Johnson", "Lucas Brown", "Emma Davis",
  "James Wilson", "Isabella Thomas", "Benjamin Lee", "Amelia Moore", "Henry Taylor",
  "Harper White", "Alexander Harris", "Evelyn Clark", "Daniel Lewis", "Charlotte Hall",
  "Michael Young", "Luna King", "Sebastian Wright", "Camila Scott", "Jack Green",
  "Sofia Baker", "Owen Adams", "Aria Nelson", "Samuel Carter", "Ella Mitchell",
]

function contactId(index: number) {
  return `00000000-0000-4001-8000-${String(index + 1).padStart(12, "0")}`
}

function createSeed(): MockDatabase {
  const contactFields: ContactField[] = [
    { id: "name", label: "Contact name", type: "text", required: true, width: 220 },
    { id: "email", label: "Email", type: "email", width: 230 },
    { id: "phone", label: "Phone", type: "phone", required: true, width: 160 },
    { id: "company", label: "Company", type: "text", width: 180 },
    { id: "street", label: "Mailing street", type: "text", width: 220 },
    { id: "city", label: "Mailing city", type: "text", width: 160 },
    { id: "state", label: "Mailing state", type: "single_select", options: ["California", "New York", "Texas", "Florida", "Illinois"], width: 170 },
    { id: "lifecycle", label: "Lifecycle", type: "single_select", options: ["Lead", "Qualified", "Customer", "Inactive"], width: 150 },
    { id: "value", label: "Customer value", type: "currency", width: 150 },
  ]
  const contacts = CONTACT_NAMES.map((name, index): WorkspaceContact => ({
    id: contactId(index),
    accountId: DEMO_ACCOUNT_ID,
    createdAt: new Date(2026, 5, index + 1).toISOString(),
    updatedAt: new Date(2026, 6, 12).toISOString(),
    values: {
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      phone: `+1415555${String(1100 + index)}`,
      company: ["Northstar Labs", "Acme Retail", "Evergreen Health", "Orbit Works"][index % 4],
      street: `${8 + index} Market Street`,
      city: ["San Francisco", "Austin", "New York", "Miami"][index % 4],
      state: ["California", "Texas", "New York", "Florida"][index % 4],
      lifecycle: ["Lead", "Qualified", "Customer", "Lead"][index % 4],
      value: 1800 + index * 425,
    },
  }))
  const pipelineId = "00000000-0000-4002-8000-000000000001"
  const stageNames = ["Qualification", "Needs analysis", "Proposal / pricing", "Negotiation", "Closed won", "Closed lost"]
  const pipelineStages = stageNames.map((name, position): MockPipelineStage => ({
    id: `00000000-0000-4003-8000-${String(position + 1).padStart(12, "0")}`,
    accountId: DEMO_ACCOUNT_ID,
    pipelineId,
    name,
    position,
    color: ["blue", "cyan", "amber", "blue", "green", "red"][position],
  }))
  const now = new Date().toISOString()

  return {
    accounts: [{ id: DEMO_ACCOUNT_ID, name: "Acme Support", ownerUserId: DEMO_USER_ID, defaultCurrency: "USD" }],
    profiles: [{ id: DEMO_USER_ID, userId: DEMO_USER_ID, accountId: DEMO_ACCOUNT_ID, fullName: "Sam Silva", email: "sam@acme.example", avatarUrl: null, role: "owner" }],
    contactFields,
    contactPreferences: {
      [DEMO_ACCOUNT_ID]: {
        visible: contactFields.map((field) => field.id),
        order: contactFields.map((field) => field.id),
        frozen: ["name"],
        widths: {},
      },
    },
    contacts,
    pipelineStages,
    deals: contacts.slice(0, 8).map((contact, index): MockDeal => ({
      id: `00000000-0000-4004-8000-${String(index + 1).padStart(12, "0")}`,
      accountId: DEMO_ACCOUNT_ID,
      pipelineId,
      stageId: pipelineStages[index % 5].id,
      contactId: contact.id,
      title: ["Annual support plan", "Customer care rollout", "WhatsApp commerce pilot", "Regional sales workspace", "Concierge automation", "Lead routing setup", "Healthcare intake expansion", "Renewal messaging program"][index],
      value: [12800, 24600, 8400, 31900, 17200, 6200, 42800, 14600][index],
      currency: "USD",
      status: index === 4 ? "won" : "open",
      createdAt: new Date(2026, 6, index + 1).toISOString(),
      updatedAt: now,
    })),
    notifications: [
      {
        id: "00000000-0000-4005-8000-000000000001",
        account_id: DEMO_ACCOUNT_ID,
        user_id: DEMO_USER_ID,
        type: "conversation_assigned",
        title: "Mia Chen was assigned to you",
        body: "Customer care rollout needs a reply.",
        conversation_id: "00000000-0000-4006-8000-000000000001",
        contact_id: contacts[3].id,
        created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      },
      {
        id: "00000000-0000-4005-8000-000000000002",
        account_id: DEMO_ACCOUNT_ID,
        user_id: DEMO_USER_ID,
        type: "conversation_assigned",
        title: "Ava Rodriguez was assigned to you",
        body: "Follow up on the renewal messaging program.",
        conversation_id: "00000000-0000-4006-8000-000000000002",
        contact_id: contacts[1].id,
        read_at: new Date(Date.now() - 35 * 60_000).toISOString(),
        created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      },
    ],
  }
}

const globalMock = globalThis as typeof globalThis & { __wacrmMockDatabase?: MockDatabase }

export function getMockDatabase(): MockDatabase {
  globalMock.__wacrmMockDatabase ??= createSeed()
  return globalMock.__wacrmMockDatabase
}

export function resetMockDatabase() {
  if (process.env.NODE_ENV !== "test") throw new Error("Mock database reset is test-only")
  globalMock.__wacrmMockDatabase = createSeed()
}

export function addMockContactField(input: { label: string; type: FieldType; options?: string[]; width?: number }) {
  const database = getMockDatabase()
  if (database.contactFields.length >= 100) throw new Error("The 100 field limit has been reached")
  const field: ContactField = { ...input, id: `custom_${crypto.randomUUID()}`, width: input.width ?? 180 }
  database.contactFields.push(field)
  for (const preferences of Object.values(database.contactPreferences)) {
    preferences.visible.push(field.id)
    preferences.order.push(field.id)
  }
  return field
}

export function normalizeMockPhone(value: ContactValue | undefined) {
  return String(value ?? "").replace(/\D/g, "")
}
