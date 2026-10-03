'use strict';

const { CONDITION_RULE_VERSION } = require('./hrPayrollConditions');
const money = value => Math.round(value);
const positive = value => Math.max(0, Number(value) || 0);
function calculateConditionSnapshots(metrics, overtimeMultiplier) {
    const baseLines = [], additionalLines = [], overtimeLines = [], professionRateSummary = [];
    const blockingIssues = [...(metrics.payrollBlockingIssues || [])];
    const groups = new Map();
    const problem = (code, message, details = {}) => blockingIssues.push({ code, message, severity: 'error', ...details });
    for (const day of metrics.conditionDays || []) {
        const snapshot = day.snapshot;
        if (!snapshot || snapshot.schemaVersion !== 2) {
            if (day.worked || day.paidPlannedMinutes > 0) problem('PAYROLL_BASE_SNAPSHOT_REQUIRED',
                'Історична ставка не зафіксована. Потрібна перевірка джерела; актуальний довідник не замінює історію.', { date: day.date });
            continue;
        }
        if (snapshot.manualReview || snapshot.state === 'manual_review') {
            problem('PAYROLL_CONDITION_REVIEW_REQUIRED', 'Snapshot умов оплати потребує перевірки', { date: day.date });
            continue;
        }
        if (!(snapshot.compensationAllocations || []).some(row => row.allocationType === 'base') && day.worked) {
            problem('PAYROLL_BASE_SNAPSHOT_REQUIRED', 'У snapshot немає базової оплати', { date: day.date });
        }
        for (const allocation of snapshot.compensationAllocations || []) {
            const terms = allocation.conditions;
            const additional = allocation.allocationType !== 'base';
            const minutes = positive(allocation.actualMinutes);
            const overtime = additional ? 0 : positive(allocation.overtimeMinutes);
            const planned = positive(allocation.plannedMinutes) * (day.paidPlannedFactor ?? 1);
            if (!minutes && !day.worked && !planned) continue;
            if (!terms || terms.ruleVersion !== CONDITION_RULE_VERSION || !(terms.rate > 0)
                || !['hour', 'day', 'month'].includes(terms.rateUnit)) {
                problem('PAYROLL_CONDITION_SNAPSHOT_INVALID', 'Неповний snapshot умов оплати', { date: day.date, professionKey: allocation.professionKey });
                continue;
            }
            if (terms.rateUnit !== 'month' && !minutes) continue;
            const key = `${additional ? 'additional' : 'base'}:${allocation.professionKey}:${terms.rateUnit === 'month' ? day.date.slice(0, 7) : day.date}`;
            const signature = JSON.stringify([terms.rateUnit, terms.rate, terms.rateUnit === 'month' ? terms.monthlyNorm : null]);
            if (!groups.has(key)) groups.set(key, { terms, additional, professionKey: allocation.professionKey,
                date: day.date, minutes: 0, overtime: 0, plannedByDate: new Map(), signature, conflict: false, refs: [] });
            const group = groups.get(key);
            if (group.signature !== signature) {
                group.conflict = true;
                problem('PAYROLL_CONDITION_CHANGE_POLICY_REQUIRED', 'Суперечливі одиниці, ставки або норма в одному розрахунковому періоді',
                    { date: day.date, professionKey: allocation.professionKey });
            }
            group.minutes += minutes;
            group.overtime += overtime;
            group.plannedByDate.set(day.date, (group.plannedByDate.get(day.date) || 0) + planned);
            group.refs.push({ attendanceRef: day.attendanceRef, segmentRef: allocation.segmentId, roleRef: allocation.roleId, exceptionId: terms.exception?.id || null });
        }
    }
    // A profession cannot change unit silently inside a month, even across different day keys.
    const units = new Map();
    for (const group of groups.values()) {
        const key = `${group.additional}:${group.professionKey}:${group.date.slice(0, 7)}`;
        if (!units.has(key)) units.set(key, new Set());
        units.get(key).add(group.terms.rateUnit);
    }
    for (const [key, values] of units) if (values.size > 1) problem('PAYROLL_UNIT_CHANGE_IN_MONTH_UNSUPPORTED',
        'Зміна одиниці оплати всередині місяця потребує погодженого правила', { key });
    function addLine(group, quantity, rate, formula, overtime = false) {
        const terms = group.terms;
        const amount = money(quantity * rate);
        const type = overtime ? 'overtime' : group.additional ? 'simultaneous_additional' : `profession_${terms.rateUnit}`;
        const meta = { professionKey: group.professionKey, workDate: group.date, rateUnit: terms.rateUnit,
            attendanceRef: group.refs[0]?.attendanceRef, segmentRef: group.refs[0]?.segmentRef, roleRef: group.refs[0]?.roleRef,
            profileId: terms.profileId, profileVersionId: terms.profileVersionId, profileTitle: terms.profileTitle,
            exceptionId: terms.exception?.id || null, exceptionVersion: terms.exception?.version || null,
            exceptionReason: terms.exception?.reason || null, exceptionAuthor: terms.exception?.createdBy || null,
            appliedRule: terms.appliedRule, ruleVersion: terms.ruleVersion, formula, refs: group.refs };
        const item = { group: overtime ? 'overtime' : group.additional ? 'additional' : 'base', lineType: type,
            label: `${group.additional ? 'Додаткова оплата' : 'Основна оплата'}: ${group.professionKey}`,
            amount, quantity, rate, source: terms.rateSource, meta, ...meta, minutes: group.minutes,
            multiplier: 1, policyVersion: CONDITION_RULE_VERSION, rateSource: terms.rateSource };
        (overtime ? overtimeLines : group.additional ? additionalLines : baseLines).push(item);
        professionRateSummary.push({ profession: group.professionKey, profession_key: group.professionKey,
            professionKey: group.professionKey, actual_minutes: overtime ? group.overtime : group.minutes - group.overtime,
            actual_hours: group.minutes / 60, days: terms.rateUnit === 'day' ? 1 : 0, rate,
            rate_unit: terms.rateUnit, rate_source: terms.rateSource, amount, kind: group.additional ? 'simultaneous_additional' : overtime ? 'overtime' : 'base',
            work_date: group.date, profile_id: terms.profileId, profile_version_id: terms.profileVersionId,
            profile_title: terms.profileTitle, exception_id: meta.exceptionId, exception_reason: meta.exceptionReason,
            exception_author: meta.exceptionAuthor, applied_rule: terms.appliedRule, formula,
            allocation_source: 'attendance_compensation_snapshot', allocation_sources: ['attendance_compensation_snapshot'] });
    }
    for (const group of groups.values()) {
        if (group.conflict) continue;
        const terms = group.terms;
        if (terms.rateUnit === 'hour') {
            const minutes = Math.max(0, group.minutes - group.overtime);
            addLine(group, minutes / 60, terms.rate, `${minutes} / 60 × ${terms.rate}`);
            if (group.overtime) addLine(group, group.overtime / 60, terms.rate * overtimeMultiplier,
                `${group.overtime} / 60 × ${terms.rate} × ${overtimeMultiplier}`, true);
        } else if (terms.rateUnit === 'day') {
            addLine(group, 1, terms.rate, `1 вихід × ${terms.rate}`);
        } else {
            const norm = terms.monthlyNorm || {};
            const planned = [...group.plannedByDate.values()].reduce((sum, value) => sum + value, 0);
            if (!norm.monthlyNormConfirmed || !norm.monthlyNormSource || !(norm.monthlyNormMinutes > 0)
                || norm.monthlyNormMonth !== group.date.slice(0, 7) || planned > norm.monthlyNormMinutes) {
                problem('PAYROLL_MONTHLY_NORM_REQUIRED', 'Потрібна зафіксована підтверджена норма цього місяця; оплачувані хвилини не можуть її перевищувати',
                    { professionKey: group.professionKey, date: group.date });
                continue;
            }
            addLine(group, planned / norm.monthlyNormMinutes, terms.rate, `${planned} / ${norm.monthlyNormMinutes} × ${terms.rate}`);
        }
    }
    const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
    return { applies: true, baseLines, additionalLines, overtimeLines, baseAmount: sum(baseLines),
        additionalAmount: sum(additionalLines), overtimeAmount: sum(overtimeLines),
        totalAmount: sum(baseLines) + sum(additionalLines) + sum(overtimeLines), professionRateSummary,
        allocationIssues: [...(metrics.allocationIssues || []), ...blockingIssues], blockingIssues,
        reconciliation: { ...(metrics.reconciliation || {}), blockingIssues,
            warnings: [...(metrics.reconciliation?.warnings || []), ...blockingIssues] } };
}
module.exports = { calculateConditionSnapshots };
