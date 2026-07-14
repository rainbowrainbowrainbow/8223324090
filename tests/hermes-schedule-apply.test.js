'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const express = require('express');
const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { createHermesScheduleRouter } = require('../routes/hermes-schedule');

const PREVIEW_ID = 'hsi_1234567890abcdef';
const ROW_ID = 'hsr_aaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'b'.repeat(64);

function loadImportServiceWithMutationMocks(state) {
    const servicePath = require.resolve('../services/hermesScheduleImport');
    const mutationsPath = require.resolve('../services/staffScheduleMutations');
    const originalMutations = require.cache[mutationsPath];
    require.cache[mutationsPath] = {
        id: mutationsPath,
        filename: mutationsPath,
        loaded: true,
        exports: {
            lockScheduleStaffRows: async (_db, staffIds) => {
                state.calls.push(['lock-staff', staffIds]);
            },
            mutateStaffScheduleBatch: async (_db, entries, options) => {
                state.calls.push(['mutate-batch', entries, options]);
                return state.batchResult || {
                    ok: true,
                    count: entries.length,
                    staffIds: [746],
                    dates: ['2026-07-15'],
                    changes: entries.map(entry => ({
                        rowId: entry.rowId,
                        action: entry.action,
                        staffId: entry.staffId,
                        date: entry.date,
                        status: entry.status,
                        plan: {
                            status: entry.status,
                            plannedStart: entry.startTime,
                            plannedEnd: entry.endTime
                        }
                    })),
                    roster: []
                };
            },
            validateScheduleMutationTimes: () => ({ ok: true }),
            validateScheduleWriteStaff: async (_db, staffId, date) => {
                state.calls.push(['validate-staff', staffId, date]);
                return state.staffValidation || { ok: true };
            }
        }
    };
    delete require.cache[servicePath];
    const service = require(servicePath);
    delete require.cache[servicePath];
    if (originalMutations) require.cache[mutationsPath] = originalMutations;
    else delete require.cache[mutationsPath];
    return service;
}

function createApplyFixture(options = {}) {
    const state = { calls: [], ...options.state };
    const service = loadImportServiceWithMutationMocks(state);
    const current = options.currentState === undefined ? {
        scheduleId: 3112,
        staffId: 746,
        date: '2026-07-15',
        status: 'dayoff',
        startTime: null,
        endTime: null,
        note: null,
        professionKey: null
    } : options.currentState;
    const row = {
        rowId: ROW_ID,
        action: options.action || 'conflict',
        employeeName: 'Славицька Анна',
        date: '2026-07-15',
        proposedState: {
            staffId: 746,
            date: '2026-07-15',
            status: 'working',
            startTime: '10:00',
            endTime: '19:00',
            note: null,
            professionKey: null
        },
        expectedCurrentState: current,
        stateHash: current
            ? service.buildScheduleCellStateHash(current)
            : service.buildScheduleCellStateHash({ staffId: 746, date: '2026-07-15', status: null })
    };
    if (!current) {
        const crypto = require('node:crypto');
        row.stateHash = crypto.createHash('sha256').update(service.stableJsonStringify({
            staffId: 746,
            date: '2026-07-15',
            currentState: null
        })).digest('hex');
    }
    const importRow = {
        public_id: PREVIEW_ID,
        business_context: 'event_genix',
        status: options.importStatus || 'needs_review',
        document_date: '2026-07-13',
        preview_rows: options.previewRows || [row],
        preview_hash: PREVIEW_HASH,
        expires_at: options.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        apply_result: options.applyResult || null
    };
    const db = {
        queries: [],
        async query(sql, params = []) {
            this.queries.push({ sql, params });
            if (/FROM hermes_schedule_imports[\s\S]*FOR UPDATE/.test(sql)) return { rows: [importRow] };
            if (/FROM staff_schedule ss[\s\S]*FOR UPDATE OF ss/.test(sql)) {
                if (!options.liveCurrentState) return { rows: current ? [{
                    schedule_id: current.scheduleId,
                    staff_id: current.staffId,
                    date: current.date,
                    status: current.status,
                    shift_start: current.startTime,
                    shift_end: current.endTime,
                    note: current.note,
                    profession_key: current.professionKey
                }] : [] };
                const live = options.liveCurrentState;
                return { rows: [{
                    schedule_id: live.scheduleId,
                    staff_id: live.staffId,
                    date: live.date,
                    status: live.status,
                    shift_start: live.startTime,
                    shift_end: live.endTime,
                    note: live.note,
                    profession_key: live.professionKey
                }] };
            }
            if (/SET status = 'ready'/.test(sql)) return { rows: [{ ...importRow, status: 'ready' }] };
            if (/SET status = 'applied'/.test(sql)) return { rows: [{ ...importRow, status: 'applied' }] };
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
    return { state, service, db, row, importRow };
}

describe('Hermes schedule apply service', () => {
    it('rejects client-supplied mutation payloads and malformed conflict confirmations', () => {
        const { service } = createApplyFixture();
        assert.throws(
            () => service.normalizeHermesScheduleApplyBody({
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: [ROW_ID],
                proposedMutationPayload: { status: 'working' }
            }),
            error => error.code === 'HERMES_SCHEDULE_APPLY_BODY_FIELDS_INVALID'
        );
        assert.throws(
            () => service.normalizeHermesScheduleApplyBody({
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: ['hsr_bbbbbbbbbbbbbbbbbbbbbbbb']
            }),
            error => error.code === 'HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_INVALID'
        );
    });

    it('requires explicit confirmation for a selected conflict before locking staff', async () => {
        const { state, service, db } = createApplyFixture();
        await assert.rejects(
            service.applyHermesScheduleImport(db, {
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: []
            }, { actorUserId: 42 }),
            error => error.statusCode === 409
                && error.code === 'HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_REQUIRED'
        );
        assert.equal(state.calls.some(call => call[0] === 'lock-staff'), false);
        assert.equal(state.calls.some(call => call[0] === 'mutate-batch'), false);
    });

    it('rejects stale current state before any shared schedule mutation', async () => {
        const { state, service, db } = createApplyFixture({
            liveCurrentState: {
                scheduleId: 3112,
                staffId: 746,
                date: '2026-07-15',
                status: 'working',
                startTime: '09:00',
                endTime: '18:00',
                note: null,
                professionKey: null
            }
        });
        await assert.rejects(
            service.applyHermesScheduleImport(db, {
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: [ROW_ID]
            }, { actorUserId: 42 }),
            error => error.statusCode === 409 && error.code === 'HERMES_SCHEDULE_APPLY_STALE'
        );
        assert.equal(state.calls.some(call => call[0] === 'mutate-batch'), false);
        assert.equal(db.queries.some(query => /SET status = 'ready'|SET status = 'applied'/.test(query.sql)), false);
    });

    it('blocks a staff member who is no longer scheduleable', async () => {
        const fixture = createApplyFixture({
            state: {
                staffValidation: { ok: false, code: 'STAFF_TERMINATED' }
            }
        });
        await assert.rejects(
            fixture.service.applyHermesScheduleImport(fixture.db, {
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: [ROW_ID]
            }, { actorUserId: 42 }),
            error => error.statusCode === 409
                && error.code === 'HERMES_SCHEDULE_APPLY_STAFF_NOT_SCHEDULEABLE'
        );
        assert.equal(fixture.state.calls.some(call => call[0] === 'mutate-batch'), false);
    });

    it('rejects expired and already-applied previews before schedule mutation', async () => {
        const expired = createApplyFixture({ expiresAt: new Date(Date.now() - 1000).toISOString() });
        await assert.rejects(
            expired.service.applyHermesScheduleImport(expired.db, validApplyBody(), { actorUserId: 42 }),
            error => error.statusCode === 409 && error.code === 'HERMES_SCHEDULE_APPLY_PREVIEW_EXPIRED'
        );
        assert.equal(expired.state.calls.some(call => call[0] === 'mutate-batch'), false);

        const applied = createApplyFixture({ importStatus: 'applied' });
        await assert.rejects(
            applied.service.applyHermesScheduleImport(applied.db, validApplyBody(), { actorUserId: 42 }),
            error => error.statusCode === 409 && error.code === 'HERMES_SCHEDULE_IMPORT_ALREADY_APPLIED'
        );
        assert.equal(applied.state.calls.some(call => call[0] === 'mutate-batch'), false);
    });

    it('applies the immutable selected batch through the shared service and records audit metadata', async () => {
        const { state, service, db } = createApplyFixture();
        const result = await service.applyHermesScheduleImport(db, {
            previewId: PREVIEW_ID,
            selectedRowIds: [ROW_ID],
            conflictConfirmed: [ROW_ID]
        }, {
            actor: { user: { id: 42, username: 'hermes.qa' }, ip: '127.0.0.1' },
            actorUserId: 42,
            integrationId: HERMES_INTEGRATION_ID
        });

        assert.equal(result.response.status, 'applied');
        assert.equal(result.response.scheduleWrites, 1);
        const batchCall = state.calls.find(call => call[0] === 'mutate-batch');
        assert.equal(batchCall[1][0].rowId, ROW_ID);
        assert.equal(batchCall[1][0].status, 'working');
        assert.equal(batchCall[2].source, 'hermes.schedule_ocr');
        assert.equal(batchCall[2].sourceMetadata.previewId, PREVIEW_ID);
        assert.equal(batchCall[2].sourceMetadata.documentDate, '2026-07-13');
        assert.equal(batchCall[2].sourceMetadataForEntry(batchCall[1][0]).rowId, ROW_ID);
        const currentStateCall = db.queries.find(query => /FROM staff_schedule ss[\s\S]*FOR UPDATE OF ss/.test(query.sql));
        assert.match(currentStateCall.sql, /\$2::text\[\]/);
        assert.doesNotMatch(currentStateCall.sql, /\$2::date\[\]/);
        assert.match(db.queries.map(query => query.sql).join('\n'), /SET status = 'ready'/);
        assert.match(db.queries.map(query => query.sql).join('\n'), /SET status = 'applied'/);
    });

    it('raises a transaction-level failure when a batch reports a partial mutation error', async () => {
        const fixture = createApplyFixture({
            state: {
                batchResult: {
                    ok: false,
                    code: 'HR_SHIFT_PLAN_INVALID',
                    error: 'second row failed',
                    changes: [{ rowId: ROW_ID }]
                }
            }
        });
        await assert.rejects(
            fixture.service.applyHermesScheduleImport(fixture.db, {
                previewId: PREVIEW_ID,
                selectedRowIds: [ROW_ID],
                conflictConfirmed: [ROW_ID]
            }, { actorUserId: 42 }),
            error => error.statusCode === 500
                && error.code === 'HERMES_SCHEDULE_APPLY_TRANSACTION_FAILED'
        );
        assert.equal(fixture.db.queries.some(query => /SET status = 'applied'/.test(query.sql)), false);
    });
});

function createIdempotencyPool(state) {
    const records = new Map();
    const client = {
        async query(sql, params = []) {
            const compact = String(sql).trim();
            if (compact === 'BEGIN') {
                state.tx.push('BEGIN');
                state.committed = false;
                return { rows: [] };
            }
            if (compact === 'COMMIT') {
                state.tx.push('COMMIT');
                state.committed = true;
                return { rows: [] };
            }
            if (compact === 'ROLLBACK') {
                state.tx.push('ROLLBACK');
                state.committed = false;
                return { rows: [] };
            }
            if (/DELETE FROM integration_idempotency_keys/.test(sql)) return { rows: [] };
            if (/INSERT INTO integration_idempotency_keys/.test(sql)) {
                const key = `${params[0]}:${params[1]}`;
                if (records.has(key)) return { rows: [] };
                const record = {
                    id: records.size + 1,
                    integration_id: params[0],
                    idempotency_key: params[1],
                    request_hash: params[2],
                    response_status: null,
                    response_body: null,
                    created_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 3600000).toISOString()
                };
                records.set(key, record);
                return { rows: [record] };
            }
            if (/FROM integration_idempotency_keys/.test(sql)) {
                return { rows: [records.get(`${params[0]}:${params[1]}`)].filter(Boolean) };
            }
            if (/UPDATE integration_idempotency_keys/.test(sql)) {
                const record = records.get(`${params[0]}:${params[1]}`);
                if (!record || record.request_hash !== params[2] || record.response_status) return { rows: [] };
                record.response_status = params[3];
                record.response_body = JSON.parse(params[4]);
                return { rows: [record] };
            }
            throw new Error(`Unexpected idempotency SQL: ${sql}`);
        },
        release() {
            state.releases += 1;
        }
    };
    return {
        query: (...args) => client.query(...args),
        async connect() {
            return client;
        }
    };
}

async function listenApplyApp(options = {}) {
    const state = {
        applyCalls: 0,
        notifications: 0,
        broadcasts: 0,
        tx: [],
        releases: 0,
        committed: false
    };
    const pool = createIdempotencyPool(state);
    const actor = options.actor || {
        id: 42,
        username: 'hermes.qa',
        role: 'admin',
        action_allowlist: [],
        action_denylist: [],
        businessContexts: ['event_genix']
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.integration = {
            id: HERMES_INTEGRATION_ID,
            authMode: 'x-api-key',
            actorUserId: actor.id
        };
        req.user = actor;
        next();
    });
    app.use('/api/hermes', createHermesScheduleRouter({
        pool,
        applyScheduleImport: async () => {
            state.applyCalls += 1;
            if (options.applyError) throw options.applyError;
            return {
                response: {
                    success: true,
                    previewId: PREVIEW_ID,
                    status: 'applied',
                    selectedCount: 1,
                    appliedCount: 1,
                    noChangeCount: 0,
                    scheduleWrites: 1,
                    dates: ['2026-07-15'],
                    results: [{ rowId: ROW_ID, result: 'applied' }]
                },
                changes: [{
                    rowId: ROW_ID,
                    staffId: 746,
                    date: '2026-07-15',
                    status: 'working',
                    plan: { plannedStart: '10:00', plannedEnd: '19:00' }
                }],
                dates: ['2026-07-15']
            };
        },
        notifyScheduleBatch: async () => {
            assert.equal(state.committed, true);
            state.notifications += 1;
        },
        broadcastRosterDates: dates => {
            assert.equal(state.committed, true);
            assert.deepEqual(dates, ['2026-07-15']);
            state.broadcasts += 1;
        }
    }));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    return { server, state, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function applyRequest(baseUrl, body, headers = {}) {
    const response = await fetch(`${baseUrl}/api/hermes/staff-schedule/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
}

function validApplyBody() {
    return {
        previewId: PREVIEW_ID,
        selectedRowIds: [ROW_ID],
        conflictConfirmed: [ROW_ID]
    };
}

function validApplyHeaders(idempotencyKey = 'hermes-apply-1') {
    return {
        'X-Hermes-User-Confirmed': 'true',
        'Idempotency-Key': idempotencyKey,
        'X-Integration-Id': HERMES_INTEGRATION_ID
    };
}

describe('Hermes schedule apply route safety', () => {
    it('requires confirmation, idempotency, and the exact integration id headers', async () => {
        const fixture = await listenApplyApp();
        try {
            const missingIntegration = await applyRequest(fixture.baseUrl, validApplyBody(), {
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'headers-1'
            });
            assert.equal(missingIntegration.status, 400);
            assert.equal(missingIntegration.data.code, 'HERMES_INTEGRATION_ID_REQUIRED');

            const missingConfirmation = await applyRequest(fixture.baseUrl, validApplyBody(), {
                'Idempotency-Key': 'headers-2',
                'X-Integration-Id': HERMES_INTEGRATION_ID
            });
            assert.equal(missingConfirmation.status, 400);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');

            const missingIdempotency = await applyRequest(fixture.baseUrl, validApplyBody(), {
                'X-Hermes-User-Confirmed': 'true',
                'X-Integration-Id': HERMES_INTEGRATION_ID
            });
            assert.equal(missingIdempotency.status, 400);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fixture.state.applyCalls, 0);
        } finally {
            await new Promise(resolve => fixture.server.close(resolve));
        }
    });

    it('does not grant manage_staff to the Hermes actor automatically', async () => {
        const fixture = await listenApplyApp({
            actor: {
                id: 42,
                username: 'hermes.reader',
                role: 'employee',
                action_allowlist: [],
                action_denylist: ['manage_staff'],
                businessContexts: ['event_genix']
            }
        });
        try {
            const response = await applyRequest(
                fixture.baseUrl,
                validApplyBody(),
                validApplyHeaders('permission-1')
            );
            assert.equal(response.status, 403);
            assert.equal(response.data.code, 'HERMES_MANAGE_STAFF_REQUIRED');
            assert.equal(fixture.state.applyCalls, 0);
        } finally {
            await new Promise(resolve => fixture.server.close(resolve));
        }
    });

    it('applies once, replays the previous result, and runs one post-commit summary', async () => {
        const fixture = await listenApplyApp();
        try {
            const headers = validApplyHeaders('repeat-apply-1');
            const first = await applyRequest(fixture.baseUrl, validApplyBody(), headers);
            const replay = await applyRequest(fixture.baseUrl, validApplyBody(), headers);

            assert.equal(first.status, 200, JSON.stringify(first.data));
            assert.deepEqual(replay.data, first.data);
            assert.equal(fixture.state.applyCalls, 1);
            assert.equal(fixture.state.notifications, 1);
            assert.equal(fixture.state.broadcasts, 1);
            assert.equal(fixture.state.tx.filter(value => value === 'COMMIT').length, 2);
            assert.equal(fixture.state.tx.includes('ROLLBACK'), false);
        } finally {
            await new Promise(resolve => fixture.server.close(resolve));
        }
    });

    it('rolls back the transaction when apply fails after entering mutation work', async () => {
        const fixture = await listenApplyApp({ applyError: new Error('database write failed') });
        try {
            const response = await applyRequest(
                fixture.baseUrl,
                validApplyBody(),
                validApplyHeaders('rollback-apply-1')
            );
            assert.equal(response.status, 500);
            assert.equal(fixture.state.tx.includes('COMMIT'), false);
            assert.equal(fixture.state.tx.includes('ROLLBACK'), true);
            assert.equal(fixture.state.notifications, 0);
            assert.equal(fixture.state.broadcasts, 0);
        } finally {
            await new Promise(resolve => fixture.server.close(resolve));
        }
    });
});
