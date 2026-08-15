'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    TrustedQaRunError,
    cleanupTrustedQaRun,
    createTrustedQaRun,
    endpointAllowed,
    prepareTrustedQaBookingInput,
    qaPublicDetails,
    registerQaEntity,
    requestEndpointKey,
    runTrustedQaCleanupWatchdog,
    sha256
} = require('../services/trustedQaRuns');

function makeReq({
    token = '',
    requestId = 'qa-request-1',
    path = '/api/bookings',
    method = 'POST',
    userId = 7,
    body = {}
} = {}) {
    const headers = new Map();
    if (token) headers.set('x-disposable-qa-token', token);
    if (requestId) headers.set('x-qa-run-request-id', requestId);
    return {
        method,
        path,
        baseUrl: '',
        body,
        user: { id: userId, username: `user-${userId}` },
        get(name) {
            return headers.get(String(name || '').toLowerCase()) || '';
        }
    };
}

function makeRun(overrides = {}) {
    return {
        id: 11,
        run_id: 'qa-run-11',
        token_hash: sha256('valid-token'),
        source: 'trusted_qa',
        business_context: 'event_genix',
        operator_user_id: 7,
        required_operator_user_id: 7,
        required_user_id: 7,
        required_customer_id: '101',
        required_program_id: '501',
        required_product_id: null,
        required_room_resource_id: 'room-qa',
        test_customer_marker: 'qa-test-customer',
        allowed_endpoints: ['POST /api/bookings'],
        max_entity_count: 3,
        state: 'active',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        cleanup_attempts: 0,
        ...overrides
    };
}

function makeBooking(overrides = {}) {
    return {
        id: 'BK-QA-1',
        customerId: 101,
        programId: 501,
        roomResourceId: 'room-qa',
        date: '2026-08-14',
        status: 'confirmed',
        ...overrides
    };
}

class FakeTrustedQaDb {
    constructor({
        token = 'valid-token',
        run = makeRun(),
        entities = [],
        entityCount = entities.length,
        failBookingCleanup = false,
        sideEffectTables = {}
    } = {}) {
        this.token = token;
        this.run = { ...run };
        this.entities = entities.map(row => ({ ...row }));
        this.entityCount = entityCount;
        this.failBookingCleanup = failBookingCleanup;
        this.sideEffectTables = { ...sideEffectTables };
        this.queries = [];
        this.tokenUses = new Set();
        this.cancelledBookingIds = [];
        this.cancelledGroupIds = [];
        this.bookingRows = this.entities
            .filter(row => row.entity_type === 'booking')
            .map(row => ({
                id: row.entity_id,
                business_context: this.run.business_context,
                status: 'confirmed',
                customer_id: this.run.required_customer_id,
                extra_data: {
                    disposableQa: {
                        runId: this.run.run_id,
                        source: this.run.source,
                        testCustomerMarker: this.run.test_customer_marker
                    }
                }
            }));
        this.groupRows = this.entities
            .filter(row => row.entity_type === 'banquet_group')
            .map(row => ({ id: row.entity_id, business_context: this.run.business_context, status: 'active' }));
        this.historyWrites = [];
        this.released = false;
    }

    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: normalized, params });

        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_runs')) {
            const row = {
                ...this.run,
                run_id: params[0],
                token_hash: params[1],
                source: params[2],
                business_context: params[3],
                max_entity_count: params[7],
                required_operator_user_id: params[9],
                required_user_id: params[10],
                required_customer_id: params[11],
                required_program_id: params[12],
                required_product_id: params[13],
                required_room_resource_id: params[14]
            };
            this.run = row;
            return { rows: [row], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_runs') && normalized.includes('token_hash = $1')) {
            const matches = params[0] === sha256(this.token)
                && params[1] === this.run.business_context
                && this.run.state === 'active';
            return { rows: matches ? [this.run] : [], rowCount: matches ? 1 : 0 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_run_token_uses')) {
            const key = `${params[0]}:${params[1]}`;
            if (this.tokenUses.has(key)) return { rows: [], rowCount: 0 };
            this.tokenUses.add(key);
            return { rows: [{ id: this.tokenUses.size }], rowCount: 1 };
        }
        if (normalized.includes('SET token_use_count')) {
            this.run.token_use_count = Number(this.run.token_use_count || 0) + 1;
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM trusted_qa_run_entities')) {
            return { rows: [{ count: this.entityCount }], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_run_entities')
            && normalized.includes('entity_type = $2')
            && normalized.includes('entity_id = $3')) {
            const match = this.entities.find(row => Number(row.run_id) === Number(params[0])
                && row.entity_type === params[1]
                && row.entity_id === params[2]);
            return { rows: match ? [{ id: match.id }] : [], rowCount: match ? 1 : 0 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_run_entities')) {
            this.entityCount += 1;
            this.entities.push({
                id: this.entities.length + 1,
                run_id: params[0],
                entity_type: params[1],
                entity_id: params[2],
                payload: JSON.parse(params[3]),
                cleanup_state: 'active'
            });
            return { rows: [{ id: this.entities.length }], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_runs') && normalized.includes('WHERE id = $1')) {
            return { rows: Number(params[0]) === Number(this.run.id) ? [this.run] : [], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_run_entities')) {
            return { rows: this.entities.filter(row => Number(row.run_id) === Number(params[0])), rowCount: this.entities.length };
        }
        if (normalized.includes('FROM bookings') && normalized.includes('FOR UPDATE')) {
            const ids = params[0] || [];
            const rows = this.bookingRows.filter(row => ids.includes(row.id));
            return { rows, rowCount: rows.length };
        }
        if (normalized.includes('FROM banquet_groups') && normalized.includes('FOR UPDATE')) {
            const ids = params[0] || [];
            const rows = this.groupRows.filter(row => ids.includes(row.id));
            return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith('SELECT id FROM tasks')) {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.startsWith('SELECT to_regclass')) {
            return {
                rows: [{ relation_name: Object.hasOwn(this.sideEffectTables, params[0]) ? params[0] : null }],
                rowCount: 1
            };
        }
        if (normalized.includes('FROM finance_transactions row_value')) {
            return { rows: [{ count: Number(this.sideEffectTables.finance_transactions || 0) }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE bookings SET status =')) {
            if (this.failBookingCleanup) {
                const err = new Error('simulated cleanup transport failure');
                err.code = 'SIMULATED_CLEANUP_FAILURE';
                throw err;
            }
            this.cancelledBookingIds.push(...params[0]);
            this.bookingRows = this.bookingRows.map(row => params[0].includes(row.id)
                ? { ...row, status: 'cancelled' }
                : row);
            return { rows: [], rowCount: params[0].length };
        }
        if (normalized.includes('UPDATE banquet_groups SET status =')) {
            this.cancelledGroupIds.push(...params[0]);
            this.groupRows = this.groupRows.map(row => params[0].includes(row.id)
                ? { ...row, status: 'cancelled' }
                : row);
            return { rows: [], rowCount: params[0].length };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM bookings')) {
            const count = this.bookingRows.filter(row => (params[0] || []).includes(row.id) && row.status !== 'cancelled').length;
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM banquet_groups')) {
            const count = this.groupRows.filter(row => (params[0] || []).includes(row.id) && row.status !== 'cancelled').length;
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE trusted_qa_run_entities SET cleanup_state')) {
            this.entities = this.entities.map(row => Number(row.run_id) === Number(params[0])
                ? { ...row, cleanup_state: 'cleaned' }
                : row);
            return { rows: [], rowCount: this.entities.length };
        }
        if (normalized.includes("SET state = 'cleaned'")) {
            this.run.state = 'cleaned';
            this.run.cleaned_at = this.run.cleaned_at || new Date().toISOString();
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes("WHERE state = 'cleanup_pending'")) {
            const selectable = this.run.state === 'cleanup_pending' && Number(this.run.cleanup_attempts || 0) < Number(params[0]);
            return { rows: selectable ? [this.run] : [], rowCount: selectable ? 1 : 0 };
        }
        if (normalized.includes('SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1')) {
            this.run.cleanup_attempts = Number(this.run.cleanup_attempts || 0) + 1;
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('cleanup_last_error = $2')) {
            this.run.cleanup_last_error = params[1];
            this.run.state = Number(this.run.cleanup_attempts || 0) >= Number(params[2]) ? 'blocked' : 'cleanup_pending';
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('INSERT INTO history')) {
            this.historyWrites.push(params);
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unhandled fake query: ${normalized}`);
    }

    release() {
        this.released = true;
    }
}

test('client-supplied disposable QA marker is rejected before any entity write', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq();
    const booking = makeBooking({
        extraData: {
            disposableQa: {
                schemaVersion: 1,
                runId: 'fake-run',
                source: 'timeline_browser_smoke',
                cleanupExpected: true,
                testCustomerMarker: 'fake',
                kind: 'booking',
                createdAt: new Date().toISOString()
            }
        }
    });

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, booking, 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_MARKER_UNTRUSTED'
    );
    assert.equal(db.queries.length, 0);
});

test('invalid token is rejected without registration or side-effect suppression', async () => {
    const db = new FakeTrustedQaDb({ token: 'other-token' });
    const req = makeReq({ token: 'invalid-token' });

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, makeBooking(), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_TOKEN_INVALID'
    );
    assert.equal(db.entities.length, 0);
});

test('client skipNotification flag is ignored without a trusted QA token', async () => {
    const db = new FakeTrustedQaDb();
    const booking = makeBooking({ skipNotification: true, skip_notification: true });
    const context = await prepareTrustedQaBookingInput(db, makeReq(), booking, 'event_genix');

    assert.equal(context.trusted, false);
    assert.equal(context.suppressSideEffects, false);
    assert.equal(booking.skipNotification, false);
    assert.equal(booking.skip_notification, false);
    assert.equal(db.queries.length, 0);
});

test('root booking route normalizes to the exact allowlisted endpoint without trailing slash', () => {
    const req = {
        method: 'POST',
        baseUrl: '/api/bookings',
        route: { path: '/' }
    };
    assert.equal(requestEndpointKey(req), 'POST /api/bookings');
    assert.equal(endpointAllowed(requestEndpointKey(req), ['POST /api/bookings']), true);
});

test('valid trusted QA token attaches server marker and consumes request id once', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq({ token: 'valid-token', requestId: 'req-1' });
    const booking = makeBooking();

    const context = await prepareTrustedQaBookingInput(db, req, booking, 'event_genix');

    assert.equal(context.trusted, true);
    assert.equal(context.suppressSideEffects, true);
    assert.equal(booking.skipNotification, true);
    assert.equal(booking.extraData.disposableQa.source, 'trusted_qa');
    assert.equal(booking.extraData.disposableQa.runId, 'qa-run-11');
    assert.equal(db.tokenUses.size, 1);
    assert.equal(db.queries.some(entry => entry.params.includes('valid-token')), false);
});

test('replayed QA request id is rejected', async () => {
    const db = new FakeTrustedQaDb();
    await prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'same-req' }), makeBooking(), 'event_genix');

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'same-req' }), makeBooking({ id: 'BK-QA-2' }), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_TOKEN_REPLAYED'
    );
});

test('child bookings reuse token but still must match exact QA constraints', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq({ token: 'valid-token', requestId: 'req-child' });
    await prepareTrustedQaBookingInput(db, req, makeBooking({ id: 'BK-QA-main' }), 'event_genix');

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, makeBooking({ id: 'BK-QA-child', roomResourceId: 'wrong-room' }), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_ROOM_MISMATCH'
    );
    assert.equal(db.tokenUses.size, 1);
});

test('registered entity IDs are stored atomically and enforce max count', async () => {
    const db = new FakeTrustedQaDb();
    const context = await prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'req-register' }), makeBooking(), 'event_genix');

    await registerQaEntity(db, context, 'booking', 'BK-QA-1', { businessContext: 'event_genix' });
    await registerQaEntity(db, context, 'booking', 'BK-QA-2', { businessContext: 'event_genix' });
    await registerQaEntity(db, context, 'booking', 'BK-QA-3', { businessContext: 'event_genix' });

    await assert.rejects(
        () => registerQaEntity(db, context, 'booking', 'BK-QA-4', { businessContext: 'event_genix' }),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_ENTITY_LIMIT_EXCEEDED'
    );
    assert.deepEqual(db.entities.map(row => row.entity_id), ['BK-QA-1', 'BK-QA-2', 'BK-QA-3']);
});

test('cleanup is exact-manifest driven, cancels registered bookings/groups and is idempotent', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' },
            { id: 2, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-2', cleanup_state: 'active' },
            { id: 3, run_id: 11, entity_type: 'banquet_group', entity_id: 'BQ-QA-1', cleanup_state: 'active' }
        ]
    });

    const first = await cleanupTrustedQaRun(db, 11);
    const second = await cleanupTrustedQaRun(db, 11);

    assert.equal(first.status, 'cleaned');
    assert.deepEqual(first.cleanedBookingIds, ['BK-QA-1', 'BK-QA-2']);
    assert.deepEqual(first.cleanedGroupIds, ['BQ-QA-1']);
    assert.deepEqual(db.cancelledBookingIds, ['BK-QA-1', 'BK-QA-2']);
    assert.deepEqual(db.cancelledGroupIds, ['BQ-QA-1']);
    assert.equal(db.entities.every(row => row.cleanup_state === 'cleaned'), true);
    assert.equal(second.idempotent, true);
});

test('watchdog retries cleanup_pending and blocks after bounded failures', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({ state: 'cleanup_pending', cleanup_attempts: 0 }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        failBookingCleanup: true
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 1 });

    assert.equal(result.processed, 1);
    assert.equal(result.runs[0].status, 'retry_scheduled');
    assert.equal(db.run.state, 'blocked');
    assert.match(db.run.cleanup_last_error, /simulated cleanup transport failure/);
});

test('cleanup fails closed when a persistent business side effect exists', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: { finance_transactions: 1 }
    });

    await assert.rejects(
        () => cleanupTrustedQaRun(db, 11),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_SIDE_EFFECT_BLOCKER'
    );
    assert.deepEqual(db.cancelledBookingIds, []);
    assert.equal(db.run.state, 'active');
});

test('createTrustedQaRun stores only token hash and returns raw token to caller', async () => {
    const db = new FakeTrustedQaDb();
    const { run, token } = await createTrustedQaRun(db, {
        token: 'operator-token',
        source: 'trusted_qa',
        businessContext: 'event_genix',
        operatorUserId: 7,
        requiredCustomerId: '101',
        requiredProgramId: '501',
        requiredRoomResourceId: 'room-qa',
        allowedEndpoints: ['POST /api/bookings']
    });

    assert.equal(token, 'operator-token');
    assert.equal(run.token_hash, sha256('operator-token'));
    assert.equal(db.queries.some(entry => entry.params.includes('operator-token')), false);
});

test('qaPublicDetails strips empty values from route-safe error payloads', () => {
    assert.deepEqual(
        qaPublicDetails({ code: 'x', empty: '', nullable: null, ok: 'yes' }),
        { code: 'x', ok: 'yes' }
    );
});
