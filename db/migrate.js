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

const log = createLogger('Migrate');
const migrationsDir = path.join(__dirname, 'migrations');

/**
 * Run all pending database migrations.
 * Each migration runs in its own transaction.
 * Stops on first failure (throws error).
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {Promise<string[]>} - List of applied migration versions
 */
async function runMigrations(pool) {
    // 1. Ensure schema_migrations tracking table exists
    await pool.query(`
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
    const applied = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
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

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
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
            log.error('Migration failed: ' + version, err);
            throw err;
        } finally {
            client.release();
        }
    }

    log.info('Migrations complete: ' + appliedNow.length + ' applied');
    return appliedNow;
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
