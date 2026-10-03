'use strict';

const { createHash } = require('node:crypto');
const { normalizeAttendanceWriteDate, lockAttendanceWriteTarget } = require('./attendanceWriteLock');
const { lockPayrollPeriodMutation, assertPayrollPeriodOpen } = require('./hrPayrollPeriod');
const { normalizeProfessionKey, staffProfessionKeys } = require('./professions');

const CONDITION_RULE_VERSION = 'hr-pay-conditions-v2';
function conditionError(code, message, statusCode = 400, details = undefined) {
    return Object.assign(new Error(message), { code, statusCode, status: statusCode, details });
}
function exceptionKey(staffId, professionKey, date, purpose) {
    return `${Number(staffId)}:${professionKey}:${date}:${purpose}`;
}
function mapException(row) {
    return { id: Number(row.id), staffId: Number(row.staff_id), professionKey: row.profession_key,
        workDate: normalizeAttendanceWriteDate(row.work_date), purpose: row.purpose, version: Number(row.version),
        state: row.state, rate: row.rate === null ? null : Number(row.rate), rateUnit: row.rate_unit,
        reason: row.reason, createdBy: row.created_by, createdAt: row.created_at };
}
async function loadPayrollConditionContext(db, staffIds, range) {
    // Lazy import keeps attendance -> conditions -> payroll from initializing a circular module.
    const payroll = require('./payroll');
    const ids = [...new Set(staffIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    const from = normalizeAttendanceWriteDate(range.from);
    const to = normalizeAttendanceWriteDate(range.to);
    const staffRows = await db.query('SELECT * FROM staff WHERE id = ANY($1::int[])', [ids]);
    const profiles = await payroll.loadPayrollProfileContext(ids, { from, to }, db);
    if (profiles.enabled === false) throw conditionError('PAYROLL_CONDITIONS_UNAVAILABLE', 'Не вдалося завантажити зарплатні профілі', 503);
    const rates = await payroll.loadProfessionRateMap(ids, db);
    const result = await db.query(
        `SELECT DISTINCT ON (staff_id, profession_key, work_date, purpose) *
         FROM payroll_day_exceptions WHERE staff_id = ANY($1::int[]) AND work_date BETWEEN $2::date AND $3::date
         ORDER BY staff_id, profession_key, work_date, purpose, version DESC`, [ids, from, to]);
    const exceptions = new Map();
    for (const row of result.rows) {
        const item = mapException(row);
        exceptions.set(exceptionKey(item.staffId, item.professionKey, item.workDate, item.purpose), item);
    }
    const schemes = await db.query('SELECT * FROM payroll_schemes WHERE staff_id = ANY($1::int[]) ORDER BY effective_from NULLS FIRST, id', [ids]);
    const assignments = await db.query(
        'SELECT staff_id, profession_key, status, admission_status FROM staff_role_assignments WHERE staff_id = ANY($1::int[])', [ids]);
    const policies = await db.query("SELECT * FROM hr_compensation_policies WHERE status = 'active'");
    return { policies: policies.rows, from, to, staff: new Map(staffRows.rows.map(row => [Number(row.id), row])), profiles, rates, exceptions,
        schemes: schemes.rows, assignments: new Map(assignments.rows.map(row => [`${row.staff_id}:${row.profession_key}`, row])) };
}
function schemeOnDate(context, staffId, date) {
    const candidates = context.schemes.filter(row => Number(row.staff_id) === Number(staffId)
        && (!row.effective_from || normalizeAttendanceWriteDate(row.effective_from) <= date)
        && (!row.effective_to || normalizeAttendanceWriteDate(row.effective_to) >= date));
    const row = candidates[candidates.length - 1];
    return row ? { ...row, schemeType: row.scheme_type, config: row.config_json || row.config || {} } : null;
}
function resolvePayrollConditions(context, staffId, professionKey, date, purpose = 'base_replacement', options = {}) {
    const staff = context.staff.get(Number(staffId));
    if (!staff) throw conditionError('PAYROLL_CONDITIONS_STAFF_NOT_FOUND', 'Працівника не знайдено', 404);
    date = normalizeAttendanceWriteDate(date);
    professionKey = normalizeProfessionKey(professionKey);
    const additional = purpose === 'additional';
    const scheme = additional ? null : schemeOnDate(context, staffId, date);
    const schemeUnit = { hourly: 'hour', per_shift: 'day', monthly_fixed: 'month' }[scheme?.schemeType];
    // Additional roles never inherit the employee's base wage or base scheme.
    const effectiveStaff = additional ? { ...staff, hourly_rate: 0, hourlyRate: 0, rate_unit: 'hour', rateUnit: 'hour' } : staff;
    const base = require('./payroll').resolveEffectivePayrollProfile(effectiveStaff, professionKey, date, {
        payrollProfileContext: context.profiles, professionRateMap: context.rates, scheme,
        preferredRateUnit: additional ? 'hour' : schemeUnit || staff.rate_unit || 'hour'
    });
    const exception = options.ignoreException ? null : context.exceptions.get(exceptionKey(staffId, professionKey, date, purpose));
    const result = exception?.state === 'active' ? { ...base, applies: true, rate: exception.rate,
        rateUnit: exception.rateUnit, source: 'payroll_day_exception', rateSource: 'payroll_day_exception',
        sourceOrder: 'day_exception', appliedRule: 'day_exception', exception } : { ...base, exception: null };
    const config = typeof scheme?.config === 'string' ? JSON.parse(scheme.config) : scheme?.config || {};
    // The monthly norm is frozen too; future edits cannot change the denominator.
    result.monthlyNorm = { monthlyNormMinutes: Number(config.monthlyNormMinutes ?? config.monthly_norm_minutes ?? 0),
        monthlyNormConfirmed: (config.monthlyNormConfirmed ?? config.monthly_norm_confirmed) === true,
        monthlyNormSource: config.monthlyNormSource ?? config.monthly_norm_source ?? null,
        monthlyNormMonth: config.monthlyNormMonth ?? config.monthly_norm_month ?? null };
    if (additional && result.rateUnit === 'month') {
        const baseScheme = schemeOnDate(context, staffId, date);
        const norm = typeof baseScheme?.config === 'string' ? JSON.parse(baseScheme.config) : baseScheme?.config || {};
        result.monthlyNorm = { monthlyNormMinutes: Number(norm.monthlyNormMinutes ?? norm.monthly_norm_minutes ?? 0),
            monthlyNormConfirmed: (norm.monthlyNormConfirmed ?? norm.monthly_norm_confirmed) === true,
            monthlyNormSource: norm.monthlyNormSource ?? norm.monthly_norm_source ?? null,
            monthlyNormMonth: norm.monthlyNormMonth ?? norm.monthly_norm_month ?? null };
    }
    return { ...result, ruleVersion: CONDITION_RULE_VERSION, purpose, workDate: date, professionKey,
        schemeType: scheme?.schemeType || null };
}
function assertAdditionalAdmission(context, staffId, professionKey) {
    const staff = context.staff.get(Number(staffId));
    const assignment = context.assignments.get(`${Number(staffId)}:${professionKey}`);
    if (!staff || staff.is_active === false || assignment?.status !== 'active') {
        throw conditionError('HR_SHIFT_PAID_ROLE_NOT_ALLOWED', 'Немає активного призначення професії', 400, { blocker: assignment ? 'assignment_inactive' : 'assignment_missing' });
    }
    if (assignment.admission_status !== 'approved') {
        throw conditionError('HR_SHIFT_PAID_ROLE_NOT_ALLOWED', 'Допуск до професії не погоджено', 400, { blocker: 'admission_required' });
    }
}
function validateExceptionInput(payload) {
    const staffId = Number(payload.staffId);
    const professionKey = normalizeProfessionKey(payload.professionKey);
    const workDate = normalizeAttendanceWriteDate(payload.workDate);
    const purpose = payload.purpose;
    const expectedVersion = Number(payload.expectedVersion);
    const reason = String(payload.reason || '').trim();
    const idempotencyKey = String(payload.idempotencyKey || '').trim();
    const state = payload.state || 'active';
    const rate = state === 'voided' ? null : Math.round(Number(payload.rate) * 100) / 100;
    const rateUnit = state === 'voided' ? null : payload.rateUnit;
    if (!Number.isSafeInteger(staffId) || staffId <= 0 || !professionKey
        || !['base_replacement', 'additional'].includes(purpose) || !['active', 'voided'].includes(state)
        || (payload.expectedVersion === undefined || payload.expectedVersion === null || typeof payload.expectedVersion === 'boolean') || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
        || !reason || reason.length > 2000 || !/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey)
        || (state === 'active' && (!Number.isFinite(rate) || rate <= 0 || rate > 9999999999.99 || !['hour', 'day'].includes(rateUnit)))) {
        throw conditionError('PAYROLL_DAY_EXCEPTION_INVALID', 'Перевірте дату, професію, одиницю, додатну суму, причину та версію');
    }
    return { staffId, professionKey, workDate, purpose, expectedVersion, reason, idempotencyKey, state, rate, rateUnit };
}
async function savePayrollDayException(db, payload, actor) {
    const input = validateExceptionInput(payload);
    const username = String(actor?.username || '').trim();
    if (!username) throw conditionError('PAYROLL_DAY_EXCEPTION_ACTOR_REQUIRED', 'Не визначено автора', 403);
    const hash = createHash('sha256').update(JSON.stringify({ ...input, actor: username })).digest('hex');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await lockPayrollPeriodMutation(input.workDate.slice(0, 7), client);
        await lockAttendanceWriteTarget(client, { staffId: input.staffId, date: input.workDate });
        // Serialize idempotency across dates, then use the same staff/date lock as clock-in.
        await client.query('SELECT id FROM staff WHERE id = $1 FOR UPDATE', [input.staffId]);
        const replay = await client.query('SELECT * FROM payroll_day_exceptions WHERE staff_id = $1 AND idempotency_key = $2', [input.staffId, input.idempotencyKey]);
        if (replay.rows[0]) {
            if (replay.rows[0].request_hash !== hash) throw conditionError('PAYROLL_DAY_EXCEPTION_IDEMPOTENCY_CONFLICT', 'Ключ запиту вже використано для іншої зміни', 409);
            await client.query('COMMIT');
            return { ...mapException(replay.rows[0]), replayed: true };
        }
        await assertPayrollPeriodOpen(input.workDate.slice(0, 7), client);
        const lockedReport = await client.query(
            `SELECT pr.id FROM payroll_reports pr WHERE pr.staff_id = $1 AND pr.period_month = $2
             AND (pr.status IN ('reviewed', 'approved', 'paid') OR EXISTS (
                 SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id = pr.id
                 AND (pi.workflow_status <> 'draft' OR EXISTS (
                     SELECT 1 FROM payroll_payment_movements ppm WHERE ppm.installment_id = pi.id))))
             FOR UPDATE OF pr`, [input.staffId, input.workDate.slice(0, 7)]);
        if (lockedReport.rows.length) throw conditionError('PAYROLL_DAY_EXCEPTION_HISTORY_LOCKED', 'Нарахування вже перевірено, погоджено або оплачено', 409);
        const frozen = await client.query(`SELECT id FROM hr_time_records WHERE staff_id = $1 AND record_date = $2
            AND (compensation_snapshot IS NOT NULL OR clock_in IS NOT NULL OR clock_out IS NOT NULL OR total_worked_minutes > 0) LIMIT 1`, [input.staffId, input.workDate]);
        if (frozen.rows.length) throw conditionError('PAYROLL_DAY_EXCEPTION_FROZEN', 'Умови цієї дати вже зафіксовано у табелі', 409);
        const context = await loadPayrollConditionContext(client, [input.staffId], { from: input.workDate, to: input.workDate });
        const staff = context.staff.get(input.staffId);
        if (!staff || staff.is_active === false || (!staffProfessionKeys(staff).includes(input.professionKey) && context.assignments.get(`${input.staffId}:${input.professionKey}`)?.status !== 'active')) {
            throw conditionError('PAYROLL_DAY_EXCEPTION_PROFESSION_INVALID', 'Професія не належить активному працівнику');
        }
        const previous = context.exceptions.get(exceptionKey(input.staffId, input.professionKey, input.workDate, input.purpose));
        if ((previous?.version || 0) !== input.expectedVersion) throw conditionError('PAYROLL_DAY_EXCEPTION_VERSION_CONFLICT', 'Умови вже змінено іншим користувачем. Оновіть форму.', 409);
        if (input.state === 'active') {
            if (input.purpose === 'additional' && input.professionKey !== staff.role_type) assertAdditionalAdmission(context, input.staffId, input.professionKey);
            const original = resolvePayrollConditions(context, input.staffId, input.professionKey, input.workDate, input.purpose, { ignoreException: true });
            if (input.purpose === 'base_replacement' && original.rateUnit !== input.rateUnit) {
                throw conditionError('PAYROLL_DAY_EXCEPTION_UNIT_CONFLICT', 'Разова заміна бази має зберігати одиницю. Для місячної бази оберіть додаткову оплату.');
            }
            if (input.purpose === 'additional' && original.rateUnit === 'month') throw conditionError('PAYROLL_MONTHLY_ADDITIONAL_OVERRIDE_UNSUPPORTED', 'Постійний додатковий оклад не замінюється одноденною ставкою');
        }
        const result = await client.query(`INSERT INTO payroll_day_exceptions
            (staff_id, profession_key, work_date, purpose, version, state, rate, rate_unit, reason, created_by, idempotency_key, request_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [input.staffId, input.professionKey, input.workDate, input.purpose, input.expectedVersion + 1,
            input.state, input.rate, input.rateUnit, input.reason, username, input.idempotencyKey, hash]);
        await client.query('COMMIT');
        return mapException(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

module.exports = { CONDITION_RULE_VERSION, conditionError, exceptionKey, loadPayrollConditionContext,
    resolvePayrollConditions, assertAdditionalAdmission, validateExceptionInput, savePayrollDayException };
