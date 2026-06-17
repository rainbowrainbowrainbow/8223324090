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
        '../services/banquetGroups',
        '../services/banquetSummary',
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
        business_context: 'event_genix',
        date: '2099-06-01',
        time: '12:00',
        line_id: 'line-1',
        program_id: 'custom',
        program_code: 'BANQ',
        label: 'Banquet activity',
        program_name: 'Banquet activity',
        category: 'banquet',
        duration: 60,
        price: 0,
        hosts: null,
        second_animator: null,
        pinata_filler: null,
        pinata_mode: null,
        pinata_number: null,
        pinata_filler_number: null,
        client_pinata_service_price: null,
        client_pinata_service_note: null,
        costume: null,
        room: 'Room A',
        notes: null,
        created_by: 'tester',
        created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        linked_to: null,
        status: 'confirmed',
        kids_count: null,
        updated_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        group_name: 'Banquet Olya',
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

function makeDb(rows, links = [], options = {}) {
    const state = {
        rows: rows.map(row => ({ ...row })),
        links: links.map((link, index) => ({ id: index + 1, relation_type: 'banquet_activity', ...link })),
        banquetGroups: (Array.isArray(options.banquetGroups) ? options.banquetGroups : []).map(group => ({ ...group })),
        banquetMemberships: (Array.isArray(options.banquetMemberships) ? options.banquetMemberships : []).map(row => ({ ...row })),
        histories: [],
        tx: [],
        queries: [],
        nextLinkId: links.length + 1,
        nextBanquetMembershipId: (Array.isArray(options.banquetMemberships) ? options.banquetMemberships.length : 0) + 1,
        released: 0
    };

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        state.queries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            state.tx.push(sql);
            return { rows: [], rowCount: 0 };
        }
        if (/FROM bookings b\s+(?:LEFT JOIN[\s\S]+?\s+)?WHERE b\.date = \$1/i.test(sql)) {
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            return {
                rows: state.rows.filter(row =>
                    row.date === params[0] &&
                    normalizeContext(row.business_context) === normalizeContext(params[1]) &&
                    row.status !== 'cancelled'
                )
            };
        }
        if (/SELECT \* FROM bookings WHERE id = \$1(?: AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)?(?: FOR UPDATE)?$/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            const row = state.rows.find(item =>
                item.id === params[0]
                && (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT b\.\* FROM bookings b\s+WHERE b\.id = \$1(?:\s+AND (?:COALESCE\(b\.business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)?\s+LIMIT 1$/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            const row = state.rows.find(item =>
                item.id === params[0]
                && (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT \* FROM bookings WHERE id = ANY\(\$1::text\[\]\)(?: AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)? FOR UPDATE/i.test(sql)) {
            const ids = new Set(params[0] || []);
            const businessContext = params.length > 1 ? params[1] : null;
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            return {
                rows: state.rows.filter(row =>
                    ids.has(row.id) &&
                    (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
                )
            };
        }
        if (/SELECT bg\.\* FROM banquet_group_bookings bgb\s+JOIN banquet_groups bg ON bg\.id = bgb\.group_id/i.test(sql)) {
            const membership = state.banquetMemberships.find(item => item.booking_id === params[0]);
            if (!membership) return { rows: [], rowCount: 0 };
            const group = state.banquetGroups.find(item => item.id === membership.group_id);
            return { rows: group ? [{ ...group }] : [], rowCount: group ? 1 : 0 };
        }
        if (/SELECT bgb\.\*\s+FROM banquet_group_bookings bgb\s+WHERE bgb\.group_id = \$1/i.test(sql)) {
            const rows = state.banquetMemberships.filter(item => item.group_id === params[0]).map(row => ({ ...row }));
            return { rows, rowCount: rows.length };
        }
        if (/SELECT bgb\.group_id, bgb\.booking_id, bgb\.role, bg\.primary_booking_id, bg\.status AS group_status\s+FROM banquet_group_bookings bgb\s+JOIN banquet_groups bg ON bg\.id = bgb\.group_id/i.test(sql)) {
            const membership = state.banquetMemberships.find(item => item.booking_id === params[0]);
            if (!membership) return { rows: [], rowCount: 0 };
            const group = state.banquetGroups.find(item => item.id === membership.group_id);
            return {
                rows: group ? [{
                    group_id: membership.group_id,
                    booking_id: membership.booking_id,
                    role: membership.role,
                    primary_booking_id: group.primary_booking_id,
                    group_status: group.status || 'active'
                }] : [],
                rowCount: group ? 1 : 0
            };
        }
        if (/SELECT bg\.\*\s+FROM banquet_groups bg\s+WHERE bg\.id = \$1/i.test(sql)) {
            const group = state.banquetGroups.find(item => item.id === params[0]);
            return { rows: group ? [{ ...group }] : [], rowCount: group ? 1 : 0 };
        }
        if (/SELECT b\.\*\s+FROM bookings b\s+WHERE b\.id = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const ids = new Set((params[0] || []).map(String));
            const businessContext = params[1];
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            const activeOnly = /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.status\), ''\), 'confirmed'\)\) != 'cancelled'/i.test(sql);
            const rows = state.rows.filter(row =>
                ids.has(String(row.id))
                && (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
                && (!activeOnly || row.status !== 'cancelled')
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT b\.\*\s+FROM bookings b\s+WHERE NULLIF\(COALESCE\(b\.linked_to, ''\), ''\) = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const parentIds = new Set((params[0] || []).map(String));
            const businessContext = params[1];
            const normalizeContext = value => {
                const raw = String(value || 'event_genix').trim().toLowerCase();
                return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
            };
            const rows = state.rows.filter(row =>
                row.linked_to
                && parentIds.has(String(row.linked_to))
                && (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/INSERT INTO booking_banquet_links/i.test(sql)) {
            const [businessContext, bookingA, bookingB, relationType, label, createdByUserId, createdBy] = params;
            let link = state.links.find(item =>
                item.business_context === businessContext &&
                item.booking_a_id === bookingA &&
                item.booking_b_id === bookingB &&
                item.relation_type === relationType
            );
            if (!link) {
                link = {
                    id: state.nextLinkId++,
                    business_context: businessContext,
                    booking_a_id: bookingA,
                    booking_b_id: bookingB,
                    relation_type: relationType,
                    label,
                    created_by_user_id: createdByUserId,
                    created_by: createdBy,
                    created_at: new Date('2099-01-01T00:00:00Z').toISOString()
                };
                state.links.push(link);
            } else if (label) {
                link.label = label;
            }
            return { rows: [{ ...link }], rowCount: 1 };
        }
        if (/DELETE FROM booking_banquet_links/i.test(sql)) {
            const [businessContext, bookingA, bookingB, relationType] = params;
            const before = state.links.length;
            const deleted = state.links.find(link =>
                link.business_context === businessContext &&
                ((link.booking_a_id === bookingA && link.booking_b_id === bookingB) ||
                    (link.booking_a_id === bookingB && link.booking_b_id === bookingA)) &&
                (!relationType || link.relation_type === relationType)
            );
            state.links = state.links.filter(link => link !== deleted);
            return { rows: deleted ? [{ ...deleted }] : [], rowCount: before - state.links.length };
        }
        if (/DELETE FROM banquet_group_bookings/i.test(sql)) {
            const before = state.banquetMemberships.length;
            state.banquetMemberships = state.banquetMemberships.filter(row =>
                !(row.group_id === params[0] && row.booking_id === params[1])
            );
            return { rows: [], rowCount: before - state.banquetMemberships.length };
        }
        if (/UPDATE banquet_groups\s+SET updated_at = NOW\(\), updated_by = \$3\s+WHERE id = \$1/i.test(sql)) {
            const group = state.banquetGroups.find(item => item.id === params[0]);
            if (group) group.updated_by = params[2];
            return { rows: [], rowCount: group ? 1 : 0 };
        }
        if (/FROM booking_banquet_links WHERE business_context = \$1/i.test(sql)) {
            if (options.failLinkRead) {
                throw new Error('simulated booking_banquet_links schema drift');
            }
            const relationTypes = new Set(Array.isArray(params[1]) ? params[1] : [params[1]]);
            const visible = new Set(params[2] || []);
            return {
                rows: state.links.filter(link =>
                    link.business_context === params[0] &&
                    relationTypes.has(link.relation_type) &&
                    visible.has(link.booking_a_id) &&
                    visible.has(link.booking_b_id)
                )
            };
        }
        if (/UPDATE bookings SET status = 'cancelled', updated_at = NOW\(\)\s+WHERE \(id = \$1 OR linked_to = \$1\)/i.test(sql)) {
            const bookingId = String(params[0]);
            let rowCount = 0;
            state.rows.forEach(row => {
                if (String(row.id) === bookingId || String(row.linked_to || '') === bookingId) {
                    row.status = 'cancelled';
                    row.updated_at = new Date('2099-01-01T00:01:00Z').toISOString();
                    rowCount += 1;
                }
            });
            return { rows: [], rowCount };
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
        throw new Error(`Unexpected banquet-link query: ${sql}`);
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

async function withApp(rows, links, fn, options = {}) {
    clearModules();
    const { pool, state } = makeDb(rows, links, options);
    installMock('../db', { pool, generateBookingNumber: async () => 'BK-2099-9999' });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 7, username: 'banquet-test', role: 'creator' };
            next();
        },
        requireAction: () => (_req, _res, next) => next()
    });
    installMock('../services/bookingVisibility', {
        bookingAccessDeniedPayload: () => ({ success: false, error: 'denied' }),
        buildBookingVisibilityScope: () => '',
        canEditBooking: () => true,
        canViewBooking: () => true
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

test('GET bookings attaches visible banquet links symmetrically', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00' }),
        bookingRow({ id: 'BK-2099-0002', time: '13:00', line_id: 'line-2', label: 'Banquet photo' }),
        bookingRow({ id: 'BK-2099-0003', time: '14:30', line_id: 'line-3', label: 'Room activity' })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0002',
        relation_type: 'banquet_activity',
        label: 'Banquet Olya',
        created_by: 'tester',
        created_at: new Date('2099-01-01T00:00:00Z').toISOString()
    }, {
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0003',
        relation_type: 'shared_room_activity',
        label: 'same room: Room A',
        created_by: 'tester',
        created_at: new Date('2099-01-01T00:01:00Z').toISOString()
    }], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        const first = data.find(item => item.id === 'BK-2099-0001');
        assert.equal(first.banquetLinks[0].targetId, 'BK-2099-0002');
        assert.equal(first.sharedRoomLinks[0].targetId, 'BK-2099-0003');
        assert.deepEqual(first.bookingLinks.map(link => link.relationType).sort(), ['banquet_activity', 'shared_room_activity']);
        assert.equal(data.find(item => item.id === 'BK-2099-0002').banquetLinks[0].targetId, 'BK-2099-0001');
    });
});

test('GET bookings still returns timeline bookings when visual link enrichment fails', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00' }),
        bookingRow({ id: 'BK-2099-0002', time: '13:00', line_id: 'line-2' })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.length, 2);
        assert.equal(data[0].id, 'BK-2099-0001');
        assert.deepEqual(data[0].bookingLinks, []);
        assert.deepEqual(data[0].banquetLinks, []);
        assert.deepEqual(data[0].sharedRoomLinks, []);
    }, { failLinkRead: true });
});

test('GET bookings treats legacy null status rows as active timeline bookings', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00', status: null })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.length, 1);
        assert.equal(data[0].id, 'BK-2099-0001');
        assert.equal(data[0].status, 'confirmed');
        assert.ok(
            state.queries.some(query => /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.status\), ''\), 'confirmed'\)\) != 'cancelled'/i.test(query.sql)),
            'timeline list query must not drop legacy bookings with NULL status'
        );
    });
});

test('GET bookings treats legacy park context aliases as Event Genix timeline bookings', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00', business_context: 'pzp' })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01?businessContext=event_genix`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.length, 1);
        assert.equal(data[0].id, 'BK-2099-0001');
        assert.equal(data[0].businessContext, 'pzp');
        assert.ok(
            state.queries.some(query => /park_zakrevsky', 'park', 'pzp/i.test(query.sql) && /FROM bookings b/i.test(query.sql)),
            'timeline list query must normalize legacy park business_context aliases'
        );
        const listQuery = state.queries.find(query => /FROM bookings b/i.test(query.sql) && /WHERE b\.date = \$1/i.test(query.sql));
        assert.ok(listQuery, 'timeline list query should be captured');
        assert.doesNotMatch(
            listQuery.sql,
            /JOIN customers/i,
            'timeline list must not depend on customer schema to render booking blocks'
        );
    });
});

test('POST full rejects banquet group payloads before legacy-only link creation', async () => {
    await withApp([], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/full`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                main: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'line-1',
                    room: 'Room A',
                    duration: 30,
                    status: 'confirmed',
                    extraData: {
                        banquetGroup: {
                            groupId: 'BQ-2099-0001',
                            sourceBookingId: 'BK-2099-0001',
                            role: 'activity',
                            source: 'room_booking_animation_bridge'
                        }
                    }
                },
                linked: [],
                banquetActivities: []
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_GROUP_ACTIVITY_REQUIRES_ATOMIC_ENDPOINT');
        assert.equal(state.links.length, 0);
        assert.equal(state.queries.some(query => /INSERT INTO booking_banquet_links/i.test(query.sql)), false);
    });
});

test('POST banquet link creates a durable same-day relation', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00' }),
        bookingRow({ id: 'BK-2099-0002', time: '13:00', line_id: 'line-2' })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-2099-0001/banquet-links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId: 'BK-2099-0002', label: 'Banquet Olya' })
        });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.link.targetId, 'BK-2099-0002');
        assert.equal(state.links.length, 1);
        assert.equal(state.links[0].booking_a_id, 'BK-2099-0001');
        assert.equal(state.links[0].booking_b_id, 'BK-2099-0002');
        assert.equal(state.histories[0].action, 'booking_banquet_link_created');
    });
});

test('DELETE banquet link removes only the banquet relation pair', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00' }),
        bookingRow({ id: 'BK-2099-0002', time: '13:00', line_id: 'line-2' })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0002',
        relation_type: 'banquet_activity'
    }, {
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0002',
        relation_type: 'shared_room_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-2099-0002/banquet-links/BK-2099-0001`, { method: 'DELETE' });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.removed, true);
        assert.equal(state.links.length, 1);
        assert.equal(state.links[0].relation_type, 'shared_room_activity');
        assert.equal(state.histories[0].action, 'booking_banquet_link_deleted');
    });
});

test('DELETE room activity link removes only the shared-room relation pair', async () => {
    await withApp([
        bookingRow({ id: 'BK-2099-0001', time: '12:00' }),
        bookingRow({ id: 'BK-2099-0002', time: '13:00', line_id: 'line-2' })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0002',
        relation_type: 'banquet_activity'
    }, {
        business_context: 'event_genix',
        booking_a_id: 'BK-2099-0001',
        booking_b_id: 'BK-2099-0002',
        relation_type: 'shared_room_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-2099-0001/banquet-links/BK-2099-0002?relationType=shared_room_activity`, { method: 'DELETE' });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.removed, true);
        assert.equal(state.links.length, 1);
        assert.equal(state.links[0].relation_type, 'banquet_activity');
        assert.equal(state.histories[0].data.relation_type, 'shared_room_activity');
    });
});

test('GET banquet summary excludes cancelled banquet group activities', async () => {
    await withApp([
        bookingRow({ id: 'BK-ROOT', time: '12:00', label: 'Banquet root', program_name: 'Banquet root', category: 'banquet', room: 'Room A', price: 1000 }),
        bookingRow({ id: 'BK-ACTIVE', time: '13:00', label: 'Foam show', program_name: 'Foam show', category: 'activity', room: 'Room A', price: 700 }),
        bookingRow({ id: 'BK-CANCELLED', time: '14:00', label: 'Neon show', program_name: 'Neon show', category: 'activity', room: 'Room A', price: 500, status: 'cancelled' })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-ROOT',
        booking_b_id: 'BK-ACTIVE',
        relation_type: 'banquet_activity'
    }, {
        business_context: 'event_genix',
        booking_a_id: 'BK-ROOT',
        booking_b_id: 'BK-CANCELLED',
        relation_type: 'banquet_activity'
    }], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-ROOT/banquet-summary?businessContext=event_genix&groupId=BQ-ROOT`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        const activityRows = data.orderRows.filter(row => row.type === 'activity');
        assert.deepEqual(activityRows.map(row => row.bookingId), ['BK-ACTIVE']);
        assert.equal(data.totals.activitySubtotal, 700);
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: null,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Banquet root',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-ROOT',
            business_context: 'event_genix',
            booking_id: 'BK-ROOT',
            role: 'primary',
            sort_order: 10
        }, {
            id: 2,
            group_id: 'BQ-ROOT',
            business_context: 'event_genix',
            booking_id: 'BK-ACTIVE',
            role: 'activity',
            sort_order: 20
        }, {
            id: 3,
            group_id: 'BQ-ROOT',
            business_context: 'event_genix',
            booking_id: 'BK-CANCELLED',
            role: 'activity',
            sort_order: 30
        }]
    });
});

test('DELETE booking detaches cancelled banquet activity from group while keeping primary root', async () => {
    await withApp([
        bookingRow({ id: 'BK-ROOT', time: '12:00', label: 'Banquet root', program_name: 'Banquet root', category: 'banquet', room: 'Room A', price: 1000 }),
        bookingRow({ id: 'BK-ACTIVE', time: '13:00', label: 'Foam show', program_name: 'Foam show', category: 'activity', room: 'Room A', price: 700 }),
        bookingRow({ id: 'BK-ACTIVE-CHILD', time: '13:00', label: 'Foam show second host', program_name: 'Foam show second host', category: 'activity', room: 'Room A', price: 0, linked_to: 'BK-ACTIVE' })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-ROOT',
        booking_b_id: 'BK-ACTIVE',
        relation_type: 'banquet_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-ACTIVE?businessContext=event_genix`, { method: 'DELETE' });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(state.rows.find(row => row.id === 'BK-ACTIVE').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-ACTIVE-CHILD').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-ROOT').status, 'confirmed');
        assert.deepEqual(state.banquetMemberships.map(row => row.booking_id), ['BK-ROOT']);
        assert.equal(state.links.length, 0);
        assert.equal(state.banquetGroups[0].updated_by, 'banquet-test');
        assert.ok(state.histories.some(item => item.action === 'banquet_group_booking_detached'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: null,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Banquet root',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-ROOT',
            business_context: 'event_genix',
            booking_id: 'BK-ROOT',
            role: 'primary',
            sort_order: 10
        }, {
            id: 2,
            group_id: 'BQ-ROOT',
            business_context: 'event_genix',
            booking_id: 'BK-ACTIVE',
            role: 'activity',
            sort_order: 20
        }]
    });
});
