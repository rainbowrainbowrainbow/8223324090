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
        id: 'BK-STATUS-ROOT',
        business_context: 'event_genix',
        date: '2099-05-14',
        time: '12:00',
        line_id: 'line-1',
        program_id: 'custom',
        program_code: 'BANQ',
        label: 'Banquet root',
        program_name: 'Banquet root',
        category: 'banquet',
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
        status: 'confirmed',
        kids_count: null,
        updated_at: '2099-05-01T10:00:00.000Z',
        group_name: 'legacy group name must not drive status',
        extra_data: null,
        skip_notification: false,
        customer_id: 501,
        payment_method: null,
        certificate_id: null,
        confirmed_at: '2099-05-14T10:00:00.000Z',
        confirmed_by: 12,
        confirmation_note: 'confirmed',
        confirmation_source: 'queue',
        ...overrides
    };
}

function membership(overrides = {}) {
    return {
        group_id: 'BQ-STATUS',
        business_context: 'event_genix',
        booking_id: 'BK-STATUS-ROOT',
        role: 'primary',
        sort_order: 10,
        ...overrides
    };
}

function makeDb(rows, banquetMemberships = []) {
    const state = {
        rows: rows.map(row => ({ ...row })),
        banquetMemberships: banquetMemberships.map(row => ({ ...row })),
        histories: [],
        queries: [],
        tx: [],
        released: 0
    };

    const normalizeContext = value => {
        const raw = String(value || 'event_genix').trim().toLowerCase();
        return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
    };

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        state.queries.push({ sql, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
            state.tx.push(sql);
            return { rows: [], rowCount: 0 };
        }
        if (/FROM banquet_group_bookings bgb JOIN banquet_groups bg/i.test(sql)) {
            const [bookingId, businessContext] = params;
            const row = state.banquetMemberships.find(item => (
                item.booking_id === bookingId
                && normalizeContext(item.business_context) === normalizeContext(businessContext)
            ));
            return {
                rows: row ? [{
                    ...row,
                    primary_booking_id: 'BK-STATUS-ROOT',
                    group_status: 'active'
                }] : [],
                rowCount: row ? 1 : 0
            };
        }
        if (/SELECT \* FROM bookings WHERE id = \$1[\s\S]*FOR UPDATE$/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            const row = state.rows.find(item =>
                item.id === params[0] &&
                (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/UPDATE bookings SET status = 'preliminary'/i.test(sql)) {
            const [rootId, businessContext] = params;
            const updated = [];
            for (const row of state.rows) {
                const status = String(row.status || 'confirmed').trim().toLowerCase() || 'confirmed';
                if ((row.id === rootId || row.linked_to === rootId) &&
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
        throw new Error(`Unexpected booking status action query: ${sql}`);
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

async function requestPreliminary(baseUrl, id, body = {}) {
    const res = await fetch(`${baseUrl}/api/bookings/${encodeURIComponent(id)}/preliminary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'manager' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function requestConfirm(baseUrl, id, body = {}) {
    const res = await fetch(`${baseUrl}/api/bookings/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'manager' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function withApp(rows, banquetMemberships, fn) {
    clearModules();
    const { pool, state } = makeDb(rows, banquetMemberships);
    const sideEffects = { broadcasts: [], events: [], notifications: [], automation: [] };
    installMock('../db', { pool, generateBookingNumber: async () => 'BK-STATUS-9999' });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 17, username: 'manager-user', name: 'Manager User', role: req.get('x-role') || 'manager' };
            next();
        },
        requireAction: () => (_req, _res, next) => next()
    });
    installMock('../services/telegram', {
        notifyTelegram: async (...args) => { sideEffects.notifications.push(args); }
    });
    installMock('../services/bookingAutomation', {
        processBookingAutomation: async booking => { sideEffects.automation.push(booking); }
    });
    installMock('../services/websocket', {
        broadcastBookingEvent: (...args) => { sideEffects.broadcasts.push(args); }
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

test('active banquet root status must be changed through atomic booking-set', async () => {
    await withApp([
        bookingRow({ id: 'BK-STATUS-ROOT', status: 'confirmed' }),
        bookingRow({ id: 'BK-STATUS-TECH', linked_to: 'BK-STATUS-ROOT', status: 'confirmed', label: 'Technical child' }),
        bookingRow({ id: 'BK-STATUS-KITCHEN', status: 'confirmed', label: 'Kitchen member', category: 'kitchen' }),
        bookingRow({ id: 'BK-STATUS-ACTIVITY', status: 'confirmed', label: 'Activity member', category: 'activity', price: 700 }),
        bookingRow({ id: 'BK-STATUS-CANCELLED', status: 'cancelled', label: 'Cancelled member', category: 'activity' })
    ], [
        membership({ booking_id: 'BK-STATUS-ROOT', role: 'primary' }),
        membership({ booking_id: 'BK-STATUS-KITCHEN', role: 'kitchen', sort_order: 20 }),
        membership({ booking_id: 'BK-STATUS-ACTIVITY', role: 'activity', sort_order: 30 }),
        membership({ booking_id: 'BK-STATUS-CANCELLED', role: 'activity', sort_order: 40 })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-STATUS-ROOT', { source: 'booking_panel' });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.code, 'BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-ROOT').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-TECH').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-KITCHEN').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-ACTIVITY').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-CANCELLED').status, 'cancelled');
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.equal(sideEffects.events.length, 0);
        assert.equal(state.histories.length, 0);
        assert.ok(state.queries.some(query => /banquet_group_bookings/i.test(query.sql)));
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});

test('active banquet activity status also requires atomic booking-set', async () => {
    await withApp([
        bookingRow({ id: 'BK-STATUS-ROOT', status: 'confirmed' }),
        bookingRow({ id: 'BK-STATUS-KITCHEN', status: 'confirmed', label: 'Kitchen member', category: 'kitchen' }),
        bookingRow({ id: 'BK-STATUS-ACTIVITY', status: 'confirmed', label: 'Activity member', category: 'activity', price: 700 })
    ], [
        membership({ booking_id: 'BK-STATUS-ROOT', role: 'primary' }),
        membership({ booking_id: 'BK-STATUS-KITCHEN', role: 'kitchen', sort_order: 20 }),
        membership({ booking_id: 'BK-STATUS-ACTIVITY', role: 'activity', sort_order: 30 })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-STATUS-ACTIVITY', { source: 'booking_panel' });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.code, 'BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-ROOT').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-KITCHEN').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-ACTIVITY').status, 'confirmed');
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});

test('active banquet preliminary booking cannot be confirmed outside atomic booking-set', async () => {
    await withApp([
        bookingRow({
            id: 'BK-STATUS-ROOT',
            status: 'preliminary',
            confirmed_at: null,
            confirmed_by: null
        })
    ], [
        membership({ booking_id: 'BK-STATUS-ROOT', role: 'primary' })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestConfirm(baseUrl, 'BK-STATUS-ROOT', {
            source: 'booking_panel'
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.code, 'BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT');
        assert.equal(state.rows[0].status, 'preliminary');
        assert.equal(state.histories.length, 0);
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});

test('cancelled banquet member cannot be restored by mark preliminary', async () => {
    await withApp([
        bookingRow({ id: 'BK-STATUS-ROOT', status: 'confirmed' }),
        bookingRow({ id: 'BK-STATUS-CANCELLED', status: 'cancelled', label: 'Cancelled member', category: 'activity' })
    ], [
        membership({ booking_id: 'BK-STATUS-ROOT', role: 'primary' }),
        membership({ booking_id: 'BK-STATUS-CANCELLED', role: 'activity', sort_order: 20 })
    ], async ({ baseUrl, state, sideEffects }) => {
        const res = await requestPreliminary(baseUrl, 'BK-STATUS-CANCELLED', { source: 'booking_panel' });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.currentStatus, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-ROOT').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-STATUS-CANCELLED').status, 'cancelled');
        assert.equal(state.histories.length, 0);
        assert.equal(sideEffects.broadcasts.length, 0);
        assert.equal(sideEffects.events.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    });
});
