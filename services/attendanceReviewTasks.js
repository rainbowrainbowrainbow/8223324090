'use strict';

const { pool: defaultPool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { createLogger } = require('../utils/logger');

const ATTENDANCE_REVIEW_SOURCE_TYPE = 'attendance_daily_review';
const ATTENDANCE_REVIEW_CUTOFF_MINUTES = (8 * 60) + 30;
const ATTENDANCE_REVIEW_ROLES = Object.freeze(['director', 'art_director']);
const ART_DIRECTOR_DEPARTMENTS = new Set(['animators', 'creative']);
const KYIV_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});

const log = createLogger('AttendanceReviewTasks');

function kyivDateTimeParts(now = new Date()) {
    const parts = Object.fromEntries(
        KYIV_DATE_TIME_FORMATTER
            .formatToParts(now)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
        minute: Number(parts.minute)
    };
}

function previousDate(date) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}

function attendanceReviewWindow(now = new Date()) {
    const current = kyivDateTimeParts(now);
    const currentMinutes = (current.hour * 60) + current.minute;
    if (currentMinutes < ATTENDANCE_REVIEW_CUTOFF_MINUTES) return null;
    return {
        taskDate: current.date,
        reportDate: previousDate(current.date)
    };
}

function normalizeRoles(user = {}) {
    const roles = [user.role, ...(Array.isArray(user.extra_roles) ? user.extra_roles : [])];
    return new Set(roles.map(role => String(role || '').trim().toLowerCase()).filter(Boolean));
}

function attendanceReviewRecipients(rows = []) {
    const recipients = [];
    const seen = new Set();
    for (const user of rows) {
        const userId = Number(user.id);
        if (!Number.isInteger(userId) || userId <= 0 || user.is_active === false || seen.has(userId)) continue;
        const roles = normalizeRoles(user);
        const scope = roles.has('director')
            ? 'company'
            : (roles.has('art_director') ? 'creative' : null);
        if (!scope) continue;
        seen.add(userId);
        recipients.push({
            id: userId,
            label: String(user.name || user.username || `User #${userId}`).trim(),
            scope
        });
    }
    return recipients;
}

function normalizeArrival(row, source) {
    const staffId = Number(row.staff_id);
    const name = String(row.staff_name || '').trim();
    const time = String(row.arrival_time || '').slice(0, 5);
    if (!Number.isInteger(staffId) || staffId <= 0 || !name || !/^\d{2}:\d{2}$/.test(time)) return null;
    return {
        staffId,
        name,
        department: String(row.department || '').trim().toLowerCase(),
        time,
        source
    };
}

function mergeAttendanceArrivals(canonicalRows = [], fallbackRows = []) {
    const byStaff = new Map();
    const canonicalStaffIds = new Set();
    for (const row of canonicalRows) {
        const arrival = normalizeArrival(row, 'hr_time_records');
        if (!arrival) continue;
        canonicalStaffIds.add(arrival.staffId);
        const existing = byStaff.get(arrival.staffId);
        if (!existing || arrival.time < existing.time) byStaff.set(arrival.staffId, arrival);
    }
    for (const row of fallbackRows) {
        const arrival = normalizeArrival(row, 'staff_checkins');
        if (!arrival || canonicalStaffIds.has(arrival.staffId)) continue;
        const existing = byStaff.get(arrival.staffId);
        if (!existing || arrival.time < existing.time) byStaff.set(arrival.staffId, arrival);
    }
    return [...byStaff.values()].sort((left, right) => (
        left.time.localeCompare(right.time)
        || left.name.localeCompare(right.name, 'uk')
        || left.staffId - right.staffId
    ));
}

function formatReportDate(date) {
    const [year, month, day] = String(date).split('-');
    return `${day}.${month}.${year}`;
}

function formatAttendanceReviewDescription(arrivals = []) {
    if (!arrivals.length) return 'Приходів не зафіксовано';
    return arrivals.map(arrival => `${arrival.time} — ${arrival.name}`).join('\n');
}

async function loadAttendanceReviewRecipients(db) {
    const result = await db.query(
        `SELECT id, username, name, role, extra_roles, is_active
         FROM users
         WHERE COALESCE(is_active, true) = true
           AND (
                LOWER(COALESCE(role, '')) = ANY($1::text[])
                OR EXISTS (
                    SELECT 1
                    FROM unnest(COALESCE(extra_roles, ARRAY[]::text[])) AS extra_role
                    WHERE LOWER(extra_role) = ANY($1::text[])
                )
           )
         ORDER BY id`,
        [ATTENDANCE_REVIEW_ROLES]
    );
    return attendanceReviewRecipients(result.rows);
}

async function loadAttendanceArrivals(db, reportDate, businessContext) {
    const canonical = await db.query(
        `SELECT tr.staff_id,
                s.name AS staff_name,
                s.department,
                TO_CHAR(MIN(tr.clock_in) AT TIME ZONE 'Europe/Kyiv', 'HH24:MI') AS arrival_time
         FROM hr_time_records tr
         JOIN staff s ON s.id = tr.staff_id
         WHERE tr.record_date = $1::date
           AND tr.clock_in IS NOT NULL
           AND COALESCE(tr.business_context, $2) = $2
         GROUP BY tr.staff_id, s.name, s.department`,
        [reportDate, businessContext]
    );
    const fallback = await db.query(
        `SELECT sc.staff_id,
                s.name AS staff_name,
                s.department,
                TO_CHAR(MIN(sc.check_in), 'HH24:MI') AS arrival_time
         FROM staff_checkins sc
         JOIN staff s ON s.id = sc.staff_id
         WHERE sc.date = $1::date
           AND sc.check_in IS NOT NULL
         GROUP BY sc.staff_id, s.name, s.department`,
        [reportDate]
    );
    return mergeAttendanceArrivals(canonical.rows, fallback.rows);
}

async function runAttendanceReviewTasks(options = {}) {
    const now = options.now || new Date();
    const window = attendanceReviewWindow(now);
    if (!window) return { skipped: true, reason: 'before_cutoff' };

    const db = options.db || defaultPool;
    const createTask = options.createTask || require('./kleshnya').createTask;
    const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`${ATTENDANCE_REVIEW_SOURCE_TYPE}:${window.reportDate}`]
        );

        const recipients = await loadAttendanceReviewRecipients(client);
        const arrivals = await loadAttendanceArrivals(client, window.reportDate, businessContext);
        let created = 0;
        let existing = 0;

        for (const recipient of recipients) {
            const sourceId = `${window.reportDate}:${recipient.id}`;
            const duplicate = await client.query(
                `SELECT id
                 FROM tasks
                 WHERE business_context = $1
                   AND source_type = $2
                   AND source_id = $3
                 ORDER BY id
                 LIMIT 1`,
                [businessContext, ATTENDANCE_REVIEW_SOURCE_TYPE, sourceId]
            );
            if (duplicate.rows[0]) {
                existing += 1;
                continue;
            }

            const scopedArrivals = recipient.scope === 'company'
                ? arrivals
                : arrivals.filter(arrival => ART_DIRECTOR_DEPARTMENTS.has(arrival.department));
            await createTask({
                businessContext,
                title: `Ознайомитися з приходами за ${formatReportDate(window.reportDate)}`,
                description: formatAttendanceReviewDescription(scopedArrivals),
                date: window.taskDate,
                priority: 'normal',
                assigned_to: recipient.label,
                owner: recipient.label,
                owner_user_id: recipient.id,
                created_by: 'attendance-review-scheduler',
                task_type: 'human',
                task_mode: 'work',
                task_kind: 'routine',
                visibility: 'private',
                workflow_state: 'todo',
                category: 'admin',
                source_type: ATTENDANCE_REVIEW_SOURCE_TYPE,
                source_id: sourceId,
                source_module: 'attendance_review',
                control_meta: {
                    reportDate: window.reportDate,
                    recipientScope: recipient.scope
                },
                duplicateMode: 'skip'
            }, {
                pool: client,
                skipNotifications: true,
                skipHermesOutbox: true
            });
            created += 1;
        }

        await client.query('COMMIT');
        log.info(`Attendance review tasks processed for ${window.reportDate}: recipients=${recipients.length}, created=${created}, existing=${existing}`);
        return {
            skipped: false,
            reportDate: window.reportDate,
            taskDate: window.taskDate,
            recipients: recipients.length,
            created,
            existing
        };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    ART_DIRECTOR_DEPARTMENTS,
    ATTENDANCE_REVIEW_CUTOFF_MINUTES,
    ATTENDANCE_REVIEW_SOURCE_TYPE,
    attendanceReviewRecipients,
    attendanceReviewWindow,
    formatAttendanceReviewDescription,
    mergeAttendanceArrivals,
    runAttendanceReviewTasks
};
