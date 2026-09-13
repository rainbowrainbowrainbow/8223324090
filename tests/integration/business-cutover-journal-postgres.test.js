'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');

const localSocket = process.env.BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST === '1';

function connection() {
    assert.equal(localSocket, true, 'Only the explicit disposable local PostgreSQL fixture is supported');
    assert.equal(process.platform, 'linux');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
}

test('cutover journal migration is additive, idempotent, and aggregates telemetry without memberships', {
    skip: !localSocket,
    timeout: 90000
}, async () => {
    const database = 'eventgenix_cutover_journal_test_' + crypto.randomUUID().replaceAll('-', '');
    const admin = new Pool({ ...connection(), max: 1 });
    let pool;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        pool = new Pool({ ...connection(), database, max: 1 });
        await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT, is_active BOOLEAN NOT NULL DEFAULT true, role TEXT NOT NULL DEFAULT 'creator');`);
        const migrationRoot = path.join(__dirname, '../../db/migrations');
        await pool.query(fs.readFileSync(path.join(migrationRoot, '357_organizations_business_memberships.sql'), 'utf8'));
        const migration = fs.readFileSync(path.join(migrationRoot, '363_multibusiness_cutover_journal_telemetry.sql'), 'utf8');
        await pool.query(migration);
        await pool.query(migration);
        await pool.query(`INSERT INTO users (id, username) VALUES (1, 'fixture-owner');
            INSERT INTO organizations (id, slug, name, created_by_user_id) VALUES (1, 'fixture-org', 'Fixture org', 1);`);
        const before = await pool.query(`SELECT
            (SELECT COUNT(*)::int FROM businesses) AS businesses,
            (SELECT COUNT(*)::int FROM business_memberships) AS memberships`);
        await pool.query(`INSERT INTO business_cutover_journal
            (context_key, organization_id, state, source_snapshot_sha256, mapping_sha256, source_deployment_sha, prepared_by_user_id)
            VALUES ('crm',1,'prepared',$1,$2,$3,1)`, ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(40)]);
        const after = await pool.query(`SELECT
            (SELECT COUNT(*)::int FROM businesses) AS businesses,
            (SELECT COUNT(*)::int FROM business_memberships) AS memberships`);
        assert.deepEqual(after.rows[0], before.rows[0]);
        await pool.query(`INSERT INTO business_compatibility_telemetry_hourly
            (observed_hour,business_context,entry_family,authority_source,outcome,deployment_sha,decision_count)
            VALUES (date_trunc('hour', clock_timestamp()),'crm','http','membership','allowed',$1,1)
            ON CONFLICT (observed_hour,business_context,entry_family,authority_source,outcome,deployment_sha)
            DO UPDATE SET decision_count=business_compatibility_telemetry_hourly.decision_count+1`, ['c'.repeat(40)]);
        const telemetry = await pool.query('SELECT decision_count FROM business_compatibility_telemetry_hourly');
        assert.equal(Number(telemetry.rows[0].decision_count), 1);
        await assert.rejects(pool.query(`INSERT INTO business_cutover_journal
            (context_key, organization_id, state, source_snapshot_sha256, mapping_sha256, source_deployment_sha)
            VALUES ('maysternya_doli',1,'applied',$1,$2,$3)`, ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(40)]), { code: '23514' });
    } finally {
        await pool?.end();
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(async () => {
            await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
        });
        await admin.end();
    }
});
