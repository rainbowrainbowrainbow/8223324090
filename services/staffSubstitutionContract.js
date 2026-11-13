'use strict';

const { createHash } = require('node:crypto');
const { normalizeAttendanceWriteDate } = require('./attendanceWriteLock');

const RULE_VERSION = 'staff-substitution-v1';
const SOURCE_TYPES = Object.freeze(['standalone', 'hr_shift', 'task', 'booking', 'afisha', 'education_lesson', 'procurement', 'lead']);

function fail(code, message, statusCode = 400, details) {
    throw Object.assign(new Error(message), { code, statusCode, details });
}

function integer(value, field, min = 0, max = 2147483647) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === ''
        || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
        fail('SUBSTITUTION_INVALID', `Некоректне поле: ${field}`);
    }
    return Number(value);
}

function text(value, field, max = 2000, required = true) {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
        fail('SUBSTITUTION_INVALID', `Заповніть поле: ${field}`);
    }
    return value.trim();
}

function choice(value, values, field) {
    if (!values.includes(value)) fail('SUBSTITUTION_INVALID', `Оберіть ${field}`);
    return value;
}

// Decimal strings are converted to minor units before arithmetic. No binary-money multiplication.
function decimalUnits(value, digits, field, allowZero = false) {
    if (!['string', 'number'].includes(typeof value)) fail('SUBSTITUTION_INVALID', `Некоректне поле: ${field}`);
    const match = String(value).match(new RegExp(`^(0|[1-9]\\d{0,7})(?:\\.(\\d{1,${digits}}))?$`));
    if (!match) fail('SUBSTITUTION_INVALID', `Некоректне поле: ${field}`);
    const units = Number(match[1]) * (10 ** digits) + Number((match[2] || '').padEnd(digits, '0'));
    if (!Number.isSafeInteger(units) || (!allowZero && units <= 0)) fail('SUBSTITUTION_INVALID', `Некоректне поле: ${field}`);
    return units;
}

function stable(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
}

function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function kyivParts(instant) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

function instant(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) fail('SUBSTITUTION_TIME_INVALID', `Укажіть ${field} з часовим поясом`);
    normalizeAttendanceWriteDate(value.slice(0, 10));
    const local = kyivParts(value);
    if (local.date !== value.slice(0, 10) || local.time !== value.slice(11, 16)) {
        fail('SUBSTITUTION_TIME_INVALID', 'Час або зміщення не відповідає Europe/Kyiv');
    }
    return new Date(value).toISOString();
}

function normalizeInput(raw = {}) {
    const sourceType = choice(raw.sourceType, SOURCE_TYPES, 'процес');
    const workDate = normalizeAttendanceWriteDate(raw.workDate);
    const staffId = integer(raw.staffId, 'працівник', 1);
    const originalStaffId = raw.originalStaffId == null || raw.originalStaffId === '' ? null : integer(raw.originalStaffId, 'кого замінюють', 1);
    if (staffId === originalStaffId) fail('SUBSTITUTION_SAME_STAFF', 'Працівник не може замінити себе');
    const professionKey = text(raw.professionKey, 'роль', 64);
    if (!/^[a-z0-9_:-]+$/.test(professionKey)) fail('SUBSTITUTION_INVALID', 'Некоректна професія');
    const payUnit = choice(raw.payUnit, ['hour', 'shift', 'fixed'], 'одиницю оплати');
    const payMode = choice(raw.payMode, ['additional', 'replace_base'], 'додаткову оплату або заміну основної');
    const originalTreatment = originalStaffId
        ? choice(raw.originalTreatment, ['retain', 'transfer_unworked_scope'], 'наслідки для заміненого працівника') : 'not_applicable';
    const startsAt = raw.startsAt ? instant(raw.startsAt, 'початок') : null;
    const endsAt = raw.endsAt ? instant(raw.endsAt, 'кінець') : null;
    if (Boolean(startsAt) !== Boolean(endsAt) || (payUnit === 'hour' && !startsAt)) fail('SUBSTITUTION_TIME_REQUIRED', 'Для погодинної оплати потрібен час початку й завершення');
    if (payMode === 'replace_base' && !startsAt) fail('SUBSTITUTION_TIME_REQUIRED', 'Для заміни основної оплати вкажіть точний час роботи, навіть за фіксованої оплати або оплати за зміну');
    const breakMinutes = integer(raw.breakMinutes ?? 0, 'перерва', 0, 1440);
    let plannedMinutes = null;
    if (startsAt) {
        if (kyivParts(startsAt).date !== workDate) fail('SUBSTITUTION_TIME_INVALID', 'Дата роботи не відповідає початку');
        const span = (Date.parse(endsAt) - Date.parse(startsAt)) / 60000;
        if (span <= 0 || span > 1440 || breakMinutes >= span) fail('SUBSTITUTION_TIME_INVALID', 'Перевірте тривалість і перерву (не більше 24 годин)');
        if (kyivParts(endsAt).date.slice(0, 7) !== workDate.slice(0, 7)) fail('SUBSTITUTION_MONTH_BOUNDARY', 'Розділіть роботу на межі зарплатних місяців');
        plannedMinutes = span - breakMinutes;
    } else if (breakMinutes) fail('SUBSTITUTION_TIME_REQUIRED', 'Перерву можна вказати лише для роботи з часом');
    const rateMode = choice(raw.rateMode, ['standard', 'individual'], 'джерело ставки');
    return { sourceType, sourceId: sourceType === 'standalone' ? text(raw.sourceId, 'ідентифікатор роботи', 100) : String(integer(raw.sourceId, 'джерело', 1)),
        slotKey: choice(raw.slotKey || 'primary', sourceType==='afisha' ? ['primary','second'] : ['primary'], 'слот'), workDate, staffId, originalStaffId,
        professionKey, payUnit, payMode, originalTreatment, startsAt, endsAt, breakMinutes, plannedMinutes,
        shiftUnitsMilli: payUnit === 'shift' ? decimalUnits(raw.shiftUnits, 3, 'кількість змін') : null,
        workload: text(raw.workload, 'обсяг роботи', 1000), reason: text(raw.reason, 'причина'),
        rateMode, rateMinor: rateMode === 'individual' ? decimalUnits(raw.rate, 2, 'ставка') : null,
        rateReason: rateMode === 'individual' ? text(raw.rateReason, 'причина індивідуальної ставки') : null,
        temporaryAdmission: raw.temporaryAdmission === true,
        admissionReason: raw.temporaryAdmission === true ? text(raw.admissionReason, 'підстава разового допуску') : null,
        allowConcurrent: raw.allowConcurrent === true,
        concurrentReason: raw.allowConcurrent === true ? text(raw.concurrentReason, 'причина суміщення') : null };
}

function amountFor(input, rateMinor, actualMinutes = input.plannedMinutes, shiftUnitsMilli = input.shiftUnitsMilli) {
    integer(rateMinor, 'ставка', 1, Number.MAX_SAFE_INTEGER);
    let numerator = 1;
    let denominator = 1;
    if (input.payUnit === 'hour') {
        numerator = integer(actualMinutes, 'хвилини', 0, 1440);
        denominator = 60;
    } else if (input.payUnit === 'shift') {
        numerator = integer(shiftUnitsMilli, 'зміни', 0, 1000000);
        denominator = 1000;
    }
    const amount = (BigInt(rateMinor) * BigInt(numerator) * 2n + BigInt(denominator)) / (2n * BigInt(denominator));
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('SUBSTITUTION_AMOUNT_INVALID', 'Сума завелика');
    return Number(amount);
}

function overlap(left, right) {
    return Boolean(left.startsAt && right.startsAt && Date.parse(left.startsAt) < Date.parse(right.endsAt)
        && Date.parse(right.startsAt) < Date.parse(left.endsAt));
}

function preview(input, context) {
    const blockers = [...(context.blockers || [])];
    const warnings = [];
    const rate = input.rateMode === 'individual' ? { rateMinor: input.rateMinor, source: 'individual', reason: input.rateReason }
        : context.standardRate;
    if (!rate || rate.payUnit && rate.payUnit !== input.payUnit) blockers.push({ code: 'SUBSTITUTION_RATE_REQUIRED', message: 'Немає стандартної ставки з цією одиницею; вкажіть індивідуальну' });
    const conflicts = (context.commitments || []).filter(item => overlap(input, item));
    for (const item of conflicts) {
        const warning = item.simultaneousAllowed === true && input.allowConcurrent;
        (warning ? warnings : blockers).push({ code: 'SUBSTITUTION_OVERLAP', message: 'Перетин із призначеною роботою', source: item.source, id: item.id });
    }
    if (!input.startsAt) warnings.push({ code: 'SUBSTITUTION_UNTIMED', message: 'Без точного часу неможливо перевірити всі перетини' });
    const estimateMinor = rate ? amountFor(input, rate.rateMinor) : null;
    const effects = {
        replacement: input.payMode === 'additional' ? 'Звичайна оплата зберігається; підміна нараховується додатково.'
            : 'Звичайна оплата лише за погоджений обсяг замінюється оплатою підміни.',
        original: input.originalTreatment === 'retain' ? 'Оплата заміненого працівника не змінюється.'
            : input.originalTreatment === 'transfer_unworked_scope' ? 'Передається лише невідпрацьований обсяг. Уже зароблена оплата зберігається.' : 'Заміненого працівника немає.'
    };
    const result = { input, rate, estimateMinor, currency: 'UAH', ruleVersion: RULE_VERSION,
        effects, warnings, blockers, evidence: context.evidence, available: blockers.length === 0 };
    return { ...result, fingerprint: fingerprint(result) };
}

module.exports = { RULE_VERSION, SOURCE_TYPES, fail, integer, text, choice, decimalUnits, fingerprint,
    kyivParts, normalizeInput, amountFor, overlap, preview };
