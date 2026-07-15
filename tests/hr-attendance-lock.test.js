'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY,
    ATTENDANCE_WRITE_LOCK_NAMESPACE,
    attendanceWriteLockKey,
    lockAttendanceWriteMaintenance,
    lockAttendanceWriteTarget,
    lockAttendanceWriteTargets,
    normalizeAttendanceWriteDate,
    normalizeAttendanceWriteTarget,
    normalizeAttendanceWriteTargets
} = require('../services/attendanceWriteLock');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

function routeBlock(source, method, routePath) {
    const marker = `router.${method}('${routePath}'`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Missing ${method.toUpperCase()} ${routePath}`);
    const nextRoute = source.indexOf('\nrouter.', start + marker.length);
    return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

function namedFunctionBlock(source, functionName) {
    const marker = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`).exec(source);
    assert.ok(marker, `Missing function ${functionName}`);
    const start = marker.index;
    const remainder = source.slice(start + marker[0].length);
    const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
    return source.slice(start, nextFunction ? start + marker[0].length + nextFunction.index : source.length);
}

function patternIndex(source, pattern, offset = 0) {
    const remainder = source.slice(offset);
    const relative = typeof pattern === 'string'
        ? remainder.indexOf(pattern)
        : remainder.search(pattern);
    return relative === -1 ? -1 : offset + relative;
}

function assertInOrder(source, patterns, label) {
    let cursor = 0;
    for (const pattern of patterns) {
        const index = patternIndex(source, pattern, cursor);
        assert.notEqual(index, -1, `${label}: missing or out-of-order ${String(pattern)}`);
        cursor = index + 1;
    }
}

test('attendance write lock uses one validated staff/date key for every writer', async () => {
    assert.equal(ATTENDANCE_WRITE_LOCK_NAMESPACE, 'eventgenix:attendance-write:v1');
    assert.equal(normalizeAttendanceWriteDate('2026-07-15'), '2026-07-15');
    assert.equal(normalizeAttendanceWriteDate(new Date('2026-07-15T18:30:00.000Z')), '2026-07-15');
    assert.deepEqual(normalizeAttendanceWriteTarget({ staff_id: '42', record_date: '2026-07-15' }), {
        staffId: 42,
        date: '2026-07-15'
    });
    assert.equal(
        attendanceWriteLockKey({ staffId: 42, date: '2026-07-15' }),
        'eventgenix:attendance-write:v1:42:2026-07-15'
    );

    for (const target of [
        { staffId: 0, date: '2026-07-15' },
        { staffId: 42, date: '2026-02-30' },
        { staffId: 42, date: '15.07.2026' }
    ]) {
        assert.throws(
            () => attendanceWriteLockKey(target),
            error => error.code === 'ATTENDANCE_WRITE_LOCK_TARGET_INVALID'
                && error.statusCode === 400
        );
    }

    await assert.rejects(
        lockAttendanceWriteTarget({}, { staffId: 42, date: '2026-07-15' }),
        error => error instanceof TypeError
    );
});

test('attendance write locks deduplicate and acquire targets in deterministic date/staff order', async () => {
    const calls = [];
    const db = {
        async query(sql, params) {
            calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
            return { rows: [{}] };
        }
    };
    const input = [
        { staffId: 12, date: '2026-07-16' },
        { staffId: 7, date: '2026-07-16' },
        { staff_id: '7', recordDate: '2026-07-15' },
        { staffId: 7, record_date: '2026-07-16' }
    ];

    assert.deepEqual(normalizeAttendanceWriteTargets(input), [
        { staffId: 7, date: '2026-07-15' },
        { staffId: 7, date: '2026-07-16' },
        { staffId: 12, date: '2026-07-16' }
    ]);
    assert.deepEqual(await lockAttendanceWriteTargets(db, input), [
        { staffId: 7, date: '2026-07-15' },
        { staffId: 7, date: '2026-07-16' },
        { staffId: 12, date: '2026-07-16' }
    ]);
    assert.deepEqual(calls, [
        {
            sql: 'SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
            params: [ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY]
        },
        {
            sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            params: ['eventgenix:attendance-write:v1:7:2026-07-15']
        },
        {
            sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            params: ['eventgenix:attendance-write:v1:7:2026-07-16']
        },
        {
            sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            params: ['eventgenix:attendance-write:v1:12:2026-07-16']
        }
    ]);
});

test('attendance maintenance takes the exclusive global gate used by normal writers in shared mode', async () => {
    const calls = [];
    const db = {
        async query(sql, params) {
            calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
            return { rows: [{}] };
        }
    };

    assert.equal(
        await lockAttendanceWriteMaintenance(db),
        ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY
    );
    assert.deepEqual(calls, [{
        sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        params: [ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY]
    }]);
    await assert.rejects(
        lockAttendanceWriteMaintenance(null),
        error => error instanceof TypeError
    );
});

test('camera check-in and checkout lock the staff day before either attendance table is touched', () => {
    const source = read('routes', 'staff.js');
    assert.match(source, /require\('\.\.\/services\/attendanceWriteLock'\)/);

    assertInOrder(routeBlock(source, 'post', '/checkin'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date: today \}\)/,
        /INSERT INTO staff_checkins/,
        /syncHrClockInFromStaffCheckin\(client, staffId/,
        /await client\.query\('COMMIT'\)/,
        /broadcast\('hr:attendance-updated'/
    ], 'POST /api/staff/checkin');

    assertInOrder(routeBlock(source, 'post', '/checkout'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date: today \}\)/,
        /UPDATE staff_checkins SET check_out/,
        /syncHrClockOutFromStaffCheckout\(client, staffId/,
        /await client\.query\('COMMIT'\)/,
        /broadcast\('hr:attendance-updated'/
    ], 'POST /api/staff/checkout');
});

test('manual and QA attendance routes lock before canonical reads or writes and audit atomically', () => {
    const source = read('routes', 'hr.js');
    assert.match(source, /require\('\.\.\/services\/attendanceWriteLock'\)/);

    assertInOrder(routeBlock(source, 'post', '/qa/multi-segment/attendance'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date \}\)/,
        /loadLiveQaStaff\(client, staffId, runId, \{ forUpdate: true \}\)/,
        /SELECT id FROM hr_time_records[\s\S]*FOR UPDATE/,
        /INSERT INTO hr_time_records/,
        /auditLog\('live_multi_segment_qa_attendance_create'[\s\S]*req\.ip, client\)/,
        /await client\.query\('COMMIT'\)/
    ], 'POST /api/hr/qa/multi-segment/attendance');

    assertInOrder(routeBlock(source, 'delete', '/qa/multi-segment/:runId'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteMaintenance\(client\)/,
        /loadLiveQaStaff\(client, staffId, runId, \{ forUpdate: true \}\)/,
        /DELETE FROM hr_time_records/,
        /DELETE FROM staff_checkins/,
        /await client\.query\('COMMIT'\)/
    ], 'DELETE /api/hr/qa/multi-segment/:runId');

    assertInOrder(routeBlock(source, 'post', '/clock-in'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date: today \}\)/,
        /SELECT \* FROM hr_time_records[\s\S]*FOR UPDATE/,
        /loadHrShiftDayPlan\(client/,
        /(?:UPDATE|INSERT INTO) hr_time_records/,
        /auditLog\([\s\S]*req\.ip,[\s\S]*client\s*\)/,
        /await client\.query\('COMMIT'\)/
    ], 'POST /api/hr/clock-in');

    assertInOrder(routeBlock(source, 'post', '/clock-out'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date: today \}\)/,
        /SELECT \* FROM hr_time_records[\s\S]*FOR UPDATE/,
        /loadHrShiftDayPlan\(client/,
        /UPDATE hr_time_records SET/,
        /auditLog\('clock_out'[\s\S]*req\.ip, client\)/,
        /await client\.query\('COMMIT'\)/
    ], 'POST /api/hr/clock-out');

    assertInOrder(routeBlock(source, 'post', '/mark-absent'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client, \{ staffId, date: today \}\)/,
        /INSERT INTO hr_time_records/,
        /auditLog\('mark_absent'[\s\S]*req\.ip, client\)/,
        /await client\.query\('COMMIT'\)/
    ], 'POST /api/hr/mark-absent');

    const correction = routeBlock(source, 'put', '/records/:id/correct');
    assertInOrder(correction, [
        /await client\.query\('BEGIN'\)/,
        /FROM hr_time_records[\s\S]*WHERE id = \$1/,
        /await lockAttendanceWriteTarget\(client,/,
        /FROM hr_time_records[\s\S]*FOR UPDATE/,
        /UPDATE hr_time_records SET/,
        /auditLog\('correction'[\s\S]*req\.ip, client\)/,
        /await client\.query\('COMMIT'\)/
    ], 'PUT /api/hr/records/:id/correct');
});

test('backup restore takes the exclusive attendance gate before maintenance mutations', () => {
    const source = read('services', 'backupRecovery.js');
    assert.match(source, /require\('\.\/attendanceWriteLock'\)/);
    assertInOrder(source, [
        /await client\.query\('BEGIN'\)/,
        /plan\.selectedTables\.some\(table => ATTENDANCE_TABLES\.has\(table\)\)/,
        /await lockAttendanceWriteMaintenance\(client\)/,
        /await lockRestoreTables\(client, plan\.selectedTables\)/,
        /TRUNCATE TABLE|DELETE FROM/,
        /await client\.query\('COMMIT'\)/
    ], 'structured backup recovery executor');

    const routeSource = read('routes', 'backup.js');
    assert.match(routeBlock(routeSource, 'post', '/restore'), /runRestoreRequest\(req, res, req\.body\.artifact\)/);
    assert.match(routeBlock(routeSource, 'post', '/restore-encrypted'), /decryptBackupArtifact[\s\S]*runRestoreRequest\(req, res, artifact\)/);
});

test('approved leave and HR scheduler writers share the transaction-scoped day locks', () => {
    const routeSource = read('routes', 'hr.js');
    const leaveReview = routeBlock(routeSource, 'put', '/leave-requests/:id/review');
    assertInOrder(leaveReview, [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTargets\(\s*client,/,
        /INSERT INTO hr_time_records/,
        /auditLog\('leave_request_review'[\s\S]*req\.ip, client\)/,
        /await client\.query\('COMMIT'\)/
    ], 'PUT /api/hr/leave-requests/:id/review');

    const serviceSource = read('services', 'hr.js');
    assert.match(serviceSource, /require\('\.\/attendanceWriteLock'\)/);
    assertInOrder(namedFunctionBlock(serviceSource, 'checkHrAutoClose'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client,/,
        /UPDATE hr_time_records SET/,
        /INSERT INTO hr_audit_log/,
        /await client\.query\('COMMIT'\)/
    ], 'checkHrAutoClose');
    assertInOrder(namedFunctionBlock(serviceSource, 'checkHrNoShow'), [
        /await client\.query\('BEGIN'\)/,
        /await lockAttendanceWriteTarget\(client,/,
        /INSERT INTO hr_time_records/,
        /INSERT INTO hr_audit_log/,
        /await client\.query\('COMMIT'\)/
    ], 'checkHrNoShow');
});
