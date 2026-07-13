const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(...segments) {
    return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

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
        '../services/banquetTerms',
        '../services/websocket',
        '../services/eventBus',
        '../routes/dashboard',
        '../routes/bookings'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function mapBookingRow(row = {}) {
    const extraData = typeof row.extra_data === 'string'
        ? JSON.parse(row.extra_data || '{}')
        : (row.extra_data || null);
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
        pinataMode: row.pinata_mode || null,
        pinataNumber: row.pinata_number || null,
        pinataFillerNumber: row.pinata_filler_number || null,
        pinataFiller: row.pinata_filler || null,
        clientPinataServicePrice: row.client_pinata_service_price ?? null,
        clientPinataServiceNote: row.client_pinata_service_note || null,
        extraData,
        bookingPackage: extraData?.bookingPackage || null,
        banquetGuests: row.banquet_guests || null,
        banquetAdults: row.banquet_adults || null,
        banquetTables: row.banquet_tables || null,
        banquetMenu: row.banquet_menu || null
    };
}

function bookingRowFromInsert(params) {
    const banquetStart = params.length >= 37 ? 33 : (params.length >= 36 ? 32 : -1);
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
        banquet_guests: banquetStart >= 0 ? params[banquetStart] : null,
        banquet_adults: banquetStart >= 0 ? params[banquetStart + 1] : null,
        banquet_tables: banquetStart >= 0 ? params[banquetStart + 2] : null,
        banquet_menu: banquetStart >= 0 ? params[banquetStart + 3] : null,
        created_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2099-01-01T00:00:00.000Z'
    };
}

function normalizeContext(value) {
    const raw = String(value || 'event_genix').trim().toLowerCase();
    return ['park_zakrevsky', 'park', 'pzp'].includes(raw) ? 'event_genix' : raw;
}

function testTimeToMinutes(value) {
    const [hours, minutes] = String(value || '00:00').slice(0, 5).split(':').map(Number);
    return (hours * 60) + minutes;
}

function testIntervalsOverlap(leftTime, leftDuration, rightTime, rightDuration) {
    const leftStart = testTimeToMinutes(leftTime);
    const leftEnd = leftStart + (parseInt(leftDuration, 10) || 0);
    const rightStart = testTimeToMinutes(rightTime);
    const rightEnd = rightStart + (parseInt(rightDuration, 10) || 0);
    return leftStart < rightEnd && leftEnd > rightStart;
}

function testExcludeIdSet(value) {
    const raw = [];
    if (Array.isArray(value)) {
        raw.push(...value);
    } else if (value && typeof value === 'object') {
        if (Array.isArray(value.excludeIds)) raw.push(...value.excludeIds);
        if (value.excludeId) raw.push(value.excludeId);
        if (value.sourceBookingId) raw.push(value.sourceBookingId);
    } else if (value) {
        raw.push(value);
    }
    return new Set(raw.map(item => String(item || '').trim()).filter(Boolean));
}

function testExtraData(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function testBanquetGroupId(booking = {}) {
    const extra = testExtraData(booking.extraData ?? booking.extra_data);
    const group = extra.banquetGroup || extra.banquet_group || booking.banquetGroup || booking.banquet_group || {};
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    return String(
        booking.banquetGroupId
        || booking.banquet_group_id
        || group.groupId
        || group.group_id
        || group.id
        || workspace.banquetGroupId
        || workspace.banquet_group_id
        || ''
    ).trim();
}

function testBanquetRole(booking = {}) {
    const extra = testExtraData(booking.extraData ?? booking.extra_data);
    const group = extra.banquetGroup || extra.banquet_group || {};
    const role = String(booking.banquetGroupRole || booking.banquet_group_role || group.role || '').trim().toLowerCase();
    if (role) return role;
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    const category = String(booking.category || '').trim().toLowerCase();
    if (programCode === 'KITCHEN' || category === 'kitchen') return 'kitchen';
    if (['animation', 'activity', 'custom', 'quest', 'show', 'masterclass', 'workshop'].includes(category)) return 'activity';
    return 'generic';
}

function testRoomPolicyAllowsOverlap(candidate, conflict, excludeArg) {
    if (!excludeArg?.allowSameBanquetOperationalOverlap) return false;
    const candidateGroupId = testBanquetGroupId(candidate) || String(excludeArg.banquetGroupId || '').trim();
    const conflictGroupId = testBanquetGroupId(conflict);
    if (!candidateGroupId || candidateGroupId !== conflictGroupId) return false;
    const candidateRole = testBanquetRole(candidate);
    const conflictRole = testBanquetRole(conflict);
    const candidateActivity = candidateRole === 'activity';
    const conflictActivity = conflictRole === 'activity';
    const candidateOperational = ['kitchen', 'service', 'manual'].includes(candidateRole);
    const conflictOperational = ['kitchen', 'service', 'manual'].includes(conflictRole);
    return (candidateActivity && conflictOperational) || (candidateOperational && conflictActivity);
}

function banquetTermsPriceRuleRows() {
    return [
        { code: 'banquet_own_cake_fee', value: 500 },
        { code: 'banquet_cork_fee', value: 100 },
        { code: 'banquet_menu_correction_deadline_days', value: 3 },
        { code: 'banquet_date_change_deadline_days', value: 5 }
    ];
}

function stateBackedRoomConflict(state) {
    return async (_client, date, room, time, duration, excludeArg = null, businessContext = 'event_genix') => {
        const excluded = testExcludeIdSet(excludeArg);
        const candidate = excludeArg?.candidateBooking || {};
        return state.rows.find(row => {
            const conflicts = row.date === date &&
                row.room === room &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                !excluded.has(String(row.id)) &&
                testIntervalsOverlap(time, duration, row.time, row.duration);
            if (!conflicts) return false;
            return !testRoomPolicyAllowsOverlap({ ...candidate, date, room, time, duration }, row, excludeArg);
        }) || null;
    };
}

function stateBackedLineConflict(state) {
    return async (_client, date, lineId, time, duration, excludeArg = null, businessContext = 'event_genix') => {
        const normalizedLine = String(lineId || '').trim().toLowerCase();
        if (!normalizedLine || normalizedLine === 'banquet-service' || normalizedLine === 'room-takeaway') {
            return { overlap: false, noPause: false, conflictWith: null };
        }
        const excluded = testExcludeIdSet(excludeArg);
        const conflictWith = state.rows.find(row =>
            row.date === date &&
            String(row.line_id || '').trim() === String(lineId || '').trim() &&
            normalizeContext(row.business_context) === normalizeContext(businessContext) &&
            String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
            !excluded.has(String(row.id)) &&
            testIntervalsOverlap(time, duration, row.time, row.duration)
        ) || null;
        return { overlap: Boolean(conflictWith), noPause: false, conflictWith };
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
        links: [],
        customers: [],
        nextCustomerId: 701,
        nextBookingSeq: 1,
        leadAttempts: 0,
        financeAttempts: 0,
        released: 0,
        timelineLineResolveSelects: 0
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
            state.timelineLineResolveSelects += 1;
            const [date, businessContext, lineId, name] = params;
            const normalizedName = String(name || '').trim().toLowerCase();
            const rows = state.lines.filter(line =>
                line.date === date &&
                normalizeContext(line.business_context) === normalizeContext(businessContext) &&
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
        if (/FROM price_rules\s+WHERE code = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const requested = new Set(params[0] || []);
            return {
                rows: banquetTermsPriceRuleRows().filter(row => requested.has(row.code)),
                rowCount: requested.size
            };
        }
        if (/SELECT id FROM customers WHERE phone = \$1/i.test(sql)) {
            const [phone, businessContext] = params;
            const row = state.customers.find(item =>
                item.phone === phone &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
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
        if (/SELECT id FROM customers WHERE id = \$1 AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) IN \('park_zakrevsky', 'park', 'pzp'\) THEN 'event_genix' ELSE LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) END) = \$2 LIMIT 1/i.test(sql)) {
            const [id, businessContext] = params;
            const row = state.customers.find(item =>
                Number(item.id) === Number(id) &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
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
        if (/SELECT \* FROM bookings WHERE id = \$1 AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) IN \('park_zakrevsky', 'park', 'pzp'\) THEN 'event_genix' ELSE LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) END) = \$2(?: FOR UPDATE)?/i.test(sql)) {
            const [id, businessContext] = params;
            const row = state.rows.find(item =>
                item.id === id &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT id, business_context, date, time, line_id, program_id, program_code, label, program_name/i.test(sql) && /FROM bookings b WHERE b\.date = \$1/i.test(sql)) {
            const [date, businessContext] = params;
            const rows = state.rows
                .filter(row =>
                    row.date === date &&
                    normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                    String(row.status || 'confirmed').toLowerCase() !== 'cancelled'
                )
                .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/^UPDATE bookings SET date=\$1, time=\$2, line_id=\$3/i.test(sql) && /RETURNING \*/i.test(sql)) {
            const optimistic = sql.includes("date_trunc('milliseconds'");
            const tailOffset = optimistic ? 1 : 0;
            const id = params[22];
            const businessContext = params[params.length - 1];
            const row = state.rows.find(item =>
                item.id === id &&
                normalizeContext(item.business_context) === normalizeContext(businessContext)
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
                customer_id: params[23 + tailOffset],
                payment_method: params[24 + tailOffset],
                pinata_mode: params[25 + tailOffset],
                client_pinata_service_price: params[26 + tailOffset],
                client_pinata_service_note: params[27 + tailOffset],
                pinata_number: params[28 + tailOffset],
                pinata_filler_number: params[29 + tailOffset],
                banquet_guests: params[30 + tailOffset],
                banquet_adults: params[31 + tailOffset],
                banquet_tables: params[32 + tailOffset],
                banquet_menu: params[33 + tailOffset],
                updated_at: '2099-01-02T00:00:00.000Z'
            });
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/SELECT id, line_id, second_animator, program_id, price FROM bookings WHERE linked_to = \$1/i.test(sql)) {
            const [linkedTo, businessContext] = params;
            const rows = state.rows.filter(row =>
                row.linked_to === linkedTo &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id FROM bookings WHERE linked_to = \$1 AND (?:COALESCE\(business_context, 'event_genix'\)|CASE WHEN LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) IN \('park_zakrevsky', 'park', 'pzp'\) THEN 'event_genix' ELSE LOWER\(COALESCE\(NULLIF\(BTRIM\(business_context\), ''\), 'event_genix'\)\) END) = \$2/i.test(sql)) {
            const [linkedTo, businessContext] = params;
            const rows = state.rows.filter(row =>
                row.linked_to === linkedTo &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ id: row.id })), rowCount: rows.length };
        }
        if (/^DELETE FROM bookings WHERE id = \$1/i.test(sql)) {
            const [id, businessContext] = params;
            const before = state.rows.length;
            state.rows = state.rows.filter(row =>
                !(row.id === id && normalizeContext(row.business_context) === normalizeContext(businessContext))
            );
            return { rows: [], rowCount: before - state.rows.length };
        }
        if (/^UPDATE bookings SET date=\$1, time=\$2, duration=\$3, status=\$4, room=\$5/i.test(sql)) {
            const id = params[11];
            const businessContext = params[12];
            const row = state.rows.find(item =>
                item.id === id &&
                normalizeContext(item.business_context) === normalizeContext(businessContext) &&
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
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                row.status !== 'cancelled'
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT b\.id FROM bookings b WHERE b\.date = \$1/i.test(sql)) {
            const [date, businessContext, id] = params;
            const row = state.rows.find(item =>
                item.date === date &&
                normalizeContext(item.business_context) === normalizeContext(businessContext) &&
                item.id === id &&
                item.status !== 'cancelled'
            );
            return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (/SELECT id, date, time, duration, room, status, linked_to, label, program_code, program_name, group_name FROM bookings WHERE date = \$1 AND room = \$2/i.test(sql)) {
            const [date, room, businessContext, excludedId] = params;
            const rows = state.rows.filter(row =>
                row.date === date &&
                row.room === room &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                row.status !== 'cancelled' &&
                row.id !== excludedId &&
                !String(row.linked_to || '').trim()
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id, time, duration, label, program_code FROM bookings\s+WHERE date = \$1 AND room = \$2/i.test(sql)) {
            const [date, room, businessContext, excludeIds] = params;
            const excluded = testExcludeIdSet(excludeIds || []);
            const rows = state.rows.filter(row =>
                row.date === date &&
                row.room === room &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                row.status !== 'cancelled' &&
                !excluded.has(String(row.id))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT 1 FROM booking_banquet_links/i.test(sql)) {
            const [businessContext, bookingA, bookingB, relationTypes] = params;
            const relationSet = new Set(Array.isArray(relationTypes) ? relationTypes : [relationTypes]);
            const found = state.links.find(link =>
                link.business_context === businessContext &&
                link.booking_a_id === bookingA &&
                link.booking_b_id === bookingB &&
                relationSet.has(link.relation_type)
            );
            return { rows: found ? [{ '?column?': 1 }] : [], rowCount: found ? 1 : 0 };
        }
        if (/INSERT INTO booking_banquet_links/i.test(sql)) {
            const [businessContext, bookingA, bookingB, relationType, label, createdByUserId, createdBy] = params;
            const row = {
                id: state.links.length + 1,
                business_context: businessContext,
                booking_a_id: bookingA,
                booking_b_id: bookingB,
                relation_type: relationType,
                label,
                created_by_user_id: createdByUserId,
                created_by: createdBy,
                created_at: '2099-01-01T00:00:00.000Z'
            };
            state.links.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/^INSERT INTO lines_by_date \(business_context, date, line_id, name, color, from_sheet\)/i.test(sql)) {
            return { rows: [], rowCount: 1 };
        }
        if (/FROM booking_banquet_links WHERE business_context = \$1/i.test(sql)) {
            const [businessContext, relationTypes, ids] = params;
            const relationSet = new Set(Array.isArray(relationTypes) ? relationTypes : [relationTypes]);
            const visible = new Set(Array.isArray(ids) ? ids.map(String) : []);
            const rows = state.links.filter(link =>
                link.business_context === businessContext &&
                relationSet.has(link.relation_type) &&
                visible.has(String(link.booking_a_id)) &&
                visible.has(String(link.booking_b_id))
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
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
    const checkRoomConflict = dbOptions.checkRoomConflict
        || (dbOptions.stateBackedRoomConflicts ? stateBackedRoomConflict(state) : async () => null);
    const checkServerConflicts = dbOptions.checkServerConflicts
        || (dbOptions.stateBackedLineConflicts ? stateBackedLineConflict(state) : async () => ({ overlap: false }));
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
        isLineConflictBlockingLine: value => {
            const lineId = String(value || '').trim().toLowerCase();
            return Boolean(lineId && lineId !== 'banquet-service' && lineId !== 'room-takeaway');
        },
        isRoomConflictBlockingRoom: value => {
            const room = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
            return Boolean(room && room !== 'інше' && room !== 'other' && room !== 'на виніс' && room !== 'room-takeaway');
        },
        ALL_ROOMS: ['Room A', '\u041f\u043e\u043d\u0456'],
        BANQUET_SERVICE_LINE_ID: 'banquet-service',
        checkServerConflicts,
        checkServerDuplicate: async () => null,
        checkRoomConflict,
        timeToMinutes: value => {
            const [h, m] = String(value).split(':').map(Number);
            return h * 60 + m;
        }
    });
    installMock('../services/timelineResources', {
        listTimelineResources: async () => ([
            { resourceId: 'room-a', type: 'room', name: 'Room A', isActive: true, metadata: {} },
            { resourceId: 'room-pony', type: 'room', name: '\u041f\u043e\u043d\u0456', isActive: true, metadata: {} }
        ]),
        resolveRoomTimelineResourceIdentity: (resources, booking) => {
            const room = String(booking.room || '').trim();
            const resource = resources.find(item => item.name === room);
            return resource
                ? {
                    resourceId: resource.resourceId,
                    resourceName: resource.name,
                    legacyRoomName: room,
                    status: 'active',
                    diagnosticReason: null,
                    assignmentAllowed: true
                }
                : {
                    resourceId: 'room-quarantine',
                    resourceName: 'Невідома / неактивна кімната',
                    legacyRoomName: room,
                    status: 'custom',
                    diagnosticReason: 'custom_room',
                    assignmentAllowed: false
                };
        },
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
        applyBookingPackageEntryCharge: async (_queryable, booking) => booking,
        bookingPackageAudit: () => ({})
    });
    installMock('../services/websocket', { broadcastBookingEvent: () => null });
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

async function createBooking(baseUrl, overrides = {}, options = {}) {
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
    const url = new URL(`${baseUrl}/api/bookings`);
    if (options.timelineView) url.searchParams.set('timelineView', options.timelineView);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, timelineView: res.headers.get('x-timeline-view') };
}

async function withMockedKyivNow(iso, fn) {
    mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
    try {
        return await fn();
    } finally {
        mock.timers.reset();
    }
}

function kitchenOperationalTimePayload(overrides = {}) {
    return {
        date: '2026-06-18',
        time: '12:15',
        lineId: 'banquet-service',
        room: 'Room A',
        programId: null,
        programCode: 'KITCHEN',
        label: 'Kitchen',
        programName: 'Kitchen order',
        category: 'custom',
        duration: 60,
        price: 1340,
        hosts: 0,
        banquetGuests: 22,
        banquetMenu: 'Kitchen order',
        extraData: {
            bookingWorkspace: { scenario: 'kitchen_only' },
            bookingPackage: {
                schemaVersion: 2,
                programBasePrice: 0,
                positionsSubtotal: 1340,
                finalTotal: 1340,
                menuPositions: [
                    { id: 'item-1', title: 'Fruit plate', quantity: 2, unitPrice: 400, subtotal: 800, servingTime: '18:18' }
                ],
                serviceEvents: [
                    { id: 'service-event-1', type: 'drinks', title: 'Напої', time: '19:15' }
                ]
            }
        },
        ...overrides
    };
}

async function createFullBooking(baseUrl, overrides = {}, options = {}) {
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
    const body = { main, linked };
    if (Array.isArray(overrides.banquetActivities)) {
        body.banquetActivities = overrides.banquetActivities;
    }
    const url = new URL(`${baseUrl}/api/bookings/full`);
    if (options.timelineView) url.searchParams.set('timelineView', options.timelineView);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, timelineView: res.headers.get('x-timeline-view') };
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

function timelineProjectionSnapshot(booking = {}) {
    const projection = booking.timelineProjection || {};
    return {
        timelineView: projection.timelineView || null,
        resourceType: projection.resourceType || null,
        resourceId: projection.resourceId || null,
        resourceName: projection.resourceName || null,
        lineId: projection.lineId || null,
        visibleInAnimatorTimeline: projection.visibleInAnimatorTimeline,
        visibleInRoomTimeline: projection.visibleInRoomTimeline,
        displaySurface: projection.displaySurface || null,
        hiddenReason: projection.hiddenReason || null,
        businessContext: projection.businessContext || null,
        date: projection.date || null
    };
}

test('booking create response projection is derived from the request timeline view', () => {
    const source = read('routes', 'bookings.js');

    assert.match(source, /function timelineViewFromRequest\(req, fallback = 'animators'\)/);
    assert.match(source, /let allCreatedBookings = \[booking, \.\.\.linkedBookings\]/);
    assert.match(source, /allCreatedBookings = await attachRoomTimelineResourceResolution\(client, allCreatedBookings, businessContext\)/);
    assert.match(source, /allBookings = await attachRoomTimelineResourceResolution\(client, allBookings, businessContext\)/);
    assert.match(source, /projectCreatedBookingsForTimelineResponse\(allCreatedBookings, timelineView\)/);
    assert.match(source, /projectCreatedBookingsForTimelineResponse\(allBookings, timelineView\)/);
    assert.doesNotMatch(source, /projectCreatedBookingsForTimelineResponse\(allBookings,\s*['"]animators['"]\)/);
});

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

test('POST /api/bookings projects created response for requested room timeline view', async () => {
    await withApp({}, async ({ baseUrl }) => {
        const res = await createBooking(baseUrl, {}, { timelineView: 'rooms' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.timelineView, 'rooms');
        assert.equal(res.data.success, true);
        assert.equal(res.data.booking.id, 'BK-2099-0001');
        assert.equal(res.data.booking.resourceId, 'room-a');
        assert.equal(res.data.booking.resourceType, 'room');
        assert.equal(res.data.booking.timelineProjection.view, 'rooms');
        assert.equal(res.data.booking.timelineProjection.resourceId, 'room-a');
        assert.equal(res.data.booking.timelineProjection.resourceType, 'room');
        assert.equal(res.data.booking.timelineVisibility.visible, true);
        assert.deepEqual(res.data.allBookings.map(item => item.id), ['BK-2099-0001']);
        assert.deepEqual(res.data.projection.bookings.map(item => item.resourceId), ['room-a']);
    });
});

test('POST /api/bookings keeps standalone second animator response fully projected for animator timeline', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createBooking(baseUrl, {
            date: '2099-02-13',
            lineId: 'line-main',
            lineName: 'Anna',
            secondAnimator: 'Second Animator',
            secondAnimatorLineId: 'line-second',
            hosts: 2
        }, { timelineView: 'animators' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.timelineView, 'animators');
        assert.equal(res.data.success, true);
        assert.equal(res.data.linkedBookings.length, 1);
        assert.deepEqual(res.data.allBookings.map(item => item.id), ['BK-2099-0001', 'BK-2099-0002']);
        assert.deepEqual(res.data.allBookings.map(item => item.timelineProjection.lineId), ['line-main', 'line-second']);
        assert.deepEqual(res.data.allBookings.map(item => item.timelineVisibility.visible), [true, true]);
        assert.equal(res.data.linkedBookings[0].linkedTo, res.data.booking.id);
        assert.equal(res.data.linkedBookings[0].timelineProjection.lineId, 'line-second');
        assert.equal(res.data.linkedBookings[0].timelineVisibility.visible, true);

        const linkedRow = state.rows.find(row => row.linked_to === res.data.booking.id);
        assert.ok(linkedRow, 'simple create inserts second animator linked row');
        assert.equal(linkedRow.line_id, 'line-second');
    });
});

test('POST /api/bookings allows same-banquet activity over existing kitchen room slot', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-KITCHEN',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen',
            category: 'kitchen',
            duration: 60,
            price: 0,
            hosts: 0,
            room: 'Room A',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: JSON.stringify({ banquetGroup: { groupId: 'BQ-ROOM-1', role: 'kitchen' } }),
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createBooking(baseUrl, {
            room: 'Room A',
            time: '15:30',
            lineId: 'line-1',
            programId: 'anim-60',
            programCode: 'AN',
            label: 'AN(60)',
            programName: 'Animation',
            category: 'animation',
            extraData: {
                banquetGroup: {
                    groupId: 'BQ-ROOM-1',
                    sourceBookingId: 'BK-2099-ROOT',
                    role: 'activity',
                    source: 'room_booking_animation_bridge'
                }
            }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(state.rows.length, 2);
        assert.equal(state.rows[1].room, 'Room A');
    });
});

test('POST /api/bookings keeps strict room conflict without banquet group context', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-KITCHEN',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen',
            category: 'kitchen',
            duration: 60,
            price: 0,
            hosts: 0,
            room: 'Room A',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createBooking(baseUrl, {
            room: 'Room A',
            time: '15:30',
            lineId: 'line-1',
            programId: 'anim-60',
            programCode: 'AN',
            label: 'AN(60)',
            programName: 'Animation',
            category: 'animation'
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(state.rows.length, 1);
    });
});

test('POST /api/bookings ignores cancelled kitchen member room slot', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-CANCELLED-KITCHEN',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen',
            category: 'kitchen',
            duration: 60,
            price: 0,
            hosts: 0,
            room: 'Room A',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'cancelled',
            kids_count: null,
            group_name: null,
            extra_data: JSON.stringify({ banquetGroup: { groupId: 'BQ-CANCELLED-1', role: 'kitchen' } }),
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createBooking(baseUrl, {
            room: 'Room A',
            time: '15:30',
            lineId: 'line-1',
            programId: 'anim-60',
            programCode: 'AN',
            label: 'AN(60)',
            programName: 'Animation',
            category: 'animation'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(state.rows.length, 2);
        assert.equal(state.rows[0].status, 'cancelled');
    });
});

test('POST /api/bookings allows room kitchen booking when anchor is past but operational times are future', async () => {
    await withMockedKyivNow('2026-06-18T11:58:30.000Z', async () => {
        await withApp({}, async ({ baseUrl, state }) => {
            const res = await createBooking(baseUrl, kitchenOperationalTimePayload());

            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.equal(res.data.success, true);
            assert.equal(state.rows.length, 1);
            assert.equal(state.rows[0].time, '12:15');
            const extra = typeof state.rows[0].extra_data === 'string'
                ? JSON.parse(state.rows[0].extra_data)
                : state.rows[0].extra_data;
            assert.equal(extra.bookingPackage.menuPositions[0].servingTime, '18:18');
            assert.equal(extra.bookingPackage.serviceEvents[0].time, '19:15');
            assert.equal(Array.isArray(extra.banquetTerms), true);
            assert.equal(extra.banquetTerms.some(item => item.includes('500') && item.includes('100')), true);
            assert.equal(extra.banquetTermsSnapshot.source, 'price_rules');
        });
    });
});

test('PUT /api/bookings/:id keeps manual banquet terms instead of overwriting snapshot from price rules', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-MANUAL',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '12:15',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen order',
            program_name: 'Kitchen',
            category: 'kitchen',
            duration: 30,
            price: 800,
            hosts: 0,
            second_animator: null,
            room: 'Marvel Room',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: 'Manual terms',
            extra_data: {
                banquetTerms: ['Manual terms stay locked.'],
                bookingWorkspace: { scenario: 'kitchen_only', hasEvent: false },
                bookingPackage: {
                    menuPositions: [
                        { id: 'menu-1', title: 'Fruit plate', quantity: 2, unitPrice: 400, subtotal: 800, servingTime: '18:18' }
                    ],
                    serviceEvents: []
                }
            },
            customer_id: null,
            payment_method: null,
            banquet_guests: 8,
            banquet_adults: null,
            banquet_tables: null,
            banquet_menu: 'Fruit plate - 2',
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await fetch(`${baseUrl}/api/bookings/BK-2099-MANUAL`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: '2099-02-10',
                time: '12:30',
                lineId: 'banquet-service',
                room: 'Marvel Room',
                programCode: 'KITCHEN',
                category: 'kitchen',
                duration: 30,
                price: 800,
                status: 'confirmed',
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only', hasEvent: false },
                    bookingPackage: {
                        menuPositions: [
                            { id: 'menu-1', title: 'Fruit plate', quantity: 2, unitPrice: 400, subtotal: 800, servingTime: '18:18' }
                        ],
                        serviceEvents: []
                    }
                }
            })
        });

        assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => ({}))));
        const row = state.rows.find(item => item.id === 'BK-2099-MANUAL');
        const extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data;
        assert.deepEqual(extra.banquetTerms, ['Manual terms stay locked.']);
        assert.equal(extra.banquetTermsSnapshot, undefined);
    });
});

test('POST /api/bookings rejects room kitchen booking when serving time is past', async () => {
    await withMockedKyivNow('2026-06-18T11:58:30.000Z', async () => {
        await withApp({}, async ({ baseUrl }) => {
            const res = await createBooking(baseUrl, kitchenOperationalTimePayload({
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only' },
                    bookingPackage: {
                        schemaVersion: 2,
                        programBasePrice: 0,
                        positionsSubtotal: 800,
                        finalTotal: 800,
                        menuPositions: [
                            { id: 'item-1', title: 'Fruit plate', quantity: 2, unitPrice: 400, subtotal: 800, servingTime: '12:30' }
                        ],
                        serviceEvents: []
                    }
                }
            }));

            assert.equal(res.status, 400, JSON.stringify(res.data));
            assert.match(res.data.error, /Час видачі 12:30 вже в минулому/);
        });
    });
});

test('POST /api/bookings falls back to anchor time for room kitchen booking without operational times', async () => {
    await withMockedKyivNow('2026-06-18T11:58:30.000Z', async () => {
        await withApp({}, async ({ baseUrl }) => {
            const res = await createBooking(baseUrl, kitchenOperationalTimePayload({
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only' },
                    bookingPackage: {
                        schemaVersion: 2,
                        programBasePrice: 0,
                        positionsSubtotal: 800,
                        finalTotal: 800,
                        menuPositions: [
                            { id: 'item-1', title: 'Fruit plate', quantity: 2, unitPrice: 400, subtotal: 800 }
                        ],
                        serviceEvents: []
                    }
                }
            }));

            assert.equal(res.status, 400, JSON.stringify(res.data));
            assert.match(res.data.error, /Час бронювання 12:15 вже в минулому/);
        });
    });
});

test('POST /api/bookings keeps normal event past-time guard by booking time', async () => {
    await withMockedKyivNow('2026-06-18T11:58:30.000Z', async () => {
        await withApp({}, async ({ baseUrl }) => {
            const res = await createBooking(baseUrl, {
                date: '2026-06-18',
                time: '12:15',
                lineId: 'line-1',
                room: 'Room A',
                programId: 'anim-60',
                programCode: 'AN',
                label: 'AN(60)',
                programName: 'Animation',
                category: 'animation',
                duration: 60,
                price: 1500,
                hosts: 1,
                extraData: null
            });

            assert.equal(res.status, 400, JSON.stringify(res.data));
            assert.match(res.data.error, /Час бронювання 12:15 вже в минулому/);
        });
    });
});

test('GET /api/bookings room view projects banquet service root with persisted serving time', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const roomName = '\u041f\u043e\u043d\u0456';
        state.rows.push({
            id: 'BK-2099-0200',
            business_context: 'event_genix',
            date: '2099-02-14',
            time: '15:00',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen order',
            category: 'custom',
            duration: 60,
            price: 600,
            hosts: 0,
            second_animator: null,
            pinata_filler: null,
            pinata_mode: 'none',
            pinata_number: null,
            pinata_filler_number: null,
            client_pinata_service_price: null,
            client_pinata_service_note: null,
            costume: null,
            room: roomName,
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: {
                bookingPackage: {
                    schemaVersion: 2,
                    programBasePrice: 0,
                    positionsSubtotal: 600,
                    finalTotal: 600,
                    menuPositions: [
                        { id: 'item-1', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600, servingTime: '15:30' }
                    ],
                    serviceEvents: []
                },
                bookingWorkspace: { scenario: 'kitchen_only' }
            },
            banquet_guests: 8,
            banquet_adults: null,
            banquet_tables: null,
            banquet_menu: 'Pizza',
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await fetch(`${baseUrl}/api/bookings/2099-02-14?timelineView=rooms`);
        const data = await res.json().catch(() => []);

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(res.headers.get('x-timeline-view'), 'rooms');
        assert.equal(data.length, 1);
        assert.equal(data[0].id, 'BK-2099-0200');
        assert.equal(data[0].lineId, 'banquet-service');
        assert.equal(data[0].resourceId, 'room-pony');
        assert.equal(data[0].resourceType, 'room');
        assert.equal(data[0].timelineProjection.view, 'rooms');
        assert.equal(data[0].timelineProjection.sourceLineId, 'banquet-service');
        assert.equal(data[0].extraData.bookingPackage.menuPositions[0].servingTime, '15:30');
    });
});

test('PUT /api/bookings/:id still rejects unrelated room conflict when rescheduled', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-EDIT',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '14:00',
            line_id: 'line-1',
            program_id: 'anim-60',
            program_code: 'AN',
            label: 'AN(60)',
            program_name: 'Animation',
            category: 'animation',
            duration: 60,
            price: 1500,
            hosts: 1,
            second_animator: null,
            room: 'Room B',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        }, {
            id: 'BK-2099-OTHER',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            line_id: 'line-other',
            program_id: 'quest-60',
            program_code: 'QS',
            label: 'Quest(60)',
            program_name: 'Quest',
            category: 'animation',
            duration: 60,
            price: 0,
            hosts: 1,
            second_animator: null,
            room: 'Room A',
            notes: null,
            created_by: 'other-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await updateBooking(baseUrl, 'BK-2099-EDIT', {
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
            hosts: 1,
            status: 'confirmed'
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(state.rows.find(row => row.id === 'BK-2099-EDIT').room, 'Room B');
    });
});

test('PUT /api/bookings/:id allows same-banquet activity over kitchen room slot when rescheduled', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-EDIT-ACTIVITY',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '14:00',
            line_id: 'line-1',
            program_id: 'anim-60',
            program_code: 'AN',
            label: 'AN(60)',
            program_name: 'Animation',
            category: 'animation',
            duration: 60,
            price: 1500,
            hosts: 1,
            second_animator: null,
            room: 'Room B',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: JSON.stringify({ banquetGroup: { groupId: 'BQ-UPDATE-1', role: 'activity' } }),
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        }, {
            id: 'BK-2099-UPDATE-KITCHEN',
            business_context: 'event_genix',
            date: '2099-02-10',
            time: '15:30',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen',
            category: 'kitchen',
            duration: 60,
            price: 0,
            hosts: 0,
            second_animator: null,
            room: 'Room A',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: JSON.stringify({ banquetGroup: { groupId: 'BQ-UPDATE-1', role: 'kitchen' } }),
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await updateBooking(baseUrl, 'BK-2099-EDIT-ACTIVITY', {
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
            hosts: 1,
            status: 'confirmed',
            extraData: { banquetGroup: { groupId: 'BQ-UPDATE-1', role: 'activity' } }
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        const updated = state.rows.find(row => row.id === 'BK-2099-EDIT-ACTIVITY');
        assert.equal(updated.room, 'Room A');
        assert.equal(updated.time, '15:30');
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
            banquet_adults: null,
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

test('PUT /api/bookings preserves booking package during unrelated edits', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-0300',
            business_context: 'event_genix',
            date: '2099-02-15',
            time: '16:00',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen order',
            category: 'custom',
            duration: 60,
            price: 600,
            hosts: 0,
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
            extra_data: {
                timelineIdentity: {
                    businessContext: 'event_genix',
                    resourceId: 'banquet-service',
                    lineId: 'banquet-service',
                    resourceType: 'service',
                    source: 'booking_form'
                },
                bookingPackage: {
                    schemaVersion: 2,
                    programBasePrice: 0,
                    positionsSubtotal: 600,
                    finalTotal: 600,
                    menuPositions: [
                        { id: 'item-1', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600, servingTime: '15:30' }
                    ],
                    serviceEvents: [{ id: 'service-event-1', type: 'food_service', title: 'Serve food', time: '15:30' }]
                }
            },
            customer_id: null,
            payment_method: null,
            banquet_guests: 8,
            banquet_adults: null,
            banquet_tables: null,
            banquet_menu: 'Pizza',
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await updateBooking(baseUrl, 'BK-2099-0300', {
            businessContext: 'event_genix',
            label: 'Kitchen updated',
            notes: 'unrelated edit'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        const row = state.rows.find(item => item.id === 'BK-2099-0300');
        const extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data;
        assert.equal(row.label, 'Kitchen updated');
        assert.equal(row.banquet_menu, 'Pizza');
        assert.equal(extra.timelineIdentity.resourceId, 'banquet-service');
        assert.equal(extra.bookingPackage.menuPositions[0].servingTime, '15:30');
        assert.equal(extra.bookingPackage.serviceEvents[0].time, '15:30');
    });
});

test('PUT /api/bookings allows explicit booking package clear without dropping other extra data', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-0301',
            business_context: 'event_genix',
            date: '2099-02-15',
            time: '17:00',
            line_id: 'banquet-service',
            program_id: null,
            program_code: 'KITCHEN',
            label: 'Kitchen',
            program_name: 'Kitchen order',
            category: 'custom',
            duration: 60,
            price: 600,
            hosts: 0,
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
            extra_data: {
                timelineIdentity: {
                    businessContext: 'event_genix',
                    resourceId: 'banquet-service',
                    lineId: 'banquet-service',
                    resourceType: 'service',
                    source: 'booking_form'
                },
                bookingWorkspace: { scenario: 'kitchen_only' },
                bookingPackage: {
                    schemaVersion: 2,
                    programBasePrice: 0,
                    positionsSubtotal: 600,
                    finalTotal: 600,
                    menuPositions: [
                        { id: 'item-1', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600, servingTime: '15:30' }
                    ],
                    serviceEvents: [{ id: 'service-event-1', type: 'food_service', title: 'Serve food', time: '15:30' }]
                }
            },
            customer_id: null,
            payment_method: null,
            banquet_guests: 8,
            banquet_adults: null,
            banquet_tables: null,
            banquet_menu: 'Pizza',
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await updateBooking(baseUrl, 'BK-2099-0301', {
            businessContext: 'event_genix',
            extraData: { bookingPackage: null },
            banquetMenu: null,
            banquetGuests: null,
            banquetAdults: null,
            banquetTables: null
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        const row = state.rows.find(item => item.id === 'BK-2099-0301');
        const extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data;
        assert.equal(row.banquet_menu, null);
        assert.equal(row.banquet_guests, null);
        assert.equal(extra.timelineIdentity.resourceId, 'banquet-service');
        assert.equal(extra.bookingWorkspace.scenario, 'kitchen_only');
        assert.equal(extra.bookingPackage, null);
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
        assert.deepEqual(res.data.allBookings.map(item => item.timelineProjection.lineId), ['line-main', 'line-second']);
        assert.deepEqual(res.data.allBookings.map(item => item.timelineProjection.hiddenReason), [null, null]);
        assert.deepEqual(res.data.projection.bookings.map(item => item.resourceId), ['line-main', 'line-second']);
        assert.equal(state.timelineLineResolveSelects, 2, 'main and linked rows should each resolve their timeline line once');

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

        const reload = await fetch(`${baseUrl}/api/bookings/2099-02-13?timelineView=animators&businessContext=event_genix`);
        const reloadData = await reload.json();
        assert.equal(reload.status, 200, JSON.stringify(reloadData));
        const reloadedMain = reloadData.find(item => item.id === res.data.mainBooking.id);
        const reloadedLinked = reloadData.find(item => item.id === res.data.linkedBookings[0].id);
        assert.ok(reloadedMain, 'main booking must be present after date reload');
        assert.ok(reloadedLinked, 'linked animator booking must be present after date reload');
        assert.equal(res.data.linkedBookings[0].linkedTo, res.data.mainBooking.id);
        assert.equal(res.data.linkedBookings[0].lineId, 'line-second');
        assert.equal(res.data.linkedBookings[0].timelineIdentity.lineId, 'line-second');
        assert.equal(res.data.linkedBookings[0].timelineProjection.lineId, 'line-second');
        assert.equal(res.data.linkedBookings[0].timelineProjection.hiddenReason, null);
        assert.equal(res.data.linkedBookings[0].timelineProjection.visibleInAnimatorTimeline, true);
        assert.equal(res.data.linkedBookings[0].timelineVisibility.visible, true);
        assert.equal(reloadedLinked.timelineProjection.lineId, 'line-second');
        assert.equal(reloadedLinked.timelineProjection.resourceId, 'line-second');
        assert.equal(reloadedLinked.timelineProjection.visibleInAnimatorTimeline, true);
        assert.equal(reloadedLinked.timelineProjection.hiddenReason, null);
        assert.notEqual(reloadedLinked.timelineProjection.hiddenReason, 'missing_animator_resource');
        assert.deepEqual(timelineProjectionSnapshot(res.data.mainBooking), timelineProjectionSnapshot(reloadedMain));
        assert.deepEqual(timelineProjectionSnapshot(res.data.linkedBookings[0]), timelineProjectionSnapshot(reloadedLinked));
    });
});

test('POST /api/bookings/full creates second animator linked row for additional activity', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createFullBooking(baseUrl, {
            main: {
                programId: 'anim-60',
                programCode: 'AN',
                label: 'Anim(30)',
                programName: 'Animation',
                category: 'animation',
                duration: 30,
                price: 1500,
                hosts: 1,
                secondAnimator: null
            },
            linked: [],
            banquetActivities: [
                {
                    date: '2099-02-13',
                    time: '13:30',
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
                    secondAnimatorLineId: 'line-second',
                    status: 'confirmed',
                    createdBy: 'creator-user',
                    extraData: {
                        bookingWorkspace: {
                            secondAnimatorLineId: 'line-second',
                            secondAnimatorLineName: 'Second Animator'
                        }
                    }
                },
                {
                    date: '2099-02-13',
                    time: '14:00',
                    lineId: 'line-main',
                    lineName: 'Anna',
                    room: 'Room A',
                    programId: 'quest-60',
                    programCode: 'Q',
                    label: 'Quest(30)',
                    programName: 'Quest',
                    category: 'quest',
                    duration: 30,
                    price: 0,
                    hosts: 1,
                    secondAnimator: null,
                    status: 'confirmed',
                    createdBy: 'creator-user'
                }
            ]
        }, { timelineView: 'animators' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.activityBookings.length, 2);
        assert.equal(res.data.linkedBookings.length, 1);

        const multiHostActivity = res.data.activityBookings.find(item => item.programId === 'paper-show');
        assert.ok(multiHostActivity, 'multi-host activity must be created as an activity row');
        const activitySecondAnimator = res.data.linkedBookings.find(item => item.linkedTo === multiHostActivity.id);
        assert.ok(activitySecondAnimator, 'second animator linked row must point to the multi-host activity');
        assert.equal(activitySecondAnimator.lineId, 'line-second');
        assert.equal(activitySecondAnimator.secondAnimator, 'Second Animator');
        assert.equal(activitySecondAnimator.timelineProjection.lineId, 'line-second');
        assert.equal(activitySecondAnimator.timelineVisibility.visible, true);

        const linkedRow = state.rows.find(row => row.linked_to === multiHostActivity.id);
        assert.ok(linkedRow, 'database row is linked to activity id, not to main booking');
        assert.equal(linkedRow.line_id, 'line-second');
        assert.equal(linkedRow.price, 0);
        assert.notEqual(linkedRow.linked_to, res.data.mainBooking.id);
    });
});

test('POST /api/bookings/full projects created response for requested room timeline view', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createFullBooking(baseUrl, {}, { timelineView: 'rooms' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.timelineView, 'rooms');
        assert.equal(res.data.success, true);
        assert.equal(res.data.serverVerified, true);
        assert.equal(res.data.mainBooking.id, 'BK-2099-0001');
        assert.equal(res.data.mainBooking.resourceId, 'room-a');
        assert.equal(res.data.mainBooking.resourceType, 'room');
        assert.equal(res.data.mainBooking.timelineProjection.view, 'rooms');
        assert.equal(res.data.mainBooking.timelineProjection.resourceId, 'room-a');
        assert.equal(res.data.mainBooking.timelineProjection.resourceType, 'room');
        assert.equal(res.data.mainBooking.timelineVisibility.visible, true);
        assert.deepEqual(res.data.linkedBookings, []);
        assert.deepEqual(res.data.allBookings.map(item => item.id), ['BK-2099-0001']);
        assert.deepEqual(res.data.projection.bookings.map(item => item.resourceId), ['room-a']);

        const linkedRow = state.rows.find(row => row.linked_to === res.data.mainBooking.id);
        assert.ok(linkedRow, 'linked animator row must still be inserted even when room response filters it out');

        const reload = await fetch(`${baseUrl}/api/bookings/2099-02-13?timelineView=rooms&businessContext=event_genix`);
        const reloadData = await reload.json();
        assert.equal(reload.status, 200, JSON.stringify(reloadData));
        assert.deepEqual(reloadData.map(item => item.id), [res.data.mainBooking.id]);
        assert.equal(reloadData[0].timelineProjection.view, 'rooms');
        assert.equal(reloadData[0].timelineProjection.resourceId, 'room-a');
    });
});

test('POST /api/bookings/full maps shared-room activity links relative to the activity booking', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-0999',
            business_context: 'event_genix',
            date: '2099-02-13',
            time: '10:00',
            line_id: 'line-1',
            program_id: 'quest-60',
            program_code: 'QS',
            label: 'Existing(60)',
            program_name: 'Existing activity',
            category: 'quest',
            duration: 60,
            price: 0,
            hosts: 1,
            second_animator: null,
            room: 'Shared Room',
            notes: null,
            created_by: 'creator-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createFullBooking(baseUrl, {
            main: {
                date: '2099-02-13',
                time: '13:00',
                room: 'Main Room',
                hosts: 1,
                secondAnimator: null
            },
            linked: [],
            banquetActivities: [{
                date: '2099-02-13',
                time: '16:00',
                lineId: 'line-second',
                room: 'Shared Room',
                programId: 'quest-60',
                programCode: 'QS',
                label: 'Activity(60)',
                programName: 'Activity',
                category: 'quest',
                duration: 60,
                price: 0,
                hosts: 1,
                status: 'confirmed',
                createdBy: 'creator-user'
            }]
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.activityBookings.length, 1);
        const activityId = res.data.activityBookings[0].id;
        const roomLink = res.data.sharedRoomLinks.find(link => link.relationType === 'shared_room_activity');
        assert.ok(roomLink, 'shared-room activity link should be returned');
        assert.equal(roomLink.bookingId, activityId);
        assert.equal(roomLink.targetId, 'BK-2099-0999');
        assert.notEqual(roomLink.bookingId, res.data.mainBooking.id);
    });
});

test('POST /api/bookings/full persists separate pinata fields for main and activity bookings', async () => {
    await withApp({}, async ({ baseUrl, state }) => {
        const res = await createFullBooking(baseUrl, {
            main: {
                date: '2099-02-13',
                time: '13:00',
                lineId: 'line-main',
                lineName: 'Anna',
                room: 'Room A',
                programId: 'pinata_15',
                programCode: 'ПІН',
                label: 'Пін+1M',
                programName: 'Піньята',
                category: 'pinata',
                duration: 15,
                price: 700,
                hosts: 1,
                secondAnimator: null,
                pinataMode: 'park',
                pinataNumber: '501',
                pinataFiller: '1M',
                pinataFillerNumber: '1M',
                status: 'confirmed',
                createdBy: 'creator-user'
            },
            linked: [],
            banquetActivities: [{
                date: '2099-02-13',
                time: '13:20',
                lineId: 'line-second',
                lineName: 'Second Animator',
                room: 'Room A',
                programId: 'pinata_pro_15',
                programCode: 'ПІНН',
                label: 'Пін+свій',
                programName: 'Піньята PRO',
                category: 'pinata',
                duration: 15,
                price: 1000,
                hosts: 1,
                secondAnimator: null,
                pinataMode: 'park',
                pinataNumber: '512',
                pinataFiller: null,
                pinataFillerNumber: 'client_filler',
                status: 'confirmed',
                createdBy: 'creator-user'
            }]
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.activityBookings.length, 1);

        assert.equal(res.data.mainBooking.pinataMode, 'park');
        assert.equal(res.data.mainBooking.pinataNumber, '501');
        assert.equal(res.data.mainBooking.pinataFiller, '1M');
        assert.equal(res.data.mainBooking.pinataFillerNumber, '1M');
        assert.equal(res.data.activityBookings[0].pinataMode, 'park');
        assert.equal(res.data.activityBookings[0].pinataNumber, '512');
        assert.equal(res.data.activityBookings[0].pinataFiller, null);
        assert.equal(res.data.activityBookings[0].pinataFillerNumber, 'client_filler');

        const mainRow = state.rows.find(row => row.id === res.data.mainBooking.id);
        const activityRow = state.rows.find(row => row.id === res.data.activityBookings[0].id);
        assert.equal(mainRow.pinata_number, '501');
        assert.equal(mainRow.pinata_filler, '1M');
        assert.equal(mainRow.pinata_filler_number, '1M');
        assert.equal(activityRow.pinata_number, '512');
        assert.equal(activityRow.pinata_filler, null);
        assert.equal(activityRow.pinata_filler_number, 'client_filler');
    });
});

test('POST /api/bookings/full allows same-banquet activity to overlap its own kitchen room root', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl }) => {
        const res = await createFullBooking(baseUrl, {
            main: {
                date: '2099-02-13',
                time: '12:45',
                lineId: 'banquet-service',
                lineName: 'Banquet service',
                room: 'Marvel Room',
                programId: null,
                programCode: 'KITCHEN',
                label: 'Kitchen order',
                programName: 'Kitchen',
                category: 'kitchen',
                duration: 120,
                price: 0,
                hosts: 0,
                secondAnimator: null,
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only' },
                    bookingPackage: {
                        menuPositions: [
                            { id: 'menu-1', title: 'Fruit plate', quantity: 2, servingTime: '12:45' }
                        ],
                        serviceEvents: []
                    }
                }
            },
            linked: [],
            banquetActivities: [{
                date: '2099-02-13',
                time: '12:45',
                lineId: 'line-main',
                room: 'Marvel Room',
                programId: 'quest-60',
                programCode: 'QS',
                label: 'Activity(60)',
                programName: 'Activity',
                category: 'quest',
                duration: 60,
                price: 0,
                hosts: 1,
                status: 'confirmed',
                createdBy: 'creator-user'
            }]
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.mainBooking.lineId, 'banquet-service');
        assert.equal(res.data.activityBookings.length, 1);
        assert.equal(res.data.activityBookings[0].lineId, 'line-main');
        assert.equal(res.data.activityBookings[0].room, 'Marvel Room');
    });
});

test('POST /api/bookings/full still rejects banquet activity when an unrelated room booking overlaps', async () => {
    await withApp({ stateBackedRoomConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-ROOM',
            business_context: 'event_genix',
            date: '2099-02-13',
            time: '12:45',
            line_id: 'line-other',
            program_id: 'anim-60',
            program_code: 'AN',
            label: 'Other booking',
            program_name: 'Other booking',
            category: 'animation',
            duration: 60,
            price: 0,
            hosts: 1,
            second_animator: null,
            room: 'Marvel Room',
            notes: null,
            created_by: 'other-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createFullBooking(baseUrl, {
            main: {
                date: '2099-02-13',
                time: '10:00',
                lineId: 'banquet-service',
                lineName: 'Banquet service',
                room: 'Prep Room',
                programId: null,
                programCode: 'KITCHEN',
                label: 'Kitchen order',
                programName: 'Kitchen',
                category: 'kitchen',
                duration: 30,
                price: 0,
                hosts: 0,
                secondAnimator: null,
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only' },
                    bookingPackage: { menuPositions: [], serviceEvents: [] }
                }
            },
            linked: [],
            banquetActivities: [{
                date: '2099-02-13',
                time: '12:45',
                lineId: 'line-main',
                room: 'Marvel Room',
                programId: 'quest-60',
                programCode: 'QS',
                label: 'Activity(60)',
                programName: 'Activity',
                category: 'quest',
                duration: 60,
                price: 0,
                hosts: 1,
                status: 'confirmed',
                createdBy: 'creator-user'
            }]
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.conflictBookingId, 'BK-2099-ROOM');
    });
});

test('POST /api/bookings/full still rejects banquet activity on a busy animator line', async () => {
    await withApp({ stateBackedLineConflicts: true }, async ({ baseUrl, state }) => {
        state.rows.push({
            id: 'BK-2099-LINE',
            business_context: 'event_genix',
            date: '2099-02-13',
            time: '12:45',
            line_id: 'line-main',
            program_id: 'anim-60',
            program_code: 'AN',
            label: 'Existing line booking',
            program_name: 'Existing line booking',
            category: 'animation',
            duration: 60,
            price: 0,
            hosts: 1,
            second_animator: null,
            room: 'Another Room',
            notes: null,
            created_by: 'other-user',
            linked_to: null,
            status: 'confirmed',
            kids_count: null,
            group_name: null,
            extra_data: null,
            customer_id: null,
            payment_method: null,
            created_at: '2099-01-01T00:00:00.000Z',
            updated_at: '2099-01-01T00:00:00.000Z'
        });

        const res = await createFullBooking(baseUrl, {
            main: {
                date: '2099-02-13',
                time: '10:00',
                lineId: 'banquet-service',
                lineName: 'Banquet service',
                room: 'Prep Room',
                programId: null,
                programCode: 'KITCHEN',
                label: 'Kitchen order',
                programName: 'Kitchen',
                category: 'kitchen',
                duration: 30,
                price: 0,
                hosts: 0,
                secondAnimator: null,
                extraData: {
                    bookingWorkspace: { scenario: 'kitchen_only' },
                    bookingPackage: { menuPositions: [], serviceEvents: [] }
                }
            },
            linked: [],
            banquetActivities: [{
                date: '2099-02-13',
                time: '12:45',
                lineId: 'line-main',
                room: 'Marvel Room',
                programId: 'quest-60',
                programCode: 'QS',
                label: 'Activity(60)',
                programName: 'Activity',
                category: 'quest',
                duration: 60,
                price: 0,
                hosts: 1,
                status: 'confirmed',
                createdBy: 'creator-user'
            }]
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.conflictBookingId, 'BK-2099-LINE');
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

test('banquet member booking keeps booking insert and membership insert in one rollbackable transaction', () => {
    const service = read('services', 'banquetGroups.js');
    const start = service.indexOf('async function createMemberBookingInBanquetGroup');
    const end = service.indexOf('async function createActivityBookingInBanquetGroup');
    assert.ok(start >= 0 && end > start, 'createMemberBookingInBanquetGroup service slice exists');
    const slice = service.slice(start, end);

    assert.match(slice, /await client\.query\('BEGIN'\)/);
    assert.ok(
        slice.indexOf('const memberRow = await insertRootMemberBooking') < slice.indexOf('INSERT INTO banquet_group_bookings'),
        'booking row is created before membership insert inside the same transaction'
    );
    assert.ok(
        slice.indexOf('INSERT INTO banquet_group_bookings') < slice.indexOf("await client.query('COMMIT')"),
        'membership insert happens before commit'
    );
    assert.match(slice, /await client\.query\('ROLLBACK'\)\.catch\(\(\) => \{\}\)/);
    assert.match(service, /groupName: null/);
    assert.match(service, /const ATOMIC_MEMBER_BOOKING_ROLES = new Set\(\['kitchen', 'service', 'manual'\]\)/);
    assert.match(service, /function resolveAtomicBanquetCustomerId/);
    assert.match(service, /CUSTOMER_BANQUET_MISMATCH/);
    assert.doesNotMatch(service, /normalizeShortText\(primary\.group_name/);
});

test('booking read compatibility prefers workspace comments and sanitizes recurring legacy fields', () => {
    const bookingJs = read('js', 'booking.js');
    const detailStart = bookingJs.indexOf('async function showBookingDetails');
    const detailEnd = bookingJs.indexOf('// v24.3.1: CRM');
    const detailSlice = bookingJs.slice(detailStart, detailEnd);
    const recurringStart = bookingJs.indexOf('// Form submit handler');
    const recurringEnd = bookingJs.indexOf('// ==========================================\r\n// v30.3: BULK OPERATIONS');
    const recurringSlice = bookingJs.slice(recurringStart, recurringEnd);

    assert.match(bookingJs, /function bookingWorkspaceCommentForDisplay/);
    assert.match(bookingJs, /workspaceComment\s*\|\|\s*legacyComment/);
    assert.match(detailSlice, /renderBookingCommentDetailRow\(booking/);
    assert.doesNotMatch(detailSlice, /booking\.notes \? `<div class="booking-detail-row"><span class="label">Примітки:/);
    assert.match(bookingJs, /bookingCommentValueForType\(editComments, editCommentType\) \|\| booking\.notes/);
    assert.match(bookingJs, /bookingCommentValueForType\(duplicateComments, duplicateCommentType\) \|\| booking\.notes/);
    assert.match(recurringSlice, /groupName: recurringLegacyGroupNameForBooking\(booking\)/);
    assert.match(recurringSlice, /notes: recurringLegacyNotesForBooking\(booking\)/);
    assert.match(recurringSlice, /extraData: recurringExtraDataForBooking\(booking\)/);
    assert.doesNotMatch(recurringSlice, /notes: booking\.notes \|\| null/);
    assert.match(bookingJs, /function recurringExtraDataForBooking[\s\S]*return \{ bookingWorkspace: recurringWorkspace \};/);
});

test('booking drawer source bridge cannot bypass stale context validation into normal create', () => {
    const bookingJs = read('js', 'booking.js');
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );
    const sourceContextBlock = bookingJs.slice(
        bookingJs.indexOf('function buildBookingRoomSourceContext'),
        bookingJs.indexOf('function clearAutoFilledBanquetFromRoomSelection')
    );

    assert.match(sourceContextBlock, /generationId/);
    assert.match(sourceContextBlock, /drawerGenerationId/);
    assert.match(sourceContextBlock, /function bookingRoomSourceContextStaleReason/);
    assert.match(createFlowBlock, /if \(createPath\.blocked\)[\s\S]*unlockSubmitBtn\(\);\s*return;/);
    assert.ok(
        createFlowBlock.indexOf('if (createPath.blocked)') <
            createFlowBlock.indexOf('apiCreateBanquetMemberBookingFromSource'),
        'activity-first source API stays behind stale-context guard'
    );
    assert.ok(
        createFlowBlock.indexOf('if (createPath.blocked)') <
            createFlowBlock.indexOf('apiCreateBanquetActivityBookingFromSource'),
        'kitchen-first source API stays behind stale-context guard'
    );
    assert.ok(
        createFlowBlock.indexOf('apiCreateBanquetMemberBookingFromSource') <
            createFlowBlock.indexOf('createResult = await apiCreateBooking(booking)'),
        'normal create remains only after source bridge branches'
    );
});

test('active add-to-existing create path only resolves atomic endpoints or blocked states', () => {
    const savePath = read('js', 'booking-save-path.js');
    const bookingJs = read('js', 'booking.js');
    const endpointBlock = savePath.slice(
        savePath.indexOf('function bookingCreatePathEndpoint'),
        savePath.indexOf('function buildBookingCreatePath')
    );
    const resolverBlock = savePath.slice(
        savePath.indexOf('function resolveBookingCreatePath'),
        savePath.indexOf("if (typeof window !== 'undefined')")
    );
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const createPath = resolveBookingCreatePath'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );
    const activeGuardIndex = resolverBlock.indexOf('activeBanquetIntent && !standaloneBookingOverride');
    const finalNormalFallbackIndex = resolverBlock.indexOf("return buildBookingCreatePath(normalKind || 'normal_booking'");

    assert.match(endpointBlock, /case 'existing_group_member':[\s\S]*\/api\/banquets\/\$\{encodeURIComponent\(safeGroupId\)\}\/member-booking/);
    assert.match(endpointBlock, /case 'existing_group_activity':[\s\S]*\/api\/banquets\/\$\{encodeURIComponent\(safeGroupId\)\}\/activity-booking/);
    assert.match(endpointBlock, /case 'normal_booking':[\s\S]*return '\/api\/bookings'/);
    assert.ok(activeGuardIndex >= 0, 'resolver should have active add-to-existing guard');
    assert.ok(finalNormalFallbackIndex > activeGuardIndex, 'normal create fallback should be after active guard');
    assert.match(
        resolverBlock.slice(activeGuardIndex, finalNormalFallbackIndex),
        /active_banquet_context_requires_source_booking[\s\S]*blocked: true/,
        'missing source booking should block before normal fallback'
    );
    assert.match(
        resolverBlock.slice(activeGuardIndex, finalNormalFallbackIndex),
        /active_banquet_context_member[\s\S]*existing_group_member/,
        'active kitchen/member intent should resolve to group member path'
    );
    assert.match(
        resolverBlock.slice(activeGuardIndex, finalNormalFallbackIndex),
        /active_banquet_context_activity[\s\S]*existing_group_activity/,
        'active activity intent should resolve to group activity path'
    );
    assert.match(createFlowBlock, /if \(createPath\.blocked\)[\s\S]*return;/);
    assert.match(createFlowBlock, /if \(finalCreatePath\.blocked\)[\s\S]*return;/);
    assert.ok(
        createFlowBlock.indexOf('if (finalCreatePath.blocked)') <
            createFlowBlock.indexOf('apiCreateBooking(booking)'),
        'final active-context block should run before generic apiCreateBooking'
    );
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
