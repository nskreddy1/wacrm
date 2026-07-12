import { randomUUID } from "crypto"
import { Pool } from "pg"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function seed() {
  console.log("[seed] Starting database seeding...\n")

  const adminUserId = "admin-user-" + randomUUID()
  const adminAccountId = randomUUID()
  const agentUserId = "agent-user-" + randomUUID()
  const contactId1 = randomUUID()
  const contactId2 = randomUUID()
  const pipelineId = randomUUID()
  const stageId1 = randomUUID()
  const stageId2 = randomUUID()
  const stageId3 = randomUUID()
  const dealId1 = randomUUID()
  const dealId2 = randomUUID()

  const now = new Date()

  try {
    // ========== 1. Create admin Better Auth user ==========
    console.log("📝 Creating admin user...")
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminUserId, "Admin User", "admin@example.com", true, now, now]
    )

    // Create password account via Better Auth
    await pool.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        "email",
        "email",
        adminUserId,
        // bcrypt hash of "Admin@123456" (pre-hashed)
        "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36SGLc5O",
        now,
        now,
      ]
    )

    // ========== 2. Create agent Better Auth user ==========
    console.log("📝 Creating agent user...")
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agentUserId, "Agent User", "agent@example.com", true, now, now]
    )

    await pool.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        "email",
        "email",
        agentUserId,
        "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36SGLc5O",
        now,
        now,
      ]
    )

    // ========== 3. Create CRM account ==========
    console.log("🏢 Creating CRM account...")
    await pool.query(
      `INSERT INTO crm_accounts (id, name, owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminAccountId, "Tech Startup Inc", adminUserId, now, now]
    )

    // ========== 4. Create user profiles ==========
    console.log("👤 Creating user profiles...")
    await pool.query(
      `INSERT INTO profiles (id, user_id, account_id, full_name, email, account_role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), adminUserId, adminAccountId, "Admin User", "admin@example.com", "admin", now, now]
    )

    await pool.query(
      `INSERT INTO profiles (id, user_id, account_id, full_name, email, account_role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), agentUserId, adminAccountId, "Agent User", "agent@example.com", "agent", now, now]
    )

    // ========== 5. Create contacts ==========
    console.log("📇 Creating test contacts...")
    await pool.query(
      `INSERT INTO contacts (id, user_id, account_id, phone, name, email, company, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [contactId1, adminUserId, adminAccountId, "+1-555-0101", "John Smith", "john@acmecorp.com", "Acme Corp", now, now]
    )

    await pool.query(
      `INSERT INTO contacts (id, user_id, account_id, phone, name, email, company, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [contactId2, adminUserId, adminAccountId, "+1-555-0102", "Sarah Johnson", "sarah@techventure.io", "TechVenture", now, now]
    )

    // ========== 6. Create sales pipeline ==========
    console.log("📊 Creating sales pipeline...")
    await pool.query(
      `INSERT INTO pipelines (id, user_id, account_id, name, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pipelineId, adminUserId, adminAccountId, "Sales Pipeline", 0, now, now]
    )

    // ========== 7. Create pipeline stages ==========
    console.log("🎯 Creating pipeline stages...")
    await pool.query(
      `INSERT INTO pipeline_stages (id, pipeline_id, name, position, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [stageId1, pipelineId, "Lead", 0, "#ef4444", now]
    )

    await pool.query(
      `INSERT INTO pipeline_stages (id, pipeline_id, name, position, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [stageId2, pipelineId, "Proposal", 1, "#f59e0b", now]
    )

    await pool.query(
      `INSERT INTO pipeline_stages (id, pipeline_id, name, position, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [stageId3, pipelineId, "Won", 2, "#10b981", now]
    )

    // ========== 8. Create test deals ==========
    console.log("💼 Creating test deals...")
    await pool.query(
      `INSERT INTO deals (id, user_id, account_id, pipeline_id, stage_id, contact_id, title, value, currency, company, priority, probability, lead_source, expected_close_date, status, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        dealId1,
        adminUserId,
        adminAccountId,
        pipelineId,
        stageId1,
        contactId1,
        "Enterprise SaaS Deal",
        "50000.00",
        "USD",
        "Acme Corp",
        "high",
        25,
        "inbound",
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        "active",
        0,
        now,
        now,
      ]
    )

    await pool.query(
      `INSERT INTO deals (id, user_id, account_id, pipeline_id, stage_id, contact_id, title, value, currency, company, priority, probability, lead_source, expected_close_date, status, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        dealId2,
        adminUserId,
        adminAccountId,
        pipelineId,
        stageId2,
        contactId2,
        "Startup Growth Package",
        "25000.00",
        "USD",
        "TechVenture",
        "medium",
        60,
        "referral",
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        "active",
        0,
        now,
        now,
      ]
    )

    console.log("\n✅ Seed completed successfully!\n")
    console.log("📋 Created test credentials:")
    console.log("   Admin: admin@example.com / Admin@123456")
    console.log("   Agent: agent@example.com / Admin@123456")
    console.log("\n📊 Test data includes:")
    console.log("   • 1 CRM account: Tech Startup Inc")
    console.log("   • 2 user profiles (admin & agent)")
    console.log("   • 2 contacts (John Smith, Sarah Johnson)")
    console.log("   • 1 sales pipeline with 3 stages")
    console.log("   • 2 test deals\n")
  } catch (error) {
    console.error("❌ Seed failed:", error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

seed()
