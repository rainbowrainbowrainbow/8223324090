'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { classifyMigration } = require('../../scripts/production-block-policy');
const { assertCostingCompositionReady } = require('../../services/costingCompositionStartupGuard');

const migrationDir = path.join(__dirname, '../../db/migrations');
const migrations = [
    '375_universal_costing_plan_foundation.sql',
    '376_costing_actual_provenance.sql',
    '377_costing_group_composition_revisions.sql',
    '378_costing_management_reconciliation.sql',
    '379_costing_execution_booking_identity.sql'
];

async function apply(pool, file) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(migrationDir, file), 'utf8'));
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function withDatabase(admin, connection, label, run) {
    const name = `eventgenix_costing_${label}_${crypto.randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const pool = new Pool({ ...connection, database: name, max: 4 });
    try {
        await run(pool);
    } finally {
        await pool.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
}

async function plan(pool, label) {
    const template = await pool.query(
        "INSERT INTO costing_templates (business_context,name,kind) VALUES ('event_genix',$1,'service') RETURNING id",
        [label]
    );
    const version = await pool.query(
        "INSERT INTO costing_template_versions (business_context,template_id,version_number,effective_from,definition) VALUES ('event_genix',$1,1,'2026-01-01','{}'::jsonb) RETURNING id",
        [template.rows[0].id]
    );
    const result = await pool.query(
        `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,
         execution_label,execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
         VALUES ('event_genix',$1,$2::uuid,'service',$3,'2026-10-12','{}'::jsonb,'{}'::jsonb,10000,2000,8000,8000)
         RETURNING id`,
        [version.rows[0].id, crypto.randomUUID(), label]
    );
    return result.rows[0].id;
}

test('fresh-only composition schema rejects old groups and startup rejects incomplete initial history', {
    skip: !process.env.COSTING_TEST_PG_PORT,
    timeout: 120000
}, async t => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) {
        assert.ok(!process.env[key]);
    }
    const connection = {
        host: '127.0.0.1',
        port: Number(process.env.COSTING_TEST_PG_PORT),
        user: 'postgres',
        password: process.env.COSTING_TEST_PG_PASSWORD,
        ssl: false,
        connectionTimeoutMillis: 5000
    };
    assert.ok(Number.isInteger(connection.port) && connection.port > 1024 && connection.password?.length >= 12);
    assert.equal(fs.existsSync(path.join(migrationDir, '380_costing_group_composition_initial_copy.sql')), false,
        'the reviewed backfill must stay outside active migrations');
    const schema = classifyMigration(migrations[2], fs.readFileSync(path.join(migrationDir, migrations[2]), 'utf8'));
    assert.equal(schema.kind, 'schema');
    assert.equal(schema.red, false);
    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    try {
        await t.test('fresh install and normal later revisions pass', async () => {
            await withDatabase(admin, connection, 'fresh', async pool => {
                for (const file of migrations) await apply(pool, file);
                await assertCostingCompositionReady(pool);
                const planId = await plan(pool, 'Fresh service');
                const group = await pool.query(
                    "INSERT INTO costing_execution_groups (business_context,kind,label) VALUES ('event_genix','course','Fresh group') RETURNING id"
                );
                const revision = await pool.query(
                    `INSERT INTO costing_group_revisions
                     (group_id,business_context,revision_number,reason)
                     VALUES ($1,'event_genix',1,'Initial composition') RETURNING id`,
                    [group.rows[0].id]
                );
                await pool.query(
                    `INSERT INTO costing_group_revision_members
                     (revision_id,plan_id,business_context,include_plan_revenue,include_plan_direct_cost)
                     VALUES ($1,$2,'event_genix',TRUE,FALSE)`,
                    [revision.rows[0].id, planId]
                );
                await assertCostingCompositionReady(pool);
                await pool.query(
                    `INSERT INTO costing_group_revisions
                     (group_id,business_context,revision_number,reason)
                     VALUES ($1,'event_genix',2,'Composition changed')`,
                    [group.rows[0].id]
                );
                await assertCostingCompositionReady(pool);
            });
        });
        await t.test('a pre-377 group fails in the same transaction without copying or deleting rows', async () => {
            await withDatabase(admin, connection, 'legacy', async pool => {
                for (const file of migrations.slice(0, 2)) await apply(pool, file);
                const planId = await plan(pool, 'Existing group');
                const group = await pool.query(
                    "INSERT INTO costing_execution_groups (business_context,kind,label) VALUES ('event_genix','course','Existing group') RETURNING id"
                );
                await pool.query(
                    `INSERT INTO costing_group_members
                     (group_id,plan_id,business_context,include_plan_revenue,include_plan_direct_cost)
                     VALUES ($1,$2,'event_genix',TRUE,FALSE)`,
                    [group.rows[0].id, planId]
                );
                await assert.rejects(apply(pool, migrations[2]), error =>
                    error.code === 'P0001' && /COSTING_FRESH_ONLY_NONEMPTY_GROUPS/.test(error.message));
                await assert.rejects(apply(pool, migrations[2]), error => error.code === 'P0001',
                    'retry must fail closed without backfill');
                assert.equal((await pool.query("SELECT to_regclass('public.costing_group_revisions') IS NULL AS missing"))
                    .rows[0].missing, true, 'failed migration DDL rolls back');
                assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM costing_group_members'))
                    .rows[0].count, 1, 'source membership remains intact');
            });
        });
        await t.test('partial schema with missing original history blocks startup, not later valid revisions', async () => {
            await withDatabase(admin, connection, 'partial', async pool => {
                for (const file of migrations) await apply(pool, file);
                const planId = await plan(pool, 'Partial group');
                const group = await pool.query(
                    "INSERT INTO costing_execution_groups (business_context,kind,label) VALUES ('event_genix','course','Partial group') RETURNING id"
                );
                await pool.query(
                    `INSERT INTO costing_group_members
                     (group_id,plan_id,business_context,include_plan_revenue,include_plan_direct_cost)
                     VALUES ($1,$2,'event_genix',TRUE,FALSE)`,
                    [group.rows[0].id, planId]
                );
                const incomplete = error => error.code === 'COSTING_INITIAL_HISTORY_INCOMPLETE';
                await assert.rejects(assertCostingCompositionReady(pool), incomplete);
                const revision = await pool.query(
                    `INSERT INTO costing_group_revisions
                     (group_id,business_context,revision_number,reason)
                     VALUES ($1,'event_genix',1,'Partial initial history') RETURNING id`,
                    [group.rows[0].id]
                );
                await assert.rejects(assertCostingCompositionReady(pool), incomplete,
                    'an empty revision 1 must not hide missing original members');
                await pool.query(
                    `INSERT INTO costing_group_revision_members
                     (revision_id,plan_id,business_context,include_plan_revenue,include_plan_direct_cost)
                     VALUES ($1,$2,'event_genix',TRUE,FALSE)`,
                    [revision.rows[0].id, planId]
                );
                await assertCostingCompositionReady(pool);
                await pool.query(
                    `INSERT INTO costing_group_revisions
                     (group_id,business_context,revision_number,reason)
                     VALUES ($1,'event_genix',2,'Later composition')`,
                    [group.rows[0].id]
                );
                await assertCostingCompositionReady(pool);
            });
        });
    } finally {
        await admin.end();
    }
});
