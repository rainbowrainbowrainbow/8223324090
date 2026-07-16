/**
 * Real PostgreSQL proof that two scheduler replicas cannot enqueue duplicate
 * HR attendance PDFs for the same automation and Kyiv local date.
 *
 * Run only through the disposable isolated PostgreSQL runner.
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    createAutomation,
    enqueueAutomationJob
} = require('../../services/hrAttendanceDocumentAutomation');

const enabled = process.env.RUN_HR_ATTENDANCE_DOCUMENT_AUTOMATION_INTEGRATION === 'true';
const FIXED_NOW = new Date('2026-07-16T05:00:00.000Z'); // Thursday 08:00 Europe/Kyiv.
const FIXED_LOCAL_DATE = '2026-07-16';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_HR_ATTENDANCE_DOCUMENT_AUTOMATION_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

describe('HR attendance document automation on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let replicaA;
    let replicaB;
    let automationId;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        replicaA = createPool(testDb);
        replicaB = createPool(testDb);
        const automation = await createAutomation({
            name: `Disposable two-replica proof ${process.pid}`,
            documentType: 'arrival_inout',
            categoryIds: ['waiter', 'trampoline'],
            weekdays: [4],
            localTime: '08:00',
            copies: 1,
            artifactTtlHours: 24,
            catchUpMinutes: 120,
            enabled: true,
            settings: {
                dailyMode: 'manual_blank',
                rosterMode: 'all_eligible',
                texts: {},
                fontPreset: {}
            }
        }, {}, replicaA);
        automationId = automation.id;
    });

    after(async () => {
        try {
            if (automationId) {
                await replicaA.query('DELETE FROM hr_attendance_document_automations WHERE id=$1', [automationId]);
            }
        } finally {
            await Promise.allSettled([replicaA?.end(), replicaB?.end()]);
        }
    });

    test('scheduled and manual replicas converge on one durable job', async () => {
        const [scheduled, manual] = await Promise.all([
            enqueueAutomationJob(automationId, 'scheduled', {}, { now: FIXED_NOW }, replicaA),
            enqueueAutomationJob(automationId, 'manual', {}, {
                now: FIXED_NOW,
                localDate: FIXED_LOCAL_DATE
            }, replicaB)
        ]);

        assert.ok(scheduled?.id);
        assert.equal(manual?.id, scheduled.id);
        assert.equal(scheduled.idempotencyKey, manual.idempotencyKey);

        const stored = await replicaA.query(
            `SELECT id, idempotency_key, status, trigger_kind
             FROM hr_attendance_document_jobs
             WHERE automation_id=$1 AND local_date=$2::date`,
            [automationId, FIXED_LOCAL_DATE]
        );
        assert.equal(stored.rowCount, 1);
        assert.equal(Number(stored.rows[0].id), scheduled.id);
        assert.equal(stored.rows[0].idempotency_key, scheduled.idempotencyKey);
        assert.equal(stored.rows[0].status, 'building');
        assert.ok(['scheduled', 'manual'].includes(stored.rows[0].trigger_kind));

        const repeated = await enqueueAutomationJob(
            automationId,
            'manual',
            {},
            { now: FIXED_NOW, localDate: FIXED_LOCAL_DATE },
            replicaB
        );
        assert.equal(repeated.id, scheduled.id);
        const count = await replicaB.query(
            'SELECT COUNT(*)::integer AS count FROM hr_attendance_document_jobs WHERE automation_id=$1',
            [automationId]
        );
        assert.equal(count.rows[0].count, 1);
    });
});
