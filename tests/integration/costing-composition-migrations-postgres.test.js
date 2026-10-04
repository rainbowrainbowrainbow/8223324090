'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { classifyMigration } = require('../../scripts/production-block-policy');

const migrationDir = path.join(__dirname, '../../db/migrations');
const files = [
    '375_universal_costing_plan_foundation.sql',
    '376_costing_actual_provenance.sql',
    '377_costing_group_composition_revisions.sql',
    '378_costing_management_reconciliation.sql',
    '379_costing_execution_booking_identity.sql',
    '380_costing_group_composition_initial_copy.sql'
];

async function applyMigration(pool, file) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(migrationDir, file), 'utf8'));
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function makeGroup(pool, label) {
    const template = await pool.query(
        "INSERT INTO costing_templates (business_context,name,kind) VALUES ('event_genix',$1,'service') RETURNING id",
        [label]
    );
    const version = await pool.query(
        "INSERT INTO costing_template_versions (business_context,template_id,version_number,effective_from,definition) VALUES ('event_genix',$1,1,'2026-01-01','{}'::jsonb) RETURNING id",
        [template.rows[0].id]
    );
    const group = await pool.query(
        "INSERT INTO costing_execution_groups (business_context,kind,label) VALUES ('event_genix','course',$1) RETURNING id",
        [label]
    );
    const planIds = [];
    for (const [includeRevenue, includeCost] of [[true, false], [false, true]]) {
        const plan = await pool.query(
            `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,
             execution_label,execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
             VALUES ('event_genix',$1,$2::uuid,'service',$3,'2026-10-12','{}'::jsonb,'{}'::jsonb,10000,2000,8000,8000)
             RETURNING id`,
            [version.rows[0].id, crypto.randomUUID(), label]
        );
        planIds.push(plan.rows[0].id);
        await pool.query(
            `INSERT INTO costing_group_members
             (group_id,plan_id,business_context,include_plan_revenue,include_plan_direct_cost)
             VALUES ($1,$2,'event_genix',$3,$4)`,
            [group.rows[0].id, plan.rows[0].id, includeRevenue, includeCost]
        );
    }
    return { id: group.rows[0].id, planIds };
}

async function readRevision(pool, group) {
    const result = await pool.query(
        `SELECT r.revision_number, m.plan_id, m.include_plan_revenue, m.include_plan_direct_cost
         FROM costing_group_revisions r
         JOIN costing_group_revision_members m ON m.revision_id=r.id
         WHERE r.group_id=$1 ORDER BY m.plan_id`,
        [group.id]
    );
    return result.rows.map(row => ({
        revision: row.revision_number,
        planId: String(row.plan_id),
        revenue: row.include_plan_revenue,
        cost: row.include_plan_direct_cost
    }));
}

test('composition migrations preserve pre-377 groups, retry safely, and support fresh and partial installs', {
    skip: !process.env.COSTING_TEST_PG_PORT,
    timeout: 120000
}, async () => {
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
    assert.equal(classifyMigration(files[2], fs.readFileSync(path.join(migrationDir, files[2]), 'utf8')).kind, 'schema');
    const copyClassification = classifyMigration(files[5], fs.readFileSync(path.join(migrationDir, files[5]), 'utf8'));
    assert.equal(copyClassification.kind, 'data-fix');
    assert.equal(copyClassification.red, false);
    assert.match(copyClassification.dataScope, /costing_execution_groups and costing_group_members/);

    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    const database = `eventgenix_composition_${crypto.randomUUID().replaceAll('-', '')}`;
    let pool;
    let created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 2 });
        for (const file of files.slice(0, 2)) await applyMigration(pool, file);
        const original = await makeGroup(pool, 'Before revision tables');
        await applyMigration(pool, files[2]);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM costing_group_revisions')).rows[0].count, 0,
            'schema migration must not perform the history copy');

        // A prior deployment may have completed 377 while 380 remains pending.
        const partial = await makeGroup(pool, 'After revision tables');
        await pool.query(
            `INSERT INTO costing_group_revisions (group_id,business_context,revision_number,reason)
             VALUES ($1,'event_genix',1,'Initial composition from costing_group_members')`,
            [partial.id]
        );
        for (const file of files.slice(3)) await applyMigration(pool, file);

        const expected = group => [
            { revision: 1, planId: String(group.planIds[0]), revenue: true, cost: false },
            { revision: 1, planId: String(group.planIds[1]), revenue: false, cost: true }
        ].sort((a, b) => Number(BigInt(a.planId) - BigInt(b.planId)));
        assert.deepEqual(await readRevision(pool, original), expected(original));
        assert.deepEqual(await readRevision(pool, partial), expected(partial));
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM costing_group_revisions')).rows[0].count, 2);
        await applyMigration(pool, files[5]);
        assert.deepEqual(await readRevision(pool, original), expected(original), 'replaying 380 must not duplicate members');
        assert.deepEqual(await readRevision(pool, partial), expected(partial), 'replaying 380 must fill only missing members');

        // The migration runner wraps each SQL file in one transaction. A failed copy leaves no partial history.
        const retry = await makeGroup(pool, 'Interrupted copy');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO costing_group_revisions (group_id,business_context,revision_number,reason)
                 VALUES ($1,'event_genix',1,'Initial composition from costing_group_members')`,
                [retry.id]
            );
            await assert.rejects(client.query('SELECT 1 / 0'), error => error.code === '22012');
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
        assert.deepEqual(await readRevision(pool, retry), []);
        await applyMigration(pool, files[5]);
        assert.deepEqual(await readRevision(pool, retry), expected(retry));

        const freshDatabase = `eventgenix_composition_fresh_${crypto.randomUUID().replaceAll('-', '')}`;
        await admin.query(`CREATE DATABASE "${freshDatabase}"`);
        let freshPool;
        try {
            freshPool = new Pool({ ...connection, database: freshDatabase, max: 1 });
            for (const file of files) await applyMigration(freshPool, file);
            assert.equal((await freshPool.query('SELECT COUNT(*)::int AS count FROM costing_group_revisions')).rows[0].count, 0);
            assert.equal((await freshPool.query('SELECT COUNT(*)::int AS count FROM costing_group_revision_members')).rows[0].count, 0);
            await applyMigration(freshPool, files[5]);
            assert.equal((await freshPool.query('SELECT COUNT(*)::int AS count FROM costing_group_revisions')).rows[0].count, 0);
        } finally {
            if (freshPool) await freshPool.end();
            await admin.query(`DROP DATABASE "${freshDatabase}" WITH (FORCE)`);
        }
    } finally {
        if (pool) await pool.end();
        if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        await admin.end();
    }
});
