'use strict';

const {
    normalizeProfessionKey,
    normalizeRequestedProfessionKey,
    parseJsonArray,
    resolveStaffProfessionAssignments,
    staffProfessionKeys
} = require('./professions');

// Product guardrail: a physical HR shift may contain at most 12 paid segments.
// Raising this cap is a deliberate product decision, not a route-level override.
const MAX_HR_SHIFT_SEGMENTS_PER_DAY = 12;
const MINUTES_PER_DAY = 24 * 60;
const WORKING_DAY_STATUSES = new Set(['working', 'remote']);
const NON_WORKING_DAY_STATUSES = new Set(['dayoff', 'vacation', 'sick']);

function professionCardFromStaff(staff = null, options = {}) {
    if (!staff) return null;
    const allowedProfessionKeys = staffProfessionKeys(staff);
    if (options.requireActive !== false && staff.is_active === false) {
        return { ok: false, status: 400, error: 'Співробітник неактивний', staff, allowedProfessionKeys };
    }
    return {
        ok: true,
        staff,
        professionKeys: [],
        allowedProfessionKeys,
        invalidProfessionKeys: [],
        malformedProfessionKeys: []
    };
}

class HrShiftPlanError extends Error {
    constructor(code, message, details = {}, status = 400) {
        super(message);
        this.name = 'HrShiftPlanError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function fail(code, message, details = {}, status = 400) {
    throw new HrShiftPlanError(code, message, details, status);
}

function isHrShiftPlanError(error) {
    return error instanceof HrShiftPlanError || error?.name === 'HrShiftPlanError';
}

function hrShiftPlanErrorPayload(error, extra = {}) {
    return {
        success: false,
        code: error?.code || 'HR_SHIFT_PLAN_INVALID',
        error: error?.message || 'Некоректний денний план зміни',
        details: error?.details || undefined,
        ...extra
    };
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function firstDefined(...values) {
    return values.find(value => value !== undefined);
}

function normalizeDayStatus(value, fallback = 'working') {
    const raw = String(value ?? fallback ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'day_off') return 'dayoff';
    if (WORKING_DAY_STATUSES.has(raw) || NON_WORKING_DAY_STATUSES.has(raw)) return raw;
    return null;
}

function statusFromPayload(payload = {}, options = {}) {
    const explicitStatus = firstDefined(options.status, payload.status, payload.scheduleStatus, payload.schedule_status);
    if (explicitStatus !== undefined) return normalizeDayStatus(explicitStatus, null);
    const shiftType = String(firstDefined(options.shiftType, payload.shiftType, payload.shift_type, '') || '').trim().toLowerCase();
    return shiftType === 'remote' ? 'remote' : 'working';
}

function normalizeShiftTime(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    const match = raw.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const seconds = match[3] === undefined ? 0 : Number(match[3]);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23 || seconds !== 0) return null;
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function timeToMinutes(value) {
    const normalized = normalizeShiftTime(value);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(value) {
    const minutes = ((Number(value) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function durationAcrossMidnight(shiftStart, shiftEnd) {
    const startMinutes = timeToMinutes(shiftStart);
    const rawEndMinutes = timeToMinutes(shiftEnd);
    if (startMinutes === null || rawEndMinutes === null) return null;
    const endMinutes = rawEndMinutes <= startMinutes ? rawEndMinutes + MINUTES_PER_DAY : rawEndMinutes;
    return endMinutes - startMinutes;
}

function normalizeBreakMinutes(value, segmentIndex) {
    if (value === undefined || value === null || value === '') return 0;
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 0) {
        fail('HR_SHIFT_SEGMENT_INVALID_BREAK', 'Перерва сегмента має бути цілим невід’ємним числом хвилин', {
            segmentIndex,
            breakMinutes: value
        });
    }
    return minutes;
}

function normalizeSegmentId(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
    const raw = String(value).trim();
    return /^\d+$/.test(raw) ? raw : null;
}

function normalizeSegmentNote(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized || null;
}

function normalizeAdditionalProfessionKeys(value, professionKey, segmentIndex, options = {}) {
    const rawItems = parseJsonArray(value, null);
    if (!Array.isArray(rawItems)) {
        fail('HR_SHIFT_SEGMENT_INVALID_ADDITIONAL_PROFESSIONS', 'additionalProfessionKeys має бути масивом або коректним списком ключів професій', {
            segmentIndex
        });
    }
    const seen = new Set();
    const keys = [];
    for (const rawItem of rawItems) {
        const key = options.strictProfessionKeys === false
            ? normalizeProfessionKey(rawItem)
            : normalizeRequestedProfessionKey(rawItem);
        if (!key) {
            fail('HR_SHIFT_SEGMENT_INVALID_ADDITIONAL_PROFESSION', 'Додаткова професія сегмента має некоректний ключ', {
                segmentIndex,
                professionKey: rawItem
            });
        }
        if (key === professionKey) {
            fail('HR_SHIFT_SEGMENT_DUPLICATE_ROLE', 'Додаткова професія не може дублювати основну професію сегмента', {
                segmentIndex,
                professionKey: key
            });
        }
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys.sort((a, b) => a.localeCompare(b, 'en'));
}

function normalizeSegment(segment = {}, segmentIndex = 0, options = {}) {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
        fail('HR_SHIFT_SEGMENT_INVALID_SHAPE', 'Кожен елемент segments має бути об’єктом', {
            segmentIndex
        });
    }
    const rawProfessionKey = firstDefined(
        segment.professionKey,
        segment.profession_key,
        segment.roleType,
        segment.role_type
    );
    const professionKey = options.strictProfessionKeys === false
        ? normalizeProfessionKey(rawProfessionKey)
        : normalizeRequestedProfessionKey(rawProfessionKey);
    if (!professionKey) {
        fail('HR_SHIFT_SEGMENT_PROFESSION_REQUIRED', 'Кожен сегмент повинен мати основну професію', { segmentIndex });
    }

    const shiftStart = normalizeShiftTime(firstDefined(
        segment.shiftStart,
        segment.shift_start,
        segment.plannedStart,
        segment.planned_start,
        segment.startTime,
        segment.start_time
    ));
    const shiftEnd = normalizeShiftTime(firstDefined(
        segment.shiftEnd,
        segment.shift_end,
        segment.plannedEnd,
        segment.planned_end,
        segment.endTime,
        segment.end_time
    ));
    if (!shiftStart || !shiftEnd) {
        fail('HR_SHIFT_SEGMENT_INVALID_TIME', 'Сегмент повинен мати коректні shiftStart та shiftEnd у форматі HH:mm', {
            segmentIndex
        });
    }
    if (shiftStart === shiftEnd) {
        fail('HR_SHIFT_SEGMENT_ZERO_LENGTH', 'Початок і завершення сегмента не можуть бути однаковими', {
            segmentIndex,
            shiftStart,
            shiftEnd
        });
    }

    // Timeline convention for this MVP: every segment starts on shift_date.
    // Only an end at/before its own start moves to shift_date + 1. Representing
    // a separate continuation segment that starts after midnight needs a future
    // explicit day offset; inferring it from sort order would be ambiguous.
    const startMinutes = timeToMinutes(shiftStart);
    const rawEndMinutes = timeToMinutes(shiftEnd);
    const endMinutes = rawEndMinutes <= startMinutes ? rawEndMinutes + MINUTES_PER_DAY : rawEndMinutes;
    const durationMinutes = endMinutes - startMinutes;
    const breakMinutes = normalizeBreakMinutes(firstDefined(segment.breakMinutes, segment.break_minutes), segmentIndex);
    if (breakMinutes >= durationMinutes) {
        fail('HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION', 'Перерва має бути коротшою за тривалість сегмента', {
            segmentIndex,
            breakMinutes,
            durationMinutes
        });
    }

    const additionalProfessionKeys = normalizeAdditionalProfessionKeys(
        firstDefined(segment.additionalProfessionKeys, segment.additional_profession_keys, []),
        professionKey,
        segmentIndex,
        options
    );

    return {
        id: normalizeSegmentId(segment.id),
        professionKey,
        shiftStart,
        shiftEnd,
        breakMinutes,
        note: normalizeSegmentNote(firstDefined(segment.note, segment.notes)),
        additionalProfessionKeys,
        sortOrder: segmentIndex,
        startMinutes,
        endMinutes,
        durationMinutes,
        plannedMinutes: durationMinutes - breakMinutes,
        inputIndex: segmentIndex
    };
}

function sortSegmentsChronologically(segments = []) {
    return [...segments]
        .sort((a, b) => a.startMinutes - b.startMinutes
            || a.endMinutes - b.endMinutes
            || String(a.professionKey).localeCompare(String(b.professionKey), 'en')
            || a.inputIndex - b.inputIndex)
        .map((segment, sortOrder) => ({ ...segment, sortOrder }));
}

function findOverlappingSegments(segments = []) {
    const sorted = sortSegmentsChronologically(segments);
    if (sorted.length < 2) return null;
    let active = sorted[0];
    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        if (current.startMinutes < active.endMinutes) {
            return { first: active, second: current };
        }
        if (current.endMinutes > active.endMinutes) active = current;
    }
    return null;
}

function calculatePlannedMinutes(segments = []) {
    return segments.reduce((total, segment) => total + Number(segment.plannedMinutes || 0), 0);
}

function calculateSegmentEnvelope(segments = []) {
    if (!segments.length) return null;
    const sorted = sortSegmentsChronologically(segments);
    const startMinutes = sorted[0].startMinutes;
    const endMinutes = sorted.reduce((latest, segment) => Math.max(latest, segment.endMinutes), sorted[0].endMinutes);
    const spanMinutes = endMinutes - startMinutes;
    const occupiedMinutes = sorted.reduce((total, segment) => total + segment.durationMinutes, 0);
    return {
        shiftStart: minutesToTime(startMinutes),
        shiftEnd: minutesToTime(endMinutes),
        startMinutes,
        endMinutes,
        spanMinutes,
        gapMinutes: Math.max(0, spanMinutes - occupiedMinutes),
        breakMinutes: sorted.reduce((total, segment) => total + segment.breakMinutes, 0),
        plannedMinutes: calculatePlannedMinutes(sorted)
    };
}

function aggregateProfessionKeys(segments = [], primaryProfessionKey = '') {
    const result = [];
    const seen = new Set();
    const add = value => {
        const key = normalizeProfessionKey(value);
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    };
    add(primaryProfessionKey);
    for (const segment of segments) {
        add(segment.professionKey);
        for (const additionalKey of segment.additionalProfessionKeys || []) add(additionalKey);
    }
    return result;
}

function legacySegmentFromPayload(payload = {}, options = {}) {
    return {
        professionKey: firstDefined(
            payload.primaryProfessionKey,
            payload.primary_profession_key,
            payload.professionKey,
            payload.profession_key,
            payload.roleType,
            payload.role_type,
            options.defaultProfessionKey
        ),
        shiftStart: firstDefined(
            payload.shiftStart,
            payload.shift_start,
            payload.plannedStart,
            payload.planned_start,
            options.defaultShiftStart
        ),
        shiftEnd: firstDefined(
            payload.shiftEnd,
            payload.shift_end,
            payload.plannedEnd,
            payload.planned_end,
            options.defaultShiftEnd
        ),
        breakMinutes: firstDefined(payload.breakMinutes, payload.break_minutes, options.defaultBreakMinutes, 0),
        note: null,
        additionalProfessionKeys: []
    };
}

function normalizeHrShiftDayPlan(payload = {}, options = {}) {
    const input = payload && typeof payload === 'object' ? payload : {};
    const status = statusFromPayload(input, options);
    if (!status) {
        fail('HR_SHIFT_PLAN_INVALID_STATUS', 'Невідомий статус денного плану', {
            status: firstDefined(options.status, input.status, input.scheduleStatus, input.schedule_status)
        });
    }

    const hasSegmentsField = hasOwn(input, 'segments');
    if (NON_WORKING_DAY_STATUSES.has(status)) {
        if (hasSegmentsField && !Array.isArray(input.segments)) {
            fail('HR_SHIFT_PLAN_SEGMENTS_MUST_BE_ARRAY', 'segments має бути масивом');
        }
        if (Array.isArray(input.segments) && input.segments.length > 0) {
            fail('HR_SHIFT_PLAN_NON_WORKING_HAS_SEGMENTS', 'Для dayoff, vacation або sick сегменти повинні бути порожніми', {
                status
            });
        }
        return {
            status,
            primaryProfessionKey: null,
            segments: [],
            professionKeys: [],
            plannedStart: null,
            plannedEnd: null,
            breakMinutes: 0,
            plannedMinutes: 0,
            spanMinutes: 0,
            gapMinutes: 0,
            source: hasSegmentsField ? 'segments' : 'legacy'
        };
    }

    let rawSegments;
    let source;
    if (hasSegmentsField) {
        if (!Array.isArray(input.segments)) {
            fail('HR_SHIFT_PLAN_SEGMENTS_MUST_BE_ARRAY', 'segments має бути масивом');
        }
        rawSegments = input.segments;
        source = 'segments';
    } else {
        rawSegments = [legacySegmentFromPayload(input, options)];
        source = 'legacy';
    }

    if (rawSegments.length === 0) {
        fail('HR_SHIFT_PLAN_SEGMENTS_REQUIRED', 'Для working або remote потрібен хоча б один сегмент', { status });
    }
    if (rawSegments.length > MAX_HR_SHIFT_SEGMENTS_PER_DAY) {
        fail('HR_SHIFT_PLAN_TOO_MANY_SEGMENTS', `Максимум ${MAX_HR_SHIFT_SEGMENTS_PER_DAY} сегментів на день`, {
            count: rawSegments.length,
            maximum: MAX_HR_SHIFT_SEGMENTS_PER_DAY
        });
    }

    const professionOptions = {
        strictProfessionKeys: options.strictProfessionKeys !== false
    };
    const normalizedSegments = rawSegments.map((segment, index) =>
        normalizeSegment(segment, index, professionOptions));
    const overnightSegments = normalizedSegments.filter(segment => segment.endMinutes > MINUTES_PER_DAY);
    if (normalizedSegments.length > 1 && overnightSegments.length > 0) {
        fail(
            'HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT',
            'Нічний часовий блок без day offsets можна зберігати лише як єдиний блок дня',
            {
                policy: 'single_overnight_segment_only',
                overnightSegmentIndexes: overnightSegments.map(segment => segment.inputIndex),
                segmentCount: normalizedSegments.length
            }
        );
    }
    const segments = sortSegmentsChronologically(normalizedSegments);
    const overlap = findOverlappingSegments(segments);
    if (overlap) {
        fail('HR_SHIFT_PLAN_SEGMENTS_OVERLAP', 'Оплачувані сегменти не можуть перетинатися', {
            firstSegment: {
                index: overlap.first.inputIndex,
                shiftStart: overlap.first.shiftStart,
                shiftEnd: overlap.first.shiftEnd
            },
            secondSegment: {
                index: overlap.second.inputIndex,
                shiftStart: overlap.second.shiftStart,
                shiftEnd: overlap.second.shiftEnd
            }
        });
    }

    const rawPrimaryProfessionKey = firstDefined(
        input.primaryProfessionKey,
        input.primary_profession_key,
        input.professionKey,
        input.profession_key,
        input.roleType,
        input.role_type,
        hasSegmentsField ? undefined : options.defaultProfessionKey
    );
    const primaryProfessionKey = options.strictProfessionKeys === false
        ? normalizeProfessionKey(rawPrimaryProfessionKey)
        : normalizeRequestedProfessionKey(rawPrimaryProfessionKey);
    if (!primaryProfessionKey) {
        fail('HR_SHIFT_PLAN_PRIMARY_PROFESSION_REQUIRED', 'Потрібна primaryProfessionKey дня');
    }
    if (!segments.some(segment => segment.professionKey === primaryProfessionKey)) {
        fail('HR_SHIFT_PLAN_PRIMARY_PROFESSION_NOT_IN_SEGMENTS', 'primaryProfessionKey має бути основною професією хоча б одного сегмента', {
            primaryProfessionKey
        });
    }

    const envelope = calculateSegmentEnvelope(segments);
    if (envelope.spanMinutes >= MINUTES_PER_DAY) {
        fail('HR_SHIFT_PLAN_ENVELOPE_TOO_LONG', 'Денний envelope має бути коротшим за 24 години', {
            spanMinutes: envelope.spanMinutes
        });
    }

    const professionKeys = aggregateProfessionKeys(segments, primaryProfessionKey);
    if (options.allowedProfessionKeys !== undefined) {
        const allowedSet = new Set((options.allowedProfessionKeys || []).map(normalizeProfessionKey).filter(Boolean));
        const invalidProfessionKeys = professionKeys.filter(key => !allowedSet.has(key));
        if (invalidProfessionKeys.length) {
            fail('HR_SHIFT_PLAN_PROFESSION_NOT_ON_STAFF_CARD', 'У HR-картці працівника відсутні професії денного плану', {
                invalidProfessionKeys,
                allowedProfessionKeys: [...allowedSet]
            });
        }
    }

    return {
        status,
        primaryProfessionKey,
        segments,
        professionKeys,
        plannedStart: envelope.shiftStart,
        plannedEnd: envelope.shiftEnd,
        breakMinutes: envelope.breakMinutes,
        plannedMinutes: envelope.plannedMinutes,
        spanMinutes: envelope.spanMinutes,
        gapMinutes: envelope.gapMinutes,
        source
    };
}

async function validateHrShiftDayPlanProfessions(db, staffId, plan, options = {}) {
    const result = await resolveStaffProfessionAssignments(db, staffId, plan?.professionKeys || [], {
        ...options,
        forShare: options.forShare !== false
    });
    if (!result.ok) {
        fail('HR_SHIFT_PLAN_PROFESSION_NOT_ON_STAFF_CARD', result.error, {
            staffId: Number(staffId) || staffId,
            invalidProfessionKeys: result.invalidProfessionKeys || [],
            allowedProfessionKeys: result.allowedProfessionKeys || []
        }, result.status || 400);
    }
    return result;
}

function normalizeShiftDate(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function shiftSelector(input = {}) {
    const hrShiftId = Number(firstDefined(input.hrShiftId, input.hr_shift_id, input.shiftId, input.shift_id));
    if (Number.isInteger(hrShiftId) && hrShiftId > 0) return { hrShiftId };
    const staffId = Number(firstDefined(input.staffId, input.staff_id));
    const shiftDate = normalizeShiftDate(firstDefined(input.shiftDate, input.shift_date, input.date));
    if (!Number.isInteger(staffId) || staffId <= 0 || !shiftDate) {
        fail('HR_SHIFT_PLAN_SELECTOR_REQUIRED', 'Потрібні hrShiftId або коректні staffId і shiftDate');
    }
    return { staffId, shiftDate };
}

const HR_SHIFT_PLAN_UPDATED_AT_SQL = `to_char(
    COALESCE(updated_at, created_at) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

function hrShiftPlanUpdatedAt(shift = {}) {
    const value = shift.plan_updated_at_token ?? shift.planUpdatedAt ?? shift.plan_updated_at;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    if (shift.updated_at instanceof Date && !Number.isNaN(shift.updated_at.getTime())) {
        return shift.updated_at.toISOString();
    }
    return shift.updated_at ? String(shift.updated_at).trim() : null;
}

// Compatibility policy: version-aware single-save routes require expectedUpdatedAt
// only when replacing an existing explicit segments[] plan. Legacy payloads without
// segments remain supported; bulk/copy callers must rely on their fresh ordered locks.
function assertExpectedHrShiftPlanUpdatedAt(currentShift, input = {}, options = {}) {
    if (options.ignoreExpectedUpdatedAt === true) return;
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : input;
    const expectedValue = firstDefined(
        input.expectedUpdatedAt,
        input.expected_updated_at,
        payload.expectedUpdatedAt,
        payload.expected_updated_at
    );
    const hasExpectedValue = expectedValue !== undefined
        && expectedValue !== null
        && String(expectedValue).trim() !== '';
    if (!currentShift) {
        if (hasExpectedValue) {
            fail(
                'HR_SHIFT_PLAN_STALE',
                'План зміни вже видалено або перенесено іншим менеджером. Оновіть дані перед повторним збереженням',
                {
                    hrShiftId: Number(firstDefined(input.hrShiftId, input.hr_shift_id)) || null,
                    staffId: Number(firstDefined(input.staffId, input.staff_id)) || null,
                    shiftDate: normalizeShiftDate(firstDefined(input.shiftDate, input.shift_date, input.date)),
                    expectedUpdatedAt: String(expectedValue).trim(),
                    currentUpdatedAt: null
                },
                409
            );
        }
        return;
    }
    const currentUpdatedAt = hrShiftPlanUpdatedAt(currentShift);
    const requiresToken = options.requireExpectedUpdatedAt === true
        && Object.prototype.hasOwnProperty.call(payload || {}, 'segments');

    if (!hasExpectedValue) {
        if (requiresToken) {
            fail(
                'HR_SHIFT_PLAN_VERSION_REQUIRED',
                'План зміни потрібно оновити перед збереженням',
                {
                    hrShiftId: Number(currentShift.id),
                    staffId: Number(currentShift.staff_id),
                    shiftDate: normalizeShiftDate(currentShift.shift_date),
                    currentUpdatedAt
                },
                409
            );
        }
        return;
    }

    const expectedUpdatedAt = String(expectedValue).trim();
    if (!currentUpdatedAt || expectedUpdatedAt !== currentUpdatedAt) {
        fail(
            'HR_SHIFT_PLAN_STALE',
            'План зміни вже оновив інший менеджер. Оновіть дані перед повторним збереженням',
            {
                hrShiftId: Number(currentShift.id),
                staffId: Number(currentShift.staff_id),
                shiftDate: normalizeShiftDate(currentShift.shift_date),
                expectedUpdatedAt,
                currentUpdatedAt
            },
            409
        );
    }
}

async function loadHrShiftParent(db, selector, options = {}) {
    const lockSql = options.forUpdate ? ' FOR UPDATE' : '';
    if (selector.hrShiftId) {
        const result = await db.query(
            `SELECT *, ${HR_SHIFT_PLAN_UPDATED_AT_SQL} AS plan_updated_at_token
             FROM hr_shifts WHERE id = $1${lockSql}`,
            [selector.hrShiftId]
        );
        return result.rows[0] || null;
    }
    const result = await db.query(
        `SELECT *, ${HR_SHIFT_PLAN_UPDATED_AT_SQL} AS plan_updated_at_token
         FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2${lockSql}`,
        [selector.staffId, selector.shiftDate]
    );
    return result.rows[0] || null;
}

async function loadHrShiftSegments(db, hrShiftId) {
    const result = await db.query(
        `SELECT hss.*,
                COALESCE(
                    ARRAY_AGG(hssr.profession_key ORDER BY hssr.profession_key)
                        FILTER (WHERE hssr.profession_key IS NOT NULL),
                    ARRAY[]::varchar[]
                ) AS additional_profession_keys
         FROM hr_shift_segments hss
         LEFT JOIN hr_shift_segment_roles hssr ON hssr.segment_id = hss.id
         WHERE hss.hr_shift_id = $1
         GROUP BY hss.id
         ORDER BY hss.sort_order, hss.id`,
        [hrShiftId]
    );
    return result.rows;
}

async function loadHrShiftSnapshots(db, whereSql, params) {
    const result = await db.query(
        `SELECT to_jsonb(hs) AS shift_row,
                to_char(
                    COALESCE(hs.updated_at, hs.created_at) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                ) AS plan_updated_at_token,
                hss.id AS segment_id,
                hss.profession_key,
                hss.planned_start,
                hss.planned_end,
                hss.break_minutes,
                hss.notes,
                hss.sort_order,
                ARRAY(
                    SELECT hssr.profession_key
                    FROM hr_shift_segment_roles hssr
                    WHERE hssr.segment_id = hss.id
                    ORDER BY hssr.profession_key
                )::varchar[] AS additional_profession_keys
         FROM hr_shifts hs
         LEFT JOIN hr_shift_segments hss ON hss.hr_shift_id = hs.id
         WHERE ${whereSql}
         ORDER BY hs.id, hss.sort_order, hss.id`,
        params
    );
    const snapshotsById = new Map();
    for (const row of result.rows) {
        const shift = {
            ...row.shift_row,
            plan_updated_at_token: row.plan_updated_at_token
        };
        const shiftId = Number(shift?.id);
        if (!Number.isInteger(shiftId)) continue;
        if (!snapshotsById.has(shiftId)) snapshotsById.set(shiftId, { shift, segmentRows: [] });
        if (row.segment_id) {
            snapshotsById.get(shiftId).segmentRows.push({
                id: row.segment_id,
                profession_key: row.profession_key,
                planned_start: row.planned_start,
                planned_end: row.planned_end,
                break_minutes: row.break_minutes,
                notes: row.notes,
                sort_order: row.sort_order,
                additional_profession_keys: row.additional_profession_keys || []
            });
        }
    }
    return [...snapshotsById.values()];
}

function hydrateHrShiftSnapshot(shift, rows = []) {
    const payload = rows.length
        ? {
            primaryProfessionKey: shift.profession_key,
            segments: rows.map(segmentPayloadFromRow)
        }
        : {
            professionKey: shift.profession_key,
            shiftStart: shift.planned_start,
            shiftEnd: shift.planned_end,
            breakMinutes: shift.break_minutes
        };
    return {
        shift,
        plan: normalizeHrShiftDayPlan(payload, {
            status: planStatusFromShift(shift),
            defaultProfessionKey: shift.profession_key,
            defaultShiftStart: shift.planned_start,
            defaultShiftEnd: shift.planned_end,
            defaultBreakMinutes: shift.break_minutes,
            strictProfessionKeys: false
        })
    };
}

async function hydrateHrShiftDayPlans(db, shifts = []) {
    const parents = Array.isArray(shifts) ? shifts.filter(shift => shift?.id) : [];
    if (!parents.length) return [];
    const shiftIds = [...new Set(parents.map(shift => Number(shift.id)).filter(Number.isInteger))];
    const snapshots = await loadHrShiftSnapshots(db, 'hs.id = ANY($1::bigint[])', [shiftIds]);
    const snapshotById = new Map(snapshots.map(snapshot => [Number(snapshot.shift.id), snapshot]));
    return parents.map(originalShift => {
        const snapshot = snapshotById.get(Number(originalShift.id));
        if (!snapshot) return null;
        return hydrateHrShiftSnapshot(
            { ...originalShift, ...snapshot.shift },
            snapshot.segmentRows
        );
    }).filter(Boolean);
}

async function loadHrShiftDayPlansForStaffDates(db, entries = []) {
    const unique = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const staffId = Number(entry?.staffId ?? entry?.staff_id);
        const shiftDate = normalizeShiftDate(entry?.shiftDate ?? entry?.shift_date ?? entry?.date);
        if (!Number.isInteger(staffId) || staffId <= 0 || !shiftDate) continue;
        unique.set(`${staffId}:${shiftDate}`, { staffId, shiftDate });
    }
    const pairs = [...unique.values()].sort((left, right) => (
        left.staffId - right.staffId || left.shiftDate.localeCompare(right.shiftDate)
    ));
    if (!pairs.length) return new Map();
    const snapshots = await loadHrShiftSnapshots(
        db,
        `(hs.staff_id, hs.shift_date) IN (
            SELECT pair.staff_id, pair.shift_date
            FROM UNNEST($1::int[], $2::date[]) AS pair(staff_id, shift_date)
        )`,
        [pairs.map(pair => pair.staffId), pairs.map(pair => pair.shiftDate)]
    );
    return new Map(snapshots.map(snapshot => {
        const hydrated = hydrateHrShiftSnapshot(snapshot.shift, snapshot.segmentRows);
        return [`${Number(snapshot.shift.staff_id)}:${normalizeShiftDate(snapshot.shift.shift_date)}`, hydrated];
    }));
}

function planStatusFromShift(shift = {}) {
    return String(shift.shift_type || '').toLowerCase() === 'remote' ? 'remote' : 'working';
}

function segmentPayloadFromRow(row = {}) {
    return {
        id: row.id,
        professionKey: row.profession_key,
        shiftStart: row.planned_start,
        shiftEnd: row.planned_end,
        breakMinutes: row.break_minutes,
        note: row.notes,
        additionalProfessionKeys: row.additional_profession_keys || []
    };
}

async function loadHrShiftDayPlan(db, input = {}, options = {}) {
    const selector = shiftSelector(input);
    if (options.forUpdate === true) {
        const lockedShift = await loadHrShiftParent(db, selector, { forUpdate: true });
        if (!lockedShift) return null;
        const segmentRows = await loadHrShiftSegments(db, lockedShift.id);
        return hydrateHrShiftSnapshot(lockedShift, segmentRows);
    }
    const whereSql = selector.hrShiftId
        ? 'hs.id = $1'
        : 'hs.staff_id = $1 AND hs.shift_date = $2';
    const params = selector.hrShiftId
        ? [selector.hrShiftId]
        : [selector.staffId, selector.shiftDate];
    const snapshots = await loadHrShiftSnapshots(db, whereSql, params);
    const snapshot = snapshots[0];
    return snapshot ? hydrateHrShiftSnapshot(snapshot.shift, snapshot.segmentRows) : null;
}

function assertDbClient(client) {
    if (!client || typeof client.query !== 'function') {
        fail('HR_SHIFT_PLAN_DB_CLIENT_REQUIRED', 'Потрібен PostgreSQL client усередині відкритої транзакції', {}, 500);
    }
}

async function replaceHrShiftSegments(client, hrShiftId, plan, options = {}) {
    assertDbClient(client);
    const normalizedPlan = normalizeHrShiftDayPlan({
        primaryProfessionKey: plan?.primaryProfessionKey,
        segments: plan?.segments || []
    }, { status: plan?.status || 'working' });
    let expectedStaffId = Number(options.professionCard?.staff?.id);
    if (!Number.isInteger(expectedStaffId) || expectedStaffId <= 0) {
        const observed = await client.query('SELECT id, staff_id FROM hr_shifts WHERE id = $1', [hrShiftId]);
        if (!observed.rows.length) {
            fail('HR_SHIFT_NOT_FOUND', 'HR-зміну не знайдено', { hrShiftId }, 404);
        }
        expectedStaffId = Number(observed.rows[0].staff_id);
    }
    let professionValidation;
    if (options.professionCard?.staff) {
        const allowedProfessionKeys = options.professionCard.allowedProfessionKeys || [];
        const allowedSet = new Set(allowedProfessionKeys);
        const invalidProfessionKeys = normalizedPlan.professionKeys
            .filter(professionKey => !allowedSet.has(professionKey));
        professionValidation = {
            ok: invalidProfessionKeys.length === 0,
            invalidProfessionKeys,
            allowedProfessionKeys,
            error: invalidProfessionKeys.length
                ? 'У HR-картці працівника відсутні професії денного плану'
                : null
        };
    } else {
        professionValidation = await resolveStaffProfessionAssignments(
            client,
            expectedStaffId,
            normalizedPlan.professionKeys,
            {
                requireActive: options.requireActiveStaff !== false,
                forShare: true
            }
        );
    }
    if (!professionValidation.ok) {
        fail('HR_SHIFT_PLAN_PROFESSION_NOT_ON_STAFF_CARD', professionValidation.error, {
            staffId: expectedStaffId,
            invalidProfessionKeys: professionValidation.invalidProfessionKeys || [],
            allowedProfessionKeys: professionValidation.allowedProfessionKeys || []
        }, professionValidation.status || 400);
    }
    const locked = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [hrShiftId]);
    if (!locked.rows.length) {
        fail('HR_SHIFT_NOT_FOUND', 'HR-зміну не знайдено', { hrShiftId }, 404);
    }

    if (Number(locked.rows[0].staff_id) !== expectedStaffId) {
        fail('HR_SHIFT_PLAN_CONCURRENT_OWNER_CHANGE', 'Працівник HR-зміни змінився під час збереження; повторіть запит', {
            hrShiftId,
            expectedStaffId,
            actualStaffId: Number(locked.rows[0].staff_id)
        }, 409);
    }

    const actor = options.actor || null;
    const parent = await client.query(
        `UPDATE hr_shifts SET
            planned_start = $1,
            planned_end = $2,
            break_minutes = $3,
            profession_key = $4,
            updated_at = NOW()
         WHERE id = $5
         RETURNING *, ${HR_SHIFT_PLAN_UPDATED_AT_SQL} AS plan_updated_at_token`,
        [
            normalizedPlan.plannedStart,
            normalizedPlan.plannedEnd,
            normalizedPlan.breakMinutes,
            normalizedPlan.primaryProfessionKey,
            hrShiftId
        ]
    );

    const existingRows = await loadHrShiftSegments(client, hrShiftId);
    const existingById = new Map(existingRows.map(row => [String(row.id), row]));
    const retainedIds = new Set();
    const persistedSegments = [];
    const roleResetIds = [];
    const roleInsertPairs = [];
    for (const segment of normalizedPlan.segments) {
        const requestedId = segment.id === null || segment.id === undefined ? null : String(segment.id);
        const existing = requestedId ? existingById.get(requestedId) : null;
        if (requestedId && !existing) {
            fail('HR_SHIFT_SEGMENT_ID_NOT_ON_PARENT', 'Сегмент не належить поточній HR-зміні', {
                hrShiftId: Number(hrShiftId),
                segmentId: requestedId
            }, 409);
        }
        let segmentId;
        if (existing) {
            segmentId = existing.id;
            retainedIds.add(String(segmentId));
            const fieldsChanged = normalizeProfessionKey(existing.profession_key) !== segment.professionKey
                || normalizeShiftTime(existing.planned_start) !== segment.shiftStart
                || normalizeShiftTime(existing.planned_end) !== segment.shiftEnd
                || Number(existing.break_minutes || 0) !== segment.breakMinutes
                || normalizeSegmentNote(existing.notes) !== segment.note
                || Number(existing.sort_order || 0) !== segment.sortOrder;
            if (fieldsChanged) {
                await client.query(
                    `UPDATE hr_shift_segments SET
                        profession_key = $1,
                        planned_start = $2,
                        planned_end = $3,
                        break_minutes = $4,
                        notes = $5,
                        sort_order = $6,
                        updated_by = $7,
                        updated_at = NOW()
                     WHERE id = $8 AND hr_shift_id = $9`,
                    [
                        segment.professionKey,
                        segment.shiftStart,
                        segment.shiftEnd,
                        segment.breakMinutes,
                        segment.note,
                        segment.sortOrder,
                        actor,
                        segmentId,
                        hrShiftId
                    ]
                );
            }
            const existingRoles = [...(existing.additional_profession_keys || [])]
                .map(normalizeProfessionKey).filter(Boolean).sort();
            if (JSON.stringify(existingRoles) !== JSON.stringify(segment.additionalProfessionKeys)) {
                roleResetIds.push(segmentId);
                for (const professionKey of segment.additionalProfessionKeys) {
                    roleInsertPairs.push([segmentId, professionKey]);
                }
            }
        } else {
            const inserted = await client.query(
                `INSERT INTO hr_shift_segments (
                    hr_shift_id, profession_key, planned_start, planned_end,
                    break_minutes, notes, sort_order, created_by, updated_by
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
                 RETURNING *`,
                [
                    hrShiftId,
                    segment.professionKey,
                    segment.shiftStart,
                    segment.shiftEnd,
                    segment.breakMinutes,
                    segment.note,
                    segment.sortOrder,
                    actor
                ]
            );
            segmentId = inserted.rows[0].id;
            for (const professionKey of segment.additionalProfessionKeys) {
                roleInsertPairs.push([segmentId, professionKey]);
            }
        }
        persistedSegments.push({ ...segment, id: segmentId });
    }

    const removedIds = existingRows
        .map(row => row.id)
        .filter(id => !retainedIds.has(String(id)));
    if (removedIds.length) {
        await client.query(
            'DELETE FROM hr_shift_segments WHERE hr_shift_id = $1 AND id = ANY($2::bigint[])',
            [hrShiftId, removedIds]
        );
    }
    if (roleResetIds.length) {
        await client.query(
            'DELETE FROM hr_shift_segment_roles WHERE segment_id = ANY($1::bigint[])',
            [roleResetIds]
        );
    }
    if (roleInsertPairs.length) {
        await client.query(
            `INSERT INTO hr_shift_segment_roles (segment_id, profession_key)
             SELECT roles.segment_id, roles.profession_key
             FROM UNNEST($1::bigint[], $2::varchar[]) AS roles(segment_id, profession_key)`,
            [roleInsertPairs.map(pair => pair[0]), roleInsertPairs.map(pair => pair[1])]
        );
    }

    return {
        shift: parent.rows[0],
        plan: { ...normalizedPlan, segments: persistedSegments }
    };
}

function normalizeDayNote(payload = {}, currentShift = null, options = {}) {
    if (options.preserveReplacementNotes !== false && currentShift?.original_staff_id) {
        return currentShift.notes || null;
    }
    if (hasOwn(payload, 'notes') || hasOwn(payload, 'note')) {
        return normalizeSegmentNote(firstDefined(payload.notes, payload.note));
    }
    return currentShift?.notes || null;
}

function effectiveShiftType(status, payload = {}, currentShift = null) {
    if (status === 'remote') return 'remote';
    const requested = String(firstDefined(payload.shiftType, payload.shift_type, '') || '').trim();
    if (requested) return requested.toLowerCase() === 'remote' ? 'regular' : requested;
    return String(currentShift?.shift_type || '').toLowerCase() === 'remote'
        ? 'regular'
        : (currentShift?.shift_type || 'regular');
}

const LEGACY_TIME_FIELDS = Object.freeze([
    'shiftStart',
    'shift_start',
    'plannedStart',
    'planned_start',
    'shiftEnd',
    'shift_end',
    'plannedEnd',
    'planned_end',
    'breakMinutes',
    'break_minutes'
]);

const LEGACY_PROFESSION_FIELDS = Object.freeze([
    'primaryProfessionKey',
    'primary_profession_key',
    'professionKey',
    'profession_key',
    'roleType',
    'role_type'
]);

function hasLegacyTimeFields(payload = {}) {
    return LEGACY_TIME_FIELDS.some(field => hasOwn(payload, field));
}

function hasLegacyProfessionFields(payload = {}) {
    return LEGACY_PROFESSION_FIELDS.some(field => hasOwn(payload, field));
}

function legacyEnvelopeDiffersFromParent(payload = {}, currentShift = {}) {
    const requestedStart = firstDefined(
        payload.shiftStart,
        payload.shift_start,
        payload.plannedStart,
        payload.planned_start
    );
    const requestedEnd = firstDefined(
        payload.shiftEnd,
        payload.shift_end,
        payload.plannedEnd,
        payload.planned_end
    );
    const requestedBreak = firstDefined(payload.breakMinutes, payload.break_minutes);
    if (requestedStart !== undefined
        && normalizeShiftTime(requestedStart) !== normalizeShiftTime(currentShift.planned_start)) return true;
    if (requestedEnd !== undefined
        && normalizeShiftTime(requestedEnd) !== normalizeShiftTime(currentShift.planned_end)) return true;
    if (requestedBreak !== undefined
        && Number(requestedBreak) !== Number(currentShift.break_minutes ?? 0)) return true;
    return false;
}

async function preserveExistingSegmentsForMetadataUpdate(client, payload, currentShift, status) {
    if (!currentShift || !WORKING_DAY_STATUSES.has(status) || hasOwn(payload, 'segments')) {
        return payload;
    }

    const rows = await loadHrShiftSegments(client, currentShift.id);
    const hasNonLegacySegmentData = rows.length > 1 || rows.some(row =>
        Boolean(normalizeSegmentNote(row.notes))
        || parseJsonArray(row.additional_profession_keys, []).length > 0
    );
    if (hasNonLegacySegmentData && hasLegacyTimeFields(payload)
        && legacyEnvelopeDiffersFromParent(payload, currentShift)) {
        fail(
            'HR_SHIFT_PLAN_SEGMENTS_REQUIRED_FOR_MULTI_UPDATE',
            'Зміну з кількома сегментами можна змінювати лише через payload segments',
            { hrShiftId: currentShift.id },
            409
        );
    }
    if (!hasNonLegacySegmentData && rows.length <= 1
        && (hasLegacyTimeFields(payload) || hasLegacyProfessionFields(payload))) return payload;

    return {
        ...payload,
        primaryProfessionKey: firstDefined(
            payload.primaryProfessionKey,
            payload.primary_profession_key,
            payload.professionKey,
            payload.profession_key,
            payload.roleType,
            payload.role_type,
            currentShift.profession_key
        ),
        segments: rows.length
            ? rows.map(segmentPayloadFromRow)
            : [legacySegmentFromPayload({}, {
                defaultProfessionKey: currentShift.profession_key,
                defaultShiftStart: currentShift.planned_start,
                defaultShiftEnd: currentShift.planned_end,
                defaultBreakMinutes: currentShift.break_minutes
            })]
    };
}

async function saveHrShiftDayPlan(client, input = {}, options = {}) {
    assertDbClient(client);
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : input;
    const selector = shiftSelector(input);
    const observedShift = await loadHrShiftParent(client, selector);
    if (selector.hrShiftId && !observedShift) {
        fail('HR_SHIFT_NOT_FOUND', 'HR-зміну не знайдено', { hrShiftId: selector.hrShiftId }, 404);
    }
    const expectedStaffId = Number(
        observedShift?.staff_id
        ?? firstDefined(input.staffId, input.staff_id)
        ?? selector.staffId
    );
    const provisionalStatus = statusFromPayload(payload, {
        status: firstDefined(
            payload.status,
            payload.scheduleStatus,
            payload.schedule_status,
            input.status,
            options.status
        ),
        shiftType: firstDefined(
            payload.shiftType,
            payload.shift_type,
            input.shiftType,
            input.shift_type,
            observedShift?.shift_type
        )
    });
    if (!provisionalStatus) fail('HR_SHIFT_PLAN_INVALID_STATUS', 'Невідомий статус денного плану');
    const lockedProfessionCard = options.professionCard
        ? professionCardFromStaff(options.professionCard.staff || options.professionCard, {
            requireActive: WORKING_DAY_STATUSES.has(provisionalStatus)
                && options.requireActiveStaff !== false
        })
        : await resolveStaffProfessionAssignments(client, expectedStaffId, [], {
            requireActive: WORKING_DAY_STATUSES.has(provisionalStatus)
                && options.requireActiveStaff !== false,
            forShare: true
        });
    if (lockedProfessionCard?.staff && Number(lockedProfessionCard.staff.id) !== expectedStaffId) {
        fail('HR_SHIFT_PLAN_PROFESSION_CARD_MISMATCH', 'HR-картка не відповідає працівнику зміни', {
            expectedStaffId,
            cardStaffId: Number(lockedProfessionCard.staff.id)
        }, 409);
    }
    if (!lockedProfessionCard.ok) {
        fail('HR_SHIFT_PLAN_STAFF_INVALID', lockedProfessionCard.error, {
            staffId: expectedStaffId
        }, lockedProfessionCard.status || 400);
    }

    const currentShift = await loadHrShiftParent(client, selector, { forUpdate: true });
    if (selector.hrShiftId && !currentShift) {
        fail('HR_SHIFT_NOT_FOUND', 'HR-зміну не знайдено', { hrShiftId: selector.hrShiftId }, 404);
    }

    if (currentShift && Number(currentShift.staff_id) !== expectedStaffId) {
        fail('HR_SHIFT_PLAN_CONCURRENT_OWNER_CHANGE', 'Працівник HR-зміни змінився під час збереження; повторіть запит', {
            hrShiftId: currentShift.id,
            expectedStaffId,
            actualStaffId: Number(currentShift.staff_id)
        }, 409);
    }

    const requestedStaffIdValue = firstDefined(input.staffId, input.staff_id);
    const requestedStaffId = requestedStaffIdValue === undefined ? null : Number(requestedStaffIdValue);
    const requestedShiftDateValue = firstDefined(input.shiftDate, input.shift_date, input.date);
    const requestedShiftDate = requestedShiftDateValue === undefined ? null : normalizeShiftDate(requestedShiftDateValue);
    if (currentShift && requestedStaffIdValue !== undefined
        && (!Number.isInteger(requestedStaffId) || requestedStaffId !== Number(currentShift.staff_id))) {
        fail('HR_SHIFT_PLAN_SELECTOR_MISMATCH', 'staffId не відповідає заблокованій HR-зміні', {
            hrShiftId: currentShift.id
        });
    }
    if (currentShift && requestedShiftDateValue !== undefined
        && (!requestedShiftDate || requestedShiftDate !== normalizeShiftDate(currentShift.shift_date))) {
        fail('HR_SHIFT_PLAN_SELECTOR_MISMATCH', 'shiftDate не відповідає заблокованій HR-зміні', {
            hrShiftId: currentShift.id
        });
    }

    assertExpectedHrShiftPlanUpdatedAt(currentShift, input, options);

    const staffId = expectedStaffId;
    const shiftDate = normalizeShiftDate(currentShift?.shift_date ?? requestedShiftDate ?? selector.shiftDate);
    const status = statusFromPayload(payload, {
        status: firstDefined(
            payload.status,
            payload.scheduleStatus,
            payload.schedule_status,
            input.status,
            options.status
        ),
        shiftType: firstDefined(
            payload.shiftType,
            payload.shift_type,
            input.shiftType,
            input.shift_type,
            currentShift?.shift_type
        )
    });
    if (!status) fail('HR_SHIFT_PLAN_INVALID_STATUS', 'Невідомий статус денного плану');

    let professionCard = lockedProfessionCard;
    if (WORKING_DAY_STATUSES.has(status) && !professionCard) {
        professionCard = await resolveStaffProfessionAssignments(client, staffId, [], {
            requireActive: options.requireActiveStaff !== false,
            forShare: true
        });
        if (!professionCard.ok) {
            fail('HR_SHIFT_PLAN_STAFF_INVALID', professionCard.error, { staffId }, professionCard.status || 400);
        }
    }

    const planPayload = await preserveExistingSegmentsForMetadataUpdate(
        client,
        payload,
        currentShift,
        status
    );
    const plan = normalizeHrShiftDayPlan(planPayload, {
        status,
        defaultProfessionKey: currentShift?.profession_key || professionCard?.allowedProfessionKeys?.[0] || null,
        defaultShiftStart: currentShift?.planned_start || null,
        defaultShiftEnd: currentShift?.planned_end || null,
        defaultBreakMinutes: currentShift?.break_minutes ?? 0,
        allowedProfessionKeys: professionCard?.allowedProfessionKeys
    });

    if (NON_WORKING_DAY_STATUSES.has(plan.status)) {
        if (currentShift) {
            await client.query('DELETE FROM hr_shifts WHERE id = $1', [currentShift.id]);
        }
        return { shift: null, plan, deletedShift: currentShift || null };
    }

    const actor = firstDefined(options.actor, input.actor, null);
    const dayNote = normalizeDayNote(planPayload, currentShift, options);
    const shiftType = effectiveShiftType(plan.status, planPayload, currentShift);
    let parent;
    if (currentShift) {
        const updated = await client.query(
            `UPDATE hr_shifts SET
                shift_type = $1,
                notes = $2,
                updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [shiftType, dayNote, currentShift.id]
        );
        parent = updated.rows[0];
    } else {
        const inserted = await client.query(
            `INSERT INTO hr_shifts (
                staff_id, shift_date, planned_start, planned_end, shift_type,
                break_minutes, notes, created_by, profession_key
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                planned_start = EXCLUDED.planned_start,
                planned_end = EXCLUDED.planned_end,
                shift_type = EXCLUDED.shift_type,
                break_minutes = EXCLUDED.break_minutes,
                notes = CASE
                    WHEN hr_shifts.original_staff_id IS NULL THEN EXCLUDED.notes
                    ELSE hr_shifts.notes
                END,
                profession_key = EXCLUDED.profession_key,
                updated_at = NOW()
             RETURNING *`,
            [
                staffId,
                shiftDate,
                plan.plannedStart,
                plan.plannedEnd,
                shiftType,
                plan.breakMinutes,
                dayNote,
                actor,
                plan.primaryProfessionKey
            ]
        );
        parent = inserted.rows[0];
    }

    return replaceHrShiftSegments(client, parent.id, plan, {
        actor,
        requireActiveStaff: options.requireActiveStaff,
        professionCard
    });
}

module.exports = {
    HrShiftPlanError,
    MAX_HR_SHIFT_SEGMENTS_PER_DAY,
    WORKING_DAY_STATUSES,
    NON_WORKING_DAY_STATUSES,
    aggregateProfessionKeys,
    calculatePlannedMinutes,
    calculateSegmentEnvelope,
    durationAcrossMidnight,
    findOverlappingSegments,
    hrShiftPlanErrorPayload,
    hrShiftPlanUpdatedAt,
    hydrateHrShiftDayPlans,
    isHrShiftPlanError,
    loadHrShiftDayPlan,
    loadHrShiftDayPlansForStaffDates,
    normalizeDayStatus,
    normalizeHrShiftDayPlan,
    normalizeShiftTime,
    professionCardFromStaff,
    replaceHrShiftSegments,
    saveHrShiftDayPlan,
    sortSegmentsChronologically,
    timeToMinutes,
    validateHrShiftDayPlanProfessions
};
