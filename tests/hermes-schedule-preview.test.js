'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const express = require('express');
const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { createHermesScheduleRouter } = require('../routes/hermes-schedule');
const {
    normalizeHermesSchedulePreviewPayload,
    previewHermesScheduleImport
} = require('../services/hermesScheduleImport');

function createPreviewDb(options = {}) {
    const calls = [];
    let storedImport = null;
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/JOIN staff s/.test(sql) && /requested\.normalized_name/.test(sql)) {
                return { rows: options.candidates || [] };
            }
            if (/LEFT JOIN staff_schedule ss/.test(sql)) {
                return { rows: options.currentStates || [] };
            }
            if (/INSERT INTO hermes_schedule_imports/.test(sql)) {
                if (storedImport) return { rows: [] };
                storedImport = {
                    id: 1,
                    public_id: params[0],
                    business_context: params[1],
                    status: params[2],
                    source: params[3],
                    source_reference: JSON.parse(params[4]),
                    source_dedupe_key: params[5],
                    document_date: params[6],
                    extracted_rows: JSON.parse(params[7]),
                    preview_rows: JSON.parse(params[8]),
                    current_state_snapshot: JSON.parse(params[9]),
                    preview_hash: params[10],
                    expires_at: params[11],
                    created_by_user_id: params[12]
                };
                return { rows: [storedImport] };
            }
            if (/WHERE business_context = \$1[\s\S]*source_dedupe_key = \$2/.test(sql)) {
                return { rows: storedImport ? [storedImport] : [] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
}

function staffCandidate(rowIndex, overrides = {}) {
    return {
        row_index: rowIndex,
        id: 746 + rowIndex,
        name: 'Славицька Анна',
        display_name: 'Славицька Анна',
        department: 'admin',
        position: 'Адміністратор',
        role_type: 'administrator',
        secondary_professions: [],
        scheduleable: true,
        match_type: 'exact',
        ...overrides
    };
}

function telegramSource(messageId = '456') {
    return {
        telegram: {
            chatId: '-100123',
            messageId,
            fileUniqueId: 'schedule-photo-1'
        }
    };
}

function baseRow(overrides = {}) {
    return {
        employeeName: 'Славицька Анна',
        date: '2026-07-15',
        startTime: '10:00',
        endTime: '19:00',
        status: 'working',
        note: null,
        confidence: 0.98,
        issues: [],
        ...overrides
    };
}

describe('Hermes schedule OCR preview', () => {
    it('classifies conflict, inactive candidate, and invalid time without schedule writes', async () => {
        const db = createPreviewDb({
            candidates: [
                staffCandidate(0),
                staffCandidate(1, {
                    id: 901,
                    name: 'Франчук Артем',
                    display_name: 'Франчук Артем',
                    department: 'animators',
                    position: 'Аніматор',
                    role_type: 'animator',
                    scheduleable: false
                })
            ],
            currentStates: [{
                row_index: 0,
                staff_id: 746,
                requested_date: '2026-07-15',
                schedule_id: 3112,
                status: 'dayoff',
                shift_start: null,
                shift_end: null,
                note: null,
                profession_key: null
            }]
        });
        const startedAt = Date.now();
        const result = await previewHermesScheduleImport(db, {
            documentDate: '2026-07-13',
            sourceReference: telegramSource(),
            rows: [
                baseRow(),
                baseRow({ employeeName: 'Франчук Артем', startTime: '11:00', endTime: '20:00' }),
                baseRow({ employeeName: 'Пасенко Женя', startTime: '25:00', endTime: '20:00' })
            ]
        }, { actorUserId: 42, businessContext: 'event_genix' });

        assert.equal(result.scheduleWrites, 0);
        assert.equal(result.status, 'needs_review');
        assert.equal(result.summary.conflict, 1);
        assert.equal(result.summary.staff_not_found, 1);
        assert.equal(result.summary.invalid, 1);

        const conflict = result.rows[0];
        assert.equal(conflict.action, 'conflict');
        assert.equal(conflict.conflictReason, 'working_non_working_transition');
        assert.equal(conflict.expectedCurrentState.status, 'dayoff');
        assert.equal(conflict.proposedState.status, 'working');
        assert.match(conflict.stateHash, /^[a-f0-9]{64}$/);
        assert.match(conflict.rowId, /^hsr_[a-f0-9]{24}$/);

        const inactive = result.rows[1];
        assert.equal(inactive.action, 'staff_not_found');
        assert.deepEqual(Object.keys(inactive.candidate).sort(), [
            'department',
            'displayName',
            'matchType',
            'name',
            'position',
            'professions',
            'scheduleable',
            'staffId'
        ]);
        assert.equal(inactive.candidate.scheduleable, false);

        const invalid = result.rows[2];
        assert.equal(invalid.action, 'invalid');
        assert.equal('proposedState' in invalid, false);
        assert.ok(invalid.issues.some(issue => issue.code === 'HERMES_PREVIEW_TIME_INVALID'));

        const insertCall = db.calls.find(call => /INSERT INTO hermes_schedule_imports/.test(call.sql));
        const expiresAt = new Date(insertCall.params[11]).getTime();
        assert.ok(expiresAt >= startedAt + 29 * 60 * 1000);
        assert.ok(expiresAt <= Date.now() + 31 * 60 * 1000);
        assert.equal(db.calls.some(call => /(?:INSERT|UPDATE|DELETE)[\s\S]*(?:staff_schedule|hr_shifts)/i.test(call.sql)), false);
        const currentStateCall = db.calls.find(call => /LEFT JOIN staff_schedule ss/.test(call.sql));
        assert.match(currentStateCall.sql, /\$3::text\[\]/);
        assert.doesNotMatch(currentStateCall.sql, /\$3::date\[\]/);
    });

    it('returns ambiguous_staff for two scheduleable exact matches', async () => {
        const db = createPreviewDb({
            candidates: [
                staffCandidate(0, { id: 746 }),
                staffCandidate(0, { id: 999 })
            ]
        });
        const result = await previewHermesScheduleImport(db, {
            documentDate: '2026-07-13',
            sourceReference: telegramSource('457'),
            rows: [baseRow()]
        }, { actorUserId: 42 });

        assert.equal(result.rows[0].action, 'ambiguous_staff');
        assert.deepEqual(result.rows[0].candidates.map(candidate => candidate.staffId), [746, 999]);
        assert.equal(db.calls.some(call => /LEFT JOIN staff_schedule/.test(call.sql)), false);
    });

    it('uses normalized exact matching and replays the same immutable import session', async () => {
        const db = createPreviewDb({
            candidates: [staffCandidate(0, {
                id: 748,
                name: 'Пасенко Женя',
                display_name: 'Пасенко Женя',
                role_type: 'animator',
                match_type: 'normalized_exact'
            })],
            currentStates: [{
                row_index: 0,
                staff_id: 748,
                requested_date: '2026-07-15',
                schedule_id: 3113,
                status: 'working',
                shift_start: '12:00:00',
                shift_end: '19:00:00',
                note: null,
                profession_key: 'animator'
            }]
        });
        const input = {
            documentDate: '2026-07-13',
            sourceReference: telegramSource('458'),
            rows: [baseRow({
                employeeName: '  ПАСЕНКО   ЖЕНЯ ',
                startTime: '12:00',
                endTime: '20:00'
            })]
        };

        const first = await previewHermesScheduleImport(db, input, { actorUserId: 42 });
        const replay = await previewHermesScheduleImport(db, input, { actorUserId: 42 });

        assert.equal(first.rows[0].action, 'update');
        assert.equal(first.rows[0].matchType, 'normalized_exact');
        assert.equal(first.status, 'ready');
        assert.equal(replay.importId, first.importId);
        assert.equal(replay.rows[0].rowId, first.rows[0].rowId);
        assert.equal(replay.replayed, true);
        assert.equal(replay.scheduleWrites, 0);
    });

    it('classifies create, no_change, update, and conflict from CRM current state', async () => {
        const db = createPreviewDb({
            candidates: [0, 1, 2, 3].map(index => staffCandidate(index, {
                id: 800 + index,
                name: `Contract Staff ${index}`,
                display_name: `Contract Staff ${index}`
            })),
            currentStates: [
                {
                    row_index: 1,
                    staff_id: 801,
                    requested_date: '2026-07-15',
                    schedule_id: 3201,
                    status: 'working',
                    shift_start: '10:00:00',
                    shift_end: '19:00:00',
                    note: null,
                    profession_key: null
                },
                {
                    row_index: 2,
                    staff_id: 802,
                    requested_date: '2026-07-15',
                    schedule_id: 3202,
                    status: 'working',
                    shift_start: '09:00:00',
                    shift_end: '18:00:00',
                    note: null,
                    profession_key: null
                },
                {
                    row_index: 3,
                    staff_id: 803,
                    requested_date: '2026-07-15',
                    schedule_id: 3203,
                    status: 'dayoff',
                    shift_start: null,
                    shift_end: null,
                    note: null,
                    profession_key: null
                }
            ]
        });
        const result = await previewHermesScheduleImport(db, {
            documentDate: '2026-07-13',
            sourceReference: telegramSource('462'),
            rows: [0, 1, 2, 3].map(index => baseRow({ employeeName: `Contract Staff ${index}` }))
        }, { actorUserId: 42 });

        assert.deepEqual(result.rows.map(row => row.action), [
            'create',
            'no_change',
            'update',
            'conflict'
        ]);
        assert.equal(result.scheduleWrites, 0);
        assert.equal(result.status, 'needs_review');
    });

    it('marks invalid row dates, times, and statuses without attempting staff matching', () => {
        assert.throws(
            () => normalizeHermesSchedulePreviewPayload({
                documentDate: '2026-02-30',
                sourceReference: telegramSource('463'),
                rows: []
            }),
            error => error.code === 'HERMES_SCHEDULE_IMPORT_DATE_INVALID'
        );
        const payload = normalizeHermesSchedulePreviewPayload({
            documentDate: '2026-07-13',
            sourceReference: telegramSource('464'),
            rows: [baseRow({ date: 'not-a-date', status: 'holiday', startTime: '24:00', endTime: '18:00' })]
        });
        const codes = payload.rows[0].validationIssues.map(issue => issue.code);
        assert.ok(codes.includes('HERMES_PREVIEW_DATE_INVALID'));
        assert.ok(codes.includes('HERMES_PREVIEW_STATUS_INVALID'));
        assert.ok(codes.includes('HERMES_PREVIEW_TIME_INVALID'));
    });

    it('rejects photo payloads and more than 100 rows before database work', () => {
        assert.throws(
            () => normalizeHermesSchedulePreviewPayload({
                documentDate: '2026-07-13',
                sourceReference: telegramSource('459'),
                photo: 'data:image/jpeg;base64,abc',
                rows: []
            }),
            error => error.code === 'HERMES_SCHEDULE_PREVIEW_BINARY_FORBIDDEN'
        );
        assert.throws(
            () => normalizeHermesSchedulePreviewPayload({
                documentDate: '2026-07-13',
                sourceReference: telegramSource('460'),
                rows: Array.from({ length: 101 }, () => baseRow())
            }),
            error => error.code === 'HERMES_SCHEDULE_PREVIEW_ROWS_LIMIT'
        );
    });

    it('exposes the POST endpoint and always reports zero schedule writes', async () => {
        const db = createPreviewDb();
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.integration = {
                id: HERMES_INTEGRATION_ID,
                authMode: 'x-api-key',
                actorUserId: 42
            };
            req.user = { id: 42, businessContexts: ['event_genix'] };
            next();
        });
        app.use('/api/hermes', createHermesScheduleRouter({ pool: db }));
        const server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        try {
            const response = await fetch(
                `http://127.0.0.1:${server.address().port}/api/hermes/staff-schedule/preview`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        documentDate: '2026-07-13',
                        sourceReference: telegramSource('461'),
                        rows: []
                    })
                }
            );
            const body = await response.json();
            assert.equal(response.status, 201);
            assert.equal(body.scheduleWrites, 0);
            assert.deepEqual(body.rows, []);
        } finally {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    });
});
