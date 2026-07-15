/**
 * db/migrate.js — Database migration runner
 *
 * Reads SQL migration files from db/migrations/ directory,
 * tracks applied migrations in schema_migrations table,
 * and runs pending migrations in order within transactions.
 *
 * Usage:
 *   Standalone:   node db/migrate.js
 *   Programmatic:  const { runMigrations } = require('./migrate');
 *                  await runMigrations(pool);
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const {
    lockSchemaMigrations,
    unlockSchemaMigrations
} = require('../services/backupSchemaLock');

const log = createLogger('Migrate');
const migrationsDir = path.join(__dirname, 'migrations');

const migrationPreflights = new Map([
    ['261_leads_customer_card_canonical_customers', async (client) => {
        // Migration 261 predates the additive 274 migration but already writes this
        // column. Keep the historical files immutable and provide only the missing
        // prerequisite inside the same transaction as 261.
        await client.query(`
            ALTER TABLE IF EXISTS leads
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
        `);
    }]
]);

async function runMigrationPreflight(client, version) {
    const preflight = migrationPreflights.get(version);
    if (preflight) await preflight(client);
}

/**
 * Run all pending database migrations.
 * Each migration runs in its own transaction.
 * Stops on first failure (throws error).
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {Promise<string[]>} - List of applied migration versions
 */
async function runMigrations(pool, { schemaLockAlreadyHeld = false } = {}) {
    const client = await pool.connect();
    let schemaLockHeld = false;
    try {
        if (!schemaLockAlreadyHeld) {
            await lockSchemaMigrations(client);
            schemaLockHeld = true;
        }
    // 1. Ensure schema_migrations tracking table exists
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 2. Read migration files sorted alphabetically (001_, 002_, ...)
    if (!fs.existsSync(migrationsDir)) {
        log.warn('Migrations directory not found: ' + migrationsDir);
        return [];
    }

    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (files.length === 0) {
        log.info('No migration files found');
        return [];
    }

    // 3. Get already-applied versions
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedSet = new Set(applied.rows.map(r => r.version));

    // 4. Determine pending migrations
    const pending = files.filter(f => !appliedSet.has(f.replace('.sql', '')));

    if (pending.length === 0) {
        log.info('All migrations already applied (' + appliedSet.size + ' total)');
        return [];
    }

    log.info('Pending migrations: ' + pending.length + ' of ' + files.length + ' total');

    // 5. Run pending migrations in order, each in its own transaction
    const appliedNow = [];

    for (const file of pending) {
        const version = file.replace('.sql', '');
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        try {
            await client.query('BEGIN');
            await runMigrationPreflight(client, version);
            await client.query(sql);
            await client.query(
                'INSERT INTO schema_migrations (version) VALUES ($1)',
                [version]
            );
            await client.query('COMMIT');
            appliedNow.push(version);
            log.info('Migration applied: ' + version);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            const msg = err.message + (err.detail ? ' | ' + err.detail : '') + (err.hint ? ' | hint: ' + err.hint : '');
            log.error('Migration failed: ' + version + ' — ' + msg);
            throw err;
        }
    }

    log.info('Migrations complete: ' + appliedNow.length + ' applied');
    return appliedNow;
    } finally {
        if (schemaLockHeld) {
            await unlockSchemaMigrations(client).catch(error => {
                log.error('Failed to release schema migration advisory lock', {
                    code: error?.code || 'SCHEMA_LOCK_RELEASE_FAILED'
                });
            });
        }
        client.release();
    }
}

// Allow standalone execution: node db/migrate.js
if (require.main === module) {
    const { Pool } = require('pg');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
    });

    pool.on('error', (err) => {
        log.error('Pool error', err);
    });

    runMigrations(pool)
        .then((applied) => {
            if (applied.length > 0) {
                log.info('Done. Applied ' + applied.length + ' migration(s)');
            } else {
                log.info('Done. No pending migrations');
            }
            process.exit(0);
        })
        .catch((err) => {
            log.error('Migration runner failed', err);
            process.exit(1);
        });
}

module.exports = { runMigrations };
