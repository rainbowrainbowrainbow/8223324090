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
        '../services/booking',
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
        id: 'BK-2026-0001',
        date: '2099-01-20',
        time: '10:00',
        line_id: 'line-1',
        program_id: 'custom',
        program_code: 'TEST',
        label: 'Test booking',
        program_name: 'Test booking',
        category: 'custom',
        duration: 60,
        price: 0,
        hosts: null,
        second_animator: null,
        pinata_filler: null,
        costume: null,
        room: 'Room A',
        notes: null,
        created_by: 'tester',
        created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        linked_to: null,
        status: 'confirmed',
        kids_count: null,
        updated_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        group_name: null,
        extra_data: null,
        business_context: 'event_genix',
        skip_notification: false,
        customer_id: null,
        payment_method: null,
        certificate_id: null,
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

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            state.tx.push(sql);
            return { rows: [], rowCount: 0 };
        }

        if (/SELECT name FROM lines_by_date/i.test(sql)) {
            return { rows: [] };
        }

        if (/SELECT \* FROM bookings WHERE id = \$1(?: FOR UPDATE)?$/i.test(sql)) {
            return { rows: state.rows.filter(row => row.id === params[0]) };
        }

        if (/SELECT \* FROM bookings WHERE linked_to = \$1(?: AND business_context = \$2)? AND status != 'cancelled' FOR UPDATE/i.test(sql)) {
            const businessContext = params[1];
            return {
                rows: state.rows.filter(row =>
                    row.linked_to === params[0] &&
                    (!businessContext || (row.business_context || 'event_genix') === businessContext) &&
                    row.status !== 'cancelled'
                )
            };
        }

        if (/FROM bookings WHERE date = \$1 AND line_id = \$2/i.test(sql)) {
            const businessContext = sql.includes('business_context = $3') ? params[2] : null;
            const exclude = new Set((businessContext ? params[3] : params[2]) || []);
            return {
                rows: state.rows.filter(row =>
                    row.date === params[0] &&
                    row.line_id === params[1] &&
                    (!businessContext || (row.business_context || 'event_genix') === businessContext) &&
                    row.status !== 'cancelled' &&
                    !exclude.has(row.id)
                )
            };
        }

        if (/FROM bookings WHERE date = \$1 AND room = \$2/i.test(sql)) {
            const businessContext = sql.includes('business_context = $3') ? params[2] : null;
            const exclude = new Set((businessContext ? params[3] : params[2]) || []);
            return {
                rows: state.rows.filter(row =>
                    row.date === params[0] &&
                    row.room === params[1] &&
                    (!businessContext || (row.business_context || 'event_genix') === businessContext) &&
                    row.status !== 'cancelled' &&
                    !exclude.has(row.id)
                )
            };
        }

        if (/WHERE \(hosts = \$1 OR second_animator = \$1::text\)/i.test(sql)) {
            const businessContext = sql.includes('business_context = $3') ? params[2] : null;
            const exclude = new Set((businessContext ? params[3] : params[2]) || []);
            return {
                rows: state.rows.filter(row =>
                    row.date === params[1] &&
                    (!businessContext || (row.business_context || 'event_genix') === businessContext) &&
                    row.status !== 'cancelled' &&
                    !row.linked_to &&
                    !exclude.has(row.id) &&
                    (String(row.hosts || '') === String(params[0]) || String(row.second_animator || '') === String(params[0]))
                )
            };
        }

        if (/^UPDATE bookings SET /i.test(sql)) {
            const id = params[params.length - 1];
            const row = state.rows.find(item => item.id === id);
            if (!row) return { rows: [], rowCount: 0 };
            const setClause = sql.match(/^UPDATE bookings SET (.+) WHERE id =/i)[1];
            let paramIndex = 0;
            for (const assignment of setClause.split(',')) {
                const field = assignment.split('=')[0].trim();
                if (field === 'updated_at') {
                    row.updated_at = new Date('2099-01-01T00:01:00Z').toISOString();
                } else {
                    row[field] = params[paramIndex++];
                }
            }
            return { rows: [{ ...row }], rowCount: 1 };
        }

        if (/^INSERT INTO history/i.test(sql)) {
            state.histories.push({ action: params[0], username: params[1], data: JSON.parse(params[2]) });
            return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected booking-linked-atomic query: ${sql}`);
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

async function request(baseUrl, body) {
    const res = await fetch(`${baseUrl}/api/bookings/BK-2026-0001/linked-atomic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function withApp(rows, fn) {
    clearModules();
    const { pool, state } = makeDb(rows);
    installMock('../db', { pool, generateBookingNumber: async () => 'BK-2026-9999' });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 1, username: 'atomic-test', role: 'creator' };
            next();
        },
        requireAction: () => (_req, _res, next) => next()
    });
    installMock('../services/telegram', { notifyTelegram: async () => null });
    installMock('../services/bookingAutomation', { processBookingAutomation: async () => null });
    installMock('../services/websocket', { broadcast: () => null });
    installMock('../services/eventBus', { publish: () => null });
    installMock('../routes/dashboard', { triggerAlertBroadcast: () => null });

    const app = express();
    app.use(express.json());
    app.use('/api/bookings', require('../routes/bookings'));
    const { server, baseUrl } = await listen(app);
    try {
        await fn({ baseUrl, state });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('linked-atomic updates main and linked bookings in one committed transaction', async () => {
    await withApp([
        bookingRow({ id: 'BK-2026-0001', time: '10:00', line_id: 'line-1' }),
        bookingRow({ id: 'BK-2026-0002', time: '10:15', line_id: 'line-2', linked_to: 'BK-2026-0001' })
    ], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, {
            main: { time: '11:00', lineId: 'line-3' },
            linked: [{ id: 'BK-2026-0002', time: '11:15' }],
            historyAction: 'drag',
            historyData: { reason: 'unit-test' }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0001').time, '11:00');
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0001').line_id, 'line-3');
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0002').time, '11:15');
        assert.equal(state.histories[0].action, 'drag');
    });
});

test('linked-atomic cross-line move does not treat hosts count as animator identity', async () => {
    await withApp([
        bookingRow({ id: 'BK-2026-0001', time: '14:00', line_id: 'line-1', room: 'Room A', hosts: 1 }),
        bookingRow({ id: 'BK-2026-0002', time: '14:15', line_id: 'line-2', room: 'Room A', linked_to: 'BK-2026-0001', hosts: 1 }),
        bookingRow({ id: 'BK-2026-0003', time: '14:00', line_id: 'line-99', room: 'Room B', label: 'Pin+1L', hosts: 1 })
    ], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, {
            main: { lineId: 'line-3' },
            linked: [],
            historyAction: 'drag',
            historyData: { reason: 'hosts-is-count-regression' }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0001').line_id, 'line-3');
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0003').line_id, 'line-99');
        assert.equal(state.histories[0].action, 'drag');
    });
});

test('linked-atomic rolls back before any update when a linked target conflicts', async () => {
    await withApp([
        bookingRow({ id: 'BK-2026-0001', time: '10:00', line_id: 'line-1' }),
        bookingRow({ id: 'BK-2026-0002', time: '10:15', line_id: 'line-2', linked_to: 'BK-2026-0001' }),
        bookingRow({ id: 'BK-2026-0003', time: '11:00', line_id: 'line-2', label: 'Blocker' })
    ], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, {
            main: { time: '11:00' },
            linked: [{ id: 'BK-2026-0002', time: '11:15' }],
            historyAction: 'shift'
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0001').time, '10:00');
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0002').time, '10:15');
        assert.equal(state.histories.length, 0);
    });
});

test('linked-atomic rejects time changes that omit existing linked bookings', async () => {
    await withApp([
        bookingRow({ id: 'BK-2026-0001', time: '10:00', line_id: 'line-1' }),
        bookingRow({ id: 'BK-2026-0002', time: '10:15', line_id: 'line-2', linked_to: 'BK-2026-0001' })
    ], async ({ baseUrl, state }) => {
        const res = await request(baseUrl, {
            main: { time: '11:00' },
            linked: [],
            historyAction: 'shift'
        });

        assert.equal(res.status, 400, JSON.stringify(res.data));
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0001').time, '10:00');
        assert.equal(state.rows.find(row => row.id === 'BK-2026-0002').time, '10:15');
    });
});
