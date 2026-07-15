'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_FRESH_DB_STARTUP_INTEGRATION === 'true';
const root = path.resolve(__dirname, '..', '..');

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_FRESH_DB_STARTUP_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
}

describe('fresh PostgreSQL startup contract', { skip: !enabled }, () => {
    it('applies every migration and leaves the dependent schema ready after one startup', async () => {
        const testDb = requireIsolatedDatabase();
        const pool = new Pool({
            connectionString: testDb.url.toString(),
            ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
            max: 2
        });
        try {
            const expectedVersions = fs.readdirSync(path.join(root, 'db', 'migrations'))
                .filter(file => file.endsWith('.sql'))
                .map(file => file.slice(0, -4));
            const ledger = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
            const appliedVersions = new Set(ledger.rows.map(row => row.version));
            const missingVersions = expectedVersions.filter(version => !appliedVersions.has(version));
            assert.deepEqual(missingVersions, [], 'fresh startup applies every SQL migration');
            assert.equal(appliedVersions.has('261_leads_customer_card_canonical_customers'), true);
            assert.equal(appliedVersions.has('274_add_leads_updated_at'), true);

            const schema = await pool.query(`
                SELECT
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'leads'
                          AND column_name = 'updated_at'
                    ) AS leads_updated_at,
                    to_regclass('public.procurement_lists') IS NOT NULL AS procurement_lists,
                    to_regclass('public.procurement_items') IS NOT NULL AS procurement_items,
                    to_regclass('public.idx_procurement_lists_status') IS NOT NULL AS procurement_lists_status_index,
                    to_regclass('public.idx_procurement_items_list') IS NOT NULL AS procurement_items_list_index,
                    to_regclass('public.idx_procurement_items_stock') IS NOT NULL AS procurement_items_stock_index
            `);
            assert.deepEqual(schema.rows[0], {
                leads_updated_at: true,
                procurement_lists: true,
                procurement_items: true,
                procurement_lists_status_index: true,
                procurement_items_list_index: true,
                procurement_items_stock_index: true
            });
        } finally {
            await pool.end();
        }
    });
});
