'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const { applyReservedCutover, sha256 } = require('../../services/businessCutover');

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
        await pool.query(fs.readFileSync(path.join(migrationRoot, '365_business_cutover_journal_approval_receipts.sql'), 'utf8'));
        await pool.query(migration);
        await pool.query(fs.readFileSync(path.join(migrationRoot, '365_business_cutover_journal_approval_receipts.sql'), 'utf8'));
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

test('reserved business cutover apply is atomic, idempotent, and rejects partial member drift', {
    skip: !localSocket,
    timeout: 90000
}, async () => {
    const database = 'eventgenix_cutover_apply_test_' + crypto.randomUUID().replaceAll('-', '');
    const admin = new Pool({ ...connection(), max: 1 });
    let pool;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        pool = new Pool({ ...connection(), database, max: 1 });
        await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT, is_active BOOLEAN NOT NULL DEFAULT true, role TEXT NOT NULL DEFAULT 'creator');`);
        const migrationRoot = path.join(__dirname, '../../db/migrations');
        await pool.query(fs.readFileSync(path.join(migrationRoot, '357_organizations_business_memberships.sql'), 'utf8'));
        await pool.query(fs.readFileSync(path.join(migrationRoot, '363_multibusiness_cutover_journal_telemetry.sql'), 'utf8'));
        await pool.query(fs.readFileSync(path.join(migrationRoot, '365_business_cutover_journal_approval_receipts.sql'), 'utf8'));
        await pool.query(`INSERT INTO users (id, username, role, is_active) VALUES
            (1, 'fixture-owner', 'creator', true),
            (2, 'fixture-director', 'director', true),
            (3, 'fixture-admin', 'admin', true),
            (4, 'inactive-member', 'manager', false);
            INSERT INTO organizations (id, slug, name, created_by_user_id) VALUES (1, 'fixture-org', 'Fixture org', 1);`);
        const approvedMapping = {
            contextKey: 'crm',
            organizationId: 1,
            approvalRef: 'SYS-MB-RECOVER-02:test-approval:2026-09-13',
            business: { label: 'CRM sales', shortLabel: 'CRM', modules: ['dashboard', 'tasks', 'customers', 'leads', 'omni', 'finance', 'settings'] },
            memberships: [
                { userId: 2, organizationRole: 'member', role: 'director', actionAllowlist: ['view_all'] },
                { userId: 3, organizationRole: 'member', role: 'admin', pageAllowlist: ['/tasks'] }
            ]
        };
        const input = {
            contextKey: 'crm',
            organizationId: 1,
            sourceSnapshotSha256: 'a'.repeat(64),
            mappingSha256: sha256(approvedMapping),
            sourceDeploymentSha: 'b'.repeat(40),
            approvalRef: approvedMapping.approvalRef,
            approvedMapping
        };
        const first = await applyReservedCutover(pool, { id: 1, platformRole: 'creator' }, input);
        assert.equal(first.state, 'applied');
        assert.equal(first.replay, false);
        assert.equal(first.membershipCount, 2);
        assert.match(first.receiptSha256, /^[a-f0-9]{64}$/);
        const journal = await pool.query('SELECT approval_ref, source_fingerprint_sha256, receipt_sha256 FROM business_cutover_journal WHERE context_key=$1', ['crm']);
        assert.equal(journal.rows[0].approval_ref, approvedMapping.approvalRef);
        assert.match(journal.rows[0].source_fingerprint_sha256, /^[a-f0-9]{64}$/);
        assert.equal(journal.rows[0].receipt_sha256, first.receiptSha256);
        const persisted = await pool.query(`SELECT b.context_key, b.access_mode, bm.user_id, bm.role, bm.page_allowlist
            FROM businesses b JOIN business_memberships bm ON bm.business_id=b.id
            ORDER BY bm.user_id`);
        assert.deepEqual(persisted.rows.map(row => [row.context_key, row.access_mode, Number(row.user_id), row.role]), [
            ['crm', 'membership', 2, 'director'],
            ['crm', 'membership', 3, 'admin']
        ]);
        assert.deepEqual(persisted.rows[1].page_allowlist, ['/tasks']);
        const replay = await applyReservedCutover(pool, { id: 1, platformRole: 'creator' }, input);
        assert.equal(replay.replay, true);
        const beforeFailed = await pool.query('SELECT COUNT(*)::int AS count FROM business_memberships');
        const invalidMapping = { ...approvedMapping, contextKey: 'maysternya_doli', memberships: [{ userId: 4, organizationRole: 'member', role: 'manager' }] };
        await assert.rejects(
            applyReservedCutover(pool, { id: 1, platformRole: 'creator' }, {
                ...input,
                contextKey: 'maysternya_doli',
                mappingSha256: sha256(invalidMapping),
                approvedMapping: invalidMapping
            }),
            { code: 'cutover_member_inactive' }
        );
        const afterFailed = await pool.query(`SELECT COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE business_id IN (SELECT id FROM businesses WHERE context_key='maysternya_doli'))::int AS md_count
            FROM business_memberships`);
        assert.deepEqual(afterFailed.rows[0], { count: beforeFailed.rows[0].count, md_count: 0 });
    } finally {
        await pool?.end();
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(async () => {
            await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
        });
        await admin.end();
    }
});
