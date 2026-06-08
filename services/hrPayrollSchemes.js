const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    SCHEME_TYPES: PAYROLL_SCHEME_TYPES,
    createPayrollScheme
} = require('./payroll');

const log = createLogger('HRPayrollSchemes');

function cleanPayrollSchemeText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function cleanPayrollSchemeDate(value) {
    const normalized = cleanPayrollSchemeText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function payrollSchemeMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        staffId: row.staff_id,
        scheme_type: row.scheme_type,
        schemeType: row.scheme_type,
        title: row.title || '',
        is_active: row.is_active === true,
        isActive: row.is_active === true,
        config: parseJsonObject(row.config_json),
        effective_from: row.effective_from,
        effectiveFrom: row.effective_from,
        effective_to: row.effective_to,
        effectiveTo: row.effective_to,
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at
    };
}

function payrollSchemeTypeTitle(type) {
    return {
        per_shift: 'Сума за вихід',
        hourly: 'Погодинна',
        monthly_fixed: 'Фікс за місяць',
        percent: 'Відсоток',
        hybrid: 'Гібридна',
        manual: 'Ручна'
    }[type] || 'Погодинна';
}

function normalizePayrollSchemeType(value) {
    const type = cleanPayrollSchemeText(value, 32) || 'hourly';
    return PAYROLL_SCHEME_TYPES.includes(type) ? type : 'hourly';
}

function normalizePayrollBaseKind(value) {
    const kind = cleanPayrollSchemeText(value, 32) || 'hourly';
    return ['hourly', 'per_shift', 'monthly_fixed', 'manual'].includes(kind) ? kind : 'hourly';
}

function positivePayrollNumber(value, fallback = 0) {
    const number = numberOrNull(value);
    if (number === null) return Math.max(0, Number(fallback || 0));
    return Math.max(0, number);
}

function replaceSinglePayrollRule(sourceRules, body, amountKeys, labelKeys, defaultLabel) {
    const hasAmount = amountKeys.some(key => body[key] !== undefined);
    if (!hasAmount) return Array.isArray(sourceRules) ? sourceRules : [];
    const amount = positivePayrollNumber(amountKeys.map(key => body[key]).find(value => value !== undefined), 0);
    if (!amount) return [];
    const label = cleanPayrollSchemeText(labelKeys.map(key => body[key]).find(value => value !== undefined), 80) || defaultLabel;
    return [{ kind: 'fixed', label, amount }];
}

function payrollSchemeConfigFromRequest(type, body = {}, fallbackRate = 0) {
    const source = parseJsonObject(body.config || body.config_json);
    const amount = numberOrNull(body.amount ?? body.rate ?? body.value);
    const rate = amount === null ? Math.max(0, Number(fallbackRate || 0)) : Math.max(0, amount);
    if (type === 'per_shift') return { ...source, perShiftRate: rate };
    if (type === 'monthly_fixed') return { ...source, monthlyAmount: rate };
    if (type === 'percent') return { ...source, percentRate: rate, sourceMetric: source.sourceMetric || 'manual' };
    if (type === 'manual') return { ...source, manualAmount: rate };
    if (type === 'hybrid') {
        const sourceBase = parseJsonObject(source.base);
        const baseRate = positivePayrollNumber(
            body.base_rate ?? body.baseRate ?? body.amount ?? body.rate ?? sourceBase.rate ?? sourceBase.amount ?? source.baseRate,
            fallbackRate
        );
        const baseQuantity = positivePayrollNumber(body.base_quantity ?? body.baseQuantity ?? sourceBase.quantity ?? source.baseQuantity, 0);
        const percentRate = positivePayrollNumber(body.percent_rate ?? body.percentRate, 0);
        const percentBase = positivePayrollNumber(body.percent_base ?? body.percentBase ?? body.base_amount ?? body.baseAmount, 0);
        const percentRules = body.percent_rate !== undefined || body.percentRate !== undefined
            ? (percentRate ? [{
                kind: 'percent',
                label: cleanPayrollSchemeText(body.percent_label ?? body.percentLabel, 80) || 'Відсоток',
                rate: percentRate,
                baseAmount: percentBase,
                sourceMetric: cleanPayrollSchemeText(body.percent_source_metric ?? body.percentSourceMetric, 40) || 'manual'
            }] : [])
            : (Array.isArray(source.percentRules) ? source.percentRules : []);
        return {
            ...source,
            base: {
                ...sourceBase,
                kind: normalizePayrollBaseKind(body.base_kind ?? body.baseKind ?? sourceBase.kind ?? source.baseKind),
                rate: baseRate,
                amount: baseRate,
                ...(baseQuantity ? { quantity: baseQuantity } : {})
            },
            bonusRules: replaceSinglePayrollRule(
                source.bonusRules,
                body,
                ['bonus_amount', 'bonusAmount'],
                ['bonus_label', 'bonusLabel'],
                'Премія'
            ),
            percentRules,
            deductions: replaceSinglePayrollRule(
                source.deductions,
                body,
                ['deduction_amount', 'deductionAmount'],
                ['deduction_label', 'deductionLabel'],
                'Утримання'
            ),
            advances: replaceSinglePayrollRule(
                source.advances,
                body,
                ['advance_amount', 'advanceAmount'],
                ['advance_label', 'advanceLabel'],
                'Аванс'
            )
        };
    }
    return { ...source, hourlyRate: rate };
}

async function loadPayrollSchemesForStaff(staffId, db = pool) {
    const result = await db.query(
        `SELECT *
         FROM payroll_schemes
         WHERE staff_id = $1
         ORDER BY is_active DESC, effective_from DESC NULLS LAST, updated_at DESC, id DESC`,
        [staffId]
    ).catch(err => {
        log.warn('payroll scheme lookup failed:', err.message);
        return { rows: [] };
    });
    return result.rows.map(payrollSchemeMeta);
}

async function loadStaffPayrollSchemeWorkspace(staffId, db = pool) {
    const staff = await db.query('SELECT id, name, hourly_rate FROM staff WHERE id = $1', [staffId]);
    if (!staff.rows.length) return null;
    const schemes = await loadPayrollSchemesForStaff(staffId, db);
    return {
        staff: staff.rows[0],
        data: {
            staff_id: Number(staffId),
            active_scheme: schemes.find(scheme => scheme.is_active) || null,
            schemes,
            scheme_types: PAYROLL_SCHEME_TYPES.map(type => ({ value: type, label: payrollSchemeTypeTitle(type) })),
            fallback_hourly_rate: Number(staff.rows[0].hourly_rate || 0)
        }
    };
}

async function createStaffPayrollScheme(staffId, body = {}, user = null, options = {}) {
    const db = options.db || pool;
    const createScheme = options.createScheme || createPayrollScheme;
    const staff = await db.query('SELECT id, name, hourly_rate FROM staff WHERE id = $1', [staffId]);
    if (!staff.rows.length) return null;

    const schemeType = normalizePayrollSchemeType(body.scheme_type || body.schemeType);
    const config = payrollSchemeConfigFromRequest(schemeType, body || {}, staff.rows[0].hourly_rate);
    const title = cleanPayrollSchemeText(body.title, 160) || payrollSchemeTypeTitle(schemeType);
    const scheme = await createScheme({
        staffId,
        schemeType,
        title,
        config,
        effectiveFrom: cleanPayrollSchemeDate(body.effective_from || body.effectiveFrom),
        effectiveTo: cleanPayrollSchemeDate(body.effective_to || body.effectiveTo),
        isActive: true
    }, user);

    return {
        data: scheme,
        audit: {
            scheme_id: scheme.id,
            scheme_type: scheme.schemeType,
            title: scheme.title
        }
    };
}

module.exports = {
    createStaffPayrollScheme,
    loadPayrollSchemesForStaff,
    loadStaffPayrollSchemeWorkspace,
    normalizePayrollSchemeType,
    payrollSchemeConfigFromRequest,
    payrollSchemeMeta,
    payrollSchemeTypeTitle
};
