'use strict';

const { fingerprint, kyivParts } = require('./staffSubstitutionContract');
const { CONDITION_RULE_VERSION } = require('./hrPayrollConditions');

function validMonthlyNorm(norm, month) {
    return norm?.monthlyNormConfirmed === true && Boolean(norm.monthlyNormSource)
        && Number.isSafeInteger(norm.monthlyNormMinutes) && norm.monthlyNormMinutes > 0
        && norm.monthlyNormMonth === month;
}

function fixedBaseAmountMinor(rateMinor, rateUnit, minutes, norm) {
    if (minutes === 0) return 0;
    const quantity = rateUnit === 'day' ? 1 : minutes / norm.monthlyNormMinutes;
    return Math.round(quantity * (rateMinor / 100)) * 100;
}

async function plannedFixedRetention(db, input, reference, source, revising) {
    const { rateUnit, rateMinor, monthlyNorm } = reference || {};
    const month = input.workDate.slice(0, 7);
    if (!['day', 'month'].includes(rateUnit) || !Number.isSafeInteger(rateMinor) || rateMinor <= 0
        || !Number.isSafeInteger(input.plannedMinutes) || input.plannedMinutes <= 0
        || (rateUnit === 'month' && (!validMonthlyNorm(monthlyNorm, month) || input.plannedMinutes > monthlyNorm.monthlyNormMinutes
            || !input.endsAt || kyivParts(input.endsAt).date.slice(0, 7) !== month))) return null;
    let afterMinutes = source.originalAfter?.segments?.some(segment => segment.professionKey === input.professionKey) ? 1 : 0;
    if (rateUnit === 'month') {
        const { loadHrShiftDayPlansForStaffDates } = require('./hrShiftSegments');
        const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
        const entries = Array.from({ length: days }, (_, index) => ({ staffId: input.originalStaffId,
            shiftDate: `${month}-${String(index + 1).padStart(2, '0')}` }));
        const plans = await loadHrShiftDayPlansForStaffDates(db, entries);
        const scheduled = [...plans.values()].flatMap(item => item.plan.segments)
            .filter(segment => segment.professionKey === input.professionKey)
            .reduce((sum, segment) => sum + segment.plannedMinutes, 0);
        afterMinutes = revising ? scheduled : scheduled - input.plannedMinutes;
        if (afterMinutes < 0 || afterMinutes + input.plannedMinutes > monthlyNorm.monthlyNormMinutes) return null;
    }
    const plannedBeforeMinor = fixedBaseAmountMinor(rateMinor, rateUnit, afterMinutes + input.plannedMinutes, monthlyNorm);
    const plannedAfterMinor = fixedBaseAmountMinor(rateMinor, rateUnit, afterMinutes, monthlyNorm);
    return { rateUnit, rateMinor, transferredMinutes: input.plannedMinutes, plannedBeforeMinor, plannedAfterMinor,
        estimatedMinor: plannedBeforeMinor - plannedAfterMinor,
        ...(rateUnit === 'month' ? { monthlyNorm } : {}) };
}

function settleFixedRetentions(conditionDays, rows) {
    const balances = new Map();
    const settled = new Map();
    for (const { id, workDate, professionKey, terms } of rows) {
        const { rateUnit, rateMinor, transferredMinutes, monthlyNorm } = terms;
        const month = workDate.slice(0, 7);
        const period = rateUnit === 'day' ? workDate : month;
        const key = `${period}:${professionKey}`;
        const signature = fingerprint([rateUnit, rateMinor, monthlyNorm]);
        if (!balances.has(key)) {
            let valid = true;
            let minutes = 0;
            for (const day of conditionDays) {
                if (day.date.slice(0, period.length) !== period) continue;
                for (const allocation of day.snapshot?.compensationAllocations || []) {
                    if (allocation.allocationType !== 'base' || allocation.professionKey !== professionKey) continue;
                    const paid = rateUnit === 'day' ? Number(allocation.actualMinutes || 0)
                        : Number(allocation.plannedMinutes || 0) * (day.paidPlannedFactor ?? 1);
                    if (!paid) continue;
                    const saved = allocation.conditions;
                    if (day.businessContext && day.businessContext !== 'event_genix'
                        || day.snapshot.schemaVersion !== 2 || day.snapshot.manualReview || day.snapshot.state === 'manual_review'
                        || saved?.ruleVersion !== CONDITION_RULE_VERSION || saved.rate !== rateMinor / 100
                        || saved.rateUnit !== rateUnit || rateUnit === 'month' && fingerprint(saved.monthlyNorm ?? null) !== fingerprint(monthlyNorm)) {
                        valid = false;
                    }
                    minutes += paid;
                }
            }
            balances.set(key, { valid, minutes, signature });
        }
        const balance = balances.get(key);
        const beforeMinutes = balance.minutes + transferredMinutes;
        if (!balance.valid || balance.signature !== signature || rateUnit === 'month'
            && (!validMonthlyNorm(monthlyNorm, month) || beforeMinutes > monthlyNorm.monthlyNormMinutes)) {
            settled.set(id, null);
            continue;
        }
        const ordinaryAmountMinor = fixedBaseAmountMinor(rateMinor, rateUnit, balance.minutes, monthlyNorm);
        const restoredAmountMinor = fixedBaseAmountMinor(rateMinor, rateUnit, beforeMinutes, monthlyNorm);
        settled.set(id, { amountMinor: restoredAmountMinor - ordinaryAmountMinor, ordinaryAmountMinor, restoredAmountMinor });
        balance.minutes = beforeMinutes;
    }
    return settled;
}

module.exports = { plannedFixedRetention, settleFixedRetentions };
