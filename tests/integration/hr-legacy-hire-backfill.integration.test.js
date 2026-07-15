'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_HR_LEGACY_BACKFILL_INTEGRATION === 'true';
const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'migrations', '291_job_application_legacy_link_backfill.sql'),
    'utf8'
);

function verifiedTestDatabase() {
    assert.equal(enabled, true, 'set RUN_HR_LEGACY_BACKFILL_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');

    // The isolated runner may expose the disposable URL to the app as DATABASE_URL
    // for remote PostgreSQL. This test always connects through TEST_DATABASE_URL.
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 1,
        connectionTimeoutMillis: 10_000
    });
}

async function insertStaff(client, { name, phone, roleType = 'animator', secondaryProfessions = [] }) {
    const result = await client.query(
        `INSERT INTO staff
            (name, department, position, phone, role_type, secondary_professions, is_active)
         VALUES ($1, 'qa', 'Legacy backfill fixture', $2, $3, $4::jsonb, true)
         RETURNING id`,
        [name, phone, roleType, JSON.stringify(secondaryProfessions)]
    );
    return Number(result.rows[0].id);
}

async function insertVacancy(client, roleType, suffix) {
    const result = await client.query(
        `INSERT INTO job_vacancies
            (title, role_type, department, status, created_by)
         VALUES ($1, $2, 'qa', 'open', 'migration_291_integration')
         RETURNING id`,
        [`Legacy backfill ${roleType} ${suffix}`, roleType]
    );
    return Number(result.rows[0].id);
}

async function insertApplication(client, fixture) {
    const result = await client.query(
        `INSERT INTO job_applications
            (vacancy_id, name, phone, status, added_by, created_at, updated_at,
             staff_id, profession_key, hired_at, hired_by)
         VALUES ($1, $2, $3, 'hired', $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
            fixture.vacancyId,
            fixture.name,
            fixture.phone,
            fixture.addedBy ?? null,
            fixture.createdAt,
            fixture.updatedAt,
            fixture.staffId ?? null,
            fixture.professionKey ?? null,
            fixture.hiredAt ?? null,
            fixture.hiredBy ?? null
        ]
    );
    return Number(result.rows[0].id);
}

async function readApplications(client, ids) {
    const result = await client.query(
        `SELECT id, staff_id, profession_key, hired_at, hired_by,
                updated_at AT TIME ZONE 'UTC' AS updated_at
         FROM job_applications
         WHERE id = ANY($1::int[])
         ORDER BY id`,
        [ids]
    );
    return new Map(result.rows.map(row => [Number(row.id), row]));
}

async function readBackfillAudit(client, applicationIds) {
    const result = await client.query(
        `SELECT id, action, staff_id, performed_by, details, ip_address, created_at
         FROM hr_audit_log
         WHERE action = 'job_application_legacy_link_backfilled_v291'
           AND details->>'application_id' = ANY($1::text[])
         ORDER BY id`,
        [applicationIds.map(String)]
    );
    return result.rows;
}

function normalizedApplicationState(rows) {
    return [...rows.entries()].map(([id, row]) => ({
        id,
        staffId: row.staff_id === null ? null : Number(row.staff_id),
        professionKey: row.profession_key,
        hiredAt: row.hired_at?.toISOString() || null,
        hiredBy: row.hired_by,
        updatedAt: row.updated_at?.toISOString() || null
    }));
}

function normalizedAuditState(rows) {
    return rows.map(row => ({
        id: Number(row.id),
        action: row.action,
        staffId: Number(row.staff_id),
        performedBy: row.performed_by,
        details: row.details,
        ipAddress: row.ip_address,
        createdAt: row.created_at.toISOString()
    }));
}

describe('PostgreSQL migration 291 legacy hire backfill', { skip: !enabled }, () => {
    it('links only one unambiguous phone and profession match and remains idempotent', async () => {
        const testDb = verifiedTestDatabase();
        const pool = createPool(testDb);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL TIME ZONE 'UTC'");
            const suffix = `${process.pid}-${Date.now()}`;

            const uniqueStaffId = await insertStaff(client, {
                name: `Unique ${suffix}`,
                phone: '+380 (50) 111-22-31'
            });
            await client.query(
                `INSERT INTO staff_role_assignments
                    (staff_id, profession_key, is_primary, status, admission_status, internship_status, created_by)
                 VALUES ($1, 'cook', false, 'active', 'approved', 'completed', 'migration_291_integration')`,
                [uniqueStaffId]
            );

            await insertStaff(client, {
                name: `Ambiguous primary ${suffix}`,
                phone: '+380 (50) 111-22-32',
                roleType: 'barista'
            });
            await insertStaff(client, {
                name: `Ambiguous secondary ${suffix}`,
                phone: '380501112232',
                secondaryProfessions: ['barista']
            });
            await insertStaff(client, {
                name: `Unassigned ${suffix}`,
                phone: '+380 (50) 111-22-33',
                roleType: 'animator'
            });
            const alreadyLinkedStaffId = await insertStaff(client, {
                name: `Already linked ${suffix}`,
                phone: '+380 (50) 111-22-35',
                roleType: 'head_cook'
            });

            const vacancyIds = {
                unique: await insertVacancy(client, 'cook', suffix),
                ambiguous: await insertVacancy(client, 'barista', suffix),
                unassigned: await insertVacancy(client, 'waiter', suffix),
                unmatched: await insertVacancy(client, 'animator', suffix),
                alreadyLinked: await insertVacancy(client, 'head_cook', suffix)
            };

            const commonTimes = {
                createdAt: '2026-01-01T09:00:00.000Z',
                updatedAt: '2026-01-02T10:00:00.000Z'
            };
            const applicationIds = {
                unique: await insertApplication(client, {
                    vacancyId: vacancyIds.unique,
                    name: `Unique candidate ${suffix}`,
                    phone: '380 50 111 22 31',
                    addedBy: 'legacy_importer',
                    ...commonTimes
                }),
                ambiguous: await insertApplication(client, {
                    vacancyId: vacancyIds.ambiguous,
                    name: `Ambiguous candidate ${suffix}`,
                    phone: '+380501112232',
                    ...commonTimes
                }),
                unassigned: await insertApplication(client, {
                    vacancyId: vacancyIds.unassigned,
                    name: `Unassigned candidate ${suffix}`,
                    phone: '380-50-111-22-33',
                    ...commonTimes
                }),
                unmatched: await insertApplication(client, {
                    vacancyId: vacancyIds.unmatched,
                    name: `Unmatched candidate ${suffix}`,
                    phone: '+380 50 111 22 34',
                    ...commonTimes
                }),
                alreadyLinked: await insertApplication(client, {
                    vacancyId: vacancyIds.alreadyLinked,
                    name: `Already linked candidate ${suffix}`,
                    phone: '380501112235',
                    addedBy: 'original_importer',
                    staffId: alreadyLinkedStaffId,
                    professionKey: 'head_cook',
                    hiredAt: '2025-12-20T08:00:00.000Z',
                    hiredBy: 'original_hr',
                    ...commonTimes
                })
            };
            const allApplicationIds = Object.values(applicationIds);

            await client.query(migrationSql);

            const firstApplications = await readApplications(client, allApplicationIds);
            const positive = firstApplications.get(applicationIds.unique);
            assert.equal(Number(positive.staff_id), uniqueStaffId);
            assert.equal(positive.profession_key, 'cook');
            assert.equal(positive.hired_at.toISOString(), '2026-01-02T10:00:00.000Z');
            assert.equal(positive.hired_by, 'legacy_importer');

            for (const key of ['ambiguous', 'unassigned', 'unmatched']) {
                const row = firstApplications.get(applicationIds[key]);
                assert.equal(row.staff_id, null, `${key} staff_id remains untouched`);
                assert.equal(row.profession_key, null, `${key} profession_key remains untouched`);
                assert.equal(row.hired_at, null, `${key} hired_at remains untouched`);
                assert.equal(row.hired_by, null, `${key} hired_by remains untouched`);
            }

            const alreadyLinked = firstApplications.get(applicationIds.alreadyLinked);
            assert.equal(Number(alreadyLinked.staff_id), alreadyLinkedStaffId);
            assert.equal(alreadyLinked.profession_key, 'head_cook');
            assert.equal(alreadyLinked.hired_at.toISOString(), '2025-12-20T08:00:00.000Z');
            assert.equal(alreadyLinked.hired_by, 'original_hr');
            assert.equal(alreadyLinked.updated_at.toISOString(), '2026-01-02T10:00:00.000Z');

            const firstAudit = await readBackfillAudit(client, allApplicationIds);
            assert.equal(firstAudit.length, 1);
            assert.equal(firstAudit[0].action, 'job_application_legacy_link_backfilled_v291');
            assert.equal(Number(firstAudit[0].staff_id), uniqueStaffId);
            assert.equal(firstAudit[0].performed_by, 'migration_291');
            assert.equal(firstAudit[0].ip_address, null);
            assert.deepEqual(firstAudit[0].details, {
                vacancy_id: vacancyIds.unique,
                match_key: 'unique_normalized_phone_and_assigned_profession',
                application_id: applicationIds.unique,
                profession_key: 'cook'
            });

            const firstApplicationState = normalizedApplicationState(firstApplications);
            const firstAuditState = normalizedAuditState(firstAudit);

            await client.query(migrationSql);

            const secondApplications = await readApplications(client, allApplicationIds);
            const secondAudit = await readBackfillAudit(client, allApplicationIds);
            assert.deepEqual(normalizedApplicationState(secondApplications), firstApplicationState);
            assert.deepEqual(normalizedAuditState(secondAudit), firstAuditState);
        } finally {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
            await pool.end();
        }
    });
});
