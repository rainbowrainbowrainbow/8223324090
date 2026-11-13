'use strict';

const { createHash } = require('node:crypto');
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { assertPayrollPeriodOpen, lockPayrollPeriodMutation } = require('./hrPayrollPeriod');

function freelanceError(code, message, status = 400) {
    return Object.assign(new Error(message), { code, status, statusCode: status });
}

function identifier(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw freelanceError('FREELANCE_INVALID_ID', 'Некоректний ідентифікатор запису');
    }
    return id;
}

function workDate(value) {
    const date = String(value ?? '').trim();
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== date) {
        throw freelanceError('FREELANCE_INVALID_DATE', 'Вкажіть коректну дату');
    }
    return date;
}

function requiredText(value, field, max = 500) {
    const text = String(value ?? '').trim();
    if (!text || text.length > max) {
        throw freelanceError('FREELANCE_INVALID_TEXT', `Заповніть поле «${field}» (до ${max} символів)`);
    }
    return text;
}

function normalizeRate(input) {
    const rateUnit = input.rateUnit;
    const rate = String(input.rate ?? '').trim().replace(',', '.');
    if (!['hour', 'fixed'].includes(rateUnit) || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(rate)
        || Number(rate) <= 0) {
        throw freelanceError('FREELANCE_INVALID_RATE', 'Вкажіть додатну погодинну ставку або фіксовану суму');
    }
    return { rateUnit, rate };
}

// The finance ledger stores whole currency units. Round once after multiplying exact minor units.
function calculateFreelanceAmount(input, minutes, { preview = false } = {}) {
    const { rateUnit, rate } = normalizeRate(input);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        throw freelanceError('FREELANCE_INVALID_MINUTES', 'Некоректний фактичний час фріланс-блоку');
    }
    const [units, fraction = ''] = rate.split('.');
    const minor = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
    const numerator = rateUnit === 'hour' ? minor * BigInt(minutes) : minor;
    const divisor = rateUnit === 'hour' ? 6000n : 100n;
    const amount = (numerator + divisor / 2n) / divisor;
    if ((amount < 1n && !preview) || amount > 2147483647n) {
        throw freelanceError('FREELANCE_AMOUNT_OUT_OF_RANGE', 'Сума за блок має бути додатною та в межах фінансового обліку');
    }
    return Number(amount);
}

async function insertFreelanceRateVersion(client, input, actor) {
    const { rateUnit, rate } = normalizeRate(input);
    const staffId = input.staffId == null ? null : identifier(input.staffId);
    const professionKey = requiredText(input.professionKey, 'Професія', 64);
    const date = workDate(input.effectiveFrom);
    if (staffId !== null) {
        const { resolveStaffProfessionAssignments } = require('./professions');
        const assignment = await resolveStaffProfessionAssignments(client, staffId, [professionKey]);
        if (!assignment.ok) throw freelanceError('FREELANCE_PROFESSION_NOT_ASSIGNED', 'Професія відсутня у картці працівника');
    }
    const result = await client.query(
        `INSERT INTO hr_freelance_rate_versions (profession_key, staff_id, rate_unit, rate, effective_from, created_by)
         SELECT key, $2, $3, $4, $5, $6 FROM hr_professions WHERE key = $1
         RETURNING id, profession_key, staff_id, rate_unit, rate, effective_from::text, created_by, created_at`,
        [professionKey, staffId, rateUnit, rate, date, requiredText(actor, 'Автор', 100)]
    );
    if (!result.rowCount) throw freelanceError('FREELANCE_PROFESSION_NOT_FOUND', 'Професію не знайдено', 404);
    return result.rows[0];
}

async function insertDefaultFreelanceTerms(client, { segmentId, staffId, professionKey, date, actor }) {
    const result = await client.query(
        `INSERT INTO hr_freelance_segment_terms (segment_id, source_version_id, rate_unit, rate, reason, created_by)
         SELECT $1, version.id, version.rate_unit, version.rate, 'Default at scheduling', $5
         FROM hr_freelance_rate_versions version
         WHERE version.profession_key = $3 AND (version.staff_id = $2 OR version.staff_id IS NULL)
           AND version.effective_from <= $4::date
         ORDER BY version.staff_id IS NOT NULL DESC, version.effective_from DESC, version.id DESC
         LIMIT 1 RETURNING *`,
        [segmentId, staffId, professionKey, date, actor || 'system']
    );
    return result.rows[0] || null;
}

async function lockFreelanceDay(client, staffId, date) {
    const { loadHrShiftDayPlan } = require('./hrShiftSegments');
    await lockPayrollPeriodMutation(date.slice(0, 7), client);
    await assertPayrollPeriodOpen(date.slice(0, 7), client);
    const loaded = await loadHrShiftDayPlan(client, { staffId, shiftDate: date }, { forUpdate: true });
    if (!loaded?.plan.segments.some(segment => segment.workMode === 'freelance')) {
        throw freelanceError('FREELANCE_DAY_NOT_FOUND', 'Фріланс-блоки на цю дату не знайдено', 404);
    }
    return loaded;
}

async function agreeFreelanceSegmentTerms(client, input, actor) {
    const staffId = identifier(input.staffId);
    const segmentId = identifier(input.segmentId);
    const date = workDate(input.date);
    const { rateUnit, rate } = normalizeRate(input);
    const { plan, shift } = await lockFreelanceDay(client, staffId, date);
    if (!plan.segments.some(segment => Number(segment.id) === segmentId && segment.workMode === 'freelance')) {
        throw freelanceError('FREELANCE_SEGMENT_NOT_FOUND', 'Фріланс-блок не знайдено', 404);
    }
    const prior = await client.query(
        'SELECT 1 FROM hr_freelance_attendance_confirmations WHERE hr_shift_id = $1',
        [shift.id]
    );
    if (prior.rowCount) {
        throw freelanceError('FREELANCE_TERMS_ALREADY_CONFIRMED', 'Умови підтвердженого виходу зафіксовані', 409);
    }
    const { rows } = await client.query(
        `INSERT INTO hr_freelance_segment_terms (segment_id, rate_unit, rate, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [segmentId, rateUnit, rate, requiredText(input.reason, 'Причина'), requiredText(actor, 'Автор', 100)]
    );
    return rows[0];
}

function normalizeAllocations(entries, segments, actualMinutes) {
    if (!Array.isArray(entries) || entries.length !== segments.length) {
        throw freelanceError('FREELANCE_ALL_BLOCKS_REQUIRED', 'Вкажіть фактичні хвилини кожного блоку');
    }
    const minutesById = new Map();
    const segmentIds = new Set(segments.map(segment => identifier(segment.id)));
    for (const entry of entries) {
        const segmentId = identifier(entry?.segmentId);
        const minutes = entry?.minutes;
        if (!segmentIds.has(segmentId) || minutesById.has(segmentId)
            || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
            throw freelanceError('FREELANCE_INVALID_ALLOCATION', 'Некоректний розподіл хвилин між блоками');
        }
        minutesById.set(segmentId, minutes);
    }
    if ([...minutesById.values()].reduce((sum, minutes) => sum + minutes, 0) !== actualMinutes) {
        throw freelanceError('FREELANCE_ALLOCATION_TOTAL_MISMATCH', 'Сума хвилин блоків має збігатися з фактичним часом дня', 409);
    }
    return minutesById;
}

function planSignature(segments = []) {
    return JSON.stringify(segments.map(segment => [
        String(segment.id), segment.workMode || 'regular', segment.professionKey,
        segment.shiftStart, segment.shiftEnd, segment.breakMinutes
    ]));
}

async function assertFreelanceDoesNotReplaceMonthlyWork(client, staffId, date, proposed, stored) {
    if (!proposed.some(segment => segment.workMode === 'freelance')) return;
    const { loadPayrollConditionContext, resolvePayrollConditions } = require('./hrPayrollConditions');
    const context = await loadPayrollConditionContext(client, [staffId], { from: date, to: date });
    const staff = context.staff.get(staffId);
    if (!staff?.role_type) return;
    const hasMonthlyTerms = [...new Set([staff.role_type, ...proposed.map(segment => segment.professionKey)])]
        .some(professionKey => resolvePayrollConditions(context, staffId, professionKey, date).rateUnit === 'month');
    if (!hasMonthlyTerms) return;

    const priorRegular = stored.filter(row => (row.work_mode || 'regular') === 'regular');
    const nextRegular = proposed.filter(segment => segment.workMode !== 'freelance');
    const { normalizeShiftTime } = require('./hrShiftSegments');
    const replacesRegular = priorRegular.some(row => {
        return !nextRegular.some(segment => segment.professionKey === row.profession_key
            && segment.shiftStart === normalizeShiftTime(row.planned_start)
            && segment.shiftEnd === normalizeShiftTime(row.planned_end)
            && segment.breakMinutes === Number(row.break_minutes || 0));
    });
    if (!replacesRegular && priorRegular.length) return;
    if (!replacesRegular && !priorRegular.length) {
        const { rows: [entry] } = await client.query(
            'SELECT status FROM staff_schedule WHERE staff_id = $1 AND date = $2::date', [staffId, date]
        );
        if (entry?.status === 'dayoff' || entry?.status === 'day_off'
            || (stored.length && !nextRegular.length)) return;
        const { attendanceDayType, timeToMinutes } = require('./hrAttendance');
        const { loadPrimaryStaffShiftPreference } = require('./professions');
        const preference = await loadPrimaryStaffShiftPreference(client, staffId, attendanceDayType(date));
        if (preference.isActive) {
            const start = timeToMinutes(preference.startTime);
            const end = timeToMinutes(preference.endTime);
            let coveredUntil = start;
            for (const block of nextRegular) {
                const blockStart = timeToMinutes(block.shiftStart);
                const blockEnd = timeToMinutes(block.shiftEnd);
                if (blockStart <= coveredUntil && blockEnd > coveredUntil) coveredUntil = blockEnd;
            }
            if (end > start && coveredUntil >= end) return;
        }
    }
    throw freelanceError('FREELANCE_MONTHLY_REPLACEMENT_UNSUPPORTED',
        'Для працівника на окладі залиште планові штатні години або додайте фріланс на позначений вихідний', 409);
}

async function confirmFreelanceAttendance(client, input, actor) {
    const staffId = identifier(input.staffId);
    const date = workDate(input.date);
    const attendanceId = identifier(input.attendanceId);
    const { plan, shift } = await lockFreelanceDay(client, staffId, date);
    const { rows: [record] } = await client.query(
        `SELECT * FROM hr_time_records WHERE id = $1 AND staff_id = $2 AND record_date = $3::date
         AND business_context = $4 FOR UPDATE`,
        [attendanceId, staffId, date, DEFAULT_BUSINESS_CONTEXT]
    );
    if (!record?.clock_out || !['present', 'late', 'unscheduled', 'auto_closed'].includes(record.status)) {
        throw freelanceError('FREELANCE_ATTENDANCE_NOT_CLOSED', 'Для підтвердження потрібен завершений фактичний вихід', 409);
    }
    const existing = await client.query(
        'SELECT attendance_id FROM hr_freelance_attendance_confirmations WHERE attendance_id = $1',
        [attendanceId]
    );
    if (existing.rowCount) {
        throw freelanceError('FREELANCE_ATTENDANCE_ALREADY_CONFIRMED', 'Розподіл часу вже підтверджено', 409);
    }
    const {
        attendancePlanFromCompensationSnapshot, attendanceTimezoneTransitionIssue, decorateAttendanceRecord
    } = require('./hrAttendance');
    const storedPlan = attendancePlanFromCompensationSnapshot(record.compensation_snapshot);
    if (storedPlan && planSignature(storedPlan.segments) !== planSignature(plan.segments)) {
        throw freelanceError('FREELANCE_ATTENDANCE_PLAN_CHANGED', 'План змінився після фіксації факту. Потрібне узгодження запису', 409);
    }
    if (attendanceTimezoneTransitionIssue(record)) {
        throw freelanceError('FREELANCE_ATTENDANCE_TIMEZONE_REVIEW', 'Факт на переході часу потребує окремої перевірки', 409);
    }
    const fact = decorateAttendanceRecord(record, { plan, shift });
    const recordedMinutes = Number(record.total_worked_minutes);
    const actualMinutes = Number.isInteger(recordedMinutes) && recordedMinutes > 0
        ? recordedMinutes : fact.actualMinutes;
    if (!Number.isInteger(actualMinutes) || actualMinutes <= 0) {
        throw freelanceError('FREELANCE_ATTENDANCE_TIME_REQUIRED', 'Підтвердьте фактичний час виходу', 409);
    }
    const minutesById = normalizeAllocations(input.allocations, plan.segments, actualMinutes);
    const terms = await client.query(
        `SELECT DISTINCT ON (segment_id) id, segment_id, rate_unit, rate
         FROM hr_freelance_segment_terms WHERE segment_id = ANY($1::bigint[])
         ORDER BY segment_id, id DESC`,
        [[...minutesById.keys()]]
    );
    const termsById = new Map(terms.rows.map(row => [Number(row.segment_id), row]));
    const blocks = plan.segments.map(segment => {
        const segmentId = Number(segment.id);
        const minutes = minutesById.get(segmentId);
        const mode = segment.workMode || 'regular';
        const payable = mode === 'freelance' && minutes > 0;
        const agreed = payable ? termsById.get(segmentId) : null;
        if (payable && !agreed) {
            throw freelanceError('FREELANCE_TERMS_REQUIRED', 'Погодьте оплату кожного відпрацьованого фріланс-блоку', 409);
        }
        return {
            segmentId, workMode: mode, minutes, termsId: agreed?.id || null,
            amount: agreed ? calculateFreelanceAmount({ rateUnit: agreed.rate_unit, rate: agreed.rate }, minutes) : 0
        };
    });
    await client.query(
        `INSERT INTO hr_freelance_attendance_confirmations (attendance_id, hr_shift_id, fact_snapshot, confirmed_by)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [attendanceId, shift.id, JSON.stringify({
            actualMinutes, allocationSource: fact.allocationSource,
            clockIn: record.clock_in, clockOut: record.clock_out
        }), requiredText(actor, 'Автор', 100)]
    );
    for (const block of blocks) {
        await client.query(
            `INSERT INTO hr_freelance_confirmed_blocks (segment_id, attendance_id, work_mode, minutes, terms_id, amount)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [block.segmentId, attendanceId, block.workMode, block.minutes, block.termsId, block.amount]
        );
    }
    return { attendanceId, blocks };
}

function attendanceHasFreelance(row) {
    return (row.segment_allocations || row.segmentAllocations || []).some(segment => segment.workMode === 'freelance')
        || row.compensation_snapshot?.plan?.segments?.some(segment => segment.workMode === 'freelance')
        || row.currentPlanHasFreelance === true;
}

async function loadConfirmedFreelanceAllocations(db, rows) {
    const ids = rows.filter(attendanceHasFreelance).map(row => Number(row.attendance_ref || row.id));
    const byAttendance = new Map();
    if (!ids.length) return byAttendance;
    const result = await db.query(
        `SELECT attendance_id, segment_id, work_mode, minutes FROM hr_freelance_confirmed_blocks
         WHERE attendance_id = ANY($1::int[]) ORDER BY attendance_id, segment_id`,
        [ids]
    );
    for (const row of result.rows) {
        const key = Number(row.attendance_id);
        if (!byAttendance.has(key)) byAttendance.set(key, new Map());
        byAttendance.get(key).set(String(row.segment_id), row);
    }
    return byAttendance;
}

async function listFreelanceSettlement(db, date) {
    const day = workDate(date);
    const { rows } = await db.query(
        `SELECT block.segment_id, block.attendance_id, fact.record_date::text AS work_date,
                fact.staff_id, staff.name AS staff_name, segment.profession_key,
                segment.planned_start::text, segment.planned_end::text, block.minutes, block.amount,
                paid.total::int AS paid, (block.amount - paid.total)::int AS outstanding,
                CASE WHEN paid.total = block.amount THEN 'paid'
                     WHEN paid.total > 0 THEN 'partially_paid' ELSE 'unpaid' END AS status,
                paid.movements
         FROM hr_freelance_confirmed_blocks block
         JOIN hr_shift_segments segment ON segment.id = block.segment_id
         JOIN hr_time_records fact ON fact.id = block.attendance_id
         JOIN staff ON staff.id = fact.staff_id
         CROSS JOIN LATERAL (
             SELECT COALESCE(SUM(CASE WHEN movement.reversal_of IS NULL THEN movement.amount ELSE -movement.amount END), 0) AS total,
                    COALESCE(jsonb_agg(jsonb_build_object(
                        'id', movement.id, 'amount', movement.amount, 'reversalOf', movement.reversal_of,
                        'date', finance.date, 'actor', movement.created_by,
                        'accountId', finance.account_id, 'paymentMethod', finance.payment_method
                    ) ORDER BY movement.id), '[]'::jsonb) AS movements
             FROM hr_freelance_payment_movements movement
             JOIN finance_transactions finance ON finance.id = movement.finance_transaction_id
             WHERE movement.segment_id = block.segment_id
         ) paid
         WHERE block.work_mode = 'freelance' AND block.amount > 0 AND fact.business_context = $2
           AND (fact.record_date = $1::date OR (fact.record_date < $1::date AND paid.total < block.amount))
         ORDER BY fact.record_date, staff.name, block.segment_id`,
        [day, DEFAULT_BUSINESS_CONTEXT]
    );
    return rows;
}

async function listFreelanceWorkDay(db, date, staffId = null) {
    const day = workDate(date);
    const { rows } = await db.query(
        `SELECT shift.id AS shift_id, shift.staff_id, staff.name AS staff_name,
                fact.id AS attendance_id, fact.clock_out, confirmation.confirmed_at,
                jsonb_agg(jsonb_build_object(
                    'id', segment.id, 'workMode', segment.work_mode, 'professionKey', segment.profession_key,
                    'shiftStart', LEFT(segment.planned_start::text, 5), 'shiftEnd', LEFT(segment.planned_end::text, 5),
                    'breakMinutes', segment.break_minutes, 'plannedMinutes',
                        (EXTRACT(EPOCH FROM (segment.planned_end - segment.planned_start)) / 60
                         + CASE WHEN segment.planned_end < segment.planned_start THEN 1440 ELSE 0 END
                         - segment.break_minutes)::int,
                    'rate', terms.rate::text, 'rateUnit', terms.rate_unit,
                    'termsId', terms.id, 'rateSource', terms.source_version_id
                ) ORDER BY segment.sort_order, segment.id) AS segments
         FROM hr_shifts shift
         JOIN staff ON staff.id = shift.staff_id
         JOIN hr_shift_segments segment ON segment.hr_shift_id = shift.id
         LEFT JOIN hr_time_records fact ON fact.staff_id = shift.staff_id AND fact.record_date = shift.shift_date
             AND fact.business_context = $2
         LEFT JOIN hr_freelance_attendance_confirmations confirmation ON confirmation.hr_shift_id = shift.id
         LEFT JOIN LATERAL (
             SELECT id, rate, rate_unit, source_version_id
             FROM hr_freelance_segment_terms WHERE segment_id = segment.id ORDER BY id DESC LIMIT 1
         ) terms ON TRUE
         WHERE shift.shift_date = $1::date AND ($3::integer IS NULL OR shift.staff_id = $3) AND EXISTS (
             SELECT 1 FROM hr_shift_segments work WHERE work.hr_shift_id = shift.id AND work.work_mode = 'freelance'
         )
         GROUP BY shift.id, staff.id, fact.id, confirmation.attendance_id
         ORDER BY staff.name, shift.id`,
        [day, DEFAULT_BUSINESS_CONTEXT, staffId == null ? null : identifier(staffId)]
    );
    for (const row of rows) {
        for (const segment of row.segments) {
            if (segment.workMode === 'freelance' && segment.rate && segment.plannedMinutes > 0) {
                try { segment.estimatedAmount = calculateFreelanceAmount(segment, segment.plannedMinutes, { preview: true }); }
                catch (error) {
                    if (error.code !== 'FREELANCE_AMOUNT_OUT_OF_RANGE') throw error;
                    segment.estimatedAmount = null;
                }
            }
        }
    }
    const attendanceIds = rows.filter(row => row.clock_out && !row.confirmed_at).map(row => row.attendance_id);
    if (!attendanceIds.length) return rows;
    const facts = await db.query('SELECT * FROM hr_time_records WHERE id = ANY($1::int[])', [attendanceIds]);
    const { hydrateAttendanceRecords } = require('./hrAttendance');
    const attendance = await hydrateAttendanceRecords(db, facts.rows);
    const byId = new Map(attendance.map(row => [row.id, row]));
    return rows.map(row => {
        const fact = byId.get(row.attendance_id);
        if (!fact) return row;
        const recorded = Number(fact.total_worked_minutes);
        const actualMinutes = Number.isInteger(recorded) && recorded > 0 ? recorded : fact.actualMinutes;
        return {
            ...row,
            actualMinutes,
            allocationSource: fact.allocationSource,
            suggestedAllocations: fact.allocationSource === 'clock_interval' && actualMinutes === fact.allocatedMinutes
                ? fact.segmentAllocations.map(item => ({ segmentId: item.segmentId, minutes: item.actualMinutes })) : []
        };
    });
}

async function listFreelanceRateOptions(db) {
    const [professions, staff, versions] = await Promise.all([
        db.query('SELECT key, title FROM hr_professions ORDER BY title, key'),
        db.query(`SELECT id, name FROM staff WHERE is_active AND NOT COALESCE(is_freelance, false)
            AND COALESCE(hr_pool_status, 'core') = 'core' ORDER BY name, id`),
        db.query(`SELECT DISTINCT ON (profession_key, staff_id)
            profession_key, staff_id, rate_unit, rate::text, effective_from::text
            FROM hr_freelance_rate_versions ORDER BY profession_key, staff_id, effective_from DESC, id DESC`)
    ]);
    return { professions: professions.rows, staff: staff.rows, versions: versions.rows };
}

async function writeFreelanceMovement(client, input, actor, reverse = false) {
    const segmentId = identifier(input.segmentId);
    const reversalOf = reverse ? identifier(input.reversalOf) : null;
    const key = requiredText(input.idempotencyKey, 'Ключ операції', 128);
    const paymentDate = workDate(input.paymentDate);
    const categoryId = identifier(input.categoryId);
    const paymentMethod = requiredText(input.paymentMethod, 'Спосіб оплати', 16);
    const accountId = identifier(input.accountId);
    const amount = reverse ? null : Number(input.amount);
    if (!['cash', 'card', 'transfer', 'mixed'].includes(paymentMethod)
        || (!reverse && (!Number.isInteger(amount) || amount <= 0 || amount > 2147483647))) {
        throw freelanceError('FREELANCE_INVALID_PAYMENT', 'Перевірте суму і спосіб оплати');
    }
    const reason = requiredText(input.reason, 'Призначення');
    const username = requiredText(actor, 'Автор', 100);
    const fingerprint = createHash('sha256')
        .update(JSON.stringify([segmentId, reversalOf, paymentDate, categoryId, accountId, paymentMethod, amount, reason]))
        .digest('hex');

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`hr-freelance-payment:${key}`]);
    const { rows: [prior] } = await client.query(
        'SELECT * FROM hr_freelance_payment_movements WHERE idempotency_key = $1', [key]
    );
    if (prior) {
        if (prior.request_hash !== fingerprint) {
            throw freelanceError('FREELANCE_PAYMENT_KEY_CONFLICT', 'Ключ уже використано для іншої операції', 409);
        }
        return { movement: prior, idempotent: true };
    }
    const { rows: [block] } = await client.query(
        `SELECT block.*, fact.record_date::text AS work_date, fact.staff_id, staff.name AS staff_name
         FROM hr_freelance_confirmed_blocks block
         JOIN hr_time_records fact ON fact.id = block.attendance_id
         JOIN staff ON staff.id = fact.staff_id
         WHERE block.segment_id = $1 AND fact.business_context = $2
           AND block.work_mode = 'freelance' AND block.amount > 0
         FOR UPDATE OF block`,
        [segmentId, DEFAULT_BUSINESS_CONTEXT]
    );
    if (!block) throw freelanceError('FREELANCE_PAYMENT_BLOCK_NOT_FOUND', 'Підтверджений фріланс-блок не знайдено', 404);
    if (paymentDate < block.work_date) {
        throw freelanceError('FREELANCE_PAYMENT_BEFORE_WORK', 'Дата виплати передує робочому дню');
    }

    let movementAmount = amount;
    if (reverse) {
        const { rows: [original] } = await client.query(
            `SELECT movement.amount, finance.date::text AS payment_date, finance.account_id, finance.payment_method
             FROM hr_freelance_payment_movements movement
             JOIN finance_transactions finance ON finance.id = movement.finance_transaction_id
             WHERE movement.id = $1 AND movement.segment_id = $2 AND movement.reversal_of IS NULL
               AND NOT EXISTS (SELECT 1 FROM hr_freelance_payment_movements WHERE reversal_of = movement.id)`,
            [reversalOf, segmentId]
        );
        if (!original || paymentDate < original.payment_date || accountId !== original.account_id
            || paymentMethod !== original.payment_method) {
            throw freelanceError('FREELANCE_REVERSAL_INVALID', 'Скасування потребує чинної виплати, її рахунку та способу оплати', 409);
        }
        movementAmount = original.amount;
    } else {
        const { rows: [balance] } = await client.query(
            `SELECT COALESCE(SUM(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END), 0)::int AS paid
             FROM hr_freelance_payment_movements WHERE segment_id = $1`,
            [segmentId]
        );
        if (movementAmount > block.amount - balance.paid) {
            throw freelanceError('FREELANCE_PAYMENT_EXCEEDS_BALANCE', 'Виплата перевищує залишок за блок', 409);
        }
    }
    const kind = reverse ? 'income' : 'expense';
    const { rows: [category] } = await client.query(
        `SELECT id FROM finance_categories WHERE id = $1 AND business_context = $2
           AND type = $3 AND is_active AND finance_qa_run_id IS NULL FOR SHARE`,
        [categoryId, DEFAULT_BUSINESS_CONTEXT, kind]
    );
    const { rows: [account] } = await client.query(
        `SELECT id, name FROM finance_accounts WHERE id = $1 AND business_context = $2
           AND is_active AND finance_qa_run_id IS NULL FOR SHARE`,
        [accountId, DEFAULT_BUSINESS_CONTEXT]
    );
    if (!category || !account) {
        throw freelanceError('FREELANCE_FINANCE_ACCOUNT_REQUIRED', 'Оберіть активну категорію і рахунок поточного бізнесу');
    }
    const { rows: [finance] } = await client.query(
        `INSERT INTO finance_transactions (
             business_context, type, category_id, amount, description, date, payment_method,
             staff_id, account_id, account_name, object_name, source, recognition_date, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'hr_freelance',$12,$13) RETURNING id`,
        [DEFAULT_BUSINESS_CONTEXT, kind, categoryId, movementAmount, reason, paymentDate, paymentMethod,
            block.staff_id, accountId, account.name, block.staff_name, block.work_date, username]
    );
    const { rows: [movement] } = await client.query(
        `INSERT INTO hr_freelance_payment_movements
             (segment_id, finance_transaction_id, amount, reversal_of, idempotency_key, request_hash, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [segmentId, finance.id, movementAmount, reversalOf, key, fingerprint, username]
    );
    return { movement, idempotent: false };
}

module.exports = {
    agreeFreelanceSegmentTerms,
    attendanceHasFreelance,
    assertFreelanceDoesNotReplaceMonthlyWork,
    calculateFreelanceAmount,
    confirmFreelanceAttendance,
    freelanceError,
    insertDefaultFreelanceTerms,
    insertFreelanceRateVersion,
    listFreelanceSettlement,
    listFreelanceRateOptions,
    listFreelanceWorkDay,
    loadConfirmedFreelanceAllocations,
    writeFreelanceMovement,
    workDate
};
