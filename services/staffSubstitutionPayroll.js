'use strict';
const c = require('./staffSubstitutionContract');

function parseSnapshot(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

async function freezeCompletion(db, row, payload, actor) {
    const input = row.input_json;
    if (payload.workConfirmed !== true) c.fail('SUBSTITUTION_WORK_CONFIRM_REQUIRED', 'Підтвердьте фактичне виконання роботи');
    const actualMinutes = input.payUnit === 'hour' ? c.integer(payload.actualMinutes, 'фактичні хвилини', 0, 1440) : null;
    if (actualMinutes !== null && actualMinutes > input.plannedMinutes) c.fail('SUBSTITUTION_EXTRA_WORK_REQUIRES_AGREEMENT', 'Додаткові години оформлюються окремим погодженим обсягом');
    const shiftUnitsMilli = input.payUnit === 'shift' ? c.decimalUnits(payload.completedShiftUnits, 3, 'виконані зміни', true) : null;
    if (shiftUnitsMilli !== null && shiftUnitsMilli > input.shiftUnitsMilli) c.fail('SUBSTITUTION_EXTRA_WORK_REQUIRES_AGREEMENT', 'Кількість виконаних змін перевищує погоджену');
    const evidence = c.text(payload.workEvidence, 'підтвердження роботи');
    const completion = { ruleVersion: c.RULE_VERSION, actualMinutes, shiftUnitsMilli, workEvidence: evidence,
        amountMinor: c.amountFor(input, row.quote_json.rate.rateMinor, actualMinutes, shiftUnitsMilli),
        currency: 'UAH', rate: row.quote_json.rate, approvedBy: c.text(actor.username, 'автор', 100), baseClaims: [] };
    if (input.payMode === 'replace_base') {
        const attendanceId = c.integer(payload.attendanceId, 'запис обліку', 1);
        if (!Array.isArray(payload.baseAllocationIndices) || !payload.baseAllocationIndices.length) {
            c.fail('SUBSTITUTION_BASE_SCOPE_REQUIRED', 'Оберіть конкретні базові сегменти обліку, оплату яких замінюють');
        }
        const result = await db.query(`SELECT * FROM hr_time_records WHERE id=$1 AND staff_id=$2 AND record_date=$3
            AND business_context=$4 FOR UPDATE`, [attendanceId,row.staff_id,input.workDate,row.business_context]);
        const record = result.rows[0];
        const snapshot = parseSnapshot(record?.compensation_snapshot);
        if (!record?.clock_out || snapshot?.schemaVersion !== 2 || snapshot.manualReview || snapshot.state === 'manual_review') {
            c.fail('SUBSTITUTION_BASE_SNAPSHOT_REQUIRED', 'Потрібен завершений і перевірений запис обліку з історичними умовами', 409);
        }
        const indices = payload.baseAllocationIndices.map(index => c.integer(index, 'індекс базового сегмента', 0, 1000));
        if (new Set(indices).size !== indices.length) c.fail('SUBSTITUTION_DUPLICATE_BASE', 'Сегмент базової оплати вказано двічі');
        const selected = indices.map(index => snapshot.compensationAllocations?.[index]);
        if (selected.some(allocation => !allocation || allocation.allocationType !== 'base' || !allocation.conditions)) {
            c.fail('SUBSTITUTION_BASE_SCOPE_REQUIRED', 'Оберіть лише базові сегменти з історичними умовами');
        }
        const coveredMinutes = selected.reduce((sum, allocation) => sum + Number(allocation.actualMinutes || 0), 0);
        const scopeMinutes = input.payUnit === 'hour' ? actualMinutes : input.plannedMinutes;
        if (!Number.isSafeInteger(scopeMinutes) || scopeMinutes <= 0 || coveredMinutes !== scopeMinutes) {
            c.fail('SUBSTITUTION_BASE_SCOPE_MISMATCH', 'Фактичний обсяг підміни має збігатися з обраними базовими сегментами', 409);
        }
        const { CONDITION_RULE_VERSION } = require('./hrPayrollConditions');
        for (const allocation of selected) {
            const terms = allocation.conditions;
            if (terms.ruleVersion !== CONDITION_RULE_VERSION || !(terms.rate > 0) || !['hour','day','month'].includes(terms.rateUnit)) {
                c.fail('SUBSTITUTION_BASE_SNAPSHOT_REQUIRED','Базова оплата не має перевірених історичних умов',409);
            }
            if (terms.rateUnit === 'month') {
                const norm = terms.monthlyNorm || {};
                if (!norm.monthlyNormConfirmed || !norm.monthlyNormSource || !(norm.monthlyNormMinutes > 0)
                    || norm.monthlyNormMonth !== input.workDate.slice(0,7) || Number(allocation.plannedMinutes) > norm.monthlyNormMinutes) {
                    c.fail('SUBSTITUTION_MONTHLY_NORM_REQUIRED','Заміна місячної оплати потребує зафіксованої підтвердженої норми цього місяця',409);
                }
            }
            // Existing per-day payroll groups every segment of one profession into one paid attendance.
            if (terms.rateUnit === 'day' && snapshot.compensationAllocations.some((other,index) =>
                other.allocationType === 'base' && other.professionKey === allocation.professionKey && Number(other.actualMinutes) > 0 && !indices.includes(index))) {
                c.fail('SUBSTITUTION_DAILY_SCOPE_REQUIRED','Оплату за вихід можна замінити лише для всіх базових сегментів цієї професії за день',409);
            }
        }
        for (const [position,index] of indices.entries()) {
            const allocation = selected[position];
            const claim = { attendanceId, allocationIndex: index, allocationFingerprint: c.fingerprint(allocation),
                recordDate: input.workDate, allocation };
            await db.query(`INSERT INTO staff_substitution_base_claims(substitution_id,attendance_id,allocation_key,amount_minor,evidence_json)
                VALUES($1,$2,$3,0,$4::jsonb)`, [row.id,attendanceId,String(index),JSON.stringify(claim)]);
            completion.baseClaims.push(claim);
        }
    }
    return completion;
}

async function loadPayrollSubstitutions(db, staffIds, from, to) {
    if (!staffIds.length) return new Map();
    // No missing-table fallback: a deployment without its governed migration must fail closed.
    const result = await db.query(`SELECT id,staff_id,work_date::text,input_json,quote_json,completion_json,state
        FROM staff_substitutions WHERE staff_id=ANY($1::int[]) AND work_date BETWEEN $2::date AND $3::date
        AND business_context='event_genix' AND state<>'cancelled' ORDER BY work_date,id`, [staffIds,from,to]);
    const map = new Map();
    for (const row of result.rows) {
        if (!map.has(Number(row.staff_id))) map.set(Number(row.staff_id), []);
        map.get(Number(row.staff_id)).push(row);
    }
    return map;
}

function applyPayrollSubstitutions(metrics, rows = []) {
    if (!rows.length) return metrics;
    const result = { ...metrics, conditionDays: (metrics.conditionDays || []).map(day => ({ ...day,
        snapshot: day.snapshot ? { ...day.snapshot, compensationAllocations: (day.snapshot.compensationAllocations || []).map(item => ({ ...item })) } : null })),
    substitutionLines: [], payrollBlockingIssues: [...(metrics.payrollBlockingIssues || [])] };
    const claims = new Set();
    const seen = new Set();
    const block = (code, message, id) => result.payrollBlockingIssues.push({ code, message, substitutionId: String(id), severity: 'error' });
    for (const row of rows) {
        const id = String(row.id);
        if (seen.has(id)) { block('SUBSTITUTION_DUPLICATE_PAY_SOURCE', 'Повторне джерело оплати підміни', id); continue; }
        seen.add(id);
        if (row.state !== 'completed') { block('SUBSTITUTION_NOT_COMPLETED', 'Підтвердьте фактичне виконання підміни перед розрахунком зарплати', id); continue; }
        const completion = row.completion_json;
        if (!completion || completion.ruleVersion !== c.RULE_VERSION || !Number.isSafeInteger(completion.amountMinor)
            || completion.amountMinor < 0 || completion.amountMinor !== c.amountFor(row.input_json, row.quote_json.rate.rateMinor, completion.actualMinutes, completion.shiftUnitsMilli)) {
            block('SUBSTITUTION_PAY_SNAPSHOT_INVALID', 'Неповний або суперечливий історичний розрахунок підміни', id); continue;
        }
        let valid = true;
        const consumed = [];
        for (const claim of completion.baseClaims || []) {
            const key = `${claim.attendanceId}:${claim.allocationIndex}`;
            const day = result.conditionDays.find(item => String(item.attendanceRef) === String(claim.attendanceId) && item.date === claim.recordDate);
            const allocation = day?.snapshot?.compensationAllocations?.[claim.allocationIndex];
            if (claims.has(key) || !allocation || c.fingerprint(allocation) !== claim.allocationFingerprint) {
                block('SUBSTITUTION_BASE_EVIDENCE_CHANGED', 'Базовий облік змінено або вже використано іншою підміною', id); valid = false; continue;
            }
            if (consumed.some(item => item.key === key)) { valid = false; block('SUBSTITUTION_DUPLICATE_BASE','Повтор базового сегмента',id); }
            consumed.push({key,day,claim,allocation});
        }
        if (row.input_json.payMode === 'replace_base' && !completion.baseClaims?.length) {
            block('SUBSTITUTION_BASE_SCOPE_REQUIRED', 'Відсутнє джерело заміни основної оплати', id); valid = false;
        }
        if (!valid) continue;
        for (const {key,day,claim,allocation} of consumed) {
            claims.add(key);
            day.snapshot.compensationAllocations[claim.allocationIndex] = { ...allocation, actualMinutes:0, plannedMinutes:0, overtimeMinutes:0, substitutionId:id };
        }
        result.substitutionLines.push({ group: 'additional', lineType: 'staff_substitution', label: `Підміна #${id}: ${row.input_json.professionKey}`,
            amount: completion.amountMinor / 100, rate: row.quote_json.rate.rateMinor / 100,
            quantity: row.input_json.payUnit === 'hour' ? completion.actualMinutes / 60 : row.input_json.payUnit === 'shift' ? completion.shiftUnitsMilli / 1000 : 1,
            source: 'staff_substitution', meta: { substitutionId: id, workDate: row.work_date, professionKey: row.input_json.professionKey,
                payUnit: row.input_json.payUnit, payMode: row.input_json.payMode, ruleVersion: completion.ruleVersion,
                originalStaffId: row.input_json.originalStaffId, originalTreatment: row.input_json.originalTreatment, baseClaims: completion.baseClaims,
                rate: row.quote_json.rate, workEvidence: completion.workEvidence, approvedBy: completion.approvedBy } });
    }
    return result;
}

module.exports = { freezeCompletion, loadPayrollSubstitutions, applyPayrollSubstitutions };
