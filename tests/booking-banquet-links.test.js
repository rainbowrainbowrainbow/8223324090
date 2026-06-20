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
        { code: 'banquet_date_change_deadline_days', value: 5 }
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
        if (/SELECT group_id\s+FROM banquet_group_bookings\s+WHERE booking_id = \$1/i.test(sql)) {
            const [bookingId, businessContext] = params;
            const rows = state.banquetMemberships
                .filter(item =>
                    item.booking_id === bookingId &&
                    normalizeContext(item.business_context) === normalizeContext(businessContext)
                )
                .map(item => ({ group_id: item.group_id }));
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
            const group = state.banquetGroups.find(item => item.id === params[0]);
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
            const rows = state.rows.filter(row =>
                row.date === date &&
                row.line_id === lineId &&
                normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                (!excludeId || row.id !== excludeId)
            );
            return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
        }
        if (/SELECT id, category, time, duration FROM bookings WHERE date = \$1 AND program_id = \$2/i.test(sql)) {
            const [date, programId, businessContext, excludeId] = params;
            const rows = state.rows
                .filter(row =>
                    row.date === date &&
                    row.program_id === programId &&
                    normalizeContext(row.business_context) === normalizeContext(businessContext) &&
                    String(row.status || 'confirmed').toLowerCase() !== 'cancelled' &&
                    (!excludeId || row.id !== excludeId)
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
        if (/INSERT INTO banquet_group_bookings/i.test(sql)) {
            if (options.failBanquetMembershipInsert) {
                throw new Error('simulated banquet membership insert failure');
            }
            const activityMembership = /VALUES \(\$1, \$2, \$3, 'activity', 100, \$4, \$5\)/i.test(sql);
            const row = {
                id: state.nextBanquetMembershipId++,
                group_id: params[0],
                business_context: params[1],
                booking_id: params[2],
                role: activityMembership ? 'activity' : params[3],
                sort_order: activityMembership ? 100 : params[4],
                created_by_user_id: activityMembership ? params[3] : params[5],
                created_by: activityMembership ? params[4] : params[6],
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
        if (/FROM price_rules\s+WHERE code = ANY\(\$1::text\[\]\)/i.test(sql)) {
            const requested = new Set(params[0] || []);
            return {
                rows: banquetTermsPriceRuleRows().filter(row => requested.has(row.code))
            };
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
    app.use('/api/banquets', require('../routes/banquets'));
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
                    price: 1340,
                    hosts: 0,
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
        assert.equal(created.group_name, null);
        assert.equal(created.banquet_guests, 18);
        assert.equal(created.banquet_menu, 'Pizza x 4');
        const extra = JSON.parse(created.extra_data);
        assert.equal(extra.banquetGroup.groupId, 'BQ-ROOT');
        assert.equal(extra.banquetGroup.sourceBookingId, 'BK-ROOT');
        assert.equal(extra.banquetGroup.role, 'kitchen');
        assert.equal(extra.banquetGroup.source, 'banquet_group_member_booking');
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
        assert.ok(state.banquetMemberships.some(row => row.group_id === 'BQ-ROOT' && row.booking_id === 'BK-2099-9999' && row.role === 'activity'));
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
        const activityRows = data.orderRows.filter(row => row.type === 'activity');
        assert.deepEqual(activityRows.map(row => row.bookingId), ['BK-ACTIVE']);
        assert.equal(data.totals.activitySubtotal, 700);
        assert.ok(data.warnings.some(warning => warning.code === 'banquet_member_status_mismatch'));
        assert.equal(data.event.status, 'preliminary');
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

test('banquet summary reads workspace comments and does not borrow booking group_name for existing groups', () => {
    const { buildBanquetSummary } = require('../services/banquetSummary');
    const primary = bookingRow({
        id: 'BK-SUMMARY-PRIMARY',
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
                groupName: 'canonical banquet group',
                status: 'active'
            },
            members: [
                { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary, technicalChildren: [] },
                { bookingId: kitchen.id, role: 'kitchen', isKitchenCandidate: true, booking: kitchen, technicalChildren: [] },
                { bookingId: activity.id, role: 'activity', booking: activity, technicalChildren: [] }
            ]
        }
    });

    assert.equal(summary.event.groupName, 'canonical banquet group');
    assert.equal(summary.orderRows.find(row => row.type === 'program')?.comment, 'workspace activity comment');
    assert.equal(summary.orderRows.find(row => row.type === 'menu')?.comment, 'workspace kitchen comment');
    assert.equal(summary.orderRows.find(row => row.type === 'activity')?.comment, 'workspace member activity comment');
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
