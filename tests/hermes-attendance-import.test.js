'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { createHermesScheduleRouter } = require('../routes/hermes-schedule');
const {
    ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY,
    attendanceWriteLockKey
} = require('../services/attendanceWriteLock');
const {
    HERMES_ATTENDANCE_CLASSIFICATIONS,
    applyHermesAttendanceImport,
    buildAttendancePlan,
    buildAttendancePreviewHash,
    buildPreviewRows,
    emptyAttendanceSummary,
    matchStaffCandidate,
    normalizeHermesAttendanceApplyBody,
    normalizeHermesAttendancePreviewPayload,
    previewHermesAttendanceImport
} = require('../services/hermesAttendanceImport');

const PREVIEW_ID = 'hai_12345678-1234-1234-1234-123456789abc';
const READY_ROW_ID = 'har_111111111111111111111111';

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function postJson(baseUrl, path, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
}

function routeActor(manageStaff = true) {
    return {
        id: 42,
        username: 'hermes.attendance',
        role: 'employee',
        action_allowlist: manageStaff ? ['manage_staff'] : [],
        action_denylist: manageStaff ? [] : ['manage_staff'],
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix'
    };
}

async function listenAttendanceRouter(options = {}) {
    const pool = options.pool || {
        async query() {
            throw new Error('Route dependency should have been injected');
        },
        async connect() {
            return { query: this.query, release() {} };
        }
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = options.actor || routeActor(true);
        req.integration = {
            id: HERMES_INTEGRATION_ID,
            authMode: 'x-api-key',
            actorUserId: 42
        };
        next();
    });
    app.use('/api/hermes', createHermesScheduleRouter({
        pool,
        previewAttendanceImport: options.previewAttendanceImport,
        applyAttendanceImport: options.applyAttendanceImport,
        broadcastAttendanceChanges: options.broadcastAttendanceChanges,
        withIdempotency: options.withIdempotency
    }));
    return listen(app);
}

function staffCandidate(id, name, overrides = {}) {
    return {
        id,
        name,
        display_name: name,
        department: 'operations',
        position: 'Specialist',
        ...overrides
    };
}

function previewPayload(overrides = {}) {
    return {
        businessContext: 'event_genix',
        documentDate: '2026-07-15',
        source: {
            type: 'arrival_sheet_photo',
            rowSet: 'arrival-sheet-unit-2026-07-15'
        },
        rows: [{
            sourceRowId: 'sheet-row-1',
            ocrName: 'Марко Вигаданий',
            arrivalTime: '09:07',
            signatureVisible: true,
            confidence: 0.97
        }],
        ...overrides
    };
}

function normalizedRow(overrides = {}) {
    return {
        sourceRowId: 'sheet-row-1',
        ocrName: 'Марко Вигаданий',
        arrivalTime: '09:07',
        rawArrivalTime: '09:07',
        signatureVisible: true,
        confidence: 0.97,
        ...overrides
    };
}

function currentState(overrides = {}) {
    return {
        schedules: new Map(),
        timeRecords: new Map(),
        checkins: new Map(),
        ...overrides
    };
}

function createPreviewDb(options = {}) {
    const calls = [];
    const candidates = options.candidates || [staffCandidate(101, 'Марко Вигаданий')];
    const scheduleRows = options.scheduleRows || [{
        staff_id: 101,
        status: 'working',
        shift_start: '09:00:00',
        shift_end: '18:00:00'
    }];
    const timeRows = options.timeRows || [];
    const checkinRows = options.checkinRows || [];

    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/FROM staff s[\s\S]*ORDER BY s\.id ASC/.test(sql)) return { rows: candidates };
            if (/FROM staff_schedule/.test(sql)) return { rows: scheduleRows };
            if (/FROM hr_time_records/.test(sql)) return { rows: timeRows };
            if (/FROM staff_checkins/.test(sql)) return { rows: checkinRows };
            if (/UPDATE hermes_attendance_imports[\s\S]*SET status = 'expired'/.test(sql)) {
                return { rows: [] };
            }
            if (/INSERT INTO hermes_attendance_imports/.test(sql)) {
                return {
                    rows: [{
                        id: 1,
                        public_id: params[0],
                        business_context: params[1],
                        status: params[2],
                        source_type: params[3],
                        source_reference: JSON.parse(params[4]),
                        source_dedupe_key: params[5],
                        document_date: params[6],
                        extracted_rows: JSON.parse(params[7]),
                        preview_rows: JSON.parse(params[8]),
                        current_state_snapshot: JSON.parse(params[9]),
                        preview_hash: params[10],
                        expires_at: new Date(Date.now() + (30 * 60 * 1000)),
                        created_by_user_id: params[11]
                    }]
                };
            }
            throw new Error(`Unexpected preview SQL: ${sql}`);
        }
    };
}

function createReadyImportRow(overrides = {}) {
    const source = {
        type: 'arrival_sheet_photo',
        rowSet: 'arrival-sheet-unit-apply'
    };
    const extractedRows = [{
        sourceRowId: 'sheet-row-apply',
        ocrName: 'Марко Вигаданий',
        arrivalTime: '09:08',
        signatureVisible: true,
        confidence: 0.99
    }];
    const previewRows = [{
        previewRowId: READY_ROW_ID,
        sourceRowId: 'sheet-row-apply',
        ocrName: 'Марко Вигаданий',
        matchedStaff: { staffId: 101, name: 'Марко Вигаданий' },
        matchCandidates: [],
        arrivalTime: '09:08',
        signatureVisible: true,
        confidence: 0.99,
        classification: 'ready_to_apply',
        issues: [],
        writePlan: {
            staffId: 101,
            name: 'Марко Вигаданий',
            documentDate: '2026-07-15',
            arrivalTime: '09:08',
            plannedStart: '09:00',
            plannedEnd: '18:00',
            lateMinutes: 8,
            attendanceStatus: 'late'
        }
    }];
    const currentStateSnapshot = [{
        previewRowId: READY_ROW_ID,
        staffId: 101,
        schedule: { status: 'working', startTime: '09:00', endTime: '18:00' },
        timeRecordExists: false,
        checkinExists: false
    }];
    const documentDate = '2026-07-15';
    const previewHash = buildAttendancePreviewHash({
        documentDate,
        source,
        extractedRows,
        previewRows,
        currentStateSnapshot
    });
    return {
        id: 7,
        public_id: PREVIEW_ID,
        business_context: 'event_genix',
        status: 'ready',
        source_type: 'arrival_sheet_photo',
        source_reference: source,
        document_date: documentDate,
        extracted_rows: extractedRows,
        preview_rows: previewRows,
        current_state_snapshot: currentStateSnapshot,
        preview_hash: previewHash,
        expires_at: new Date(Date.now() + (30 * 60 * 1000)),
        ...overrides
    };
}

function createApplyDb(importRow = createReadyImportRow(), options = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/SELECT \*[\s\S]*FROM hermes_attendance_imports/.test(sql)) return { rows: [importRow] };
            if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
            if (/FROM staff s[\s\S]*FOR UPDATE OF s/.test(sql)) {
                return {
                    rows: [{
                        id: 101,
                        name: 'Марко Вигаданий',
                        display_name: 'Марко Вигаданий',
                        scheduleable: true
                    }]
                };
            }
            if (/FROM staff_schedule/.test(sql)) {
                return {
                    rows: options.scheduleRows || [{
                        staff_id: 101,
                        status: 'working',
                        shift_start: '09:00:00',
                        shift_end: '18:00:00'
                    }]
                };
            }
            if (/FROM hr_time_records/.test(sql)) return { rows: options.timeRows || [] };
            if (/FROM staff_checkins/.test(sql)) return { rows: options.checkinRows || [] };
            if (/INSERT INTO hr_time_records/.test(sql)) {
                return { rows: options.insertedRows || [{ id: 8801, clock_in: new Date('2026-07-15T06:08:00Z') }] };
            }
            if (/INSERT INTO hr_audit_log/.test(sql)) return { rows: [] };
            if (/UPDATE hermes_attendance_imports[\s\S]*SET status = 'applied'/.test(sql)) {
                return {
                    rows: options.sealRows === undefined
                        ? [{ id: importRow.id }]
                        : options.sealRows
                };
            }
            throw new Error(`Unexpected apply SQL: ${sql}`);
        }
    };
}

describe('Hermes arrival-sheet preview contract', () => {
    it('normalizes only sanitized arrival-sheet metadata and preserves an invalid time for row classification', () => {
        const normalized = normalizeHermesAttendancePreviewPayload(previewPayload({
            rows: [{
                source_row_id: 'sheet-row-1',
                ocr_name: '  Марко   Вигаданий  ',
                arrival_time: '25:61',
                signature_visible: false,
                confidence: 0.4
            }]
        }));

        assert.equal(normalized.documentDate, '2026-07-15');
        assert.deepEqual(normalized.source, {
            type: 'arrival_sheet_photo',
            rowSet: 'arrival-sheet-unit-2026-07-15'
        });
        assert.equal(normalized.rows[0].ocrName, 'Марко Вигаданий');
        assert.equal(normalized.rows[0].arrivalTime, null);
        assert.equal(normalized.rows[0].rawArrivalTime, '25:61');
        assert.equal(normalized.rows[0].signatureVisible, false);
    });

    it('rejects binary/photo fields, duplicate source ids, and unsupported preview fields', () => {
        assert.throws(
            () => normalizeHermesAttendancePreviewPayload(previewPayload({
                source: {
                    type: 'arrival_sheet_photo',
                    rowSet: 'arrival-sheet-unit-2026-07-15',
                    photo: 'base64-data-must-not-be-accepted'
                }
            })),
            error => error.code === 'HERMES_ATTENDANCE_SENSITIVE_FIELD_FORBIDDEN'
        );
        assert.throws(
            () => normalizeHermesAttendancePreviewPayload(previewPayload({
                rows: [
                    previewPayload().rows[0],
                    { ...previewPayload().rows[0], ocrName: 'Лада Тестова' }
                ]
            })),
            error => error.code === 'HERMES_ATTENDANCE_SOURCE_ROW_DUPLICATE'
        );
        assert.throws(
            () => normalizeHermesAttendancePreviewPayload({ ...previewPayload(), schedule: [] }),
            error => error.code === 'HERMES_ATTENDANCE_PREVIEW_FIELDS_INVALID'
        );
    });

    it('matches exact normalized names first, then one whole-token candidate, and fails closed on ambiguity', () => {
        const candidates = [
            staffCandidate(101, 'Марко Вигаданий'),
            staffCandidate(102, 'Лада Тестова'),
            staffCandidate(103, 'Ірина Тестова')
        ];

        assert.equal(matchStaffCandidate('  МАРКО   ВИГАДАНИЙ ', candidates).candidate.id, 101);
        assert.equal(matchStaffCandidate('Вигаданий', candidates).candidate.id, 101);
        assert.equal(matchStaffCandidate('Тестова', candidates).kind, 'ambiguous');
        assert.deepEqual(
            matchStaffCandidate('Неіснуючий Співробітник', candidates),
            { kind: 'not_found', candidates: [] }
        );
    });

    it('classifies missing date, invalid time, missing/ambiguous staff, schedule conflicts, duplicates, and ready rows deterministically', () => {
        const candidates = [
            staffCandidate(101, 'Марко Вигаданий'),
            staffCandidate(102, 'Лада Тестова'),
            staffCandidate(103, 'Ірина Тестова'),
            staffCandidate(104, 'Остап Відпускний'),
            staffCandidate(105, 'Софія Повторна')
        ];
        const state = currentState({
            schedules: new Map([
                [101, { staff_id: 101, status: 'working', shift_start: '09:00:00', shift_end: '18:00:00' }],
                [104, { staff_id: 104, status: 'vacation', shift_start: null, shift_end: null }]
            ]),
            timeRecords: new Map([[105, { id: 501, staff_id: 105 }]])
        });
        const payload = {
            documentDate: '2026-07-15',
            rows: [
                normalizedRow({ sourceRowId: 'ready', ocrName: 'Марко Вигаданий' }),
                normalizedRow({ sourceRowId: 'invalid', ocrName: 'Марко Вигаданий', arrivalTime: null, rawArrivalTime: '99:00' }),
                normalizedRow({ sourceRowId: 'missing', ocrName: 'Немає У CRM' }),
                normalizedRow({ sourceRowId: 'ambiguous', ocrName: 'Тестова' }),
                normalizedRow({ sourceRowId: 'conflict', ocrName: 'Остап Відпускний' }),
                normalizedRow({ sourceRowId: 'duplicate', ocrName: 'Софія Повторна' })
            ]
        };
        const rows = buildPreviewRows(payload, candidates, state, 'a'.repeat(64));

        assert.deepEqual(rows.map(row => row.classification), [
            'ready_to_apply',
            'invalid_time',
            'staff_not_found',
            'ambiguous_staff',
            'schedule_conflict',
            'duplicate_attendance'
        ]);
        assert.deepEqual(rows[0].writePlan, {
            staffId: 101,
            name: 'Марко Вигаданий',
            documentDate: '2026-07-15',
            arrivalTime: '09:07',
            plannedStart: '09:00',
            plannedEnd: '18:00',
            lateMinutes: 7,
            attendanceStatus: 'late'
        });

        const noDate = buildPreviewRows(
            { documentDate: null, rows: [normalizedRow()] },
            candidates,
            currentState(),
            'b'.repeat(64)
        );
        assert.equal(noDate[0].classification, 'date_missing');
        assert.equal(noDate[0].writePlan, null);
    });

    it('keeps all seven stable summary keys', () => {
        const summary = emptyAttendanceSummary();
        assert.deepEqual(Object.keys(summary), HERMES_ATTENDANCE_CLASSIFICATIONS);
        assert.deepEqual(summary, {
            ready_to_apply: 0,
            staff_not_found: 0,
            ambiguous_staff: 0,
            schedule_conflict: 0,
            duplicate_attendance: 0,
            invalid_time: 0,
            date_missing: 0
        });
    });

    it('does not invent lateness when a working schedule has no valid planned start', () => {
        assert.deepEqual(buildAttendancePlan(
            { arrivalTime: '11:00' },
            { status: 'working', shift_start: null, shift_end: '18:00:00' }
        ), {
            plannedStart: null,
            plannedEnd: null,
            lateMinutes: 0,
            attendanceStatus: 'unscheduled'
        });
        assert.equal(buildAttendancePlan(
            { arrivalTime: '11:00' },
            { status: 'remote', shift_start: 'invalid', shift_end: '18:00:00' }
        ).lateMinutes, 0);
    });

    it('persists only immutable preview metadata and returns zero attendance/schedule writes', async () => {
        const db = createPreviewDb();
        const result = await previewHermesAttendanceImport(db, previewPayload(), {
            actorUserId: 42,
            businessContext: 'event_genix'
        });

        assert.equal(result.success, true);
        assert.match(result.previewId, /^hai_/);
        assert.equal(result.status, 'ready');
        assert.equal(result.summary.ready_to_apply, 1);
        assert.equal(result.attendanceWrites, 0);
        assert.equal(result.scheduleWrites, 0);
        assert.equal(result.scheduleTouched, false);
        assert.equal(result.sanitized, true);

        const writes = db.calls.filter(call => /\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/i.test(call.sql));
        assert.ok(writes.some(call => /hermes_attendance_imports/.test(call.sql)));
        assert.equal(writes.some(call => /hr_time_records|staff_schedule|staff_checkins|hr_shifts/.test(call.sql)), false);
    });

    it('previews five valid arrival rows as ready without operational writes', async () => {
        const candidates = Array.from({ length: 5 }, (_, index) => (
            staffCandidate(201 + index, `Тестовий Працівник ${index + 1}`)
        ));
        const scheduleRows = candidates.map(candidate => ({
            staff_id: candidate.id,
            status: 'working',
            shift_start: '10:00:00',
            shift_end: '19:00:00'
        }));
        const db = createPreviewDb({ candidates, scheduleRows });
        const result = await previewHermesAttendanceImport(db, previewPayload({
            source: { type: 'arrival_sheet_photo', rowSet: 'five-safe-test-rows' },
            rows: candidates.map((candidate, index) => ({
                sourceRowId: `SAFE-${index + 1}`,
                ocrName: candidate.name,
                arrivalTime: '10:00',
                signatureVisible: true,
                confidence: 0.95
            }))
        }), { actorUserId: 42, businessContext: 'event_genix' });

        assert.equal(result.summary.ready_to_apply, 5);
        assert.equal(result.rows.every(row => row.classification === 'ready_to_apply'), true);
        assert.equal(result.attendanceWrites, 0);
        assert.equal(result.scheduleWrites, 0);
        assert.equal(db.calls.some(call => /INSERT INTO hr_time_records|INSERT INTO staff_schedule/.test(call.sql)), false);
    });
});

describe('Hermes arrival-sheet apply contract', () => {
    it('accepts only a sealed preview id and selected preview row ids', () => {
        assert.deepEqual(normalizeHermesAttendanceApplyBody({
            preview_id: PREVIEW_ID,
            selected_row_ids: [READY_ROW_ID]
        }), {
            previewId: PREVIEW_ID,
            selectedRowIds: [READY_ROW_ID]
        });

        for (const rawField of ['rows', 'date', 'arrivalTime', 'scheduleRows']) {
            assert.throws(
                () => normalizeHermesAttendanceApplyBody({
                    previewId: PREVIEW_ID,
                    selectedRowIds: [READY_ROW_ID],
                    [rawField]: rawField === 'rows' || rawField === 'scheduleRows' ? [] : 'unsafe'
                }),
                error => error.code === 'HERMES_ATTENDANCE_APPLY_BODY_FIELDS_INVALID'
            );
        }
    });

    it('writes canonical hr_time_records in Europe/Kyiv, audits it, and never mutates schedule/check-in/staff tables', async () => {
        const db = createApplyDb();
        const result = await applyHermesAttendanceImport(db, {
            previewId: PREVIEW_ID,
            selectedRowIds: [READY_ROW_ID]
        }, {
            businessContext: 'event_genix',
            actorUserId: 42,
            actor: {
                user: { username: 'hermes.attendance' },
                ip: '127.0.0.1'
            }
        });

        assert.equal(result.response.attendanceWrites, 1);
        assert.equal(result.response.scheduleWrites, 0);
        assert.equal(result.response.scheduleTouched, false);
        assert.equal(result.response.applied[0].staffId, 101);
        assert.equal(result.response.applied[0].status, 'late');
        assert.equal(result.response.applied[0].lateMinutes, 8);
        assert.deepEqual(result.changes, [{
            businessContext: 'event_genix',
            date: '2026-07-15',
            staffId: 101,
            attendanceRecordId: 8801,
            status: 'late'
        }]);

        const attendanceInsert = db.calls.find(call => /INSERT INTO hr_time_records/.test(call.sql));
        assert.ok(attendanceInsert);
        assert.match(attendanceInsert.sql, /AT TIME ZONE 'Europe\/Kyiv'/);
        assert.match(attendanceInsert.sql, /ON CONFLICT \(staff_id, record_date\) DO NOTHING/);
        assert.deepEqual(attendanceInsert.params.slice(0, 8), [
            'event_genix',
            101,
            '2026-07-15',
            '09:08',
            '09:00',
            '18:00',
            8,
            'late'
        ]);

        const maintenanceGateIndex = db.calls.findIndex(call => (
            /pg_advisory_xact_lock_shared/.test(call.sql)
            && call.params?.[0] === ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY
        ));
        const expectedDayLockKey = attendanceWriteLockKey({ staffId: 101, date: '2026-07-15' });
        const lockIndex = db.calls.findIndex(call => (
            /pg_advisory_xact_lock\(/.test(call.sql)
            && call.params?.[0] === expectedDayLockKey
        ));
        const staffRecheckIndex = db.calls.findIndex(call => /FROM staff s[\s\S]*FOR UPDATE OF s/.test(call.sql));
        const scheduleRecheckIndex = db.calls.findIndex(call => /FROM staff_schedule/.test(call.sql));
        const timeRecordRecheckIndex = db.calls.findIndex(call => /FROM hr_time_records/.test(call.sql));
        const checkinRecheckIndex = db.calls.findIndex(call => /FROM staff_checkins/.test(call.sql));
        const attendanceInsertIndex = db.calls.indexOf(attendanceInsert);
        assert.ok(lockIndex >= 0, 'Hermes apply must acquire the shared attendance lock');
        assert.ok(maintenanceGateIndex >= 0, 'Hermes apply must acquire the shared maintenance gate');
        assert.ok(maintenanceGateIndex < lockIndex, 'shared maintenance gate must precede the day lock');
        assert.equal(db.calls[lockIndex].params[0], expectedDayLockKey);
        for (const [label, index] of [
            ['staff recheck', staffRecheckIndex],
            ['schedule recheck', scheduleRecheckIndex],
            ['time-record recheck', timeRecordRecheckIndex],
            ['camera/manual check-in recheck', checkinRecheckIndex],
            ['attendance insert', attendanceInsertIndex]
        ]) {
            assert.ok(index > lockIndex, `${label} must run after the shared attendance lock`);
        }

        const auditInsert = db.calls.find(call => /INSERT INTO hr_audit_log/.test(call.sql));
        assert.ok(auditInsert);
        assert.equal(auditInsert.params[0], 'attendance_hermes_apply');
        const auditDetails = JSON.parse(auditInsert.params[3]);
        assert.equal(auditDetails.previewId, PREVIEW_ID);
        assert.equal(auditDetails.scheduleWrites, 0);

        const forbiddenMutations = db.calls.filter(call => {
            return /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:staff_schedule|staff_checkins|hr_shifts|staff)\b/i.test(call.sql);
        });
        assert.deepEqual(forbiddenMutations, []);
    });

    it('rechecks existing camera/manual attendance and skips the selected row without overwriting it', async () => {
        const db = createApplyDb(createReadyImportRow(), {
            checkinRows: [{
                id: 601,
                staff_id: 101,
                date: '2026-07-15',
                check_in: new Date('2026-07-15T06:01:00Z'),
                method: 'camera'
            }]
        });
        const result = await applyHermesAttendanceImport(db, {
            previewId: PREVIEW_ID,
            selectedRowIds: [READY_ROW_ID]
        }, {
            businessContext: 'event_genix',
            actorUserId: 42
        });

        assert.equal(result.response.attendanceWrites, 0);
        assert.equal(result.response.skipped[0].classification, 'duplicate_attendance');
        assert.equal(db.calls.some(call => /INSERT INTO hr_time_records/.test(call.sql)), false);
        assert.equal(db.calls.some(call => /INSERT INTO hr_audit_log/.test(call.sql)), false);
        assert.equal(db.calls.some(call => /UPDATE hermes_attendance_imports/.test(call.sql)), true);
    });

    it('rechecks a new day-off conflict and skips it without attendance writes', async () => {
        const db = createApplyDb(createReadyImportRow(), {
            scheduleRows: [{
                staff_id: 101,
                status: 'dayoff',
                shift_start: null,
                shift_end: null
            }]
        });
        const result = await applyHermesAttendanceImport(db, {
            previewId: PREVIEW_ID,
            selectedRowIds: [READY_ROW_ID]
        }, { businessContext: 'event_genix', actorUserId: 42 });

        assert.equal(result.response.attendanceWrites, 0);
        assert.equal(result.response.scheduleWrites, 0);
        assert.equal(result.response.skipped[0].classification, 'schedule_conflict');
        assert.equal(db.calls.some(call => /INSERT INTO hr_time_records/.test(call.sql)), false);
    });

    it('raises a rollback-class error if the applied preview cannot be sealed after writes', async () => {
        const db = createApplyDb(createReadyImportRow(), { sealRows: [] });
        await assert.rejects(
            applyHermesAttendanceImport(db, {
                previewId: PREVIEW_ID,
                selectedRowIds: [READY_ROW_ID]
            }, { businessContext: 'event_genix', actorUserId: 42 }),
            error => error.code === 'HERMES_ATTENDANCE_IMPORT_APPLY_CONFLICT'
                && error.statusCode === 500
        );
        assert.equal(db.calls.some(call => /INSERT INTO hr_time_records/.test(call.sql)), true);
    });
});

describe('Hermes arrival-sheet route guards', () => {
    it('allows manage_staff to preview without mutation confirmation and blocks actors without the permission', async () => {
        let previewCalls = 0;
        const previewAttendanceImport = async (_db, body, options) => {
            previewCalls += 1;
            assert.equal(body.source.type, 'arrival_sheet_photo');
            assert.equal(options.actorUserId, 42);
            assert.equal(options.businessContext, 'event_genix');
            return {
                success: true,
                previewId: PREVIEW_ID,
                created: true,
                attendanceWrites: 0,
                scheduleWrites: 0
            };
        };

        const allowedApp = await listenAttendanceRouter({ previewAttendanceImport });
        try {
            const allowed = await postJson(
                allowedApp.baseUrl,
                '/api/hermes/attendance/preview',
                previewPayload()
            );
            assert.equal(allowed.status, 201);
            assert.equal(allowed.data.attendanceWrites, 0);
            assert.equal(allowed.data.scheduleWrites, 0);
            assert.equal(previewCalls, 1);
        } finally {
            await close(allowedApp.server);
        }

        const deniedApp = await listenAttendanceRouter({
            actor: routeActor(false),
            previewAttendanceImport
        });
        try {
            const denied = await postJson(
                deniedApp.baseUrl,
                '/api/hermes/attendance/preview',
                previewPayload()
            );
            assert.equal(denied.status, 403);
            assert.equal(denied.data.code, 'HERMES_MANAGE_STAFF_REQUIRED');
            assert.equal(previewCalls, 1);
        } finally {
            await close(deniedApp.server);
        }
    });

    it('requires integration id, a fresh idempotency key, and explicit confirmation before apply', async () => {
        let applyCalls = 0;
        const applyAttendanceImport = async () => {
            applyCalls += 1;
            return {
                response: { success: true, attendanceWrites: 0, scheduleWrites: 0 },
                changes: []
            };
        };
        const withIdempotency = async (_req, res, work) => {
            const result = await work({ pool: {}, afterCommit: [] });
            return res.status(result.status).json(result.body);
        };
        const app = await listenAttendanceRouter({ applyAttendanceImport, withIdempotency });
        const body = { previewId: PREVIEW_ID, selectedRowIds: [READY_ROW_ID] };
        try {
            const noIntegration = await postJson(app.baseUrl, '/api/hermes/attendance/apply', body);
            assert.equal(noIntegration.status, 400);
            assert.equal(noIntegration.data.code, 'HERMES_INTEGRATION_ID_REQUIRED');

            const noIdempotency = await postJson(app.baseUrl, '/api/hermes/attendance/apply', body, {
                'x-integration-id': HERMES_INTEGRATION_ID
            });
            assert.equal(noIdempotency.status, 400);
            assert.equal(noIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

            const noConfirmation = await postJson(app.baseUrl, '/api/hermes/attendance/apply', body, {
                'x-integration-id': HERMES_INTEGRATION_ID,
                'idempotency-key': 'attendance-route-unit-key'
            });
            assert.equal(noConfirmation.status, 400);
            assert.equal(noConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(applyCalls, 0);
        } finally {
            await close(app.server);
        }
    });

    it('applies a sealed preview through idempotency and broadcasts only after the transaction callback', async () => {
        const events = [];
        let cachedResult = null;
        const applyAttendanceImport = async (db, body, options) => {
            events.push('apply');
            assert.equal(db.transactional, true);
            assert.deepEqual(body, { previewId: PREVIEW_ID, selectedRowIds: [READY_ROW_ID] });
            assert.equal(options.actorUserId, 42);
            assert.equal(options.businessContext, 'event_genix');
            assert.equal(options.integrationId, HERMES_INTEGRATION_ID);
            return {
                response: {
                    success: true,
                    attendanceWrites: 1,
                    scheduleWrites: 0,
                    scheduleTouched: false
                },
                changes: [{
                    businessContext: 'event_genix',
                    date: '2026-07-15',
                    staffId: 101,
                    attendanceRecordId: 8801,
                    status: 'late'
                }]
            };
        };
        const withIdempotency = async (_req, res, work, options) => {
            assert.equal(options.transactional, true);
            assert.equal(options.requestPath, '/api/hermes/attendance/apply');
            if (cachedResult) {
                events.push('replay');
                return res.status(cachedResult.status).json(cachedResult.body);
            }
            const context = { pool: { transactional: true }, afterCommit: [] };
            const result = await work(context);
            events.push('commit');
            for (const callback of context.afterCommit) await callback();
            cachedResult = result;
            return res.status(result.status).json(result.body);
        };
        const broadcastAttendanceChanges = (changes, actorUserId) => {
            events.push('broadcast');
            assert.equal(changes.length, 1);
            assert.equal(actorUserId, null);
        };
        const app = await listenAttendanceRouter({
            applyAttendanceImport,
            withIdempotency,
            broadcastAttendanceChanges
        });
        try {
            const response = await postJson(
                app.baseUrl,
                '/api/hermes/attendance/apply',
                { previewId: PREVIEW_ID, selectedRowIds: [READY_ROW_ID] },
                {
                    'x-integration-id': HERMES_INTEGRATION_ID,
                    'idempotency-key': 'attendance-route-unit-key-success',
                    'x-hermes-user-confirmed': 'true'
                }
            );

            assert.equal(response.status, 200);
            assert.equal(response.data.attendanceWrites, 1);
            assert.equal(response.data.scheduleWrites, 0);
            assert.deepEqual(events, ['apply', 'commit', 'broadcast']);

            const replay = await postJson(
                app.baseUrl,
                '/api/hermes/attendance/apply',
                { previewId: PREVIEW_ID, selectedRowIds: [READY_ROW_ID] },
                {
                    'x-integration-id': HERMES_INTEGRATION_ID,
                    'idempotency-key': 'attendance-route-unit-key-success',
                    'x-hermes-user-confirmed': 'true'
                }
            );
            assert.deepEqual(replay.data, response.data);
            assert.deepEqual(events, ['apply', 'commit', 'broadcast', 'replay']);
        } finally {
            await close(app.server);
        }
    });
});
