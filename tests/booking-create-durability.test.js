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
        hosts: row.hosts,
        secondAnimator: row.second_animator || null,
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
        lines: [
            { business_context: 'event_genix', date: '2099-02-10', line_id: 'line-1', name: 'Line One', color: '#123456' },
            { business_context: 'event_genix', date: '2099-02-13', line_id: 'line-main', name: 'Anna', color: '#123456' },
            { business_context: 'event_genix', date: '2099-02-13', line_id: 'line-second', name: 'Second Animator', color: '#3B82F6' },
            { business_context: 'dar', date: '2099-02-12', line_id: 'specialist-main', name: 'Specialist', color: '#0EA586' }
        ],
        tx: [],
        histories: [],
        customers: [],
        nextCustomerId: 701,
        nextBookingSeq: 1,
        leadAttempts: 0,
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
            const [date, businessContext, lineId, name] = params;
            const normalizedName = String(name || '').trim().toLowerCase();
            const rows = state.lines.filter(line =>
                line.date === date &&
                (line.business_context || 'event_genix') === businessContext &&
                (
                    (lineId && String(line.line_id) === String(lineId)) ||
                    (normalizedName && String(line.name || '').trim().toLowerCase() === normalizedName)
                )
            );
            return { rows: rows.map(row => ({ line_id: row.line_id, name: row.name, color: row.color })), rowCount: rows.length };
        }
        if (/SELECT name FROM lines_by_date WHERE line_id = \$1 AND date = \$2/i.test(sql)) {
            return { rows: [{ name: 'Line One' }], rowCount: 1 };
        }
        if (/SELECT psr\.stock_id, psr\.quantity, ws\.name, ws\.quantity AS current_qty/i.test(sql)) {
            return { rows: [], rowCount: 0 };
        }
        if (/FROM products p/i.test(sql) && /FROM price_rules pr/i.test(sql) && /WHERE p\.id = \$1/i.test(sql)) {
            const productId = String(params[0] || '');
            const priceDate = params[1] || null;
            const businessContext = params[2] || 'event_genix';
            const prices = {
                'anim-60': 1500,
                'paper-show': 1600,
                'quest-60': 0
            };
            if (!Object.prototype.hasOwnProperty.call(prices, productId)) {
                return { rows: [], rowCount: 0 };
            }
            return {
                rows: [{
                    id: productId,
                    business_context: businessContext,
                    price: prices[productId],
                    is_per_child: false,
                    price_query_date: priceDate,
                    price_rule_code: `${productId}_price`,
                    price_rule_name: productId,
                    price_rule_value: prices[productId],
                    price_rule_unit: 'грн',
                    price_rule_category: 'test',
                    price_rule_effective_from: '2099-01-01',
                    next_price_rule_value: null,
                    next_price_rule_effective_from: null
                }],
                rowCount: 1
            };
        }
        if (/SELECT id FROM customers WHERE phone = \$1/i.test(sql)) {
            const [phone, businessContext] = params;
            const row = state.customers.find(item =>
                item.phone === phone &&
                (item.business_context || 'event_genix') === businessContext
            );
            return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (/^INSERT INTO customers \(business_context, name, phone, instagram, child_name, child_birthday, source\)/i.test(sql)) {
            const row = {
                id: state.nextCustomerId++,
                business_context: params[0],
                name: params[1],
                phone: params[2] || null
            };
            state.customers.push(row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }
        if (/SELECT id FROM customers WHERE id = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2 LIMIT 1/i.test(sql)) {
            const [id, businessContext] = params;
            const row = state.customers.find(item =>
                Number(item.id) === Number(id) &&
                (item.business_context || 'event_genix') === businessContext
            );
            return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (/^UPDATE customers SET first_visit = LEAST/i.test(sql)) {
            return { rows: [], rowCount: 1 };
        }
        if (/^INSERT INTO bookings /i.test(sql) && /RETURNING \*/i.test(sql)) {
            const row = bookingRowFromInsert(params);
            state.rows.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/^INSERT INTO bookings /i.test(sql)) {
            const row = bookingRowFromInsert(params);
            state.rows.push(row);
            return { rows: [], rowCount: 1 };
        }
        if (/SELECT \* FROM bookings WHERE id = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2(?: FOR UPDATE)?/i.test(sql)) {
            const [id, businessContext] = params;
            const row = state.rows.find(item =>
                item.id === id &&
                (item.business_context || 'event_genix') === businessContext
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/^UPDATE bookings SET date=\$1, time=\$2, line_id=\$3/i.test(sql) && /RETURNING \*/i.test(sql)) {
            const id = params[22];
            const businessContext = params[33];
            const row = state.rows.find(item =>
                item.id === id &&
                (item.business_context || 'event_genix') === businessContext
            );
            if (!row) return { rows: [], rowCount: 0 };
            Object.assign(row, {
                date: params[0],
                time: params[1],
                line_id: params[2],
                program_id: params[3],
                program_code: params[4],
                label: params[5],
                program_name: params[6],
                category: params[7],
                duration: params[8],
                price: params[9],
                hosts: params[10],
                second_animator: params[11],
                pinata_filler: params[12],
                costume: params[13],
                room: params[14],
                notes: params[15],
                created_by: params[16],
                linked_to: params[17],
                status: params[18],
                kids_count: params[19],
                group_name: params[20],
                extra_data: params[21],
                customer_id: params[23],
                payment_method: params[24],
                pinata_mode: params[25],
                client_pinata_service_price: params[26],
                client_pinata_service_note: params[27],
                pinata_number: params[28],
                pinata_filler_number: params[29],
                banquet_guests: params[30],
                banquet_tables: params[31],
                banquet_menu: params[32],
                updated_at: '2099-01-02T00:00:00.000Z'
            });
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/SELECT id, line_id, second_animator, program_id, price FROM bookings WHERE linked_to = \$1/i.test(sql)) {
            const [linkedTo, businessContext] = params;
            const rows = state.rows.filter(row =>
                row.linked_to === linkedTo &&
                (row.business_context || 'event_genix') === businessContext &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id FROM bookings WHERE linked_to = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2/i.test(sql)) {
            const [linkedTo, businessContext] = params;
            const rows = state.rows.filter(row =>
                row.linked_to === linkedTo &&
                (row.business_context || 'event_genix') === businessContext &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ id: row.id })), rowCount: rows.length };
        }
        if (/^DELETE FROM bookings WHERE id = \$1/i.test(sql)) {
            const [id, businessContext] = params;
            const before = state.rows.length;
            state.rows = state.rows.filter(row =>
                !(row.id === id && (row.business_context || 'event_genix') === businessContext)
            );
            return { rows: [], rowCount: before - state.rows.length };
        }
        if (/^UPDATE bookings SET date=\$1, time=\$2, duration=\$3, status=\$4, room=\$5/i.test(sql)) {
            const id = params[11];
            const businessContext = params[12];
            const row = state.rows.find(item =>
                item.id === id &&
                (item.business_context || 'event_genix') === businessContext &&
                item.status !== 'cancelled'
            );
            if (row) {
                Object.assign(row, {
                    date: params[0],
                    time: params[1],
                    duration: params[2],
                    status: params[3],
                    room: params[4],
                    pinata_filler: params[5],
                    pinata_mode: params[6],
                    client_pinata_service_price: params[7],
                    client_pinata_service_note: params[8],
                    pinata_number: params[9],
                    pinata_filler_number: params[10],
                    updated_at: '2099-01-02T00:00:00.000Z'
                });
            }
            return { rows: [], rowCount: row ? 1 : 0 };
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
    installMock('../db', {
        pool,
        generateBookingNumber: async () => `BK-2099-${String(state.nextBookingSeq++).padStart(4, '0')}`
    });
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
        normalizeBookingStatus: (value, fallback = 'confirmed') => {
            if (value === undefined || value === null || value === '') return fallback;
            return ['confirmed', 'preliminary', 'cancelled'].includes(String(value).trim().toLowerCase())
                ? String(value).trim().toLowerCase()
                : null;
        },
        lockBookingConflictResources: async () => [],
        checkServerConflicts: async () => ({ overlap: false }),
        checkServerDuplicate: async () => null,
        checkRoomConflict: async () => null,
        timeToMinutes: value => {
            const [h, m] = String(value).split(':').map(Number);
            return h * 60 + m;
        }
    });
    installMock('../services/timelineResources', {
        findTimelineResource: async (_queryable, businessContext, resourceId) => {
            if (businessContext === 'maysternya_doli' && resourceId === 'md-consult-room') {
                return {
                    resourceId: 'md-consult-room',
                    type: 'specialist',
                    name: 'Онлайн',
                    color: '#14b8a6',
                    capacity: 1
                };
            }
            if (businessContext === 'dar' && resourceId === 'specialist-main') {
                return {
                    resourceId: 'specialist-main',
                    type: 'specialist',
                    name: 'Specialist',
                    color: '#0EA586',
                    capacity: 1
                };
            }
            return null;
        },
        findTimelineResourceByName: async () => null,
        getTimelineDisplaySettings: async (_queryable, businessContext) => (
            businessContext === 'maysternya_doli' || businessContext === 'dar'
                ? { mode: 'simple', resourceModel: 'specialist' }
                : { mode: 'park' }
        ),
        resourceTypeForDisplayMode: mode => (mode === 'simple' ? 'specialist' : null)
    });
    installMock('../services/telegram', { notifyTelegram: async () => null });
    installMock('../services/bookingAutomation', { processBookingAutomation: async () => null });
    installMock('../services/leadBookingLink', {
        attachLeadBookingLink: async () => null,
        ensureLeadForBooking: async () => {
            state.leadAttempts += 1;
            if (dbOptions?.leadHandoffFails) throw new Error('legacy leads schema mismatch');
            return { attached: false };
        }
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

async function createBooking(baseUrl, overrides = {}) {
    const payload = {
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
        createdBy: 'creator-user',
        ...overrides
    };
    const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function createFullBooking(baseUrl, overrides = {}) {
    const main = {
        businessContext: 'event_genix',
        date: '2099-02-13',
        time: '13:00',
        lineId: 'line-main',
        lineName: 'Anna',
        room: 'Room A',
        programId: 'paper-show',
        programCode: 'PAPER',
        label: 'Paper(30)',
        programName: 'Paper Show',
        category: 'show',
        duration: 30,
        price: 1600,
        hosts: 2,
        secondAnimator: 'Second Animator',
        status: 'confirmed',
        createdBy: 'creator-user',
        extraData: {
            timelineIdentity: {
                businessContext: 'event_genix',
                resourceId: 'line-main',
                lineId: 'line-main',
                resourceType: 'animator',
                resourceName: 'Anna',
                source: 'booking_form'
            }
        },
        ...overrides.main
    };
    const linked = overrides.linked ?? [{
        date: main.date,
        time: main.time,
        lineId: 'line-second',
        lineName: 'Second Animator',
        programId: main.programId,
        programCode: main.programCode,
        label: main.label,
        programName: main.programName,
        category: main.category,
        duration: main.duration,
        price: 0,
        hosts: main.hosts,
        secondAnimator: 'Second Animator',
        room: main.room,
        status: main.status,
        createdBy: main.createdBy
    }];
    const res = await fetch(`${baseUrl}/api/bookings/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ main, linked })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function updateBooking(baseUrl, id, payload) {
    const res = await fetch(`${baseUrl}/api/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
        assert.deepEqual(res.data.allBookings.map(item => item.id), ['BK-2099-0001']);
        assert.equal(res.data.projection.bookings[0].resourceId, 'line-1');
        assert.equal(state.rows.length, 1);
        assert.equal(state.financeAttempts, 1);
        assert.ok(state.tx.includes('SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('ROLLBACK TO SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('RELEASE SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('COMMIT'));
    });
});

test('PUT /api/bookings creates missing linked row when edit adds second animator', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-0100',
            business_context: 'event_genix',
            date: '2099-02-13',
            time: '14:30',
            line_id: 'line-main',
            program_id: 'quest-60',
            program_code: 'KV4',
            label: 'KV4(60)',
            program_name: 'Quest',
            category: 'quest',
            duration: 60,
            price: 0,
            hosts: 1,
            second_animator: null,
            pinata_filler: null,
            pinata_mode: 'none',
            pinata_number: null,
            pinata_filler_number: null,
            client_pinata_service_price: null,
            client_pinata_service_note: null,
            costume: null,
            room: 'Room A',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            banquet_guests: null,
            banquet_tables: null,
            banquet_menu: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await updateBooking(baseUrl, 'BK-2099-0100', {
            businessContext: 'event_genix',
            date: '2099-02-13',
            time: '14:30',
            lineId: 'line-main',
            lineName: 'Anna',
            room: 'Room A',
            programId: 'quest-60',
            programCode: 'KV4',
            label: 'KV4(60)',
            programName: 'Quest',
            category: 'quest',
            duration: 60,
            price: 0,
            hosts: 1,
            secondAnimator: 'Second Animator',
            secondAnimatorLineId: 'line-second',
            status: 'confirmed',
            createdBy: 'creator-user',
            pinataMode: 'none'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);

        const mainRow = state.rows.find(row => row.id === 'BK-2099-0100');
        const linkedRow = state.rows.find(row => row.linked_to === 'BK-2099-0100');
        assert.ok(mainRow, 'main booking still exists');
        assert.ok(linkedRow, 'second animator linked booking was created');
        assert.equal(mainRow.hosts, 2);
        assert.equal(mainRow.second_animator, 'Second Animator');
        assert.equal(linkedRow.line_id, 'line-second');
        assert.equal(linkedRow.second_animator, 'Second Animator');
        assert.equal(linkedRow.price, 0);
        assert.ok(linkedRow.extra_data, 'linked row keeps second-line timeline identity');
        const linkedExtra = JSON.parse(linkedRow.extra_data);
        assert.equal(linkedExtra.timelineIdentity.resourceId, 'line-second');
    });
});

test('POST /api/bookings/full keeps second animator linked booking on its own timeline line', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createFullBooking(baseUrl);

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.serverVerified, true);
        assert.equal(res.data.mainBooking.lineId, 'line-main');
        assert.equal(res.data.linkedBookings.length, 1);
        assert.equal(res.data.linkedBookings[0].lineId, 'line-second');
        assert.deepEqual(res.data.allBookings.map(item => item.id), [res.data.mainBooking.id, res.data.linkedBookings[0].id]);
        assert.deepEqual(res.data.projection.bookings.map(item => item.resourceId), ['line-main', 'line-second']);

        const linkedRow = state.rows.find(row => row.linked_to === res.data.mainBooking.id);
        assert.ok(linkedRow, 'second animator linked row must be inserted');
        assert.equal(linkedRow.line_id, 'line-second');
        assert.notEqual(linkedRow.line_id, res.data.mainBooking.lineId);
        assert.ok(linkedRow.extra_data, 'linked row keeps its own timeline identity metadata');

        const linkedExtra = typeof linkedRow.extra_data === 'string'
            ? JSON.parse(linkedRow.extra_data)
            : linkedRow.extra_data;
        assert.equal(linkedExtra.timelineIdentity.resourceId, 'line-second');
        assert.equal(linkedExtra.timelineIdentity.lineId, 'line-second');
        assert.notEqual(linkedExtra.timelineIdentity.resourceId, 'line-main');
    });
});

test('POST /api/bookings keeps Maysternya booking durable when automatic lead handoff fails', async () => {
    await withApp({ leadHandoffFails: true }, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl, {
            businessContext: 'maysternya_doli',
            date: '2099-02-11',
            time: '14:30',
            lineId: 'md-consult-room',
            room: 'Онлайн',
            programId: 'md_full_consult_90',
            programCode: 'FULL',
            label: 'Повна консультація',
            programName: 'Повна консультація',
            category: 'consultation',
            duration: 90,
            price: 0,
            customer: {
                name: 'Клієнт Майстерні',
                phone: '+380991111111'
            }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.serverVerified, true);
        assert.equal(res.data.booking.businessContext, 'maysternya_doli');
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].business_context, 'maysternya_doli');
        assert.equal(state.rows[0].customer_id, 701);
        assert.equal(state.leadAttempts, 1);
        assert.ok(state.tx.includes('SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('ROLLBACK TO SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('RELEASE SAVEPOINT booking_optional_step'));
        assert.ok(state.tx.includes('COMMIT'));
    });
});

test('POST /api/bookings creates Dar simple-timeline bookings with scoped context', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl, {
            businessContext: 'dar',
            date: '2099-02-12',
            time: '15:30',
            lineId: 'specialist-main',
            room: 'Cabinet',
            programId: 'specialist_service_30',
            programCode: 'SERVICE',
            label: 'Service(30)',
            programName: 'Service 30',
            category: 'custom',
            duration: 30,
            price: 0,
            customer: {
                name: 'Dar Client',
                phone: '+380992222222'
            }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.serverVerified, true);
        assert.equal(res.data.booking.businessContext, 'dar');
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].business_context, 'dar');
        assert.equal(state.rows[0].line_id, 'specialist-main');
        assert.equal(state.rows[0].customer_id, 701);
        assert.equal(state.customers[0].business_context, 'dar');
        assert.equal(state.histories[0].businessContext, 'dar');
    });
});

test('POST /api/bookings rejects explicit invalid create status before persistence', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl, {
            status: 'hacked_status'
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.success, false);
        assert.equal(res.data.error, 'Invalid booking status');
        assert.equal(state.rows.length, 0);
        assert.equal(state.histories.length, 0);
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

test('booking conflict locks serialize line and room resources in deterministic order', async () => {
    clearModules();
    const { lockBookingConflictResources } = require('../services/booking');
    const calls = [];
    const client = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [], rowCount: 1 };
        }
    };

    const keys = await lockBookingConflictResources(client, [
        { businessContext: 'dar', date: '2099-02-12', lineId: 'specialist-main', room: 'Cabinet' },
        { businessContext: 'dar', date: '2099-02-12', lineId: 'specialist-main', room: 'Cabinet' }
    ], 'dar');

    assert.deepEqual(keys, [
        'line:dar:2099-02-12:specialist-main',
        'room:dar:2099-02-12:cabinet'
    ]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => /pg_advisory_xact_lock/i.test(call.sql)));
    assert.deepEqual(calls.map(call => call.params[0]), ['booking_conflict_v1', 'booking_conflict_v1']);
});
