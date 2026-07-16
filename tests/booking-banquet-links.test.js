const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

test('banquet guest arrival migration adds a nullable HH:mm field outside db startup schema', () => {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '284_banquet_guest_arrival.sql'), 'utf8');
    const dbStartup = fs.readFileSync(path.join(__dirname, '..', 'db', 'index.js'), 'utf8');

    assert.match(migration, /MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /SAFETY:/i);
    assert.match(migration, /ROLLBACK:/i);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS guest_arrival_time VARCHAR\(5\)/i);
    assert.match(migration, /guest_arrival_time IS NULL/i);
    assert.match(migration, /\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$/);
    assert.doesNotMatch(migration, /guest_arrival_time[^;]*NOT NULL/i);
    assert.doesNotMatch(dbStartup, /guest_arrival_time/i);
});

test('frontend arrival API uses the dedicated PATCH endpoint', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');

    assert.match(apiSource, /async function apiUpdateBanquetGuestArrival\(groupId, guestArrivalTime, updatedAt, options = \{\}\)/);
    assert.match(apiSource, /timelineApiUrl\(`\/banquets\/\$\{encodeURIComponent\(groupId\)\}\/arrival`, \{/);
    assert.match(apiSource, /businessContext: options\.businessContext/);
    assert.match(apiSource, /method:\s*'PATCH'/);
    assert.match(apiSource, /timelineApiPayload\(\{ guestArrivalTime, updatedAt \}\)/);
});

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
        '../services/productPricing',
        '../services/telegram',
        '../services/bookingAutomation',
        '../services/websocket',
        '../services/eventBus',
        '../routes/dashboard',
        '../routes/bookings',
        '../routes/banquets'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function banquetTermsPriceRuleRows() {
    return [
        { code: 'banquet_own_cake_fee', value: 500 },
        { code: 'banquet_cork_fee', value: 100 },
        { code: 'banquet_menu_correction_deadline_days', value: 3 },
        { code: 'banquet_date_change_deadline_days', value: 5 },
        { code: 'banquet_entry_weekday_child', value: 300 },
        { code: 'banquet_entry_weekend_child', value: 400 }
    ];
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

function cloneStateValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function bookingRowFromMemberInsert(params) {
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
        pinata_filler: params[14],
        pinata_mode: params[15],
        pinata_number: params[16],
        pinata_filler_number: params[17],
        client_pinata_service_price: params[18],
        client_pinata_service_note: params[19],
        costume: params[20],
        room: params[21],
        notes: params[22],
        created_by: params[23],
        linked_to: null,
        status: params[24] || 'confirmed',
        kids_count: params[25],
        group_name: null,
        extra_data: params[26],
        skip_notification: params[27],
        customer_id: params[28],
        payment_method: params[29],
        banquet_guests: params[30],
        banquet_adults: params[31],
        banquet_tables: params[32],
        banquet_menu: params[33],
        created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        updated_at: new Date('2099-01-01T00:00:00Z').toISOString()
    };
}

function bookingRowFromRootActivityInsert(params) {
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
        pinata_filler: params[14],
        pinata_mode: params[15],
        pinata_number: params[16],
        pinata_filler_number: params[17],
        client_pinata_service_price: params[18],
        client_pinata_service_note: params[19],
        costume: params[20],
        room: params[21],
        notes: params[22],
        created_by: params[23],
        linked_to: null,
        status: params[24] || 'confirmed',
        kids_count: params[25],
        group_name: params[26],
        extra_data: params[27],
        skip_notification: params[28],
        customer_id: params[29],
        payment_method: params[30],
        banquet_guests: null,
        banquet_adults: null,
        banquet_tables: null,
        banquet_menu: null,
        created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
        updated_at: new Date('2099-01-01T00:00:00Z').toISOString()
    };
}

function makeDb(rows, links = [], options = {}) {
    const state = {
        rows: rows.map(row => ({ ...row })),
        links: links.map((link, index) => ({ id: index + 1, relation_type: 'banquet_activity', ...link })),
        banquetGroups: (Array.isArray(options.banquetGroups) ? options.banquetGroups : []).map(group => ({ ...group })),
        banquetMemberships: (Array.isArray(options.banquetMemberships) ? options.banquetMemberships : []).map(row => ({ ...row })),
        banquetDeposits: (Array.isArray(options.banquetDeposits) ? options.banquetDeposits : []).map(row => ({ ...row })),
        customers: (Array.isArray(options.customers) ? options.customers : []).map(row => ({ ...row })),
        customerChildren: (Array.isArray(options.customerChildren) ? options.customerChildren : []).map(row => ({ ...row })),
        histories: [],
        tx: [],
        queries: [],
        nextLinkId: links.length + 1,
        nextBanquetMembershipId: (Array.isArray(options.banquetMemberships) ? options.banquetMemberships.length : 0) + 1,
        released: 0
    };
    let txSnapshot = null;

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        state.queries.push({ sql, params });
        const normalizeContext = value => {
            const raw = String(value || 'event_genix').trim().toLowerCase();
            return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
        };
        if (sql === 'BEGIN') {
            state.tx.push(sql);
            txSnapshot = {
                rows: cloneStateValue(state.rows),
                links: cloneStateValue(state.links),
                banquetGroups: cloneStateValue(state.banquetGroups),
                banquetMemberships: cloneStateValue(state.banquetMemberships),
                banquetDeposits: cloneStateValue(state.banquetDeposits),
                customerChildren: cloneStateValue(state.customerChildren),
                histories: cloneStateValue(state.histories),
                nextLinkId: state.nextLinkId,
                nextBanquetMembershipId: state.nextBanquetMembershipId
            };
            return { rows: [], rowCount: 0 };
        }
        if (sql === 'COMMIT') {
            state.tx.push(sql);
            txSnapshot = null;
            return { rows: [], rowCount: 0 };
        }
        if (sql === 'ROLLBACK') {
            state.tx.push(sql);
            if (txSnapshot) {
                state.rows = cloneStateValue(txSnapshot.rows);
                state.links = cloneStateValue(txSnapshot.links);
                state.banquetGroups = cloneStateValue(txSnapshot.banquetGroups);
                state.banquetMemberships = cloneStateValue(txSnapshot.banquetMemberships);
                state.banquetDeposits = cloneStateValue(txSnapshot.banquetDeposits);
                state.customerChildren = cloneStateValue(txSnapshot.customerChildren);
                state.histories = cloneStateValue(txSnapshot.histories);
                state.nextLinkId = txSnapshot.nextLinkId;
                state.nextBanquetMembershipId = txSnapshot.nextBanquetMembershipId;
                txSnapshot = null;
            }
            return { rows: [], rowCount: 0 };
        }
        if (/SELECT b\.id, b\.time, b\.duration, b\.label, b\.program_code, b\.program_name, b\.category, b\.extra_data, b\.line_id,\s+bgb\.group_id AS banquet_group_id, bgb\.role AS banquet_group_role\s+FROM bookings b\s+LEFT JOIN banquet_group_bookings bgb/i.test(sql)) {
            const [date, room, businessContext, excludeIds] = params;
            const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
            const rows = state.rows
                .filter(row =>
                    row.date === date &&
                    row.room === room &&
                    normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                    String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                    !excluded.has(String(row.id))
                )
                .map(row => {
                    const membership = state.banquetMemberships.find(item =>
                        item.booking_id === row.id &&
                        normalizeContext(item.business_context) === normalizeContext(businessContext)
                    );
                    return {
                        id: row.id,
                        time: row.time,
                        duration: row.duration,
                        label: row.label,
                        program_code: row.program_code,
                        program_name: row.program_name,
                        category: row.category,
                        extra_data: row.extra_data,
                        line_id: row.line_id,
                        banquet_group_id: membership?.group_id || null,
                        banquet_group_role: membership?.role || null
                    };
                });
            return { rows, rowCount: rows.length };
        }
        if (/SELECT group_id(?:, role)?\s+FROM banquet_group_bookings\s+WHERE booking_id = \$1/i.test(sql)) {
            const [bookingId, businessContext] = params;
            const rows = state.banquetMemberships
                .filter(item =>
                    item.booking_id === bookingId &&
                    normalizeContext(item.business_context) === normalizeContext(businessContext)
                )
                .map(item => ({ group_id: item.group_id, role: item.role }));
            return { rows, rowCount: rows.length };
        }
        if (/FROM bookings b\s+(?:LEFT JOIN[\s\S]+?\s+)?WHERE b\.date = \$1/i.test(sql)) {
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
            const row = state.rows.find(item =>
                item.id === params[0]
                && (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT b\.\* FROM bookings b\s+WHERE b\.id = \$1(?:\s+AND (?:COALESCE\(b\.business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)?\s+LIMIT 1$/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            const row = state.rows.find(item =>
                item.id === params[0]
                && (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT b\.\*\s+FROM bookings b\s+WHERE b\.id = \$1[\s\S]+FOR UPDATE$/i.test(sql)) {
            const businessContext = params.length > 1 ? params[1] : null;
            const row = state.rows.find(item =>
                item.id === params[0]
                && (!businessContext || normalizeContext(item.business_context) === normalizeContext(businessContext))
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT \* FROM bookings WHERE id = ANY\(\$1::text\[\]\)(?: AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\)[\s\S]+?END) = \$2)? FOR UPDATE/i.test(sql)) {
            const ids = new Set(params[0] || []);
            const businessContext = params.length > 1 ? params[1] : null;
            return {
                rows: state.rows.filter(row =>
                    ids.has(row.id) &&
                    (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
                )
            };
        }
        if (/FROM banquet_groups bg LEFT JOIN LATERAL/i.test(sql)) {
            const [businessContext, date, customerId] = params;
            const groups = state.banquetGroups
                .filter(group =>
                    group.date === date &&
                    normalizeContext(group.business_context) === normalizeContext(businessContext) &&
                    String(group.status || 'active').toLowerCase() === 'active' &&
                    (Number(group.customer_id) === Number(customerId) || group.customer_id == null)
                )
                .sort((a, b) => {
                    const aKind = Number(a.customer_id) === Number(customerId) ? 0 : 1;
                    const bKind = Number(b.customer_id) === Number(customerId) ? 0 : 1;
                    if (aKind !== bKind) return aKind - bKind;
                    const aPrimary = state.rows.find(row => row.id === a.primary_booking_id) || {};
                    const bPrimary = state.rows.find(row => row.id === b.primary_booking_id) || {};
                    return String(aPrimary.time || '99:99').localeCompare(String(bPrimary.time || '99:99'));
                })
                .map(group => {
                    const roles = [...new Set(state.banquetMemberships
                        .filter(row => row.group_id === group.id && normalizeContext(row.business_context) === normalizeContext(businessContext))
                        .map(row => row.role)
                        .filter(Boolean))].sort();
                    const primary = state.rows.find(row =>
                        row.id === group.primary_booking_id &&
                        normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                        row.status !== 'cancelled'
                    );
                    return {
                        ...group,
                        candidate_kind: Number(group.customer_id) === Number(customerId) ? 'customer' : 'unassigned',
                        roles,
                        member_count: state.banquetMemberships.filter(row => row.group_id === group.id).length,
                        primary_booking_row_id: primary?.id || null,
                        primary_booking_business_context: primary?.business_context || null,
                        primary_booking_date: primary?.date || null,
                        primary_booking_time: primary?.time || null,
                        primary_booking_room: primary?.room || null,
                        primary_booking_label: primary?.label || null,
                        primary_booking_program_name: primary?.program_name || null,
                        primary_booking_line_id: primary?.line_id || null,
                        primary_booking_second_animator: primary?.second_animator || null,
                        primary_booking_created_by: primary?.created_by || null,
                        primary_booking_customer_id: primary?.customer_id || null,
                        primary_booking_status: primary?.status || null
                    };
                });
            return { rows: groups, rowCount: groups.length };
        }
        if (/SELECT bgb\.\*, bg\.primary_booking_id, bg\.status AS group_status\s+FROM banquet_group_bookings bgb\s+JOIN banquet_groups bg ON bg\.id = bgb\.group_id/i.test(sql)) {
            const [bookingId, businessContext] = params;
            const membership = state.banquetMemberships.find(item =>
                item.booking_id === bookingId &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
            );
            if (!membership) return { rows: [], rowCount: 0 };
            const group = state.banquetGroups.find(item =>
                item.id === membership.group_id &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
            );
            return {
                rows: group ? [{
                    ...membership,
                    primary_booking_id: group.primary_booking_id,
                    group_status: group.status || 'active'
                }] : [],
                rowCount: group ? 1 : 0
            };
        }
        if (/SELECT bg\.\* FROM banquet_group_bookings bgb\s+JOIN banquet_groups bg ON bg\.id = bgb\.group_id/i.test(sql)) {
            const membership = state.banquetMemberships.find(item => item.booking_id === params[0]);
            if (!membership) return { rows: [], rowCount: 0 };
            const group = state.banquetGroups.find(item => item.id === membership.group_id);
            return { rows: group ? [{ ...group }] : [], rowCount: group ? 1 : 0 };
        }
        if (/SELECT bgb\.\*\s+FROM banquet_group_bookings bgb\s+WHERE bgb\.group_id = \$1\s+AND bgb\.booking_id = \$2/i.test(sql)) {
            const rows = state.banquetMemberships
                .filter(item => item.group_id === params[0] && item.booking_id === params[1])
                .map(row => ({ ...row }));
            return { rows, rowCount: rows.length };
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
            const group = state.banquetGroups.find(item =>
                item.id === params[0]
                && normalizeContext(item.business_context) === normalizeContext(params[1])
            );
            return { rows: group ? [{ ...group }] : [], rowCount: group ? 1 : 0 };
        }
        if (/SELECT bg\.\*\s+FROM banquet_groups bg\s+WHERE bg\.primary_booking_id = \$1/i.test(sql)) {
            const [primaryBookingId, businessContext] = params;
            const group = state.banquetGroups.find(item =>
                item.primary_booking_id === primaryBookingId &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
            );
            return { rows: group ? [{ ...group }] : [], rowCount: group ? 1 : 0 };
        }
        if (/SELECT b\.\*\s+FROM bookings b\s+WHERE b\.id = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const ids = new Set((params[0] || []).map(String));
            const businessContext = params[1];
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
            const rows = state.rows.filter(row =>
                row.linked_to
                && parentIds.has(String(row.linked_to))
                && (!businessContext || normalizeContext(row.business_context) === normalizeContext(businessContext))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id, time, duration, label, program_code FROM bookings WHERE date = \$1 AND room = \$2/i.test(sql)) {
            const [date, room, businessContext, excludeIds] = params;
            const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
            const rows = state.rows.filter(row =>
                row.date === date &&
                row.room === room &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                !excluded.has(String(row.id))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id, time, duration, label, program_code FROM bookings WHERE date = \$1 AND line_id = \$2/i.test(sql)) {
            const [date, lineId, businessContext, excludeId] = params;
            const excluded = new Set((Array.isArray(excludeId) ? excludeId : [excludeId]).filter(Boolean).map(String));
            const rows = state.rows.filter(row =>
                row.date === date &&
                row.line_id === lineId &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                !excluded.has(String(row.id))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id, category, time, duration FROM bookings WHERE date = \$1 AND program_id = \$2/i.test(sql)) {
            const [date, programId, businessContext, excludeId] = params;
            const excluded = new Set((Array.isArray(excludeId) ? excludeId : [excludeId]).filter(Boolean).map(String));
            const rows = state.rows
                .filter(row =>
                    row.date === date &&
                    row.program_id === programId &&
                    normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                    String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                    !excluded.has(String(row.id))
                )
                .map(row => ({
                    id: row.id,
                    category: row.category,
                    time: row.time,
                    duration: row.duration
                }));
            return { rows, rowCount: rows.length };
        }
        if (/^INSERT INTO bookings /i.test(sql) && /RETURNING \*/i.test(sql)) {
            const row = params.length >= 34
                ? bookingRowFromMemberInsert(params)
                : bookingRowFromRootActivityInsert(params);
            state.rows.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/INSERT INTO banquet_groups/i.test(sql) && /RETURNING \*/i.test(sql)) {
            let meta = {};
            try {
                meta = typeof params[9] === 'string' ? JSON.parse(params[9]) : (params[9] || {});
            } catch {
                meta = {};
            }
            const row = {
                id: params[0],
                business_context: params[1],
                primary_booking_id: params[2],
                customer_id: params[3],
                date: params[4],
                room: params[5],
                guest_arrival_time: params[6],
                group_name: params[7],
                status: 'active',
                source: params[8],
                meta,
                created_by_user_id: params[10],
                created_by: params[11],
                updated_by: params[11],
                created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
                updated_at: new Date('2099-01-01T00:00:00Z').toISOString()
            };
            state.banquetGroups.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/INSERT INTO banquet_group_bookings/i.test(sql)) {
            if (options.failBanquetMembershipInsert) {
                throw new Error('simulated banquet membership insert failure');
            }
            const constantRoleMembership = sql.match(/VALUES \(\$1, \$2, \$3, '([^']+)',\s*(\d+), \$4, \$5\)/i);
            const constantRoleDynamicSort = sql.match(/VALUES \(\$1, \$2, \$3, '([^']+)', \$4, \$5, \$6\)/i);
            const row = {
                id: state.nextBanquetMembershipId++,
                group_id: params[0],
                business_context: params[1],
                booking_id: params[2],
                role: constantRoleMembership
                    ? constantRoleMembership[1]
                    : (constantRoleDynamicSort ? constantRoleDynamicSort[1] : params[3]),
                sort_order: constantRoleMembership
                    ? Number(constantRoleMembership[2])
                    : (constantRoleDynamicSort ? params[3] : params[4]),
                created_by_user_id: constantRoleMembership
                    ? params[3]
                    : (constantRoleDynamicSort ? params[4] : params[5]),
                created_by: constantRoleMembership
                    ? params[4]
                    : (constantRoleDynamicSort ? params[5] : params[6]),
                created_at: new Date('2099-01-01T00:00:00Z').toISOString(),
                updated_at: new Date('2099-01-01T00:00:00Z').toISOString()
            };
            state.banquetMemberships.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
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
        if (/DELETE FROM booking_banquet_links/i.test(sql) && /booking_a_id = \$3\s+AND booking_b_id = \$2/i.test(sql) && !/\bOR\b/i.test(sql)) {
            const [businessContext, bookingA, bookingB, relationType] = params;
            const before = state.links.length;
            state.links = state.links.filter(link =>
                !(
                    link.business_context === businessContext &&
                    link.booking_a_id === bookingB &&
                    link.booking_b_id === bookingA &&
                    link.relation_type === relationType
                )
            );
            return { rows: [], rowCount: before - state.links.length };
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
        if (/UPDATE banquet_groups SET customer_id=\$3, date=\$4, room=\$5, group_name=\$6, updated_at=NOW\(\), updated_by=\$7/i.test(sql)) {
            const group = state.banquetGroups.find(item =>
                item.id === params[0]
                && normalizeContext(item.business_context) === normalizeContext(params[1])
            );
            if (!group) return { rows: [], rowCount: 0 };
            group.customer_id = params[2];
            group.date = params[3];
            group.room = params[4];
            group.group_name = params[5];
            group.updated_by = params[6];
            group.updated_at = options.nextGroupUpdatedAt || '2099-03-01T00:00:00.000Z';
            return { rows: [{ ...group }], rowCount: 1 };
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
        if (/UPDATE banquet_groups\s+SET guest_arrival_time = \$3,\s+updated_at = NOW\(\),\s+updated_by = \$4/i.test(sql)) {
            const group = state.banquetGroups.find(item =>
                item.id === params[0]
                && normalizeContext(item.business_context) === normalizeContext(params[1])
            );
            if (!group) return { rows: [], rowCount: 0 };
            group.guest_arrival_time = params[2];
            group.updated_by = params[3];
            group.updated_at = options.nextGroupUpdatedAt || '2099-03-01T00:00:00.000Z';
            return { rows: [{ ...group }], rowCount: 1 };
        }
        if (/FROM customers/i.test(sql)) {
            const [customerId, businessContext] = params;
            const customer = state.customers.find(row =>
                Number(row.id) === Number(customerId)
                && normalizeContext(row.business_context || 'event_genix') === normalizeContext(businessContext)
            );
            return { rows: customer ? [{ ...customer }] : [], rowCount: customer ? 1 : 0 };
        }
        if (/FROM customer_children/i.test(sql)) {
            const [customerId, businessContext] = params;
            const rows = state.customerChildren
                .filter(row => Number(row.customer_id) === Number(customerId))
                .filter(row => normalizeContext(row.business_context || 'event_genix') === normalizeContext(businessContext))
                .slice()
                .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || (Number(a.id || 0) - Number(b.id || 0)));
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/UPDATE bookings SET status\s*=\s*'cancelled', updated_at\s*=\s*NOW\(\)\s+WHERE \(id\s*=\s*\$1 OR linked_to\s*=\s*\$1\)/i.test(sql)) {
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
        if (/UPDATE bookings SET date=\$1, time=\$2, line_id=\$3, program_id=\$4, program_code=\$5,[\s\S]+banquet_menu=\$33, updated_at=NOW\(\) WHERE id=\$34/i.test(sql)) {
            const row = state.rows.find(item =>
                item.id === params[33]
                && normalizeContext(item.business_context) === normalizeContext(params[34])
            );
            if (!row) return { rows: [], rowCount: 0 };
            Object.assign(row, {
                date: params[0], time: params[1], line_id: params[2], program_id: params[3], program_code: params[4],
                label: params[5], program_name: params[6], category: params[7], duration: params[8], price: params[9],
                hosts: params[10], second_animator: params[11], pinata_filler: params[12], pinata_mode: params[13],
                pinata_number: params[14], pinata_filler_number: params[15], client_pinata_service_price: params[16],
                client_pinata_service_note: params[17], costume: params[18], room: params[19], notes: params[20],
                created_by: params[21], status: params[22], kids_count: params[23], group_name: params[24],
                extra_data: params[25], skip_notification: params[26], customer_id: params[27], payment_method: params[28],
                banquet_guests: params[29], banquet_adults: params[30], banquet_tables: params[31], banquet_menu: params[32],
                updated_at: new Date('2099-01-01T00:02:00Z').toISOString()
            });
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/UPDATE bookings SET date=\$1, time=\$2, duration=\$3, status=\$4, room=\$5,[\s\S]+WHERE linked_to=\$12/i.test(sql)) {
            let rowCount = 0;
            state.rows.forEach(row => {
                if (String(row.linked_to || '') !== String(params[11])) return;
                row.date = params[0];
                row.time = params[1];
                row.duration = params[2];
                row.status = params[3];
                row.room = params[4];
                row.pinata_filler = params[5];
                row.pinata_mode = params[6];
                row.client_pinata_service_price = params[7];
                row.client_pinata_service_note = params[8];
                row.pinata_number = params[9];
                row.pinata_filler_number = params[10];
                rowCount += 1;
            });
            return { rows: [], rowCount };
        }
        if (/UPDATE bookings SET extra_data=\$1, updated_at=NOW\(\) WHERE id=\$2/i.test(sql)) {
            const row = state.rows.find(item =>
                item.id === params[1]
                && normalizeContext(item.business_context) === normalizeContext(params[2])
            );
            if (!row) return { rows: [], rowCount: 0 };
            row.extra_data = params[0];
            row.updated_at = new Date('2099-01-01T00:03:00Z').toISOString();
            return { rows: [], rowCount: 1 };
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
        if (/FROM price_rules\s+WHERE code = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const requested = new Set(params[0] || []);
            return {
                rows: banquetTermsPriceRuleRows().filter(row => requested.has(row.code))
            };
        }
        if (/FROM banquet_deposits/i.test(sql)) {
            const [businessContext, identityValue] = params;
            const byGroup = /banquet_group_id = \$2/i.test(sql);
            const byGroupOrBooking = byGroup && /primary_booking_id = \$3/i.test(sql);
            const statusRank = status => ({
                accountant_verified: 0,
                corrected: 1,
                manager_reported: 2,
                needs_booking_link: 3
            }[status] ?? 9);
            const rows = state.banquetDeposits
                .filter(row => normalizeContext(row.business_context) === normalizeContext(businessContext))
                .filter(row => byGroupOrBooking
                    ? String(row.banquet_group_id) === String(params[1]) || String(row.primary_booking_id) === String(params[2])
                    : String(byGroup ? row.banquet_group_id : row.primary_booking_id) === String(identityValue))
                .sort((a, b) =>
                    (byGroupOrBooking ? Number(String(a.banquet_group_id) !== String(params[1])) - Number(String(b.banquet_group_id) !== String(params[1])) : 0)
                    ||
                    statusRank(a.status) - statusRank(b.status)
                    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
                    || Number(b.id || 0) - Number(a.id || 0)
                );
            return { rows: rows.slice(0, 1).map(row => ({ ...row })), rowCount: rows.length ? 1 : 0 };
        }
        if (/FROM timeline_resources/i.test(sql)) {
            const rows = [
                { id: 1, business_context: 'event_genix', resource_id: 'room-a', type: 'room', name: 'Room A', short_name: 'Room A', color: '#6366F1', capacity: null, equipment: [], metadata: {}, is_active: true, sort_order: 10 },
                { id: 2, business_context: 'event_genix', resource_id: 'room-b', type: 'room', name: 'Room B', short_name: 'Room B', color: '#8B5CF6', capacity: null, equipment: [], metadata: {}, is_active: true, sort_order: 20 }
            ];
            return { rows, rowCount: rows.length };
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
        canEditBooking: (...args) => options.canEditBooking ? options.canEditBooking(...args) : true,
        canViewBooking: (...args) => options.canViewBooking ? options.canViewBooking(...args) : true
    });
    installMock('../services/telegram', { notifyTelegram: async () => null });
    installMock('../services/bookingAutomation', { processBookingAutomation: async () => null });
    installMock('../services/websocket', { broadcastBookingEvent: () => null });
    installMock('../services/eventBus', { publish: () => null });
    installMock('../routes/dashboard', { triggerAlertBroadcast: () => null });
    if (options.mockProductPricing) {
        installMock('../services/productPricing', {
            applyEffectiveBookingPrice: async (_db, booking) => {
                booking.extraData = booking.extraData || {};
                booking.extraData.priceSnapshot = {
                    productId: booking.programId || null,
                    finalPrice: Number(booking.price || 0),
                    source: 'test_price'
                };
                return booking.extraData.priceSnapshot;
            },
            refreshMultiActivityPriceTotals: () => null
        });
    }

    const app = express();
    app.use(express.json());
    app.use('/api/bookings', require('../routes/bookings'));
    app.use('/api/banquets', require('../routes/banquets'));
    const { server, baseUrl } = await listen(app);
    try {
        await fn({ baseUrl, state });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

function activityFirstSourceBooking(overrides = {}) {
    return bookingRow({
        id: 'BK-ACTIVITY-FIRST',
        time: '12:45',
        line_id: 'line-rock',
        program_id: 'program-paper-neon',
        program_code: 'PAPER_NEON',
        label: 'Paper neon show',
        program_name: 'Paper neon show',
        category: 'activity',
        duration: 60,
        price: 2900,
        hosts: 1,
        room: 'Room A',
        notes: 'activity note that must not copy to kitchen',
        group_name: null,
        kids_count: 12,
        customer_id: 101,
        extra_data: JSON.stringify({
            bookingWorkspace: {
                scenario: 'activity_first',
                comments: { activity: 'activity workspace comment that must stay on source' }
            }
        }),
        ...overrides
    });
}

function sourceKitchenPayload(overrides = {}) {
    const { booking = {}, ...rest } = overrides;
    return {
        sourceBookingId: 'BK-ACTIVITY-FIRST',
        role: 'kitchen',
        booking: {
            date: '2099-06-01',
            time: '12:45',
            lineId: 'banquet-service',
            room: 'Room A',
            programCode: 'KITCHEN',
            label: 'Kitchen order',
            programName: 'Kitchen order',
            category: 'kitchen',
            duration: 60,
            price: 1000,
            hosts: 0,
            programBasePrice: 0,
            customerId: 101,
            banquetGuests: 12,
            banquetAdults: 8,
            banquetTables: 2,
            banquetMenu: 'Pizza x 4',
            extraData: {
                bookingWorkspace: {
                    scenario: 'kitchen_only',
                    comments: { kitchen: 'Kitchen comment' }
                },
                bookingPackage: {
                    menuPositions: [
                        { id: 'pizza', title: 'Pizza', quantity: 4, unitPrice: 250, subtotal: 1000 }
                    ]
                }
            },
            ...booking
        },
        ...rest
    };
}

async function postSourceMemberBooking(baseUrl, payload) {
    const res = await fetch(`${baseUrl}/api/banquets/from-source/member-booking?businessContext=event_genix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...payload,
            banquetContext: payload.banquetContext || { mode: 'new', groupId: null, guestArrivalTime: '12:30' }
        })
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { raw: text };
    }
    return { res, data };
}

async function postSourceActivityBooking(baseUrl, payload) {
    const res = await fetch(`${baseUrl}/api/banquets/from-source/activity-booking?businessContext=event_genix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...payload,
            banquetContext: payload.banquetContext || { mode: 'new', groupId: null, guestArrivalTime: '12:30' }
        })
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { raw: text };
    }
    return { res, data };
}

async function getTimelineBookings(baseUrl, date = '2099-06-01', timelineView = 'animators') {
    const suffix = timelineView ? `?timelineView=${encodeURIComponent(timelineView)}&businessContext=event_genix` : '?businessContext=event_genix';
    const res = await fetch(`${baseUrl}/api/bookings/${date}${suffix}`);
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.ok(Array.isArray(data), 'timeline bookings response should be an array');
    return data;
}

function timelineBooking(rows, id) {
    const row = rows.find(item => String(item.id) === String(id));
    assert.ok(row, `timeline booking ${id} should be present`);
    return row;
}

function timelineBookingAbsent(rows, id) {
    assert.equal(rows.some(item => String(item.id) === String(id)), false, `timeline booking ${id} should be absent`);
}

function assertTimelineProjection(row, expected = {}) {
    assert.ok(row.timelineProjection, `${row.id} should carry timelineProjection`);
    for (const [key, value] of Object.entries(expected)) {
        assert.equal(row.timelineProjection[key], value, `${row.id}.timelineProjection.${key}`);
    }
}

function assertNoDuplicateBanquetReadModel(state, groupId, expectedBookingIds = []) {
    const groups = state.banquetGroups.filter(group => String(group.id) === String(groupId));
    assert.equal(groups.length, 1, `banquet group ${groupId} should exist once`);
    for (const bookingId of expectedBookingIds) {
        const memberships = state.banquetMemberships.filter(row =>
            String(row.group_id) === String(groupId) &&
            String(row.booking_id) === String(bookingId)
        );
        assert.equal(memberships.length, 1, `booking ${bookingId} should have one membership in ${groupId}`);
    }
    const linkKeys = state.links.map(link => [
        link.business_context,
        [link.booking_a_id, link.booking_b_id].map(String).sort().join('::'),
        link.relation_type
    ].join('|'));
    assert.equal(new Set(linkKeys).size, linkKeys.length, 'compatibility links should not contain duplicate pairs');
}

async function patchBanquetArrival(baseUrl, groupId, payload, businessContext = 'event_genix') {
    const res = await fetch(`${baseUrl}/api/banquets/${encodeURIComponent(groupId)}/arrival?businessContext=${encodeURIComponent(businessContext)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
}

function assertBanquetArrival(snapshot, expected) {
    assert.ok(snapshot?.arrival, 'banquet snapshot should expose arrival');
    assert.deepEqual(snapshot.arrival, expected);
    assert.deepEqual(snapshot.banquetArrival, expected);
}

function kitchenFirstSourceBooking(overrides = {}) {
    return bookingRow({
        id: 'BK-KITCHEN-FIRST',
        time: '13:15',
        line_id: 'banquet-service',
        program_id: null,
        program_code: 'KITCHEN',
        label: 'Kitchen order',
        program_name: 'Kitchen order',
        category: 'kitchen',
        duration: 60,
        price: 4600,
        hosts: 0,
        room: 'Room A',
        notes: null,
        group_name: null,
        kids_count: 12,
        customer_id: 101,
        banquet_guests: 12,
        banquet_adults: 8,
        banquet_tables: 2,
        banquet_menu: 'Pizza - 4 portions',
        extra_data: JSON.stringify({
            bookingWorkspace: {
                scenario: 'kitchen_only',
                comments: { kitchen: 'Kitchen source comment' }
            },
            bookingPackage: {
                menuPositions: [
                    { id: 'pizza', title: 'Pizza', quantity: 4, unitPrice: 250, subtotal: 1000 }
                ]
            }
        }),
        ...overrides
    });
}

function sourceActivityPayload(overrides = {}) {
    const { booking = {}, linkedBookings = [], ...rest } = overrides;
    return {
        sourceBookingId: 'BK-KITCHEN-FIRST',
        booking: {
            date: '2099-06-01',
            time: '13:15',
            lineId: 'line-activity-new',
            room: 'Room A',
            programId: 'program-mafia',
            programCode: 'MAFIA',
            label: 'Mafia',
            programName: 'Mafia',
            category: 'animation',
            duration: 60,
            price: 3000,
            hosts: 1,
            customerId: 101,
            kidsCount: 12,
            extraData: {
                bookingWorkspace: {
                    scenario: 'event',
                    comments: { activity: 'Activity comment' }
                }
            },
            ...booking
        },
        linkedBookings,
        ...rest
    };
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

test('GET bookings returns canonical animator timelineProjection for activity, kitchen, linked, and legacy rows', async () => {
    await withApp([
        activityFirstSourceBooking(),
        kitchenFirstSourceBooking(),
        bookingRow({
            id: 'BK-LINKED-CHILD',
            time: '12:45',
            line_id: 'line-child',
            linked_to: 'BK-ACTIVITY-FIRST',
            label: 'Linked helper animator',
            room: 'Room A',
            extra_data: JSON.stringify({
                timelineIdentity: {
                    resourceId: 'line-child',
                    lineId: 'line-child',
                    resourceType: 'animator',
                    resourceName: 'Helper Animator',
                    source: 'linked_booking_line'
                }
            })
        }),
        bookingRow({
            id: 'BK-LINKED-NESTED-IDENTITY',
            time: '13:45',
            line_id: null,
            linked_to: 'BK-ACTIVITY-FIRST',
            label: 'Linked nested identity animator',
            room: 'Room A',
            extra_data: JSON.stringify({
                timelineIdentity: {
                    resourceId: 'line-nested',
                    lineId: 'line-nested',
                    resourceType: 'animator',
                    resourceName: 'Nested Animator',
                    source: 'linked_booking_line'
                }
            })
        }),
        bookingRow({
            id: 'BK-LINKED-ORPHAN',
            time: '14:15',
            line_id: null,
            linked_to: 'BK-ACTIVITY-FIRST',
            label: 'Linked orphan animator',
            room: 'Room A',
            extra_data: null
        }),
        bookingRow({
            id: 'BK-LEGACY-LINE',
            time: '15:00',
            line_id: 'legacy-line-1',
            room: 'Room B',
            extra_data: null
        })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));

        const activity = data.find(item => item.id === 'BK-ACTIVITY-FIRST');
        assert.deepEqual(activity.timelineProjection, {
            timelineView: 'animators',
            view: 'animators',
            resourceType: 'animator',
            resourceId: 'line-rock',
            resourceName: null,
            lineId: 'line-rock',
            sourceLineId: 'line-rock',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null,
            businessContext: 'event_genix',
            date: '2099-06-01',
            legacyRoomName: null,
            roomResourceStatus: null,
            diagnosticReason: null,
            assignmentAllowed: true
        });

        const kitchen = data.find(item => item.id === 'BK-KITCHEN-FIRST');
        assert.equal(kitchen.timelineProjection.timelineView, 'animators');
        assert.equal(kitchen.timelineProjection.resourceType, 'service');
        assert.equal(kitchen.timelineProjection.resourceId, 'banquet-service');
        assert.equal(kitchen.timelineProjection.lineId, 'banquet-service');
        assert.equal(kitchen.timelineProjection.visibleInAnimatorTimeline, false);
        assert.equal(kitchen.timelineProjection.visibleInRoomTimeline, true);
        assert.equal(kitchen.timelineProjection.displaySurface, 'hidden');
        assert.equal(kitchen.timelineProjection.hiddenReason, 'banquet_service_hidden_from_animator');

        const linked = data.find(item => item.id === 'BK-LINKED-CHILD');
        assert.equal(linked.timelineProjection.resourceId, 'line-child');
        assert.equal(linked.timelineProjection.lineId, 'line-child');
        assert.equal(linked.timelineProjection.visibleInAnimatorTimeline, true);
        assert.equal(linked.timelineProjection.visibleInRoomTimeline, false);

        const nestedIdentity = data.find(item => item.id === 'BK-LINKED-NESTED-IDENTITY');
        assert.equal(nestedIdentity.timelineProjection.resourceId, 'line-nested');
        assert.equal(nestedIdentity.timelineProjection.lineId, 'line-nested');
        assert.equal(nestedIdentity.timelineProjection.resourceName, 'Nested Animator');
        assert.equal(nestedIdentity.timelineProjection.visibleInAnimatorTimeline, true);
        assert.equal(nestedIdentity.timelineProjection.visibleInRoomTimeline, false);
        assert.equal(nestedIdentity.timelineProjection.displaySurface, 'booking_block');
        assert.equal(nestedIdentity.timelineProjection.hiddenReason, null);

        const orphan = data.find(item => item.id === 'BK-LINKED-ORPHAN');
        assert.equal(orphan.timelineProjection.resourceId, null);
        assert.equal(orphan.timelineProjection.lineId, null);
        assert.equal(orphan.timelineProjection.visibleInAnimatorTimeline, false);
        assert.equal(orphan.timelineProjection.displaySurface, 'hidden');
        assert.equal(orphan.timelineProjection.hiddenReason, 'missing_animator_resource');

        const legacy = data.find(item => item.id === 'BK-LEGACY-LINE');
        assert.equal(legacy.timelineProjection.resourceId, 'legacy-line-1');
        assert.equal(legacy.timelineProjection.resourceType, 'animator');
        assert.equal(legacy.timelineProjection.visibleInAnimatorTimeline, true);
    });
});

test('GET bookings room view projects activity and kitchen rows through the same room identity contract', async () => {
    await withApp([
        activityFirstSourceBooking(),
        kitchenFirstSourceBooking(),
        bookingRow({
            id: 'BK-LINKED-ROOM-CHILD',
            time: '12:45',
            line_id: 'line-child',
            linked_to: 'BK-ACTIVITY-FIRST',
            room: 'Room A'
        })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/2099-06-01?timelineView=rooms`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.some(item => item.id === 'BK-LINKED-ROOM-CHILD'), false);
        assert.equal(data.filter(item => item.id === 'BK-ACTIVITY-FIRST').length, 1);
        assert.equal(data.filter(item => item.id === 'BK-KITCHEN-FIRST').length, 1);

        const activity = data.find(item => item.id === 'BK-ACTIVITY-FIRST');
        assert.equal(activity.resourceId, 'room-a');
        assert.equal(activity.resourceType, 'room');
        assert.equal(activity.timelineProjection.timelineView, 'rooms');
        assert.equal(activity.timelineProjection.resourceId, 'room-a');
        assert.equal(activity.timelineProjection.resourceType, 'room');
        assert.equal(activity.timelineProjection.lineId, 'line-rock');
        assert.equal(activity.timelineProjection.visibleInAnimatorTimeline, true);
        assert.equal(activity.timelineProjection.visibleInRoomTimeline, true);
        assert.equal(activity.timelineProjection.displaySurface, 'booking_block');
        assert.equal(activity.timelineProjection.hiddenReason, null);

        const kitchen = data.find(item => item.id === 'BK-KITCHEN-FIRST');
        assert.equal(kitchen.resourceId, 'room-a');
        assert.equal(kitchen.resourceType, 'room');
        assert.equal(kitchen.timelineProjection.timelineView, 'rooms');
        assert.equal(kitchen.timelineProjection.resourceId, 'room-a');
        assert.equal(kitchen.timelineProjection.resourceType, 'room');
        assert.equal(kitchen.timelineProjection.lineId, 'banquet-service');
        assert.equal(kitchen.timelineProjection.visibleInAnimatorTimeline, false);
        assert.equal(kitchen.timelineProjection.visibleInRoomTimeline, true);
        assert.equal(kitchen.timelineProjection.displaySurface, 'service_marker');
        assert.equal(kitchen.timelineProjection.hiddenReason, null);
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

test('GET banquet candidates returns active same-customer groups with separate unassigned fallback', async () => {
    await withApp([
        bookingRow({ id: 'BK-CUSTOMER-ROOT', time: '12:00', customer_id: 101, label: 'Yurii banquet', program_name: 'Yurii banquet' }),
        bookingRow({ id: 'BK-UNASSIGNED-ROOT', time: '13:00', customer_id: null, label: 'Fallback banquet', program_name: 'Fallback banquet' }),
        bookingRow({ id: 'BK-OTHER-CUSTOMER', time: '14:00', customer_id: 202, label: 'Other customer banquet', program_name: 'Other customer banquet' }),
        bookingRow({ id: 'BK-CANCELLED-GROUP', time: '15:00', customer_id: 101, label: 'Cancelled group root', program_name: 'Cancelled group root' })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/candidates?date=2099-06-01&customerId=101&businessContext=event_genix`);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.customerId, 101);
        assert.deepEqual(data.candidates.map(item => item.groupId), ['BQ-CUSTOMER']);
        assert.deepEqual(data.fallbackCandidates.map(item => item.groupId), ['BQ-UNASSIGNED']);
        assert.equal(data.candidates[0].groupName, 'Yurii banquet');
        assert.equal(data.candidates[0].primaryBookingId, 'BK-CUSTOMER-ROOT');
        assert.equal(data.candidates[0].primaryBooking.id, 'BK-CUSTOMER-ROOT');
        assert.deepEqual(data.candidates[0].roles, ['kitchen', 'primary']);
        assert.equal(data.candidates[0].memberCount, 2);
        assert.equal(data.fallbackCandidates[0].candidateKind, 'unassigned');
        assert.equal(data.candidates.some(item => item.groupId === 'BQ-OTHER'), false);
        assert.equal(data.candidates.some(item => item.groupId === 'BQ-CANCELLED'), false);
        assert.ok(state.queries.some(query => /FROM banquet_groups bg LEFT JOIN LATERAL/i.test(query.sql)));
    }, {
        banquetGroups: [{
            id: 'BQ-CUSTOMER',
            business_context: 'event_genix',
            primary_booking_id: 'BK-CUSTOMER-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
            status: 'active',
            source: 'manual',
            meta: {}
        }, {
            id: 'BQ-UNASSIGNED',
            business_context: 'event_genix',
            primary_booking_id: 'BK-UNASSIGNED-ROOT',
            customer_id: null,
            date: '2099-06-01',
            room: 'Room B',
            group_name: 'Fallback banquet',
            status: 'active',
            source: 'manual',
            meta: {}
        }, {
            id: 'BQ-OTHER',
            business_context: 'event_genix',
            primary_booking_id: 'BK-OTHER-CUSTOMER',
            customer_id: 202,
            date: '2099-06-01',
            room: 'Room C',
            group_name: 'Other customer banquet',
            status: 'active',
            source: 'manual',
            meta: {}
        }, {
            id: 'BQ-CANCELLED',
            business_context: 'event_genix',
            primary_booking_id: 'BK-CANCELLED-GROUP',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room D',
            group_name: 'Cancelled group',
            status: 'cancelled',
            source: 'manual',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-CUSTOMER',
            business_context: 'event_genix',
            booking_id: 'BK-CUSTOMER-ROOT',
            role: 'primary',
            sort_order: 10
        }, {
            id: 2,
            group_id: 'BQ-CUSTOMER',
            business_context: 'event_genix',
            booking_id: 'BK-CUSTOMER-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }, {
            id: 3,
            group_id: 'BQ-UNASSIGNED',
            business_context: 'event_genix',
            booking_id: 'BK-UNASSIGNED-ROOT',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('GET banquet candidates validates date and selected customer', async () => {
    await withApp([], [], async ({ baseUrl }) => {
        const badDate = await fetch(`${baseUrl}/api/banquets/candidates?date=2099-99-99&customerId=101&businessContext=event_genix`);
        const badDateData = await badDate.json();
        assert.equal(badDate.status, 400, JSON.stringify(badDateData));
        assert.equal(badDateData.error, 'Invalid date format');

        const badCustomer = await fetch(`${baseUrl}/api/banquets/candidates?date=2099-06-01&businessContext=event_genix`);
        const badCustomerData = await badCustomer.json();
        assert.equal(badCustomer.status, 400, JSON.stringify(badCustomerData));
        assert.equal(badCustomerData.error, 'Invalid customer ID');
    });
});

test('GET banquet read endpoints prefer persisted group arrival when primary booking time changes', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '14:20',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        }),
        bookingRow({
            id: 'BK-KITCHEN',
            time: '16:00',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen order',
            program_name: 'Kitchen order',
            category: 'kitchen',
            room: 'Room A',
            customer_id: 101,
            extra_data: JSON.stringify({
                bookingPackage: {
                    menuPositions: [{ id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250, subtotal: 500 }]
                }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const expected = {
            bookingId: 'BK-ROOT',
            date: '2099-06-01',
            time: '12:05',
            room: 'Room A',
            source: 'banquet_group',
            groupSource: 'manual',
            updatedAt: '2099-02-01T00:00:00.000Z'
        };

        const byBooking = await fetch(`${baseUrl}/api/banquets/by-booking/BK-KITCHEN?businessContext=event_genix`);
        const byBookingData = await byBooking.json();
        assert.equal(byBooking.status, 200, JSON.stringify(byBookingData));
        assertBanquetArrival(byBookingData, expected);
        assert.equal(byBookingData.warnings.some(warning => warning.code === 'legacy_primary_booking'), false);

        state.rows.find(row => row.id === 'BK-ROOT').time = '18:40';

        const byGroup = await fetch(`${baseUrl}/api/banquets/BQ-ROOT?businessContext=event_genix`);
        const byGroupData = await byGroup.json();
        assert.equal(byGroup.status, 200, JSON.stringify(byGroupData));
        assertBanquetArrival(byGroupData, expected);
        assert.equal(byGroupData.bookings.primary.time, '18:40');
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '12:05',
            group_name: 'Yurii banquet',
            status: 'active',
            source: 'manual',
            meta: {},
            updated_at: '2099-02-01T00:00:00.000Z'
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
            booking_id: 'BK-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }]
    });
});

test('GET banquet read endpoint does not infer arrival from primary booking time', async () => {
    await withApp([
        bookingRow({ id: 'BK-LEGACY-ROOT', time: '14:20', customer_id: 101, room: 'Room A' })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-LEGACY?businessContext=event_genix`);
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.arrival, null);
        assert.equal(data.banquetArrival, null);
        assert.ok(data.warnings.some(warning => warning.code === 'guest_arrival_missing'));
        assert.equal(data.warnings.some(warning => warning.code === 'legacy_primary_booking'), false);
    }, {
        banquetGroups: [{
            id: 'BQ-LEGACY',
            business_context: 'event_genix',
            primary_booking_id: 'BK-LEGACY-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Legacy banquet',
            status: 'active',
            source: 'manual',
            meta: {},
            updated_at: '2099-01-01T00:00:00.000Z'
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-LEGACY',
            business_context: 'event_genix',
            booking_id: 'BK-LEGACY-ROOT',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('PATCH banquet arrival changes only group arrival and returns fresh projection', async () => {
    const primary = bookingRow({ id: 'BK-ARRIVAL-ROOT', time: '13:00', room: 'Room A' });
    await withApp([primary], [], async ({ baseUrl, state }) => {
        const bookingBefore = cloneStateValue(state.rows);
        const { res, data } = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', {
            guestArrivalTime: '12:30',
            updatedAt: '2099-02-01T00:00:00.000Z'
        });

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.guestArrivalTime, '12:30');
        assert.equal(data.updatedAt, '2099-03-01T00:00:00.000Z');
        assert.equal(data.arrival.time, '12:30');
        assert.equal(data.arrival.source, 'banquet_group');
        assert.deepEqual(state.rows, bookingBefore, 'arrival PATCH must not mutate booking rows');
        assert.equal(state.banquetGroups[0].guest_arrival_time, '12:30');
        assert.ok(state.queries.some(query => /SELECT bg\.\*[\s\S]*FOR UPDATE/i.test(query.sql)));
        const updateQueries = state.queries.filter(query => /^UPDATE /i.test(query.sql));
        assert.equal(updateQueries.some(query => /^UPDATE bookings/i.test(query.sql)), false);
        assert.ok(updateQueries.some(query => /^UPDATE banquet_groups SET guest_arrival_time = \$3, updated_at = NOW\(\), updated_by = \$4/i.test(query.sql)));
        assert.ok(state.histories.some(row => row.action === 'banquet_guest_arrival_updated'));
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    }, {
        banquetGroups: [{
            id: 'BQ-ARRIVAL', business_context: 'event_genix', primary_booking_id: 'BK-ARRIVAL-ROOT',
            guest_arrival_time: '12:00', status: 'active', source: 'manual',
            date: '2099-06-01', room: 'Room A', updated_at: '2099-02-01T00:00:00.000Z'
        }]
    });
});

test('PATCH banquet arrival rejects invalid time and missing updatedAt before writes', async () => {
    await withApp([bookingRow({ id: 'BK-ARRIVAL-ROOT' })], [], async ({ baseUrl, state }) => {
        const invalid = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', {
            guestArrivalTime: '25:90', updatedAt: '2099-02-01T00:00:00.000Z'
        });
        assert.equal(invalid.res.status, 400, JSON.stringify(invalid.data));
        assert.equal(invalid.data.code, 'BANQUET_ARRIVAL_TIME_INVALID');

        const missingVersion = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', { guestArrivalTime: '12:30' });
        assert.equal(missingVersion.res.status, 400, JSON.stringify(missingVersion.data));
        assert.equal(missingVersion.data.code, 'BANQUET_ARRIVAL_UPDATED_AT_REQUIRED');
        assert.equal(state.queries.some(query => /^UPDATE /i.test(query.sql)), false);
    }, {
        banquetGroups: [{
            id: 'BQ-ARRIVAL', business_context: 'event_genix', primary_booking_id: 'BK-ARRIVAL-ROOT',
            guest_arrival_time: '12:00', status: 'active', updated_at: '2099-02-01T00:00:00.000Z'
        }]
    });
});

test('PATCH banquet arrival returns current version on stale update', async () => {
    await withApp([bookingRow({ id: 'BK-ARRIVAL-ROOT' })], [], async ({ baseUrl, state }) => {
        const { res, data } = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', {
            guestArrivalTime: '12:30', updatedAt: '2099-01-01T00:00:00.000Z'
        });
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_ARRIVAL_VERSION_CONFLICT');
        assert.equal(data.currentArrival, '12:05');
        assert.equal(data.currentUpdatedAt, '2099-02-01T00:00:00.000Z');
        assert.equal(state.banquetGroups[0].guest_arrival_time, '12:05');
        assert.equal(state.queries.some(query => /^UPDATE /i.test(query.sql)), false);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
    }, {
        banquetGroups: [{
            id: 'BQ-ARRIVAL', business_context: 'event_genix', primary_booking_id: 'BK-ARRIVAL-ROOT',
            guest_arrival_time: '12:05', status: 'active', updated_at: '2099-02-01T00:00:00.000Z'
        }]
    });
});

test('PATCH banquet arrival blocks inactive and cancelled groups', async () => {
    for (const status of ['inactive', 'cancelled']) {
        await withApp([bookingRow({ id: 'BK-ARRIVAL-ROOT' })], [], async ({ baseUrl, state }) => {
            const { res, data } = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', {
                guestArrivalTime: '12:30', updatedAt: '2099-02-01T00:00:00.000Z'
            });
            assert.equal(res.status, 409, `${status}: ${JSON.stringify(data)}`);
            assert.equal(data.code, 'BANQUET_GROUP_INACTIVE');
            assert.equal(state.queries.some(query => /^UPDATE /i.test(query.sql)), false);
        }, {
            banquetGroups: [{
                id: 'BQ-ARRIVAL', business_context: 'event_genix', primary_booking_id: 'BK-ARRIVAL-ROOT',
                guest_arrival_time: '12:00', status, updated_at: '2099-02-01T00:00:00.000Z'
            }]
        });
    }
});

test('PATCH banquet arrival masks cross-context and booking visibility failures', async () => {
    const group = {
        id: 'BQ-ARRIVAL', business_context: 'event_genix', primary_booking_id: 'BK-ARRIVAL-ROOT',
        guest_arrival_time: '12:00', status: 'active', updated_at: '2099-02-01T00:00:00.000Z'
    };
    const payload = { guestArrivalTime: '12:30', updatedAt: '2099-02-01T00:00:00.000Z' };
    await withApp([bookingRow({ id: 'BK-ARRIVAL-ROOT' })], [], async ({ baseUrl }) => {
        const crossContext = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', payload, 'maysternya_doli');
        assert.equal(crossContext.res.status, 404, JSON.stringify(crossContext.data));
        assert.equal(crossContext.data.code, 'BANQUET_GROUP_NOT_FOUND');
    }, { banquetGroups: [group] });

    await withApp([bookingRow({ id: 'BK-ARRIVAL-ROOT' })], [], async ({ baseUrl }) => {
        const hidden = await patchBanquetArrival(baseUrl, 'BQ-ARRIVAL', payload);
        assert.equal(hidden.res.status, 404, JSON.stringify(hidden.data));
        assert.equal(hidden.data.code, 'BOOKING_NOT_FOUND');
    }, { banquetGroups: [group], canEditBooking: () => false });
});

test('POST banquet source member-booking creates group from activity-first booking atomically', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload({
            booking: { banquetGuests: '' }
        }));
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.createdGroup, true);
        assert.equal(data.booking.id, 'BK-2099-9999');
        assertBanquetArrival(data.banquetGroup, {
            bookingId: 'BK-ACTIVITY-FIRST',
            date: '2099-06-01',
            time: '12:30',
            room: 'Room A',
            source: 'banquet_group',
            groupSource: 'activity_first_kitchen_bridge',
            updatedAt: '2099-01-01T00:00:00.000Z'
        });

        const group = state.banquetGroups.find(row => row.primary_booking_id === 'BK-ACTIVITY-FIRST');
        assert.ok(group, 'source activity should become the banquet primary booking');
        assert.equal(group.customer_id, 101);
        assert.equal(group.date, '2099-06-01');
        assert.equal(group.room, 'Room A');
        assert.equal(group.guest_arrival_time, '12:30');
        assert.equal(group.status, 'active');

        assert.ok(state.banquetMemberships.some(row =>
            row.group_id === group.id &&
            row.booking_id === 'BK-ACTIVITY-FIRST' &&
            row.role === 'primary'
        ), 'source activity should be attached as primary');
        assert.ok(state.banquetMemberships.some(row =>
            row.group_id === group.id &&
            row.booking_id === 'BK-2099-9999' &&
            row.role === 'kitchen'
        ), 'new kitchen booking should be attached as kitchen');

        const created = state.rows.find(row => row.id === 'BK-2099-9999');
        assert.ok(created, 'kitchen booking should be inserted');
        assert.equal(created.customer_id, 101);
        assert.equal(created.group_name, null);
        assert.equal(created.price, 4600);
        assert.equal(created.banquet_guests, 12);
        assert.equal(created.banquet_menu, 'Pizza - 4 порції × 250 грн');
        assert.equal(created.notes, null);
        const extra = JSON.parse(created.extra_data);
        assert.equal(extra.banquetGroup.groupId, group.id);
        assert.equal(extra.banquetGroup.sourceBookingId, 'BK-ACTIVITY-FIRST');
        assert.equal(extra.banquetGroup.role, 'kitchen');
        assert.deepEqual(extra.bookingPackage.entryCharge, {
            title: 'Вхід',
            quantity: 12,
            unitPrice: 300,
            subtotal: 3600,
            ruleCode: 'banquet_entry_weekday_child',
            dateType: 'weekday',
            source: 'banquet_entry_price_rules'
        });
        assert.equal(extra.bookingPackage.entrySubtotal, 3600);
        assert.equal(extra.bookingPackage.programBasePrice, 0);
        assert.equal(extra.bookingPackage.positionsSubtotal, 1000);
        assert.equal(extra.bookingPackage.finalTotal, 4600);
        assert.equal(extra.bookingWorkspace.comments.kitchen, 'Kitchen comment');
        assert.equal(extra.bookingWorkspace.comments.activity, undefined);
        assert.equal(state.links.length, 1);
        assert.deepEqual(
            [state.links[0].booking_a_id, state.links[0].booking_b_id].sort(),
            ['BK-ACTIVITY-FIRST', 'BK-2099-9999'].sort()
        );
        assert.equal(state.tx.filter(item => item === 'COMMIT').length, 1);
        assert.equal(state.tx.includes('ROLLBACK'), false);
    });
});

test('POST banquet source member-booking exposes final activity-first timeline payload', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload());
        assert.equal(res.status, 201, JSON.stringify(data));
        const group = state.banquetGroups.find(row => row.primary_booking_id === 'BK-ACTIVITY-FIRST');
        assert.ok(group, 'activity-first bridge should create a banquet group');
        assertNoDuplicateBanquetReadModel(state, group.id, ['BK-ACTIVITY-FIRST', data.booking.id]);

        const animatorRows = await getTimelineBookings(baseUrl, '2099-06-01', 'animators');
        const animatorActivity = timelineBooking(animatorRows, 'BK-ACTIVITY-FIRST');
        assertTimelineProjection(animatorActivity, {
            timelineView: 'animators',
            resourceType: 'animator',
            resourceId: 'line-rock',
            displaySurface: 'booking_block',
            hiddenReason: null,
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true
        });
        const animatorKitchen = timelineBooking(animatorRows, data.booking.id);
        assertTimelineProjection(animatorKitchen, {
            timelineView: 'animators',
            resourceType: 'service',
            resourceId: 'banquet-service',
            displaySurface: 'hidden',
            hiddenReason: 'banquet_service_hidden_from_animator',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true
        });

        const roomRows = await getTimelineBookings(baseUrl, '2099-06-01', 'rooms');
        assert.equal(roomRows.filter(item => item.id === 'BK-ACTIVITY-FIRST').length, 1);
        assert.equal(roomRows.filter(item => item.id === data.booking.id).length, 1);
        const roomActivity = timelineBooking(roomRows, 'BK-ACTIVITY-FIRST');
        assert.equal(roomActivity.resourceId, 'room-a');
        assert.equal(roomActivity.resourceType, 'room');
        assertTimelineProjection(roomActivity, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'booking_block',
            hiddenReason: null,
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true
        });
        const roomKitchen = timelineBooking(roomRows, data.booking.id);
        assert.equal(roomKitchen.resourceId, 'room-a');
        assert.equal(roomKitchen.resourceType, 'room');
        assertTimelineProjection(roomKitchen, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'service_marker',
            hiddenReason: null,
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true
        });
    });
});

test('POST banquet source member-booking reuses existing activity group without duplicates', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload({
            booking: {
                banquetGuests: 9,
                banquetAdults: 6,
                banquetTables: 1
            }
        }));
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.createdGroup, false);
        assert.equal(data.group.id, 'BQ-ACTIVITY-FIRST');

        assert.equal(state.banquetGroups.length, 1);
        assert.equal(state.banquetGroups[0].id, 'BQ-ACTIVITY-FIRST');
        assert.equal(state.banquetGroups[0].guest_arrival_time, '11:55');
        assert.equal(
            state.banquetMemberships.filter(row => row.group_id === 'BQ-ACTIVITY-FIRST' && row.booking_id === 'BK-ACTIVITY-FIRST').length,
            1
        );
        assert.equal(
            state.banquetMemberships.filter(row => row.group_id === 'BQ-ACTIVITY-FIRST' && row.booking_id === 'BK-2099-9999' && row.role === 'kitchen').length,
            1
        );
        const created = state.rows.find(row => row.id === 'BK-2099-9999');
        assert.equal(created.price, 3700);
        assert.equal(created.banquet_guests, 9);
        assert.equal(created.banquet_adults, 6);
        assert.equal(created.banquet_tables, 1);
        assert.equal(created.group_name, null);
        const extra = JSON.parse(created.extra_data);
        assert.equal(extra.bookingPackage.entryCharge.quantity, 9);
        assert.equal(extra.bookingPackage.entrySubtotal, 2700);
        assert.equal(extra.bookingPackage.finalTotal, 3700);
        assert.equal(state.links.length, 1);
        assert.equal(state.tx.filter(item => item === 'COMMIT').length, 1);
    }, {
        banquetGroups: [{
            id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ACTIVITY-FIRST',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '11:55',
            group_name: 'Paper neon show',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            booking_id: 'BK-ACTIVITY-FIRST',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('POST banquet source member-booking reuses existing read model without duplicate links', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-ACTIVITY-FIRST',
        booking_b_id: 'BK-2099-9999',
        relation_type: 'banquet_activity',
        label: 'Existing compatibility link',
        created_by: 'tester',
        created_at: new Date('2099-01-01T00:00:00Z').toISOString()
    }], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload());
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.createdGroup, false);
        assertNoDuplicateBanquetReadModel(state, 'BQ-ACTIVITY-FIRST', ['BK-ACTIVITY-FIRST', data.booking.id]);
        assert.equal(state.banquetGroups.length, 1);
        assert.equal(state.links.length, 1);
        assert.deepEqual([state.links[0].booking_a_id, state.links[0].booking_b_id].sort(), ['BK-ACTIVITY-FIRST', data.booking.id].sort());
    }, {
        banquetGroups: [{
            id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ACTIVITY-FIRST',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Paper neon show',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            booking_id: 'BK-ACTIVITY-FIRST',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('POST banquet source member-booking rejects customer mismatch before writes', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload({
            booking: { customerId: 202 }
        }));
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(state.banquetGroups.length, 0);
        assert.equal(state.banquetMemberships.length, 0);
        assert.equal(state.links.length, 0);
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.equal(state.tx.includes('COMMIT'), false);
    });
});

test('POST banquet source member-booking rolls back group and booking when membership insert fails', async () => {
    await withApp([
        activityFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceMemberBooking(baseUrl, sourceKitchenPayload());
        assert.equal(res.status, 500, JSON.stringify(data));
        assert.equal(state.banquetGroups.length, 0);
        assert.equal(state.banquetMemberships.length, 0);
        assert.equal(state.links.length, 0);
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        failBanquetMembershipInsert: true
    });
});

test('POST banquet source activity-booking creates group from kitchen-first booking atomically', async () => {
    await withApp([
        kitchenFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceActivityBooking(baseUrl, sourceActivityPayload());
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.createdGroup, true);
        assert.equal(data.booking.id, 'BK-2099-9999');
        assertBanquetArrival(data.banquetGroup, {
            bookingId: 'BK-KITCHEN-FIRST',
            date: '2099-06-01',
            time: '12:30',
            room: 'Room A',
            source: 'banquet_group',
            groupSource: 'kitchen_first_activity_bridge',
            updatedAt: '2099-01-01T00:00:00.000Z'
        });

        const group = state.banquetGroups.find(row => row.primary_booking_id === 'BK-KITCHEN-FIRST');
        assert.ok(group, 'source kitchen should become the banquet primary booking when it is first');
        assert.equal(group.customer_id, 101);
        assert.equal(group.date, '2099-06-01');
        assert.equal(group.room, 'Room A');
        assert.equal(group.guest_arrival_time, '12:30');
        assert.equal(group.source, 'kitchen_first_activity_bridge');

        assert.ok(state.banquetMemberships.some(row =>
            row.group_id === group.id &&
            row.booking_id === 'BK-KITCHEN-FIRST' &&
            row.role === 'primary'
        ), 'source kitchen should be attached as primary');
        assert.ok(state.banquetMemberships.some(row =>
            row.group_id === group.id &&
            row.booking_id === 'BK-2099-9999' &&
            row.role === 'activity'
        ), 'new activity booking should be attached as activity');

        const created = state.rows.find(row => row.id === 'BK-2099-9999');
        assert.ok(created, 'activity booking should be inserted');
        assert.equal(created.customer_id, 101);
        assert.equal(created.group_name, null);
        assert.equal(created.price, 3000);
        assert.equal(created.kids_count, 12);
        const extra = JSON.parse(created.extra_data);
        assert.equal(extra.banquetGroup.groupId, group.id);
        assert.equal(extra.banquetGroup.sourceBookingId, 'BK-KITCHEN-FIRST');
        assert.equal(extra.banquetGroup.role, 'activity');
        assert.equal(extra.banquetGroup.source, 'kitchen_first_activity_bridge');
        assert.equal(extra.bookingWorkspace.comments.activity, 'Activity comment');
        assert.equal(extra.bookingWorkspace.comments.kitchen, undefined);
        assert.equal(state.links.length, 1);
        assert.deepEqual(
            [state.links[0].booking_a_id, state.links[0].booking_b_id].sort(),
            ['BK-KITCHEN-FIRST', 'BK-2099-9999'].sort()
        );
        assert.equal(state.tx.filter(item => item === 'COMMIT').length, 1);
        assert.equal(state.tx.includes('ROLLBACK'), false);
    });
});

test('POST banquet source activity-booking exposes final kitchen-first timeline payload', async () => {
    await withApp([
        kitchenFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceActivityBooking(baseUrl, sourceActivityPayload());
        assert.equal(res.status, 201, JSON.stringify(data));
        const group = state.banquetGroups.find(row => row.primary_booking_id === 'BK-KITCHEN-FIRST');
        assert.ok(group, 'kitchen-first bridge should create a banquet group');
        assert.equal(group.source, 'kitchen_first_activity_bridge');
        assertNoDuplicateBanquetReadModel(state, group.id, ['BK-KITCHEN-FIRST', data.booking.id]);
        assert.equal(
            state.banquetMemberships.find(row => row.booking_id === 'BK-KITCHEN-FIRST')?.role,
            'primary',
            'current business rule keeps first kitchen root as primary'
        );
        assert.equal(
            state.banquetMemberships.find(row => row.booking_id === data.booking.id)?.role,
            'activity',
            'created activity is attached as activity'
        );

        const animatorRows = await getTimelineBookings(baseUrl, '2099-06-01', 'animators');
        const animatorKitchen = timelineBooking(animatorRows, 'BK-KITCHEN-FIRST');
        assertTimelineProjection(animatorKitchen, {
            timelineView: 'animators',
            resourceType: 'service',
            resourceId: 'banquet-service',
            displaySurface: 'hidden',
            hiddenReason: 'banquet_service_hidden_from_animator',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true
        });
        const animatorActivity = timelineBooking(animatorRows, data.booking.id);
        assertTimelineProjection(animatorActivity, {
            timelineView: 'animators',
            resourceType: 'animator',
            resourceId: 'line-activity-new',
            displaySurface: 'booking_block',
            hiddenReason: null,
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true
        });

        const roomRows = await getTimelineBookings(baseUrl, '2099-06-01', 'rooms');
        const roomKitchen = timelineBooking(roomRows, 'BK-KITCHEN-FIRST');
        assertTimelineProjection(roomKitchen, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'service_marker',
            hiddenReason: null,
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true
        });
        const roomActivity = timelineBooking(roomRows, data.booking.id);
        assertTimelineProjection(roomActivity, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'booking_block',
            hiddenReason: null,
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true
        });
    });
});

test('POST banquet source activity-booking reuses existing kitchen group without duplicates', async () => {
    await withApp([
        kitchenFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceActivityBooking(baseUrl, sourceActivityPayload());
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.createdGroup, false);
        assert.equal(data.group.id, 'BQ-KITCHEN-FIRST');

        assert.equal(state.banquetGroups.length, 1);
        assert.equal(state.banquetGroups[0].id, 'BQ-KITCHEN-FIRST');
        assert.equal(state.banquetGroups[0].guest_arrival_time, '11:50');
        assert.equal(
            state.banquetMemberships.filter(row => row.group_id === 'BQ-KITCHEN-FIRST' && row.booking_id === 'BK-KITCHEN-FIRST').length,
            1
        );
        assert.equal(
            state.banquetMemberships.filter(row => row.group_id === 'BQ-KITCHEN-FIRST' && row.booking_id === 'BK-2099-9999' && row.role === 'activity').length,
            1
        );
        assert.equal(state.links.length, 1);
        assert.equal(state.tx.filter(item => item === 'COMMIT').length, 1);
    }, {
        banquetGroups: [{
            id: 'BQ-KITCHEN-FIRST',
            business_context: 'event_genix',
            primary_booking_id: 'BK-KITCHEN-FIRST',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '11:50',
            group_name: 'Kitchen order',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-KITCHEN-FIRST',
            business_context: 'event_genix',
            booking_id: 'BK-KITCHEN-FIRST',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('POST banquet source activity-booking rejects customer mismatch before writes', async () => {
    await withApp([
        kitchenFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceActivityBooking(baseUrl, sourceActivityPayload({
            booking: { customerId: 202 }
        }));
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'CUSTOMER_BANQUET_MISMATCH');
        assert.equal(state.banquetGroups.length, 0);
        assert.equal(state.banquetMemberships.length, 0);
        assert.equal(state.links.length, 0);
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.equal(state.tx.includes('COMMIT'), false);
    });
});

test('POST banquet source activity-booking rolls back group and activity when membership insert fails', async () => {
    await withApp([
        kitchenFirstSourceBooking()
    ], [], async ({ baseUrl, state }) => {
        const { res, data } = await postSourceActivityBooking(baseUrl, sourceActivityPayload());
        assert.equal(res.status, 500, JSON.stringify(data));
        assert.equal(state.banquetGroups.length, 0);
        assert.equal(state.banquetMemberships.length, 0);
        assert.equal(state.links.length, 0);
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        failBanquetMembershipInsert: true
    });
});

test('POST banquet member-booking creates kitchen booking, membership, and compatibility link atomically', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/member-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                role: 'kitchen',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'banquet-service',
                    room: 'Room A',
                    programCode: 'KITCHEN',
                    label: 'Kitchen order',
                    programName: 'Kitchen order',
                    category: 'kitchen',
                    duration: 60,
                    price: 1000,
                    hosts: 0,
                    programBasePrice: 0,
                    groupName: 'must not persist as booking group_name',
                    banquetGuests: 18,
                    banquetAdults: 12,
                    banquetTables: 3,
                    banquetMenu: 'Pizza x 4',
                    extraData: {
                        bookingWorkspace: { scenario: 'kitchen_only' },
                        bookingPackage: {
                            menuPositions: [{ id: 'pizza', title: 'Pizza', quantity: 4, unitPrice: 250, subtotal: 1000 }]
                        }
                    }
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.booking.id, 'BK-2099-9999');
        assert.equal(data.booking.groupName, null);
        assert.equal(data.membership.role, 'kitchen');
        assert.deepEqual(
            [data.compatibilityLink.bookingAId, data.compatibilityLink.bookingBId].sort(),
            ['BK-ROOT', 'BK-2099-9999'].sort()
        );

        const created = state.rows.find(row => row.id === 'BK-2099-9999');
        assert.ok(created, 'member booking should be inserted');
        assert.equal(created.customer_id, 101);
        assert.equal(created.group_name, null);
        assert.equal(created.price, 6400);
        assert.equal(created.banquet_guests, 18);
        assert.equal(created.banquet_menu, 'Pizza - 4 порції × 250 грн');
        const extra = JSON.parse(created.extra_data);
        assert.equal(extra.banquetGroup.groupId, 'BQ-ROOT');
        assert.equal(extra.banquetGroup.sourceBookingId, 'BK-ROOT');
        assert.equal(extra.banquetGroup.role, 'kitchen');
        assert.equal(extra.banquetGroup.source, 'banquet_group_member_booking');
        assert.equal(extra.bookingPackage.entryCharge.quantity, 18);
        assert.equal(extra.bookingPackage.entryCharge.ruleCode, 'banquet_entry_weekday_child');
        assert.equal(extra.bookingPackage.entrySubtotal, 5400);
        assert.equal(extra.bookingPackage.finalTotal, 6400);
        assert.ok(state.banquetMemberships.some(row => row.group_id === 'BQ-ROOT' && row.booking_id === 'BK-2099-9999' && row.role === 'kitchen'));
        assert.equal(state.links.length, 1);
        assert.ok(state.tx.includes('COMMIT'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
        }]
    });
});

test('POST banquet member-booking rejects customer mismatch before creating booking', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/member-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                role: 'kitchen',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'banquet-service',
                    room: 'Room A',
                    programCode: 'KITCHEN',
                    label: 'Kitchen order',
                    programName: 'Kitchen order',
                    category: 'kitchen',
                    duration: 60,
                    price: 1000,
                    hosts: 0,
                    customerId: 202
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'CUSTOMER_BANQUET_MISMATCH');
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
        }]
    });
});

test('POST banquet activity-booking allows activity over same-banquet kitchen room slot', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        }),
        bookingRow({
            id: 'BK-KITCHEN',
            time: '12:00',
            line_id: 'banquet-service',
            customer_id: 101,
            label: 'Kitchen order',
            program_code: 'KITCHEN',
            program_name: 'Kitchen order',
            category: 'kitchen',
            duration: 60,
            room: 'Room A',
            extra_data: JSON.stringify({
                banquetGroup: { groupId: 'BQ-ROOT', role: 'kitchen' }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/activity-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'line-activity-new',
                    room: 'Room A',
                    programId: 'program-mafia',
                    programCode: 'MAFIA',
                    label: 'Mafia',
                    programName: 'Mafia',
                    category: 'animation',
                    duration: 60,
                    price: 3000,
                    hosts: 1
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.booking.id, 'BK-2099-9999');
        assert.equal(data.membership.role, 'activity');
        assert.equal(state.rows.find(row => row.id === 'BK-2099-9999')?.customer_id, 101);
        assert.ok(state.banquetMemberships.some(row => row.group_id === 'BQ-ROOT' && row.booking_id === 'BK-2099-9999' && row.role === 'activity'));
        const roomRows = await getTimelineBookings(baseUrl, '2099-06-01', 'rooms');
        const roomActivity = timelineBooking(roomRows, 'BK-2099-9999');
        assert.equal(roomActivity.timelineProjection.hiddenReason, null);
        const animatorRows = await getTimelineBookings(baseUrl, '2099-06-01', 'animators');
        const animatorActivity = timelineBooking(animatorRows, 'BK-2099-9999');
        assert.equal(animatorActivity.timelineProjection.hiddenReason, null);
        assert.ok(state.tx.includes('COMMIT'));
        assert.ok(state.queries.some(query => /LEFT JOIN banquet_group_bookings bgb/i.test(query.sql)));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
            booking_id: 'BK-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }]
    });
});

test('POST banquet activity-booking rejects customer mismatch before creating booking', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/activity-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'line-activity-new',
                    room: 'Room A',
                    programId: 'program-mafia',
                    programCode: 'MAFIA',
                    label: 'Mafia',
                    programName: 'Mafia',
                    category: 'animation',
                    duration: 60,
                    price: 3000,
                    hosts: 1,
                    customerId: 202
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'CUSTOMER_BANQUET_MISMATCH');
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
        }]
    });
});

test('POST banquet member-booking allows kitchen over same-banquet activity room slot', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        }),
        bookingRow({
            id: 'BK-ACTIVITY',
            time: '12:00',
            line_id: 'line-activity-existing',
            customer_id: 101,
            label: 'Mafia',
            program_id: 'program-mafia',
            program_code: 'MAFIA',
            program_name: 'Mafia',
            category: 'animation',
            duration: 60,
            room: 'Room A',
            extra_data: JSON.stringify({
                banquetGroup: { groupId: 'BQ-ROOT', role: 'activity' }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/member-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                role: 'kitchen',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'banquet-service',
                    room: 'Room A',
                    programCode: 'KITCHEN',
                    label: 'Kitchen order',
                    programName: 'Kitchen order',
                    category: 'kitchen',
                    duration: 60,
                    price: 1400,
                    hosts: 0
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.membership.role, 'kitchen');
        assert.ok(state.banquetMemberships.some(row => row.group_id === 'BQ-ROOT' && row.booking_id === 'BK-2099-9999' && row.role === 'kitchen'));
        assert.ok(state.tx.includes('COMMIT'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
            booking_id: 'BK-ACTIVITY',
            role: 'activity',
            sort_order: 100
        }]
    });
});

test('POST banquet activity-booking blocks activity over same-room activity in same banquet', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        }),
        bookingRow({
            id: 'BK-ACTIVITY',
            time: '12:00',
            line_id: 'line-activity-existing',
            customer_id: 101,
            label: 'Mafia',
            program_id: 'program-mafia',
            program_code: 'MAFIA',
            program_name: 'Mafia',
            category: 'animation',
            duration: 60,
            room: 'Room A',
            extra_data: JSON.stringify({
                banquetGroup: { groupId: 'BQ-ROOT', role: 'activity' }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/activity-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'line-activity-new',
                    room: 'Room A',
                    programId: 'program-pryan',
                    programCode: 'PRYAN',
                    label: 'Pryan',
                    programName: 'Pryan',
                    category: 'animation',
                    duration: 60,
                    price: 300,
                    hosts: 1
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'ACTIVITY_ROOM_CONFLICT');
        assert.equal(data.conflictBookingId, 'BK-ACTIVITY');
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
            booking_id: 'BK-ACTIVITY',
            role: 'activity',
            sort_order: 100
        }]
    });
});

test('POST banquet member-booking blocks unrelated banquet room slot', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        }),
        bookingRow({
            id: 'BK-OTHER-KITCHEN',
            time: '12:00',
            line_id: 'banquet-service',
            customer_id: 202,
            label: 'Other kitchen',
            program_code: 'KITCHEN',
            program_name: 'Other kitchen',
            category: 'kitchen',
            duration: 60,
            room: 'Room A',
            extra_data: JSON.stringify({
                banquetGroup: { groupId: 'BQ-OTHER', role: 'kitchen' }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/member-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceBookingId: 'BK-ROOT',
                role: 'kitchen',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'banquet-service',
                    room: 'Room A',
                    programCode: 'KITCHEN',
                    label: 'Kitchen order',
                    programName: 'Kitchen order',
                    category: 'kitchen',
                    duration: 60,
                    price: 1400,
                    hosts: 0
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'MEMBER_BOOKING_ROOM_CONFLICT');
        assert.equal(data.conflictBookingId, 'BK-OTHER-KITCHEN');
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
            status: 'active',
            source: 'test',
            meta: {}
        }, {
            id: 'BQ-OTHER',
            business_context: 'event_genix',
            primary_booking_id: 'BK-OTHER-ROOT',
            customer_id: 202,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Other banquet',
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
            group_id: 'BQ-OTHER',
            business_context: 'event_genix',
            booking_id: 'BK-OTHER-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }]
    });
});

test('POST banquet member-booking rolls back inserted booking when membership insert fails', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            customer_id: 101,
            label: 'Yurii banquet',
            program_name: 'Yurii banquet',
            room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/member-booking?businessContext=event_genix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: 'kitchen',
                booking: {
                    date: '2099-06-01',
                    time: '12:00',
                    lineId: 'banquet-service',
                    room: 'Room A',
                    label: 'Kitchen order',
                    programName: 'Kitchen order',
                    category: 'kitchen',
                    duration: 60,
                    price: 500
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 500, JSON.stringify(data));
        assert.equal(state.rows.some(row => row.id === 'BK-2099-9999'), false);
        assert.deepEqual(state.banquetMemberships.map(row => row.booking_id), ['BK-ROOT']);
        assert.equal(state.links.length, 0);
        assert.ok(state.tx.includes('ROLLBACK'));
    }, {
        failBanquetMembershipInsert: true,
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Yurii banquet',
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
        }]
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

test('POST booking rejects explicit add-to-existing banquet intent on generic endpoint', async () => {
    await withApp([], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: '2099-06-01',
                time: '12:00',
                lineId: 'line-1',
                room: 'Room A',
                duration: 30,
                status: 'confirmed',
                extraData: {
                    banquetGroup: {
                        intent: 'add_to_existing',
                        requiresMembership: true,
                        groupId: 'BQ-2099-0001',
                        sourceBookingId: 'BK-2099-0001'
                    }
                }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_ADD_TO_EXISTING_REQUIRES_ATOMIC_ENDPOINT');
        assert.deepEqual(data.useEndpoints, [
            '/api/banquets/:groupId/member-booking',
            '/api/banquets/:groupId/activity-booking'
        ]);
        assert.equal(state.rows.length, 0);
        assert.equal(state.queries.some(query => /INSERT INTO bookings/i.test(query.sql)), false);
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
        bookingRow({ id: 'BK-ROOT', time: '12:00', label: 'Banquet root', program_name: 'Banquet root', category: 'banquet', room: 'Room A', price: 1000, status: 'preliminary' }),
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
        assert.equal(data.mode, 'client');
        assert.equal(data.modeContract.sections.finance, true);
        assert.deepEqual(data.modeContract.commentTypes, []);
        const activityRows = data.orderRows.filter(row => row.type === 'activity');
        assert.deepEqual(activityRows.map(row => row.bookingId), ['BK-ACTIVE']);
        assert.equal(data.totals.activitySubtotal, 700);
        assert.ok(data.warnings.some(warning => warning.code === 'banquet_member_status_mismatch'));
        assert.equal(data.event.status, 'preliminary');
        assert.equal(data.document.generatedAt, undefined);
        assert.equal(data.event.createdAt, new Date('2099-01-01T00:00:00Z').toISOString());
        const expectedArrival = {
            bookingId: 'BK-ROOT',
            date: '2099-06-01',
            time: '11:45',
            room: 'Room A',
            source: 'banquet_group',
            groupSource: 'test',
            updatedAt: '2099-01-01T00:00:00.000Z'
        };
        assert.deepEqual(data.arrival, expectedArrival);
        assert.deepEqual(data.banquetArrival, expectedArrival);
        assert.equal(data.event.date, data.arrival.date);
        assert.equal(data.event.time, '12:00');
        assert.notEqual(data.event.time, data.arrival.time);
        assert.equal(data.event.room, data.arrival.room);
        assert.deepEqual(data.finance.rows.map(row => row.key), ['total', 'deposit']);
        assert.equal(data.finance.rows.find(row => row.key === 'total')?.amount, 1700);
        assert.equal(data.finance.rows.find(row => row.key === 'deposit')?.amount, 0);
        assert.deepEqual(data.schedule.map(item => `${item.time} ${item.title}`), [
            '11:45 Прихід гостей',
            '12:00 Banquet root',
            '13:00 Foam show'
        ]);
        assert.equal(data.schedule.some(item => item.title === 'Neon show'), false);
        assert.deepEqual(data.responsible.rows.map(row => `${row.label}:${row.name || '—'}`), [
            'Менеджер:tester',
            'Аніматор:line-1',
            'Кухня:—',
            'Офіціант:—',
            'Кімната:—'
        ]);

        const staffRes = await fetch(`${baseUrl}/api/bookings/BK-ROOT/banquet-summary?businessContext=event_genix&groupId=BQ-ROOT&mode=staff`);
        const staffData = await staffRes.json();
        assert.equal(staffRes.status, 200, JSON.stringify(staffData));
        assert.equal(staffData.mode, 'staff');
        assert.equal(staffData.modeContract.sections.warnings, true);
        assert.deepEqual(staffData.modeContract.orderRowTypes, ['program', 'activity', 'entry', 'menu']);
        assert.ok(staffData.modeContract.commentTypes.includes('internal'));
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: null,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '11:45',
            group_name: 'Banquet root',
            status: 'active',
            source: 'test',
            meta: {},
            updated_at: '2099-01-01T00:00:00.000Z'
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

test('GET banquet summary reads confirmed deposit from canonical banquet_deposits before legacy JSON', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT',
            time: '12:00',
            label: 'Banquet root',
            program_name: 'Banquet root',
            category: 'banquet',
            room: 'Room A',
            price: 5000,
            extra_data: {
                banquetDeposit: {
                    amount: 700,
                    paymentMethod: 'cash',
                    paymentStatus: 'legacy'
                }
            }
        })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-ROOT/banquet-summary?businessContext=event_genix&groupId=BQ-DEPOSIT`);
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.deposit.id, 42);
        assert.equal(data.deposit.amount, 1500);
        assert.equal(data.deposit.paymentMethod, 'card');
        assert.equal(data.deposit.paymentStatus, 'accountant_verified');
        assert.equal(data.deposit.status, 'accountant_verified');
        assert.equal(data.deposit.source, 'canonical_banquet_deposits');
        assert.equal(data.deposit.sourceKind, 'accountant_confirmed');
        assert.equal(data.deposit.receivedDate, '2099-06-19');
        assert.equal(data.deposit.accountantTaskId, 77);
        assert.equal(data.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
    }, {
        banquetGroups: [{
            id: 'BQ-DEPOSIT',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ROOT',
            customer_id: null,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '11:45',
            group_name: 'Banquet root',
            status: 'active',
            source: 'test',
            meta: {},
            updated_at: '2099-01-01T00:00:00.000Z'
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-DEPOSIT',
            business_context: 'event_genix',
            booking_id: 'BK-ROOT',
            role: 'primary',
            sort_order: 10
        }],
        banquetDeposits: [{
            id: 42,
            business_context: 'event_genix',
            banquet_group_id: null,
            primary_booking_id: 'BK-ROOT',
            lead_id: 501,
            customer_id: null,
            accountant_task_id: 77,
            client_name_snapshot: 'Client One',
            event_date: '2099-06-01',
            banquet_number_snapshot: 'BK-ROOT',
            amount: 1500,
            payment_method: 'card',
            status: 'accountant_verified',
            source_kind: 'accountant_confirmed',
            source_payload: {
                accountantConfirmation: {
                    receivedDate: '2099-06-19',
                    note: 'Verified by route test'
                }
            },
            verified_at: '2099-06-19T09:00:00.000Z',
            verified_by: 12,
            corrected_at: null,
            corrected_by: null,
            meta: {},
            updated_at: '2099-06-19T09:00:00.000Z'
        }]
    });
});

test('GET banquet summary PDF returns clean application/pdf response', async () => {
    await withApp([
        bookingRow({
            id: 'BK-PDF-ROUTE',
            time: '13:45',
            label: 'Paper neon show',
            program_name: 'Paper neon show',
            program_id: 'paper_neon_show',
            category: 'activity',
            duration: 60,
            room: 'Room A',
            price: 2600,
            kids_count: 2,
            customer_id: 101,
            created_at: new Date('2099-01-01T10:15:00Z').toISOString(),
            extra_data: JSON.stringify({
                bookingWorkspace: {
                    comments: { activity: 'Activity comment once' }
                },
                banquetDeposit: { amount: 1000, paymentMethod: 'cash', paymentStatus: 'paid' },
                bookingPackage: {
                    programBasePrice: 1500,
                    entrySubtotal: 600,
                    positionsSubtotal: 500,
                    finalTotal: 2600,
                    entryCharge: {
                        title: 'Вхід',
                        quantity: 2,
                        unitPrice: 300,
                        subtotal: 600,
                        ruleCode: 'banquet_entry_weekday_child',
                        dateType: 'weekday',
                        source: 'banquet_entry_price_rules'
                    },
                    menuPositions: [
                        { id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250, subtotal: 500, servingTime: '15:15' }
                    ]
                }
            })
        })
    ], [], async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-PDF-ROUTE/banquet-summary.pdf?businessContext=event_genix&mode=client`);
        const contentType = res.headers.get('content-type') || '';
        const buffer = Buffer.from(await res.arrayBuffer());
        const raw = buffer.toString('latin1');

        assert.equal(res.status, 200, raw.slice(0, 200));
        assert.match(contentType, /^application\/pdf\b/);
        assert.equal(res.headers.get('x-banquet-summary-mode'), 'client');
        assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
        assert.doesNotMatch(raw, /https?:\/\//i);
        assert.doesNotMatch(raw, /localhost|127\.0\.0\.1|about:blank/i);
        assert.doesNotMatch(raw, /\b1\s*\/\s*1\b/);
    }, {
        customers: [{
            id: 101,
            business_context: 'event_genix',
            name: 'ШуткаМинутка',
            phone: '+380535232',
            child_name: 'Жартик',
            child_birthday: '2020-06-23',
            instagram: null,
            source: null,
            notes: null
        }],
        banquetGroups: [{
            id: 'BQ-PDF-ROUTE',
            business_context: 'event_genix',
            primary_booking_id: 'BK-PDF-ROUTE',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            guest_arrival_time: '13:30',
            group_name: 'Paper neon banquet',
            status: 'active',
            source: 'test',
            meta: {},
            updated_at: '2099-01-01T10:15:00.000Z'
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-PDF-ROUTE',
            business_context: 'event_genix',
            booking_id: 'BK-PDF-ROUTE',
            role: 'primary',
            sort_order: 10
        }]
    });
});

test('banquet summary reads workspace comments and does not borrow booking group_name for existing groups', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const primary = bookingRow({
        id: 'BK-SUMMARY-PRIMARY',
        time: '15:00',
        label: 'Primary party',
        program_name: 'Primary party',
        notes: 'legacy primary note',
        group_name: 'legacy booking group name',
        price: 2500,
        extra_data: {
            bookingWorkspace: {
                comments: {
                    activity: 'workspace activity comment',
                    internal: 'workspace internal comment'
                }
            }
        }
    });
    const kitchen = bookingRow({
        id: 'BK-SUMMARY-KITCHEN',
        label: 'Kitchen',
        program_name: 'Kitchen',
        notes: 'legacy kitchen note',
        group_name: 'legacy kitchen group name',
        price: 900,
        extra_data: {
            bookingWorkspace: {
                scenario: 'kitchen_only',
                comments: { kitchen: 'workspace kitchen comment' }
            },
            bookingPackage: {
                menuPositions: [
                    { id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250, subtotal: 500 }
                ]
            }
        }
    });
    const activity = bookingRow({
        id: 'BK-SUMMARY-ACTIVITY',
        label: 'Foam show',
        program_name: 'Foam show',
        category: 'activity',
        price: 700,
        notes: 'legacy activity note',
        group_name: 'legacy activity group name',
        extra_data: {
            bookingWorkspace: {
                comments: { activity: 'workspace member activity comment' }
            }
        }
    });

    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: activity,
        resolvedGroup: {
            source: 'banquet_group',
            groupId: 'BQ-SUMMARY',
            group: {
                id: 'BQ-SUMMARY',
                primaryBookingId: primary.id,
                date: '2099-06-02',
                room: 'Room B',
                guestArrivalTime: '14:10',
                groupName: 'canonical banquet group',
                status: 'active',
                source: 'test_arrival',
                updatedAt: new Date('2099-01-01T00:00:00.123Z')
            },
            members: [
                { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary, technicalChildren: [] },
                { bookingId: kitchen.id, role: 'kitchen', isKitchenCandidate: true, booking: kitchen, technicalChildren: [] },
                { bookingId: activity.id, role: 'activity', booking: activity, technicalChildren: [] }
            ],
            arrival: {
                bookingId: primary.id,
                date: '2099-06-02',
                time: '14:10',
                room: 'Room B',
                source: 'banquet_group',
                groupSource: 'test_arrival',
                updatedAt: new Date('2099-01-01T00:00:00.123Z')
            }
        }
    });

    assert.deepEqual(summary.arrival, {
        bookingId: primary.id,
        date: '2099-06-02',
        time: '14:10',
        room: 'Room B',
        source: 'banquet_group',
        groupSource: 'test_arrival',
        updatedAt: '2099-01-01T00:00:00.123Z'
    });
    assert.deepEqual(summary.banquetArrival, summary.arrival);
    assert.equal(summary.event.date, '2099-06-01');
    assert.equal(summary.event.time, '15:00');
    assert.equal(summary.event.room, 'Room A');
    assert.equal(summary.schedule.find(row => row.type === 'arrival')?.time, '14:10');
    assert.equal(summary.schedule.find(row => row.type === 'program')?.time, '15:00');
    assert.equal(summary.event.groupName, 'canonical banquet group');
    assert.equal(summary.orderRows.find(row => row.type === 'program')?.comment, 'workspace activity comment');
    assert.equal(summary.orderRows.find(row => row.type === 'menu')?.comment, 'workspace kitchen comment');
    assert.equal(summary.orderRows.find(row => row.type === 'activity')?.comment, 'workspace member activity comment');
    assert.equal(summary.comments.some(comment => comment.text === 'workspace activity comment'), false);
    assert.equal(summary.comments.some(comment => comment.text === 'workspace kitchen comment'), false);
    assert.equal(summary.comments.some(comment => comment.text === 'workspace member activity comment'), false);
    assert.deepEqual(summary.comments.map(comment => comment.label), ['Внутрішній коментар']);
});

test('banquet summary keeps legacy notes and group_name fallback when no banquet group exists', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: bookingRow({
            id: 'BK-LEGACY-SUMMARY',
            label: 'Legacy party',
            program_name: 'Legacy party',
            group_name: 'legacy visible group',
            notes: 'legacy visible note',
            price: 1200
        })
    });

    assert.equal(summary.event.groupName, 'legacy visible group');
    assert.equal(summary.orderRows.find(row => row.type === 'program')?.comment, 'legacy visible note');
});

test('banquet summary uses canonical deposit projection before legacy extra_data deposit', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: bookingRow({
            id: 'BK-CANONICAL-DEPOSIT',
            price: 5000,
            extra_data: {
                banquetDeposit: {
                    amount: 700,
                    paymentMethod: 'cash',
                    paymentStatus: 'legacy'
                }
            }
        }),
        canonicalDepositProjection: {
            success: true,
            state: 'verified',
            status: 'accountant_verified',
            deposit: {
                id: 42,
                amount: 1500,
                paymentMethod: 'card',
                status: 'accountant_verified',
                sourceKind: 'accountant_confirmed',
                sourcePayload: {
                    accountantConfirmation: {
                        receivedDate: '2099-06-19',
                        note: 'Verified by accountant'
                    }
                },
                verifiedAt: '2099-06-19T09:00:00.000Z',
                accountantTaskId: 77
            },
            display: { amount: 1500, paymentMethod: 'card' }
        }
    });

    assert.equal(summary.deposit.id, 42);
    assert.equal(summary.deposit.amount, 1500);
    assert.equal(summary.deposit.paymentMethod, 'card');
    assert.equal(summary.deposit.paymentStatus, 'accountant_verified');
    assert.equal(summary.deposit.status, 'accountant_verified');
    assert.equal(summary.deposit.source, 'canonical_banquet_deposits');
    assert.equal(summary.deposit.sourceKind, 'accountant_confirmed');
    assert.equal(summary.deposit.receivedDate, '2099-06-19');
    assert.equal(summary.deposit.accountantTaskId, 77);
    assert.equal(summary.deposit.note, 'Verified by accountant');
    assert.equal(summary.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
});

test('banquet summary falls back to explicit legacy deposit when canonical projection is missing', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: bookingRow({
            id: 'BK-LEGACY-DEPOSIT',
            price: 3000,
            extra_data: {
                banquetDeposit: {
                    amount: 800,
                    paymentMethod: 'cash',
                    paymentStatus: 'legacy_paid',
                    note: 'Legacy deposit marker'
                }
            }
        }),
        canonicalDepositProjection: {
            success: true,
            state: 'missing',
            status: 'missing',
            deposit: null
        }
    });

    assert.equal(summary.deposit.amount, 800);
    assert.equal(summary.deposit.paymentMethod, 'cash');
    assert.equal(summary.deposit.paymentStatus, 'legacy_paid');
    assert.equal(summary.deposit.note, 'Legacy deposit marker');
    assert.equal(summary.deposit.source, 'extra_data.banquetDeposit');
    assert.equal(summary.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
});

test('banquet summary shows zero deposit without using paid_amount as deposit', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: bookingRow({
            id: 'BK-PAID-NOT-DEPOSIT',
            price: 3000,
            paid_amount: 1200,
            payment_status: 'partial',
            payment_method: 'card'
        }),
        canonicalDepositProjection: {
            success: true,
            state: 'missing',
            status: 'missing',
            deposit: null
        }
    });

    assert.equal(summary.deposit.amount, null);
    assert.equal(summary.deposit.source, null);
    assert.equal(summary.finance.rows.find(row => row.key === 'deposit')?.amount, 0);
    assert.equal(summary.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
    assert.equal(summary.warnings.some(warning => warning.code === 'paid_amount_not_used_as_deposit'), false);
});

test('DELETE booking detaches cancelled banquet activity from group while keeping primary root', async () => {
    await withApp([
        bookingRow({ id: 'BK-ROOT', time: '12:00', label: 'Banquet root', program_name: 'Banquet root', category: 'banquet', room: 'Room A', price: 1000 }),
        bookingRow({ id: 'BK-ACTIVE', time: '13:00', label: 'Foam show', program_name: 'Foam show', category: 'activity', room: 'Room A', price: 700 }),
        bookingRow({ id: 'BK-ACTIVE-CHILD', time: '13:00', label: 'Foam show second host', program_name: 'Foam show second host', category: 'activity', room: 'Room A', price: 0, linked_to: 'BK-ACTIVE' }),
        bookingRow({
            id: 'BK-KITCHEN',
            time: '12:30',
            line_id: 'banquet-service',
            label: 'Kitchen order',
            program_name: 'Kitchen order',
            category: 'kitchen',
            room: 'Room A',
            price: 0,
            extra_data: JSON.stringify({
                bookingPackage: {
                    menuPositions: [{ id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250, subtotal: 500 }]
                }
            })
        })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-ROOT',
        booking_b_id: 'BK-ACTIVE',
        relation_type: 'banquet_activity'
    }, {
        business_context: 'event_genix',
        booking_a_id: 'BK-ROOT',
        booking_b_id: 'BK-KITCHEN',
        relation_type: 'banquet_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-ACTIVE?businessContext=event_genix`, { method: 'DELETE' });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(state.rows.find(row => row.id === 'BK-ACTIVE').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-ACTIVE-CHILD').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-ROOT').status, 'confirmed');
        assert.equal(state.rows.find(row => row.id === 'BK-KITCHEN').status, 'confirmed');
        assert.deepEqual(state.banquetMemberships.map(row => row.booking_id).sort(), ['BK-KITCHEN', 'BK-ROOT']);
        assert.equal(state.links.length, 1);
        assert.deepEqual([state.links[0].booking_a_id, state.links[0].booking_b_id].sort(), ['BK-KITCHEN', 'BK-ROOT']);
        assert.equal(state.banquetGroups[0].updated_by, 'banquet-test');
        assert.ok(state.histories.some(item => item.action === 'banquet_group_booking_detached'));

        const roomRows = await getTimelineBookings(baseUrl, '2099-06-01', 'rooms');
        timelineBookingAbsent(roomRows, 'BK-ACTIVE');
        timelineBookingAbsent(roomRows, 'BK-ACTIVE-CHILD');
        const kitchen = timelineBooking(roomRows, 'BK-KITCHEN');
        assertTimelineProjection(kitchen, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'service_marker',
            hiddenReason: null
        });
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
            booking_id: 'BK-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }]
    });
});

test('DELETE booking removes cancelled kitchen marker while keeping source banquet activity consistent', async () => {
    await withApp([
        activityFirstSourceBooking(),
        bookingRow({
            id: 'BK-KITCHEN',
            time: '12:45',
            line_id: 'banquet-service',
            label: 'Kitchen order',
            program_name: 'Kitchen order',
            category: 'kitchen',
            room: 'Room A',
            price: 0,
            customer_id: 101,
            extra_data: JSON.stringify({
                bookingPackage: {
                    menuPositions: [{ id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250, subtotal: 500 }]
                }
            })
        })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-ACTIVITY-FIRST',
        booking_b_id: 'BK-KITCHEN',
        relation_type: 'banquet_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-KITCHEN?businessContext=event_genix`, { method: 'DELETE' });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(state.rows.find(row => row.id === 'BK-KITCHEN').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-ACTIVITY-FIRST').status, 'confirmed');
        assert.deepEqual(state.banquetMemberships.map(row => row.booking_id), ['BK-ACTIVITY-FIRST']);
        assert.equal(state.links.length, 0);
        assertNoDuplicateBanquetReadModel(state, 'BQ-ACTIVITY-FIRST', ['BK-ACTIVITY-FIRST']);

        const roomRows = await getTimelineBookings(baseUrl, '2099-06-01', 'rooms');
        timelineBookingAbsent(roomRows, 'BK-KITCHEN');
        const roomActivity = timelineBooking(roomRows, 'BK-ACTIVITY-FIRST');
        assertTimelineProjection(roomActivity, {
            timelineView: 'rooms',
            resourceType: 'room',
            resourceId: 'room-a',
            displaySurface: 'booking_block',
            hiddenReason: null
        });

        const animatorRows = await getTimelineBookings(baseUrl, '2099-06-01', 'animators');
        timelineBookingAbsent(animatorRows, 'BK-KITCHEN');
        const animatorActivity = timelineBooking(animatorRows, 'BK-ACTIVITY-FIRST');
        assertTimelineProjection(animatorActivity, {
            timelineView: 'animators',
            resourceType: 'animator',
            resourceId: 'line-rock',
            displaySurface: 'booking_block',
            hiddenReason: null
        });
    }, {
        banquetGroups: [{
            id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            primary_booking_id: 'BK-ACTIVITY-FIRST',
            customer_id: 101,
            date: '2099-06-01',
            room: 'Room A',
            group_name: 'Paper neon show',
            status: 'active',
            source: 'test',
            meta: {}
        }],
        banquetMemberships: [{
            id: 1,
            group_id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            booking_id: 'BK-ACTIVITY-FIRST',
            role: 'primary',
            sort_order: 10
        }, {
            id: 2,
            group_id: 'BQ-ACTIVITY-FIRST',
            business_context: 'event_genix',
            booking_id: 'BK-KITCHEN',
            role: 'kitchen',
            sort_order: 30
        }]
    });
});

test('PUT banquet booking-set atomically updates primary and creates activity membership', async () => {
    const groupUpdatedAt = '2099-01-01T00:00:00.000Z';
    await withApp([
        bookingRow({
            id: 'BK-ROOT', time: '12:00', line_id: 'line-bubble', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30, price: 2400,
            customer_id: 101, room: 'Room A'
        }),
        bookingRow({
            id: 'BK-KITCHEN', time: '12:00', line_id: 'banquet-service', program_id: null,
            program_code: 'KITCHEN', label: 'Kitchen order', program_name: 'Kitchen order', category: 'kitchen',
            duration: 90, price: 0, customer_id: 101, room: 'Room A',
            extra_data: JSON.stringify({
                bookingPackage: { menuPositions: [{ id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 250 }] }
            })
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: groupUpdatedAt,
                primaryPatch: { notes: 'Atomic primary update' },
                activities: [{
                    date: '2099-06-01', time: '12:30', lineId: 'line-pinata', room: 'Room A',
                    programId: 'pinata', programCode: 'PIN', label: 'Pinata', programName: 'Pinata',
                    category: 'pinata', duration: 15, price: 700, hosts: 1,
                    pinataMode: 'park', pinataNumber: 'QA-01', pinataFillerNumber: 'QA-F01', pinataFiller: '2XL'
                }]
            })
        });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.primaryBooking.id, 'BK-ROOT');
        assert.deepEqual(data.activityBookings.map(item => item.id), ['BK-2099-9999']);
        assert.ok(state.banquetMemberships.some(row => row.booking_id === 'BK-KITCHEN' && row.role === 'kitchen'));
        assert.ok(state.banquetMemberships.some(row => row.booking_id === 'BK-2099-9999' && row.role === 'activity'));
        const primaryExtra = JSON.parse(state.rows.find(row => row.id === 'BK-ROOT').extra_data);
        const pinataExtra = JSON.parse(state.rows.find(row => row.id === 'BK-2099-9999').extra_data);
        assert.deepEqual(primaryExtra.multiActivity.activityIds, ['bubble', 'pinata']);
        assert.deepEqual(pinataExtra.multiActivity.activityIds, ['bubble', 'pinata']);
        assert.equal(state.rows.find(row => row.id === 'BK-2099-9999').pinata_mode, 'park');

        const repeatRes = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: '2099-01-01T00:10:00.000Z',
                primaryPatch: { notes: 'Atomic primary update' },
                activities: [{
                    bookingId: 'BK-2099-9999',
                    date: '2099-06-01', time: '12:45', lineId: 'line-pinata', room: 'Room A',
                    programId: 'pinata', programCode: 'PIN', label: 'Pinata', programName: 'Pinata',
                    category: 'pinata', duration: 20, price: 700, hosts: 1,
                    pinataMode: 'park', pinataNumber: 'QA-02', pinataFillerNumber: 'QA-F02', pinataFiller: '3XL'
                }]
            })
        });
        const repeatData = await repeatRes.json();
        assert.equal(repeatRes.status, 200, JSON.stringify(repeatData));
        assert.equal(repeatData.activityBookings[0].time, '12:45');
        assert.equal(repeatData.activityBookings[0].pinataNumber, 'QA-02');
        assert.equal(state.rows.find(row => row.id === 'BK-2099-9999').duration, 20);
        assert.equal(state.rows.find(row => row.id === 'BK-2099-9999').pinata_number, 'QA-02');
        assert.equal(state.rows.filter(row => row.id === 'BK-2099-9999').length, 1);
        assert.equal(state.banquetMemberships.filter(row => row.booking_id === 'BK-2099-9999').length, 1);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    }, {
        mockProductPricing: true,
        nextGroupUpdatedAt: '2099-01-01T00:10:00.000Z',
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: groupUpdatedAt
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }, {
            id: 2, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-KITCHEN', role: 'kitchen', sort_order: 30
        }]
    });
});

test('PUT banquet booking-set cancels omitted activity and preserves non-activity members', async () => {
    const groupUpdatedAt = '2099-01-01T00:00:00.000Z';
    await withApp([
        bookingRow({
            id: 'BK-ROOT', line_id: 'line-bubble', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30,
            customer_id: 101, room: 'Room A'
        }),
        bookingRow({
            id: 'BK-PINATA', time: '12:30', line_id: 'line-pinata', program_id: 'pinata', program_code: 'PIN',
            label: 'Pinata', program_name: 'Pinata', category: 'pinata', duration: 15,
            customer_id: 101, room: 'Room A'
        }),
        bookingRow({
            id: 'BK-KITCHEN', line_id: 'banquet-service', program_code: 'KITCHEN', label: 'Kitchen order',
            program_name: 'Kitchen order', category: 'kitchen', duration: 90, customer_id: 101, room: 'Room A'
        })
    ], [{
        business_context: 'event_genix',
        booking_a_id: 'BK-PINATA',
        booking_b_id: 'BK-ROOT',
        relation_type: 'banquet_activity'
    }], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: groupUpdatedAt,
                primaryPatch: {},
                activities: []
            })
        });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.deepEqual(data.cancelledActivityBookingIds, ['BK-PINATA']);
        assert.equal(state.rows.find(row => row.id === 'BK-PINATA').status, 'cancelled');
        assert.equal(state.rows.find(row => row.id === 'BK-KITCHEN').status, 'confirmed');
        assert.deepEqual(
            state.banquetMemberships.map(row => `${row.booking_id}:${row.role}`).sort(),
            ['BK-KITCHEN:kitchen', 'BK-ROOT:primary']
        );
        assert.equal(state.links.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    }, {
        mockProductPricing: true,
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: groupUpdatedAt
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }, {
            id: 2, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-PINATA', role: 'activity', sort_order: 100
        }, {
            id: 3, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-KITCHEN', role: 'kitchen', sort_order: 30
        }]
    });
});

test('legacy booking PUT rejects activityIds that differ from actual banquet membership', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT', line_id: 'line-bubble', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30,
            customer_id: 101, room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/bookings/BK-ROOT?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                extraData: { multiActivity: { activityIds: ['bubble', 'pinata'] } }
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_ACTIVITY_SET_REQUIRES_ATOMIC_ENDPOINT');
        assert.deepEqual(data.requestedActivityIds, ['bubble', 'pinata']);
        assert.deepEqual(data.actualActivityIds, ['bubble']);
        assert.equal(state.tx.length, 0);
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: '2099-01-01T00:00:00.000Z'
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }]
    });
});

test('PUT banquet booking-set rejects stale group version before writes', async () => {
    await withApp([
        bookingRow({
            id: 'BK-ROOT', line_id: 'line-bubble', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30,
            customer_id: 101, room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: '2099-01-01T00:00:00.000Z',
                primaryPatch: {},
                activities: []
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_BOOKING_SET_VERSION_CONFLICT');
        assert.equal(data.currentUpdatedAt, '2099-01-01T01:00:00.000Z');
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.rows.find(row => row.id === 'BK-ROOT').notes, null);
    }, {
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: '2099-01-01T01:00:00.000Z'
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }]
    });
});

test('PUT banquet booking-set rolls back the whole desired set on an internal line conflict', async () => {
    const groupUpdatedAt = '2099-01-01T00:00:00.000Z';
    await withApp([
        bookingRow({
            id: 'BK-ROOT', time: '12:00', line_id: 'line-shared', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30,
            customer_id: 101, room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const before = JSON.stringify(state.rows);
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: groupUpdatedAt,
                primaryPatch: { notes: 'must roll back' },
                activities: [{
                    date: '2099-06-01', time: '12:15', lineId: 'line-shared', room: 'Room B',
                    programId: 'pinata', programCode: 'PIN', label: 'Pinata', programName: 'Pinata',
                    category: 'pinata', duration: 15, price: 700, hosts: 1, pinataMode: 'park'
                }]
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_BOOKING_SET_LINE_CONFLICT');
        assert.equal(JSON.stringify(state.rows), before);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.banquetMemberships.length, 1);
    }, {
        mockProductPricing: true,
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: groupUpdatedAt
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }]
    });
});

test('PUT banquet booking-set fails closed for a new activity that needs a linked second animator booking', async () => {
    const groupUpdatedAt = '2099-01-01T00:00:00.000Z';
    await withApp([
        bookingRow({
            id: 'BK-ROOT', line_id: 'line-bubble', program_id: 'bubble', program_code: 'BUBBLE',
            label: 'Bubble show', program_name: 'Bubble show', category: 'show', duration: 30,
            customer_id: 101, room: 'Room A'
        })
    ], [], async ({ baseUrl, state }) => {
        const res = await fetch(`${baseUrl}/api/banquets/BQ-ROOT/booking-set?businessContext=event_genix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                primaryBookingId: 'BK-ROOT',
                expectedGroupUpdatedAt: groupUpdatedAt,
                primaryPatch: {},
                activities: [{
                    date: '2099-06-01', time: '12:30', lineId: 'line-pinata', room: 'Room A',
                    programId: 'pinata', programCode: 'PIN', label: 'Pinata', programName: 'Pinata',
                    category: 'pinata', duration: 15, price: 700, hosts: 2,
                    secondAnimator: 'Second animator', pinataMode: 'park'
                }]
            })
        });
        const data = await res.json();
        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.code, 'BANQUET_BOOKING_SET_LINKED_ACTIVITY_REQUIRES_NESTED_CONTRACT');
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.rows.length, 1);
        assert.equal(state.banquetMemberships.length, 1);
    }, {
        mockProductPricing: true,
        banquetGroups: [{
            id: 'BQ-ROOT', business_context: 'event_genix', primary_booking_id: 'BK-ROOT', customer_id: 101,
            date: '2099-06-01', room: 'Room A', group_name: 'Atomic banquet', status: 'active', source: 'test',
            meta: {}, updated_at: groupUpdatedAt
        }],
        banquetMemberships: [{
            id: 1, group_id: 'BQ-ROOT', business_context: 'event_genix', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10
        }]
    });
});

test('banquet activity consistency audit is read-only and reports technical identifiers only', async () => {
    const {
        auditBanquetActivityConsistency,
        buildBanquetActivityConsistencyReport
    } = require('../scripts/audit-banquet-activity-consistency');
    const rows = [{
        group_id: 'BQ-CONSISTENT',
        primary_booking_id: 'BK-CONSISTENT-ROOT',
        primary_program_id: 'bubble',
        primary_program_code: 'BUBBLE',
        primary_program_name: 'Sensitive name must not be reported',
        primary_category: 'show',
        primary_line_id: 'line-1',
        primary_price: 2400,
        primary_extra_data: JSON.stringify({ multiActivity: { activityIds: ['bubble', 'pinata'] } }),
        member_role: 'activity',
        member_booking_id: 'BK-CONSISTENT-PINATA',
        member_sort_order: 100,
        member_program_id: 'pinata',
        customer_name: 'Private customer',
        room: 'Private room'
    }, {
        group_id: 'BQ-MISMATCH',
        primary_booking_id: 'BK-MISMATCH-ROOT',
        primary_program_id: 'bubble',
        primary_program_code: 'BUBBLE',
        primary_category: 'show',
        primary_line_id: 'line-1',
        primary_price: 2400,
        primary_extra_data: JSON.stringify({ multiActivity: { activityIds: ['bubble'] } }),
        member_role: 'activity',
        member_booking_id: 'BK-MISMATCH-PINATA',
        member_sort_order: 100,
        member_program_id: 'pinata'
    }];
    const report = buildBanquetActivityConsistencyReport(rows, 'event_genix');
    assert.deepEqual(report.summary, {
        groupsScanned: 2,
        consistentGroups: 1,
        mismatchedGroups: 1,
        missingActivityReferences: 1,
        unexpectedActivityReferences: 0,
        orderMismatches: 0
    });
    assert.deepEqual(report.mismatches, [{
        groupId: 'BQ-MISMATCH',
        primaryBookingId: 'BK-MISMATCH-ROOT',
        activityBookingIds: ['BK-MISMATCH-PINATA'],
        membershipActivityCount: 2,
        extraActivityCount: 1,
        missingActivityCount: 1,
        unexpectedActivityCount: 0,
        orderMismatch: false
    }]);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /Private customer|Private room|Sensitive name/);

    const queries = [];
    const audited = await auditBanquetActivityConsistency({
        businessContext: 'event_genix',
        db: {
            async query(sql, params) {
                queries.push({ sql: String(sql), params });
                return { rows };
            }
        }
    });
    assert.equal(audited.summary.mismatchedGroups, 1);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(queries[0].sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    assert.deepEqual(queries[0].params, ['event_genix']);

    const script = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'audit-banquet-activity-consistency.js'),
        'utf8'
    );
    assert.match(script, /BEGIN TRANSACTION READ ONLY/);
    assert.doesNotMatch(script, /--fix|--apply|--repair/);
});

test('banquet activity metadata repair is allowlisted, confirmed, transactional, and post-audited', async () => {
    const {
        APPLY_CONFIRMATION,
        parseArgs,
        runApply,
        validateApplyOptions
    } = require('../scripts/repair-banquet-activity-consistency');
    const parsed = parseArgs([
        '--apply',
        `--confirm=${APPLY_CONFIRMATION}`,
        '--groups=BQ-REPAIR,BQ-REPAIR',
        '--group=BQ-SECOND',
        '--context=event_genix'
    ]);
    assert.deepEqual(parsed.groupIds, ['BQ-SECOND', 'BQ-REPAIR']);
    assert.equal(parsed.apply, true);
    assert.equal(parsed.confirmation, APPLY_CONFIRMATION);
    assert.throws(
        () => validateApplyOptions({ apply: true, confirmation: '', groupIds: ['BQ-REPAIR'] }),
        /Apply requires --confirm=/
    );
    assert.throws(
        () => validateApplyOptions({ apply: true, confirmation: APPLY_CONFIRMATION, groupIds: [] }),
        /explicit --groups/
    );

    let repaired = false;
    const queries = [];
    const reportRows = () => [{
        group_id: 'BQ-REPAIR',
        primary_booking_id: 'BK-ROOT',
        primary_program_id: 'bubble',
        primary_program_code: 'BUBBLE',
        primary_program_name: 'Sensitive program name',
        primary_category: 'show',
        primary_line_id: 'line-main',
        primary_price: 2400,
        primary_extra_data: JSON.stringify({
            multiActivity: { activityIds: repaired ? ['bubble', 'pinata'] : ['bubble'] }
        }),
        member_role: 'activity',
        member_booking_id: 'BK-PINATA',
        member_sort_order: 100,
        member_program_id: 'pinata'
    }];
    const db = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ sql: text, params });
            if (/^BEGIN ISOLATION LEVEL SERIALIZABLE$/.test(text)) return { rows: [] };
            if (/^COMMIT$|^ROLLBACK$/.test(text)) return { rows: [] };
            if (/FROM banquet_groups bg[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [{ id: 'BQ-REPAIR', primary_booking_id: 'BK-ROOT' }] };
            }
            if (/FROM banquet_group_bookings bgb[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [
                    { id: 1, group_id: 'BQ-REPAIR', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10 },
                    { id: 2, group_id: 'BQ-REPAIR', booking_id: 'BK-PINATA', role: 'activity', sort_order: 100 }
                ] };
            }
            if (/SELECT b\.\*[\s\S]*FROM bookings b[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [
                    { id: 'BK-ROOT', status: 'confirmed', extra_data: '{}' },
                    { id: 'BK-PINATA', status: 'confirmed', extra_data: '{}' }
                ] };
            }
            if (/SELECT bg\.id AS group_id/.test(text)) return { rows: reportRows() };
            if (/UPDATE banquet_groups/.test(text)) return { rows: [], rowCount: 1 };
            if (/INSERT INTO history/.test(text)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected repair query: ${text}`);
        }
    };
    const result = await runApply(db, {
        apply: true,
        confirmation: APPLY_CONFIRMATION,
        groupIds: ['BQ-REPAIR'],
        businessContext: 'event_genix'
    }, {
        async persistDerivedBookingSetMetadata(client, group, context, options) {
            assert.equal(client, db);
            assert.equal(group.id, 'BQ-REPAIR');
            assert.equal(context, 'event_genix');
            assert.equal(options.source, 'banquet-activity-metadata-repair');
            repaired = true;
            return { activityIds: ['bubble', 'pinata'] };
        },
        async persistPrimaryDerivedMetadata(client, group, context, derived, source) {
            assert.equal(client, db);
            assert.equal(group.id, 'BQ-REPAIR');
            assert.equal(context, 'event_genix');
            assert.deepEqual(derived.activityIds, ['bubble', 'pinata']);
            assert.equal(source, 'banquet-activity-metadata-repair');
        }
    });
    assert.equal(result.repaired.length, 1);
    assert.equal(result.afterSummary.mismatchedGroups, 0);
    assert.equal(queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
    assert.ok(queries.some(item => /FOR UPDATE/.test(item.sql)));
    assert.ok(queries.some(item => /INSERT INTO history/.test(item.sql)));
    assert.equal(queries.at(-1).sql, 'COMMIT');

    const script = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'repair-banquet-activity-consistency.js'),
        'utf8'
    );
    assert.match(script, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
    assert.match(script, /FOR UPDATE/);
    assert.match(script, /banquet_activity_metadata_repaired/);
    assert.match(script, /Post-repair audit still reports mismatches/);
    assert.match(
        script,
        /const lifecycle = await prepareGroupLifecycleForRepair[\s\S]*if \(lifecycle\.action === 'cancelled_group'\)[\s\S]*if \(!item && lifecycle\.action === 'metadata_only'\)/
    );
    assert.doesNotMatch(script, /JOIN customers|phone|instagram|child_name/i);
});

test('banquet activity metadata repair rolls back when the strict post-audit still mismatches', async () => {
    const {
        APPLY_CONFIRMATION,
        runApply
    } = require('../scripts/repair-banquet-activity-consistency');
    const tx = [];
    const mismatchRow = {
        group_id: 'BQ-ROLLBACK',
        primary_booking_id: 'BK-ROOT',
        primary_program_id: 'bubble',
        primary_category: 'show',
        primary_line_id: 'line-main',
        primary_price: 2400,
        primary_extra_data: JSON.stringify({ multiActivity: { activityIds: ['bubble'] } }),
        member_role: 'activity',
        member_booking_id: 'BK-PINATA',
        member_sort_order: 100,
        member_program_id: 'pinata'
    };
    const db = {
        async query(sql) {
            const text = String(sql);
            if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(text)) tx.push(text);
            if (/FROM banquet_groups bg[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [{ id: 'BQ-ROLLBACK', primary_booking_id: 'BK-ROOT' }] };
            }
            if (/FROM banquet_group_bookings bgb[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [
                    { id: 1, group_id: 'BQ-ROLLBACK', booking_id: 'BK-ROOT', role: 'primary', sort_order: 10 },
                    { id: 2, group_id: 'BQ-ROLLBACK', booking_id: 'BK-PINATA', role: 'activity', sort_order: 100 }
                ] };
            }
            if (/SELECT b\.\*[\s\S]*FROM bookings b[\s\S]*FOR UPDATE/.test(text)) {
                return { rows: [
                    { id: 'BK-ROOT', status: 'confirmed', extra_data: '{}' },
                    { id: 'BK-PINATA', status: 'confirmed', extra_data: '{}' }
                ] };
            }
            if (/SELECT bg\.id AS group_id/.test(text)) return { rows: [mismatchRow] };
            return { rows: [], rowCount: 1 };
        }
    };
    await assert.rejects(
        runApply(db, {
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            groupIds: ['BQ-ROLLBACK'],
            businessContext: 'event_genix'
        }, {
            async persistDerivedBookingSetMetadata() {
                return { activityIds: ['bubble', 'pinata'] };
            },
            async persistPrimaryDerivedMetadata() {
                return null;
            }
        }),
        /Post-repair audit still reports mismatches/
    );
    assert.deepEqual(tx, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
});

test('banquet activity metadata repair handles only proven cancelled-group and single-member promotion lifecycles', async () => {
    const {
        prepareGroupLifecycleForRepair
    } = require('../scripts/repair-banquet-activity-consistency');
    const cancelledQueries = [];
    const cancelled = await prepareGroupLifecycleForRepair({
        async query(sql, params) {
            cancelledQueries.push({ sql: String(sql), params });
            return { rows: [], rowCount: 1 };
        }
    }, {
        id: 'BQ-CANCELLED', primary_booking_id: 'BK-CANCELLED'
    }, {
        memberships: [{ group_id: 'BQ-CANCELLED', booking_id: 'BK-CANCELLED', role: 'primary' }],
        bookings: [{ id: 'BK-CANCELLED', status: 'cancelled', extra_data: '{}' }]
    }, 'event_genix');
    assert.equal(cancelled.action, 'cancelled_group');
    assert.ok(cancelledQueries.some(item => /SET status = 'cancelled'/.test(item.sql)));
    assert.ok(cancelledQueries.some(item => /banquet_group_cancelled_by_repair/.test(String(item.params?.[1]))));

    const promotedQueries = [];
    const promoted = await prepareGroupLifecycleForRepair({
        async query(sql, params) {
            promotedQueries.push({ sql: String(sql), params });
            return { rows: [], rowCount: 1 };
        }
    }, {
        id: 'BQ-PROMOTE', primary_booking_id: 'BK-OLD'
    }, {
        memberships: [
            { group_id: 'BQ-PROMOTE', booking_id: 'BK-OLD', role: 'primary' },
            { group_id: 'BQ-PROMOTE', booking_id: 'BK-KITCHEN', role: 'kitchen' }
        ],
        bookings: [
            { id: 'BK-OLD', status: 'cancelled', extra_data: JSON.stringify({ multiActivity: { activityIds: ['old'] } }) },
            { id: 'BK-KITCHEN', status: 'confirmed', extra_data: '{}' }
        ]
    }, 'event_genix');
    assert.equal(promoted.action, 'promoted_primary');
    assert.equal(promoted.group.primary_booking_id, 'BK-KITCHEN');
    assert.ok(promotedQueries.some(item => /DELETE FROM banquet_group_bookings/.test(item.sql)));
    assert.ok(promotedQueries.some(item => /SET role = 'primary'/.test(item.sql)));
    assert.ok(promotedQueries.some(item => /SET primary_booking_id = \$4/.test(item.sql)));
    assert.ok(promotedQueries.some(item => /DELETE FROM booking_banquet_links/.test(item.sql)));
    const detachedMetadata = promotedQueries.find(item => /UPDATE bookings[\s\S]*SET extra_data/.test(item.sql));
    assert.ok(detachedMetadata);
    assert.doesNotMatch(String(detachedMetadata.params?.[0]), /multiActivity|banquetGroup/);

    await assert.rejects(
        prepareGroupLifecycleForRepair({ query: async () => ({ rows: [], rowCount: 0 }) }, {
            id: 'BQ-AMBIGUOUS', primary_booking_id: 'BK-OLD'
        }, {
            memberships: [
                { group_id: 'BQ-AMBIGUOUS', booking_id: 'BK-OLD', role: 'primary' },
                { group_id: 'BQ-AMBIGUOUS', booking_id: 'BK-A', role: 'activity' },
                { group_id: 'BQ-AMBIGUOUS', booking_id: 'BK-B', role: 'activity' }
            ],
            bookings: [
                { id: 'BK-OLD', status: 'cancelled' },
                { id: 'BK-A', status: 'confirmed' },
                { id: 'BK-B', status: 'confirmed' }
            ]
        }, 'event_genix'),
        /Inactive primary requires manual repair/
    );
});
