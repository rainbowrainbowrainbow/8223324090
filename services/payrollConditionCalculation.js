'use strict';

const { CONDITION_RULE_VERSION } = require('./hrPayrollConditions');
const { calculateConfiguredRate, calculateConfiguredComponents } = require('./payrollRules');
const money = value => Math.round(value);
const positive = value => Math.max(0, Number(value) || 0);
function calculateConditionSnapshots(metrics, overtimeMultiplier) {
    const baseLines = [], additionalLines = [], overtimeLines = [], professionRateSummary = [];
    const blockingIssues = [...(metrics.payrollBlockingIssues || [])];
    const groups = new Map(), componentGroups = new Map();
    const overlapsRequestedRange = group => [...group.dates].some(date =>
        (!metrics.periodFrom || date >= metrics.periodFrom) && (!metrics.periodTo || date <= metrics.periodTo));
    const problem = (code, message, details = {}) => blockingIssues.push({ code, message, severity: 'error', ...details });
    function monthPeriod(group) {
        const month = group.date.slice(0, 7), first = month + '-01';
        const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        return { month, periodFrom: [metrics.periodFrom || first, first].sort().at(-1),
            periodTo: [metrics.periodTo || last, last].sort()[0] };
    }
    function captureBounds(group, terms) {
        const key = `${terms.profileId || ''}:${terms.profileVersionId || ''}:${terms.assignmentId || ''}`;
        const before = group.versionBounds.get(key);
        const end = [before?.effectiveTo, terms.effectiveTo].filter(Boolean).sort()[0] || null;
        group.versionBounds.set(key, { effectiveFrom: terms.effectiveFrom || before?.effectiveFrom || null, effectiveTo: end });
        const ranges = [...group.versionBounds.values()];
        group.terms = { ...group.terms,
            effectiveFrom: ranges.map(range => range.effectiveFrom).filter(Boolean).sort()[0] || null,
            effectiveTo: ranges.some(range => !range.effectiveTo) ? null : ranges.map(range => range.effectiveTo).sort().at(-1) };
    }
    for (const day of metrics.conditionDays || []) {
        if (day.configurationConflict) {
            problem('PAYROLL_RULES_FROZEN_HISTORY_CONFLICT', 'Нові правила перетинаються з раніше зафіксованими умовами. Потрібна перевірка історії.', { date: day.date });
            continue;
        }
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
            if (!minutes && !day.worked && !planned && !terms?.payRules) continue;
            if (!terms || terms.ruleVersion !== CONDITION_RULE_VERSION || !(terms.rate > 0)
                || !['hour', 'day', 'month'].includes(terms.rateUnit)) {
                problem('PAYROLL_CONDITION_SNAPSHOT_INVALID', 'Неповний snapshot умов оплати', { date: day.date, professionKey: allocation.professionKey });
                continue;
            }
            if (terms.rateUnit !== 'month' && !minutes && !terms.payRules) continue;
            const share = additional ? (allocation.payMultiplier ?? 1) : 1;
            if (share !== 1 && (share !== 0.5 || terms.rateUnit !== 'hour')) {
                problem('PAYROLL_CONDITION_SHARE_INVALID', 'Некоректна частка додаткової ставки',
                    { date: day.date, professionKey: allocation.professionKey });
                continue;
            }
            // Notes and independently calculated components cannot split the
            // base contract into artificial partial-month contracts.
            const baseRules = terms.payRules ? { schemaVersion: terms.payRules.schemaVersion,
                policy: terms.rateUnit === 'month' ? terms.payRules.monthly : terms.rateUnit === 'day' ? terms.payRules.daily : null } : null;
            const signature = JSON.stringify([terms.rateUnit, terms.rate, terms.rateUnit === 'month' && !terms.payRules ? terms.monthlyNorm : null, baseRules]);
            const key = `${additional ? 'additional' : 'base'}:${allocation.professionKey}:${terms.rateUnit === 'month' ? day.date.slice(0, 7) : day.date}${terms.rateUnit === 'month' && terms.payRules ? ':' + signature : ''}`;
            if (!groups.has(key)) groups.set(key, { terms, additional, professionKey: allocation.professionKey,
                date: day.date, minutes: 0, minutesByShare: new Map(), overtime: 0,
                plannedByDate: new Map(), paidDays: new Map(), dates: new Set(), versionBounds: new Map(), signature, conflict: false, refs: [], leaveReviewRequired: false });
            const group = groups.get(key);
            if (group.signature !== signature) {
                group.conflict = true;
                problem('PAYROLL_CONDITION_CHANGE_POLICY_REQUIRED', 'Суперечливі одиниці, ставки або норма в одному розрахунковому періоді',
                    { date: day.date, professionKey: allocation.professionKey });
            }
            group.minutes += minutes;
            group.minutesByShare.set(share, (group.minutesByShare.get(share) || 0) + minutes);
            group.overtime += overtime;
            group.plannedByDate.set(day.date, (group.plannedByDate.get(day.date) || 0) + planned);
            group.paidDays.set(day.date, day.worked ? (day.paidPlannedFactor ?? 1) : 0);
            group.dates.add(day.date);
            group.leaveReviewRequired ||= day.leaveReviewRequired === true;
            // Newer captures can carry a closed effective range while older captures
            // of the same immutable version still carry its former open end.
            if (terms.payRules) captureBounds(group, terms);
            group.refs.push({ attendanceRef: day.attendanceRef, segmentRef: allocation.segmentId, roleRef: allocation.roleId,
                exceptionId: terms.exception?.id || null, profileId: terms.profileId || null,
                profileVersionId: terms.profileVersionId || null, assignmentId: terms.assignmentId || null, workDate: day.date });
            for (const component of terms.payRules?.components || []) {
                const componentRules = { ...component };
                delete componentRules.title;
                const componentSignature = JSON.stringify(componentRules);
                const componentKey = `${additional}:${allocation.professionKey}:${day.date.slice(0, 7)}:${component.id}:${componentSignature}`;
                if (!componentGroups.has(componentKey)) componentGroups.set(componentKey, { ...group,
                    componentId: component.id, signature: componentSignature,
                    terms: { ...terms, payRules: { ...terms.payRules, components: [component] } },
                    plannedByDate: new Map(), paidDays: new Map(), dates: new Set(), versionBounds: new Map(), refs: [], profileVersions: new Set() });
                const componentGroup = componentGroups.get(componentKey);
                componentGroup.plannedByDate.set(day.date, (componentGroup.plannedByDate.get(day.date) || 0) + planned);
                componentGroup.paidDays.set(day.date, day.worked ? (day.paidPlannedFactor ?? 1) : 0);
                componentGroup.dates.add(day.date);
                componentGroup.profileVersions.add(`${terms.profileId}:${terms.profileVersionId}`);
                componentGroup.leaveReviewRequired ||= day.leaveReviewRequired === true;
                componentGroup.refs.push(group.refs.at(-1));
                // Identical components retained across base-rate versions form one
                // entitlement. A changed component creates separate reviewed terms.
                captureBounds(componentGroup, terms);
            }
        }
    }
    // A profession cannot change unit silently inside a month, even across different day keys.
    const units = new Map();
    for (const group of groups.values()) {
        if (!overlapsRequestedRange(group)) continue;
        const key = `${group.additional}:${group.professionKey}:${group.date.slice(0, 7)}`;
        if (!units.has(key)) units.set(key, new Set());
        units.get(key).add(group.terms.rateUnit);
    }
    for (const [key, values] of units) if (values.size > 1) problem('PAYROLL_UNIT_CHANGE_IN_MONTH_UNSUPPORTED',
        'Зміна одиниці оплати всередині місяця потребує погодженого правила', { key });
    function boundedTerms(group, component = false) {
        const dates = [...group.dates].sort();
        if (metrics.configuredEntitlementCoverage && (component || group.terms.rateUnit === 'month')) {
            for (let index = 1; index < dates.length; index++) {
                if ((Date.parse(dates[index]) - Date.parse(dates[index - 1])) / 86400000 !== 1) {
                    throw Object.assign(new Error('Неперервність місячних умов не підтверджена. Потрібна окрема перевірка інтервалів.'), { code: 'PAYROLL_RULES_PERIOD_GAP_REVIEW' });
                }
            }
        }
        if (component && metrics.configuredEntitlementCoverage) {
            const period = monthPeriod(group);
            return { ...group.terms,
                effectiveFrom: dates[0] > period.periodFrom
                    ? [group.terms.effectiveFrom, dates[0]].filter(Boolean).sort().at(-1) : group.terms.effectiveFrom,
                effectiveTo: dates.at(-1) < period.periodTo
                    ? [group.terms.effectiveTo, dates.at(-1)].filter(Boolean).sort()[0] : group.terms.effectiveTo };
        }
        const peers = [...(component ? componentGroups : groups).values()].filter(peer => peer.additional === group.additional
            && peer.professionKey === group.professionKey && peer.date.slice(0, 7) === group.date.slice(0, 7) && peer.terms.payRules
            && (!component || peer.componentId === group.componentId));
        if (new Set(peers.map(peer => peer.signature)).size <= 1) return group.terms;
        return { ...group.terms,
            effectiveFrom: [group.terms.effectiveFrom, dates[0]].filter(Boolean).sort().at(-1),
            effectiveTo: [group.terms.effectiveTo, dates.at(-1)].filter(Boolean).sort()[0] };
    }
    function addLine(group, quantity, rate, formula, overtime = false, share = 1, configured = null) {
        const terms = group.terms;
        const amount = configured ? configured.amount : money(quantity * rate * share);
        const type = overtime ? 'overtime' : group.additional ? 'simultaneous_additional' : `profession_${terms.rateUnit}`;
        const meta = { professionKey: group.professionKey, workDate: group.date, rateUnit: terms.rateUnit,
            attendanceRef: group.refs[0]?.attendanceRef, segmentRef: group.refs[0]?.segmentRef, roleRef: group.refs[0]?.roleRef,
            profileId: terms.profileId, profileVersionId: terms.profileVersionId, profileTitle: terms.profileTitle,
            exceptionId: terms.exception?.id || null, exceptionVersion: terms.exception?.version || null,
            exceptionReason: terms.exception?.reason || null, exceptionAuthor: terms.exception?.createdBy || null,
            appliedRule: terms.appliedRule, ruleVersion: terms.ruleVersion, formula, refs: group.refs,
            ...(terms.payRules ? { payRules: terms.payRules } : {}),
            ...(group.additional && terms.rateUnit === 'hour' ? { rateShares: [...group.minutesByShare].map(([share, minutes]) => ({ share, minutes })) } : {}) };
        const item = { group: overtime ? 'overtime' : group.additional ? 'additional' : 'base', lineType: type,
            label: `${group.additional ? 'Додаткова оплата' : 'Основна оплата'}: ${group.professionKey}`,
            amount, quantity, rate, source: terms.rateSource, meta, ...meta, minutes: group.minutes,
            multiplier: share, policyVersion: CONDITION_RULE_VERSION, rateSource: terms.rateSource };
        (overtime ? overtimeLines : group.additional ? additionalLines : baseLines).push(item);
        professionRateSummary.push({ profession: group.professionKey, profession_key: group.professionKey,
            professionKey: group.professionKey, actual_minutes: overtime ? group.overtime : group.minutes - group.overtime,
            actual_hours: group.minutes / 60, days: terms.rateUnit === 'day' ? 1 : 0, rate,
            rate_unit: terms.rateUnit, rate_source: terms.rateSource, amount, multiplier: share,
            kind: group.additional ? 'simultaneous_additional' : overtime ? 'overtime' : 'base',
            work_date: group.date, profile_id: terms.profileId, profile_version_id: terms.profileVersionId,
            profile_title: terms.profileTitle, exception_id: meta.exceptionId, exception_reason: meta.exceptionReason,
            exception_author: meta.exceptionAuthor, applied_rule: terms.appliedRule, formula,
            allocation_source: 'attendance_compensation_snapshot', allocation_sources: ['attendance_compensation_snapshot'] });
    }
    for (const group of groups.values()) {
        if (group.conflict || !overlapsRequestedRange(group)) continue;
        const terms = group.terms;
        if (terms.payRules) {
            try {
                const context = { ...monthPeriod(group),
                    actualMinutes: group.minutes, overtimeMinutes: group.overtime,
                    paidPlannedMinutes: [...group.plannedByDate.values()].reduce((sum, value) => sum + value, 0),
                    paidDays: [...group.paidDays.values()].reduce((sum, value) => sum + value, 0),
                    hireDate: metrics.hireDate, terminationDate: metrics.terminationDate, leaveReviewRequired: group.leaveReviewRequired };
                const result = calculateConfiguredRate(boundedTerms(group), context);
                for (const issue of result.blockingIssues) problem(issue.code, issue.message, { professionKey: group.professionKey, date: group.date });
                if (!result.blockingIssues.length) {
                    const share = group.additional && terms.rateUnit === 'hour'
                        ? [...group.minutesByShare].reduce((sum, [factor, value]) => sum + value * factor, 0) / (group.minutes || 1) : 1;
                    addLine(group, result.quantity || 0, terms.rate, result.formula, false, share,
                        { amount: money(result.amount * share) });
                    if (result.overtimeAmount) addLine(group, 1, result.overtimeAmount,
                        `Понаднормова оплата: ${result.overtimeAmount}`, true, 1, { amount: result.overtimeAmount });
                }
            } catch (error) { problem(error.code || 'PAYROLL_RULES_INVALID', error.message, { professionKey: group.professionKey, date: group.date }); }
            continue;
        }
        if (terms.rateUnit === 'hour') {
            const minutes = Math.max(0, group.minutes - group.overtime);
            if (group.additional && group.minutesByShare.size > 1) {
                const weightedMinutes = [...group.minutesByShare].reduce((sum, [share, value]) => sum + value * share, 0);
                const shares = [...group.minutesByShare].map(([share, value]) => `${value} × ${share}`).join(' + ');
                addLine(group, weightedMinutes / 60, terms.rate, `(${shares}) / 60 × ${terms.rate}`);
            } else {
                const share = group.additional ? group.minutesByShare.keys().next().value : 1;
                addLine(group, minutes / 60, terms.rate, `${minutes} / 60 × ${terms.rate}${share === 1 ? '' : ` × ${share}`}`, false, share);
            }
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
    for (const group of componentGroups.values()) {
        if (!overlapsRequestedRange(group)) continue;
        try {
            const result = calculateConfiguredComponents(boundedTerms(group, true), {
                ...monthPeriod(group),
                paidPlannedMinutes: [...group.plannedByDate.values()].reduce((sum, value) => sum + value, 0),
                paidDays: [...group.paidDays.values()].reduce((sum, value) => sum + value, 0),
                hireDate: metrics.hireDate, terminationDate: metrics.terminationDate,
                leaveReviewRequired: group.leaveReviewRequired,
                componentInputs: metrics.componentInputsByMonth?.[group.date.slice(0, 7)] || metrics.componentInputs
            });
            for (const issue of result.blockingIssues) problem(issue.code, issue.message, { ...issue, professionKey: group.professionKey });
            for (const component of result.lines) {
                additionalLines.push({ group: 'additional', lineType: component.kind === 'percent' ? 'configured_commission' : 'configured_monthly_component',
                    label: component.label, amount: component.amount, quantity: component.quantity, rate: component.rate,
                    source: component.source, formula: component.formula, componentId: component.componentId,
                    meta: { ...component, professionKey: group.professionKey, profileId: group.terms.profileId,
                        profileVersionId: group.terms.profileVersionId, profileVersions: [...group.profileVersions],
                        refs: group.refs, ruleVersion: group.terms.ruleVersion } });
            }
        } catch (error) { problem(error.code || 'PAYROLL_RULES_INVALID', error.message, { professionKey: group.professionKey }); }
    }
    const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
    return { applies: true, configuredRules: [...groups.values()].some(group => Boolean(group.terms.payRules)),
        baseLines, additionalLines, overtimeLines, baseAmount: sum(baseLines),
        additionalAmount: sum(additionalLines), overtimeAmount: sum(overtimeLines),
        totalAmount: sum(baseLines) + sum(additionalLines) + sum(overtimeLines), professionRateSummary,
        allocationIssues: [...(metrics.allocationIssues || []), ...blockingIssues], blockingIssues,
        reconciliation: { ...(metrics.reconciliation || {}), blockingIssues,
            warnings: [...(metrics.reconciliation?.warnings || []), ...blockingIssues] } };
}
module.exports = { calculateConditionSnapshots };
