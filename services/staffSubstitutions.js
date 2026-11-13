'use strict';

const { pool } = require('../db');
const contract = require('./staffSubstitutionContract');
const { acquirePayrollPeriodMutationLock, lockPayrollPeriodMutation, assertPayrollPeriodOpen } = require('./hrPayrollPeriod');
const { lockScheduleStaffRows } = require('./staffScheduleMutations');
const { lockAttendanceWriteTargets } = require('./attendanceWriteLock');

function actorName(actor) {
    return contract.text(actor?.username, 'автор', 100);
}

function mapRow(row) {
    return { id: String(row.id), version: row.version, state: row.state, input: row.input_json,
        quote: row.quote_json, completion: row.completion_json, createdBy: row.created_by,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

function createSubstitutionService(dependencies = {}) {
    const db = dependencies.pool || pool;
    const sources = dependencies.sources || require('./staffSubstitutionSources');
    const loadContext = dependencies.loadContext || require('./staffSubstitutionContext').loadContext;
    const freezeCompletion = dependencies.freezeCompletion || require('./staffSubstitutionPayroll').freezeCompletion;

    async function read(client, business, id, lock = false) {
        const result = await client.query(`SELECT * FROM staff_substitutions WHERE id=$1 AND business_context=$2 ${lock ? 'FOR UPDATE' : ''}`,
            [contract.integer(id, 'підміна', 1), business]);
        if (!result.rows.length) contract.fail('SUBSTITUTION_NOT_FOUND', 'Підміну не знайдено', 404);
        return result.rows[0];
    }

    async function prepare(client, business, actor, raw, current = null) {
        const input = contract.normalizeInput(raw);
        const source = await sources.loadScope(client, business, actor, input, current);
        const context = await loadContext(client, business, actor, input, source, current);
        return { quote: contract.preview(input, context), source };
    }

    async function list(business, { from, to, staffId } = {}) {
        const { normalizeAttendanceWriteDate } = require('./attendanceWriteLock');
        from = normalizeAttendanceWriteDate(from);
        to = normalizeAttendanceWriteDate(to);
        if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) contract.fail('SUBSTITUTION_RANGE_INVALID', 'Оберіть період до 366 днів');
        const result = await db.query(`SELECT * FROM staff_substitutions WHERE business_context=$1 AND work_date BETWEEN $2::date AND $3::date
            AND ($4::int IS NULL OR staff_id=$4 OR original_staff_id=$4) ORDER BY work_date,id LIMIT 1000`,
        [business, from, to, staffId == null ? null : contract.integer(staffId, 'працівник', 1)]);
        return result.rows.map(mapRow);
    }

    async function history(business, id) {
        const row = await read(db, business, id);
        const result = await db.query('SELECT version,action,actor,reason,before_json,after_json,created_at FROM staff_substitution_events WHERE substitution_id=$1 ORDER BY version', [row.id]);
        return { substitution: mapRow(row), events: result.rows };
    }

    async function preview(business, actor, raw, id = null) {
        const current = id ? await read(db, business, id) : null;
        return (await prepare(db, business, actor, raw, current)).quote;
    }

    async function completionOptions(business, id) {
        const row = await read(db, business, id);
        const result = await db.query(`SELECT id,compensation_snapshot,clock_out FROM hr_time_records
            WHERE staff_id=$1 AND record_date=$2 AND business_context=$3`, [row.staff_id,row.work_date,business]);
        const record = result.rows[0];
        const snapshot = typeof record?.compensation_snapshot === 'string' ? JSON.parse(record.compensation_snapshot) : record?.compensation_snapshot;
        const allocations = record?.clock_out && snapshot?.schemaVersion === 2 && !snapshot.manualReview
            ? (snapshot.compensationAllocations || []).flatMap((item,index) => item.allocationType === 'base'
                ? [{ index, professionKey: item.professionKey, actualMinutes: Number(item.actualMinutes || 0),
                    plannedMinutes: Number(item.plannedMinutes || 0), rate: item.conditions?.rate, rateUnit: item.conditions?.rateUnit }] : []) : [];
        return { attendanceId: allocations.length ? record.id : null, allocations };
    }

    async function mutate(business, actor, action, payload = {}, id = null) {
        contract.choice(action, ['create', 'revise', 'complete', 'cancel'], 'дію');
        const author = actorName(actor);
        const requestKey = contract.text(payload.requestKey, 'ключ запиту', 128);
        if (!/^[A-Za-z0-9:_-]{8,128}$/.test(requestKey)) contract.fail('SUBSTITUTION_REQUEST_INVALID', 'Некоректний ключ запиту');
        const hash = contract.fingerprint({ action, id: id == null ? null : String(id), payload });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`substitution-request:${business}:${author}:${requestKey}`]);
            const previousRequest = await client.query('SELECT payload_hash,response_json FROM staff_substitution_requests WHERE business_context=$1 AND actor=$2 AND request_key=$3', [business, author, requestKey]);
            if (previousRequest.rows.length) {
                if (previousRequest.rows[0].payload_hash !== hash) contract.fail('SUBSTITUTION_REQUEST_REUSED', 'Ключ уже використано для іншого запиту', 409);
                await client.query('COMMIT');
                return previousRequest.rows[0].response_json;
            }
            const observed = id ? await read(client, business, id) : null;
            const input = action === 'create' || action === 'revise' ? contract.normalizeInput(payload.input) : observed?.input_json;
            if (!input || action !== 'create' && !observed) contract.fail('SUBSTITUTION_NOT_FOUND', 'Підміну не знайдено', 404);
            if (observed && (input.staffId !== observed.input_json.staffId || input.originalStaffId !== observed.input_json.originalStaffId
                || input.workDate !== observed.input_json.workDate || input.sourceType !== observed.source_type
                || input.sourceId !== observed.source_id || input.slotKey !== observed.slot_key)) {
                contract.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для іншого працівника, дати або джерела скасуйте підміну й створіть нову', 409);
            }
            const month = input.workDate.slice(0, 7);
            // Both existing payroll lock families are acquired in the same order as report generation.
            await lockPayrollPeriodMutation(month, client);
            await acquirePayrollPeriodMutationLock(client, month);
            await assertPayrollPeriodOpen(month, client);
            const staffIds = [input.staffId, input.originalStaffId].filter(Boolean).sort((a,b) => a-b);
            await lockScheduleStaffRows(client, staffIds);
            const dates = [...new Set([input.workDate, ...(input.endsAt ? [contract.kyivParts(input.endsAt).date] : [])])].sort();
            await lockAttendanceWriteTargets(client, staffIds.flatMap(staffId => dates.map(date => ({ staffId, date }))));
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
                [`substitution-source:${business}:${input.sourceType}:${input.sourceId}:${input.slotKey}:${input.workDate}`]);
            const current = observed ? await read(client, business, id, true) : null;
            if (current && current.version !== contract.integer(payload.expectedVersion, 'версія', 1)) {
                contract.fail('SUBSTITUTION_STALE', 'Підміну вже змінено; оновіть дані', 409);
            }
            if (current && current.state !== 'active') contract.fail('SUBSTITUTION_FROZEN', 'Завершену або скасовану підміну не можна переписати', 409);
            const reports = await client.query(`SELECT pr.id FROM payroll_reports pr
                WHERE pr.staff_id=ANY($1::int[]) AND pr.period_month=$2 AND (pr.status <> 'draft' OR EXISTS (
                    SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id=pr.id
                    AND (pi.workflow_status <> 'draft' OR EXISTS (
                        SELECT 1 FROM payroll_payment_movements ppm WHERE ppm.installment_id=pi.id)))) FOR UPDATE OF pr`, [staffIds, month]);
            if (reports.rows.length) contract.fail('SUBSTITUTION_PAYROLL_FROZEN', 'Є погоджений зарплатний звіт; потрібне окреме коригування', 409);
            await sources.lockScope?.(client, input);
            let next;
            const reason = action === 'create' || action === 'revise' ? input.reason : contract.text(payload.reason, 'причина');
            if (action === 'create' || action === 'revise') {
                const prepared = await prepare(client, business, actor, payload.input, current);
                if (prepared.quote.fingerprint !== payload.previewFingerprint) contract.fail('SUBSTITUTION_PREVIEW_STALE', 'Умови змінилися; повторіть попередній розрахунок', 409);
                if (!prepared.quote.available) contract.fail('SUBSTITUTION_BLOCKED', 'Підміна має невирішені обмеження', 409, prepared.quote.blockers);
                if (payload.effectsAcknowledged !== true) contract.fail('SUBSTITUTION_ACK_REQUIRED', 'Підтвердьте наслідки для обох працівників');
                if (action === 'create') {
                    const result = await client.query(`INSERT INTO staff_substitutions
                        (business_context,staff_id,original_staff_id,work_date,source_type,source_id,slot_key,state,version,input_json,quote_json,source_snapshot,created_by)
                        VALUES($1,$2,$3,$4,$5,$6,$7,'active',1,$8::jsonb,$9::jsonb,$10::jsonb,$11) RETURNING *`,
                    [business,input.staffId,input.originalStaffId,input.workDate,input.sourceType,input.sourceId,input.slotKey,
                        JSON.stringify(input),JSON.stringify(prepared.quote),JSON.stringify(prepared.source),author]);
                    next = result.rows[0];
                    await client.query("SELECT set_config('eventgenix.substitution_command',$1,true)", [String(next.id)]);
                    await sources.applyAssignment(client, business, actor, next, prepared.source);
                } else {
                    await sources.reviseAssignment(client, business, actor, current, input);
                    next = (await client.query(`UPDATE staff_substitutions SET input_json=$1,quote_json=$2,version=version+1,updated_at=NOW() WHERE id=$3 RETURNING *`,
                        [JSON.stringify(input), JSON.stringify(prepared.quote), current.id])).rows[0];
                }
            } else if (action === 'cancel') {
                await client.query("SELECT set_config('eventgenix.substitution_command',$1,true)", [String(current.id)]);
                await sources.restoreAssignment(client, business, actor, current);
                next = (await client.query("UPDATE staff_substitutions SET state='cancelled',version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *", [current.id])).rows[0];
            } else {
                await sources.assertCurrent(client, business, actor, current);
                const completion = await freezeCompletion(client, current, payload, actor);
                next = (await client.query("UPDATE staff_substitutions SET state='completed',completion_json=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *", [JSON.stringify(completion), current.id])).rows[0];
            }
            await client.query(`INSERT INTO staff_substitution_events(substitution_id,version,action,actor,reason,before_json,after_json)
                VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`, [next.id,next.version,action,author,reason,current ? JSON.stringify(mapRow(current)) : null, JSON.stringify(mapRow(next))]);
            const response = mapRow(next);
            await client.query(`INSERT INTO staff_substitution_requests(business_context,actor,request_key,payload_hash,substitution_id,response_json)
                VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [business,author,requestKey,hash,next.id,JSON.stringify(response)]);
            await client.query('COMMIT');
            return response;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            if (error.code === '23505') contract.fail('SUBSTITUTION_DUPLICATE', 'Цей обсяг роботи вже має підміну або нарахування', 409);
            if (error.code === '23514' && /agreed substitution|Substitution evidence|Substitution history/.test(error.message)) {
                contract.fail('SUBSTITUTION_SOURCE_FROZEN','Ця робота вже має погоджену підміну; перевірте її історію',409);
            }
            throw error;
        } finally { client.release(); }
    }
    return { list, history, preview, mutate, completionOptions };
}

module.exports = { createSubstitutionService, mapRow };
