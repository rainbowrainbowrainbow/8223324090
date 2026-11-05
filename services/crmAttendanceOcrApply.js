'use strict';

const { executionError, requireExecutionEnabled, transaction } = require('./crmProviderExecution');
const { attendanceSnapshot, digest } = require('./crmAttendanceOcrPreview');
const { lockAttendanceWriteTargets } = require('./attendanceWriteLock');
const { lockPayrollPeriodMutation, assertPayrollPeriodOpen } = require('./hrPayrollPeriod');
const { recordAttendanceClockIn, recordAttendanceClockOut } = require('./hrAttendance');

function withoutCapture(terms) {
    const { capturedAt, ...value } = terms;
    return value;
}

// Internal only: caller must supply its authenticated actor and existing HR
// management authorization. No HTTP route, real-record operation or new policy.
function createAttendanceOcrApply(options = {}) {
    const env = options.env || process.env;
    return async function apply(input) {
        requireExecutionEnabled(env, 'CRM_ATTENDANCE_OCR_ENABLED');
        if (input.businessContext !== 'event_genix' || !Number.isInteger(input.actor?.id) || input.actor.id < 1) throw executionError('CRM_ATTENDANCE_OCR_CONTEXT_FORBIDDEN', 403);
        if (input.confirmed !== true) throw executionError('CRM_EXECUTION_CONFIRMATION_REQUIRED', 400);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.previewId || '')
            || !/^[a-f0-9]{64}$/.test(input.previewHash || '')) throw executionError('CRM_ATTENDANCE_OCR_APPLY_INVALID', 400);
        const selected = input.selectedRowOrdinals;
        if (!Array.isArray(selected) || !selected.length || selected.length > 100
            || selected.some(id => !Number.isInteger(id) || id < 1) || new Set(selected).size !== selected.length) {
            throw executionError('CRM_ATTENDANCE_OCR_APPLY_INVALID', 400);
        }
        const pool = options.pool || require('../db').pool, client = await pool.connect();
        try {
            return await transaction(client, async () => {
                // Canonical staff/date and period locks cover cooperating writers;
                // serialization failures are returned, never retried automatically.
                await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
                const preview = (await client.query(`SELECT p.*,e.document_date::text AS document_date,e.review_document
                    FROM crm_attendance_ocr_previews p JOIN crm_attendance_ocr_executions e ON e.id=p.execution_id
                    WHERE p.id=$1 AND e.business_context=$2 AND e.actor_user_id=$3`,
                [input.previewId,input.businessContext,input.actor.id])).rows[0];
                if (!preview) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND', 404);
                if (preview.preview_hash !== input.previewHash
                    || digest({ executionId: preview.execution_id, rows: preview.preview_rows, snapshot: preview.state_snapshot }) !== preview.preview_hash) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_STALE');
                const requestHash = digest({ previewId: input.previewId, previewHash: input.previewHash, selected: [...selected].sort((a,b)=>a-b) });
                const rows = selected.map(id => preview.preview_rows.find(row => row.sourceRowOrdinal === id));
                if (rows.some(row => row?.classification !== 'ready_for_confirmed_apply')) throw executionError('CRM_ATTENDANCE_OCR_ROWS_REQUIRE_REVIEW');
                const date = preview.document_date, month = date.slice(0,7);
                await lockPayrollPeriodMutation(month, client);
                await lockAttendanceWriteTargets(client, rows.map(row => ({ staffId: row.matchedStaffId, date })));
                await client.query('SELECT id FROM crm_attendance_ocr_executions WHERE id=$1 FOR UPDATE', [preview.execution_id]);
                const applied = (await client.query('SELECT id,apply_result FROM crm_attendance_ocr_previews WHERE execution_id=$1 AND applied_at IS NOT NULL', [preview.execution_id])).rows[0];
                if (applied) {
                    if (applied.id !== input.previewId || applied.apply_result.requestHash !== requestHash) throw executionError('CRM_ATTENDANCE_OCR_ALREADY_APPLIED');
                    return { ...applied.apply_result, reused: true };
                }
                if (new Date(preview.expires_at) <= new Date()) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_EXPIRED');
                const now = options.now ? new Date(options.now()) : new Date();
                if (!Number.isFinite(now.valueOf())) throw executionError('CRM_ATTENDANCE_OCR_FUTURE_DATE', 422);
                const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
                if (date > today) throw executionError('CRM_ATTENDANCE_OCR_FUTURE_DATE', 422);
                try { await assertPayrollPeriodOpen(month, client); }
                catch (error) { if (error.payrollLock) throw executionError('CRM_ATTENDANCE_OCR_PERIOD_CLOSED', 423); throw error; }
                const ids = rows.map(row => row.matchedStaffId).sort((a,b)=>a-b);
                await client.query('SELECT id FROM staff WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
                const history = await client.query(`SELECT pr.id FROM payroll_reports pr WHERE pr.staff_id=ANY($1::int[]) AND pr.period_month=$2
                    AND (pr.status IN ('reviewed','approved','paid') OR EXISTS (
                        SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id=pr.id
                        AND (pi.workflow_status <> 'draft' OR EXISTS (
                            SELECT 1 FROM payroll_payment_movements ppm WHERE ppm.installment_id=pi.id))))
                    FOR UPDATE OF pr`, [ids,month]);
                if (history.rowCount) throw executionError('CRM_ATTENDANCE_OCR_HISTORY_LOCKED');
                const current = await attendanceSnapshot(client, date, preview.review_document);
                if (digest({ executionId: preview.execution_id, ...current }) !== preview.preview_hash) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_STALE');
                const appliedRows = [];
                for (const row of rows.sort((a,b)=>a.matchedStaffId-b.matchedStaffId)) {
                    const times = (await client.query(`SELECT (($1::date+$2::time) AT TIME ZONE 'Europe/Kyiv') AS arrival,
                        (($1::date+$3::time) AT TIME ZONE 'Europe/Kyiv') AS departure,
                        to_char((($1::date+$2::time) AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv','YYYY-MM-DD HH24:MI') AS arrival_local,
                        to_char((($1::date+$3::time) AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv','YYYY-MM-DD HH24:MI') AS departure_local,
                        ((($1::date+1)::timestamp AT TIME ZONE 'Europe/Kyiv')-($1::date::timestamp AT TIME ZONE 'Europe/Kyiv')) <> INTERVAL '24 hours' AS transition_day`,
                    [date,row.arrivalTime,row.departureTime])).rows[0];
                    // Reject civil times normalized across a missing DST hour.
                    if (times.transition_day || times.arrival_local !== date+' '+row.arrivalTime || times.departure_local !== date+' '+row.departureTime
                        || times.departure <= times.arrival || times.departure > now) throw executionError('CRM_ATTENDANCE_OCR_TIME_REQUIRES_REVIEW', 422);
                    const shared = { staffId: row.matchedStaffId, recordDate: date, businessContext: input.businessContext,
                        performedBy: 'crm-user:'+input.actor.id, method: 'import', source: 'crm_attendance_ocr',
                        notes: 'CRM attendance OCR '+input.previewId+' / row '+row.sourceRowOrdinal };
                    const entered = await recordAttendanceClockIn(client, { ...shared, now: times.arrival });
                    if (!entered.record || entered.alreadyClockedIn) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_STALE');
                    const expected = current.snapshot.compensation.find(value => value.staffId===row.matchedStaffId)?.terms;
                    if (!expected || digest(withoutCapture(expected)) !== digest(withoutCapture(entered.record.compensation_snapshot))) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_STALE');
                    const left = await recordAttendanceClockOut(client, { ...shared, now: times.departure, settlementMode: 'actual_time' });
                    if (!left.record || left.alreadyClockedOut || left.record.compensation_snapshot?.manualReview) throw executionError('CRM_ATTENDANCE_OCR_ROWS_REQUIRE_REVIEW');
                    // Mirror the canonical stored clock values exactly as staff check-in does.
                    await client.query('INSERT INTO staff_checkins(staff_id,date,check_in,check_out,method) VALUES($1,$2,$3,$4,$5)',
                        [row.matchedStaffId,date,left.record.clock_in,left.record.clock_out,'crm_ocr']);
                    appliedRows.push({ sourceRowOrdinal: row.sourceRowOrdinal, staffId: row.matchedStaffId, attendanceRecordId: Number(left.record.id), arrivalTime: row.arrivalTime, departureTime: row.departureTime });
                }
                const result = { previewId: input.previewId, documentDate: date, requestHash, appliedRows,
                    attendanceWrites: appliedRows.length, scheduleWrites: 0, wholeDayComplete: false, reused: false };
                await client.query('UPDATE crm_attendance_ocr_previews SET applied_at=NOW(),apply_result=$2::jsonb WHERE id=$1', [input.previewId,JSON.stringify(result)]);
                return result;
            });
        } finally { client.release(); }
    };
}

module.exports = { createAttendanceOcrApply };
