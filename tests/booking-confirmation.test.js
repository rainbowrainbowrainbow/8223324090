const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/bookingVisibility',
        '../services/telegram',
        '../services/bookingAutomation',
        '../services/websocket',
        '../services/eventBus',
        '../routes/dashboard',
        '../routes/bookings'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function bookingRow(overrides = {}) {
    return {
        id: 'BK-2099-0001',
        date: '2099-05-14',
        time: '16:00',
        line_id: 'line-1',
        program_id: 'custom',
        program_code: 'TEST',
        label: 'Preliminary booking',
        program_name: 'Test program',
        category: 'custom',
        duration: 60,
        price: 1000,
        hosts: null,
        second_animator: null,
        pinata_filler: null,
        costume: null,
        room: 'Room A',
        notes: null,
        created_by: 'tester',
        created_at: '2099-05-01T10:00:00.000Z',
        linked_to: null,
        status: 'preliminary',
        kids_count: null,
        updated_at: '2099-05-01T10:00:00.000Z',
        group_name: null,
        extra_data: null,
        skip_notification: false,
        customer_id: null,
        payment_method: null,
        certificate_id: null,
        confirmed_at: null,
        confirmed_by: null,
        confirmation_note: null,
        confirmation_source: null,
        ...overrides
    };
}

function makeDb(initialRows) {
    const state = {
        rows: initialRows.map(row => ({ ...row })),
        tx: [],
        histories: [],
        released: 0
    };

    const normalizeContext = value => {
        const raw = String(value || 'event_genix').trim().toLowerCase();
        return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
    };

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
            state.tx.push(sql);
            return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM bookings WHERE id = \$1(?: AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)? FOR UPDATE/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            return {
                rows: state.rows.filter(row =>
                    row.id === params[0] &&
                    (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
                )
            };
        }
        if (/UPDATE bookings SET status = 'confirmed'/i.test(sql)) {
            const [confirmedBy, note, source, id, businessContext] = params;
            const preliminaryOnly = /status = 'preliminary'/i.test(sql);
            const updated = [];
            for (const row of state.rows) {
                if ((row.id === id || row.linked_to === id) &&
                    (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext)) &&
                    (!preliminaryOnly || row.status === 'preliminary')) {
                    row.status = 'confirmed';
                    row.confirmed_at = '2099-05-14T13:20:00.000Z';
                    row.confirmed_by = confirmedBy;
                    row.confirmation_note = note;
                    row.confirmation_source = source;
                    row.updated_at = '2099-05-14T13:20:00.000Z';
                    updated.push({ ...row });
                }
            }
            return { rows: updated, rowCount: updated.length };
        }
        if (/UPDATE bookings SET status = 'preliminary'/i.test(sql)) {
            const [id, businessContext] = params;
            const updated = [];
            for (const row of state.rows) {
                const status = String(row.status || 'confirmed').trim().toLowerCase() || 'confirmed';
                if ((row.id === id || row.linked_to === id) &&
                    (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext)) &&
                    status !== 'cancelled' &&
                    status !== 'preliminary') {
                    row.status = 'preliminary';
                    row.confirmed_at = null;
                    row.confirmed_by = null;
                    row.confirmation_note = null;
                    row.confirmation_source = null;
                    row.updated_at = '2099-05-14T13:30:00.000Z';
                    updated.push({ ...row });
                }
            }
            return { rows: updated, rowCount: updated.length };
        }
        if (/^INSERT INTO history/i.test(sql)) {
            const scoped = params.length === 4;
            state.histories.push({
                businessContext: scoped ? params[0] : 'event_genix',
                action: scoped ? params[1] : params[0],
                username: scoped ? params[2] : params[1],
                data: JSON.parse(scoped ? params[3] : params[2])
            });
            return { rows: [], rowCount: 1 };
        }
        if (/SELECT name FROM lines_by_date/i.test(sql)) return { rows: [{ name: 'Line One' }] };
        throw new Error(`Unexpected booking confirmation query: ${sql}`);
    }

    const pool = {
        query,
        connect: async () => ({
            query,
            release: () => { state.released += 1; }
        })
    };
    return { pool, state };
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function request(baseUrl, id = 'BK-2099-0001', role = 'manager', body = {}) {
    const res = await fetch(`${baseUrl}/api/bookings/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': role },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function requestPreliminary(baseUrl, id = 'BK-2099-0001', role = 'manager', body = {}) {
    const res = await fetch(`${baseUrl}/api/bookings/${encodeURIComponent(id)}/preliminary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': role },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function withApp(rows, fn) {
    clearModules();
    const { pool, state } = makeDb(rows);
    const sideEffects = { automation: [], broadcasts: [], events: [], notifications: [] };
    installMock('../db', { pool, generateBookingNumber: async () => 'BK-2099-9999' });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 17, username: 'manager-user', name: 'Manager User', role: req.get('x-role') || 'manager' };
            next();
        },
        requireAction: () => (req, res, next) => {
            if (req.user.role === 'waiter') return res.status(403).json({ error: 'Forbidden' });
            next();
        }
    });
    installMock('../services/telegram', {
        notifyTelegram: async (...args) => { sideEffects.notifications.push(args); }
    });
    installMock('../services/bookingAutomation', {
        processBookingAutomation: async booking => { sideEffects.automation.push(booking); }
    });
    installMock('../services/websocket', {
        broadcast: (...args) => { sideEffects.broadcasts.push(args); }
    });
    installMock('../services/eventBus', {
        publish: (...args) => { sideEffects.events.push(args); }
    });
    installMock('../routes/dashboard', { triggerAlertBroadcast: () => null });

    const app = express();
    app.use(express.json());
    app.use('/api/bookings', require('../routes/bookings'));
    const { server, baseUrl } = await listen(app);
    try {
        await fn({ baseUrl, state, sideEffects });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('POST /api/bookings/:id/confirm confirms preliminary booking with accountability fields and audit history', async () => {
    await withApp([
        bookingRow(),
        bookingRow({ id: 'BK-2099-0002', linked_to: 'BK-2099-0001' })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await request(baseUrl, 'BK-2099-0001', 'manager', { source: 'queue', note: 'client confirmed by phone' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.booking.status, 'confirmed');
        assert.equal(res.data.booking.confirmedBy, 17);
        assert.equal(res.data.booking.confirmationSource, 'queue');
        assert.equal(state.rows[0].status, 'confirmed');
        assert.equal(state.rows[1].status, 'confirmed');
        assert.equal(state.histories.length, 1);
        assert.equal(state.histories[0].action, 'booking_confirmed');
        assert.equal(state.histories[0].data.action_type, 'booking_confirmed');
        assert.equal(state.histories[0].data.actor_user_id, 17);
        assert.equal(state.histories[0].data.meta.source, 'queue');
        assert.equal(sideEffects.automation.length, 1);
        assert.equal(sideEffects.automation[0]._event, 'confirm');
        assert.equal(sideEffects.broadcasts.length, 2);
        assert.equal(sideEffects.events[0][0], 'booking.confirmed');
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });
});

test('POST /api/bookings/:id/confirm does not revive cancelled linked bookings', async () => {
    await withApp([
        bookingRow(),
        bookingRow({ id: 'BK-2099-0002', linked_to: 'BK-2099-0001', status: 'cancelled' })
    ], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, 'BK-2099-0001', 'manager', { source: 'queue' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(state.rows[0].status, 'confirmed');
        assert.equal(state.rows[1].status, 'cancelled');
        assert.equal(res.data.cascade.confirmedCount, 1);
        assert.equal(state.histories[0].businessContext, 'event_genix');
    });
});

test('POST /api/bookings/:id/confirm is idempotent for already confirmed bookings', async () => {
    await withApp([
        bookingRow({ status: 'confirmed', confirmed_at: '2099-05-14T12:00:00.000Z', confirmed_by: 12 })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await request(baseUrl, 'BK-2099-0001', 'manager', { source: 'dashboard' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action.idempotent, true);
        assert.equal(res.data.action.durableMutation, false);
        assert.equal(state.histories.length, 0);
        assert.equal(sideEffects.automation.length, 0);
        assert.equal(sideEffects.events.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });
});

test('POST /api/bookings/:id/confirm blocks unauthorized actors before mutation', async () => {
    await withApp([bookingRow()], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, 'BK-2099-0001', 'waiter', { source: 'queue' });

        assert.equal(res.status, 403);
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.histories.length, 0);
    });
});

test('POST /api/bookings/:id/confirm fails closed when object-level booking scope is hidden', async () => {
    await withApp([bookingRow({ created_by: 'someone-else' })], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, 'BK-2099-0001', 'animator', { source: 'queue' });

        assert.equal(res.status, 404, JSON.stringify(res.data));
        assert.equal(res.data.error, 'Booking not found');
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.histories.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});

test('POST /api/bookings/:id/preliminary marks confirmed booking and active linked children preliminary', async () => {
    await withApp([
        bookingRow({
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:00:00.000Z',
            confirmed_by: 12,
            confirmation_note: 'old root note',
            confirmation_source: 'queue'
        }),
        bookingRow({
            id: 'BK-2099-0002',
            linked_to: 'BK-2099-0001',
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:01:00.000Z',
            confirmed_by: 12,
            confirmation_note: 'old child note',
            confirmation_source: 'queue'
        }),
        bookingRow({
            id: 'BK-2099-0003',
            linked_to: 'BK-2099-0001',
            status: 'cancelled',
            confirmed_at: '2099-05-14T12:02:00.000Z',
            confirmed_by: 12,
            confirmation_note: 'cancelled child note',
            confirmation_source: 'queue'
        })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-2099-0001', 'manager', {
            source: 'booking_panel',
            note: 'client is not ready'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.booking.status, 'preliminary');
        assert.equal(res.data.action.type, 'booking_marked_preliminary');
        assert.equal(res.data.action.durableMutation, true);
        assert.equal(res.data.cascade.markedPreliminaryCount, 2);
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.rows[0].confirmed_at, null);
        assert.equal(state.rows[0].confirmed_by, null);
        assert.equal(state.rows[0].confirmation_note, null);
        assert.equal(state.rows[0].confirmation_source, null);
        assert.equal(state.rows[1].status, 'preliminary');
        assert.equal(state.rows[1].confirmed_at, null);
        assert.equal(state.rows[1].confirmed_by, null);
        assert.equal(state.rows[1].confirmation_note, null);
        assert.equal(state.rows[1].confirmation_source, null);
        assert.equal(state.rows[2].status, 'cancelled');
        assert.equal(state.rows[2].confirmed_at, '2099-05-14T12:02:00.000Z');
        assert.equal(state.histories.length, 1);
        assert.equal(state.histories[0].action, 'booking_marked_preliminary');
        assert.equal(state.histories[0].data.action_type, 'booking_marked_preliminary');
        assert.equal(state.histories[0].data.actor_user_id, 17);
        assert.equal(state.histories[0].data.meta.from_status, 'confirmed');
        assert.equal(state.histories[0].data.meta.to_status, 'preliminary');
        assert.equal(state.histories[0].data.meta.source, 'booking_panel');
        assert.equal(state.histories[0].data.meta.note, 'client is not ready');
        assert.equal(sideEffects.automation.length, 0);
        assert.equal(sideEffects.notifications.length, 0);
        assert.equal(sideEffects.broadcasts.length, 2);
        assert.equal(sideEffects.events.length, 1);
        assert.equal(sideEffects.events[0][0], 'booking.status_changed');
        assert.equal(sideEffects.events[0][1].old_status, 'confirmed');
        assert.equal(sideEffects.events[0][1].new_status, 'preliminary');
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });
});

test('POST /api/bookings/:id/preliminary resolves linked child id to root booking group', async () => {
    await withApp([
        bookingRow({
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:00:00.000Z',
            confirmed_by: 12
        }),
        bookingRow({
            id: 'BK-2099-0002',
            linked_to: 'BK-2099-0001',
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:01:00.000Z',
            confirmed_by: 12
        }),
        bookingRow({
            id: 'BK-2099-0003',
            linked_to: 'BK-2099-0001',
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:02:00.000Z',
            confirmed_by: 12
        })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-2099-0002', 'manager', { source: 'booking_panel' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.booking.id, 'BK-2099-0001');
        assert.equal(res.data.cascade.markedPreliminaryCount, 3);
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.rows[1].status, 'preliminary');
        assert.equal(state.rows[2].status, 'preliminary');
        assert.equal(state.histories[0].data.entity_id, 'BK-2099-0001');
        assert.equal(sideEffects.broadcasts.length, 3);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });
});

test('POST /api/bookings/:id/preliminary is idempotent for already preliminary bookings', async () => {
    await withApp([
        bookingRow({ status: 'preliminary' })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-2099-0001', 'manager', { source: 'dashboard' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action.idempotent, true);
        assert.equal(res.data.action.durableMutation, false);
        assert.equal(res.data.cascade.markedPreliminaryCount, 0);
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.histories.length, 0);
        assert.equal(sideEffects.automation.length, 0);
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.equal(sideEffects.events.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });
});

test('POST /api/bookings/:id/preliminary rejects cancelled bookings without mutation', async () => {
    await withApp([
        bookingRow({
            status: 'cancelled',
            confirmed_at: '2099-05-14T12:00:00.000Z',
            confirmed_by: 12,
            confirmation_note: 'cancelled root note',
            confirmation_source: 'queue'
        }),
        bookingRow({
            id: 'BK-2099-0002',
            linked_to: 'BK-2099-0001',
            status: 'confirmed',
            confirmed_at: '2099-05-14T12:01:00.000Z',
            confirmed_by: 12
        })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-2099-0001', 'manager', { source: 'queue' });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.currentStatus, 'cancelled');
        assert.equal(state.rows[0].status, 'cancelled');
        assert.equal(state.rows[0].confirmed_at, '2099-05-14T12:00:00.000Z');
        assert.equal(state.rows[1].status, 'confirmed');
        assert.equal(state.histories.length, 0);
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.equal(sideEffects.events.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});
