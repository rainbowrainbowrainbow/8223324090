const { reconcileScheduledAnimatorLines } = require('./booking');
const {
    saveHrShiftDayPlan,
    loadHrShiftDayPlan,
    loadPaidRoleValidationContext,
    isHrShiftPlanError,
    hrShiftPlanErrorPayload
} = require('./hrShiftSegments');
const { validateStaffScheduleableForDate } = require('./staffOperationalFilters');

const SCHEDULE_STATUS_VALUES = new Set(['working', 'remote', 'dayoff', 'vacation', 'sick']);

function normalizeScheduleStatus(status, fallback = 'working') {
    const raw = String(status ?? fallback ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'day_off') return 'dayoff';
    return SCHEDULE_STATUS_VALUES.has(raw) ? raw : null;
}

function scheduleStatusNeedsProfession(status) {
    return ['working', 'remote'].includes(normalizeScheduleStatus(status, 'working'));
}

function formatScheduleDateParts(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function scheduleDaysInMonth(year, month) {
    if (month === 2) {
        const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leapYear ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseScheduleDateParts(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > scheduleDaysInMonth(year, month)) {
        return null;
    }
    return { year, month, day };
}

function normalizeScheduleDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return formatScheduleDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    const parts = parseScheduleDateParts(value);
    return parts ? formatScheduleDateParts(parts.year, parts.month, parts.day) : null;
}

function addScheduleCalendarDays(value, offset) {
    const normalized = normalizeScheduleDate(value);
    const amount = Number(offset);
    if (!normalized || !Number.isInteger(amount)) return null;
    const parts = parseScheduleDateParts(normalized);
    let { year, month, day } = parts;
    const direction = amount < 0 ? -1 : 1;
    let remaining = Math.abs(amount);
    while (remaining > 0) {
        day += direction;
        if (direction > 0 && day > scheduleDaysInMonth(year, month)) {
            day = 1;
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        } else if (direction < 0 && day < 1) {
            month -= 1;
            if (month < 1) {
                month = 12;
                year -= 1;
            }
            if (year < 1) return null;
            day = scheduleDaysInMonth(year, month);
        }
        remaining -= 1;
    }
    return formatScheduleDateParts(year, month, day);
}

function scheduleDateSequence(value, count) {
    const normalized = normalizeScheduleDate(value);
    const length = Number(count);
    if (!normalized || !Number.isInteger(length) || length < 0) return null;
    return Array.from({ length }, (_, index) => addScheduleCalendarDays(normalized, index));
}

function validateScheduleBulkEntries(entries = []) {
    const normalizedEntries = [];
    const seen = new Set();
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return {
                ok: false,
                status: 400,
                code: 'SCHEDULE_BULK_ENTRY_INVALID',
                error: 'Кожен елемент bulk-графіка має бути об’єктом',
                details: { entryIndex: index }
            };
        }
        const staffId = Number(entry.staffId ?? entry.staff_id);
        if (!Number.isInteger(staffId) || staffId <= 0) {
            return {
                ok: false,
                status: 400,
                code: 'SCHEDULE_BULK_STAFF_ID_INVALID',
                error: 'Кожен bulk-запис повинен містити валідний staffId',
                details: { entryIndex: index }
            };
        }
        const date = normalizeScheduleDate(entry.date);
        if (!date || typeof entry.date !== 'string' || entry.date.trim() !== date) {
            return {
                ok: false,
                status: 400,
                code: 'SCHEDULE_BULK_DATE_INVALID',
                error: 'Кожен bulk-запис повинен містити валідну календарну дату YYYY-MM-DD',
                details: { entryIndex: index, date: entry.date ?? null }
            };
        }
        const status = normalizeScheduleStatus(entry.status, 'working');
        if (!status) {
            return {
                ok: false,
                status: 400,
                code: 'SCHEDULE_BULK_STATUS_INVALID',
                error: 'Bulk-запис містить невідомий статус графіка',
                details: { entryIndex: index, status: entry.status ?? null }
            };
        }
        const key = `${staffId}:${date}`;
        if (seen.has(key)) {
            return {
                ok: false,
                status: 400,
                code: 'SCHEDULE_BULK_DUPLICATE_STAFF_DATE',
                error: 'Bulk-запит містить дубль staffId/date',
                details: { entryIndex: index, staffId, date }
            };
        }
        seen.add(key);
        normalizedEntries.push({ ...entry, staffId, date, status });
    }
    return { ok: true, entries: normalizedEntries };
}

function normalizeActorMetadata(actor = null) {
    if (!actor) return { username: null, userId: null, ipAddress: null };
    if (typeof actor === 'string') return { username: actor, userId: null, ipAddress: null };
    return {
        username: actor.username || actor.user?.username || null,
        userId: actor.userId || actor.id || actor.user?.id || null,
        ipAddress: actor.ipAddress || actor.ip || null
    };
}

function scheduleTimeValue(value) {
    if (value === undefined || value === null || value === '') return null;
    const match = String(value).trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    if (hours > 23) return null;
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function validateScheduleMutationTimes(entry = {}, status = 'working') {
    if (!scheduleStatusNeedsProfession(status)) return { ok: true };
    const sourceSegments = Array.isArray(entry.segments) && entry.segments.length
        ? entry.segments
        : [entry];

    for (let index = 0; index < sourceSegments.length; index += 1) {
        const segment = sourceSegments[index] || {};
        const rawStart = firstDefined(
            segment.shiftStart, segment.shift_start, segment.plannedStart,
            segment.planned_start, segment.startTime, segment.start_time
        );
        const rawEnd = firstDefined(
            segment.shiftEnd, segment.shift_end, segment.plannedEnd,
            segment.planned_end, segment.endTime, segment.end_time
        );
        if (rawStart === undefined && rawEnd === undefined) continue;
        const shiftStart = scheduleTimeValue(rawStart);
        const shiftEnd = scheduleTimeValue(rawEnd);
        if (!shiftStart || !shiftEnd) {
            return {
                ok: false,
                status: 400,
                code: 'HR_SHIFT_SEGMENT_INVALID_TIME',
                error: 'Сегмент повинен мати коректні shiftStart та shiftEnd у форматі HH:mm',
                details: { segmentIndex: index }
            };
        }
        if (shiftStart === shiftEnd) {
            return {
                ok: false,
                status: 400,
                code: 'HR_SHIFT_SEGMENT_ZERO_LENGTH',
                error: 'Початок і завершення сегмента не можуть бути однаковими',
                details: { segmentIndex: index, shiftStart, shiftEnd }
            };
        }
    }
    return { ok: true };
}

async function validateScheduleWriteStaff(client, staffId, date, options = {}) {
    return validateStaffScheduleableForDate(client, staffId, date, {
        ...options,
        forUpdate: options.forUpdate !== false
    });
}

async function lockScheduleStaffRows(client, staffIds = []) {
    const ids = [...new Set(staffIds
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0))]
        .sort((a, b) => a - b);
    if (!ids.length) return;
    await client.query(
        `SELECT id FROM staff
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [ids]
    );
}

function normalizeScheduleAuditEntry(entry = null) {
    if (!entry) return null;
    return {
        scheduleId: entry.id || null,
        staffId: Number(entry.staff_id ?? entry.staffId) || null,
        date: normalizeScheduleDate(entry.date),
        status: normalizeScheduleStatus(entry.status, null),
        shiftStart: entry.shift_start ? String(entry.shift_start).slice(0, 5) : null,
        shiftEnd: entry.shift_end ? String(entry.shift_end).slice(0, 5) : null,
        note: entry.note || null,
        professionKey: entry.profession_key || entry.professionKey || null,
        originalStaffId: entry.original_staff_id || null,
        replacementReason: entry.replacement_reason || null
    };
}

function normalizeScheduleAuditPlan(plan = null) {
    if (!plan) return null;
    return {
        primaryProfessionKey: plan.primaryProfessionKey || null,
        segments: (plan.segments || []).map(segment => ({
            professionKey: segment.professionKey || null,
            shiftStart: segment.shiftStart || null,
            shiftEnd: segment.shiftEnd || null,
            breakMinutes: Number(segment.breakMinutes || 0),
            note: segment.note || null,
            additionalRoles: (segment.additionalRoles || []).map(role => ({
                professionKey: role.professionKey || null,
                compensationMode: role.compensationMode || 'unpaid',
                payMultiplier: role.payMultiplier ?? null,
                policyVersion: role.policyVersion || null
            })),
            additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])].sort()
        }))
    };
}

function scheduleAuditChanges(beforeEntry, afterEntry) {
    const before = beforeEntry || {};
    const after = afterEntry || {};
    const fields = ['status', 'shiftStart', 'shiftEnd', 'note', 'professionKey', 'originalStaffId', 'replacementReason'];
    return fields.reduce((changes, field) => {
        if ((before[field] ?? null) !== (after[field] ?? null)) {
            changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
        }
        return changes;
    }, {});
}

function schedulePlanAuditChanges(beforePlan, afterPlan) {
    const changes = {};
    const before = beforePlan || { primaryProfessionKey: null, segments: [] };
    const after = afterPlan || { primaryProfessionKey: null, segments: [] };
    const addChange = (key, from, to) => {
        if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    };
    addChange('primaryProfessionKey', before.primaryProfessionKey || null, after.primaryProfessionKey || null);
    addChange('segments', before.segments || [], after.segments || []);
    addChange('segmentTimes',
        (before.segments || []).map(segment => ({ shiftStart: segment.shiftStart, shiftEnd: segment.shiftEnd })),
        (after.segments || []).map(segment => ({ shiftStart: segment.shiftStart, shiftEnd: segment.shiftEnd })));
    addChange('segmentProfessions',
        (before.segments || []).map(segment => segment.professionKey || null),
        (after.segments || []).map(segment => segment.professionKey || null));
    addChange('segmentAdditionalRoles',
        (before.segments || []).map(segment => segment.additionalProfessionKeys || []),
        (after.segments || []).map(segment => segment.additionalProfessionKeys || []));
    addChange('segmentAdditionalRoleCompensation',
        (before.segments || []).map(segment => segment.additionalRoles || []),
        (after.segments || []).map(segment => segment.additionalRoles || []));
    addChange('segmentBreaks',
        (before.segments || []).map(segment => Number(segment.breakMinutes || 0)),
        (after.segments || []).map(segment => Number(segment.breakMinutes || 0)));
    return changes;
}

async function recordScheduleAudit(client, action, staffId, date, beforeEntry, afterEntry, actor, metadata = {}) {
    const before = normalizeScheduleAuditEntry(beforeEntry);
    const after = normalizeScheduleAuditEntry(afterEntry);
    const changes = scheduleAuditChanges(before, after);
    const { beforePlan: rawBeforePlan, afterPlan: rawAfterPlan, ...auditMetadata } = metadata;
    const beforePlan = normalizeScheduleAuditPlan(rawBeforePlan);
    const afterPlan = normalizeScheduleAuditPlan(rawAfterPlan);
    if (JSON.stringify(beforePlan) !== JSON.stringify(afterPlan)) {
        changes.dayPlan = { from: beforePlan, to: afterPlan };
        Object.assign(changes, schedulePlanAuditChanges(beforePlan, afterPlan));
    }
    const force = Boolean(auditMetadata.force);
    if (!force && Object.keys(changes).length === 0) return false;
    const details = {
        ...auditMetadata,
        force: undefined,
        source: auditMetadata.source || 'staff.schedule',
        date: normalizeScheduleDate(date),
        staffId: Number(staffId) || null,
        before,
        after,
        changes
    };
    const actorMetadata = normalizeActorMetadata(actor);
    await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [action, Number(staffId) || null, actorMetadata.username, JSON.stringify(details), actorMetadata.ipAddress]
    );
    return true;
}

async function recordScheduleStaleRejection(db, staffId, date, actor, details = {}) {
    const actorMetadata = normalizeActorMetadata(actor);
    const auditDetails = {
        source: details.source || 'staff.schedule',
        outcome: 'rejected',
        code: 'HR_SHIFT_PLAN_STALE',
        date: normalizeScheduleDate(date),
        staffId: Number(staffId) || null,
        hrShiftId: Number(details.hrShiftId) || null,
        expectedUpdatedAt: details.expectedUpdatedAt || null,
        currentUpdatedAt: details.currentUpdatedAt || null,
        changes: {}
    };
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [
            'staff_schedule_stale_rejected',
            Number(staffId) || null,
            actorMetadata.username,
            JSON.stringify(auditDetails),
            actorMetadata.ipAddress
        ]
    );
}

async function loadScheduleEntryForUpdate(client, staffId, date) {
    const result = await client.query(
        `SELECT *, date::text AS date
         FROM staff_schedule
         WHERE staff_id = $1 AND date = $2
         FOR UPDATE`,
        [staffId, date]
    );
    return result.rows[0] || null;
}

async function loadScheduleEntriesForUpdate(client, entries = []) {
    const unique = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const staffId = Number(entry?.staffId ?? entry?.staff_id);
        const date = normalizeScheduleDate(entry?.date);
        if (!Number.isInteger(staffId) || staffId <= 0 || !date) continue;
        unique.set(`${staffId}:${date}`, { staffId, date });
    }
    const pairs = [...unique.values()].sort((left, right) => (
        left.staffId - right.staffId || left.date.localeCompare(right.date)
    ));
    if (!pairs.length) return new Map();
    const result = await client.query(
        `SELECT ss.*, ss.date::text AS date
         FROM staff_schedule ss
         WHERE (ss.staff_id, ss.date::text) IN (
             SELECT pair.staff_id, pair.date
             FROM UNNEST($1::int[], $2::text[]) AS pair(staff_id, date)
         )
         ORDER BY ss.staff_id, ss.date, ss.id
         FOR UPDATE`,
        [pairs.map(pair => pair.staffId), pairs.map(pair => pair.date)]
    );
    return new Map(result.rows.map(row => [
        `${Number(row.staff_id)}:${normalizeScheduleDate(row.date)}`,
        row
    ]));
}

async function loadEnrichedScheduleEntry(client, scheduleId) {
    const result = await client.query(
        `SELECT ss.*, ss.date::text AS date,
                s.name, s.department, s.position, s.color, s.is_active,
                s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                hs.id AS hr_shift_id,
                hs.updated_at AS hr_shift_updated_at,
                to_char(
                    COALESCE(hs.updated_at, hs.created_at) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                ) AS hr_plan_updated_at,
                hs.original_staff_id,
                original_staff.name AS original_staff_name,
                hs.replacement_reason,
                hs.replaced_by,
                hs.replaced_at
         FROM staff_schedule ss
         JOIN staff s ON s.id = ss.staff_id
         LEFT JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
         LEFT JOIN staff original_staff ON original_staff.id = hs.original_staff_id
         WHERE ss.id = $1`,
        [scheduleId]
    );
    return result.rows[0] || null;
}

async function upsertScheduleMirrorFromPlan(client, entry, plan) {
    const staffId = Number(entry?.staffId ?? entry?.staff_id);
    const date = normalizeScheduleDate(entry?.date);
    if (!staffId || !date || !plan) return null;
    const isWorkingDay = scheduleStatusNeedsProfession(plan.status);
    const result = await client.query(
        `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (staff_id, date)
         DO UPDATE SET shift_start = EXCLUDED.shift_start,
                       shift_end = EXCLUDED.shift_end,
                       status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       profession_key = EXCLUDED.profession_key
         RETURNING *`,
        [
            staffId,
            date,
            isWorkingDay ? plan.plannedStart : null,
            isWorkingDay ? plan.plannedEnd : null,
            plan.status,
            entry?.note ?? entry?.notes ?? null,
            isWorkingDay ? plan.primaryProfessionKey : null
        ]
    );
    return result.rows[0] || null;
}

async function syncHrShiftFromScheduleEntry(client, entry, actor = null, options = {}) {
    const staffId = Number(entry?.staffId ?? entry?.staff_id);
    const date = normalizeScheduleDate(entry?.date);
    const status = normalizeScheduleStatus(entry?.status, 'working') || 'working';
    if (!staffId || !date) return null;
    const timeValidation = validateScheduleMutationTimes(entry, status);
    if (!timeValidation.ok) return timeValidation;
    if (!options.skipStaffValidation) {
        const validation = await validateScheduleWriteStaff(client, staffId, date, { forUpdate: false });
        if (!validation.ok) {
            return {
                ok: false,
                status: validation.status || 400,
                error: validation.error,
                code: validation.code,
                validation
            };
        }
    }
    try {
        const actorMetadata = normalizeActorMetadata(actor);
        const saved = await saveHrShiftDayPlan(client, {
            staffId,
            shiftDate: date,
            status,
            payload: { ...entry, status }
        }, {
            actor: actorMetadata.username,
            ipAddress: actorMetadata.ipAddress,
            auditSource: options.auditSource || 'staff_schedule',
            requireExpectedUpdatedAt: options.requireExpectedUpdatedAt === true,
            ignoreExpectedUpdatedAt: options.ignoreExpectedUpdatedAt === true,
            professionCard: options.professionCard || null,
            paidRoleValidationContext: options.paidRoleValidationContext
        });
        return { ok: true, shift: saved.shift || null, plan: saved.plan };
    } catch (error) {
        if (!isHrShiftPlanError(error)) throw error;
        const payload = hrShiftPlanErrorPayload(error);
        return {
            ok: false,
            status: error.statusCode || error.status || 400,
            code: payload.code,
            error: payload.error,
            details: payload.details
        };
    }
}

async function mutateStaffScheduleEntry(client, entry, options = {}) {
    const staffId = Number(entry?.staffId ?? entry?.staff_id);
    const date = normalizeScheduleDate(entry?.date);
    const status = normalizeScheduleStatus(entry?.status, 'working');
    if (!status) {
        return { ok: false, status: 400, code: 'SCHEDULE_STATUS_INVALID', error: 'Невідомий статус графіка' };
    }
    const validation = options.staffValidation || await validateScheduleWriteStaff(client, staffId, date, {
        forUpdate: options.forUpdate !== false
    });
    if (!validation.ok) {
        return { ok: false, status: validation.status || 400, code: validation.code, error: validation.error, validation };
    }
    const previousPlan = Object.prototype.hasOwnProperty.call(options, 'previousPlan')
        ? options.previousPlan
        : await loadHrShiftDayPlan(client, { staffId, shiftDate: date });
    const normalizedEntry = { ...entry, staffId, date, status };
    const hrSync = await syncHrShiftFromScheduleEntry(client, normalizedEntry, options.actor, {
        skipStaffValidation: true,
        requireExpectedUpdatedAt: options.requireExpectedUpdatedAt === true,
        ignoreExpectedUpdatedAt: options.ignoreExpectedUpdatedAt === true,
        professionCard: options.professionCard || null,
        paidRoleValidationContext: options.paidRoleValidationContext
    });
    if (hrSync?.ok === false) return hrSync;
    const previous = Object.prototype.hasOwnProperty.call(options, 'previousScheduleEntry')
        ? options.previousScheduleEntry
        : await loadScheduleEntryForUpdate(client, staffId, date);
    const upserted = await upsertScheduleMirrorFromPlan(client, normalizedEntry, hrSync.plan);
    const enriched = options.loadEnriched === false || !upserted?.id
        ? null
        : await loadEnrichedScheduleEntry(client, upserted.id);
    const auditEntry = options.auditWithEnriched === false ? upserted : (enriched || upserted);
    await recordScheduleAudit(
        client,
        options.auditAction || 'staff_schedule_update',
        staffId,
        date,
        previous,
        auditEntry,
        options.actor,
        {
            ...(options.sourceMetadata || {}),
            source: options.source || options.sourceMetadata?.source || 'staff.schedule',
            beforePlan: previousPlan?.plan || null,
            afterPlan: hrSync.plan
        }
    );
    return {
        ok: true,
        staffId,
        date,
        shift: hrSync.shift,
        plan: hrSync.plan,
        previous,
        entry: enriched || upserted
    };
}

async function mutateStaffScheduleBatch(client, entries = [], options = {}) {
    if (!Array.isArray(entries) || !entries.length) {
        return {
            ok: true,
            count: 0,
            staffIds: [],
            dates: [],
            changes: [],
            roster: []
        };
    }
    const orderedEntries = [...entries].sort((left, right) =>
        Number(left.staffId ?? left.staff_id) - Number(right.staffId ?? right.staff_id)
        || String(left.date || '').localeCompare(String(right.date || ''))
        || String(left.rowId || '').localeCompare(String(right.rowId || '')));
    if (options.staffRowsLocked !== true) {
        await lockScheduleStaffRows(client, orderedEntries.map(entry => entry.staffId ?? entry.staff_id));
    }
    const batchStaffIds = orderedEntries.map(entry => entry.staffId ?? entry.staff_id);
    const hasPaidAdditionalRoles = orderedEntries.some(entry =>
        (entry?.segments || []).some(segment =>
            (segment.paidAdditionalProfessionKeys || segment.paid_additional_profession_keys || []).length > 0
            ||
            (segment.additionalRoles || segment.additional_roles || [])
                .some(role => (role.compensationMode || role.compensation_mode) === 'paid_hourly')));
    const paidRoleValidationContext = options.paidRoleValidationContext
        || (hasPaidAdditionalRoles
            ? await loadPaidRoleValidationContext(client, batchStaffIds)
            : undefined);
    const changes = [];
    for (const entry of orderedEntries) {
        const entryMetadata = typeof options.sourceMetadataForEntry === 'function'
            ? options.sourceMetadataForEntry(entry)
            : {};
        const mutation = await mutateStaffScheduleEntry(client, entry, {
            actor: options.actor,
            source: options.source,
            auditAction: options.auditAction || 'staff_schedule_bulk_update',
            sourceMetadata: {
                ...(options.sourceMetadata || {}),
                ...(entryMetadata || {})
            },
            loadEnriched: options.loadEnriched === true,
            auditWithEnriched: options.auditWithEnriched === true,
            forUpdate: false,
            requireExpectedUpdatedAt: false,
            ignoreExpectedUpdatedAt: true,
            paidRoleValidationContext
        });
        if (!mutation.ok) {
            return {
                ...mutation,
                ok: false,
                failedEntry: {
                    rowId: entry.rowId || null,
                    staffId: Number(entry.staffId ?? entry.staff_id) || null,
                    date: normalizeScheduleDate(entry.date)
                },
                changes
            };
        }
        changes.push({
            rowId: entry.rowId || null,
            action: entry.action || 'update',
            staffId: mutation.staffId,
            date: mutation.date,
            status: mutation.plan?.status || normalizeScheduleStatus(entry.status, null),
            plan: mutation.plan,
            entry: mutation.entry
        });
    }
    const staffIds = [...new Set(changes.map(change => change.staffId))].sort((a, b) => a - b);
    const dates = rosterMutationDates(changes.map(change => change.date));
    const roster = options.reconcileRoster === false
        ? []
        : await reconcileAnimatorRosterDates(client, dates);
    return {
        ok: true,
        count: changes.length,
        staffIds,
        dates,
        changes,
        roster
    };
}

function rosterMutationDates(values = []) {
    return [...new Set(values.map(normalizeScheduleDate).filter(Boolean))].sort();
}

async function reconcileAnimatorRosterDates(client, values = []) {
    const dates = rosterMutationDates(values);
    const results = [];
    for (const date of dates) {
        results.push({ date, ...(await reconcileScheduledAnimatorLines(date, client)) });
    }
    return results;
}

module.exports = {
    addScheduleCalendarDays,
    loadEnrichedScheduleEntry,
    loadScheduleEntriesForUpdate,
    loadScheduleEntryForUpdate,
    lockScheduleStaffRows,
    mutateStaffScheduleBatch,
    mutateStaffScheduleEntry,
    normalizeActorMetadata,
    normalizeScheduleDate,
    normalizeScheduleStatus,
    reconcileAnimatorRosterDates,
    recordScheduleAudit,
    recordScheduleStaleRejection,
    rosterMutationDates,
    scheduleDateSequence,
    scheduleStatusNeedsProfession,
    syncHrShiftFromScheduleEntry,
    upsertScheduleMirrorFromPlan,
    validateScheduleBulkEntries,
    validateScheduleMutationTimes,
    validateScheduleWriteStaff
};
