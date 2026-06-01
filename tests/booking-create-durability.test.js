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
        '../services/booking',
        '../services/timelineResources',
        '../services/telegram',
        '../services/bookingAutomation',
        '../services/leadBookingLink',
        '../services/bookingPackage',
        '../services/websocket',
        '../services/eventBus',
        '../routes/dashboard',
        '../routes/bookings'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function mapBookingRow(row = {}) {
    return {
        id: row.id,
        businessContext: row.business_context || 'event_genix',
        date: row.date,
        time: row.time,
        lineId: row.line_id,
        programId: row.program_id,
        programCode: row.program_code,
        label: row.label,
        programName: row.program_name,
        category: row.category,
        duration: row.duration,
        price: row.price,
        room: row.room,
        status: row.status,
        createdBy: row.created_by,
        linkedTo: row.linked_to || null,
        extraData: row.extra_data || null
    };
}

function bookingRowFromInsert(params) {
    return {
        id: params[0],
        business_context: params[1],
        date: params[2],
        time: params[3],
        line_id: params[4],
        program_id: params[5],
        program_code: params[6],
        label: params[7],
        program_name: params[8],
        category: params[9],
        duration: params[10],
        price: params[11],
        hosts: params[12],
        second_animator: params[13],
        room: params[21],
        notes: params[22],
        created_by: params[23],
        linked_to: params[24],
        status: params[25] || 'confirmed',
        kids_count: params[26],
        group_name: params[27],
        extra_data: params[28],
        skip_notification: params[29],
        customer_id: params[30],
        payment_method: params[31],
        created_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2099-01-01T00:00:00.000Z'
    };
}

function makeDb({ commitCommand = 'COMMIT' } = {}) {
    const state = {
        rows: [],
        tx: [],
        histories: [],
        financeAttempts: 0,
        released: 0
    };

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'SAVEPOINT booking_optional_step'
            || sql === 'RELEASE SAVEPOINT booking_optional_step'
            || sql === 'ROLLBACK TO SAVEPOINT booking_optional_step') {
            state.tx.push(sql);
            return { rows: [], rowCount: 0, command: sql.split(' ')[0] };
        }
        if (sql === 'COMMIT') {
            state.tx.push(sql);
            return { rows: [], rowCount: 0, command: commitCommand };
        }
        if (/SELECT line_id, name, color FROM lines_by_date/i.test(sql)) {
            return { rows: [{ line_id: params[2], name: 'Line One', color: '#123456' }], rowCount: 1 };
        }
        if (/SELECT name FROM lines_by_date WHERE line_id = \$1 AND date = \$2/i.test(sql)) {
            return { rows: [{ name: 'Line One' }], rowCount: 1 };
        }
        if (/SELECT psr\.stock_id, psr\.quantity, ws\.name, ws\.quantity AS current_qty/i.test(sql)) {
            return { rows: [], rowCount: 0 };
        }
        if (/^INSERT INTO bookings /i.test(sql) && /RETURNING \*/i.test(sql)) {
            const row = bookingRowFromInsert(params);
            state.rows.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/^INSERT INTO history/i.test(sql)) {
            state.histories.push({ action: params[0], username: params[1], data: JSON.parse(params[2]) });
            return { rows: [], rowCount: 1 };
        }
        if (/^INSERT INTO finance_transactions/i.test(sql)) {
            state.financeAttempts += 1;
            throw new Error('missing finance category');
        }
        if (/SELECT \* FROM bookings b WHERE b\.id = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const ids = new Set((params[0] || []).map(String));
            const businessContext = params[1];
            const rows = state.rows.filter(row =>
                ids.has(String(row.id)) &&
                (row.business_context || 'event_genix') === businessContext &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT b\.id FROM bookings b WHERE b\.date = \$1/i.test(sql)) {
            const [date, businessContext, id] = params;
            const row = state.rows.find(item =>
                item.date === date &&
                (item.business_context || 'event_genix') === businessContext &&
                item.id === id &&
                item.status !== 'cancelled'
            );
            return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        throw new Error(`Unexpected booking create durability query: ${sql}`);
    }

    return {
        state,
        pool: {
            query,
            connect: async () => ({
                query,
                release: () => { state.released += 1; }
            })
        }
    };
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function withApp(dbOptions, fn) {
    clearModules();
    const { pool, state } = makeDb(dbOptions);
    installMock('../db', { pool, generateBookingNumber: async () => 'BK-2099-0001' });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 1, username: 'creator-user', role: 'creator' };
            next();
        },
        requireAction: () => (_req, _res, next) => next()
    });
    installMock('../services/booking', {
        validateDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')),
        validateTime: value => /^\d{2}:\d{2}$/.test(String(value || '')),
        validateId: value => Boolean(value),
        mapBookingRow,
        checkServerConflicts: async () => ({ overlap: false }),
        checkServerDuplicate: async () => null,
        checkRoomConflict: async () => null,
        timeToMinutes: value => {
            const [h, m] = String(value).split(':').map(Number);
            return h * 60 + m;
        }
    });
    installMock('../services/timelineResources', {
        findTimelineResource: async () => null,
        findTimelineResourceByName: async () => null,
        getTimelineDisplaySettings: async () => ({ mode: 'park' }),
        resourceTypeForDisplayMode: () => null
    });
    installMock('../services/telegram', { notifyTelegram: async () => null });
    installMock('../services/bookingAutomation', { processBookingAutomation: async () => null });
    installMock('../services/leadBookingLink', {
        attachLeadBookingLink: async () => null,
        ensureLeadForBooking: async () => ({ attached: false })
    });
    installMock('../services/bookingPackage', {
        applyBookingPackage: booking => booking,
        bookingPackageAudit: () => ({})
    });
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

async function createBooking(baseUrl) {
    const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            businessContext: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            lineId: 'line-1',
            room: 'Room A',
            programId: 'anim-60',
            programCode: 'AN',
            label: 'AN(60)',
            programName: 'Animation',
            category: 'animation',
            duration: 60,
            price: 1500,
            status: 'confirmed',
            createdBy: 'creator-user'
        })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

test('POST /api/bookings keeps booking durable when optional finance write fails', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl);

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.serverVerified, true);
        assert.equal(res.data.booking.id, 'BK-2099-0001');
        assert.equal(res.data.booking.serverVerified, true);
        assert.equal(state.rows.length, 1);
        assert.equal(state.financeAttempts, 1);
        assert.ok(state.tx.includes('SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('ROLLBACK TO SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('RELEASE SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('COMMIT'));
    });
});

test('POST /api/bookings fails closed when PostgreSQL reports rollback on commit', async () => {
    await withApp({ commitCommand: 'ROLLBACK' }, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl);

        assert.equal(res.status, 500);
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'booking_commit_not_verified');
        assert.match(res.data.error, /не підтвердив збереження/);
        assert.ok(state.tx.includes('COMMIT'));
    });
});
