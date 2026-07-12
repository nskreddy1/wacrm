import { DatabaseSync } from "node:sqlite"

import type {
  PipelineDeal,
  PipelineMember,
  PipelineRecord,
  PipelineSnapshot,
} from "./domain"
import type { PipelineRepository } from "./pipeline-repository"

export const DEMO_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"
export const DEMO_PIPELINE_ID = "00000000-0000-4000-8000-000000000101"
export const DEMO_SAVED_VIEW_ID = "00000000-0000-4000-8000-000000000201"

const now = "2026-07-13T12:00:00.000Z"

type SqlRow = Record<string, unknown>

function rows(
  statement: ReturnType<DatabaseSync["prepare"]>,
  ...parameters: (string | number | null)[]
): SqlRow[] {
  return statement.all(...parameters) as SqlRow[]
}

function createDemoDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL, full_name TEXT, email TEXT, avatar_url TEXT, account_role TEXT NOT NULL);
    CREATE TABLE pipelines (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE pipeline_stages (id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, color TEXT NOT NULL);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT);
    CREATE TABLE deals (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, pipeline_id TEXT NOT NULL, stage_id TEXT NOT NULL, contact_id TEXT, assigned_to TEXT, title TEXT NOT NULL, value REAL NOT NULL, currency TEXT NOT NULL, company TEXT, priority TEXT NOT NULL, probability INTEGER NOT NULL, lead_source TEXT, last_activity TEXT, next_step TEXT, description TEXT, expected_close_date TEXT, status TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE pipeline_saved_views (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, pipeline_id TEXT NOT NULL, name TEXT NOT NULL, filters TEXT NOT NULL, sort TEXT NOT NULL, visible_fields TEXT NOT NULL, is_favorite INTEGER NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE sub_pipelines (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, pipeline_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE sub_pipeline_deals (account_id TEXT NOT NULL, sub_pipeline_id TEXT NOT NULL, deal_id TEXT NOT NULL, position INTEGER NOT NULL);

    INSERT INTO accounts VALUES ('${DEMO_ACCOUNT_ID}', 'Acme Demo');
    INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000401', '${DEMO_ACCOUNT_ID}', 'Avery Johnson', 'avery@example.com', NULL, 'admin');
    INSERT INTO pipelines VALUES ('${DEMO_PIPELINE_ID}', '${DEMO_ACCOUNT_ID}', 'Sales Pipeline', 0, '${now}');
    INSERT INTO pipelines VALUES ('00000000-0000-4000-8000-000000000102', '${DEMO_ACCOUNT_ID}', 'Renewals', 1, '${now}');
    INSERT INTO pipeline_stages VALUES ('00000000-0000-4000-8000-000000000501', '${DEMO_PIPELINE_ID}', 'Qualified', 0, '#3b82f6');
    INSERT INTO pipeline_stages VALUES ('00000000-0000-4000-8000-000000000502', '${DEMO_PIPELINE_ID}', 'Proposal', 1, '#f59e0b');
    INSERT INTO pipeline_stages VALUES ('00000000-0000-4000-8000-000000000503', '${DEMO_PIPELINE_ID}', 'Won', 2, '#22c55e');
    INSERT INTO contacts VALUES ('00000000-0000-4000-8000-000000000601', '${DEMO_ACCOUNT_ID}', 'Jordan Lee', 'Northstar Labs', 'jordan@example.com', '+1555010101');
    INSERT INTO contacts VALUES ('00000000-0000-4000-8000-000000000602', '${DEMO_ACCOUNT_ID}', 'Morgan Chen', 'Summit Works', 'morgan@example.com', '+1555010102');
    INSERT INTO deals VALUES ('00000000-0000-4000-8000-000000000701', '${DEMO_ACCOUNT_ID}', '${DEMO_PIPELINE_ID}', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000301', 'Northstar rollout', 24000, 'USD', 'Northstar Labs', 'high', 60, 'Referral', 'Discovery completed', 'Send proposal', 'Team rollout for 40 seats', '2026-07-25', 'open', 0, '${now}', '${now}');
    INSERT INTO deals VALUES ('00000000-0000-4000-8000-000000000702', '${DEMO_ACCOUNT_ID}', '${DEMO_PIPELINE_ID}', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000301', 'Summit expansion', 48000, 'USD', 'Summit Works', 'hot', 80, 'Inbound', 'Proposal reviewed', 'Confirm legal terms', 'Annual enterprise expansion', '2026-07-19', 'open', 0, '${now}', '${now}');
    INSERT INTO pipeline_saved_views VALUES ('${DEMO_SAVED_VIEW_ID}', '${DEMO_ACCOUNT_ID}', '${DEMO_PIPELINE_ID}', 'Active opportunities', '{}', '{"field":"value","direction":"desc"}', '["title","value","owner"]', 1, 0);
    INSERT INTO sub_pipelines VALUES ('00000000-0000-4000-8000-000000000801', '${DEMO_ACCOUNT_ID}', '${DEMO_PIPELINE_ID}', 'Enterprise', 0);
    INSERT INTO sub_pipeline_deals VALUES ('${DEMO_ACCOUNT_ID}', '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000701', 0);
    INSERT INTO sub_pipeline_deals VALUES ('${DEMO_ACCOUNT_ID}', '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000702', 1);
  `)
  return database
}

function pipeline(row: SqlRow): PipelineRecord {
  return { id: String(row.id), accountId: String(row.account_id), name: String(row.name), position: Number(row.position) }
}

function member(row: SqlRow): PipelineMember {
  return { id: String(row.id), userId: String(row.user_id), name: String(row.full_name), email: String(row.email), avatarUrl: row.avatar_url ? String(row.avatar_url) : null, role: row.account_role as PipelineMember["role"] }
}

export class SqlitePipelineRepository implements PipelineRepository {
  constructor(
    private readonly accountId = DEMO_ACCOUNT_ID,
    private readonly database = createDemoDatabase()
  ) {}

  listPipelines(): Promise<PipelineRecord[]> {
    const result = rows(this.database.prepare("SELECT * FROM pipelines WHERE account_id = ? ORDER BY position, created_at"), this.accountId).map(pipeline)
    return Promise.resolve(result)
  }

  async getSnapshot(pipelineId?: string): Promise<PipelineSnapshot | null> {
    const pipelines = await this.listPipelines()
    const selected = pipelineId ? pipelines.find((item) => item.id === pipelineId) : pipelines[0]
    if (!selected) return null

    const contacts = rows(this.database.prepare("SELECT * FROM contacts WHERE account_id = ? ORDER BY name"), this.accountId).map((row) => ({ id: String(row.id), name: String(row.name), company: row.company ? String(row.company) : null, email: row.email ? String(row.email) : null, phone: String(row.phone ?? "") }))
    const members = rows(this.database.prepare("SELECT * FROM profiles WHERE account_id = ? ORDER BY full_name"), this.accountId).map(member)
    const stages = rows(this.database.prepare("SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position"), selected.id).map((row, index) => ({ id: String(row.id), pipelineId: String(row.pipeline_id), name: String(row.name), position: Number(row.position), color: String(row.color), tone: (["blue", "cyan", "amber", "green", "red"] as const)[index % 5] }))
    const deals: PipelineDeal[] = rows(this.database.prepare("SELECT * FROM deals WHERE account_id = ? AND pipeline_id = ? ORDER BY position, created_at DESC"), this.accountId, selected.id).map((row) => ({
      id: String(row.id), accountId: String(row.account_id), pipelineId: String(row.pipeline_id), stageId: String(row.stage_id), contactId: row.contact_id ? String(row.contact_id) : null, assignedTo: row.assigned_to ? String(row.assigned_to) : null, title: String(row.title), value: Number(row.value), currency: String(row.currency), company: row.company ? String(row.company) : null, priority: row.priority as PipelineDeal["priority"], probability: Number(row.probability), source: row.lead_source ? String(row.lead_source) : null, activity: row.last_activity ? String(row.last_activity) : null, nextStep: row.next_step ? String(row.next_step) : null, description: row.description ? String(row.description) : null, due: row.expected_close_date ? String(row.expected_close_date) : null, status: row.status as PipelineDeal["status"], position: Number(row.position), createdAt: String(row.created_at), updatedAt: String(row.updated_at), contact: contacts.find((item) => item.id === row.contact_id) ?? null, owner: members.find((item) => item.id === row.assigned_to) ?? null,
    }))
    const memberships = rows(this.database.prepare("SELECT * FROM sub_pipeline_deals WHERE account_id = ? ORDER BY position"), this.accountId)

    return {
      accountId: this.accountId,
      pipeline: selected,
      pipelines,
      stages,
      deals,
      contacts,
      members,
      savedViews: rows(this.database.prepare("SELECT * FROM pipeline_saved_views WHERE account_id = ? AND pipeline_id = ? ORDER BY position"), this.accountId, selected.id).map((row) => ({ id: String(row.id), accountId: String(row.account_id), pipelineId: String(row.pipeline_id), name: String(row.name), filters: JSON.parse(String(row.filters)), sort: JSON.parse(String(row.sort)), visibleFields: JSON.parse(String(row.visible_fields)), favorite: Boolean(row.is_favorite), position: Number(row.position) })),
      subPipelines: rows(this.database.prepare("SELECT * FROM sub_pipelines WHERE account_id = ? AND pipeline_id = ? ORDER BY position"), this.accountId, selected.id).map((row) => ({ id: String(row.id), accountId: String(row.account_id), pipelineId: String(row.pipeline_id), name: String(row.name), position: Number(row.position), dealIds: memberships.filter((item) => item.sub_pipeline_id === row.id).map((item) => String(item.deal_id)) })),
    }
  }
}

export const sqlitePipelineRepository = new SqlitePipelineRepository()
