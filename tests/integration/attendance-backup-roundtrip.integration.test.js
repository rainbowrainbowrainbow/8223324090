/**
 * Canonical backup/restore proof for attendance data.
 *
 * Run only through the disposable PostgreSQL runner. This suite deliberately
 * exercises DELETE/INSERT restore statements and must never target a live DB.
 */
'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { BASE_URL, authRequest, getToken } = require('../helpers');

const enabled = process.env.RUN_ATTENDANCE_BACKUP_INTEGRATION === 'true';
const FIXTURE_DATE = '2099-07-15';
const STAFF_CREATED_AT = '2099-07-15 07:00:00.333444';
const STAFF_POSITION = 'Disposable; -- backup fixture';
const CHECKIN_VALUES = Object.freeze({
    checkIn: '2099-07-15 08:01:02.123456',
    checkOut: '2099-07-15 17:30:45.654321',
    createdAt: '2099-07-15 07:45:00.111222',
    method: 'qa;roundtrip'
});
const TIME_RECORD_VALUES = Object.freeze({
    clockIn: '2099-07-15T09:05:06.654321+03:00',
    clockOut: '2099-07-15T18:07:08.123456+03:00',
    clockInUtc: '2099-07-15 06:05:06.654321',
    clockOutUtc: '2099-07-15 15:07:08.123456',
    createdAt: '2099-07-15T06:00:00.222333+00:00',
    createdAtUtc: '2099-07-15 06:00:00.222333',
    notes: 'Fictional; -- attendance round-trip'
});

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ATTENDANCE_BACKUP_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        // The isolated runner may expose this same disposable URL to the app.
        // This test connection is explicitly sourced from TEST_DATABASE_URL.
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

async function downloadCanonicalBackup() {
    const token = await getToken();
    const response = await fetch(`${BASE_URL}/api/backup/download`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000)
    });
    assert.equal(response.status, 200, `backup download returned HTTP ${response.status}`);
    return response.text();
}

function encryptBackup(sql, passphrase) {
    const key = crypto.scryptSync(passphrase, 'park-booking-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(sql, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString('base64');
}

async function expectRestoreOk(path, body) {
    const response = await authRequest('POST', path, body);
    assert.equal(
        response.status,
        200,
        `${path} returned HTTP ${response.status}: ${JSON.stringify(response.data)}`
    );
    assert.equal(response.data?.success, true);
    return response.data;
}

async function expectRestoreRejected(path, body) {
    const response = await authRequest('POST', path, body);
    assert.equal(response.status, 400, `${path} must reject unsafe selective restore input`);
    return response.data;
}

async function loadAttendanceFixture(pool, staffId, checkinId, timeRecordId) {
    const result = await pool.query(
        `SELECT
             s.id AS staff_id,
             s.position,
             to_char(s.created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS staff_created_at,
             sc.id AS checkin_id,
             sc.date::text AS checkin_date,
             to_char(sc.check_in, 'YYYY-MM-DD HH24:MI:SS.US') AS check_in,
             to_char(sc.check_out, 'YYYY-MM-DD HH24:MI:SS.US') AS check_out,
             to_char(sc.created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS checkin_created_at,
             sc.method,
             tr.id AS time_record_id,
             tr.record_date::text AS record_date,
             to_char(tr.clock_in AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS clock_in_utc,
             to_char(tr.clock_out AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS clock_out_utc,
             to_char(tr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS time_record_created_at_utc,
             tr.notes
         FROM staff s
         LEFT JOIN staff_checkins sc ON sc.id = $2 AND sc.staff_id = s.id
         LEFT JOIN hr_time_records tr ON tr.id = $3 AND tr.staff_id = s.id
         WHERE s.id = $1`,
        [staffId, checkinId, timeRecordId]
    );
    assert.equal(result.rowCount, 1, 'fictional staff parent remains present');
    return result.rows[0];
}

function assertCheckinRestored(row) {
    assert.equal(row.checkin_date, FIXTURE_DATE);
    assert.equal(row.check_in, CHECKIN_VALUES.checkIn);
    assert.equal(row.check_out, CHECKIN_VALUES.checkOut);
    assert.equal(row.checkin_created_at, CHECKIN_VALUES.createdAt);
    assert.equal(row.method, CHECKIN_VALUES.method);
}

function assertTimeRecordRestored(row) {
    assert.equal(row.record_date, FIXTURE_DATE);
    assert.equal(row.clock_in_utc, TIME_RECORD_VALUES.clockInUtc);
    assert.equal(row.clock_out_utc, TIME_RECORD_VALUES.clockOutUtc);
    assert.equal(row.time_record_created_at_utc, TIME_RECORD_VALUES.createdAtUtc);
    assert.equal(row.notes, TIME_RECORD_VALUES.notes);
}

async function resetSerial(pool, table) {
    assert.ok(['staff_checkins', 'hr_time_records'].includes(table));
    await pool.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), 1, false)`
    );
}

async function insertSequenceProbe(pool, table, staffId, date) {
    assert.ok(['staff_checkins', 'hr_time_records'].includes(table));
    const before = await pool.query(`SELECT COALESCE(MAX(id), 0)::integer AS max_id FROM ${table}`);
    const maxId = Number(before.rows[0].max_id);
    let result;
    if (table === 'staff_checkins') {
        result = await pool.query(
            `INSERT INTO staff_checkins (staff_id, date, method)
             VALUES ($1, $2, 'qa_sequence_probe')
             RETURNING id`,
            [staffId, date]
        );
    } else {
        result = await pool.query(
            `INSERT INTO hr_time_records (business_context, staff_id, record_date, status, notes)
             VALUES ('event_genix', $1, $2, 'absent', 'qa_sequence_probe')
             RETURNING id`,
            [staffId, date]
        );
    }
    const id = Number(result.rows[0].id);
    assert.ok(id > maxId, `${table} sequence advances beyond restored max id`);
    return id;
}

test(
    'canonical backup round-trips attendance through plain and encrypted selective restore',
    { skip: !enabled, timeout: 180_000 },
    async () => {
        const testDb = requireIsolatedDatabase();
        const pool = createPool(testDb);
        let fixtureStaffId;
        let sentinelKey;
        const probeRows = { staff_checkins: [], hr_time_records: [] };

        try {
            const suffix = `${process.pid}-${Date.now()}`;
            sentinelKey = `qa_attendance_backup_sentinel_${suffix}`;
            const staffResult = await pool.query(
                `INSERT INTO staff (name, department, position, is_active, created_at)
                 VALUES ($1, 'qa', $2, true, $3::timestamp)
                 RETURNING id`,
                [`Fictional Backup Person ${suffix}`, STAFF_POSITION, STAFF_CREATED_AT]
            );
            fixtureStaffId = Number(staffResult.rows[0].id);

            const checkinResult = await pool.query(
                `INSERT INTO staff_checkins
                    (staff_id, date, check_in, check_out, method, created_at)
                 VALUES ($1, $2, $3::timestamp, $4::timestamp, $5, $6::timestamp)
                 RETURNING id`,
                [
                    fixtureStaffId,
                    FIXTURE_DATE,
                    CHECKIN_VALUES.checkIn,
                    CHECKIN_VALUES.checkOut,
                    CHECKIN_VALUES.method,
                    CHECKIN_VALUES.createdAt
                ]
            );
            const checkinId = Number(checkinResult.rows[0].id);

            const timeRecordResult = await pool.query(
                `INSERT INTO hr_time_records (
                     business_context,
                     staff_id,
                     record_date,
                     clock_in,
                     clock_out,
                     status,
                     notes,
                     created_at,
                     updated_at
                 ) VALUES (
                     'event_genix', $1, $2, $3::timestamptz, $4::timestamptz,
                     'present', $5, $6::timestamptz, $6::timestamptz
                 )
                 RETURNING id`,
                [
                    fixtureStaffId,
                    FIXTURE_DATE,
                    TIME_RECORD_VALUES.clockIn,
                    TIME_RECORD_VALUES.clockOut,
                    TIME_RECORD_VALUES.notes,
                    TIME_RECORD_VALUES.createdAt
                ]
            );
            const timeRecordId = Number(timeRecordResult.rows[0].id);

            const backupSql = await downloadCanonicalBackup();
            assert.match(backupSql, new RegExp(`INSERT INTO staff_checkins \\(id, staff_id, date, check_in, check_out, method, created_at\\) VALUES \\(${checkinId},`));
            assert.match(backupSql, new RegExp(`INSERT INTO hr_time_records \\(.*\\) VALUES \\(${timeRecordId},`));
            assert.match(backupSql, /'qa;roundtrip'/);
            assert.match(backupSql, /'Fictional; -- attendance round-trip'/);
            assert.match(backupSql, /'2099-07-15 08:01:02\.123456'/);
            assert.match(backupSql, /'2099-07-15'/);

            await pool.query(
                `INSERT INTO settings (key, value)
                 VALUES ($1, 'non_target_sentinel')`,
                [sentinelKey]
            );

            // Plain restore receives the complete canonical backup but selects only
            // both attendance children. Parent/settings sentinels prove FK-safe filtering.
            await pool.query('DELETE FROM staff_checkins WHERE id = $1', [checkinId]);
            await pool.query('DELETE FROM hr_time_records WHERE id = $1', [timeRecordId]);
            await pool.query(
                `UPDATE staff SET position = 'plain_restore_staff_sentinel' WHERE id = $1`,
                [fixtureStaffId]
            );
            await Promise.all([
                resetSerial(pool, 'staff_checkins'),
                resetSerial(pool, 'hr_time_records')
            ]);

            const plainRestore = await expectRestoreOk('/api/backup/restore', {
                sql: backupSql,
                tables: ['staff_checkins', 'hr_time_records']
            });
            assert.deepEqual(
                new Set(plainRestore.tablesRestored),
                new Set(['staff_checkins', 'hr_time_records'])
            );

            let restored = await loadAttendanceFixture(
                pool,
                fixtureStaffId,
                checkinId,
                timeRecordId
            );
            assert.equal(restored.position, 'plain_restore_staff_sentinel');
            assert.equal(restored.staff_created_at, STAFF_CREATED_AT);
            assertCheckinRestored(restored);
            assertTimeRecordRestored(restored);
            const plainSentinel = await pool.query('SELECT value FROM settings WHERE key = $1', [sentinelKey]);
            assert.equal(plainSentinel.rows[0]?.value, 'non_target_sentinel');

            await expectRestoreRejected('/api/backup/restore', {
                sql: backupSql,
                tables: []
            });
            await expectRestoreRejected('/api/backup/restore', {
                sql: backupSql,
                tables: ['staff']
            });
            const rejectedPlainSentinel = await pool.query(
                'SELECT value FROM settings WHERE key = $1',
                [sentinelKey]
            );
            assert.equal(rejectedPlainSentinel.rows[0]?.value, 'non_target_sentinel');

            probeRows.staff_checkins.push(await insertSequenceProbe(
                pool,
                'staff_checkins',
                fixtureStaffId,
                '2099-07-16'
            ));
            probeRows.hr_time_records.push(await insertSequenceProbe(
                pool,
                'hr_time_records',
                fixtureStaffId,
                '2099-07-16'
            ));

            // Encrypted restore receives the same complete canonical SQL but selects
            // only the two attendance children. Parent and settings sentinels prove
            // encrypted body.tables has the same filtering boundary as plain restore.
            await pool.query(
                `UPDATE staff SET position = 'encrypted_restore_staff_mutation' WHERE id = $1`,
                [fixtureStaffId]
            );
            await pool.query(
                `UPDATE staff_checkins
                 SET check_in = '2099-07-15 00:00:00'::timestamp
                 WHERE id = $1`,
                [checkinId]
            );
            await pool.query(
                `UPDATE hr_time_records
                 SET clock_in = '2099-07-15T00:00:00+00:00'::timestamptz,
                     notes = 'encrypted_restore_hr_sentinel'
                 WHERE id = $1`,
                [timeRecordId]
            );
            await Promise.all([
                resetSerial(pool, 'staff_checkins'),
                resetSerial(pool, 'hr_time_records')
            ]);

            const passphrase = crypto.randomBytes(24).toString('base64url');
            const encryptedBackup = encryptBackup(backupSql, passphrase);
            await expectRestoreRejected('/api/backup/restore-encrypted', {
                key: passphrase,
                data: encryptedBackup,
                tables: 'staff_checkins'
            });
            const encryptedRestore = await expectRestoreOk('/api/backup/restore-encrypted', {
                key: passphrase,
                data: encryptedBackup,
                tables: ['staff_checkins', 'hr_time_records']
            });
            assert.deepEqual(
                new Set(encryptedRestore.tablesRestored),
                new Set(['staff_checkins', 'hr_time_records'])
            );

            restored = await loadAttendanceFixture(
                pool,
                fixtureStaffId,
                checkinId,
                timeRecordId
            );
            assert.equal(restored.position, 'encrypted_restore_staff_mutation');
            assert.equal(restored.staff_created_at, STAFF_CREATED_AT);
            assertCheckinRestored(restored);
            assertTimeRecordRestored(restored);
            const encryptedSentinel = await pool.query('SELECT value FROM settings WHERE key = $1', [sentinelKey]);
            assert.equal(encryptedSentinel.rows[0]?.value, 'non_target_sentinel');

            probeRows.staff_checkins.push(await insertSequenceProbe(
                pool,
                'staff_checkins',
                fixtureStaffId,
                '2099-07-17'
            ));
            probeRows.hr_time_records.push(await insertSequenceProbe(
                pool,
                'hr_time_records',
                fixtureStaffId,
                '2099-07-18'
            ));
        } finally {
            try {
                if (probeRows.staff_checkins.length) {
                    await pool.query(
                        'DELETE FROM staff_checkins WHERE id = ANY($1::integer[])',
                        [probeRows.staff_checkins]
                    );
                }
                if (probeRows.hr_time_records.length) {
                    await pool.query(
                        'DELETE FROM hr_time_records WHERE id = ANY($1::integer[])',
                        [probeRows.hr_time_records]
                    );
                }
                if (fixtureStaffId) {
                    await pool.query('DELETE FROM staff WHERE id = $1', [fixtureStaffId]);
                }
                if (sentinelKey) {
                    await pool.query('DELETE FROM settings WHERE key = $1', [sentinelKey]);
                }
            } finally {
                await pool.end();
            }
        }
    }
);
