/**
 * services/booking.js — Booking business logic: validators, time helpers, conflict checks, mappers
 */
const { pool } = require('../db');
const { normalizePinataFields, buildPinataServices } = require('./pinataMode');
const { normalizeTimelineContext, DEFAULT_TIMELINE_CONTEXT } = require('./timelineContext');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');

// --- Validators ---

function validateDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function validateTime(str) {
    if (typeof str !== 'string' || !/^\d{2}:\d{2}$/.test(str)) return false;
    const [h, m] = str.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function validateId(str) {
    return typeof str === 'string' && str.length > 0 && str.length <= 100;
}

function normalizeBanquetCreationContext(value = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const mode = String(value.mode || '').trim().toLowerCase();
    const groupId = String(value.groupId || value.group_id || '').trim() || null;
    const guestArrivalTime = String(value.guestArrivalTime || value.guest_arrival_time || '').trim() || null;
    return { mode, groupId, guestArrivalTime };
}

function validateBanquetCreationContext(value = null, options = {}) {
    const required = options.required === true;
    const expectedMode = String(options.expectedMode || '').trim().toLowerCase() || null;
    const expectedGroupId = String(options.expectedGroupId || '').trim() || null;
    const context = normalizeBanquetCreationContext(value);

    if (!context) {
        return required
            ? { valid: false, context: null, code: 'BANQUET_CONTEXT_REQUIRED', error: 'banquetContext is required' }
            : { valid: true, context: null, code: null, error: null };
    }
    if (!['new', 'existing'].includes(context.mode)) {
        return { valid: false, context, code: 'BANQUET_CONTEXT_MODE_INVALID', error: 'banquetContext.mode must be new or existing' };
    }
    if (expectedMode && context.mode !== expectedMode) {
        return { valid: false, context, code: 'BANQUET_CONTEXT_MODE_MISMATCH', error: `banquetContext.mode must be ${expectedMode}` };
    }
    if (context.mode === 'new' && !validateTime(context.guestArrivalTime)) {
        return { valid: false, context, code: 'GUEST_ARRIVAL_TIME_REQUIRED', error: 'guestArrivalTime in HH:mm format is required for a new banquet' };
    }
    if (context.mode === 'existing' && !validateId(context.groupId)) {
        return { valid: false, context, code: 'BANQUET_GROUP_ID_REQUIRED', error: 'groupId is required for an existing banquet' };
    }
    if (expectedGroupId && context.groupId !== expectedGroupId) {
        return { valid: false, context, code: 'BANQUET_GROUP_ID_MISMATCH', error: 'banquetContext.groupId does not match the target banquet group' };
    }
    return {
        valid: true,
        context: context.mode === 'existing' ? { ...context, guestArrivalTime: null } : context,
        code: null,
        error: null
    };
}

function validateSettingKey(str) {
    return typeof str === 'string' && /^[a-z_]{1,100}$/.test(str);
}

// --- Time helpers ---

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

const MIN_PAUSE = 15;
const VALID_BOOKING_STATUSES = Object.freeze(['confirmed', 'preliminary', 'cancelled']);
const BOOKING_CONFLICT_LOCK_NAMESPACE = 'booking_conflict_v1';
const BANQUET_SERVICE_LINE_ID = 'banquet-service';
const TAKEAWAY_ROOM_ID = 'room-takeaway';
const TAKEAWAY_ROOM_LABEL = 'На виніс';

const ALL_ROOMS = [
    'Марвел', 'Ніндзя', 'Майнкрафт', 'Монстер Хай', 'Ельза',
    'Растішка', 'Рок', 'Міньйон', 'Поні', 'Фудкорт', 'Жовтий стіл',
    'Диван 1', 'Диван 2', 'Диван 3', 'Диван 4'
];

function normalizeBookingStatus(value, fallback = 'confirmed') {
    if (value === undefined || value === null || value === '') return fallback;
    const status = String(value).trim().toLowerCase();
    return VALID_BOOKING_STATUSES.includes(status) ? status : null;
}

function bookingConflictLockPart(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTakeawayRoomValue(value) {
    const room = bookingConflictLockPart(value);
    return room === TAKEAWAY_ROOM_ID || room === bookingConflictLockPart(TAKEAWAY_ROOM_LABEL);
}

function isRoomConflictBlockingRoom(value) {
    const room = bookingConflictLockPart(value);
    return Boolean(room && room !== bookingConflictLockPart('Інше') && room !== 'other' && !isTakeawayRoomValue(room));
}

function isLineConflictBlockingLine(value) {
    const lineId = bookingConflictLockPart(value);
    return Boolean(lineId && lineId !== BANQUET_SERVICE_LINE_ID && lineId !== TAKEAWAY_ROOM_ID);
}

function addBookingConflictLockKeys(keys, booking = {}, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    const context = normalizeTimelineContext(booking.businessContext || booking.business_context || businessContext);
    const date = bookingConflictLockPart(booking.date);
    if (!date) return keys;

    const lineId = bookingConflictLockPart(booking.lineId || booking.line_id || booking.resourceId || booking.resource_id);
    if (isLineConflictBlockingLine(lineId)) keys.add(`line:${context}:${date}:${lineId}`);

    const room = bookingConflictLockPart(booking.room);
    if (isRoomConflictBlockingRoom(room)) keys.add(`room:${context}:${date}:${room}`);

    return keys;
}

async function lockBookingConflictResources(client, bookings, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    const keys = new Set();
    for (const booking of Array.isArray(bookings) ? bookings : [bookings]) {
        addBookingConflictLockKeys(keys, booking, businessContext);
    }

    const orderedKeys = Array.from(keys).sort();
    for (const key of orderedKeys) {
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            [BOOKING_CONFLICT_LOCK_NAMESPACE, key]
        );
    }
    return orderedKeys;
}

function activeBookingStatusSql(column = 'status') {
    return `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), 'confirmed')) != 'cancelled'`;
}

// --- Conflict checks ---

function roomConflictExcludeIds(excludeId = null) {
    const raw = [];
    if (Array.isArray(excludeId)) {
        raw.push(...excludeId);
    } else if (excludeId && typeof excludeId === 'object') {
        if (Array.isArray(excludeId.excludeIds)) raw.push(...excludeId.excludeIds);
        if (excludeId.excludeId) raw.push(excludeId.excludeId);
        if (excludeId.sourceBookingId) raw.push(excludeId.sourceBookingId);
    } else if (excludeId) {
        raw.push(excludeId);
    }
    return Array.from(new Set(raw.map(value => String(value || '').trim()).filter(Boolean)));
}

function safeBookingExtraData(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRoomConflictPolicyOptions(excludeId = null) {
    if (excludeId && typeof excludeId === 'object' && !Array.isArray(excludeId)) {
        return {
            ...excludeId,
            excludeIds: roomConflictExcludeIds(excludeId),
            allowSameBanquetOperationalOverlap: Boolean(excludeId.allowSameBanquetOperationalOverlap)
        };
    }
    return {
        excludeIds: roomConflictExcludeIds(excludeId),
        allowSameBanquetOperationalOverlap: false
    };
}

function addCleanSetValue(target, value) {
    const text = String(value || '').trim();
    if (text) target.add(text);
}

function bookingRoomConflictGroupIds(booking = {}) {
    const ids = new Set();
    addCleanSetValue(ids, booking.banquetGroupId || booking.banquet_group_id || booking.groupId || booking.group_id);
    const extra = safeBookingExtraData(booking.extraData || booking.extra_data);
    const banquetGroup = extra.banquetGroup || extra.banquet_group || {};
    addCleanSetValue(ids, banquetGroup.groupId || banquetGroup.group_id || banquetGroup.id);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    addCleanSetValue(ids, workspace.banquetGroupId || workspace.banquet_group_id);
    const workspaceGroup = workspace.banquetGroup || workspace.banquet_group || {};
    addCleanSetValue(ids, workspaceGroup.groupId || workspaceGroup.group_id || workspaceGroup.id);
    return ids;
}

function bookingPackageHasOperationalData(extra = {}) {
    const pkg = extra.bookingPackage || extra.booking_package || {};
    const positions = pkg.menuPositions || pkg.menu_positions || [];
    const serviceEvents = pkg.serviceEvents || pkg.service_events || [];
    return (Array.isArray(positions) && positions.length > 0)
        || (Array.isArray(serviceEvents) && serviceEvents.length > 0);
}

function normalizedRoomConflictRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (['activity', 'kitchen', 'service', 'manual', 'primary'].includes(role)) return role;
    return '';
}

function bookingRoomConflictRole(booking = {}, explicitRole = '') {
    const extra = safeBookingExtraData(booking.extraData || booking.extra_data);
    const banquetGroup = extra.banquetGroup || extra.banquet_group || {};
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const role = normalizedRoomConflictRole(
        explicitRole
        || booking.banquetGroupRole
        || booking.banquet_group_role
        || booking.role
        || banquetGroup.role
        || workspace.banquetRole
        || workspace.banquet_role
    );
    if (role) return role;

    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const scenario = String(workspace.scenario || booking.scenario || '').trim().toLowerCase();
    const lineId = String(booking.lineId || booking.line_id || '').trim();
    if (programCode === 'KITCHEN' || scenario === 'kitchen_only' || category === 'kitchen') return 'kitchen';
    if (lineId === BANQUET_SERVICE_LINE_ID) return 'service';
    if (category === 'banquet' && bookingPackageHasOperationalData(extra)) return 'service';
    if (['animation', 'activity', 'custom', 'quest', 'show', 'masterclass', 'workshop'].includes(category)) return 'activity';
    return 'generic';
}

function bookingRoomConflictIsActivity(role) {
    return role === 'activity';
}

function bookingRoomConflictIsOperational(role, booking = {}) {
    if (['kitchen', 'service', 'manual'].includes(role)) return true;
    if (role !== 'primary') return false;
    const extra = safeBookingExtraData(booking.extraData || booking.extra_data);
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const lineId = String(booking.lineId || booking.line_id || '').trim();
    return programCode === 'KITCHEN'
        || category === 'kitchen'
        || category === 'banquet'
        || lineId === BANQUET_SERVICE_LINE_ID
        || bookingPackageHasOperationalData(extra);
}

async function roomConflictPolicyCandidateContext(client, options, businessContext) {
    const ids = new Set();
    let role = '';
    addCleanSetValue(ids, options.banquetGroupId || options.banquet_group_id);
    for (const id of bookingRoomConflictGroupIds(options.candidateBooking || {})) ids.add(id);
    const sourceBookingId = String(options.sourceBookingId || options.source_booking_id || '').trim();
    if (sourceBookingId) {
        const result = await client.query(
            `SELECT group_id, role
             FROM banquet_group_bookings
             WHERE booking_id = $1
               AND COALESCE(business_context, 'event_genix') = $2`,
            [sourceBookingId, normalizeTimelineContext(businessContext)]
        );
        for (const row of result.rows || []) {
            addCleanSetValue(ids, row.group_id);
            if (!role) role = normalizedRoomConflictRole(row.role);
        }
    }
    return { groupIds: ids, role };
}

function parseAvailabilityWindows(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = []; }
    }
    if (!Array.isArray(source)) return [];
    return source.map(window => {
        const start = String(window?.start || window?.shiftStart || window?.planned_start || '').slice(0, 5);
        const end = String(window?.end || window?.shiftEnd || window?.planned_end || '').slice(0, 5);
        if (!validateTime(start) || !validateTime(end) || start === end) return null;
        const segmentId = Number(window?.segmentId ?? window?.segment_id);
        return {
            start,
            end,
            segmentId: Number.isFinite(segmentId) ? segmentId : null
        };
    }).filter(Boolean).sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
}

function availabilityWindowRange(window = {}) {
    const start = validateTime(window.start) ? timeToMinutes(window.start) : null;
    const endRaw = validateTime(window.end) ? timeToMinutes(window.end) : null;
    if (start === null || endRaw === null || start === endRaw) return null;
    return { start, end: endRaw <= start ? endRaw + (24 * 60) : endRaw };
}

function isBookingWithinAvailabilityWindows(time, duration, windows = []) {
    if (!validateTime(String(time || '').slice(0, 5))) return false;
    const start = timeToMinutes(String(time).slice(0, 5));
    const durationMinutes = Math.max(0, Number(duration || 0));
    return parseAvailabilityWindows(windows).some(window => {
        const range = availabilityWindowRange(window);
        if (!range) return false;
        const candidateStart = range.end > (24 * 60) && start < range.start
            ? start + (24 * 60)
            : start;
        return candidateStart >= range.start && candidateStart + durationMinutes <= range.end;
    });
}

function isMinuteWithinAvailabilityWindows(minute, windows = []) {
    const value = Number(minute);
    if (!Number.isFinite(value)) return false;
    return parseAvailabilityWindows(windows).some(window => {
        const range = availabilityWindowRange(window);
        if (!range) return false;
        if (range.end <= 24 * 60) return value >= range.start && value < range.end;
        return value >= range.start || value < (range.end - (24 * 60));
    });
}

function availabilityWindowsLabel(windows = []) {
    const normalized = parseAvailabilityWindows(windows);
    return normalized.length ? normalized.map(window => `${window.start}–${window.end}`).join(', ') : 'немає доступних вікон';
}

function roomConflictPolicyAllowsOverlap(candidate, conflict, candidateGroupIds) {
    const conflictGroupIds = bookingRoomConflictGroupIds(conflict);
    const sameGroup = Array.from(conflictGroupIds).some(id => candidateGroupIds.has(id));
    if (!sameGroup) return false;

    const candidateRole = bookingRoomConflictRole(candidate);
    const conflictRole = bookingRoomConflictRole(conflict);
    const candidateActivity = bookingRoomConflictIsActivity(candidateRole);
    const conflictActivity = bookingRoomConflictIsActivity(conflictRole);
    const candidateOperational = bookingRoomConflictIsOperational(candidateRole, candidate);
    const conflictOperational = bookingRoomConflictIsOperational(conflictRole, conflict);

    if (candidateActivity && conflictOperational) return true;
    if (candidateOperational && conflictActivity) return true;
    return false;
}

function findRoomConflictAmongCandidates(candidates = []) {
    const rows = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
        const candidate = rows[leftIndex];
        if (normalizeBookingStatus(candidate.status) === 'cancelled' || !isRoomConflictBlockingRoom(candidate.room)) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
            const conflict = rows[rightIndex];
            if (normalizeBookingStatus(conflict.status) === 'cancelled' || !isRoomConflictBlockingRoom(conflict.room)) continue;
            if (String(candidate.date || '') !== String(conflict.date || '')) continue;
            if (String(candidate.room || '') !== String(conflict.room || '')) continue;
            const candidateStart = timeToMinutes(candidate.time);
            const candidateEnd = candidateStart + (parseInt(candidate.duration, 10) || 0);
            const conflictStart = timeToMinutes(conflict.time);
            const conflictEnd = conflictStart + (parseInt(conflict.duration, 10) || 0);
            if (!(candidateStart < conflictEnd && candidateEnd > conflictStart)) continue;
            const candidateGroupIds = bookingRoomConflictGroupIds(candidate);
            const conflictGroupIds = bookingRoomConflictGroupIds(conflict);
            if (!candidateGroupIds.size || !conflictGroupIds.size) continue;
            if (roomConflictPolicyAllowsOverlap(candidate, conflict, candidateGroupIds)) continue;
            return { candidate, conflict };
        }
    }
    return null;
}

async function queryRoomConflictRows(client, date, room, context, excludeIds, includePolicyMetadata) {
    const params = [date, room, context];
    const excludeSql = excludeIds.length
        ? ` AND ${includePolicyMetadata ? 'b.' : ''}id != ALL($${params.push(excludeIds)}::text[])`
        : '';
    if (!includePolicyMetadata) {
        return client.query(
            `SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND COALESCE(business_context, 'event_genix') = $3 AND ${activeBookingStatusSql()}` +
            excludeSql,
            params
        );
    }
    return client.query(
        `SELECT b.id, b.time, b.duration, b.label, b.program_code, b.program_name, b.category, b.extra_data, b.line_id,
                bgb.group_id AS banquet_group_id, bgb.role AS banquet_group_role
         FROM bookings b
         LEFT JOIN banquet_group_bookings bgb
           ON bgb.booking_id = b.id
          AND COALESCE(bgb.business_context, 'event_genix') = $3
         WHERE b.date = $1
           AND b.room = $2
           AND COALESCE(b.business_context, 'event_genix') = $3
           AND ${activeBookingStatusSql('b.status')}` +
        excludeSql,
        params
    );
}

async function checkRoomConflictWithPolicy(client, date, room, time, duration, excludeId = null, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    if (!isRoomConflictBlockingRoom(room)) return null;
    const context = normalizeTimelineContext(businessContext);
    const options = normalizeRoomConflictPolicyOptions(excludeId);
    const excludeIds = options.excludeIds || [];
    const includePolicyMetadata = Boolean(options.allowSameBanquetOperationalOverlap);
    const result = await queryRoomConflictRows(client, date, room, context, excludeIds, includePolicyMetadata);
    const candidateContext = includePolicyMetadata
        ? await roomConflictPolicyCandidateContext(client, options, context)
        : { groupIds: new Set(), role: '' };
    const baseCandidateBooking = options.candidateBooking || {};
    const candidateBooking = candidateContext.role && bookingRoomConflictRole(baseCandidateBooking) === 'generic'
        ? { ...baseCandidateBooking, banquetGroupRole: candidateContext.role }
        : baseCandidateBooking;
    const newStart = timeToMinutes(time);
    const newEnd = newStart + (parseInt(duration, 10) || 0);
    for (const b of result.rows) {
        if (excludeIds.includes(String(b.id || '').trim())) continue;
        if (normalizeBookingStatus(b.status) === 'cancelled') continue;
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + (b.duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            if (
                includePolicyMetadata
                && roomConflictPolicyAllowsOverlap(
                    { ...candidateBooking, date, room, time, duration },
                    b,
                    candidateContext.groupIds
                )
            ) {
                continue;
            }
            return b;
        }
    }
    return null;
}

async function checkRoomConflict(client, date, room, time, duration, excludeId = null, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    return checkRoomConflictWithPolicy(client, date, room, time, duration, excludeId, businessContext);
}

async function checkServerConflicts(client, date, lineId, time, duration, excludeId = null, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    if (!isLineConflictBlockingLine(lineId)) {
        return { overlap: false, noPause: false, conflictWith: null };
    }
    const context = normalizeTimelineContext(businessContext);
    const excludeIds = [...new Set(
        (Array.isArray(excludeId) ? excludeId : [excludeId])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )];
    const params = excludeIds.length
        ? [date, lineId, context, excludeIds.length === 1 ? excludeIds[0] : excludeIds]
        : [date, lineId, context];
    const excludeSql = excludeIds.length === 1
        ? ' AND id != $4'
        : (excludeIds.length > 1 ? ' AND NOT (id = ANY($4::text[]))' : '');
    const result = await client.query(
        `SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND line_id = $2 AND COALESCE(business_context, 'event_genix') = $3 AND ${activeBookingStatusSql()}` +
        excludeSql,
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart < end && newEnd > start) {
            return { overlap: true, noPause: false, conflictWith: b };
        }
    }

    const staffId = Number(lineId);
    if (Number.isInteger(staffId) && staffId > 0 && String(staffId) === String(lineId)) {
        const availability = await client.query(
            `SELECT s.id AS staff_id,
                    ss.status,
                    (${scheduleableStaffWhere('s', { dateExpression: '$1::date' })}) AS is_scheduleable,
                    COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'start', LEFT(hss.planned_start::text, 5),
                                'end', LEFT(hss.planned_end::text, 5),
                                'segmentId', hss.id
                            ) ORDER BY hss.sort_order, hss.planned_start, hss.id
                        )
                        FROM hr_shifts hs
                        JOIN hr_shift_segments hss ON hss.hr_shift_id = hs.id
                        WHERE hs.staff_id = s.id
                          AND hs.shift_date = $1::date
                          AND (
                              hss.profession_key = 'animator'
                              OR EXISTS (
                                  SELECT 1 FROM hr_shift_segment_roles hssr
                                  WHERE hssr.segment_id = hss.id
                                    AND hssr.profession_key = 'animator'
                              )
                          )
                    ), '[]'::jsonb) AS availability_windows
             FROM staff s
             LEFT JOIN staff_schedule ss
               ON ss.staff_id = s.id
              AND ss.date = $1::date
              WHERE s.id = $2`,
            [date, staffId]
        );
        if (availability.rows.length) {
            const row = availability.rows[0];
            const windows = parseAvailabilityWindows(row.availability_windows);
            const working = row.is_scheduleable !== false
                && ['working', 'remote'].includes(String(row.status || '').toLowerCase());
            if (!working || !isBookingWithinAvailabilityWindows(time, duration, windows)) {
                const label = availabilityWindowsLabel(windows);
                return {
                    overlap: true,
                    noPause: false,
                    unavailable: true,
                    reason: working ? 'outside_availability_window' : 'staff_not_working',
                    availabilityWindows: windows,
                    conflictWith: {
                        id: null,
                        label: `Аніматор недоступний; робочі вікна: ${label}`,
                        time: null,
                        availabilityWindows: windows
                    }
                };
            }
        }
    }

    let noPause = false;
    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart === end || newEnd === start) noPause = true;
        if (newStart > end && newStart < end + MIN_PAUSE) noPause = true;
        if (newEnd > start - MIN_PAUSE && newEnd <= start) noPause = true;
    }

    return { overlap: false, noPause, conflictWith: null };
}

async function checkServerDuplicate(client, date, programId, time, duration, excludeId = null, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    if (!programId) return null;
    // v43.10.0: custom programs ("Інше") share programId but are independent — never dedupe
    if (programId === 'custom') return null;
    const context = normalizeTimelineContext(businessContext);
    const excludeIds = [...new Set(
        (Array.isArray(excludeId) ? excludeId : [excludeId])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )];
    const params = excludeIds.length
        ? [date, programId, context, excludeIds.length === 1 ? excludeIds[0] : excludeIds]
        : [date, programId, context];
    const excludeSql = excludeIds.length === 1
        ? ' AND id != $4'
        : (excludeIds.length > 1 ? ' AND NOT (id = ANY($4::text[]))' : '');
    // v19.12: Include time+duration in initial SELECT to eliminate N+1 queries
    const result = await client.query(
        `SELECT id, category, time, duration FROM bookings WHERE date = $1 AND program_id = $2 AND COALESCE(business_context, 'event_genix') = $3 AND ${activeBookingStatusSql()}` +
        excludeSql,
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        if (b.category === 'animation' || b.category === 'custom') continue;
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + (b.duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            return b;
        }
    }
    return null;
}

// --- Row mapper (snake_case → camelCase) ---

function mapBookingRow(row) {
    const pinataFields = normalizePinataFields({
        pinata_mode: row.pinata_mode,
        pinata_number: row.pinata_number,
        pinata_filler_number: row.pinata_filler_number,
        pinata_filler: row.pinata_filler,
        program_id: row.program_id,
        category: row.category,
        client_pinata_service_price: row.client_pinata_service_price,
        client_pinata_service_note: row.client_pinata_service_note
    });

    const extraData = row.extra_data ? safeBookingExtraData(row.extra_data) : null;
    const timelineIdentity = {
        ...(extraData?.timelineIdentity || extraData?.timeline_identity || {}),
        resourceId: row.resource_id
            || row.line_id
            || extraData?.timelineIdentity?.resourceId
            || extraData?.timeline_identity?.resource_id
            || extraData?.timeline_identity?.resourceId
            || null,
        resourceType: extraData?.timelineIdentity?.resourceType
            || extraData?.timeline_identity?.resource_type
            || extraData?.timeline_identity?.resourceType
            || row.resource_type
            || null,
        businessContext: extraData?.timelineIdentity?.businessContext
            || extraData?.timeline_identity?.business_context
            || extraData?.timeline_identity?.businessContext
            || row.business_context
            || DEFAULT_TIMELINE_CONTEXT,
        source: extraData?.timelineIdentity?.source
            || extraData?.timeline_identity?.source
            || 'booking_row'
    };
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        date: row.date,
        time: row.time,
        lineId: row.line_id,
        resourceId: timelineIdentity.resourceId,
        resourceType: timelineIdentity.resourceType,
        timelineIdentity,
        programId: row.program_id,
        programCode: row.program_code,
        label: row.label,
        programName: row.program_name,
        category: row.category,
        duration: row.duration,
        price: row.price,
        hosts: row.hosts,
        secondAnimator: row.second_animator,
        pinataFiller: pinataFields.pinataFiller,
        pinataMode: pinataFields.pinataMode,
        pinataNumber: pinataFields.pinataNumber,
        pinataFillerNumber: pinataFields.pinataFillerNumber,
        clientPinataServicePrice: pinataFields.clientPinataServicePrice,
        clientPinataServiceNote: pinataFields.clientPinataServiceNote,
        services: buildPinataServices(pinataFields),
        costume: row.costume,
        room: row.room,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        linkedTo: row.linked_to,
        status: row.status || 'confirmed',
        kidsCount: row.kids_count,
        updatedAt: row.updated_at,
        groupName: row.group_name || null,
        extraData,
        bookingPackage: extraData?.bookingPackage || null,
        skipNotification: row.skip_notification || false,
        customerId: row.customer_id || null,
        customerName: row.customer_name || row.customerName || null,
        paymentMethod: row.payment_method || null,
        confirmedAt: row.confirmed_at || row.confirmedAt || null,
        confirmedBy: row.confirmed_by || row.confirmedBy || null,
        confirmationNote: row.confirmation_note || row.confirmationNote || null,
        confirmationSource: row.confirmation_source || row.confirmationSource || null,
        banquetGuests: row.banquet_guests || null,
        banquetAdults: row.banquet_adults || null,
        banquetTables: row.banquet_tables || null,
        banquetMenu: row.banquet_menu || null,
        certificateId: row.certificate_id || null,
        bookingLinks: Array.isArray(row.booking_links) ? row.booking_links : (Array.isArray(row.bookingLinks) ? row.bookingLinks : []),
        banquetLinks: Array.isArray(row.banquet_links) ? row.banquet_links : (Array.isArray(row.banquetLinks) ? row.banquetLinks : [])
    };
}

// --- Timeline animator lines ---

const AUTO_LINE_COLORS = ['#10B981', '#3B82F6', '#F97316', '#06B6D4', '#84CC16', '#EC4899', '#64748B', '#8B5CF6'];

function lineColorForIndex(index, fallback) {
    if (fallback && /^#[0-9A-Fa-f]{3,8}$/.test(String(fallback))) return fallback;
    return AUTO_LINE_COLORS[index % AUTO_LINE_COLORS.length];
}

async function getScheduledAnimatorLines(date, db = pool) {
    const result = await db.query(
        `SELECT
             s.id AS staff_id,
             s.name,
             s.color,
             ss.shift_start,
             ss.shift_end,
             ss.status,
             animator_windows.availability_windows,
             COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                     'id', b.id,
                     'time', LEFT(b.time::text, 5),
                     'duration', b.duration,
                     'label', b.label
                 ) ORDER BY b.time, b.id)
                 FROM bookings b
                 WHERE b.date = ss.date
                   AND b.line_id = s.id::text
                   AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = '${DEFAULT_TIMELINE_CONTEXT}'
                   AND ${activeBookingStatusSql('b.status')}
             ), '[]'::jsonb) AS active_assignments
         FROM staff_schedule ss
         JOIN staff s ON s.id = ss.staff_id
         JOIN hr_shifts hs
           ON hs.staff_id = ss.staff_id
          AND hs.shift_date = ss.date::date
         JOIN LATERAL (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'start', LEFT(hss.planned_start::text, 5),
                 'end', LEFT(hss.planned_end::text, 5),
                 'segmentId', hss.id
             ) ORDER BY hss.sort_order, hss.planned_start, hss.id), '[]'::jsonb) AS availability_windows
             FROM hr_shift_segments hss
             WHERE hss.hr_shift_id = hs.id
               AND (
                   hss.profession_key = 'animator'
                   OR EXISTS (
                       SELECT 1 FROM hr_shift_segment_roles hssr
                       WHERE hssr.segment_id = hss.id
                         AND hssr.profession_key = 'animator'
                   )
               )
         ) animator_windows ON jsonb_array_length(animator_windows.availability_windows) > 0
         WHERE ss.date = $1
           AND ${scheduleableStaffWhere('s', { dateExpression: 'ss.date' })}
           AND ss.status IN ('working', 'remote')
         ORDER BY COALESCE(ss.shift_start, '99:99'), s.name`,
        [date]
    );

    return result.rows.map((row, index) => {
        const fallbackWindows = row.shift_start && row.shift_end
            ? [{ start: String(row.shift_start).slice(0, 5), end: String(row.shift_end).slice(0, 5), segmentId: null }]
            : [];
        const availabilityWindows = parseAvailabilityWindows(row.availability_windows).length
            ? parseAvailabilityWindows(row.availability_windows)
            : fallbackWindows;
        const assignments = Array.isArray(row.active_assignments) ? row.active_assignments : [];
        const unavailableAssignments = assignments.filter(booking => !isBookingWithinAvailabilityWindows(
            String(booking.time || '').slice(0, 5),
            booking.duration,
            availabilityWindows
        ));
        return {
            id: String(row.staff_id),
            name: row.name,
            color: lineColorForIndex(index, row.color),
            shiftStart: availabilityWindows[0]?.start || row.shift_start,
            shiftEnd: availabilityWindows.at(-1)?.end || row.shift_end,
            shiftStatus: row.status,
            availabilityWindows,
            fromSheet: true,
            source: 'hr_shift_segments',
            needsReview: unavailableAssignments.length > 0,
            unavailableAssignments,
            warning: unavailableAssignments.length
                ? `${unavailableAssignments.length} існуючих призначень поза актуальними вікнами доступності; бронювання збережені.`
                : null
        };
    });
}

async function syncScheduledAnimatorLines(date, db = pool) {
    return reconcileScheduledAnimatorLines(date, db);
}

async function reconcileScheduledAnimatorLines(date, db = pool) {
    const scheduledLines = await getScheduledAnimatorLines(date, db);

    for (const line of scheduledLines) {
        await db.query(
            `INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (business_context, date, line_id)
             DO UPDATE SET
                name = EXCLUDED.name,
                color = EXCLUDED.color,
                from_sheet = true`,
            [DEFAULT_TIMELINE_CONTEXT, date, line.id, line.name, line.color]
        );
    }

    const scheduledIds = scheduledLines.map(line => String(line.id));
    const removed = await db.query(
        `DELETE FROM lines_by_date l
         WHERE l.date = $1
           AND COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
           AND l.from_sheet IS TRUE
           AND NOT (l.line_id = ANY($3::text[]))
           AND NOT EXISTS (
                SELECT 1 FROM bookings b
                WHERE b.date = l.date
                  AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
                  AND b.line_id = l.line_id
                  AND ${activeBookingStatusSql('b.status')}
           )
           AND NOT EXISTS (
                SELECT 1 FROM afisha a
                WHERE a.date = l.date
                  AND a.line_id::text = l.line_id
           )
         RETURNING l.line_id`,
        [date, DEFAULT_TIMELINE_CONTEXT, scheduledIds]
    );

    return {
        source: 'staff_schedule',
        count: scheduledLines.length,
        removed: removed.rowCount || 0,
        removedLineIds: (removed.rows || []).map(row => String(row.line_id))
    };
}

async function getAnimatorTimelineLines(date, db = pool) {
    const scheduledLines = await getScheduledAnimatorLines(date, db);
    const persisted = await db.query(
        `SELECT l.*,
                EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.date = l.date
                      AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
                      AND b.line_id = l.line_id
                      AND ${activeBookingStatusSql('b.status')}
                ) AS has_active_booking,
                EXISTS (
                    SELECT 1 FROM afisha a
                    WHERE a.date = l.date
                      AND a.line_id::text = l.line_id
                ) AS has_active_afisha
         FROM lines_by_date l
         WHERE l.date = $1
           AND COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
         ORDER BY l.id`,
        [date, DEFAULT_TIMELINE_CONTEXT]
    );
    const scheduledIds = new Set(scheduledLines.map(line => String(line.id)));
    const lines = scheduledLines.map(line => ({
        ...line,
        resourceId: line.id,
        resourceType: 'animator',
        businessContext: DEFAULT_TIMELINE_CONTEXT,
        staffId: Number(line.id) || null,
        shiftStatus: line.shiftStatus || 'working',
        assignmentAllowed: true,
        isUnavailable: false
    }));

    for (const row of persisted.rows) {
        const lineId = String(row.line_id);
        if (scheduledIds.has(lineId)) continue;
        const generated = row.from_sheet === true;
        const hasActiveAssignment = row.has_active_booking === true || row.has_active_afisha === true;
        if (generated && !hasActiveAssignment) continue;
        lines.push({
            id: lineId,
            resourceId: lineId,
            resourceType: 'animator',
            businessContext: DEFAULT_TIMELINE_CONTEXT,
            name: row.name,
            color: row.color,
            fromSheet: generated,
            staffId: generated ? (Number(lineId) || null) : null,
            shiftStart: null,
            shiftEnd: null,
            shiftStatus: generated ? 'unavailable' : null,
            source: generated ? 'staff_schedule_orphan' : 'manual',
            assignmentAllowed: !generated,
            isUnavailable: generated,
            orphaned: generated,
            warning: generated
                ? 'Аніматор більше не доступний у графіку. Існуючі бронювання збережено, нові призначення заборонені.'
                : null
        });
    }

    if (lines.length) return lines;
    return [{
        id: `empty-roster-${date}`,
        resourceId: `empty-roster-${date}`,
        resourceType: 'animator',
        businessContext: DEFAULT_TIMELINE_CONTEXT,
        name: 'Немає аніматорів у графіку',
        color: '#94A3B8',
        fromSheet: false,
        staffId: null,
        shiftStart: null,
        shiftEnd: null,
        shiftStatus: 'empty',
        source: 'empty_roster_virtual',
        assignmentAllowed: false,
        isUnavailable: true,
        virtual: true,
        warning: 'Додайте робочу зміну аніматора в графік персоналу.'
    }];
}

async function cleanupLegacyDefaultAnimatorLines(date, db = pool) {
    return db.query(
        `DELETE FROM lines_by_date l
         WHERE l.date = $1
           AND COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
           AND l.from_sheet IS DISTINCT FROM true
           AND (
                l.line_id IN ('line1', 'line2', 'line1_' || $1, 'line2_' || $1)
                OR (
                    l.line_id ~ ('^line[0-9]{1,3}(_' || $1 || ')?$')
                    AND LOWER(TRIM(l.name)) ~ '^аніматор[[:space:]]+[0-9]+$'
                )
           )
           AND NOT EXISTS (
                SELECT 1 FROM bookings b
                WHERE b.date = l.date
                  AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
                  AND b.line_id = l.line_id
                  AND ${activeBookingStatusSql('b.status')}
            )
           AND NOT EXISTS (
                SELECT 1 FROM afisha a
                WHERE a.date = l.date
                  AND a.line_id = l.line_id
           )`,
        [date, DEFAULT_TIMELINE_CONTEXT]
    );
}

// --- Default lines ---

async function ensureDefaultLines(date, db = pool) {
    const existing = await db.query(
        "SELECT COUNT(*) FROM lines_by_date WHERE date = $1 AND COALESCE(business_context, 'event_genix') = $2",
        [date, DEFAULT_TIMELINE_CONTEXT]
    );
    const count = parseInt(existing.rows[0].count);
    // v12.6: Only create defaults when NO lines exist (count === 0)
    // Previously count < 2 caused phantom "Аніматор 1/2" to reappear after user deleted a line
    if (count === 0) {
        const defaults = [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
        for (const line of defaults) {
            await db.query(
                'INSERT INTO lines_by_date (business_context, date, line_id, name, color) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
                [DEFAULT_TIMELINE_CONTEXT, date, line.id, line.name, line.color]
            );
        }
    }
}

// --- Kyiv timezone helpers ---

function getKyivDate() {
    const now = new Date();
    const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    return kyiv;
}

function getKyivDateStr() {
    const k = getKyivDate();
    return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
}

function getKyivTimeStr() {
    const k = getKyivDate();
    return `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
    validateDate, validateTime, validateId, validateSettingKey,
    normalizeBanquetCreationContext, validateBanquetCreationContext,
    timeToMinutes, minutesToTime, MIN_PAUSE, ALL_ROOMS, VALID_BOOKING_STATUSES,
    parseAvailabilityWindows, isBookingWithinAvailabilityWindows, isMinuteWithinAvailabilityWindows, availabilityWindowsLabel,
    BANQUET_SERVICE_LINE_ID, TAKEAWAY_ROOM_ID, TAKEAWAY_ROOM_LABEL,
    normalizeBookingStatus, isTakeawayRoomValue, isRoomConflictBlockingRoom, isLineConflictBlockingLine, lockBookingConflictResources,
    checkRoomConflict, checkRoomConflictWithPolicy, checkServerConflicts, checkServerDuplicate, findRoomConflictAmongCandidates,
    mapBookingRow, ensureDefaultLines, getScheduledAnimatorLines, getAnimatorTimelineLines,
    syncScheduledAnimatorLines, reconcileScheduledAnimatorLines, cleanupLegacyDefaultAnimatorLines,
    getKyivDate, getKyivDateStr, getKyivTimeStr
};
