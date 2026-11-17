'use strict';

function breakError(code, message, statusCode = 409) {
    return Object.assign(new Error(message), { code, statusCode });
}

function assertAttendanceBreakBounds(intervals, clockIn, clockOut) {
    if (intervals?.some(interval => !clockIn || new Date(interval.startedAt) < new Date(clockIn)
        || (clockOut && new Date(interval.endedAt || interval.startedAt) > new Date(clockOut)))) {
        throw breakError('ATTENDANCE_BREAK_OUTSIDE_SHIFT', 'Фактичний час зміни має охоплювати зафіксовані перерви.');
    }
}

function resolveBreakMutation({ record, action, version, endedAt, reason, now }) {
    if (!['start', 'finish', 'confirm'].includes(action)) {
        throw breakError('ATTENDANCE_BREAK_INVALID_ACTION', 'Невідома дія з перервою.', 400);
    }
    if (!record?.clock_in || record.status === 'arrival_cancelled') {
        throw breakError('ATTENDANCE_BREAK_SHIFT_REQUIRED', 'Спочатку відмітьте початок зміни.');
    }
    if (version !== record.record_version) {
        throw breakError('ATTENDANCE_BREAK_STALE', 'Запис змінився. Оновіть дані.');
    }
    const intervals = record.break_intervals || [];
    const last = intervals.at(-1);
    const open = last && !last.endedAt;
    const nowMs = now.getTime();
    const shiftStart = new Date(record.clock_in).getTime();
    if (action === 'start') {
        if (record.clock_out || record.auto_closed || open || nowMs < shiftStart
            || (last && nowMs < new Date(last.endedAt).getTime())) {
            throw breakError('ATTENDANCE_BREAK_CANNOT_START', 'Перерву можна почати під час відкритої зміни, коли немає іншої перерви.');
        }
        return [...intervals, { startedAt: now.toISOString(), endedAt: null }];
    }

    if (!open) throw breakError('ATTENDANCE_BREAK_NOT_OPEN', 'Відкритої перерви немає.');
    if (action === 'finish' && (record.clock_out || record.auto_closed)) {
        throw breakError('ATTENDANCE_BREAK_CONFIRM_REQUIRED', 'Вкажіть фактичний час завершення перерви.');
    }
    let end = now;
    if (action === 'confirm') {
        if (typeof endedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(endedAt)
            || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
            throw breakError('ATTENDANCE_BREAK_INVALID_CONFIRMATION', 'Вкажіть час завершення перерви та причину (до 500 символів).', 400);
        }
        end = new Date(endedAt);
    }
    const latest = record.clock_out ? Math.min(nowMs, new Date(record.clock_out).getTime()) : nowMs;
    if (!(end.getTime() > new Date(last.startedAt).getTime() && end.getTime() <= latest)) {
        throw breakError('ATTENDANCE_BREAK_INVALID_END', 'Час завершення має бути після початку перерви та в межах фактичної зміни.', 400);
    }
    return [...intervals.slice(0, -1), { ...last, endedAt: end.toISOString() }];
}

async function recordAttendanceBreak(db, { recordId, staffId, recordDate, businessContext,
    action, version, endedAt, reason, performedBy, ip }) {
    const { rows: [record] } = await db.query(
        `SELECT *, updated_at::text AS record_version, clock_timestamp() AS mutation_time
         FROM hr_time_records
         WHERE id = $1 AND staff_id = $2 AND record_date = $3
           AND COALESCE(business_context, 'event_genix') = $4
         FOR UPDATE`,
        [recordId, staffId, recordDate, businessContext]
    );
    if (!record) throw breakError('ATTENDANCE_BREAK_RECORD_NOT_FOUND', 'Запис зміни не знайдено.', 404);
    const intervals = resolveBreakMutation({ record, action, version, endedAt, reason, now: record.mutation_time });
    const { rows: [updated] } = await db.query(
        `UPDATE hr_time_records SET break_intervals = $2::jsonb, updated_at = clock_timestamp()
         WHERE id = $1 RETURNING id, break_intervals, updated_at::text AS record_version`,
        [recordId, JSON.stringify(intervals)]
    );
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('attendance_break', $1, $2, $3, $4)`,
        [staffId, performedBy, JSON.stringify({
            action, recordId, recordDate, businessContext,
            before: record.break_intervals?.at(-1) || null, after: intervals.at(-1),
            ...(action === 'confirm' ? { reason: reason.trim() } : {})
        }), ip || null]
    );
    return updated;
}

module.exports = { assertAttendanceBreakBounds, recordAttendanceBreak };
