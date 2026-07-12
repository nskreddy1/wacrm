const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    // Get environment variables
    const postgresUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    
    if (!postgresUrl) {
      console.error('POSTGRES_URL environment variable is not set');
      process.exit(1);
    }

    // Read the migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/037_default_admin_account.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    // Import pg dynamically
    const { Pool } = await import('pg');

    // Create a connection pool
    const pool = new Pool({
      connectionString: postgresUrl,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    try {
      // Execute the migration
      console.log('Running migration 037_default_admin_account.sql...');
      await pool.query(migrationSql);
      console.log('✓ Migration completed successfully!');
      console.log('\nDefault Admin Account Created:');
      console.log('  Email: admin@wacrm.local');
      console.log('  Password: AdminPass123!');
      console.log('  Role: Admin');
    } catch (error) {
      console.error('Error running migration:', error.message);
      process.exit(1);
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

runMigration();
