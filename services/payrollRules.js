'use strict';

const { createHash } = require('node:crypto');

// Pure, versioned rules shared by profile simulation and canonical payroll.
// Absence of rules is intentionally different from selecting a new policy.
const RULES_SCHEMA_VERSION = 1;
const MONTH_MODES = new Set(['fixed', 'norm_minutes', 'norm_days']);
const DAY_MODES = new Set(['per_exit', 'proportional']);
const MAX_AMOUNT = 9999999999.99;
const COMMISSION_BASIS_KEYS = new Set(['own_orders', 'own_banquets', 'other_manager_banquets',
    'own_bookings', 'other_bookings', 'manual']);
const CONDITION_REVIEW_KEYS = ['rate', 'daily_norm', 'monthly_norm', 'commission'];
const CONDITION_STATES = new Set(['unknown', 'temporary', 'confirmed']);

function ruleError(field, message, code = 'PAYROLL_RULES_INVALID') {
    return Object.assign(new Error(message), { code, statusCode: 400, details: { field } });
}
function object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw ruleError(field, 'Очікується набір налаштувань оплати');
    return value;
}
function choice(value, allowed, field, fallback) {
    const result = value ?? fallback;
    if (!allowed.has(result)) throw ruleError(field, 'Оберіть підтримуване правило оплати');
    return result;
}
function number(value, field, { positive = false, max = MAX_AMOUNT } = {}) {
    if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') {
        throw ruleError(field, 'Вкажіть числове значення');
    }
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || (positive && result === 0) || result > max) {
        throw ruleError(field, 'Значення поза допустимими межами');
    }
    return result;
}
function text(value, field, max = 200) {
    const result = String(value ?? '').trim();
    if (!result || result.length > max) throw ruleError(field, 'Вкажіть коротке пояснення');
    return result;
}
function date(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw ruleError(field, 'Вкажіть коректну дату');
    const parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw ruleError(field, 'Вкажіть коректну дату');
    return value;
}
function monthlyPolicy(value, field) {
    const source = object(value, field);
    const mode = choice(source.mode, MONTH_MODES, field + '.mode', 'fixed');
    const partialMonth = choice(source.partialMonth, new Set(['review', 'calendar_days']), field + '.partialMonth', 'review');
    if (mode === 'fixed') return { mode, partialMonth };
    const norm = object(source.norm, field + '.norm');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(norm.month || '')) throw ruleError(field + '.norm.month', 'Вкажіть місяць норми');
    return { mode, partialMonth, norm: {
        month: norm.month,
        value: number(norm.value, field + '.norm.value', { positive: true, max: mode === 'norm_days' ? 31 : 44640 }),
        confirmed: norm.confirmed === true,
        source: text(norm.source, field + '.norm.source')
    } };
}
function normalizeWeekdayMinutes(value) {
    const field = 'payRules.daily.fullDayMinutesByWeekday';
    if (!Array.isArray(value) || value.length > 7) throw ruleError(field, 'Вкажіть до семи денних норм');
    const seen = new Set();
    return value.map(entry => {
        object(entry, field);
        if (![entry.isoWeekday, entry.minutes].every(value => typeof value === 'number' || typeof value === 'string')) {
            throw ruleError(field, 'Вкажіть день тижня та тривалість у цілих хвилинах');
        }
        const isoWeekday = number(entry.isoWeekday, field, { positive: true, max: 7 });
        const minutes = number(entry.minutes, field, { positive: true, max: 1440 });
        if (!Number.isInteger(isoWeekday) || seen.has(isoWeekday) || !Number.isInteger(minutes)) {
            throw ruleError(field, 'Дні мають бути унікальні, норма — у цілих хвилинах');
        }
        seen.add(isoWeekday);
        return { isoWeekday, minutes };
    }).sort((a, b) => a.isoWeekday - b.isoWeekday);
}

function preserveDailyNormOverrides(rules, previous, rateUnit) {
    if (rateUnit !== 'day' || rules?.daily?.mode !== 'proportional'
        || Object.hasOwn(rules.daily, 'fullDayMinutesByWeekday') || !previous?.daily?.fullDayMinutesByWeekday) return rules;
    return { ...rules, daily: { ...rules.daily, fullDayMinutesByWeekday: previous.daily.fullDayMinutesByWeekday } };
}

function resolveDailyNorm(rules, rateUnit, workDate) {
    const daily = rules?.daily;
    if (rateUnit !== 'day' || daily?.mode !== 'proportional') return null;
    const overrides = daily.fullDayMinutesByWeekday;
    const weekday = overrides?.length ? new Date(date(workDate, 'workDate') + 'T00:00:00Z').getUTCDay() || 7 : null;
    const override = overrides?.find(entry => entry.isoWeekday === weekday);
    return override ? { minutes: override.minutes, source: 'weekday', isoWeekday: weekday }
        : { minutes: daily.fullDayMinutes, source: 'default' };
}

function normalizeConditionReview(value, field = 'conditionReview') {
    const source = object(value, field);
    const result = {
        state: choice(source.state, CONDITION_STATES, field + '.state'),
        source: text(source.source, field + '.source'),
        reason: text(source.reason, field + '.reason', 1000)
    };
    if (source.author && source.decidedAt && source.valueFingerprint) {
        result.author = text(source.author, field + '.author', 100);
        result.decidedAt = text(source.decidedAt, field + '.decidedAt', 32);
        result.valueFingerprint = text(source.valueFingerprint, field + '.valueFingerprint', 64);
    }
    return result;
}

// A copied or omitted review carries forward only while its underlying value matches.
function bindConditionReviews(terms, previousRules, author) {
    const rules = terms.payRules;
    if (!rules) return;
    const trackedValues = {
        rate: [terms.rateUnit, terms.defaultRate, terms.salaryFrom ?? null, terms.salaryTo ?? null, terms.dayRates],
        daily_norm: rules.daily?.mode === 'proportional'
            ? [rules.daily.fullDayMinutes, rules.daily.fullDayMinutesByWeekday || []] : null,
        monthly_norm: rules.monthly?.norm || null,
        commission: rules.components.filter(component => component.kind === 'percent')
            .map(({ id, percent, basisKey }) => ({ id, percent, basisKey }))
    };
    const requested = rules.conditionReviews || {};
    const previous = previousRules?.conditionReviews || {};
    const reviews = {};
    for (const key of CONDITION_REVIEW_KEYS) {
        const review = Object.hasOwn(requested, key) ? requested[key] : previous[key];
        if (!review || trackedValues[key] === null) continue;
        const valueFingerprint = createHash('sha256').update(JSON.stringify(trackedValues[key])).digest('hex');
        if (review.valueFingerprint && review.valueFingerprint !== valueFingerprint) continue;
        if (previous[key]?.valueFingerprint === valueFingerprint && review.valueFingerprint === valueFingerprint
            && review.state === previous[key].state && review.source === previous[key].source && review.reason === previous[key].reason) {
            reviews[key] = previous[key];
        } else {
            const { state, source, reason } = review;
            reviews[key] = { state, source, reason, author, decidedAt: new Date().toISOString(), valueFingerprint };
        }
    }
    if (Object.keys(reviews).length) rules.conditionReviews = reviews;
    else delete rules.conditionReviews;
}

function conditionAssumptions(rules) {
    return Object.entries(rules?.conditionReviews || {}).flatMap(([condition, review]) =>
        review?.state && review.state !== 'confirmed' ? [{ condition, ...review }] : []);
}

function normalizePayRules(value, rateUnit) {
    if (value === undefined || value === null) return null;
    const source = object(value, 'payRules');
    if (source.schemaVersion !== RULES_SCHEMA_VERSION) throw ruleError('payRules.schemaVersion', 'Непідтримувана версія правил');
    if (!['hour', 'day', 'month'].includes(rateUnit)) throw ruleError('rateUnit', 'Невідома одиниця оплати');
    if (rateUnit !== 'month' && source.monthly != null) throw ruleError('payRules.monthly', 'Місячне правило потребує місячної одиниці');
    if (rateUnit !== 'day' && source.daily != null) throw ruleError('payRules.daily', 'Денне правило потребує денної одиниці');
    const result = { schemaVersion: RULES_SCHEMA_VERSION };
    if (rateUnit === 'month') result.monthly = monthlyPolicy(source.monthly, 'payRules.monthly');
    if (rateUnit === 'day') {
        const daily = object(source.daily, 'payRules.daily');
        const mode = choice(daily.mode, DAY_MODES, 'payRules.daily.mode', 'per_exit');
        result.daily = { mode };
        if (mode === 'proportional') {
            result.daily.fullDayMinutes = number(daily.fullDayMinutes, 'payRules.daily.fullDayMinutes', { positive: true, max: 1440 });
            if (Object.hasOwn(daily, 'fullDayMinutesByWeekday')) {
                result.daily.fullDayMinutesByWeekday = normalizeWeekdayMinutes(daily.fullDayMinutesByWeekday);
            }
            result.daily.timeBasis = choice(daily.timeBasis, new Set(['actual', 'paid_planned']), 'payRules.daily.timeBasis', 'actual');
            result.daily.overtime = choice(daily.overtime, new Set(['cap', 'hourly_150']), 'payRules.daily.overtime', 'cap');
        }
    }
    const components = source.components ?? [];
    if (!Array.isArray(components) || components.length > 12) throw ruleError('payRules.components', 'Дозволено до 12 компонентів');
    const ids = new Set();
    result.components = components.map((component, index) => {
        object(component, 'components.' + index);
        const id = text(component.id, 'components.' + index + '.id', 64);
        if (!/^[a-z][a-z0-9_]*$/.test(id) || ids.has(id)) throw ruleError('components.' + index + '.id', 'Код компонента має бути унікальним');
        ids.add(id);
        const title = text(component.title, 'components.' + index + '.title', 120);
        const kind = choice(component.kind, new Set(['monthly', 'percent']), 'components.' + index + '.kind');
        if (kind === 'monthly') return { id, title, kind,
            amount: number(component.amount, 'components.' + index + '.amount', { positive: true }),
            monthly: monthlyPolicy(component.monthly, 'components.' + index + '.monthly') };
        return { id, title, kind,
            percent: number(component.percent, 'components.' + index + '.percent', { positive: true, max: 100 }),
            basisKey: choice(component.basisKey, COMMISSION_BASIS_KEYS, 'components.' + index + '.basisKey'),
            source: 'manual_confirmed' };
    });
    const note = String(source.note ?? '').trim();
    if (note.length > 2000) throw ruleError('payRules.note', 'Примітка має містити до 2000 символів');
    result.note = note;
    if (source.conditionReviews != null) {
        const reviews = object(source.conditionReviews, 'payRules.conditionReviews');
        result.conditionReviews = Object.fromEntries(CONDITION_REVIEW_KEYS.filter(key => Object.hasOwn(reviews, key))
            .map(key => [key, reviews[key] === null ? null : normalizeConditionReview(reviews[key], 'payRules.conditionReviews.' + key)]));
    }
    return result;
}

function monthBounds(month) {
    const first = date(month + '-01', 'month');
    return { first, last: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10) };
}
const roundAmount = value => Math.round(value);
function calendarPortion(amount, from, to, month) {
    const { first, last } = monthBounds(month);
    if (to < first || from > last || to < from) return 0;
    const start = Math.max(1, Number((from > first ? from : first).slice(8, 10)));
    const end = Math.min(Number(last.slice(8, 10)), Number((to < last ? to : last).slice(8, 10)));
    // Cumulative rounding guarantees adjacent ranges add back to the month amount.
    const days = Number(last.slice(8, 10));
    return roundAmount(amount * end / days) - roundAmount(amount * (start - 1) / days);
}
function calculateMonthlyRule(amount, policy, context) {
    const month = context.month || context.periodFrom?.slice(0, 7) || context.date?.slice(0, 7);
    const bounds = monthBounds(month || '');
    const periodFrom = date(context.periodFrom || bounds.first, 'periodFrom');
    const periodTo = date(context.periodTo || bounds.last, 'periodTo');
    if (periodFrom > periodTo || periodFrom.slice(0, 7) !== month || periodTo.slice(0, 7) !== month) {
        throw ruleError('period', 'Місячне правило потребує одного розрахункового місяця');
    }
    const starts = [bounds.first, context.effectiveFrom, context.hireDate].filter(Boolean);
    // The existing staff contract treats termination_date as the first day no
    // longer employed (employmentOverlapsPayrollRange uses termination > from).
    const terminationExclusive = context.terminationDate ? date(context.terminationDate, 'terminationDate') : null;
    const terminationInclusive = terminationExclusive ? new Date(Date.parse(terminationExclusive + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) : null;
    const ends = [bounds.last, context.effectiveTo, terminationInclusive].filter(Boolean);
    starts.forEach(value => date(value, 'effectiveFrom'));
    ends.forEach(value => date(value, 'effectiveTo'));
    const activeFrom = starts.sort().at(-1), activeTo = ends.sort()[0];
    if (activeFrom > activeTo || activeFrom > periodTo || activeTo < periodFrom) return { amount: 0, quantity: 0, formula: '0', blockingIssues: [] };
    if (policy.mode === 'fixed') {
        const blockingIssues = [], monthlyReviews = [];
        const review = (kind, decision, code, message) => {
            const result = context.monthlyReview?.({ kind, decision, month, from: activeFrom, to: activeTo });
            if (result?.approval) monthlyReviews.push(result.approval);
            else blockingIssues.push({ code, message, ...(result ? { monthlyReview: result.request } : {}) });
        };
        if (context.leaveReviewRequired && (!context.leaveDates || context.leaveDates.some(day => day >= activeFrom && day <= activeTo))) {
            review('leave', 'retain_calendar_amount',
                'PAYROLL_FIXED_LEAVE_REVIEW_REQUIRED', 'Погодьте вплив відсутності на фіксовану оплату');
        }
        if ((activeFrom > bounds.first || activeTo < bounds.last) && policy.partialMonth === 'review') review('partial_month', 'calendar_days',
            'PAYROLL_FIXED_PARTIAL_MONTH_REVIEW_REQUIRED', 'Погодьте календарну частку неповного місяця дії умов');
        if (blockingIssues.length) return { amount: 0, blockingIssues };
        const from = [activeFrom, periodFrom].sort().at(-1), to = [activeTo, periodTo].sort()[0];
        const allocated = calendarPortion(amount, from, to, month);
        return { amount: allocated, quantity: (Number(to.slice(8)) - Number(from.slice(8)) + 1) / Number(bounds.last.slice(8)),
            formula: from === bounds.first && to === bounds.last ? `1 місяць × ${amount}` : `${from} — ${to}: календарна частка ${amount}`,
            blockingIssues: [], ...(monthlyReviews.length ? { monthlyReviews } : {}) };
    }
    const norm = policy.norm;
    if (!norm?.confirmed || norm.month !== month) return { amount: 0, blockingIssues: [{ code: 'PAYROLL_MONTHLY_NORM_REQUIRED', message: 'Потрібна підтверджена норма цього місяця' }] };
    const raw = policy.mode === 'norm_days' ? context.paidDays : context.paidPlannedMinutes;
    if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > norm.value) {
        return { amount: 0, blockingIssues: [{ code: 'PAYROLL_MONTHLY_NORM_INVALID', message: 'Перевірте оплачуваний час або дні та місячну норму' }] };
    }
    const quantity = Number(raw) / norm.value;
    return { amount: roundAmount(amount * quantity), quantity, formula: `${raw} / ${norm.value} × ${amount}`, blockingIssues: [] };
}

function calculateConfiguredRate(terms, context = {}) {
    const rules = normalizePayRules(terms.payRules, terms.rateUnit);
    if (!rules) return null; // The caller must keep the existing legacy path.
    const rate = number(terms.rate, 'rate', { positive: true });
    if (terms.rateUnit === 'month') return calculateMonthlyRule(rate, rules.monthly, { ...terms, ...context });
    const actual = number(context.actualMinutes ?? 0, 'actualMinutes', { max: 44640 });
    if (terms.rateUnit === 'hour') {
        const overtime = Math.min(actual, number(context.overtimeMinutes ?? 0, 'overtimeMinutes', { max: 44640 }));
        return { amount: roundAmount((actual - overtime) / 60 * rate), overtimeAmount: roundAmount(overtime / 60 * rate * 1.5),
            quantity: (actual - overtime) / 60, formula: `${actual - overtime} / 60 × ${rate}`, blockingIssues: [] };
    }
    if (!actual && rules.daily.timeBasis !== 'paid_planned') return { amount: 0, quantity: 0, formula: '0 виходів', blockingIssues: [] };
    if (rules.daily.mode === 'per_exit') return { amount: roundAmount(rate), quantity: 1, formula: `1 вихід × ${rate}`, blockingIssues: [] };
    const paidMinutes = rules.daily.timeBasis === 'actual' ? actual : number(context.paidPlannedMinutes ?? 0, 'paidPlannedMinutes', { max: 44640 });
    const dailyNorm = terms.dailyNorm || resolveDailyNorm(rules, terms.rateUnit, context.workDate || terms.workDate);
    const norm = number(dailyNorm.minutes, 'dailyNorm.minutes', { positive: true, max: 1440 });
    const quantity = Math.min(paidMinutes / norm, 1);
    const overtimeMinutes = rules.daily.overtime === 'hourly_150' ? Math.max(0, paidMinutes - norm) : 0;
    return { amount: roundAmount(quantity * rate), overtimeAmount: roundAmount(overtimeMinutes / norm * rate * 1.5),
        quantity, paidMinutes, dailyNorm, formula: `${Math.min(paidMinutes, norm)} / ${norm} × ${rate}`, blockingIssues: [] };
}

function calculateConfiguredComponents(terms, context = {}) {
    const rules = normalizePayRules(terms.payRules, terms.rateUnit);
    if (!rules) return { lines: [], blockingIssues: [] };
    const lines = [], blockingIssues = [];
    for (const component of rules.components) {
        if (component.kind === 'monthly') {
            const result = calculateMonthlyRule(component.amount, component.monthly, { ...terms, ...context });
            blockingIssues.push(...result.blockingIssues.map(issue => ({ ...issue, componentId: component.id })));
            if (!result.blockingIssues.length) lines.push({ componentId: component.id, label: component.title, kind: 'monthly',
                amount: result.amount, formula: result.formula, source: 'profile_recurring_component', quantity: result.quantity, rate: component.amount,
                ...(result.monthlyReviews ? { monthlyReviews: result.monthlyReviews } : {}) });
            continue;
        }
        const input = context.componentInputs?.[component.basisKey];
        const month = context.month || context.periodFrom?.slice(0, 7);
        const validInput = input && input.confirmed === true && input.month === month
            && typeof input.amount !== 'boolean' && input.amount !== null && input.amount !== '' && input.amount !== undefined
            && Number.isFinite(Number(input.amount)) && Number(input.amount) >= 0 && Number(input.amount) <= MAX_AMOUNT
            && String(input.reason || '').trim() && String(input.author || '').trim();
        if (!validInput) {
            blockingIssues.push({ code: 'PAYROLL_COMMISSION_BASE_REQUIRED', componentId: component.id,
                basisKey: component.basisKey, message: 'Заповніть і підтвердіть ручну базу відсотка за цей місяць' });
            continue;
        }
        const monthlyAmount = roundAmount(Number(input.amount) * component.percent / 100);
        const allocation = calculateMonthlyRule(monthlyAmount, { mode: 'fixed', partialMonth: 'review' }, { ...terms, ...context });
        blockingIssues.push(...allocation.blockingIssues.map(issue => ({ ...issue, componentId: component.id })));
        if (allocation.blockingIssues.length) continue;
        lines.push({ componentId: component.id, label: component.title, kind: 'percent',
            amount: allocation.amount,
            ...(allocation.monthlyReviews ? { monthlyReviews: allocation.monthlyReviews } : {}),
            quantity: Number(input.amount), rate: component.percent, basisKey: component.basisKey,
            source: 'manual_confirmed', input: { ...input }, formula: `${input.amount} × ${component.percent}% (ручна база)` });
    }
    return { lines, blockingIssues };
}

module.exports = { RULES_SCHEMA_VERSION, COMMISSION_BASIS_KEYS, normalizePayRules, normalizeConditionReview, bindConditionReviews, preserveDailyNormOverrides,
    conditionAssumptions, resolveDailyNorm, calculateConfiguredRate, calculateConfiguredComponents, calculateMonthlyRule, calendarPortion };
