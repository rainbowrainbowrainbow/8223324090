'use strict';

const c = require('./staffSubstitutionContract');
const { matchesSubstitutionBaseAllocation } = require('./staffSubstitutionShift');
const { lockPayrollPeriodMutation, acquirePayrollPeriodMutationLock } = require('./hrPayrollPeriod');
const { lockAttendanceWriteTargets } = require('./attendanceWriteLock');

const PARK = 'event_genix';
const fields = `id::text, substitution_id::text AS "substitutionId", source_report_id::text AS "sourceReportId",
    source_staff_id AS "sourceStaffId", corrected_staff_id AS "correctedStaffId",
    source_attendance_id AS "sourceAttendanceId", corrected_attendance_id AS "correctedAttendanceId",
    allocation_index AS "allocationIndex", evidence_json AS evidence, work_date::text AS "workDate",
    posting_month AS "postingMonth", reverse_minor::float8 AS "reverseMinor", credit_minor::float8 AS "creditMinor",
    actor, reason, created_at AS "createdAt"`;

function isWorkCorrectionSource(row) {
    const input = row.input_json;
    return row.state === 'completed' && input.sourceType === 'hr_shift' && input.payMode === 'additional'
        && Number.isSafeInteger(row.completion_json?.attendanceId) && row.completion_json?.baseEvidence?.length === 1;
}

async function loadWorkCorrection(db, id) {
    return (await db.query(`SELECT ${fields} FROM staff_substitution_work_corrections WHERE substitution_id=$1`, [id])).rows[0] || null;
}

async function loadWorkCorrectionLines(db, month, staffId) {
    const { rows } = await db.query(`SELECT ${fields} FROM staff_substitution_work_corrections
        WHERE posting_month=$1 AND ($2::int IS NULL OR $2 IN (source_staff_id,corrected_staff_id)) ORDER BY id`, [month, staffId]);
    return rows.flatMap(({ evidence, ...row }) => [
        { ...row, id:`work:${row.id}:reverse`, staffId:row.sourceStaffId, deltaMinor:-Number(row.reverseMinor),
            label:`Сторно оплати підміни #${row.substitutionId}` },
        { ...row, id:`work:${row.id}:credit`, staffId:row.correctedStaffId, deltaMinor:Number(row.creditMinor),
            label:`Уточнена оплата підміни #${row.substitutionId}` }
    ]).filter(line => line.deltaMinor && (staffId == null || Number(staffId) === line.staffId));
}

async function loadFrozenSource(db, row) {
    if (!isWorkCorrectionSource(row)) return null;
    const result = await db.query(`SELECT id,breakdown_json->'lines' AS lines FROM payroll_reports
        WHERE staff_id=$1 AND period_month=$2 AND status IN ('reviewed','approved','paid') AND voided_at IS NULL`,
    [row.staff_id,row.input_json.workDate.slice(0,7)]);
    const report = result.rows[0];
    const lines = Array.isArray(report?.lines) ? report.lines.filter(line => line.lineType === 'staff_substitution'
        && line.meta?.substitutionId === String(row.id) && line.meta.payee !== 'original') : [];
    if (lines.length !== 1 || lines[0].amount !== row.completion_json.amountMinor / 100) return null;
    return { reportId:report.id, fingerprint:c.fingerprint(lines[0]), amountMinor:row.completion_json.amountMinor };
}

async function loadCorrectedAttendance(db, row, staffId) {
    const { rows } = await db.query(`SELECT id,clock_out,compensation_snapshot AS snapshot FROM hr_time_records
        WHERE staff_id=$1 AND record_date=$2 AND business_context=$3`, [staffId,row.input_json.workDate,PARK]);
    const record = rows[0];
    const snapshot = record?.snapshot;
    if (!record?.clock_out || snapshot?.schemaVersion !== 2 || snapshot.manualReview || snapshot.state === 'manual_review') {
        c.fail('SUBSTITUTION_WORK_CORRECTION_ATTENDANCE_REQUIRED','Потрібен завершений перевірений табель виконавця за цю дату.',409);
    }
    const matches = (snapshot.compensationAllocations || []).flatMap((allocation,index) =>
        allocation.allocationType === 'base' && allocation.professionKey === row.input_json.professionKey
        && Number.isSafeInteger(allocation.actualMinutes) && allocation.actualMinutes > 0
        && allocation.actualMinutes <= row.input_json.plannedMinutes && allocation.conditions?.rate > 0
        && matchesSubstitutionBaseAllocation(row.input_json,snapshot,allocation) ? [{allocation,index}] : []);
    if (matches.length !== 1) {
        c.fail('SUBSTITUTION_WORK_CORRECTION_SCOPE','Потрібен один підтверджений сегмент тієї самої ролі й погодженого інтервалу.',409);
    }
    const { allocation,index } = matches[0];
    return { attendanceId:record.id, allocationIndex:index, allocationFingerprint:c.fingerprint(allocation), actualMinutes:allocation.actualMinutes };
}

async function quoteWorkCorrection(db, read, business, id, staffId) {
    if (business !== PARK) c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED','Коригування факту підміни доступне у Park.',403);
    const row = await read(db,business,id);
    if (!await loadFrozenSource(db,row) || await loadWorkCorrection(db,row.id)) {
        c.fail('SUBSTITUTION_WORK_CORRECTION_SOURCE','Потрібне зафіксоване нарахування за підміну зміни Park без попереднього перенесення.',409);
    }
    staffId = c.integer(staffId,'виконавець',1);
    if (staffId === row.original_staff_id) {
        c.fail('SUBSTITUTION_WORK_CORRECTION_ORIGINAL','Потрібна звірка звичайної зарплати заміненого працівника.',409);
    }
    const attendance = await loadCorrectedAttendance(db,row,staffId);
    if (staffId === row.staff_id && attendance.allocationFingerprint === row.completion_json.baseEvidence[0]) {
        c.fail('SUBSTITUTION_WORK_CORRECTION_UNCHANGED','Виконавець і табель не змінилися.',409);
    }
    return { ...attendance, staffId };
}

async function postWorkCorrection(db, read, business, actor, rawId, payload) {
    if (business !== PARK) c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED','Коригування факту підміни доступне у Park.',403);
    const id = c.integer(rawId,'підміна',1);
    const name = c.text(actor?.username,'автор',100);
    const requestKey = c.text(payload.requestKey,'ключ запиту',128);
    const reason = c.text(payload.reason,'причина коригування');
    const postingMonth = c.text(payload.postingMonth,'місяць нарахування',7);
    const staffId = c.integer(payload.staffId,'виконавець',1);
    const attendanceId = c.integer(payload.attendanceId,'запис табеля',1);
    const allocationIndex = c.integer(payload.allocationIndex,'індекс підтвердженого сегмента',0,1000);
    const fingerprint = c.text(payload.allocationFingerprint,'підтвердження табеля',64);
    const creditMinor = c.decimalUnits(String(payload.correctedAmount ?? '').trim().replace(',','.'),2,'виправлена сума',true);
    const hash = c.fingerprint({id,staffId,attendanceId,allocationIndex,postingMonth,fingerprint,creditMinor,reason});
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`substitution-work-correction:${name}:${requestKey}`]);
        const replay = (await client.query(`SELECT ${fields},request_hash FROM staff_substitution_work_corrections
            WHERE actor=$1 AND request_key=$2`, [name,requestKey])).rows[0];
        if (replay) {
            const { request_hash, ...result } = replay;
            if (request_hash !== hash) c.fail('SUBSTITUTION_REQUEST_REUSED','Ключ уже використано для іншого запиту.',409);
            await client.query('COMMIT');
            return result;
        }
        const initial = await read(client,business,id);
        const workDate = initial.input_json.workDate;
        const sourceMonth = workDate.slice(0,7);
        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(postingMonth) || postingMonth <= sourceMonth) {
            c.fail('SUBSTITUTION_CORRECTION_MONTH_INVALID','Оберіть відкритий місяць після початкового нарахування.',409);
        }
        for (const month of [sourceMonth,postingMonth]) {
            await lockPayrollPeriodMutation(month,client);
            await acquirePayrollPeriodMutationLock(client,month);
        }
        await lockAttendanceWriteTargets(client,[{staffId,recordDate:workDate}]);
        const row = await read(client,business,id,true);
        const attendance = await quoteWorkCorrection(client,read,business,id,staffId);
        if (attendance.attendanceId !== attendanceId || attendance.allocationIndex !== allocationIndex
            || attendance.allocationFingerprint !== fingerprint) {
            c.fail('SUBSTITUTION_CORRECTION_STALE','Табель уже змінився. Перевірте його ще раз.',409);
        }
        const source = await loadFrozenSource(client,row);
        const { isPostingFrozen } = require('./staffSubstitutionCorrections');
        if (await isPostingFrozen(client,postingMonth,row.staff_id) || await isPostingFrozen(client,postingMonth,staffId)) {
            c.fail('SUBSTITUTION_CORRECTION_PERIOD_FROZEN','Місяць нарахування має бути відкритим для обох працівників.',409);
        }
        const conflict = await client.query(`SELECT 1 WHERE EXISTS (
            SELECT 1 FROM staff_substitution_pay_corrections WHERE substitution_id=$1 AND payee='replacement'
        ) OR EXISTS (
            SELECT 1 FROM staff_substitution_work_corrections WHERE corrected_attendance_id=$2 AND allocation_index=$3
        ) OR EXISTS (
            SELECT 1 FROM staff_substitution_base_claims WHERE attendance_id=$2 AND allocation_key=($3::int)::text
        ) OR EXISTS (
            SELECT 1 FROM staff_substitutions WHERE id<>$1 AND state='completed' AND completion_json->>'attendanceId'=($2::int)::text
                AND (completion_json->'baseEvidence') ? $4
        )`, [id,attendance.attendanceId,attendance.allocationIndex,fingerprint]);
        if (conflict.rowCount) c.fail('SUBSTITUTION_WORK_CORRECTION_CONFLICT','Нарахування або цей сегмент уже використано іншим коригуванням.',409);
        if (!source.amountMinor && !creditMinor) c.fail('SUBSTITUTION_CORRECTION_UNCHANGED','За обома записами сума дорівнює нулю.');
        const evidence = { sourcePayrollFingerprint:source.fingerprint, sourceAllocationFingerprint:row.completion_json.baseEvidence[0],
            correctedAllocationFingerprint:fingerprint, actualMinutes:attendance.actualMinutes };
        const { rows } = await client.query(`INSERT INTO staff_substitution_work_corrections
            (substitution_id,source_report_id,source_staff_id,corrected_staff_id,source_attendance_id,corrected_attendance_id,
                allocation_index,evidence_json,work_date,posting_month,reverse_minor,credit_minor,actor,reason,request_key,request_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${fields}`,
        [id,source.reportId,row.staff_id,staffId,row.completion_json.attendanceId,attendance.attendanceId,attendance.allocationIndex,
            JSON.stringify(evidence),workDate,postingMonth,source.amountMinor,creditMinor,name,reason,requestKey,hash]);
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { loadFrozenSource, loadWorkCorrection, loadWorkCorrectionLines, quoteWorkCorrection, postWorkCorrection };
