const { createHash } = require('node:crypto');
const { pool } = require('../db');
const { canUseAction } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { attendanceFactMinutes, hydrateAttendanceRecords } = require('./hrAttendance');
const {
    assertPayrollPeriodOpen,
    buildPayrollRateUnitWarnings,
    buildPayrollSourceReconciliation,
    loadPayrollPeriodLock,
    lockPayrollPeriodMutation,
    payrollMonthRange,
    setPayrollPeriodLock
} = require('./hrPayrollPeriod');
const {
    PAYROLL_SETTLEMENT_MODELS,
    configuredPayrollInstallmentsActivationMonth,
    isPayrollInstallmentsActivationMonth,
    loadPayrollSettlementReadModels,
    mapPayrollInstallment
} = require('./payrollSettlement');
const { canAccessBusinessContext } = require('./businessContext');
const { normalizeProfessionKey } = require('./professions');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');
const {
    TASK_PERFORMANCE_POLICY_VERSION,
    taskKpiEligibleSql,
    taskKpiMachineSignalSql
} = require('./taskPerformancePolicy');

const log = createLogger('Payroll');
const OVERTIME_MULTIPLIER = 1.5;
const WORKED_ATTENDANCE_STATUSES = new Set(['present', 'late', 'early_leave', 'auto_closed', 'unscheduled', 'clocked_in']);
const OPEN_ATTENDANCE_STATUSES = new Set(['clocked_in']);
const LEAVE_ATTENDANCE_STATUSES_REQUIRING_POLICY = new Set([
    'absent',
    'no_show',
    'vacation',
    'sick',
    'day_off',
    'dayoff',
    'unpaid'
]);
const LEAVE_PAYROLL_POLICIES = Object.freeze({
    unpaid_v1: { statuses: new Set(['unpaid']), paidPlannedFactor: 0 }
});
const SIMULTANEOUS_ADDITIONAL_LINE_TYPE = 'simultaneous_additional';
const EXPLICIT_ADDITIONAL_RATE_SOURCES = new Set(['staff_profession_rates.hourly_rate']);
const SIMULTANEOUS_PROFESSION_PAY_EFFECTIVE_FROM = '2026-07-18';
const PAYROLL_ROLE_HOURS_EXPLANATION = 'Оплачувані години професій можуть перевищувати фізичні години через одночасну роботу';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED = 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_MESSAGE = 'Формула подвійної оплати для цієї схеми не налаштована';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE = 'PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_MESSAGE = 'Додаткова оплата не може бути нульовою для оплачуваних хвилин';
const PAYROLL_ADJUSTMENTS_UNAVAILABLE = 'PAYROLL_ADJUSTMENTS_UNAVAILABLE';
const PAYROLL_ADJUSTMENTS_UNAVAILABLE_MESSAGE = 'Не вдалося достовірно прочитати коригування зарплати';

const SCHEME_TYPES = ['per_shift', 'hourly', 'monthly_fixed', 'percent', 'hybrid', 'manual', 'piece'];
const REPORT_STATUSES = ['draft', 'reviewed', 'approved', 'paid'];
const MANUAL_PAYROLL_REPORT_STATUSES = ['draft', 'reviewed', 'approved'];
const PAYROLL_INSTALLMENT_KINDS = ['advance', 'final'];
const PAYROLL_ZRS_TYPE = 'zrs';
const LEGACY_ZRS_TYPE = 'advance';
const PAYROLL_KPI_BONUS_TYPE = 'kpi_bonus';
const PAYROLL_KPI_BONUS_RULE_VERSION = 'manual_kpi_bonus_v1';
const PAYROLL_LINE_GROUPS = {
    base: 'base',
    bonus: 'bonus',
    kpi_bonus: 'bonus',
    percent: 'percent',
    manual: 'manual',
    piece: 'base',
    deduction: 'deduction',
    zrs: 'zrs',
    advance: 'zrs',
    adjustment: 'bonus'
};
const MONTHLY_ADJUSTMENT_GROUPS = new Set(['bonus', 'deduction', 'zrs', PAYROLL_KPI_BONUS_TYPE]);
const ADVANCE_EARNING_GROUPS = new Set(['base', 'additional', 'overtime', 'percent', 'manual']);

function normalizePayrollMonth(month) {
    const value = String(month || '').trim();
    if (/^\d{4}-\d{2}$/.test(value)) return value;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function assertPayrollMonth(month) {
    const value = String(month || '').trim();
    const match = value.match(/^(\d{4})-(\d{2})$/);
    const monthNumber = match ? Number(match[2]) : 0;
    if (!match || monthNumber < 1 || monthNumber > 12) {
        const err = new Error('month (YYYY-MM) required');
        err.status = 400;
        throw err;
    }
    return value;
}

function getMonthBounds(month) {
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    return {
        from: `${year}-${String(mon).padStart(2, '0')}-01`,
        to: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
}

function employmentOverlapsPayrollRange(staff = {}, range = {}) {
    const from = normalizeDateValue(range.from);
    const to = normalizeDateValue(range.to);
    if (!from || !to || from > to) return false;
    const hireDate = normalizeDateValue(staff.hireDate ?? staff.hire_date);
    const terminationDate = normalizeDateValue(staff.terminationDate ?? staff.termination_date);
    return (!hireDate || hireDate <= to) && (!terminationDate || terminationDate > from);
}

function isMissingTableError(err) {
    return err && err.code === '42P01';
}


function payrollAdjustmentsUnavailableError(cause) {
    const err = new Error(PAYROLL_ADJUSTMENTS_UNAVAILABLE_MESSAGE);
    err.status = 503;
    err.statusCode = 503;
    err.code = PAYROLL_ADJUSTMENTS_UNAVAILABLE;
    err.cause = cause;
    return err;
}

function isMissingPayrollProfileSchemaError(err) {
    return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizeStaffRateUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    if (['day', 'daily', 'per_day', 'per-day'].includes(unit)) return 'day';
    if (['month', 'monthly', 'per_month', 'per-month'].includes(unit)) return 'month';
    return 'hour';
}

function roundMoney(value) {
    return Math.round(toNumber(value, 0));
}

function normalizePayrollAdjustmentType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type === LEGACY_ZRS_TYPE) return PAYROLL_ZRS_TYPE;
    return type;
}

function normalizePayrollEntryLineType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type === LEGACY_ZRS_TYPE) return PAYROLL_ZRS_TYPE;
    return type;
}

function roundHoursFromMinutes(value) {
    return Math.round((Math.max(0, toNumber(value, 0)) / 60) * 100) / 100;
}

function nullableNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function parseConfig(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
}

function stablePayrollJson(value) {
    if (Array.isArray(value)) return `[${value.map(stablePayrollJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stablePayrollJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function payrollSchemeConfigHash(value) {
    return createHash('sha256')
        .update(stablePayrollJson(parseConfig(value)))
        .digest('hex');
}

function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

function normalizePayrollSchemeEffectiveDate(value, field, required = false) {
    const raw = String(value || '').trim();
    if (!raw) {
        if (!required) return null;
        throw payrollWorkflowError(
            `${field} is required for an immutable payroll scheme version`,
            400,
            'PAYROLL_SCHEME_EFFECTIVE_FROM_REQUIRED',
            { field }
        );
    }
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw payrollWorkflowError(
            `${field} must be a valid YYYY-MM-DD date`,
            400,
            'PAYROLL_SCHEME_EFFECTIVE_DATE_INVALID',
            { field, value: raw }
        );
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day) {
        throw payrollWorkflowError(
            `${field} must be a valid calendar date`,
            400,
            'PAYROLL_SCHEME_EFFECTIVE_DATE_INVALID',
            { field, value: raw }
        );
    }
    return raw;
}

function isPostSimultaneousPayActivationDate(value) {
    const date = normalizeDateValue(value);
    return Boolean(date && date >= SIMULTANEOUS_PROFESSION_PAY_EFFECTIVE_FROM);
}

function segmentHasPaidHourlyAdditionalRole(segment = {}) {
    const roles = Array.isArray(segment.additionalRoles)
        ? segment.additionalRoles
        : (Array.isArray(segment.additional_roles) ? segment.additional_roles : []);
    return roles.some(role => (
        role?.compensationMode || role?.compensation_mode
    ) === 'paid_hourly');
}

function mapScheme(row) {
    if (!row) return null;
    const config = parseConfig(row.config_json ?? row.config);
    return {
        id: row.id,
        staffId: row.staff_id,
        schemeType: row.scheme_type,
        title: row.title || '',
        isActive: row.is_active === true,
        config,
        configHash: payrollSchemeConfigHash(config),
        effectiveFrom: normalizeDateValue(row.effective_from),
        effectiveTo: normalizeDateValue(row.effective_to),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapStaff(row) {
    return {
        id: row.id,
        name: row.name,
        department: row.department,
        position: row.position || row.role_type || '',
        roleType: row.role_type || '',
        hourlyRate: toNumber(row.hourly_rate),
        rateUnit: normalizeStaffRateUnit(row.rate_unit),
        hireDate: normalizeDateValue(row.hire_date),
        terminationDate: normalizeDateValue(row.termination_date),
        isActive: row.is_active === undefined ? null : row.is_active === true,
        isFreelance: row.is_freelance === undefined ? null : row.is_freelance === true,
        hrPoolStatus: row.hr_pool_status || null
    };
}

function payrollSchemeSnapshotMetadata(scheme = {}) {
    const config = parseConfig(scheme.config ?? scheme.config_json);
    return {
        versionId: scheme.id ?? null,
        id: scheme.id ?? null,
        type: scheme.schemeType || scheme.scheme_type || null,
        title: scheme.title || '',
        effectiveFrom: normalizeDateValue(scheme.effectiveFrom ?? scheme.effective_from),
        effectiveTo: normalizeDateValue(scheme.effectiveTo ?? scheme.effective_to),
        configHash: scheme.configHash || scheme.config_hash || payrollSchemeConfigHash(config),
        updatedAt: scheme.updatedAt || scheme.updated_at || null
    };
}

function fallbackSchemeForStaff(staff) {
    const unit = normalizeStaffRateUnit(staff.rateUnit);
    if (unit === 'month') {
        return {
            id: null,
            staffId: staff.id,
            schemeType: 'monthly_fixed',
            title: 'Місячна ставка з HR',
            isActive: true,
            isFallback: true,
            config: { monthlyAmount: staff.hourlyRate || 0 },
            effectiveFrom: null,
            effectiveTo: null
        };
    }
    if (unit === 'day') {
        return {
            id: null,
            staffId: staff.id,
            schemeType: 'per_shift',
            title: 'Денна ставка з HR',
            isActive: true,
            isFallback: true,
            config: { perShiftRate: staff.hourlyRate || 0 },
            effectiveFrom: null,
            effectiveTo: null
        };
    }
    return {
        id: null,
        staffId: staff.id,
        schemeType: 'hourly',
        title: 'Погодинна ставка з HR',
        isActive: true,
        isFallback: true,
        config: { hourlyRate: staff.hourlyRate || 0 },
        effectiveFrom: null,
        effectiveTo: null
    };
}

function schemeTypeLabel(type) {
    return {
        per_shift: 'Сума за вихід',
        hourly: 'Погодинна',
        monthly_fixed: 'Фікс за місяць',
        percent: 'Відсоток',
        hybrid: 'Гібридна',
        manual: 'Ручна',
        piece: 'За одиницю'
    }[type] || 'Погодинна';
}

function line(group, lineType, label, amount, extra = {}) {
    return {
        group,
        lineType,
        label,
        amount: roundMoney(amount),
        quantity: extra.quantity === undefined ? null : toNumber(extra.quantity),
        rate: extra.rate === undefined ? null : toNumber(extra.rate),
        source: extra.source || null,
        meta: extra.meta || {}
    };
}

function pickQuantity(primary, fallback) {
    const primaryNum = toNumber(primary, 0);
    if (primaryNum > 0) return primaryNum;
    return toNumber(fallback, 0);
}

function periodMetricBase(config, metrics) {
    const source = config.sourceMetric || config.percentSource || config.source || 'manual';
    if (source === 'finance_income') return toNumber(metrics.periodIncome, 0);
    return toNumber(config.baseAmount ?? config.percentBase ?? config.manualBase, 0);
}

function resolvePieceQuantity(metrics = {}) {
    const direct = [
        ['pieceQuantity', metrics.pieceQuantity],
        ['piece_quantity', metrics.piece_quantity],
        ['pieceUnits', metrics.pieceUnits],
        ['piece_units', metrics.piece_units],
        ['unitsProduced', metrics.unitsProduced],
        ['units_produced', metrics.units_produced]
    ];
    for (const [source, value] of direct) {
        if (value === null || value === undefined || value === '') continue;
        const quantity = Number(value);
        if (Number.isFinite(quantity) && quantity >= 0) {
            return { quantity, source: `metrics.${source}` };
        }
    }
    const snapshots = [
        ['pieceSnapshot', metrics.pieceSnapshot],
        ['piece_snapshot', metrics.piece_snapshot],
        ['compensationSnapshot', metrics.compensationSnapshot],
        ['compensation_snapshot', metrics.compensation_snapshot]
    ];
    for (const [sourceName, rawSnapshot] of snapshots) {
        const snapshot = parseConfig(rawSnapshot);
        const rawQuantity = snapshot.pieceQuantity
            ?? snapshot.piece_quantity
            ?? snapshot.pieceUnits
            ?? snapshot.piece_units
            ?? snapshot.unitsProduced
            ?? snapshot.units_produced;
        if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '') continue;
        const quantity = Number(rawQuantity);
        if (Number.isFinite(quantity) && quantity >= 0) {
            return { quantity, source: `metrics.${sourceName}` };
        }
    }
    return { quantity: 0, source: null };
}

function pieceRateFromConfig(config = {}, staff = {}) {
    return toNumber(
        config.pieceRate
        ?? config.piece_rate
        ?? config.rate
        ?? config.amount
        ?? staff.pieceRate
        ?? staff.piece_rate,
        0
    );
}

function buildPieceLine(staff, config, metrics, label = 'Оплата за одиницю') {
    const rate = pieceRateFromConfig(config, staff);
    const { quantity, source } = resolvePieceQuantity(metrics);
    return line('base', 'piece', label, quantity * rate, {
        quantity,
        rate,
        source: source || 'missing_explicit_piece_quantity',
        meta: {
            formula: 'quantity * rate',
            quantitySource: source,
            requiresExplicitQuantity: true
        }
    });
}

function schemeUsesFinanceIncome(schemeType, config = {}) {
    const usesIncome = rule => {
        const source = rule?.sourceMetric || rule?.percentSource || rule?.source;
        return source === 'finance_income';
    };
    if (schemeType === 'percent') return usesIncome(config);
    if (schemeType !== 'hybrid') return false;
    const rules = [
        parseConfig(config.base || {}),
        ...(Array.isArray(config.percentRules) ? config.percentRules : []),
        ...(Array.isArray(config.bonusRules) ? config.bonusRules : []),
        ...(Array.isArray(config.deductions) ? config.deductions : []),
        ...(Array.isArray(config.zrsRules) ? config.zrsRules : []),
        ...(Array.isArray(config.advances) ? config.advances : [])
    ];
    return rules.some(rule => {
        const parsed = parseConfig(rule);
        return (parsed.kind || parsed.type) === 'percent' && usesIncome(parsed);
    });
}

function payrollCalculationBlockers(staff = {}, scheme = {}, metrics = {}) {
    const schemeType = scheme?.schemeType || scheme?.scheme_type || 'hourly';
    const config = parseConfig(scheme?.config || scheme?.config_json);
    const blockers = [];
    const periodSchemeVersions = Array.isArray(scheme?.periodSchemeVersions)
        ? scheme.periodSchemeVersions
        : [];
    if (periodSchemeVersions.length > 1) {
        blockers.push(payrollIssue(
            'PAYROLL_SCHEME_CHANGE_IN_PERIOD_UNSUPPORTED',
            'Payroll scheme or rate changes inside one earning month require an explicit segmented calculation policy',
            {
                staffId: staff.id ?? staff.staffId ?? null,
                schemeIds: periodSchemeVersions.map(item => item.id).filter(Boolean),
                effectiveRanges: periodSchemeVersions.map(item => ({
                    effectiveFrom: item.effectiveFrom || null,
                    effectiveTo: item.effectiveTo || null
                }))
            },
            'error'
        ));
    }
    if (schemeUsesFinanceIncome(schemeType, config) && metrics.periodIncomeUnavailableReason) {
        blockers.push(payrollIssue(
            metrics.periodIncomeUnavailableReason === 'mixed_business_contexts'
                ? 'PAYROLL_PERCENT_BUSINESS_CONTEXT_MIXED'
                : 'PAYROLL_PERCENT_BUSINESS_CONTEXT_REQUIRED',
            metrics.periodIncomeUnavailableReason === 'mixed_business_contexts'
                ? 'Finance-income payroll cannot combine multiple business contexts'
                : 'Finance-income payroll requires one explicit business context',
            {
                staffId: staff.id ?? staff.staffId ?? null,
                businessContexts: metrics.businessContexts || [],
                earningFrom: metrics.periodFrom || null,
                earningTo: metrics.periodTo || null
            },
            'error'
        ));
    }
    const hybridBase = parseConfig(config.base || {});
    const monthlyFixedConfig = schemeType === 'monthly_fixed'
        ? config
        : (schemeType === 'hybrid' && (hybridBase.kind || hybridBase.type) === 'monthly_fixed'
            ? hybridBase
            : null);
    if (monthlyFixedConfig) {
        const basis = monthlyFixedProrationBasis(
            staff,
            { schemeType: 'monthly_fixed', config: monthlyFixedConfig },
            metrics
        );
        if (!basis.valid) {
            blockers.push(payrollIssue(
                basis.code,
                basis.message,
                {
                    staffId: staff.id ?? staff.staffId ?? null,
                    plannedMinutes: basis.plannedMinutes,
                    paidPlannedMinutes: basis.paidPlannedMinutes,
                    monthlyNormMinutes: basis.monthlyNormMinutes,
                    monthlyNormSource: basis.monthlyNormSource || null,
                    monthlyNormConfirmed: basis.monthlyNormConfirmed === true,
                    monthlyNormMonth: basis.monthlyNormMonth || null,
                    periodFrom: basis.periodFrom,
                    periodTo: basis.periodTo
                },
                'error'
            ));
        }
    }
    if (schemeType === 'piece') {
        const rate = pieceRateFromConfig(config, staff);
        const { quantity, source } = resolvePieceQuantity(metrics);
        if (rate <= 0) {
            blockers.push(payrollIssue(
                'PAYROLL_PIECE_RATE_REQUIRED',
                'Piece-rate payroll requires an explicit positive rate',
                { staffId: staff.id ?? staff.staffId ?? null, schemeType, rate },
                'error'
            ));
        }
        if (quantity < 0 || !source) {
            blockers.push(payrollIssue(
                'PAYROLL_PIECE_QUANTITY_REQUIRED',
                'Piece-rate payroll requires an explicit non-negative quantity from payroll metrics or immutable snapshot',
                { staffId: staff.id ?? staff.staffId ?? null, schemeType, quantity, quantitySource: source },
                'error'
            ));
        }
    }
    return blockers;
}

function monthlyFixedProrationBasis(staff = {}, scheme = {}, metrics = {}) {
    const config = parseConfig(scheme?.config || scheme?.config_json);
    const plannedMinutes = Math.max(0, toNumber(metrics.plannedMinutes, 0));
    const paidPlannedMinutes = Math.max(
        0,
        toNumber(metrics.paidPlannedMinutes ?? metrics.paid_planned_minutes ?? plannedMinutes, 0)
    );
    const explicitMonthlyNormMinutes = toNumber(
        metrics.monthlyNormMinutes
        ?? metrics.monthly_norm_minutes
        ?? config.monthlyNormMinutes
        ?? config.monthly_norm_minutes,
        0
    );
    const monthlyNormSource = String(
        metrics.monthlyNormSource
        ?? metrics.monthly_norm_source
        ?? config.monthlyNormSource
        ?? config.monthly_norm_source
        ?? ''
    ).trim();
    const monthlyNormConfirmed = (
        metrics.monthlyNormConfirmed
        ?? metrics.monthly_norm_confirmed
        ?? config.monthlyNormConfirmed
        ?? config.monthly_norm_confirmed
    ) === true;
    const monthlyNormMonth = String(
        metrics.monthlyNormMonth
        ?? metrics.monthly_norm_month
        ?? config.monthlyNormMonth
        ?? config.monthly_norm_month
        ?? ''
    ).trim();
    const periodFrom = normalizeDateValue(metrics.periodFrom ?? metrics.period_from);
    const periodTo = normalizeDateValue(metrics.periodTo ?? metrics.period_to);
    const hireDate = normalizeDateValue(staff.hireDate ?? staff.hire_date);
    const terminationDate = normalizeDateValue(staff.terminationDate ?? staff.termination_date);
    const employmentBoundaryInsidePeriod = Boolean(
        (periodFrom && periodTo && hireDate && hireDate > periodFrom && hireDate <= periodTo)
        || (periodFrom && periodTo && terminationDate && terminationDate > periodFrom && terminationDate <= periodTo)
    );
    const expectedNormMonth = periodFrom ? periodFrom.slice(0, 7) : '';
    const monthlyNormMinutes = explicitMonthlyNormMinutes;

    if (monthlyNormMinutes <= 0
        || !monthlyNormConfirmed
        || !monthlyNormSource
        || (expectedNormMonth && monthlyNormMonth !== expectedNormMonth)) {
        return {
            valid: false,
            code: 'PAYROLL_MONTHLY_NORM_REQUIRED',
            message: 'Monthly fixed payroll requires a confirmed full-month norm with source and matching month',
            plannedMinutes,
            paidPlannedMinutes,
            monthlyNormMinutes,
            monthlyNormSource: monthlyNormSource || null,
            monthlyNormConfirmed,
            monthlyNormMonth: monthlyNormMonth || null,
            periodFrom,
            periodTo
        };
    }
    if (paidPlannedMinutes > monthlyNormMinutes) {
        return {
            valid: false,
            code: 'PAYROLL_MONTHLY_NORM_INVALID',
            message: 'Paid planned minutes cannot exceed the full-month norm',
            plannedMinutes,
            paidPlannedMinutes,
            monthlyNormMinutes,
            periodFrom,
            periodTo
        };
    }
    return {
        valid: true,
        plannedMinutes,
        paidPlannedMinutes,
        monthlyNormMinutes,
        monthlyNormSource,
        monthlyNormConfirmed,
        monthlyNormMonth,
        employmentBoundaryInsidePeriod,
        ratio: paidPlannedMinutes / monthlyNormMinutes,
        periodFrom,
        periodTo
    };
}

function monthlyFixedAmount(fullMonthlyRate, staff = {}, scheme = {}, metrics = {}) {
    const basis = monthlyFixedProrationBasis(staff, scheme, metrics);
    return {
        ...basis,
        fullMonthlyRate: toNumber(fullMonthlyRate, 0),
        amount: basis.valid ? roundMoney(toNumber(fullMonthlyRate, 0) * basis.ratio) : 0
    };
}

function buildBaseLines(base, staff, metrics, labelPrefix = 'База') {
    const cfg = parseConfig(base);
    const kind = cfg.kind || cfg.type || 'hourly';

    if (kind === 'per_shift') {
        const rate = toNumber(cfg.rate ?? cfg.perShiftRate ?? cfg.amount, 0);
        const quantity = pickQuantity(metrics.daysWorked, cfg.quantity ?? cfg.shifts ?? cfg.shiftCount);
        return [line('base', 'base', `${labelPrefix}: сума за вихід`, rate * quantity, { quantity, rate, source: 'scheme' })];
    }

    if (kind === 'monthly_fixed') {
        const fullMonthlyRate = toNumber(cfg.amount ?? cfg.fixedAmount ?? cfg.monthlyAmount, 0);
        const amount = monthlyFixedAmount(
            fullMonthlyRate,
            staff,
            { schemeType: 'monthly_fixed', config: cfg },
            metrics
        ).amount;
        return [line('base', 'base', `${labelPrefix}: фікс`, amount, { source: 'scheme' })];
    }

    if (kind === 'percent') {
        const rate = toNumber(cfg.rate ?? cfg.percentRate, 0);
        const baseAmount = periodMetricBase(cfg, metrics);
        return [line('percent', 'percent', `${labelPrefix}: ${rate}%`, baseAmount * rate / 100, { quantity: baseAmount, rate, source: cfg.sourceMetric || 'manual' })];
    }

    if (kind === 'manual') {
        const amount = toNumber(cfg.amount ?? cfg.manualAmount, 0);
        return [line('manual', 'manual', `${labelPrefix}: ручна сума`, amount, { source: 'scheme' })];
    }

    if (kind === 'piece') {
        return [buildPieceLine(staff, cfg, metrics, `${labelPrefix}: за одиницю`)];
    }

    const rate = toNumber(cfg.rate ?? cfg.hourlyRate ?? staff.hourlyRate, 0);
    const quantity = pickQuantity(metrics.hoursWorked, cfg.quantity ?? cfg.hours);
    return [line('base', 'base', `${labelPrefix}: погодинна`, rate * quantity, { quantity, rate, source: 'scheme' })];
}

function normalizeRuleArray(config, key, legacyAmountKey, legacyLabel) {
    const arr = Array.isArray(config[key]) ? config[key] : [];
    const amount = toNumber(config[legacyAmountKey], 0);
    if (amount > 0) return [...arr, { kind: 'fixed', label: legacyLabel, amount }];
    return arr;
}

function buildAmountRuleLines(rules, group, lineType, defaultLabel, metrics) {
    return rules.map((rule, idx) => {
        const cfg = parseConfig(rule);
        const labelText = cfg.label || `${defaultLabel} ${idx + 1}`;
        if ((cfg.kind || cfg.type) === 'percent') {
            const rate = toNumber(cfg.rate ?? cfg.percentRate, 0);
            const baseAmount = periodMetricBase(cfg, metrics);
            return line(group, lineType, labelText, baseAmount * rate / 100, {
                quantity: baseAmount,
                rate,
                source: cfg.sourceMetric || 'manual'
            });
        }
        const amount = toNumber(cfg.amount ?? cfg.value, 0);
        return line(group, lineType, labelText, amount, { source: 'scheme' });
    }).filter(item => item.amount !== 0);
}

function buildSchemeLines(staff, scheme, metrics) {
    const config = parseConfig(scheme?.config || scheme?.config_json);
    const type = scheme?.schemeType || scheme?.scheme_type || 'hourly';

    if (type === 'per_shift') {
        const rate = toNumber(config.rate ?? config.perShiftRate ?? config.amount, 0);
        const quantity = pickQuantity(metrics.daysWorked, config.shiftCount ?? config.shifts);
        return [line('base', 'base', 'Сума за вихід', rate * quantity, { quantity, rate, source: 'scheme' })];
    }

    if (type === 'hourly') {
        const rate = toNumber(config.hourlyRate ?? config.rate ?? staff.hourlyRate, 0);
        const quantity = pickQuantity(metrics.hoursWorked, config.hours);
        return [line('base', 'base', 'Погодинна ставка', rate * quantity, { quantity, rate, source: 'scheme' })];
    }

    if (type === 'monthly_fixed') {
        const fullMonthlyRate = toNumber(config.monthlyAmount ?? config.fixedAmount ?? config.amount, 0);
        const amount = monthlyFixedAmount(fullMonthlyRate, staff, scheme, metrics).amount;
        return [line('base', 'base', 'Фікс за місяць', amount, { source: 'scheme' })];
    }

    if (type === 'percent') {
        const rate = toNumber(config.percentRate ?? config.rate, 0);
        const baseAmount = periodMetricBase(config, metrics);
        return [line('percent', 'percent', `Відсоток ${rate}%`, baseAmount * rate / 100, {
            quantity: baseAmount,
            rate,
            source: config.sourceMetric || 'manual'
        })];
    }

    if (type === 'manual') {
        const amount = toNumber(config.manualAmount ?? config.amount, 0);
        return [line('manual', 'manual', 'Ручна схема', amount, { source: 'scheme' })];
    }

    if (type === 'piece') {
        return [buildPieceLine(staff, config, metrics)];
    }

    const lines = [];
    lines.push(...buildBaseLines(config.base || {
        kind: config.baseKind || 'hourly',
        rate: config.baseRate,
        amount: config.baseAmount,
        quantity: config.baseQuantity,
        sourceMetric: config.baseSourceMetric
    }, staff, metrics, 'Базова частина'));

    const bonusRules = normalizeRuleArray(config, 'bonusRules', 'bonusAmount', 'Бонус');
    const deductions = normalizeRuleArray(config, 'deductions', 'deductionAmount', 'Утримання');
    const zrsRules = Array.isArray(config.zrsRules)
        ? config.zrsRules
        : (Array.isArray(config.zrs)
            ? config.zrs
            : normalizeRuleArray(config, 'advances', 'advanceAmount', 'ЗРС'));
    const percentRules = Array.isArray(config.percentRules) ? config.percentRules : [];

    lines.push(...buildAmountRuleLines(bonusRules, 'bonus', 'bonus', 'Бонус', metrics));
    lines.push(...buildAmountRuleLines(percentRules, 'percent', 'percent', 'Відсоток', metrics));
    lines.push(...buildAmountRuleLines(deductions, 'deduction', 'deduction', 'Утримання', metrics));
    lines.push(...buildAmountRuleLines(zrsRules, 'zrs', 'zrs', 'ЗРС', metrics));
    return lines;
}

function buildAdjustmentLines(adjustments) {
    const result = [];
    const bonus = toNumber(adjustments.bonus, 0);
    const tip = toNumber(adjustments.tip, 0);
    const deduction = toNumber(adjustments.deduction, 0);
    const penalty = toNumber(adjustments.penalty, 0);
    const advance = toNumber(adjustments.advance, 0);

    if (bonus) result.push(line('bonus', 'adjustment', 'Бонуси з HR', bonus, { source: 'salary_adjustments' }));
    if (tip) result.push(line('bonus', 'adjustment', 'Чайові з HR', tip, { source: 'salary_adjustments' }));
    if (deduction) result.push(line('deduction', 'adjustment', 'Утримання з HR', deduction, { source: 'salary_adjustments' }));
    if (penalty) result.push(line('deduction', 'adjustment', 'Депреміювання з HR', penalty, { source: 'salary_adjustments' }));
    if (advance) result.push(line('zrs', 'zrs', 'ЗРС з HR', advance, { source: 'salary_adjustments' }));
    return result;
}

function buildEntryLines(entries) {
    return entries.map(entry => {
        const lineType = normalizePayrollEntryLineType(entry.line_type);
        const group = PAYROLL_LINE_GROUPS[lineType] || 'bonus';
        return line(group, lineType, entry.label || lineType, entry.amount, {
            quantity: entry.quantity,
            rate: entry.rate,
            source: 'payroll_entries',
            meta: parseConfig(entry.meta_json)
        });
    }).filter(item => item.amount !== 0);
}

function buildCanonicalAdjustmentLines(adjustments = {}) {
    const normalized = {
        bonus: toNumber(adjustments.bonus, 0),
        kpiBonus: toNumber(adjustments[PAYROLL_KPI_BONUS_TYPE], 0),
        tip: toNumber(adjustments.tip, 0),
        deduction: toNumber(adjustments.deduction, 0),
        penalty: toNumber(adjustments.penalty, 0),
        zrs: toNumber(adjustments.zrs, 0) + toNumber(adjustments.advance, 0)
    };
    const result = [];
    if (normalized.bonus) result.push(line('bonus', 'adjustment', 'HR bonus', normalized.bonus, { source: 'salary_adjustments' }));
    if (normalized.kpiBonus) result.push(line('bonus', PAYROLL_KPI_BONUS_TYPE, 'Manual KPI bonus', normalized.kpiBonus, {
        source: 'salary_adjustments',
        meta: {
            finalOnly: true,
            formula: null,
            ruleVersion: PAYROLL_KPI_BONUS_RULE_VERSION
        }
    }));
    if (normalized.tip) result.push(line('bonus', 'adjustment', 'HR tips', normalized.tip, { source: 'salary_adjustments' }));
    if (normalized.deduction) result.push(line('deduction', 'adjustment', 'HR deduction', normalized.deduction, { source: 'salary_adjustments' }));
    if (normalized.penalty) result.push(line('deduction', 'adjustment', 'HR depremium', normalized.penalty, { source: 'salary_adjustments' }));
    if (normalized.zrs) result.push(line('zrs', 'zrs', 'ZRS from HR', normalized.zrs, { source: 'salary_adjustments' }));
    return result;
}

function calcPayrollPreview(lines) {
    const gross = lines
        .filter(item => ['base', 'additional', 'overtime', 'bonus', 'percent', 'manual'].includes(item.group))
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const base = lines
        .filter(item => item.group === 'base')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const bonuses = lines
        .filter(item => item.group === 'bonus')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const kpiBonus = lines
        .filter(item => item.lineType === PAYROLL_KPI_BONUS_TYPE || item.line_type === PAYROLL_KPI_BONUS_TYPE)
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const overtime = lines
        .filter(item => item.group === 'overtime')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const additional = lines
        .filter(item => item.group === 'additional')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const percent = lines
        .filter(item => item.group === 'percent')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const manual = lines
        .filter(item => item.group === 'manual')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const deductions = lines
        .filter(item => item.group === 'deduction')
        .reduce((sum, item) => sum + Math.abs(toNumber(item.amount, 0)), 0);
    const zrs = lines
        .filter(item => item.group === 'zrs' || item.group === 'advance')
        .reduce((sum, item) => sum + Math.abs(toNumber(item.amount, 0)), 0);

    return {
        base: roundMoney(base),
        additional: roundMoney(additional),
        overtime: roundMoney(overtime),
        bonuses: roundMoney(bonuses),
        kpiBonus: roundMoney(kpiBonus),
        kpi_bonus: roundMoney(kpiBonus),
        percent: roundMoney(percent),
        manual: roundMoney(manual),
        gross: roundMoney(gross),
        deductions: roundMoney(deductions),
        zrs: roundMoney(zrs),
        advances: roundMoney(zrs),
        net: roundMoney(gross - deductions - zrs)
    };
}

function calculateMonthlyPayroll(staff, scheme, metrics, adjustments = {}, entries = [], professionPay = null) {
    const activeScheme = scheme || fallbackSchemeForStaff(staff);
    const calculationBlockers = payrollCalculationBlockers(staff, activeScheme, metrics);
    const baseLines = professionPay?.applies
        ? [
            ...professionPay.baseLines,
            ...(professionPay.additionalLines || []),
            ...professionPay.overtimeLines
        ]
        : buildSchemeLines(staff, activeScheme, metrics);
    const lines = [
        ...baseLines,
        ...buildCanonicalAdjustmentLines(adjustments),
        ...buildEntryLines(entries)
    ].filter(item => item.amount !== 0 || ['base', 'manual'].includes(item.group));
    const summary = calcPayrollPreview(lines);
    const blockingIssues = compactAllocationIssues([
        ...(professionPay?.blockingIssues || []),
        ...calculationBlockers
    ]);
    return {
        scheme: activeScheme,
        lines,
        summary,
        professionPay,
        calculationMode: 'monthly',
        calculationBlockers,
        blockers: blockingIssues,
        blockingIssues
    };
}

function calculatePayroll(staff, scheme, metrics, adjustments = {}, entries = [], professionPay = null) {
    return calculateMonthlyPayroll(staff, scheme, metrics, adjustments, entries, professionPay);
}

function effectiveMonthlyFixedAmount(staff, scheme, monthlyCalculation = null) {
    const schemeType = scheme?.schemeType || scheme?.scheme_type || fallbackSchemeForStaff(staff).schemeType;
    if (schemeType !== 'monthly_fixed') return null;
    const config = parseConfig(scheme?.config || scheme?.config_json);
    const configuredRate = toNumber(config.monthlyAmount ?? config.fixedAmount ?? config.amount ?? staff?.hourlyRate, 0);
    if (configuredRate > 0) return configuredRate;
    return toNumber(monthlyCalculation?.summary?.base, 0);
}

function calculationEarningAmount(calculation = {}) {
    const lines = Array.isArray(calculation.lines) ? calculation.lines : [];
    return roundMoney(lines
        .filter(item => ADVANCE_EARNING_GROUPS.has(item.group))
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0));
}

function payrollInstallmentBlocker(code, message, details = {}) {
    return { code, message, severity: 'error', ...details };
}

function calculateAdvanceInstallment(options = {}) {
    const staff = options.staff || {};
    const scheme = options.scheme || fallbackSchemeForStaff(staff);
    const schemeType = scheme?.schemeType || scheme?.scheme_type || 'hourly';
    const advanceMetrics = options.advanceMetrics || options.metrics || {};
    const monthMetrics = options.monthMetrics || {};
    const blockers = [];
    let amount = 0;

    if (schemeType === 'monthly_fixed') {
        const monthlyAmount = effectiveMonthlyFixedAmount(staff, scheme, options.monthlyCalculation);
        const basis = monthlyFixedProrationBasis(staff, scheme, monthMetrics);
        const fullNorm = basis.monthlyNormMinutes;
        const hasAdvanceNorm = Object.prototype.hasOwnProperty.call(advanceMetrics, 'paidPlannedMinutes')
            || Object.prototype.hasOwnProperty.call(advanceMetrics, 'paid_planned_minutes')
            || Object.prototype.hasOwnProperty.call(advanceMetrics, 'plannedMinutes')
            || Object.prototype.hasOwnProperty.call(advanceMetrics, 'planned_minutes');
        const advanceNorm = toNumber(
            advanceMetrics.paidPlannedMinutes
            ?? advanceMetrics.paid_planned_minutes
            ?? advanceMetrics.plannedMinutes
            ?? advanceMetrics.planned_minutes,
            0
        );
        if (!basis.valid) {
            blockers.push(payrollInstallmentBlocker(
                basis.code,
                basis.message,
                {
                    staffId: staff.id ?? staff.staffId ?? null,
                    fullNormMinutes: fullNorm,
                    monthlyNormSource: basis.monthlyNormSource || null,
                    monthlyNormMonth: basis.monthlyNormMonth || null
                }
            ));
        } else if (!hasAdvanceNorm || advanceNorm < 0) {
            blockers.push(payrollInstallmentBlocker(
                'PAYROLL_ADVANCE_PLANNED_NORM_REQUIRED',
                'Monthly fixed advance requires explicit paid planned norm for days 1-15',
                { staffId: staff.id ?? staff.staffId ?? null, fullNormMinutes: fullNorm, advanceNormMinutes: advanceNorm }
            ));
        } else {
            amount = monthlyAmount * advanceNorm / fullNorm;
        }
    } else {
        const rangeCalculation = options.rangeCalculation || calculateMonthlyPayroll(
            staff,
            scheme,
            advanceMetrics,
            {},
            [],
            options.rangeProfessionPay || null
        );
        const rangeBlockers = Array.isArray(rangeCalculation.blockers)
            ? rangeCalculation.blockers
            : (Array.isArray(rangeCalculation.blockingIssues) ? rangeCalculation.blockingIssues : []);
        blockers.push(...rangeBlockers);
        amount = calculationEarningAmount(rangeCalculation);
    }

    const lockedAmount = roundMoney(amount);
    return {
        kind: 'advance',
        earningFrom: options.earningFrom || null,
        earningTo: options.earningTo || null,
        amount: lockedAmount,
        calculatedAmount: lockedAmount,
        lockedAmount,
        blockers,
        confirmable: blockers.length === 0,
        excludesMonthlyAdjustments: true,
        calculationSnapshot: {
            schemaVersion: 1,
            kind: 'advance',
            schemeType,
            roundedOnce: true,
            excludedGroups: [...MONTHLY_ADJUSTMENT_GROUPS]
        }
    };
}

function approvedAdvanceAmount(advanceInstallment = {}) {
    if (!advanceInstallment) return 0;
    const status = String(
        advanceInstallment.workflowStatus
        || advanceInstallment.workflow_status
        || advanceInstallment.status
        || ''
    ).trim();
    if (!['approved', 'paid', 'partially_paid'].includes(status)) return 0;
    return roundMoney(
        advanceInstallment.lockedAmount
        ?? advanceInstallment.locked_amount
        ?? advanceInstallment.amount
        ?? advanceInstallment.calculatedAmount
        ?? advanceInstallment.calculated_amount
        ?? 0
    );
}

function calculatedAdvanceAmount(advanceInstallment = {}) {
    if (!advanceInstallment) return 0;
    return roundMoney(
        advanceInstallment.amount
        ?? advanceInstallment.calculatedAmount
        ?? advanceInstallment.calculated_amount
        ?? 0
    );
}

function calculateFinalInstallment(options = {}) {
    const monthlyPayroll = options.monthlyPayroll || options.monthlyCalculation || {};
    const blockers = Array.isArray(monthlyPayroll.blockers)
        ? monthlyPayroll.blockers
        : (Array.isArray(monthlyPayroll.blockingIssues) ? monthlyPayroll.blockingIssues : []);
    const monthlyNet = roundMoney(monthlyPayroll.summary?.net ?? monthlyPayroll.netAmount ?? monthlyPayroll.net_amount ?? 0);
    const approvedAdvance = approvedAdvanceAmount(options.advanceInstallment);
    const plannedAdvance = calculatedAdvanceAmount(options.plannedAdvanceInstallment);
    const deductedAdvance = approvedAdvance || plannedAdvance;
    const currentAdvanceAmount = options.currentAdvanceInstallment
        ? roundMoney(
            options.currentAdvanceInstallment.amount
            ?? options.currentAdvanceInstallment.calculatedAmount
            ?? options.currentAdvanceInstallment.calculated_amount
            ?? 0
        )
        : null;
    const advanceCorrectionDelta = currentAdvanceAmount === null || approvedAdvance <= 0
        ? 0
        : roundMoney(currentAdvanceAmount - approvedAdvance);
    const paidAdvance = roundMoney(
        options.advancePaidAmount
        ?? options.advanceInstallment?.paidAmount
        ?? options.advanceInstallment?.paid_amount
        ?? 0
    );
    const finalAmount = Math.max(monthlyNet - deductedAdvance, 0);
    return {
        kind: 'final',
        amount: finalAmount,
        calculatedAmount: finalAmount,
        lockedAdvanceAmount: approvedAdvance,
        plannedAdvanceAmount: plannedAdvance,
        deductedAdvanceAmount: deductedAdvance,
        currentAdvanceAmount,
        advanceCorrectionDeltaAmount: advanceCorrectionDelta,
        advancePaidAmount: paidAdvance,
        advanceOutstandingAmount: Math.max(approvedAdvance - paidAdvance, 0),
        overpaidAmount: Math.max(paidAdvance - monthlyNet, 0),
        lockedAdvanceOverMonthlyNetAmount: Math.max(approvedAdvance - monthlyNet, 0),
        monthlyNetAmount: monthlyNet,
        blockers,
        confirmable: blockers.length === 0,
        corrections: advanceCorrectionDelta === 0 ? [] : [{
            type: 'advance_recalculation_delta',
            amount: advanceCorrectionDelta,
            lockedAdvanceAmount: approvedAdvance,
            plannedAdvanceAmount: plannedAdvance,
            deductedAdvanceAmount: deductedAdvance,
            currentAdvanceAmount,
            note: 'Advance amount is locked; this delta is absorbed by the final installment.'
        }],
        calculationSnapshot: {
            schemaVersion: 1,
            kind: 'final',
            monthlyNetAmount: monthlyNet,
            lockedAdvanceAmount: approvedAdvance,
            plannedAdvanceAmount: plannedAdvance,
            deductedAdvanceAmount: deductedAdvance,
            currentAdvanceAmount,
            advanceCorrectionDeltaAmount: advanceCorrectionDelta,
            advancePaidAmount: paidAdvance,
            advanceOutstandingAmount: Math.max(approvedAdvance - paidAdvance, 0),
            overpaidAmount: Math.max(paidAdvance - monthlyNet, 0),
            lockedAdvanceOverMonthlyNetAmount: Math.max(approvedAdvance - monthlyNet, 0),
            blockers
        }
    };
}

function calculatePayrollRangePreview(options = {}) {
    const from = normalizeDateValue(options.from);
    const to = normalizeDateValue(options.to);
    const month = normalizePayrollMonth(options.month || (from ? from.slice(0, 7) : ''));
    const bounds = getMonthBounds(month);
    const crossMonth = Boolean(from && to && from.slice(0, 7) !== to.slice(0, 7));
    const fullMonth = from === bounds.from && to === bounds.to;
    return {
        month,
        from,
        to,
        previewMode: true,
        confirmable: fullMonth && !crossMonth,
        confirmationBlockedReason: fullMonth && !crossMonth
            ? null
            : 'Only a full payroll month can be confirmed; custom or cross-month ranges are preview-only.',
        staff: Array.isArray(options.staff) ? options.staff : [],
        totals: options.totals || null
    };
}

async function fetchStaffList(month, periodOptions = {}, db = pool) {
    const bounds = getMonthBounds(month);
    const from = normalizeDateValue(periodOptions.from) || bounds.from;
    const to = normalizeDateValue(periodOptions.to) || bounds.to;
    const readStaff = async () => {
        return db.query(`
            SELECT DISTINCT s.id, s.name, s.department, s.position, s.role_type, s.hourly_rate,
                   COALESCE(s.rate_unit, 'hour') AS rate_unit,
                   s.hire_date,
                   s.termination_date,
                   s.is_active,
                   s.is_freelance,
                   s.hr_pool_status
            FROM staff s
            WHERE COALESCE(s.is_freelance, false) IS NOT TRUE
              AND (
                    COALESCE(NULLIF(s.hr_pool_status, ''), 'core') NOT IN ('reserve','blacklisted','archived','dismissed')
                    OR NULLIF(s.termination_date::text, '') IS NOT NULL
              )
              AND (NULLIF(s.hire_date::text, '') IS NULL OR NULLIF(s.hire_date::text, '')::date <= $2::date)
              AND (NULLIF(s.termination_date::text, '') IS NULL OR NULLIF(s.termination_date::text, '')::date > $1::date)
            ORDER BY s.name
        `, [from, to]);
    };

    try {
        const result = await readStaff();
        return result.rows.map(mapStaff);
    } catch (err) {
        if (err.code === '42703') {
            const fallback = await db.query(`
                SELECT DISTINCT s.id, s.name, s.department, s.position, s.role_type, s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit
                FROM staff s
                WHERE ${scheduleableStaffWhere('s', { dateExpression: '$1' })}
                ORDER BY s.name
            `, [to]);
            return fallback.rows.map(mapStaff);
        }
        const reason = isMissingTableError(err)
            ? 'payroll staff employment-overlap query unavailable'
            : 'payroll staff employment-overlap query failed';
        log.warn(`${reason}:`, err.message);
        throw err;
    }
}

function payrollMetricBucket(staffId) {
    return {
        staffId: Number(staffId),
        physicalMinutes: 0,
        totalMinutes: 0,
        allocatedMinutes: 0,
        plannedMinutes: 0,
        paidPlannedMinutes: 0,
        overtimeMinutes: 0,
        daysWorked: 0,
        hoursWorked: 0,
        overtimeHours: 0,
        professionAllocations: [],
        baseProfessionAllocations: [],
        additionalProfessionAllocations: [],
        compensationMinutes: 0,
        roleMinutes: 0,
        overtimeAllocations: [],
        primaryDays: [],
        attendanceDays: [],
        breakPolicies: [],
        businessContexts: [],
        allocationIssues: [],
        payrollBlockingIssues: [],
        reconciliation: { days: [], warnings: [] }
    };
}

function payrollIssue(code, message, details = {}, severity = 'warning') {
    return { code, message, severity, ...details };
}

function explicitLeavePolicy(row = {}, compensationSnapshot = null) {
    const direct = row.leave_policy
        || row.leavePolicy
        || row.payroll_leave_policy
        || row.payrollLeavePolicy
        || row.leave_compensation_policy
        || row.leaveCompensationPolicy;
    const snapshot = compensationSnapshot?.leavePolicy
        || compensationSnapshot?.leave_policy
        || compensationSnapshot?.payrollLeavePolicy
        || compensationSnapshot?.payroll_leave_policy;
    const policy = direct || snapshot || null;
    return policy ? String(policy).trim().toLowerCase() : '';
}

function resolveLeavePayrollPolicy(status, row = {}, compensationSnapshot = null) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!LEAVE_ATTENDANCE_STATUSES_REQUIRING_POLICY.has(normalizedStatus)) {
        return { required: false, policy: null, supported: true, paidPlannedFactor: 1 };
    }
    const policy = explicitLeavePolicy(row, compensationSnapshot);
    const rule = LEAVE_PAYROLL_POLICIES[policy] || null;
    const supported = Boolean(rule?.statuses?.has(normalizedStatus));
    return {
        required: true,
        policy: policy || null,
        supported,
        paidPlannedFactor: supported ? rule.paidPlannedFactor : 0
    };
}

function explicitAdditionalRateSource(value) {
    const source = String(value || '').trim();
    return EXPLICIT_ADDITIONAL_RATE_SOURCES.has(source) || source.startsWith('payroll_profile.');
}

function resolveSimultaneousAdditionalRate(allocation = {}) {
    const professionKey = normalizeProfessionKey(allocation.professionKey || allocation.profession_key);
    const rate = Number(allocation.rate);
    const rateUnit = String(allocation.rateUnit || allocation.rate_unit || '').trim().toLowerCase();
    const rateSource = String(allocation.rateSource || allocation.rate_source || '').trim();
    const multiplier = Number(allocation.payMultiplier ?? allocation.pay_multiplier);
    const policyVersion = String(allocation.policyVersion || allocation.policy_version || '').trim();
    const compensationMode = String(
        allocation.compensationMode || allocation.compensation_mode || ''
    ).trim();
    const invalidFields = [];
    if (!professionKey) invalidFields.push('professionKey');
    if (compensationMode !== 'paid_hourly') invalidFields.push('compensationMode');
    if (!Number.isFinite(rate) || rate <= 0) invalidFields.push('rate');
    if (rateUnit !== 'hour') invalidFields.push('rateUnit');
    if (!explicitAdditionalRateSource(rateSource)) invalidFields.push('rateSource');
    if (!Number.isFinite(multiplier) || multiplier <= 0) invalidFields.push('payMultiplier');
    if (!policyVersion) invalidFields.push('policyVersion');
    if (invalidFields.length) {
        return {
            ok: false,
            issue: payrollIssue(
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_SNAPSHOT_INVALID',
                'Paid simultaneous role has no complete immutable rate snapshot',
                {
                    professionKey: professionKey || null,
                    attendanceRef: allocation.attendanceRef ?? allocation.attendance_ref ?? null,
                    segmentRef: allocation.segmentRef ?? allocation.segment_ref
                        ?? allocation.segmentId ?? allocation.segment_id ?? null,
                    invalidFields
                },
                'error'
            )
        };
    }
    return {
        ok: true,
        professionKey,
        rate,
        rateUnit: 'hour',
        rateSource,
        multiplier,
        policyVersion
    };
}

function compactAllocationIssues(issues = []) {
    const seen = new Set();
    return issues.filter(issue => {
        const key = `${issue.date || ''}:${issue.code || ''}:${issue.professionKey || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function loadPayrollAttendanceMetrics(options = {}, db = pool) {
    const from = String(options.from || '').slice(0, 10);
    const to = String(options.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        const err = new Error('valid payroll attendance range is required');
        err.status = 400;
        throw err;
    }
    const staffIds = [...new Set((options.staffIds || []).map(Number).filter(Number.isInteger))];
    const params = [from, to];
    const staffFilter = staffIds.length ? `AND tr.staff_id = ANY($${params.push(staffIds)}::int[])` : '';
    const result = await db.query(`
        SELECT tr.*,
               tr.record_date::text AS date,
               tr.id AS attendance_ref,
               hs.id AS planned_shift_ref,
               hs.profession_key AS primary_profession_key
        FROM hr_time_records tr
        LEFT JOIN hr_shifts hs
          ON hs.staff_id = tr.staff_id
         AND hs.shift_date = tr.record_date
        WHERE tr.record_date >= $1::date
          AND tr.record_date <= $2::date
          ${staffFilter}
        ORDER BY tr.staff_id, tr.record_date, tr.id
    `, params);
    const attendanceRows = await hydrateAttendanceRecords(db, result.rows);
    const buckets = new Map();
    const professionMaps = new Map();
    const overtimeMaps = new Map();
    const workedDates = new Map();

    for (const row of attendanceRows) {
        const staffId = Number(row.staff_id);
        if (!Number.isInteger(staffId)) continue;
        if (!buckets.has(staffId)) {
            buckets.set(staffId, payrollMetricBucket(staffId));
            professionMaps.set(staffId, new Map());
            overtimeMaps.set(staffId, new Map());
            workedDates.set(staffId, new Set());
        }
        const bucket = buckets.get(staffId);
        const professionMap = professionMaps.get(staffId);
        const overtimeMap = overtimeMaps.get(staffId);
        const date = String(row.date || row.record_date || '').slice(0, 10);
        const source = row.allocation_source || row.allocationSource || 'none';
        const breakPolicy = row.break_policy || row.breakPolicy || null;
        const segmentAllocations = Array.isArray(row.segment_allocations)
            ? row.segment_allocations
            : (Array.isArray(row.segmentAllocations) ? row.segmentAllocations : []);
        const rawCompensationSnapshot = row.compensation_snapshot || row.compensationSnapshot || null;
        const compensationSnapshot = rawCompensationSnapshot ? parseConfig(rawCompensationSnapshot) : null;
        const hasPaidHourlyAdditionalRole = segmentAllocations.some(segmentHasPaidHourlyAdditionalRole);
        const compensationAllocations = Array.isArray(compensationSnapshot?.compensationAllocations)
            ? compensationSnapshot.compensationAllocations
            : (Array.isArray(compensationSnapshot?.compensation_allocations)
                ? compensationSnapshot.compensation_allocations
                : []);
        const actualMinutes = Math.max(0, toNumber(row.actualMinutes ?? row.actual_minutes ?? row.total_worked_minutes, 0));
        const allocatedMinutes = Math.max(0, toNumber(row.allocatedMinutes ?? row.allocated_minutes, 0));
        const overtimeMinutes = attendanceFactMinutes(row).overtimeMinutes;
        const plannedMinutes = Math.max(0, toNumber(row.plannedMinutes ?? row.planned_minutes, 0));
        const status = String(row.status || row.time_status || '').trim();
        const leavePolicy = resolveLeavePayrollPolicy(status, row, compensationSnapshot);
        const businessContext = String(row.business_context || row.businessContext || '').trim();
        if (businessContext && !bucket.businessContexts.includes(businessContext)) {
            bucket.businessContexts.push(businessContext);
        }
        const worked = actualMinutes > 0 || WORKED_ATTENDANCE_STATUSES.has(status);
        if (worked && date) workedDates.get(staffId).add(date);

        bucket.physicalMinutes += actualMinutes;
        bucket.totalMinutes += actualMinutes;
        bucket.allocatedMinutes += allocatedMinutes;
        bucket.overtimeMinutes += overtimeMinutes;
        bucket.plannedMinutes += plannedMinutes;
        bucket.paidPlannedMinutes += Math.round(plannedMinutes * leavePolicy.paidPlannedFactor);

        for (const allocation of segmentAllocations) {
            const professionKey = normalizeProfessionKey(allocation.professionKey || allocation.profession_key);
            const minutes = Math.max(0, toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0));
            if (!professionKey || minutes <= 0) continue;
            if (!professionMap.has(professionKey)) professionMap.set(professionKey, { minutes: 0, sources: new Set() });
            const entry = professionMap.get(professionKey);
            entry.minutes += minutes;
            entry.sources.add(source);
        }

        const attendanceRef = row.attendance_ref || row.id || null;
        const additionalAllocations = compensationAllocations.filter(allocation => (
            allocation.allocationType || allocation.allocation_type
        ) === SIMULTANEOUS_ADDITIONAL_LINE_TYPE);
        const additionalProfessionMinutes = additionalAllocations.reduce(
            (sum, allocation) => sum + Math.max(
                0,
                toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0)
            ),
            0
        );
        const snapshotAdditionalMinutes = Math.max(
            0,
            toNumber(
                compensationSnapshot?.totals?.simultaneousAdditionalMinutes
                ?? compensationSnapshot?.totals?.simultaneous_additional_minutes,
                0
            )
        );
        if (snapshotAdditionalMinutes > 0 && additionalAllocations.length === 0) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_ALLOCATIONS_MISSING',
                'Compensation snapshot totals contain additional minutes without allocation details',
                { date, attendanceRef, snapshotAdditionalMinutes },
                'error'
            ));
        }
        if (!compensationSnapshot && isPostSimultaneousPayActivationDate(date) && (row.clock_out || hasPaidHourlyAdditionalRole)) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_COMPENSATION_SNAPSHOT_MISSING',
                'Attendance after simultaneous profession pay activation requires an immutable compensation snapshot',
                { date, attendanceRef, hasPaidHourlyAdditionalRole },
                'error'
            ));
        }
        if (compensationSnapshot && row.clock_out
            && !['final', 'legacy_base_only'].includes(String(compensationSnapshot.state || ''))) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_COMPENSATION_SNAPSHOT_NOT_FINAL',
                'Closed attendance has no final compensation snapshot',
                { date, attendanceRef, snapshotState: compensationSnapshot.state || null },
                'error'
            ));
        }
        if (compensationSnapshot?.manualReview === true
            || compensationSnapshot?.manual_review === true) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_COMPENSATION_SNAPSHOT_MANUAL_REVIEW',
                'Attendance compensation snapshot requires manual review',
                { date, attendanceRef },
                'error'
            ));
        }
        if ((OPEN_ATTENDANCE_STATUSES.has(status) || (row.clock_in && !row.clock_out))
            && !['auto_closed'].includes(status)) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_ATTENDANCE_OPEN',
                'Payroll approval requires closed attendance records',
                { date, attendanceRef },
                'error'
            ));
        }
        if (leavePolicy.required && !leavePolicy.policy) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_LEAVE_POLICY_UNDEFINED',
                'Vacation, sick, day off, and unpaid records require an explicit payroll policy',
                { date, attendanceRef, status },
                'error'
            ));
        } else if (leavePolicy.required && !leavePolicy.supported) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_LEAVE_POLICY_UNSUPPORTED',
                'The attendance leave policy is not supported by the canonical payroll calculator',
                { date, attendanceRef, status, leavePolicy: leavePolicy.policy },
                'error'
            ));
        } else if (plannedMinutes > 0 && actualMinutes === 0 && !status) {
            bucket.payrollBlockingIssues.push(payrollIssue(
                'PAYROLL_ATTENDANCE_STATUS_UNRESOLVED',
                'Planned payroll time without worked minutes requires a resolved attendance status',
                { date, attendanceRef, plannedMinutes },
                'error'
            ));
        }
        for (const allocation of additionalAllocations) {
            bucket.additionalProfessionAllocations.push({
                allocationType: SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
                professionKey: normalizeProfessionKey(allocation.professionKey || allocation.profession_key),
                minutes: Math.max(0, toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0)),
                plannedMinutes: Math.max(0, toNumber(allocation.plannedMinutes ?? allocation.planned_minutes, 0)),
                compensationMode: allocation.compensationMode || allocation.compensation_mode || null,
                payMultiplier: allocation.payMultiplier ?? allocation.pay_multiplier ?? null,
                rate: allocation.rate ?? null,
                rateUnit: allocation.rateUnit || allocation.rate_unit || null,
                rateSource: allocation.rateSource || allocation.rate_source || null,
                policyVersion: allocation.policyVersion || allocation.policy_version || null,
                attendanceRef,
                date,
                segmentRef: allocation.segmentId ?? allocation.segment_id ?? null,
                segmentIndex: allocation.segmentIndex ?? allocation.segment_index ?? null,
                roleRef: allocation.roleId ?? allocation.role_id ?? null,
                snapshotVersion: compensationSnapshot?.schemaVersion
                    ?? compensationSnapshot?.schema_version
                    ?? null
            });
        }

        const overtimeAllocation = row.overtime_allocation || row.overtimeAllocation || null;
        const firstSegmentProfession = normalizeProfessionKey(
            segmentAllocations.find(allocation => toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0) > 0)?.professionKey
            || segmentAllocations[0]?.professionKey
            || segmentAllocations[0]?.profession_key
        );
        const primaryProfessionKey = normalizeProfessionKey(
            overtimeAllocation?.professionKey
            || overtimeAllocation?.profession_key
            || row.primary_profession_key
            || firstSegmentProfession
        );
        if (worked && date) bucket.primaryDays.push({ date, professionKey: primaryProfessionKey });
        if (overtimeMinutes > 0) {
            const overtimeKey = primaryProfessionKey || '';
            if (!overtimeMap.has(overtimeKey)) overtimeMap.set(overtimeKey, { minutes: 0, sources: new Set() });
            const entry = overtimeMap.get(overtimeKey);
            entry.minutes += overtimeMinutes;
            entry.sources.add(source);
            bucket.allocationIssues.push({
                code: 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED',
                date,
                professionKey: primaryProfessionKey || null,
                overtimeMinutes,
                message: 'Overtime застосовано один раз до основної професії дня; потрібна звірка'
            });
        }
        for (const issue of row.allocation_issues || row.allocationIssues || []) {
            bucket.allocationIssues.push({ date, ...issue });
        }
        bucket.attendanceDays.push({
            date,
            attendanceRef,
            plannedShiftRef: row.planned_shift_ref || null,
            segmentRefs: segmentAllocations.map(allocation => allocation.segmentId ?? allocation.segment_id)
                .filter(ref => ref !== null && ref !== undefined),
            plannedMinutes,
            paidPlannedMinutes: Math.round(plannedMinutes * leavePolicy.paidPlannedFactor),
            leavePolicy: leavePolicy.policy,
            businessContext: businessContext || null,
            physicalMinutes: actualMinutes,
            baseProfessionMinutes: actualMinutes,
            additionalProfessionMinutes,
            actualMinutes,
            overtimeMinutes,
            allocationSource: source,
            breakPolicy,
            primaryProfessionKey,
            segmentAllocations
        });
    }

    for (const [staffId, bucket] of buckets) {
        bucket.daysWorked = workedDates.get(staffId).size;
        bucket.hoursWorked = Math.round((bucket.totalMinutes / 60) * 10) / 10;
        bucket.overtimeHours = Math.round((bucket.overtimeMinutes / 60) * 10) / 10;
        bucket.professionAllocations = [...professionMaps.get(staffId).entries()]
            .map(([professionKey, value]) => ({
                professionKey,
                minutes: value.minutes,
                allocationSources: [...value.sources].sort()
            }))
            .sort((left, right) => left.professionKey.localeCompare(right.professionKey));
        bucket.baseProfessionAllocations = bucket.professionAllocations.map(allocation => ({ ...allocation }));
        bucket.additionalProfessionAllocations.sort((left, right) => (
            String(left.date || '').localeCompare(String(right.date || ''))
            || String(left.professionKey || '').localeCompare(String(right.professionKey || ''))
            || Number(left.segmentIndex || 0) - Number(right.segmentIndex || 0)
        ));
        const additionalMinutes = bucket.additionalProfessionAllocations.reduce(
            (sum, allocation) => sum + Math.max(0, toNumber(allocation.minutes, 0)),
            0
        );
        bucket.compensationMinutes = bucket.physicalMinutes + additionalMinutes;
        bucket.roleMinutes = bucket.compensationMinutes;
        bucket.overtimeAllocations = [...overtimeMaps.get(staffId).entries()]
            .map(([professionKey, value]) => ({
                professionKey: professionKey || null,
                minutes: value.minutes,
                allocationSources: [...value.sources].sort()
            }))
            .sort((left, right) => String(left.professionKey || '').localeCompare(String(right.professionKey || '')));
        bucket.primaryDays = [...new Map(bucket.primaryDays.map(day => [day.date, day])).values()]
            .sort((left, right) => left.date.localeCompare(right.date));
        bucket.breakPolicies = [...new Set(bucket.attendanceDays.map(day => day.breakPolicy).filter(Boolean))].sort();
        bucket.allocationIssues = compactAllocationIssues(bucket.allocationIssues);
        bucket.payrollBlockingIssues = compactAllocationIssues(bucket.payrollBlockingIssues);
        bucket.reconciliation = buildPayrollSourceReconciliation(bucket.attendanceDays);
        bucket.reconciliation.warnings.push(...bucket.allocationIssues);
        bucket.reconciliation.blockingIssues = [...bucket.payrollBlockingIssues];
    }
    return buckets;
}

async function loadProfessionRateMap(staffIds = [], db = pool) {
    const ids = [...new Set(staffIds.map(Number).filter(Number.isInteger))];
    if (!ids.length) return new Map();
    const result = await db.query(
        `SELECT staff_id, profession_key, hourly_rate
         FROM staff_profession_rates
         WHERE staff_id = ANY($1::int[])`,
        [ids]
    );
    return new Map(result.rows.map(row => [
        `${Number(row.staff_id)}:${normalizeProfessionKey(row.profession_key)}`,
        toNumber(row.hourly_rate, 0)
    ]));
}

function emptyPayrollProfileContext(range = {}, enabled = true) {
    return {
        enabled,
        from: normalizeDateValue(range.from) || null,
        to: normalizeDateValue(range.to) || null,
        profilesById: new Map(),
        assignmentsByStaffProfession: new Map(),
        defaultProfilesByProfession: new Map(),
        warnings: []
    };
}

function normalizePayrollProfileRange(period) {
    if (typeof period === 'string') {
        return getMonthBounds(assertPayrollMonth(normalizePayrollMonth(period)));
    }
    const from = normalizeDateValue(period?.from);
    const to = normalizeDateValue(period?.to);
    if (from && to) return { from, to };
    if (period?.month) return getMonthBounds(assertPayrollMonth(normalizePayrollMonth(period.month)));
    return getMonthBounds(normalizePayrollMonth());
}

function mapPayrollProfileFromRow(row) {
    if (!row) return null;
    const id = nullableNumber(row.profile_id ?? row.id);
    if (!id) return null;
    return {
        id,
        title: row.profile_title || row.title || '',
        professionKey: normalizeProfessionKey(row.profile_profession_key || row.profession_key),
        profileKind: row.profile_kind || 'shared',
        ownerStaffId: nullableNumber(row.owner_staff_id),
        isDefaultForProfession: row.is_default_for_profession === true,
        sourceProfileId: nullableNumber(row.source_profile_id),
        sourceVersionId: nullableNumber(row.source_version_id),
        status: row.profile_status || row.status || 'draft',
        versions: []
    };
}

function mapPayrollProfileVersion(row, dayRateMap = new Map()) {
    const id = nullableNumber(row.id ?? row.version_id);
    const profileId = nullableNumber(row.profile_id);
    const dayRates = dayRateMap.get(id) || new Map();
    return {
        id,
        profileId,
        versionNumber: Number(row.version_number || 0),
        rateUnit: normalizeStaffRateUnit(row.rate_unit),
        defaultRate: toNumber(row.default_rate, 0),
        effectiveFrom: normalizeDateValue(row.effective_from),
        effectiveTo: normalizeDateValue(row.effective_to),
        changeReason: row.change_reason || null,
        dayRates,
        day_rates: [...dayRates.entries()]
            .map(([isoWeekday, rate]) => ({ iso_weekday: isoWeekday, isoWeekday, rate }))
            .sort((left, right) => left.iso_weekday - right.iso_weekday)
    };
}

function mapPayrollProfileAssignment(row, profile) {
    return {
        id: nullableNumber(row.assignment_id ?? row.id),
        staffId: Number(row.staff_id),
        professionKey: normalizeProfessionKey(row.assignment_profession_key || row.profession_key),
        profileId: nullableNumber(row.profile_id),
        assignmentKind: row.assignment_kind || 'explicit',
        effectiveFrom: normalizeDateValue(row.effective_from),
        effectiveTo: normalizeDateValue(row.effective_to),
        profile
    };
}

function payrollProfileContextEnabled(context) {
    return context && context.enabled === true;
}

function addPayrollProfileToContext(context, row) {
    const profile = mapPayrollProfileFromRow(row);
    if (!profile) return null;
    const existing = context.profilesById.get(profile.id);
    if (existing) return existing;
    context.profilesById.set(profile.id, profile);
    return profile;
}

async function loadPayrollProfileContext(staffIds = [], period = {}, db = pool) {
    const ids = [...new Set((staffIds || []).map(Number).filter(Number.isInteger))];
    const range = normalizePayrollProfileRange(period);
    const context = emptyPayrollProfileContext(range, true);
    if (!ids.length) return context;

    try {
        const assignmentResult = await db.query(
            `SELECT assignment.id AS assignment_id,
                    assignment.staff_id,
                    assignment.profession_key AS assignment_profession_key,
                    assignment.profile_id,
                    assignment.assignment_kind,
                    assignment.effective_from,
                    assignment.effective_to,
                    profile.id AS profile_id,
                    profile.title AS profile_title,
                    profile.profession_key AS profile_profession_key,
                    profile.profile_kind,
                    profile.owner_staff_id,
                    profile.is_default_for_profession,
                    profile.source_profile_id,
                    profile.source_version_id,
                    profile.status AS profile_status
             FROM staff_payroll_profile_assignments assignment
             JOIN payroll_profiles profile ON profile.id = assignment.profile_id
             WHERE assignment.staff_id = ANY($1::int[])
               AND profile.status = 'active'
               AND assignment.effective_from <= $3::date
               AND (assignment.effective_to IS NULL OR assignment.effective_to >= $2::date)
             ORDER BY assignment.staff_id,
                      assignment.profession_key,
                      assignment.assignment_kind DESC,
                      assignment.effective_from DESC,
                      assignment.id DESC`,
            [ids, range.from, range.to]
        );
        const defaultResult = await db.query(
            `SELECT profile.id AS profile_id,
                    profile.title AS profile_title,
                    profile.profession_key AS profile_profession_key,
                    profile.profile_kind,
                    profile.owner_staff_id,
                    profile.is_default_for_profession,
                    profile.source_profile_id,
                    profile.source_version_id,
                    profile.status AS profile_status
             FROM payroll_profiles profile
             WHERE profile.status = 'active'
               AND profile.profile_kind = 'shared'
               AND profile.is_default_for_profession = true
             ORDER BY profile.profession_key, profile.updated_at DESC, profile.id DESC`
        );

        for (const row of assignmentResult.rows || []) {
            const profile = addPayrollProfileToContext(context, row);
            if (!profile) continue;
            const assignment = mapPayrollProfileAssignment(row, profile);
            const key = `${assignment.staffId}:${assignment.professionKey}`;
            if (!context.assignmentsByStaffProfession.has(key)) {
                context.assignmentsByStaffProfession.set(key, []);
            }
            context.assignmentsByStaffProfession.get(key).push(assignment);
        }

        for (const row of defaultResult.rows || []) {
            const profile = addPayrollProfileToContext(context, row);
            if (profile && !context.defaultProfilesByProfession.has(profile.professionKey)) {
                context.defaultProfilesByProfession.set(profile.professionKey, profile);
            }
        }

        const profileIds = [...context.profilesById.keys()];
        if (!profileIds.length) return context;

        const versionResult = await db.query(
            `SELECT id,
                    profile_id,
                    version_number,
                    rate_unit,
                    default_rate,
                    effective_from,
                    effective_to,
                    change_reason
             FROM payroll_profile_versions
             WHERE profile_id = ANY($1::bigint[])
               AND effective_from <= $3::date
               AND (effective_to IS NULL OR effective_to >= $2::date)
             ORDER BY profile_id, effective_from ASC, version_number ASC, id ASC`,
            [profileIds, range.from, range.to]
        );
        const versionIds = (versionResult.rows || []).map(row => Number(row.id)).filter(Number.isInteger);
        const dayRateMap = new Map();
        if (versionIds.length) {
            const dayRateResult = await db.query(
                `SELECT profile_version_id, iso_weekday, rate
                 FROM payroll_profile_day_rates
                 WHERE profile_version_id = ANY($1::bigint[])
                 ORDER BY profile_version_id, iso_weekday`,
                [versionIds]
            );
            for (const row of dayRateResult.rows || []) {
                const versionId = Number(row.profile_version_id);
                if (!dayRateMap.has(versionId)) dayRateMap.set(versionId, new Map());
                dayRateMap.get(versionId).set(Number(row.iso_weekday), toNumber(row.rate, 0));
            }
        }
        for (const row of versionResult.rows || []) {
            const version = mapPayrollProfileVersion(row, dayRateMap);
            const profile = context.profilesById.get(version.profileId);
            if (profile) profile.versions.push(version);
        }
        for (const profile of context.profilesById.values()) {
            profile.versions.sort((left, right) => (
                String(left.effectiveFrom || '').localeCompare(String(right.effectiveFrom || ''))
                || left.versionNumber - right.versionNumber
                || left.id - right.id
            ));
        }
        return context;
    } catch (err) {
        if (!isMissingPayrollProfileSchemaError(err)) {
            log.warn('payroll profile context query failed:', err.message);
        }
        return {
            ...emptyPayrollProfileContext(range, false),
            warnings: [{
                code: 'PAYROLL_PROFILE_CONTEXT_UNAVAILABLE',
                message: err.message
            }]
        };
    }
}

function schemeRateFallback(scheme, rateUnit) {
    const config = parseConfig(scheme?.config || scheme?.config_json);
    if (rateUnit === 'month') return toNumber(config.monthlyAmount ?? config.fixedAmount ?? config.amount, 0);
    if (rateUnit === 'day') return toNumber(config.perShiftRate ?? config.rate ?? config.amount, 0);
    return toNumber(config.hourlyRate ?? config.rate ?? config.amount, 0);
}

function resolveProfessionPayRate(staff, professionKey, scheme, professionRateMap, rateUnit) {
    const staffId = Number(staff.id ?? staff.staff_id);
    const normalizedKey = normalizeProfessionKey(professionKey || staff.roleType || staff.role_type);
    const normalizedRateUnit = normalizeStaffRateUnit(rateUnit);
    if (normalizedRateUnit === 'hour') {
        const professionRate = professionRateMap.get(`${staffId}:${normalizedKey}`);
        if (professionRate > 0) {
            return { rate: professionRate, source: 'staff_profession_rates.hourly_rate', rateUnit: 'hour' };
        }
    }
    const schemeRate = schemeRateFallback(scheme, normalizedRateUnit);
    if (schemeRate > 0) {
        return {
            rate: schemeRate,
            source: scheme?.isFallback ? 'staff.hourly_rate' : 'payroll_scheme',
            rateUnit: normalizedRateUnit
        };
    }
    const staffRateUnit = normalizeStaffRateUnit(staff.rateUnit ?? staff.rate_unit);
    if (staffRateUnit === normalizedRateUnit) {
        return {
            rate: toNumber(staff.hourlyRate ?? staff.hourly_rate, 0),
            source: 'staff.hourly_rate',
            rateUnit: normalizedRateUnit
        };
    }
    return {
        rate: 0,
        source: 'unresolved',
        rateUnit: normalizedRateUnit
    };
}

function isDateWithinRange(date, from, to) {
    const value = normalizeDateValue(date);
    if (!value) return false;
    return (!from || value >= from) && (!to || value <= to);
}

function isoWeekdayForDate(date) {
    const value = normalizeDateValue(date);
    if (!value) return null;
    const weekday = new Date(`${value}T00:00:00.000Z`).getUTCDay();
    return weekday === 0 ? 7 : weekday;
}

function payrollProfileVersionForDate(profile, workDate) {
    const date = normalizeDateValue(workDate);
    if (!profile || !date) return null;
    return [...(profile.versions || [])]
        .filter(version => isDateWithinRange(date, version.effectiveFrom, version.effectiveTo))
        .sort((left, right) => (
            String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || ''))
            || right.versionNumber - left.versionNumber
            || right.id - left.id
        ))[0] || null;
}

function activePayrollProfileAssignments(context, staffId, professionKey, workDate, assignmentKind) {
    const date = normalizeDateValue(workDate);
    const key = `${Number(staffId)}:${normalizeProfessionKey(professionKey)}`;
    const assignments = context?.assignmentsByStaffProfession?.get(key) || [];
    return assignments
        .filter(assignment => assignment.assignmentKind === assignmentKind)
        .filter(assignment => isDateWithinRange(date, assignment.effectiveFrom, assignment.effectiveTo))
        .sort((left, right) => (
            String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || ''))
            || Number(right.id || 0) - Number(left.id || 0)
        ));
}

function payrollProfileRateSource(sourceOrder, appliedRule) {
    const base = {
        temporary_assignment: 'payroll_profile.assignment.temporary',
        explicit_assignment: 'payroll_profile.assignment.explicit',
        default_profile: 'payroll_profile.default'
    }[sourceOrder] || 'payroll_profile';
    return appliedRule === 'weekday_override' ? `${base}.day_rate` : `${base}.default_rate`;
}

function profileResolution(profile, version, workDate, sourceOrder, assignment = null, warnings = []) {
    const isoWeekday = isoWeekdayForDate(workDate);
    const hasDayOverride = version.rateUnit !== 'month'
        && isoWeekday
        && version.dayRates instanceof Map
        && version.dayRates.has(isoWeekday);
    const appliedRule = hasDayOverride ? 'weekday_override' : 'default_rate';
    const rate = hasDayOverride ? version.dayRates.get(isoWeekday) : version.defaultRate;
    return {
        applies: true,
        rate: toNumber(rate, 0),
        source: payrollProfileRateSource(sourceOrder, appliedRule),
        rateSource: payrollProfileRateSource(sourceOrder, appliedRule),
        sourceOrder,
        rateUnit: version.rateUnit,
        professionKey: profile.professionKey,
        workDate: normalizeDateValue(workDate),
        isoWeekday,
        appliedRule,
        profileId: profile.id,
        profileVersionId: version.id,
        profileTitle: profile.title,
        profileKind: profile.profileKind,
        sourceProfileId: profile.sourceProfileId,
        sourceVersionId: profile.sourceVersionId,
        assignmentId: assignment?.id || null,
        assignmentKind: assignment?.assignmentKind || null,
        warnings
    };
}

function legacySourceOrder(source) {
    if (source === 'staff_profession_rates.hourly_rate') return 'legacy_staff_profession_rates';
    if (source === 'payroll_scheme') return 'legacy_payroll_schemes';
    if (source === 'staff.hourly_rate') return 'legacy_staff_hourly_rate';
    return 'unresolved';
}

function unresolvedRateWarning(staff, professionKey, workDate, rateUnit) {
    return {
        code: 'PAYROLL_RATE_UNRESOLVED',
        staffId: Number(staff?.id ?? staff?.staff_id) || null,
        professionKey: normalizeProfessionKey(professionKey || staff?.roleType || staff?.role_type) || null,
        date: normalizeDateValue(workDate),
        rateUnit: normalizeStaffRateUnit(rateUnit),
        message: 'Payroll base rate is unresolved for staff/profession/date'
    };
}

function resolveEffectivePayrollProfile(staff, profession, workDate, options = {}) {
    const context = options.payrollProfileContext || options.profileContext || null;
    const staffId = Number(staff?.id ?? staff?.staff_id);
    const professionKey = normalizeProfessionKey(profession || staff?.roleType || staff?.role_type);
    const date = normalizeDateValue(workDate) || context?.from || null;
    const warnings = [];

    if (payrollProfileContextEnabled(context) && staffId && professionKey && date) {
        const orderedProfileSources = [
            ...activePayrollProfileAssignments(context, staffId, professionKey, date, 'temporary')
                .map(assignment => ({ sourceOrder: 'temporary_assignment', assignment, profile: assignment.profile })),
            ...activePayrollProfileAssignments(context, staffId, professionKey, date, 'explicit')
                .map(assignment => ({ sourceOrder: 'explicit_assignment', assignment, profile: assignment.profile })),
            {
                sourceOrder: 'default_profile',
                assignment: null,
                profile: context.defaultProfilesByProfession?.get(professionKey) || null
            }
        ];

        for (const candidate of orderedProfileSources) {
            if (!candidate.profile || candidate.profile.status !== 'active') continue;
            const version = payrollProfileVersionForDate(candidate.profile, date);
            if (!version) {
                warnings.push({
                    code: 'PAYROLL_PROFILE_VERSION_UNRESOLVED',
                    staffId,
                    professionKey,
                    profileId: candidate.profile.id,
                    date,
                    sourceOrder: candidate.sourceOrder,
                    message: 'Payroll profile has no active version for this date'
                });
                continue;
            }
            return profileResolution(candidate.profile, version, date, candidate.sourceOrder, candidate.assignment, warnings);
        }
    }

    const legacyRateUnit = normalizeStaffRateUnit(options.preferredRateUnit || options.rateUnit || staff?.rateUnit || staff?.rate_unit);
    const legacy = resolveProfessionPayRate(
        staff || {},
        professionKey,
        options.scheme || null,
        options.professionRateMap || new Map(),
        legacyRateUnit
    );
    const sourceOrder = legacySourceOrder(legacy.source);
    if (sourceOrder === 'unresolved' || toNumber(legacy.rate, 0) <= 0) {
        warnings.push(unresolvedRateWarning(staff, professionKey, date, legacy.rateUnit));
    }
    return {
        applies: false,
        rate: legacy.rate,
        source: legacy.source,
        rateSource: legacy.source,
        sourceOrder,
        rateUnit: legacy.rateUnit,
        professionKey,
        workDate: date,
        isoWeekday: isoWeekdayForDate(date),
        appliedRule: sourceOrder === 'unresolved' ? 'unresolved' : 'legacy_rate',
        profileId: null,
        profileVersionId: null,
        profileTitle: null,
        profileKind: null,
        sourceProfileId: null,
        sourceVersionId: null,
        assignmentId: null,
        assignmentKind: null,
        warnings
    };
}

function professionSummaryRow({
    professionKey,
    minutes,
    days = 0,
    rate,
    amount,
    rateUnit,
    sources,
    rateSource,
    kind = 'base',
    resolution = null,
    workDate = null,
    appliedRule = null,
    formula = null
}) {
    const allocationSources = [...new Set((sources || []).filter(Boolean))].sort();
    const profileId = nullableNumber(resolution?.profileId);
    const profileVersionId = nullableNumber(resolution?.profileVersionId);
    const normalizedWorkDate = normalizeDateValue(workDate || resolution?.workDate);
    return {
        profession: professionKey || null,
        profession_key: professionKey || null,
        professionKey: professionKey || null,
        actual_minutes: Math.max(0, Math.round(minutes || 0)),
        actual_hours: Math.round((Math.max(0, minutes || 0) / 60) * 100) / 100,
        hours: Math.round((Math.max(0, minutes || 0) / 60) * 10) / 10,
        days,
        rate,
        rate_unit: rateUnit,
        amount,
        allocation_source: allocationSources.length === 1 ? allocationSources[0] : allocationSources.join(','),
        allocation_sources: allocationSources,
        rate_source: rateSource,
        rate_source_order: resolution?.sourceOrder || null,
        profile_id: profileId,
        profileId,
        profile_version_id: profileVersionId,
        profileVersionId,
        profile_title: resolution?.profileTitle || null,
        profileTitle: resolution?.profileTitle || null,
        profile_kind: resolution?.profileKind || null,
        assignment_id: nullableNumber(resolution?.assignmentId),
        assignment_kind: resolution?.assignmentKind || null,
        work_date: normalizedWorkDate,
        workDate: normalizedWorkDate,
        iso_weekday: resolution?.isoWeekday || isoWeekdayForDate(normalizedWorkDate),
        applied_rule: appliedRule || resolution?.appliedRule || null,
        formula: formula || null,
        kind
    };
}

function firstPositiveSegmentProfession(segmentAllocations = []) {
    return normalizeProfessionKey(
        segmentAllocations.find(allocation => toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0) > 0)?.professionKey
        || segmentAllocations.find(allocation => toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0) > 0)?.profession_key
        || segmentAllocations[0]?.professionKey
        || segmentAllocations[0]?.profession_key
    );
}

function addDailyAllocation(map, { date, professionKey, minutes, source }) {
    const normalizedDate = normalizeDateValue(date);
    const normalizedProfession = normalizeProfessionKey(professionKey);
    const actualMinutes = Math.max(0, toNumber(minutes, 0));
    if (!normalizedDate || !normalizedProfession || actualMinutes <= 0) return;
    const key = `${normalizedDate}:${normalizedProfession}`;
    if (!map.has(key)) {
        map.set(key, {
            date: normalizedDate,
            professionKey: normalizedProfession,
            minutes: 0,
            allocationSources: new Set()
        });
    }
    const entry = map.get(key);
    entry.minutes += actualMinutes;
    if (source) entry.allocationSources.add(source);
}

function buildDailyProfessionAllocations(metrics, fallbackProfessionKey) {
    const map = new Map();
    for (const day of metrics.attendanceDays || []) {
        const date = normalizeDateValue(day.date);
        const source = day.allocationSource || day.allocation_source || 'attendance_day';
        const segmentAllocations = Array.isArray(day.segmentAllocations)
            ? day.segmentAllocations
            : (Array.isArray(day.segment_allocations) ? day.segment_allocations : []);
        let segmentMinutes = 0;
        for (const allocation of segmentAllocations) {
            const minutes = Math.max(0, toNumber(allocation.actualMinutes ?? allocation.actual_minutes, 0));
            segmentMinutes += minutes;
            addDailyAllocation(map, {
                date,
                professionKey: allocation.professionKey || allocation.profession_key,
                minutes,
                source
            });
        }
        if (segmentMinutes <= 0) {
            addDailyAllocation(map, {
                date,
                professionKey: day.primaryProfessionKey || day.primary_profession_key || fallbackProfessionKey,
                minutes: day.actualMinutes ?? day.actual_minutes ?? day.allocatedMinutes ?? day.allocated_minutes,
                source
            });
        }
    }
    if (!map.size) {
        const fallbackDate = normalizeDateValue(metrics.primaryDays?.[0]?.date || metrics.attendanceDays?.[0]?.date);
        for (const allocation of metrics.professionAllocations || []) {
            addDailyAllocation(map, {
                date: fallbackDate,
                professionKey: allocation.professionKey || fallbackProfessionKey,
                minutes: allocation.minutes,
                source: (allocation.allocationSources || [])[0] || 'legacy_profession_allocation'
            });
        }
    }
    return [...map.values()]
        .map(entry => ({
            ...entry,
            allocationSources: [...entry.allocationSources].sort()
        }))
        .sort((left, right) => (
            left.date.localeCompare(right.date)
            || left.professionKey.localeCompare(right.professionKey)
        ));
}

function buildPrimaryDayEntries(metrics, fallbackProfessionKey, dailyAllocations = []) {
    const map = new Map();
    for (const day of metrics.primaryDays || []) {
        const date = normalizeDateValue(day.date);
        if (!date || map.has(date)) continue;
        map.set(date, {
            date,
            professionKey: normalizeProfessionKey(day.professionKey || fallbackProfessionKey),
            allocationSources: new Set(['primary_day'])
        });
    }
    for (const day of metrics.attendanceDays || []) {
        const date = normalizeDateValue(day.date);
        if (!date || map.has(date)) continue;
        const segmentAllocations = Array.isArray(day.segmentAllocations)
            ? day.segmentAllocations
            : (Array.isArray(day.segment_allocations) ? day.segment_allocations : []);
        const professionKey = normalizeProfessionKey(
            day.primaryProfessionKey
            || day.primary_profession_key
            || firstPositiveSegmentProfession(segmentAllocations)
            || fallbackProfessionKey
        );
        map.set(date, {
            date,
            professionKey,
            allocationSources: new Set([day.allocationSource || day.allocation_source || 'attendance_day'])
        });
    }
    if (!map.size && metrics.daysWorked > 0) {
        const dates = (metrics.attendanceDays || []).map(day => normalizeDateValue(day.date)).filter(Boolean);
        if (dates.length) {
            for (const date of [...new Set(dates)].sort()) {
                map.set(date, {
                    date,
                    professionKey: fallbackProfessionKey,
                    allocationSources: new Set(['legacy_day_count'])
                });
            }
        } else {
            map.set('', {
                date: null,
                professionKey: fallbackProfessionKey,
                allocationSources: new Set(['legacy_day_count']),
                days: metrics.daysWorked
            });
        }
    }
    for (const allocation of dailyAllocations) {
        if (!map.has(allocation.date)) continue;
        for (const source of allocation.allocationSources || []) {
            map.get(allocation.date).allocationSources.add(source);
        }
    }
    return [...map.values()]
        .map(entry => ({
            ...entry,
            allocationSources: [...entry.allocationSources].filter(Boolean).sort(),
            days: Number(entry.days || 1)
        }))
        .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
}

function buildDailyOvertimeEntries(metrics, fallbackProfessionKey) {
    const map = new Map();
    for (const day of metrics.attendanceDays || []) {
        const date = normalizeDateValue(day.date);
        const overtimeMinutes = Math.max(0, toNumber(day.overtimeMinutes ?? day.overtime_minutes, 0));
        if (!date || overtimeMinutes <= 0) continue;
        const segmentAllocations = Array.isArray(day.segmentAllocations)
            ? day.segmentAllocations
            : (Array.isArray(day.segment_allocations) ? day.segment_allocations : []);
        const professionKey = normalizeProfessionKey(
            day.primaryProfessionKey
            || day.primary_profession_key
            || firstPositiveSegmentProfession(segmentAllocations)
            || fallbackProfessionKey
        );
        const key = `${date}:${professionKey}`;
        if (!map.has(key)) {
            map.set(key, {
                date,
                professionKey,
                minutes: 0,
                allocationSources: new Set()
            });
        }
        const entry = map.get(key);
        entry.minutes += overtimeMinutes;
        entry.allocationSources.add(day.allocationSource || day.allocation_source || 'attendance_day');
    }
    if (!map.size) {
        const fallbackDate = normalizeDateValue(metrics.primaryDays?.[0]?.date || metrics.attendanceDays?.[0]?.date);
        for (const allocation of metrics.overtimeAllocations || []) {
            const professionKey = normalizeProfessionKey(allocation.professionKey || fallbackProfessionKey);
            const key = `${fallbackDate || ''}:${professionKey}`;
            if (!map.has(key)) {
                map.set(key, {
                    date: fallbackDate,
                    professionKey,
                    minutes: 0,
                    allocationSources: new Set()
                });
            }
            const entry = map.get(key);
            entry.minutes += Math.max(0, toNumber(allocation.minutes, 0));
            for (const source of allocation.allocationSources || []) entry.allocationSources.add(source);
        }
    }
    return [...map.values()]
        .map(entry => ({
            ...entry,
            allocationSources: [...entry.allocationSources].filter(Boolean).sort()
        }))
        .filter(entry => entry.minutes > 0)
        .sort((left, right) => (
            String(left.date || '').localeCompare(String(right.date || ''))
            || String(left.professionKey || '').localeCompare(String(right.professionKey || ''))
        ));
}

function sumAllocationMinutesForDate(dailyAllocations, date) {
    const normalizedDate = normalizeDateValue(date);
    return dailyAllocations
        .filter(allocation => normalizeDateValue(allocation.date) === normalizedDate)
        .reduce((sum, allocation) => sum + Math.max(0, toNumber(allocation.minutes, 0)), 0);
}

function collectResolutionWarnings(target, resolution) {
    for (const warning of resolution?.warnings || []) target.push(warning);
}

function payrollFormula(type, quantity, rate, multiplier = null) {
    const roundedQuantity = Math.round(toNumber(quantity, 0) * 100) / 100;
    if (type === 'hour') return `${roundedQuantity}h × ${rate}`;
    if (type === 'overtime') return `${roundedQuantity}h × ${rate} × ${multiplier}`;
    if (type === 'day') return `${roundedQuantity}d × ${rate}`;
    if (type === 'month') return `1 × ${rate}`;
    return `${roundedQuantity} × ${rate}`;
}

function buildSimultaneousAdditionalPay(metrics = {}) {
    const lines = [];
    const professionRateSummary = [];
    const blockingIssues = [...(metrics.payrollBlockingIssues || [])];
    for (const allocation of metrics.additionalProfessionAllocations || []) {
        const resolved = resolveSimultaneousAdditionalRate(allocation);
        if (!resolved.ok) {
            blockingIssues.push({
                date: allocation.date || null,
                ...resolved.issue
            });
            continue;
        }
        const minutes = Math.max(0, toNumber(allocation.minutes, 0));
        if (minutes <= 0) continue;
        const hours = minutes / 60;
        const amount = roundMoney(hours * resolved.rate * resolved.multiplier);
        const formula = `${minutes} / 60 * ${resolved.rate} * ${resolved.multiplier}`;
        if (amount <= 0) {
            blockingIssues.push(payrollIssue(
                PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE,
                PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_MESSAGE,
                {
                    date: allocation.date || null,
                    professionKey: resolved.professionKey,
                    minutes,
                    paidRoleMinutes: minutes,
                    attendanceRef: allocation.attendanceRef ?? null,
                    segmentRef: allocation.segmentRef ?? null,
                    roleRef: allocation.roleRef ?? null
                },
                'error'
            ));
            continue;
        }
        const common = {
            professionKey: resolved.professionKey,
            minutes,
            rate: resolved.rate,
            rateSource: resolved.rateSource,
            multiplier: resolved.multiplier,
            attendanceRef: allocation.attendanceRef ?? null,
            segmentRef: allocation.segmentRef ?? null,
            segmentIndex: allocation.segmentIndex ?? null,
            roleRef: allocation.roleRef ?? null,
            policyVersion: resolved.policyVersion,
            workDate: allocation.date || null,
            formula
        };
        lines.push({
            ...line(
                'additional',
                SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
                `Simultaneous additional: ${resolved.professionKey}`,
                amount,
                {
                    quantity: hours,
                    rate: resolved.rate,
                    source: resolved.rateSource,
                    meta: {
                        ...common,
                        snapshotVersion: allocation.snapshotVersion ?? null,
                        compensationMode: allocation.compensationMode || null
                    }
                }
            ),
            ...common
        });
        professionRateSummary.push(professionSummaryRow({
            professionKey: resolved.professionKey,
            minutes,
            rate: resolved.rate,
            amount,
            rateUnit: 'hour',
            sources: ['attendance_compensation_snapshot'],
            rateSource: resolved.rateSource,
            kind: SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
            workDate: allocation.date,
            appliedRule: 'immutable_attendance_snapshot',
            formula
        }));
    }
    return {
        lines,
        amount: lines.reduce((sum, item) => sum + toNumber(item.amount, 0), 0),
        professionRateSummary,
        blockingIssues: compactAllocationIssues(blockingIssues)
    };
}

function attachSimultaneousAdditionalPay(result, metrics = {}) {
    const additional = buildSimultaneousAdditionalPay(metrics);
    const allocationIssues = compactAllocationIssues([
        ...(result.allocationIssues || []),
        ...additional.blockingIssues
    ]);
    const reconciliation = {
        ...(result.reconciliation || metrics.reconciliation || {}),
        days: [...(result.reconciliation?.days || metrics.reconciliation?.days || [])],
        warnings: [...(result.reconciliation?.warnings || metrics.reconciliation?.warnings || [])],
        ...(additional.blockingIssues.length
            ? { blockingIssues: [...additional.blockingIssues] }
            : {})
    };
    for (const issue of additional.blockingIssues) {
        const exists = reconciliation.warnings.some(warning => (
            warning.code === issue.code
            && String(warning.date || '') === String(issue.date || '')
            && String(warning.professionKey || '') === String(issue.professionKey || '')
        ));
        if (!exists) reconciliation.warnings.push(issue);
    }
    return {
        ...result,
        additionalLines: additional.lines,
        additionalAmount: additional.amount,
        totalAmount: toNumber(result.baseAmount, 0)
            + toNumber(result.overtimeAmount, 0)
            + additional.amount,
        professionRateSummary: [
            ...(result.professionRateSummary || []),
            ...additional.professionRateSummary
        ],
        allocationIssues,
        blockingIssues: additional.blockingIssues,
        reconciliation
    };
}

function buildUnsupportedSimultaneousAdditionalSchemeIssues(metrics = {}, schemeType = '') {
    const allocations = Array.isArray(metrics.additionalProfessionAllocations)
        ? metrics.additionalProfessionAllocations
        : [];
    const grouped = new Map();
    for (const allocation of allocations) {
        const compensationMode = String(
            allocation.compensationMode || allocation.compensation_mode || ''
        ).trim();
        const minutes = Math.max(0, toNumber(
            allocation.minutes ?? allocation.actualMinutes ?? allocation.actual_minutes,
            0
        ));
        if (compensationMode !== 'paid_hourly' || minutes <= 0) continue;
        const professionKey = normalizeProfessionKey(
            allocation.professionKey || allocation.profession_key
        );
        const date = String(allocation.date || allocation.workDate || allocation.work_date || '').slice(0, 10);
        const key = `${date}:${professionKey || ''}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                date: date || null,
                professionKey: professionKey || null,
                minutes: 0,
                attendanceRefs: new Set(),
                segmentRefs: new Set(),
                roleRefs: new Set()
            });
        }
        const group = grouped.get(key);
        group.minutes += minutes;
        const attendanceRef = allocation.attendanceRef ?? allocation.attendance_ref;
        const segmentRef = allocation.segmentRef ?? allocation.segment_ref
            ?? allocation.segmentId ?? allocation.segment_id;
        const roleRef = allocation.roleRef ?? allocation.role_ref
            ?? allocation.roleId ?? allocation.role_id;
        if (attendanceRef !== null && attendanceRef !== undefined) group.attendanceRefs.add(attendanceRef);
        if (segmentRef !== null && segmentRef !== undefined) group.segmentRefs.add(segmentRef);
        if (roleRef !== null && roleRef !== undefined) group.roleRefs.add(roleRef);
    }
    return [...grouped.values()].map(group => payrollIssue(
        PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED,
        PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_MESSAGE,
        {
            schemeType: String(schemeType || '').trim() || null,
            date: group.date,
            professionKey: group.professionKey,
            minutes: group.minutes,
            paidRoleMinutes: group.minutes,
            paidRoleHours: roundHoursFromMinutes(group.minutes),
            attendanceRefs: [...group.attendanceRefs],
            segmentRefs: [...group.segmentRefs],
            roleRefs: [...group.roleRefs]
        },
        'error'
    ));
}

function applySimultaneousAdditionalPayPolicy(result, metrics = {}, schemeType = 'hourly') {
    if (['hourly', 'per_shift', 'monthly_fixed'].includes(schemeType)) {
        return attachSimultaneousAdditionalPay(result, metrics);
    }
    const unsupportedIssues = buildUnsupportedSimultaneousAdditionalSchemeIssues(metrics, schemeType);
    const blockingIssues = compactAllocationIssues([
        ...(metrics.payrollBlockingIssues || []),
        ...(metrics.reconciliation?.blockingIssues || []),
        ...unsupportedIssues
    ]);
    const allocationIssues = compactAllocationIssues([
        ...(result.allocationIssues || []),
        ...blockingIssues
    ]);
    const reconciliation = {
        ...(result.reconciliation || metrics.reconciliation || {}),
        days: [...(result.reconciliation?.days || metrics.reconciliation?.days || [])],
        warnings: [...(result.reconciliation?.warnings || metrics.reconciliation?.warnings || [])],
        ...(blockingIssues.length ? { blockingIssues: [...blockingIssues] } : {})
    };
    for (const issue of blockingIssues) {
        const exists = reconciliation.warnings.some(warning => (
            warning.code === issue.code
            && String(warning.date || '') === String(issue.date || '')
            && String(warning.professionKey || '') === String(issue.professionKey || '')
        ));
        if (!exists) reconciliation.warnings.push(issue);
    }
    return {
        ...result,
        additionalLines: [],
        additionalAmount: 0,
        totalAmount: toNumber(result.baseAmount, 0) + toNumber(result.overtimeAmount, 0),
        allocationIssues,
        blockingIssues,
        reconciliation
    };
}

function buildPayrollTransparencyMetrics(metrics = {}, professionPay = {}) {
    const physicalMinutes = Math.max(0, toNumber(
        metrics.physicalMinutes ?? metrics.physical_minutes ?? metrics.totalMinutes ?? metrics.total_minutes,
        0
    ));
    const baseAllocations = Array.isArray(metrics.baseProfessionAllocations)
        ? metrics.baseProfessionAllocations
        : (Array.isArray(metrics.base_profession_allocations)
            ? metrics.base_profession_allocations
            : []);
    const additionalAllocations = Array.isArray(metrics.additionalProfessionAllocations)
        ? metrics.additionalProfessionAllocations
        : (Array.isArray(metrics.additional_profession_allocations)
            ? metrics.additional_profession_allocations
            : []);
    const baseAllocatedMinutes = baseAllocations.reduce(
        (sum, allocation) => sum + Math.max(
            0,
            toNumber(allocation.minutes ?? allocation.actualMinutes ?? allocation.actual_minutes, 0)
        ),
        0
    );
    const baseRoleMinutes = baseAllocations.length ? baseAllocatedMinutes : physicalMinutes;
    const additionalRoleMinutes = additionalAllocations.reduce(
        (sum, allocation) => sum + Math.max(
            0,
            toNumber(allocation.minutes ?? allocation.actualMinutes ?? allocation.actual_minutes, 0)
        ),
        0
    );
    const additionalLines = [
        ...(professionPay.additionalLines || []),
        ...(professionPay.lines || []).filter(lineItem =>
            lineItem?.lineType === SIMULTANEOUS_ADDITIONAL_LINE_TYPE
            || lineItem?.line_type === SIMULTANEOUS_ADDITIONAL_LINE_TYPE)
    ];
    const uniqueAdditionalLines = [...new Map(additionalLines.map(lineItem => [
        [
            lineItem.attendanceRef ?? lineItem.attendance_ref ?? '',
            lineItem.segmentRef ?? lineItem.segment_ref ?? '',
            lineItem.roleRef ?? lineItem.role_ref ?? '',
            lineItem.professionKey ?? lineItem.profession_key ?? ''
        ].join(':'),
        lineItem
    ])).values()];
    const roleDetails = additionalAllocations.map(allocation => {
        const professionKey = normalizeProfessionKey(
            allocation.professionKey || allocation.profession_key
        );
        const attendanceRef = allocation.attendanceRef ?? allocation.attendance_ref ?? null;
        const segmentRef = allocation.segmentRef ?? allocation.segment_ref
            ?? allocation.segmentId ?? allocation.segment_id ?? null;
        const roleRef = allocation.roleRef ?? allocation.role_ref
            ?? allocation.roleId ?? allocation.role_id ?? null;
        const lineItem = uniqueAdditionalLines.find(candidate => (
            normalizeProfessionKey(candidate.professionKey || candidate.profession_key) === professionKey
            && String(candidate.attendanceRef ?? candidate.attendance_ref ?? '') === String(attendanceRef ?? '')
            && String(candidate.segmentRef ?? candidate.segment_ref ?? '') === String(segmentRef ?? '')
            && String(candidate.roleRef ?? candidate.role_ref ?? '') === String(roleRef ?? '')
        )) || uniqueAdditionalLines.find(candidate => (
            normalizeProfessionKey(candidate.professionKey || candidate.profession_key) === professionKey
            && String(candidate.attendanceRef ?? candidate.attendance_ref ?? '') === String(attendanceRef ?? '')
        ));
        const minutes = Math.max(0, toNumber(
            allocation.minutes ?? allocation.actualMinutes ?? allocation.actual_minutes,
            0
        ));
        const rate = nullableNumber(lineItem?.rate ?? allocation.rate);
        const multiplier = nullableNumber(
            lineItem?.multiplier ?? allocation.payMultiplier ?? allocation.pay_multiplier
        );
        const amount = lineItem ? roundMoney(lineItem.amount) : null;
        return {
            allocationType: SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
            professionKey,
            minutes,
            hours: roundHoursFromMinutes(minutes),
            rate,
            rateSource: lineItem?.rateSource || lineItem?.rate_source
                || allocation.rateSource || allocation.rate_source || null,
            multiplier,
            amount,
            attendanceRef,
            segmentRef,
            roleRef,
            policyVersion: lineItem?.policyVersion || lineItem?.policy_version
                || allocation.policyVersion || allocation.policy_version || null,
            workDate: lineItem?.workDate || lineItem?.work_date || allocation.date || null,
            formula: lineItem?.formula || null,
            status: lineItem ? 'ready' : 'blocked'
        };
    });
    for (const lineItem of uniqueAdditionalLines) {
        const professionKey = normalizeProfessionKey(lineItem.professionKey || lineItem.profession_key);
        const attendanceRef = lineItem.attendanceRef ?? lineItem.attendance_ref ?? null;
        const segmentRef = lineItem.segmentRef ?? lineItem.segment_ref ?? null;
        const roleRef = lineItem.roleRef ?? lineItem.role_ref ?? null;
        const exists = roleDetails.some(role => (
            role.professionKey === professionKey
            && String(role.attendanceRef ?? '') === String(attendanceRef ?? '')
            && String(role.segmentRef ?? '') === String(segmentRef ?? '')
            && String(role.roleRef ?? '') === String(roleRef ?? '')
        ));
        if (exists) continue;
        const minutes = Math.max(0, toNumber(lineItem.minutes, 0));
        roleDetails.push({
            allocationType: SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
            professionKey,
            minutes,
            hours: roundHoursFromMinutes(minutes),
            rate: nullableNumber(lineItem.rate),
            rateSource: lineItem.rateSource || lineItem.rate_source || null,
            multiplier: nullableNumber(lineItem.multiplier),
            amount: roundMoney(lineItem.amount),
            attendanceRef,
            segmentRef,
            roleRef,
            policyVersion: lineItem.policyVersion || lineItem.policy_version || null,
            workDate: lineItem.workDate || lineItem.work_date || null,
            formula: lineItem.formula || null,
            status: 'ready'
        });
    }
    const blockingIssues = Array.isArray(professionPay.blockingIssues)
        ? professionPay.blockingIssues
        : (Array.isArray(professionPay.reconciliation?.blockingIssues)
            ? professionPay.reconciliation.blockingIssues
            : []);
    for (const role of roleDetails) {
        const blocker = blockingIssues.find(issue => (
            (!issue.professionKey || normalizeProfessionKey(issue.professionKey) === role.professionKey)
            && (!issue.date || normalizeDateValue(issue.date) === normalizeDateValue(role.workDate))
        )) || null;
        const unresolved = role.status === 'blocked' || role.amount === null || role.amount === undefined;
        role.status = blocker || unresolved ? 'blocked' : 'ready';
        role.blockerCode = blocker?.code || (unresolved ? 'PAYROLL_SIMULTANEOUS_ADDITIONAL_LINE_UNRESOLVED' : null);
        role.blockerMessage = blocker?.message || (unresolved ? 'Додаткова оплата не розрахована; перевірте compensation snapshot' : null);
    }
    roleDetails.sort((left, right) => (
        String(left.workDate || '').localeCompare(String(right.workDate || ''))
        || String(left.professionKey || '').localeCompare(String(right.professionKey || ''))
        || Number(left.segmentRef || 0) - Number(right.segmentRef || 0)
    ));
    const professions = [...new Set(roleDetails.map(role => role.professionKey).filter(Boolean))];
    const rates = [...new Set(roleDetails.map(role => role.rate).filter(value => value !== null))];
    const multipliers = [...new Set(roleDetails.map(role => role.multiplier).filter(value => value !== null))];
    const calculatedAdditionalMinutes = roleDetails.reduce((sum, role) => sum + role.minutes, 0);
    return {
        physicalMinutes,
        physicalHours: roundHoursFromMinutes(physicalMinutes),
        baseRoleMinutes,
        baseRoleHours: roundHoursFromMinutes(baseRoleMinutes),
        additionalRoleMinutes: additionalRoleMinutes || calculatedAdditionalMinutes,
        additionalRoleHours: roundHoursFromMinutes(additionalRoleMinutes || calculatedAdditionalMinutes),
        additionalProfession: professions.length === 1 ? professions[0] : null,
        additionalRate: rates.length === 1 ? rates[0] : null,
        additionalMultiplier: multipliers.length === 1 ? multipliers[0] : null,
        additionalAmount: roundMoney(
            professionPay.additionalAmount
            ?? professionPay.additional_amount
            ?? roleDetails.reduce((sum, role) => sum + toNumber(role.amount, 0), 0)
        ),
        additionalRoles: roleDetails,
        explanation: PAYROLL_ROLE_HOURS_EXPLANATION
    };
}

function finalizeProfessionPayResult({ metrics, fallbackProfessionKey, rateUnit, baseLines, overtimeLines, professionRateSummary, allocationIssues }) {
    const baseAmount = baseLines.reduce((sum, item) => sum + item.amount, 0);
    const overtimeAmount = overtimeLines.reduce((sum, item) => sum + item.amount, 0);
    const issues = compactAllocationIssues([...(metrics.allocationIssues || []), ...(allocationIssues || [])]);
    if (metrics.overtimeMinutes > 0 && !issues.some(issue => issue.code === 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED')) {
        issues.push({
            code: 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED',
            professionKey: metrics.primaryDays[0]?.professionKey || fallbackProfessionKey || null,
            overtimeMinutes: metrics.overtimeMinutes,
            message: 'Overtime Р·Р°СЃС‚РѕСЃРѕРІР°РЅРѕ РѕРґРёРЅ СЂР°Р· РґРѕ РѕСЃРЅРѕРІРЅРѕС— РїСЂРѕС„РµСЃС–С—; РїРѕС‚СЂС–Р±РЅР° Р·РІС–СЂРєР°'
        });
    }
    issues.push(...buildPayrollRateUnitWarnings(professionRateSummary));
    const reconciliation = {
        ...(metrics.reconciliation || {}),
        days: [...(metrics.reconciliation?.days || [])],
        warnings: [...(metrics.reconciliation?.warnings || [])]
    };
    for (const issue of issues) {
        const exists = reconciliation.warnings.some(warning => (
            warning.code === issue.code
            && String(warning.date || '') === String(issue.date || '')
            && String(warning.professionKey || '') === String(issue.professionKey || '')
            && String(warning.profileId || '') === String(issue.profileId || '')
        ));
        if (!exists) reconciliation.warnings.push(issue);
    }
    return {
        applies: true,
        rateUnit,
        baseLines,
        overtimeLines,
        baseAmount,
        overtimeAmount,
        totalAmount: baseAmount + overtimeAmount,
        professionRateSummary,
        allocationIssues: issues,
        reconciliation
    };
}

function calculateProfessionPayWithResolver(staff, activeScheme, metrics, professionRateMap, payrollProfileContext, legacyRateUnit, fallbackProfessionKey) {
    const baseLines = [];
    const overtimeLines = [];
    const professionRateSummary = [];
    const allocationIssues = [];
    const periodStart = payrollProfileContext?.from
        || normalizeDateValue(metrics.attendanceDays?.[0]?.date || metrics.primaryDays?.[0]?.date)
        || normalizeDateValue(`${normalizePayrollMonth()}-01`);

    const resolveRate = (professionKey, workDate, preferredRateUnit = legacyRateUnit) => {
        const resolution = resolveEffectivePayrollProfile(staff, professionKey, workDate || periodStart, {
            payrollProfileContext,
            scheme: activeScheme,
            professionRateMap,
            preferredRateUnit
        });
        collectResolutionWarnings(allocationIssues, resolution);
        return resolution;
    };

    const monthlyResolution = resolveRate(fallbackProfessionKey, periodStart, legacyRateUnit);
    if (monthlyResolution.rateUnit === 'month') {
        const fixed = monthlyFixedAmount(monthlyResolution.rate, staff, activeScheme, metrics);
        const amount = fixed.amount;
        const formula = payrollFormula('month', fixed.valid ? fixed.ratio : 0, monthlyResolution.rate);
        baseLines.push(line('base', 'profession_month', 'Monthly profile salary', amount, {
            quantity: fixed.valid ? fixed.ratio : 0,
            rate: monthlyResolution.rate,
            source: monthlyResolution.rateSource,
            meta: {
                professionKey: fallbackProfessionKey,
                profileId: monthlyResolution.profileId,
                profileVersionId: monthlyResolution.profileVersionId,
                profileTitle: monthlyResolution.profileTitle,
                workDate: periodStart,
                appliedRule: monthlyResolution.appliedRule,
                formula
            }
        }));
        professionRateSummary.push(professionSummaryRow({
            professionKey: fallbackProfessionKey,
            minutes: metrics.allocatedMinutes,
            days: metrics.daysWorked,
            rate: monthlyResolution.rate,
            amount,
            rateUnit: 'month',
            sources: metrics.attendanceDays.map(day => day.allocationSource || day.allocation_source),
            rateSource: monthlyResolution.rateSource,
            resolution: monthlyResolution,
            workDate: periodStart,
            formula
        }));
        return finalizeProfessionPayResult({
            metrics,
            fallbackProfessionKey,
            rateUnit: 'month',
            baseLines,
            overtimeLines,
            professionRateSummary,
            allocationIssues
        });
    }

    const dailyAllocations = buildDailyProfessionAllocations(metrics, fallbackProfessionKey);
    const primaryDays = buildPrimaryDayEntries(metrics, fallbackProfessionKey, dailyAllocations);
    const dayPaidDates = new Set();

    for (const day of primaryDays) {
        const resolution = resolveRate(day.professionKey, day.date || periodStart, legacyRateUnit);
        if (resolution.rateUnit !== 'day') continue;
        if (day.date) dayPaidDates.add(day.date);
        const amount = roundMoney(day.days * resolution.rate);
        const minutes = day.date
            ? sumAllocationMinutesForDate(dailyAllocations, day.date)
            : metrics.allocatedMinutes;
        const formula = payrollFormula('day', day.days, resolution.rate);
        baseLines.push(line('base', 'profession_day', `Day rate: ${day.professionKey}`, amount, {
            quantity: day.days,
            rate: resolution.rate,
            source: resolution.rateSource,
            meta: {
                professionKey: day.professionKey,
                date: day.date,
                profileId: resolution.profileId,
                profileVersionId: resolution.profileVersionId,
                profileTitle: resolution.profileTitle,
                appliedRule: resolution.appliedRule,
                formula
            }
        }));
        professionRateSummary.push(professionSummaryRow({
            professionKey: day.professionKey,
            minutes,
            days: day.days,
            rate: resolution.rate,
            amount,
            rateUnit: 'day',
            sources: day.allocationSources,
            rateSource: resolution.rateSource,
            resolution,
            workDate: day.date || periodStart,
            formula
        }));
    }

    for (const allocation of dailyAllocations) {
        if (allocation.date && dayPaidDates.has(allocation.date)) continue;
        const resolution = resolveRate(allocation.professionKey, allocation.date || periodStart, legacyRateUnit);
        if (resolution.rateUnit === 'day') {
            allocationIssues.push({
                code: 'PAYROLL_DAY_RATE_SECONDARY_PROFESSION_SKIPPED',
                date: allocation.date,
                professionKey: allocation.professionKey,
                profileId: resolution.profileId,
                message: 'Day-rate payroll pays only the primary profession for a staff date'
            });
            continue;
        }
        if (resolution.rateUnit !== 'hour') continue;
        const hours = allocation.minutes / 60;
        const amount = roundMoney(hours * resolution.rate);
        const formula = payrollFormula('hour', hours, resolution.rate);
        baseLines.push(line('base', 'profession_hourly', `Hourly: ${allocation.professionKey}`, amount, {
            quantity: hours,
            rate: resolution.rate,
            source: resolution.rateSource,
            meta: {
                professionKey: allocation.professionKey,
                date: allocation.date,
                allocationSources: allocation.allocationSources,
                profileId: resolution.profileId,
                profileVersionId: resolution.profileVersionId,
                profileTitle: resolution.profileTitle,
                appliedRule: resolution.appliedRule,
                formula
            }
        }));
        professionRateSummary.push(professionSummaryRow({
            professionKey: allocation.professionKey,
            minutes: allocation.minutes,
            rate: resolution.rate,
            amount,
            rateUnit: 'hour',
            sources: allocation.allocationSources,
            rateSource: resolution.rateSource,
            resolution,
            workDate: allocation.date || periodStart,
            formula
        }));
    }

    for (const overtime of buildDailyOvertimeEntries(metrics, fallbackProfessionKey)) {
        if (overtime.date && dayPaidDates.has(overtime.date)) continue;
        const resolution = resolveRate(overtime.professionKey, overtime.date || periodStart, legacyRateUnit);
        if (resolution.rateUnit !== 'hour') continue;
        const hours = overtime.minutes / 60;
        const amount = roundMoney(hours * resolution.rate * OVERTIME_MULTIPLIER);
        const formula = payrollFormula('overtime', hours, resolution.rate, OVERTIME_MULTIPLIER);
        overtimeLines.push(line('overtime', 'overtime', `Overtime: ${overtime.professionKey}`, amount, {
            quantity: hours,
            rate: resolution.rate * OVERTIME_MULTIPLIER,
            source: resolution.rateSource,
            meta: {
                professionKey: overtime.professionKey,
                date: overtime.date,
                baseRate: resolution.rate,
                multiplier: OVERTIME_MULTIPLIER,
                allocationSources: overtime.allocationSources,
                profileId: resolution.profileId,
                profileVersionId: resolution.profileVersionId,
                profileTitle: resolution.profileTitle,
                appliedRule: resolution.appliedRule,
                formula
            }
        }));
        professionRateSummary.push(professionSummaryRow({
            professionKey: overtime.professionKey,
            minutes: overtime.minutes,
            rate: resolution.rate * OVERTIME_MULTIPLIER,
            amount,
            rateUnit: 'hour',
            sources: overtime.allocationSources,
            rateSource: resolution.rateSource,
            kind: 'overtime',
            resolution,
            workDate: overtime.date || periodStart,
            formula
        }));
    }

    const resolvedRateUnit = professionRateSummary.some(row => row.rate_unit === 'hour')
        ? 'hour'
        : (professionRateSummary.some(row => row.rate_unit === 'day') ? 'day' : legacyRateUnit);
    return finalizeProfessionPayResult({
        metrics,
        fallbackProfessionKey,
        rateUnit: resolvedRateUnit,
        baseLines,
        overtimeLines,
        professionRateSummary,
        allocationIssues
    });
}

function calculateProfessionPay(staff, scheme, metrics = payrollMetricBucket(staff?.id), professionRateMap = new Map(), payrollProfileContext = null) {
    const metricDefaults = payrollMetricBucket(staff?.id);
    metrics = { ...metricDefaults, ...(metrics || {}) };
    for (const key of [
        'professionAllocations',
        'baseProfessionAllocations',
        'additionalProfessionAllocations',
        'overtimeAllocations',
        'primaryDays',
        'attendanceDays',
        'allocationIssues',
        'payrollBlockingIssues'
    ]) {
        if (!Array.isArray(metrics[key])) metrics[key] = metricDefaults[key];
    }
    if (!metrics.reconciliation || typeof metrics.reconciliation !== 'object') {
        metrics.reconciliation = metricDefaults.reconciliation;
    }
    const activeScheme = scheme || fallbackSchemeForStaff(staff);
    const schemeType = activeScheme?.schemeType || activeScheme?.scheme_type || 'hourly';
    const standardType = ['hourly', 'per_shift', 'monthly_fixed'].includes(schemeType);
    if (!standardType) {
        return applySimultaneousAdditionalPayPolicy({
            applies: false,
            baseLines: [],
            overtimeLines: [],
            baseAmount: 0,
            overtimeAmount: 0,
            totalAmount: 0,
            professionRateSummary: [],
            allocationIssues: compactAllocationIssues([...(metrics.allocationIssues || [])]),
            reconciliation: {
                ...(metrics.reconciliation || {}),
                days: [...(metrics.reconciliation?.days || [])],
                warnings: [...(metrics.reconciliation?.warnings || [])]
            }
        }, metrics, schemeType);
    }
    const rateUnit = schemeType === 'monthly_fixed' ? 'month' : (schemeType === 'per_shift' ? 'day' : 'hour');
    const fallbackProfessionKey = normalizeProfessionKey(staff.roleType || staff.role_type);
    if (payrollProfileContextEnabled(payrollProfileContext)) {
        return applySimultaneousAdditionalPayPolicy(calculateProfessionPayWithResolver(
            staff,
            activeScheme,
            metrics,
            professionRateMap,
            payrollProfileContext,
            rateUnit,
            fallbackProfessionKey
        ), metrics, schemeType);
    }
    const baseLines = [];
    const overtimeLines = [];
    const professionRateSummary = [];

    if (rateUnit === 'hour') {
        const allocations = metrics.professionAllocations.length
            ? metrics.professionAllocations
            : (metrics.allocatedMinutes > 0 ? [{
                professionKey: fallbackProfessionKey,
                minutes: metrics.allocatedMinutes,
                allocationSources: ['legacy_single_role']
            }] : []);
        for (const allocation of allocations) {
            const professionKey = normalizeProfessionKey(allocation.professionKey || fallbackProfessionKey);
            const resolved = resolveProfessionPayRate(staff, professionKey, activeScheme, professionRateMap, rateUnit);
            const amount = roundMoney((allocation.minutes / 60) * resolved.rate);
            baseLines.push(line('base', 'profession_hourly', `Погодинно: ${professionKey}`, amount, {
                quantity: allocation.minutes / 60,
                rate: resolved.rate,
                source: resolved.source,
                meta: { professionKey, allocationSources: allocation.allocationSources }
            }));
            professionRateSummary.push(professionSummaryRow({
                professionKey,
                minutes: allocation.minutes,
                rate: resolved.rate,
                amount,
                rateUnit,
                sources: allocation.allocationSources,
                rateSource: resolved.source
            }));
        }
        const overtimeAllocations = metrics.overtimeAllocations.length
            ? metrics.overtimeAllocations
            : (metrics.overtimeMinutes > 0 ? [{
                professionKey: metrics.primaryDays[0]?.professionKey || fallbackProfessionKey,
                minutes: metrics.overtimeMinutes,
                allocationSources: ['legacy_primary_profession']
            }] : []);
        for (const overtime of overtimeAllocations) {
            const professionKey = normalizeProfessionKey(overtime.professionKey || fallbackProfessionKey);
            const resolved = resolveProfessionPayRate(staff, professionKey, activeScheme, professionRateMap, rateUnit);
            const amount = roundMoney((overtime.minutes / 60) * resolved.rate * OVERTIME_MULTIPLIER);
            overtimeLines.push(line('overtime', 'overtime', `Overtime: ${professionKey}`, amount, {
                quantity: overtime.minutes / 60,
                rate: resolved.rate * OVERTIME_MULTIPLIER,
                source: resolved.source,
                meta: { professionKey, baseRate: resolved.rate, multiplier: OVERTIME_MULTIPLIER, allocationSources: overtime.allocationSources }
            }));
            professionRateSummary.push(professionSummaryRow({
                professionKey,
                minutes: overtime.minutes,
                rate: resolved.rate * OVERTIME_MULTIPLIER,
                amount,
                rateUnit,
                sources: overtime.allocationSources,
                rateSource: resolved.source,
                kind: 'overtime'
            }));
        }
    } else if (rateUnit === 'day') {
        const dayMap = new Map();
        for (const day of metrics.primaryDays) {
            const professionKey = normalizeProfessionKey(day.professionKey || fallbackProfessionKey);
            if (!dayMap.has(professionKey)) dayMap.set(professionKey, { days: 0, dates: [] });
            dayMap.get(professionKey).days += 1;
            dayMap.get(professionKey).dates.push(day.date);
        }
        if (!dayMap.size && metrics.daysWorked > 0) {
            dayMap.set(fallbackProfessionKey, {
                days: metrics.daysWorked,
                dates: metrics.attendanceDays.map(day => day.date).filter(Boolean)
            });
        }
        for (const [professionKey, dayData] of dayMap) {
            const resolved = resolveProfessionPayRate(staff, professionKey, activeScheme, professionRateMap, rateUnit);
            const amount = roundMoney(dayData.days * resolved.rate);
            const professionMinutes = metrics.professionAllocations
                .filter(allocation => allocation.professionKey === professionKey)
                .reduce((sum, allocation) => sum + allocation.minutes, 0);
            baseLines.push(line('base', 'profession_day', `Денна ставка: ${professionKey}`, amount, {
                quantity: dayData.days,
                rate: resolved.rate,
                source: resolved.source,
                meta: { professionKey, dates: dayData.dates }
            }));
            professionRateSummary.push(professionSummaryRow({
                professionKey,
                minutes: professionMinutes,
                days: dayData.days,
                rate: resolved.rate,
                amount,
                rateUnit,
                sources: metrics.attendanceDays.filter(day => dayData.dates.includes(day.date)).map(day => day.allocationSource),
                rateSource: resolved.source
            }));
        }
    } else {
        const resolved = resolveProfessionPayRate(staff, fallbackProfessionKey, activeScheme, professionRateMap, rateUnit);
        const amount = monthlyFixedAmount(resolved.rate, staff, activeScheme, metrics).amount;
        baseLines.push(line('base', 'profession_month', 'Місячний оклад', amount, {
            quantity: 1,
            rate: resolved.rate,
            source: resolved.source,
            meta: { professionKey: fallbackProfessionKey }
        }));
        professionRateSummary.push(professionSummaryRow({
            professionKey: fallbackProfessionKey,
            minutes: metrics.allocatedMinutes,
            days: metrics.daysWorked,
            rate: resolved.rate,
            amount,
            rateUnit,
            sources: metrics.attendanceDays.map(day => day.allocationSource),
            rateSource: resolved.source
        }));
    }

    const baseAmount = baseLines.reduce((sum, item) => sum + item.amount, 0);
    const overtimeAmount = overtimeLines.reduce((sum, item) => sum + item.amount, 0);
    const allocationIssues = compactAllocationIssues([...(metrics.allocationIssues || [])]);
    if (metrics.overtimeMinutes > 0 && !allocationIssues.some(issue => issue.code === 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED')) {
        allocationIssues.push({
            code: 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED',
            professionKey: metrics.primaryDays[0]?.professionKey || fallbackProfessionKey || null,
            overtimeMinutes: metrics.overtimeMinutes,
            message: 'Overtime застосовано один раз до основної професії; потрібна звірка'
        });
    }
    allocationIssues.push(...buildPayrollRateUnitWarnings(professionRateSummary));
    const reconciliation = {
        ...(metrics.reconciliation || {}),
        days: [...(metrics.reconciliation?.days || [])],
        warnings: [...(metrics.reconciliation?.warnings || [])]
    };
    for (const issue of allocationIssues) {
        const exists = reconciliation.warnings.some(warning => (
            warning.code === issue.code
            && String(warning.date || '') === String(issue.date || '')
            && String(warning.professionKey || '') === String(issue.professionKey || '')
        ));
        if (!exists) reconciliation.warnings.push(issue);
    }
    return applySimultaneousAdditionalPayPolicy({
        applies: true,
        rateUnit,
        baseLines,
        overtimeLines,
        baseAmount,
        overtimeAmount,
        totalAmount: baseAmount + overtimeAmount,
        professionRateSummary,
        allocationIssues,
        reconciliation
    }, metrics, schemeType);
}

async function fetchTimeMetrics(month, periodOptions = {}, db = pool) {
    const monthBounds = getMonthBounds(month);
    const bounds = {
        from: normalizeDateValue(periodOptions.from) || monthBounds.from,
        to: normalizeDateValue(periodOptions.to) || monthBounds.to
    };
    try {
        return await loadPayrollAttendanceMetrics(bounds, db);
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('time metrics query failed:', err.message);
        return new Map();
    }
}

async function fetchAdjustments(month, db = pool) {
    try {
        const result = await db.query(`
            SELECT staff_id, type, COALESCE(SUM(amount), 0)::numeric AS total
            FROM salary_adjustments
            WHERE month = $1 AND COALESCE(status, 'applied') = 'applied'
            GROUP BY staff_id, type
        `, [month]);
        const map = new Map();
        for (const row of result.rows) {
            if (!map.has(row.staff_id)) {
                map.set(row.staff_id, { bonus: 0, kpi_bonus: 0, tip: 0, deduction: 0, penalty: 0, zrs: 0, advance: 0 });
            }
            const type = normalizePayrollAdjustmentType(row.type);
            if (type === PAYROLL_ZRS_TYPE) {
                map.get(row.staff_id).zrs += toNumber(row.total, 0);
            } else {
                map.get(row.staff_id)[type] = toNumber(row.total, 0);
            }
        }
        return map;
    } catch (err) {
        log.error('salary_adjustments query failed:', err);
        throw payrollAdjustmentsUnavailableError(err);
    }
}

async function fetchPayrollEntries(month, db = pool) {
    try {
        const result = await db.query(`
            SELECT *
            FROM payroll_entries
            WHERE period_month = $1
            ORDER BY created_at, id
        `, [month]);
        const map = new Map();
        for (const row of result.rows) {
            if (!map.has(row.staff_id)) map.set(row.staff_id, []);
            map.get(row.staff_id).push(row);
        }
        return map;
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('payroll_entries query failed:', err.message);
        return new Map();
    }
}

async function fetchPayrollKpiAuditSnapshots(month, staffIds = [], db = pool) {
    const ids = [...new Set((Array.isArray(staffIds) ? staffIds : [])
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const bounds = getMonthBounds(month);
    try {
        const result = await db.query(`
            WITH params AS (
                SELECT $1::varchar(7) AS month,
                       $2::date AS date_from,
                       $3::date AS date_to
            ),
            scoped_staff AS (
                SELECT s.id, s.name
                FROM staff s
                WHERE s.id = ANY($4::int[])
            ),
            task_stats AS (
                SELECT ep.staff_id,
                       COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')})::int AS tasks_assigned,
                       COUNT(t.id) FILTER (
                           WHERE ${taskKpiEligibleSql('t')}
                             AND COALESCE(t.status, 'todo') IN ('done', 'completed')
                       )::int AS tasks_done,
                       COUNT(t.id) FILTER (
                           WHERE ${taskKpiEligibleSql('t')}
                             AND COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled')
                             AND t.deadline IS NOT NULL
                             AND t.deadline::date <= p.date_to
                       )::int AS tasks_overdue,
                       COUNT(t.id) FILTER (
                           WHERE ${taskKpiEligibleSql('t')}
                             AND ${taskKpiMachineSignalSql('t')}
                       )::int AS tasks_machine_accepted,
                       COUNT(t.id) FILTER (
                           WHERE NOT ${taskKpiEligibleSql('t')}
                             AND ${taskKpiMachineSignalSql('t')}
                       )::int AS tasks_machine_excluded,
                       COUNT(t.id) FILTER (
                           WHERE NOT ${taskKpiEligibleSql('t')}
                             AND NOT ${taskKpiMachineSignalSql('t')}
                       )::int AS tasks_ambiguous_excluded,
                       MAX(GREATEST(t.created_at, COALESCE(t.completed_at, t.created_at))) AS source_timestamp
                FROM tasks t
                JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active = true
                JOIN scoped_staff ss ON ss.id = ep.staff_id
                JOIN params p ON (
                    t.created_at::date BETWEEN p.date_from AND p.date_to
                    OR t.completed_at::date BETWEEN p.date_from AND p.date_to
                )
                WHERE t.owner_user_id IS NOT NULL
                GROUP BY ep.staff_id
            ),
            onboarding_stats AS (
                SELECT op.staff_id,
                       COUNT(*)::int AS onboarding_total,
                       COUNT(*) FILTER (WHERE op.status = 'completed')::int AS onboarding_completed,
                       COUNT(*) FILTER (WHERE op.status <> 'completed')::int AS onboarding_active,
                       COALESCE(SUM(op.total_items), 0)::int AS onboarding_total_items,
                       COALESCE(SUM(op.completed_items), 0)::int AS onboarding_completed_items,
                       MAX(GREATEST(op.started_at, COALESCE(op.completed_at, op.started_at))) AS source_timestamp
                FROM onboarding_progress op
                JOIN scoped_staff ss ON ss.id = op.staff_id
                JOIN params p ON op.started_at::date <= p.date_to
                    AND (op.completed_at IS NULL OR op.completed_at::date >= p.date_from)
                GROUP BY op.staff_id
            ),
            contribution_stats AS (
                SELECT ss.id AS staff_id,
                       COUNT(DISTINCT b.id)::int AS events_period,
                       MAX(b.date::timestamp) AS source_timestamp
                FROM scoped_staff ss
                CROSS JOIN params p
                LEFT JOIN bookings b ON (
                    b.line_id = ss.id::text
                    OR LOWER(BTRIM(COALESCE(b.second_animator, ''))) = LOWER(BTRIM(ss.name))
                    OR BTRIM(COALESCE(b.second_animator, '')) = ss.id::text
                )
                    AND b.status IN ('completed', 'confirmed')
                    AND b.date::date >= p.date_from AND b.date::date <= p.date_to
                GROUP BY ss.id
            )
            SELECT ss.id AS staff_id,
                   COALESCE(ts.tasks_assigned, 0)::int AS tasks_assigned,
                   COALESCE(ts.tasks_done, 0)::int AS tasks_done,
                   COALESCE(ts.tasks_overdue, 0)::int AS tasks_overdue,
                   COALESCE(ts.tasks_machine_accepted, 0)::int AS tasks_machine_accepted,
                   COALESCE(ts.tasks_machine_excluded, 0)::int AS tasks_machine_excluded,
                   COALESCE(ts.tasks_ambiguous_excluded, 0)::int AS tasks_ambiguous_excluded,
                   COALESCE(os.onboarding_total, 0)::int AS onboarding_total,
                   COALESCE(os.onboarding_completed, 0)::int AS onboarding_completed,
                   COALESCE(os.onboarding_active, 0)::int AS onboarding_active,
                   COALESCE(os.onboarding_total_items, 0)::int AS onboarding_total_items,
                   COALESCE(os.onboarding_completed_items, 0)::int AS onboarding_completed_items,
                   COALESCE(cs.events_period, 0)::int AS events_period,
                   GREATEST(ts.source_timestamp, os.source_timestamp, cs.source_timestamp) AS source_timestamp
            FROM scoped_staff ss
            LEFT JOIN task_stats ts ON ts.staff_id = ss.id
            LEFT JOIN onboarding_stats os ON os.staff_id = ss.id
            LEFT JOIN contribution_stats cs ON cs.staff_id = ss.id
        `, [month, bounds.from, bounds.to, ids]);
        return new Map(result.rows.map(row => [Number(row.staff_id), {
            month,
            sourceTimestamp: row.source_timestamp ? new Date(row.source_timestamp).toISOString() : null,
            metrics: {
                tasks: {
                    assigned: Number(row.tasks_assigned || 0),
                    done: Number(row.tasks_done || 0),
                    overdue: Number(row.tasks_overdue || 0),
                    machineAccepted: Number(row.tasks_machine_accepted || 0),
                    machineExcluded: Number(row.tasks_machine_excluded || 0),
                    ambiguousExcluded: Number(row.tasks_ambiguous_excluded || 0),
                    eligibilityPolicyVersion: TASK_PERFORMANCE_POLICY_VERSION
                },
                onboarding: {
                    total: Number(row.onboarding_total || 0),
                    completed: Number(row.onboarding_completed || 0),
                    active: Number(row.onboarding_active || 0),
                    totalItems: Number(row.onboarding_total_items || 0),
                    completedItems: Number(row.onboarding_completed_items || 0)
                },
                contribution: {
                    eventsPeriod: Number(row.events_period || 0),
                    ratingsSource: 'disabled_no_period_source',
                    totalRatings: 0,
                    avgRating: null
                }
            }
        }]));
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('payroll KPI audit snapshot query failed:', err.message);
        return new Map();
    }
}

async function fetchPeriodIncome(month, periodOptions = {}, db = pool) {
    const bounds = getMonthBounds(month);
    const from = normalizeDateValue(periodOptions.from) || bounds.from;
    const to = normalizeDateValue(periodOptions.to) || bounds.to;
    const result = await db.query(`
        SELECT COALESCE(NULLIF(BTRIM(business_context), ''), 'event_genix') AS business_context,
               COALESCE(SUM(amount), 0)::numeric AS total
        FROM finance_transactions
        WHERE type = 'income'
          AND COALESCE(recognition_date, date::date) >= $1::date
          AND COALESCE(recognition_date, date::date) <= $2::date
          AND COALESCE(source, '') <> 'payroll'
        GROUP BY COALESCE(NULLIF(BTRIM(business_context), ''), 'event_genix')
    `, [from, to]);
    return {
        from,
        to,
        byBusinessContext: new Map(result.rows.map(row => [
            String(row.business_context),
            toNumber(row.total, 0)
        ]))
    };
}

async function loadActivePayrollSchemeMap(staffIds, month, db = pool) {
    if (!staffIds.length) return new Map();
    const bounds = getMonthBounds(month);
    try {
        const result = await db.query(`
            SELECT *
            FROM payroll_schemes
            WHERE staff_id = ANY($1::int[])
            ORDER BY staff_id, effective_from ASC NULLS FIRST, created_at ASC NULLS FIRST, id ASC
        `, [staffIds]);
        const rowsByStaff = new Map();
        for (const row of result.rows) {
            const staffId = Number(row.staff_id);
            if (!rowsByStaff.has(staffId)) rowsByStaff.set(staffId, []);
            rowsByStaff.get(staffId).push(mapScheme(row));
        }
        const schemeMap = new Map();
        for (const [staffId, schemes] of rowsByStaff.entries()) {
            // Copy-on-write corrections may supersede a draft version on the same
            // effective date. Keep the newest row for that date while retaining
            // older rows as immutable audit history.
            const effectiveVersions = schemes.filter((scheme, index) => {
                const effectiveKey = scheme.effectiveFrom || '__legacy_unbounded__';
                return !schemes.slice(index + 1).some(candidate => (
                    (candidate.effectiveFrom || '__legacy_unbounded__') === effectiveKey
                ));
            });
            const periodVersions = effectiveVersions.filter((scheme, index) => {
                const nextEffectiveFrom = effectiveVersions.slice(index + 1)
                    .map(item => item.effectiveFrom)
                    .find(Boolean) || null;
                const startsBeforePeriodEnd = !scheme.effectiveFrom || scheme.effectiveFrom <= bounds.to;
                const explicitEndOverlaps = !scheme.effectiveTo || scheme.effectiveTo >= bounds.from;
                const impliedEndOverlaps = !nextEffectiveFrom || nextEffectiveFrom > bounds.from;
                return startsBeforePeriodEnd && explicitEndOverlaps && impliedEndOverlaps;
            });
            if (!periodVersions.length) continue;
            const chosen = periodVersions[periodVersions.length - 1];
            schemeMap.set(staffId, {
                ...chosen,
                periodSchemeVersions: periodVersions.map(item => ({
                    id: item.id,
                    schemeType: item.schemeType,
                    effectiveFrom: item.effectiveFrom,
                    effectiveTo: item.effectiveTo
                }))
            });
        }
        return schemeMap;
    } catch (err) {
        if (isMissingTableError(err)) return new Map();
        throw err;
    }
}

async function fetchAllSchemes(staffId = null, db = pool) {
    try {
        const params = [];
        let where = '';
        if (staffId) {
            params.push(staffId);
            where = 'WHERE staff_id = $1';
        }
        const result = await db.query(`
            SELECT *
            FROM payroll_schemes
            ${where}
            ORDER BY is_active DESC, staff_id, updated_at DESC, id DESC
        `, params);
        return result.rows.map(mapScheme);
    } catch (err) {
        if (!isMissingTableError(err)) throw err;
        return [];
    }
}

async function fetchReportsByMonth(month, db = pool) {
    try {
        const result = await db.query(`
            SELECT *
            FROM payroll_reports
            WHERE period_month = $1
        `, [month]);
        return new Map(result.rows.map(row => [row.staff_id, row]));
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('payroll_reports query failed:', err.message);
        return new Map();
    }
}

const OFF_ROSTER_DRAFT_CATEGORIES = Object.freeze([
    'freelance',
    'inactive',
    'archived',
    'terminated',
    'missing_hr_card',
    'outside_active_roster'
]);

function classifyOffRosterDraftReport(row = {}) {
    if (row.missing_hr_card === true || !row.staff_id) return 'missing_hr_card';
    if (row.is_freelance === true) return 'freelance';
    if (row.termination_date) return 'terminated';
    const poolStatus = String(row.hr_pool_status || '').trim().toLowerCase();
    if (['archived', 'blacklisted', 'dismissed'].includes(poolStatus)) return 'archived';
    if (row.is_active === false) return 'inactive';
    return 'outside_active_roster';
}

function summarizeOffRosterDraftReports(rows = []) {
    const categoryCounts = Object.fromEntries(OFF_ROSTER_DRAFT_CATEGORIES.map(category => [category, 0]));
    const reports = rows.map(row => {
        const reason = classifyOffRosterDraftReport(row);
        categoryCounts[reason] = (categoryCounts[reason] || 0) + 1;
        return {
            reportId: Number(row.report_id || row.id),
            staffId: row.staff_id === null || row.staff_id === undefined ? null : Number(row.staff_id),
            periodMonth: row.period_month || null,
            reportStatus: row.report_status || row.status || null,
            staffStatus: {
                isActive: row.is_active === null || row.is_active === undefined ? null : row.is_active === true,
                isFreelance: row.is_freelance === null || row.is_freelance === undefined ? null : row.is_freelance === true,
                hrPoolStatus: row.hr_pool_status || null,
                hasTerminationDate: Boolean(row.termination_date),
                missingHrCard: row.missing_hr_card === true
            },
            reason,
            generatedAt: row.generated_at || null,
            updatedAt: row.updated_at || null
        };
    });
    return {
        title: 'Draft reports поза активним HR roster',
        count: reports.length,
        categoryCounts,
        reports
    };
}

async function loadOffRosterDraftReportReconciliation(month, activeStaffIds = [], db = pool) {
    const normalizedIds = [...new Set((activeStaffIds || [])
        .map(id => Number(id))
        .filter(Number.isInteger))];
    const params = [month, normalizedIds];
    const queryWithLifecycle = `
        SELECT pr.id AS report_id,
               pr.staff_id,
               pr.period_month,
               pr.status AS report_status,
               pr.generated_at,
               pr.updated_at,
               s.id IS NULL AS missing_hr_card,
               s.is_active,
               s.is_freelance,
               s.hr_pool_status,
               s.termination_date
        FROM payroll_reports pr
        LEFT JOIN staff s ON s.id = pr.staff_id
        WHERE pr.period_month = $1
          AND pr.status = 'draft'
          AND pr.voided_at IS NULL
          AND NOT (pr.staff_id = ANY($2::int[]))
        ORDER BY pr.id
    `;
    const fallbackQuery = `
        SELECT pr.id AS report_id,
               pr.staff_id,
               pr.period_month,
               pr.status AS report_status,
               pr.generated_at,
               pr.updated_at,
               s.id IS NULL AS missing_hr_card,
               s.is_active,
               s.is_freelance,
               NULL::text AS hr_pool_status,
               NULL::date AS termination_date
        FROM payroll_reports pr
        LEFT JOIN staff s ON s.id = pr.staff_id
        WHERE pr.period_month = $1
          AND pr.status = 'draft'
          AND pr.voided_at IS NULL
          AND NOT (pr.staff_id = ANY($2::int[]))
        ORDER BY pr.id
    `;
    try {
        const result = await db.query(queryWithLifecycle, params);
        return summarizeOffRosterDraftReports(result.rows);
    } catch (err) {
        if (err.code === '42703') {
            const result = await db.query(fallbackQuery, params);
            return summarizeOffRosterDraftReports(result.rows);
        }
        if (!isMissingTableError(err)) log.warn('off-roster payroll draft reconciliation query failed:', err.message);
        return summarizeOffRosterDraftReports([]);
    }
}

function applyReportSnapshot(row, report) {
    if (!report || !['reviewed', 'approved', 'paid'].includes(report.status)) return row;
    const breakdown = parseConfig(report.breakdown_json);
    const snapshotScheme = breakdown.scheme || {};
    const snapshotMetrics = {
        physicalMinutes: breakdown.metrics?.physicalMinutes ?? row.physicalMinutes,
        baseProfessionAllocations: breakdown.metrics?.baseProfessionAllocations ?? row.baseProfessionAllocations,
        additionalProfessionAllocations: breakdown.metrics?.additionalProfessionAllocations ?? row.additionalProfessionAllocations
    };
    const transparency = breakdown.transparency
        || buildPayrollTransparencyMetrics(snapshotMetrics, {
            additionalAmount: breakdown.summary?.additional ?? row.additionalAmount,
            lines: breakdown.lines || row.lines
        });
    return {
        ...row,
        schemeId: snapshotScheme.versionId ?? snapshotScheme.id ?? row.schemeId,
        schemeVersionId: snapshotScheme.versionId ?? snapshotScheme.id ?? row.schemeVersionId ?? row.schemeId,
        schemeType: snapshotScheme.type ?? row.schemeType,
        schemeTypeLabel: schemeTypeLabel(snapshotScheme.type ?? row.schemeType),
        schemeTitle: snapshotScheme.title ?? row.schemeTitle,
        schemeConfigHash: snapshotScheme.configHash ?? row.schemeConfigHash ?? null,
        schemeEffectiveFrom: snapshotScheme.effectiveFrom ?? row.schemeEffectiveFrom ?? null,
        schemeEffectiveTo: snapshotScheme.effectiveTo ?? row.schemeEffectiveTo ?? null,
        schemeUpdatedAt: snapshotScheme.updatedAt ?? row.schemeUpdatedAt ?? null,
        baseAmount: roundMoney(breakdown.summary?.base ?? row.baseAmount),
        additionalAmount: roundMoney(breakdown.summary?.additional ?? row.additionalAmount),
        bonusesAmount: roundMoney(breakdown.summary?.bonuses ?? row.bonusesAmount),
        percentAmount: roundMoney(breakdown.summary?.percent ?? row.percentAmount),
        deductionsAmount: roundMoney(report.deductions_amount),
        advancesAmount: roundMoney(report.advances_amount),
        grossAmount: roundMoney(report.gross_amount),
        netAmount: roundMoney(report.net_amount),
        estimatedSalary: roundMoney(report.net_amount),
        totalSalary: roundMoney(report.net_amount),
        lines: Array.isArray(breakdown.lines) ? breakdown.lines : row.lines,
        professionRateSummary: Array.isArray(breakdown.professionRateSummary)
            ? breakdown.professionRateSummary
            : row.professionRateSummary,
        profession_rate_summary: Array.isArray(breakdown.professionRateSummary)
            ? breakdown.professionRateSummary
            : row.profession_rate_summary,
        reconciliation: breakdown.reconciliation || row.reconciliation,
        allocationIssues: Array.isArray(breakdown.allocationIssues)
            ? breakdown.allocationIssues
            : row.allocationIssues,
        payrollBlockingIssues: Array.isArray(breakdown.payrollBlockingIssues)
            ? breakdown.payrollBlockingIssues
            : row.payrollBlockingIssues,
        plannedMinutes: toNumber(breakdown.metrics?.plannedMinutes ?? row.plannedMinutes, 0),
        paidPlannedMinutes: toNumber(breakdown.metrics?.paidPlannedMinutes ?? row.paidPlannedMinutes, 0),
        monthlyNormMinutes: toNumber(breakdown.metrics?.monthlyNormMinutes ?? row.monthlyNormMinutes, 0),
        monthlyNormSource: breakdown.metrics?.monthlyNormSource ?? row.monthlyNormSource ?? null,
        monthlyNormConfirmed: (breakdown.metrics?.monthlyNormConfirmed ?? row.monthlyNormConfirmed) === true,
        monthlyNormMonth: breakdown.metrics?.monthlyNormMonth ?? row.monthlyNormMonth ?? null,
        physicalMinutes: toNumber(breakdown.metrics?.physicalMinutes ?? row.physicalMinutes, 0),
        baseProfessionAllocations: Array.isArray(breakdown.metrics?.baseProfessionAllocations)
            ? breakdown.metrics.baseProfessionAllocations
            : row.baseProfessionAllocations,
        additionalProfessionAllocations: Array.isArray(breakdown.metrics?.additionalProfessionAllocations)
            ? breakdown.metrics.additionalProfessionAllocations
            : row.additionalProfessionAllocations,
        payrollTransparency: transparency,
        payroll_transparency: transparency,
        physicalHours: transparency.physicalHours,
        physical_hours: transparency.physicalHours,
        baseRoleHours: transparency.baseRoleHours,
        base_role_hours: transparency.baseRoleHours,
        additionalRoleHours: transparency.additionalRoleHours,
        additional_role_hours: transparency.additionalRoleHours,
        additionalProfession: transparency.additionalProfession,
        additional_profession: transparency.additionalProfession,
        additionalRate: transparency.additionalRate,
        additional_rate: transparency.additionalRate,
        additionalMultiplier: transparency.additionalMultiplier,
        additional_multiplier: transparency.additionalMultiplier,
        additionalRoles: transparency.additionalRoles,
        additional_roles: transparency.additionalRoles,
        summary: breakdown.summary || row.summary
    };
}

async function buildPayrollContext(month, options = {}, db = pool) {
    const normalizedMonth = assertPayrollMonth(normalizePayrollMonth(month));
    const periodOptions = {
        from: normalizeDateValue(options.from),
        to: normalizeDateValue(options.to)
    };
    const monthBounds = getMonthBounds(normalizedMonth);
    const isFullMonth = (!periodOptions.from || periodOptions.from === monthBounds.from)
        && (!periodOptions.to || periodOptions.to === monthBounds.to);
    const includeMonthlyAdjustments = options.includeMonthlyAdjustments !== undefined
        ? options.includeMonthlyAdjustments === true
        : isFullMonth;
    const includeReports = options.includeReports !== undefined
        ? options.includeReports === true
        : isFullMonth;
    const staff = await fetchStaffList(normalizedMonth, periodOptions, db);
    const staffIds = staff.map(item => item.id);
    const timeMap = await fetchTimeMetrics(normalizedMonth, periodOptions, db);
    const adjustmentMap = includeMonthlyAdjustments ? await fetchAdjustments(normalizedMonth, db) : new Map();
    const entryMap = includeMonthlyAdjustments ? await fetchPayrollEntries(normalizedMonth, db) : new Map();
    const schemeMap = await loadActivePayrollSchemeMap(staffIds, normalizedMonth, db);
    const reportMap = includeReports ? await fetchReportsByMonth(normalizedMonth, db) : new Map();
    const periodIncome = await fetchPeriodIncome(normalizedMonth, {
        from: periodOptions.from || monthBounds.from,
        to: periodOptions.to || monthBounds.to
    }, db);
    const allSchemes = await fetchAllSchemes(null, db);
    const professionRateMap = await loadProfessionRateMap(staffIds, db);
    const payrollProfileContext = await loadPayrollProfileContext(staffIds, {
        from: periodOptions.from || monthBounds.from,
        to: periodOptions.to || monthBounds.to
    }, db);
    const kpiAuditSnapshotMap = includeMonthlyAdjustments
        ? await fetchPayrollKpiAuditSnapshots(normalizedMonth, staffIds, db)
        : new Map();

    return {
        month: normalizedMonth,
        period: {
            from: periodOptions.from || monthBounds.from,
            to: periodOptions.to || monthBounds.to,
            fullMonth: isFullMonth
        },
        staff,
        timeMap,
        adjustmentMap,
        entryMap,
        schemeMap,
        reportMap,
        periodIncome,
        allSchemes,
        professionRateMap,
        payrollProfileContext,
        kpiAuditSnapshotMap
    };
}

function payrollLineTypeAmount(lines = [], type) {
    return roundMoney((Array.isArray(lines) ? lines : [])
        .filter(item => (item.lineType || item.line_type) === type)
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0));
}

function buildPayrollKpiAuditSnapshot(month, row = {}, kpiSnapshot = null) {
    const metrics = kpiSnapshot?.metrics || {};
    const taskMetrics = {
        assigned: 0,
        done: 0,
        overdue: 0,
        machineAccepted: 0,
        machineExcluded: 0,
        ambiguousExcluded: 0,
        eligibilityPolicyVersion: TASK_PERFORMANCE_POLICY_VERSION,
        ...(metrics.tasks || {})
    };
    taskMetrics.eligibilityPolicyVersion = taskMetrics.eligibilityPolicyVersion || TASK_PERFORMANCE_POLICY_VERSION;
    return {
        schemaVersion: 1,
        kpiMonth: month || row.periodMonth || row.month || null,
        source: 'payroll_kpi_audit_snapshot',
        sourceTimestamp: kpiSnapshot?.sourceTimestamp || null,
        ruleVersion: PAYROLL_KPI_BONUS_RULE_VERSION,
        eligibilityPolicyVersion: TASK_PERFORMANCE_POLICY_VERSION,
        metrics: {
            attendance: {
                daysWorked: Number(row.daysWorked ?? row.days_worked ?? 0),
                plannedHours: Number(row.plannedHours ?? row.planned_hours ?? 0),
                overtimeHours: Number(row.overtimeHours ?? row.overtime_hours ?? 0)
            },
            tasks: taskMetrics,
            onboarding: metrics.onboarding || { total: 0, completed: 0, active: 0, totalItems: 0, completedItems: 0 },
            contribution: metrics.contribution || {
                eventsPeriod: 0,
                ratingsSource: 'disabled_no_period_source',
                totalRatings: 0,
                avgRating: null
            }
        },
        approvedBonusAmount: payrollLineTypeAmount(row.lines || row.payroll_lines || [], PAYROLL_KPI_BONUS_TYPE),
        bonusAdjustmentType: PAYROLL_KPI_BONUS_TYPE,
        appliesToInstallmentKind: 'final',
        formula: null,
        formulaStatus: 'not_configured'
    };
}

function rowFromCalculation(staff, calculation, metrics, report) {
    const scheme = calculation.scheme;
    const schemeConfig = parseConfig(scheme?.config || scheme?.config_json);
    const schemeSnapshot = payrollSchemeSnapshotMetadata(scheme);
    const summary = calculation.summary;
    const transparency = buildPayrollTransparencyMetrics(metrics, {
        ...(calculation.professionPay || {}),
        lines: calculation.lines
    });
    const row = {
        id: staff.id,
        staffId: staff.id,
        name: staff.name,
        department: staff.department,
        position: staff.position,
        roleType: staff.roleType,
        schemeId: schemeSnapshot.id,
        schemeVersionId: schemeSnapshot.versionId,
        schemeType: schemeSnapshot.type,
        schemeTypeLabel: schemeTypeLabel(schemeSnapshot.type),
        schemeTitle: schemeSnapshot.title || schemeTypeLabel(schemeSnapshot.type),
        schemeConfigHash: schemeSnapshot.configHash,
        schemeEffectiveFrom: schemeSnapshot.effectiveFrom,
        schemeEffectiveTo: schemeSnapshot.effectiveTo,
        schemeUpdatedAt: schemeSnapshot.updatedAt,
        isFallbackScheme: !!scheme.isFallback,
        hourlyRate: staff.hourlyRate,
        rateUnit: calculation.professionPay?.rateUnit || staff.rateUnit,
        rate_unit: calculation.professionPay?.rateUnit || staff.rateUnit,
        totalMinutes: metrics.totalMinutes || 0,
        physicalMinutes: metrics.physicalMinutes ?? metrics.totalMinutes ?? 0,
        totalHours: metrics.hoursWorked || 0,
        hoursWorked: metrics.hoursWorked || 0,
        shifts: metrics.daysWorked || 0,
        daysWorked: metrics.daysWorked || 0,
        plannedMinutes: metrics.plannedMinutes || 0,
        paidPlannedMinutes: metrics.paidPlannedMinutes ?? metrics.plannedMinutes ?? 0,
        monthlyNormMinutes: metrics.monthlyNormMinutes
            ?? metrics.monthly_norm_minutes
            ?? schemeConfig.monthlyNormMinutes
            ?? schemeConfig.monthly_norm_minutes
            ?? 0,
        monthlyNormSource: metrics.monthlyNormSource
            ?? metrics.monthly_norm_source
            ?? schemeConfig.monthlyNormSource
            ?? schemeConfig.monthly_norm_source
            ?? null,
        monthlyNormConfirmed: (
            metrics.monthlyNormConfirmed
            ?? metrics.monthly_norm_confirmed
            ?? schemeConfig.monthlyNormConfirmed
            ?? schemeConfig.monthly_norm_confirmed
        ) === true,
        monthlyNormMonth: metrics.monthlyNormMonth
            ?? metrics.monthly_norm_month
            ?? schemeConfig.monthlyNormMonth
            ?? schemeConfig.monthly_norm_month
            ?? null,
        businessContexts: metrics.businessContexts || [],
        periodIncomeBusinessContext: metrics.periodIncomeBusinessContext || null,
        allocatedMinutes: metrics.allocatedMinutes || 0,
        overtimeMinutes: metrics.overtimeMinutes || 0,
        baseAmount: summary.base,
        additionalAmount: summary.additional || 0,
        overtimeAmount: summary.overtime || 0,
        bonusesAmount: summary.bonuses + summary.percent + summary.manual,
        kpiBonusAmount: summary.kpiBonus || 0,
        kpi_bonus_amount: summary.kpiBonus || 0,
        percentAmount: summary.percent,
        deductionsAmount: summary.deductions,
        zrsAmount: summary.zrs,
        zrs_amount: summary.zrs,
        advancesAmount: summary.advances,
        grossAmount: summary.gross,
        netAmount: summary.net,
        estimatedSalary: summary.net,
        totalSalary: summary.net,
        status: report?.status || 'draft',
        reportId: report?.id || null,
        reportGeneratedAt: report?.generated_at || null,
        lines: calculation.lines,
        professionRateSummary: calculation.professionPay?.professionRateSummary || [],
        profession_rate_summary: calculation.professionPay?.professionRateSummary || [],
        allocationIssues: calculation.professionPay?.allocationIssues || [],
        allocation_issues: calculation.professionPay?.allocationIssues || [],
        payrollBlockingIssues: calculation.blockingIssues || calculation.professionPay?.blockingIssues || [],
        payroll_blocking_issues: calculation.blockingIssues || calculation.professionPay?.blockingIssues || [],
        baseProfessionAllocations: metrics.baseProfessionAllocations || metrics.professionAllocations || [],
        additionalProfessionAllocations: metrics.additionalProfessionAllocations || [],
        compensationMinutes: metrics.compensationMinutes ?? metrics.totalMinutes ?? 0,
        roleMinutes: metrics.roleMinutes ?? metrics.totalMinutes ?? 0,
        payrollTransparency: transparency,
        payroll_transparency: transparency,
        physicalHours: transparency.physicalHours,
        physical_hours: transparency.physicalHours,
        baseRoleHours: transparency.baseRoleHours,
        base_role_hours: transparency.baseRoleHours,
        additionalRoleHours: transparency.additionalRoleHours,
        additional_role_hours: transparency.additionalRoleHours,
        additionalProfession: transparency.additionalProfession,
        additional_profession: transparency.additionalProfession,
        additionalRate: transparency.additionalRate,
        additional_rate: transparency.additionalRate,
        additionalMultiplier: transparency.additionalMultiplier,
        additional_multiplier: transparency.additionalMultiplier,
        additionalRoles: transparency.additionalRoles,
        additional_roles: transparency.additionalRoles,
        reconciliation: calculation.professionPay?.reconciliation || metrics.reconciliation || { days: [], warnings: [] },
        attendanceDays: metrics.attendanceDays || [],
        summary
    };
    return applyReportSnapshot(row, report);
}

function buildPayrollRowsFromContext(context) {
    const staffRows = context.staff.map(staff => {
        const attendanceMetrics = context.timeMap.get(staff.id)
            || { totalMinutes: 0, overtimeMinutes: 0, hoursWorked: 0, overtimeHours: 0, daysWorked: 0 };
        const businessContexts = Array.isArray(attendanceMetrics.businessContexts)
            ? attendanceMetrics.businessContexts.filter(Boolean)
            : [];
        const incomeBusinessContext = businessContexts.length === 1 ? businessContexts[0] : null;
        const periodIncome = incomeBusinessContext
            ? toNumber(context.periodIncome?.byBusinessContext?.get(incomeBusinessContext), 0)
            : null;
        const metrics = {
            ...attendanceMetrics,
            periodFrom: context.period.from,
            periodTo: context.period.to,
            periodIncome,
            periodIncomeBusinessContext: incomeBusinessContext,
            periodIncomeSource: incomeBusinessContext ? 'finance_transactions.recognition_date' : null,
            periodIncomeUnavailableReason: businessContexts.length > 1
                ? 'mixed_business_contexts'
                : (businessContexts.length === 0 ? 'business_context_required' : null)
        };
        const scheme = context.schemeMap.get(staff.id) || fallbackSchemeForStaff(staff);
        const professionPay = calculateProfessionPay(staff, scheme, metrics, context.professionRateMap, context.payrollProfileContext);
        const calculation = calculatePayroll(
            staff,
            scheme,
            metrics,
            context.adjustmentMap.get(staff.id),
            context.entryMap.get(staff.id) || [],
            professionPay
        );
        const row = rowFromCalculation(staff, calculation, metrics, context.reportMap.get(staff.id));
        row.kpiAuditSnapshot = buildPayrollKpiAuditSnapshot(
            context.month,
            row,
            context.kpiAuditSnapshotMap?.get(staff.id) || null
        );
        row.kpi_audit_snapshot = row.kpiAuditSnapshot;
        return row;
    });

    const totals = staffRows.reduce((acc, row) => ({
        base: acc.base + row.baseAmount,
        additional: acc.additional + row.additionalAmount,
        bonuses: acc.bonuses + row.bonusesAmount,
        deductions: acc.deductions + row.deductionsAmount,
        advances: acc.advances + row.advancesAmount,
        zrs: acc.zrs + row.zrsAmount,
        gross: acc.gross + row.grossAmount,
        net: acc.net + row.netAmount
    }), { base: 0, additional: 0, bonuses: 0, deductions: 0, advances: 0, zrs: 0, gross: 0, net: 0 });
    return { staffRows, totals };
}

async function getSalaryReport(month, db = pool) {
    const context = await buildPayrollContext(month, {}, db);
    const { staffRows, totals } = buildPayrollRowsFromContext(context);
    const offRosterDraftReports = await loadOffRosterDraftReportReconciliation(
        context.month,
        staffRows.map(row => row.staffId),
        db
    );
    const settlement = await loadPayrollSettlementReadModels(context.month, db);
    const settlementByReportId = new Map((settlement.reports || [])
        .map(report => [Number(report.reportId), report]));
    const staffRowsWithSettlement = staffRows.map(row => {
        const rowSettlement = row.reportId ? settlementByReportId.get(Number(row.reportId)) : null;
        const settlementTotals = rowSettlement?.totals || null;
        const hasVerifiedMovementTotals = rowSettlement?.settlementModel === PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS
            && settlementTotals !== null;
        return {
            ...row,
            settlementModel: rowSettlement?.settlementModel || null,
            payrollSettlement: rowSettlement || null,
            installments: rowSettlement?.installments || [],
            paidAmount: hasVerifiedMovementTotals ? settlementTotals.paidAmount : null,
            paid_amount: hasVerifiedMovementTotals ? settlementTotals.paidAmount : null,
            balanceAmount: hasVerifiedMovementTotals ? settlementTotals.balanceAmount : null,
            balance_amount: hasVerifiedMovementTotals ? settlementTotals.balanceAmount : null,
            outstandingAmount: hasVerifiedMovementTotals ? settlementTotals.outstandingAmount : null,
            outstanding_amount: hasVerifiedMovementTotals ? settlementTotals.outstandingAmount : null,
            overpaidAmount: hasVerifiedMovementTotals ? settlementTotals.overpaidAmount : null,
            overpaid_amount: hasVerifiedMovementTotals ? settlementTotals.overpaidAmount : null
        };
    });

    return {
        month: context.month,
        staff: staffRowsWithSettlement.sort((a, b) => b.netAmount - a.netAmount || String(a.name || '').localeCompare(String(b.name || ''), 'uk')),
        totalSalary: roundMoney(totals.net),
        totals: {
            base: roundMoney(totals.base),
            additional: roundMoney(totals.additional),
            bonuses: roundMoney(totals.bonuses),
            deductions: roundMoney(totals.deductions),
            zrs: roundMoney(totals.zrs),
            advances: roundMoney(totals.advances),
            gross: roundMoney(totals.gross),
            net: roundMoney(totals.net),
            paid: settlement.totals ? roundMoney(settlement.totals.paidAmount) : null,
            balance: settlement.totals ? roundMoney(settlement.totals.outstandingAmount) : null,
            overpaid: settlement.totals ? roundMoney(settlement.totals.overpaidAmount) : null
        },
        schemeTypes: SCHEME_TYPES,
        reconciliation: {
            offRosterDraftReports
        },
        settlement
    };
}

async function getPayrollWorkspace(month, db = pool) {
    const report = await getSalaryReport(month, db);
    const schemes = await fetchAllSchemes(null, db);
    return { ...report, schemes };
}

async function getPayrollPreview(staffId, month, db = pool) {
    const context = await buildPayrollContext(month, {}, db);
    const { staffRows } = buildPayrollRowsFromContext(context);
    const row = staffRows.find(item => item.staffId === Number(staffId));
    if (!row) {
        const err = new Error('staff not found');
        err.status = 404;
        throw err;
    }
    return row;
}

async function getPayrollRangePreview(options = {}, db = pool) {
    const month = normalizePayrollMonth(options.month || String(options.from || '').slice(0, 7));
    const bounds = getMonthBounds(month);
    const from = normalizeDateValue(options.from) || bounds.from;
    const to = normalizeDateValue(options.to) || bounds.to;
    const crossMonth = Boolean(from && to && from.slice(0, 7) !== to.slice(0, 7));
    const fullMonth = from === bounds.from && to === bounds.to && !crossMonth;
    const context = await buildPayrollContext(month, {
        from,
        to,
        includeMonthlyAdjustments: fullMonth,
        includeReports: fullMonth
    }, db);
    const { staffRows, totals } = buildPayrollRowsFromContext(context);
    const staffId = Number(options.staffId || options.staff_id || 0);
    const filteredRows = staffId
        ? staffRows.filter(row => Number(row.staffId) === staffId)
        : staffRows;
    const scopedTotals = filteredRows.reduce((acc, row) => ({
        base: acc.base + row.baseAmount,
        additional: acc.additional + row.additionalAmount,
        bonuses: acc.bonuses + row.bonusesAmount,
        deductions: acc.deductions + row.deductionsAmount,
        zrs: acc.zrs + row.zrsAmount,
        advances: acc.advances + row.advancesAmount,
        gross: acc.gross + row.grossAmount,
        net: acc.net + row.netAmount
    }), { base: 0, additional: 0, bonuses: 0, deductions: 0, zrs: 0, advances: 0, gross: 0, net: 0 });

    return calculatePayrollRangePreview({
        month,
        from,
        to,
        staff: filteredRows.sort((a, b) => b.netAmount - a.netAmount || String(a.name || '').localeCompare(String(b.name || ''), 'uk')),
        totals: {
            base: roundMoney(scopedTotals.base),
            additional: roundMoney(scopedTotals.additional),
            bonuses: roundMoney(scopedTotals.bonuses),
            deductions: roundMoney(scopedTotals.deductions),
            zrs: roundMoney(scopedTotals.zrs),
            advances: roundMoney(scopedTotals.advances),
            gross: roundMoney(scopedTotals.gross),
            net: roundMoney(scopedTotals.net)
        }
    });
}

async function buildCanonicalPayrollInstallmentPreview(options = {}, db = pool) {
    const month = normalizePayrollMonth(options.month || String(options.from || '').slice(0, 7));
    const staffId = Number(options.staffId || options.staff_id || 0);
    if (!Number.isInteger(staffId) || staffId <= 0) {
        throw payrollWorkflowError(
            'valid staffId is required for payroll installment preview',
            400,
            'PAYROLL_SHADOW_STAFF_ID_REQUIRED',
            { staffId: options.staffId || options.staff_id || null }
        );
    }
    const monthRange = payrollMonthRange(month);
    const monthlyPreview = await getPayrollRangePreview({
        month,
        from: monthRange.from,
        to: monthRange.to,
        staffId
    }, db);
    const advancePreview = await getPayrollRangePreview({
        month,
        from: monthRange.from,
        to: `${month}-15`,
        staffId
    }, db);
    const monthlyRow = monthlyPreview.staff?.[0] || null;
    if (!monthlyRow) {
        throw payrollWorkflowError(
            'canonical payroll preview has no staff row for this month',
            404,
            'PAYROLL_SHADOW_SOURCE_STAFF_MISSING',
            { month, staffId }
        );
    }
    const advanceRow = advancePreview.staff?.[0] || {};
    const advanceInstallment = calculateAdvanceInstallment({
        staff: {
            id: monthlyRow.staffId,
            hourlyRate: monthlyRow.hourlyRate,
            rateUnit: monthlyRow.rateUnit
        },
        scheme: {
            id: monthlyRow.schemeId,
            schemeType: monthlyRow.schemeType,
            title: monthlyRow.schemeTitle,
            config: monthlyRow.schemeConfig
        },
        monthMetrics: {
            plannedMinutes: monthlyRow.plannedMinutes,
            paidPlannedMinutes: monthlyRow.paidPlannedMinutes,
            monthlyNormMinutes: monthlyRow.monthlyNormMinutes,
            monthlyNormSource: monthlyRow.monthlyNormSource,
            monthlyNormConfirmed: monthlyRow.monthlyNormConfirmed,
            monthlyNormMonth: monthlyRow.monthlyNormMonth
        },
        advanceMetrics: {
            plannedMinutes: advanceRow.plannedMinutes,
            paidPlannedMinutes: advanceRow.paidPlannedMinutes,
            pieceQuantity: advanceRow.summary?.base && monthlyRow.schemeType === 'piece'
                ? advanceRow.lines?.find(item => item.lineType === 'piece')?.quantity
                : undefined
        },
        monthlyCalculation: { summary: { base: monthlyRow.baseAmount } },
        rangeCalculation: {
            lines: advanceRow.lines || [],
            blockers: payrollCommitBlockingIssues(advanceRow)
        },
        earningFrom: monthRange.from,
        earningTo: `${month}-15`
    });
    const lockedAdvance = options.lockedAdvanceInstallment || options.locked_advance_installment || null;
    const finalInstallment = calculateFinalInstallment({
        monthlyPayroll: {
            summary: { net: monthlyRow.netAmount },
            blockers: payrollCommitBlockingIssues(monthlyRow)
        },
        advanceInstallment: lockedAdvance,
        plannedAdvanceInstallment: lockedAdvance ? null : advanceInstallment,
        currentAdvanceInstallment: advanceInstallment
    });
    const blockers = compactAllocationIssues([
        ...payrollCommitBlockingIssues(monthlyRow),
        ...(advanceInstallment.blockers || []),
        ...(finalInstallment.blockers || [])
    ]);
    return {
        month,
        staffId,
        monthlyNetAmount: roundMoney(monthlyRow.netAmount),
        advanceAmount: roundMoney(advanceInstallment.calculatedAmount),
        finalAmount: roundMoney(finalInstallment.calculatedAmount),
        combinedAmount: roundMoney(advanceInstallment.calculatedAmount + finalInstallment.calculatedAmount),
        monthlyPreview,
        advancePreview,
        monthlyRow,
        advanceRow,
        advanceInstallment,
        finalInstallment,
        blockers
    };
}

function payrollSchemeVersionInput(payload = {}, current = null) {
    const staffId = Number(payload.staffId || payload.staff_id || current?.staff_id);
    const schemeType = String(payload.schemeType || payload.scheme_type || current?.scheme_type || '').trim();
    if (!Number.isInteger(staffId) || staffId <= 0 || !SCHEME_TYPES.includes(schemeType)) {
        throw payrollWorkflowError(
            'staffId and valid schemeType are required',
            400,
            'PAYROLL_SCHEME_INPUT_INVALID'
        );
    }
    const effectiveFrom = normalizePayrollSchemeEffectiveDate(
        payload.effectiveFrom ?? payload.effective_from,
        'effectiveFrom',
        true
    );
    const hasEffectiveTo = Object.prototype.hasOwnProperty.call(payload, 'effectiveTo')
        || Object.prototype.hasOwnProperty.call(payload, 'effective_to');
    const effectiveTo = hasEffectiveTo
        ? normalizePayrollSchemeEffectiveDate(payload.effectiveTo ?? payload.effective_to, 'effectiveTo')
        : normalizeDateValue(current?.effective_to);
    if (effectiveTo && effectiveTo < effectiveFrom) {
        throw payrollWorkflowError(
            'effectiveTo cannot precede effectiveFrom',
            400,
            'PAYROLL_SCHEME_EFFECTIVE_RANGE_INVALID',
            { effectiveFrom, effectiveTo }
        );
    }
    const hasConfig = Object.prototype.hasOwnProperty.call(payload, 'config')
        || Object.prototype.hasOwnProperty.call(payload, 'config_json');
    return {
        staffId,
        schemeType,
        title: payload.title !== undefined
            ? String(payload.title || '').trim().slice(0, 160)
            : (current?.title || schemeTypeLabel(schemeType)),
        requestedActive: payload.isActive !== undefined
            ? payload.isActive === true
            : (payload.is_active !== undefined ? payload.is_active === true : true),
        config: hasConfig
            ? parseConfig(payload.config ?? payload.config_json)
            : parseConfig(current?.config_json),
        effectiveFrom,
        effectiveTo
    };
}

async function assertPayrollSchemeVersionPeriodMutable(client, staffId, effectiveFrom) {
    const month = effectiveFrom.slice(0, 7);
    await lockPayrollPeriodMutation(month, client);
    await assertPayrollPeriodOpen(month, client);
    const report = await client.query(
        `SELECT pr.id, pr.status,
                EXISTS (
                    SELECT 1
                    FROM payroll_installments pi
                    WHERE pi.payroll_report_id = pr.id
                      AND (
                          pi.workflow_status <> 'draft'
                          OR EXISTS (
                              SELECT 1
                              FROM payroll_payment_movements ppm
                              WHERE ppm.installment_id = pi.id
                          )
                      )
                ) AS immutable_installment
         FROM payroll_reports pr
         WHERE pr.staff_id = $1
           AND pr.period_month = $2
         FOR UPDATE OF pr`,
        [staffId, month]
    );
    const immutable = report.rows.find(row => (
        ['reviewed', 'approved', 'paid'].includes(row.status) || row.immutable_installment === true
    ));
    if (immutable) {
        throw payrollWorkflowError(
            'Payroll scheme history is immutable after review, approval, or payment',
            409,
            'PAYROLL_SCHEME_HISTORY_LOCKED',
            { staffId, month, reportId: Number(immutable.id), status: immutable.status }
        );
    }
}

async function createPayrollSchemeVersion(payload, user, sourceSchemeId = null, db = pool) {
    const normalizedSourceId = sourceSchemeId === null || sourceSchemeId === undefined || sourceSchemeId === ''
        ? null
        : Number(sourceSchemeId);
    if (normalizedSourceId !== null && (!Number.isInteger(normalizedSourceId) || normalizedSourceId <= 0)) {
        throw payrollWorkflowError('invalid source scheme id', 400, 'PAYROLL_SCHEME_ID_INVALID');
    }
    const sourcePreview = normalizedSourceId === null
        ? null
        : await db.query('SELECT staff_id FROM payroll_schemes WHERE id = $1', [normalizedSourceId]);
    if (normalizedSourceId !== null && !sourcePreview.rowCount) {
        throw payrollWorkflowError('scheme not found', 404, 'PAYROLL_SCHEME_NOT_FOUND');
    }
    const requestedStaffId = Number(payload.staffId || payload.staff_id || sourcePreview?.rows[0]?.staff_id);
    if (!Number.isInteger(requestedStaffId) || requestedStaffId <= 0) {
        throw payrollWorkflowError(
            'staffId and valid schemeType are required',
            400,
            'PAYROLL_SCHEME_INPUT_INVALID'
        );
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const staff = await client.query('SELECT id FROM staff WHERE id = $1 FOR UPDATE', [requestedStaffId]);
        if (!staff.rowCount) throw payrollWorkflowError('staff not found', 404, 'PAYROLL_SCHEME_STAFF_NOT_FOUND');
        const source = normalizedSourceId === null
            ? null
            : await client.query('SELECT * FROM payroll_schemes WHERE id = $1 FOR UPDATE', [normalizedSourceId]);
        if (normalizedSourceId !== null && !source.rowCount) {
            throw payrollWorkflowError('scheme not found', 404, 'PAYROLL_SCHEME_NOT_FOUND');
        }
        const current = source?.rows[0] || null;
        if (current && Number(current.staff_id) !== requestedStaffId) {
            throw payrollWorkflowError(
                'source scheme belongs to a different staff member',
                409,
                'PAYROLL_SCHEME_STAFF_CONFLICT'
            );
        }
        const version = payrollSchemeVersionInput(payload, current);
        const sourceEffectiveFrom = normalizeDateValue(current?.effective_from);
        if (sourceEffectiveFrom && version.effectiveFrom <= sourceEffectiveFrom) {
            throw payrollWorkflowError(
                'A superseding payroll scheme version must start after its source version',
                409,
                'PAYROLL_SCHEME_EFFECTIVE_FROM_NOT_AFTER_SOURCE',
                {
                    sourceSchemeId: normalizedSourceId,
                    sourceEffectiveFrom,
                    effectiveFrom: version.effectiveFrom
                }
            );
        }
        await assertPayrollSchemeVersionPeriodMutable(client, version.staffId, version.effectiveFrom);

        const sameDate = await client.query(
            `SELECT id
             FROM payroll_schemes
             WHERE staff_id = $1
               AND effective_from = $2
             ORDER BY created_at DESC NULLS LAST, id DESC
             LIMIT 1`,
            [version.staffId, version.effectiveFrom]
        );
        if (sameDate.rowCount) {
            throw payrollWorkflowError(
                'A payroll scheme version already exists for effectiveFrom',
                409,
                'PAYROLL_SCHEME_EFFECTIVE_DATE_CONFLICT',
                { staffId: version.staffId, effectiveFrom: version.effectiveFrom }
            );
        }
        const laterVersion = await client.query(
            `SELECT id
             FROM payroll_schemes
             WHERE staff_id = $1
               AND effective_from > $2
             ORDER BY effective_from ASC, id ASC
             LIMIT 1`,
            [version.staffId, version.effectiveFrom]
        );
        const isActive = version.requestedActive && !laterVersion.rowCount;
        if (isActive) {
            await client.query(
                'UPDATE payroll_schemes SET is_active = false WHERE staff_id = $1 AND is_active = true',
                [version.staffId]
            );
        }
        const result = await client.query(
            `INSERT INTO payroll_schemes
                (staff_id, scheme_type, title, is_active, config_json, effective_from, effective_to, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8)
             RETURNING *`,
            [
                version.staffId,
                version.schemeType,
                version.title,
                isActive,
                JSON.stringify(version.config),
                version.effectiveFrom,
                version.effectiveTo,
                user?.username || null
            ]
        );
        await client.query('COMMIT');
        return {
            ...mapScheme(result.rows[0]),
            supersedesSchemeId: normalizedSourceId
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function createPayrollScheme(payload, user, options = {}) {
    return createPayrollSchemeVersion(
        payload,
        user,
        payload.supersedesSchemeId ?? payload.supersedes_scheme_id ?? null,
        options.db || pool
    );
}

async function updatePayrollScheme(id, payload, user, options = {}) {
    return createPayrollSchemeVersion(payload, user, id, options.db || pool);
}

function assertPayrollRowsGenerationReady(rows = []) {
    const blockingIssues = [];
    for (const row of rows || []) {
        for (const issue of payrollCommitBlockingIssues(row)) {
            blockingIssues.push({
                staffId: row.staff_id ?? row.staffId ?? null,
                staffName: row.staff_name ?? row.name ?? null,
                ...issue
            });
        }
    }
    if (!blockingIssues.length) return;
    const unsupportedOnly = blockingIssues.every(
        issue => issue.code === PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED
    );
    const err = new Error(unsupportedOnly
        ? PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_MESSAGE
        : 'Payroll generation blocked: compensation snapshot requires correction');
    err.status = 409;
    err.statusCode = 409;
    err.code = unsupportedOnly
        ? PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED
        : 'PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED';
    err.details = { blockingIssues };
    throw err;
}

async function auditBlockedPayrollGeneration(month, error, user) {
    const issues = Array.isArray(error?.details?.blockingIssues)
        ? error.details.blockingIssues
        : [];
    const grouped = new Map();
    for (const issue of issues) {
        const staffId = Number(issue.staffId ?? issue.staff_id);
        const key = Number.isInteger(staffId) && staffId > 0 ? staffId : null;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push({
            code: issue.code || error.code || 'PAYROLL_GENERATION_BLOCKED',
            message: issue.message || error.message || 'Payroll generation blocked',
            professionKey: issue.professionKey || issue.profession_key || null,
            date: issue.date || null,
            attendanceRef: issue.attendanceRef ?? issue.attendance_ref ?? null,
            segmentRef: issue.segmentRef ?? issue.segment_ref ?? null,
            roleRef: issue.roleRef ?? issue.role_ref ?? null
        });
    }
    if (!grouped.size) grouped.set(null, [{
        code: error.code || 'PAYROLL_GENERATION_BLOCKED',
        message: error.message || 'Payroll generation blocked'
    }]);
    for (const [staffId, staffIssues] of grouped) {
        await pool.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ('payroll_generation_blocked', $1, $2, $3::jsonb, NULL)`,
            [
                staffId,
                user?.username || null,
                JSON.stringify({
                    eventVersion: 1,
                    month,
                    blockerCode: error.code || null,
                    issues: staffIssues
                })
            ]
        );
    }
}

function payrollWorkflowError(message, statusCode = 400, code = 'PAYROLL_WORKFLOW_INVALID', details = null) {
    const err = new Error(message);
    err.status = statusCode;
    err.statusCode = statusCode;
    err.code = code;
    if (details) err.details = details;
    return err;
}

async function assertPayrollInstallmentMonthWritable(month, db = pool) {
    const normalizedMonth = assertPayrollMonth(month);
    const activationMonth = configuredPayrollInstallmentsActivationMonth();
    if (!isPayrollInstallmentsActivationMonth(normalizedMonth)) {
        throw payrollWorkflowError(
            'Payroll installment workflow is not active for this month',
            409,
            'PAYROLL_INSTALLMENTS_NOT_ACTIVE',
            { month: normalizedMonth, activationMonth }
        );
    }
    await assertPayrollPeriodOpen(normalizedMonth, db);
    return normalizedMonth;
}

function assertPayrollBusinessContextAccess(user, businessContext) {
    if (!canAccessBusinessContext(user, businessContext)) {
        throw payrollWorkflowError(
            'Business context is not available for this payroll action',
            403,
            'PAYROLL_BUSINESS_CONTEXT_FORBIDDEN',
            { businessContext }
        );
    }
    return businessContext;
}

function normalizePayrollInstallmentKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (!PAYROLL_INSTALLMENT_KINDS.includes(value)) {
        throw payrollWorkflowError('valid installment kind is required', 400, 'PAYROLL_INSTALLMENT_KIND_INVALID');
    }
    return value;
}

function payrollWorkflowActor(user = {}) {
    const username = String(user.username || user.name || user.email || '').trim();
    const role = String(user.role || '').trim();
    const userId = Number(user.id || user.userId || user.user_id);
    if (!Number.isInteger(userId) || userId <= 0 || !username || !role) {
        throw payrollWorkflowError(
            'Payroll approval requires authenticated actor id, username, and role',
            403,
            'PAYROLL_APPROVER_REQUIRED'
        );
    }
    return { userId, username, role };
}

function assertPayrollActionPermission(user, action, actor, code = 'PAYROLL_PERMISSION_DENIED') {
    if (!canUseAction(user, action)) {
        throw payrollWorkflowError(
            'Payroll workflow action requires payroll permission',
            403,
            code,
            { action, role: actor.role }
        );
    }
}

function normalizePayrollWorkflowDate(value, code = 'PAYROLL_PAYMENT_DATE_INVALID') {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw payrollWorkflowError('valid actual payment date is required (YYYY-MM-DD)', 400, code);
    }
    return date;
}

function normalizePositiveMoneyAmount(value, fallback = null, code = 'PAYROLL_PAYMENT_AMOUNT_INVALID') {
    if ((value === null || value === undefined || value === '') && fallback !== null) return roundMoney(fallback);
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw payrollWorkflowError('payment amount must be a positive integer', 400, code);
    }
    return roundMoney(amount);
}

function normalizePayrollIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key || key.length > 128) {
        throw payrollWorkflowError(
            'idempotency key is required and must be at most 128 characters',
            400,
            'PAYROLL_PAYMENT_IDEMPOTENCY_KEY_INVALID'
        );
    }
    return key;
}

function normalizePayrollPaymentMethod(value) {
    const method = String(value || '').trim().toLowerCase();
    if (!method) {
        throw payrollWorkflowError('real payment method is required', 400, 'PAYROLL_PAYMENT_METHOD_REQUIRED');
    }
    if (method === 'salary' || method === 'salary_reversal') {
        throw payrollWorkflowError(
            'payment method must be real cash/bank/card method, not payroll source',
            400,
            'PAYROLL_PAYMENT_METHOD_SOURCE_INVALID'
        );
    }
    return method;
}

function normalizePayrollReason(value, fallback, requiredCode = 'PAYROLL_PAYMENT_REASON_REQUIRED') {
    const reason = String(value || '').trim() || fallback;
    if (!reason) throw payrollWorkflowError('payment reason is required', 400, requiredCode);
    return reason;
}

function normalizePayrollPaymentBusinessContext(value) {
    const context = String(value || '').trim();
    if (!context) {
        throw payrollWorkflowError(
            'business context is required for payroll payment',
            400,
            'PAYROLL_BUSINESS_CONTEXT_REQUIRED'
        );
    }
    return context;
}

function payrollRecognitionDate(row = {}) {
    return normalizeDateValue(row.earning_to || row.earningTo);
}

function movementDescription(row = {}, movementType = 'payment') {
    const month = row.period_month || String(row.earning_from || '').slice(0, 7);
    const kind = row.kind === 'advance' ? 'advance' : 'final';
    return movementType === 'reversal'
        ? `Payroll ${kind} reversal ${month}`
        : `Payroll ${kind} payment ${month}`;
}

async function loadPayrollPaymentIdempotency(client, idempotencyKey) {
    const existing = await client.query(
        `SELECT ppm.*, pi.kind, pi.payroll_report_id, pr.period_month, pr.staff_id,
                ft.category_id, ft.account_id, ft.payment_method, ft.business_context,
                ft.description AS finance_description, ft.recognition_date
         FROM payroll_payment_movements ppm
         JOIN payroll_installments pi ON pi.id = ppm.installment_id
         JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
         JOIN finance_transactions ft ON ft.id = ppm.finance_transaction_id
         WHERE ppm.idempotency_key = $1`,
        [idempotencyKey]
    );
    return existing.rows[0] || null;
}

function payrollIdempotencyRequestAmount(options = {}, existingAmount = 0) {
    if (options.amount === null || options.amount === undefined || options.amount === '') {
        return roundMoney(existingAmount);
    }
    const amount = Number(options.amount);
    return Number.isFinite(amount) ? roundMoney(amount) : Number.NaN;
}

function assertPayrollMovementIdempotentReplay(existing, request = {}, options = {}) {
    const movementType = request.movementType;
    const targetField = movementType === 'reversal' ? 'reverses_movement_id' : 'installment_id';
    const expectedDescription = String(options.description || movementDescription(existing, movementType));
    const expected = {
        movementType,
        target: Number(request.targetId),
        amount: payrollIdempotencyRequestAmount(options, existing.amount),
        actualPaymentDate: request.actualPaymentDate,
        businessContext: request.businessContext,
        paymentMethod: request.paymentMethod,
        categoryId: Number(options.categoryId || options.category_id),
        accountId: Number(options.accountId || options.account_id),
        reason: request.reason,
        description: expectedDescription
    };
    const actual = {
        movementType: existing.movement_type,
        target: Number(existing[targetField]),
        amount: roundMoney(existing.amount),
        actualPaymentDate: normalizeDateValue(existing.actual_payment_date),
        businessContext: String(existing.business_context || ''),
        paymentMethod: String(existing.payment_method || '').trim().toLowerCase(),
        categoryId: Number(existing.category_id),
        accountId: Number(existing.account_id),
        reason: String(existing.reason || ''),
        description: String(existing.finance_description || '')
    };
    const mismatchedFields = Object.keys(expected).filter(field => (
        !Number.isNaN(expected[field])
            ? actual[field] !== expected[field]
            : true
    ));
    if (mismatchedFields.length) {
        throw payrollWorkflowError(
            'idempotency key was already used with a different payroll movement request',
            409,
            'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
            {
                idempotencyKey: existing.idempotency_key,
                mismatchedFields
            }
        );
    }
    return existing;
}

function payrollIdempotentMovementResult(existing) {
    return {
        success: true,
        idempotent: true,
        movement: mapPayrollPaymentMovement(existing),
        financeTransactionId: Number(existing.finance_transaction_id)
    };
}

async function loadPayrollInstallmentForPayment(client, installmentId) {
    const current = await client.query(
        `WITH movement_totals AS (
            SELECT installment_id,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'payment'), 0)::numeric AS payment_total,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'reversal'), 0)::numeric AS reversal_total
            FROM payroll_payment_movements
            WHERE installment_id = $1
            GROUP BY installment_id
         )
         SELECT pi.*, pr.period_month, pr.staff_id, pr.status AS report_status, pr.settlement_model,
                s.name AS staff_name,
                COALESCE(mt.payment_total, 0)::numeric AS payment_total,
                COALESCE(mt.reversal_total, 0)::numeric AS reversal_total
         FROM payroll_installments pi
         JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
         LEFT JOIN staff s ON s.id = pr.staff_id
         LEFT JOIN movement_totals mt ON mt.installment_id = pi.id
         WHERE pi.id = $1
         FOR UPDATE OF pi, pr`,
        [installmentId]
    );
    if (!current.rowCount) {
        throw payrollWorkflowError('payroll installment not found', 404, 'PAYROLL_INSTALLMENT_NOT_FOUND');
    }
    return current.rows[0];
}

async function assertFinanceCategoryForPayroll(client, categoryId, businessContext, expectedType) {
    const id = Number(categoryId);
    if (!Number.isInteger(id) || id <= 0) {
        throw payrollWorkflowError('finance category is required for payroll payment', 400, 'PAYROLL_FINANCE_CATEGORY_REQUIRED');
    }
    const category = await client.query(
        `SELECT id, type, name
         FROM finance_categories
         WHERE id = $1
           AND is_active = true
           AND COALESCE(business_context, 'event_genix') = $2
         FOR SHARE`,
        [id, businessContext]
    );
    if (!category.rowCount) {
        throw payrollWorkflowError('finance category not found in selected business', 400, 'PAYROLL_FINANCE_CATEGORY_NOT_FOUND');
    }
    if (category.rows[0].type !== expectedType) {
        throw payrollWorkflowError('finance category type does not match payroll transaction type', 400, 'PAYROLL_FINANCE_CATEGORY_TYPE_INVALID', {
            expectedType,
            actualType: category.rows[0].type
        });
    }
    return category.rows[0];
}

async function assertFinanceAccountForPayroll(client, accountId, businessContext) {
    const id = Number(accountId);
    if (!Number.isInteger(id) || id <= 0) {
        throw payrollWorkflowError('finance account is required for payroll payment', 400, 'PAYROLL_FINANCE_ACCOUNT_REQUIRED');
    }
    const account = await client.query(
        `SELECT id, name, type
         FROM finance_accounts
         WHERE id = $1
           AND is_active = true
           AND COALESCE(business_context, 'event_genix') = $2
         FOR SHARE`,
        [id, businessContext]
    );
    if (!account.rowCount) {
        throw payrollWorkflowError('finance account not found in selected business', 400, 'PAYROLL_FINANCE_ACCOUNT_NOT_FOUND');
    }
    return account.rows[0];
}

function assertPayrollInstallmentPayable(row, businessContext) {
    if (row.settlement_model !== PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS) {
        throw payrollWorkflowError('legacy payroll report cannot be paid through installment workflow', 409, 'PAYROLL_LEGACY_PAYMENT_BLOCKED');
    }
    if (row.workflow_status !== 'approved' || row.locked_amount === null || row.locked_amount === undefined) {
        throw payrollWorkflowError('payroll installment must be approved before payment', 409, 'PAYROLL_INSTALLMENT_NOT_APPROVED');
    }
    if (row.allocation_status !== 'single' || !row.business_context) {
        throw payrollWorkflowError('payroll installment allocation must be resolved before payment', 409, 'PAYROLL_ALLOCATION_UNRESOLVED', {
            installmentId: Number(row.id),
            allocationStatus: row.allocation_status
        });
    }
    if (row.business_context !== businessContext) {
        throw payrollWorkflowError('payroll installment business context does not match request', 409, 'PAYROLL_BUSINESS_CONTEXT_MISMATCH', {
            installmentBusinessContext: row.business_context,
            requestedBusinessContext: businessContext
        });
    }
}

function mapPayrollPaymentMovement(row = {}) {
    return {
        id: Number(row.id),
        installmentId: Number(row.installment_id ?? row.installmentId),
        movementType: row.movement_type ?? row.movementType,
        amount: Number(row.amount || 0),
        actualPaymentDate: normalizeDateValue(row.actual_payment_date ?? row.actualPaymentDate),
        actorUserId: row.actor_user_id === null || row.actor_user_id === undefined ? null : Number(row.actor_user_id),
        actorUsername: row.actor_username ?? row.actorUsername ?? null,
        actorRole: row.actor_role ?? row.actorRole ?? null,
        reason: row.reason || '',
        idempotencyKey: row.idempotency_key ?? row.idempotencyKey ?? null,
        financeTransactionId: Number(row.finance_transaction_id ?? row.financeTransactionId),
        reversesMovementId: row.reverses_movement_id === null || row.reverses_movement_id === undefined
            ? null
            : Number(row.reverses_movement_id),
        createdAt: row.created_at ?? row.createdAt ?? null
    };
}

function payrollInstallmentSchedule(month, kind) {
    const range = payrollMonthRange(month);
    if (kind === 'advance') {
        return {
            earningFrom: range.from,
            earningTo: `${month}-15`,
            scheduledPaymentDate: `${month}-20`
        };
    }
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7));
    const scheduled = new Date(Date.UTC(year, monthIndex, 10));
    return {
        earningFrom: `${month}-16`,
        earningTo: range.to,
        scheduledPaymentDate: scheduled.toISOString().slice(0, 10)
    };
}

function payrollFormulaFingerprintSnapshot(kind, value = {}) {
    const snapshot = { ...parseConfig(value) };
    if (kind === 'final') {
        delete snapshot.advancePaidAmount;
        delete snapshot.advanceOutstandingAmount;
    }
    return snapshot;
}

function payrollRowSchemeSnapshotMetadata(row = {}, fallback = {}) {
    const versionId = row.schemeVersionId ?? row.schemeId ?? fallback.schemeVersionId ?? fallback.schemeId ?? null;
    return {
        versionId,
        id: versionId,
        schemeId: versionId,
        type: row.schemeType ?? fallback.schemeType ?? null,
        title: row.schemeTitle ?? fallback.schemeTitle ?? '',
        effectiveFrom: row.schemeEffectiveFrom ?? fallback.schemeEffectiveFrom ?? null,
        effectiveTo: row.schemeEffectiveTo ?? fallback.schemeEffectiveTo ?? null,
        configHash: row.schemeConfigHash ?? fallback.schemeConfigHash ?? null,
        updatedAt: row.schemeUpdatedAt ?? fallback.schemeUpdatedAt ?? null
    };
}

function payrollInstallmentSnapshot(kind, monthlyRow = {}, installment = {}, extra = {}, fingerprintRow = monthlyRow) {
    const sourceRow = fingerprintRow || monthlyRow;
    const sourceScheme = payrollRowSchemeSnapshotMetadata(sourceRow, monthlyRow);
    const monthlyScheme = payrollRowSchemeSnapshotMetadata(monthlyRow, sourceRow);
    const sourcePayload = {
        schemaVersion: 2,
        kind,
        payrollReport: {
            staffId: sourceRow.staffId ?? monthlyRow.staffId,
            ...sourceScheme,
            ...(kind === 'final' ? { monthlyNetAmount: monthlyRow.netAmount } : {})
        },
        metrics: {
            totalMinutes: sourceRow.totalMinutes,
            physicalMinutes: sourceRow.physicalMinutes,
            allocatedMinutes: sourceRow.allocatedMinutes,
            overtimeMinutes: sourceRow.overtimeMinutes,
            plannedMinutes: sourceRow.plannedMinutes,
            paidPlannedMinutes: sourceRow.paidPlannedMinutes,
            monthlyNormMinutes: sourceRow.monthlyNormMinutes,
            monthlyNormSource: sourceRow.monthlyNormSource,
            monthlyNormConfirmed: sourceRow.monthlyNormConfirmed,
            monthlyNormMonth: sourceRow.monthlyNormMonth,
            businessContexts: sourceRow.businessContexts || [],
            periodIncomeBusinessContext: sourceRow.periodIncomeBusinessContext || null,
            daysWorked: sourceRow.daysWorked
        },
        lines: sourceRow.lines || [],
        payrollBlockingIssues: sourceRow.payrollBlockingIssues || [],
        amount: installment.amount ?? installment.calculatedAmount ?? 0,
        blockers: installment.blockers || [],
        corrections: installment.corrections || [],
        calculation: payrollFormulaFingerprintSnapshot(kind, installment.calculationSnapshot || {}),
        kpiAuditSnapshot: kind === 'final'
            ? (monthlyRow.kpiAuditSnapshot || monthlyRow.kpi_audit_snapshot || null)
            : null
    };
    const snapshot = {
        schemaVersion: 2,
        kind,
        source: 'services/payroll.generatePayrollReports',
        generatedAt: new Date().toISOString(),
        sourceFingerprint: createHash('sha256')
            .update(stablePayrollJson(sourcePayload))
            .digest('hex'),
        payrollReport: {
            staffId: monthlyRow.staffId,
            staffName: monthlyRow.name,
            ...monthlyScheme,
            monthlyNetAmount: monthlyRow.netAmount
        },
        businessContexts: sourceRow.businessContexts || [],
        periodIncomeBusinessContext: sourceRow.periodIncomeBusinessContext || null,
        amount: installment.amount ?? installment.calculatedAmount ?? 0,
        blockers: installment.blockers || [],
        corrections: installment.corrections || [],
        calculation: installment.calculationSnapshot || {},
        ...extra
    };
    if (kind === 'final' && (monthlyRow.kpiAuditSnapshot || monthlyRow.kpi_audit_snapshot)) {
        snapshot.kpiAuditSnapshot = monthlyRow.kpiAuditSnapshot || monthlyRow.kpi_audit_snapshot;
    }
    return snapshot;
}

function payrollReportBreakdown(row = {}) {
    return {
        scheme: payrollRowSchemeSnapshotMetadata(row),
        metrics: {
            hoursWorked: row.hoursWorked,
            daysWorked: row.daysWorked,
            totalMinutes: row.totalMinutes,
            physicalMinutes: row.physicalMinutes,
            allocatedMinutes: row.allocatedMinutes,
            overtimeMinutes: row.overtimeMinutes,
            plannedMinutes: row.plannedMinutes,
            paidPlannedMinutes: row.paidPlannedMinutes,
            monthlyNormMinutes: row.monthlyNormMinutes,
            monthlyNormSource: row.monthlyNormSource,
            monthlyNormConfirmed: row.monthlyNormConfirmed,
            monthlyNormMonth: row.monthlyNormMonth,
            compensationMinutes: row.compensationMinutes,
            roleMinutes: row.roleMinutes,
            baseProfessionAllocations: row.baseProfessionAllocations,
            additionalProfessionAllocations: row.additionalProfessionAllocations
        },
        professionRateSummary: row.professionRateSummary,
        reconciliation: row.reconciliation,
        allocationIssues: row.allocationIssues,
        payrollBlockingIssues: row.payrollBlockingIssues,
        kpiAuditSnapshot: row.kpiAuditSnapshot || row.kpi_audit_snapshot || null,
        transparency: row.payrollTransparency,
        lines: row.lines,
        summary: row.summary
    };
}

async function upsertDraftPayrollInstallment(client, reportId, row, kind, installment, user, fingerprintRow = row) {
    const schedule = payrollInstallmentSchedule(row.periodMonth || row.month, kind);
    const snapshot = payrollInstallmentSnapshot(kind, row, installment, {
        earningFrom: schedule.earningFrom,
        earningTo: schedule.earningTo,
        scheduledPaymentDate: schedule.scheduledPaymentDate
    }, fingerprintRow);
    const result = await client.query(
        `INSERT INTO payroll_installments
            (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
             calculated_amount, locked_amount, calculation_snapshot, workflow_status,
             allocation_status, business_context, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, 'draft', 'unresolved', NULL, $8, $8)
         ON CONFLICT (payroll_report_id, kind) DO UPDATE SET
            earning_from = EXCLUDED.earning_from,
            earning_to = EXCLUDED.earning_to,
            scheduled_payment_date = EXCLUDED.scheduled_payment_date,
            calculated_amount = EXCLUDED.calculated_amount,
            calculation_snapshot = EXCLUDED.calculation_snapshot,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
         WHERE payroll_installments.workflow_status = 'draft'
         RETURNING *`,
        [
            reportId,
            kind,
            schedule.earningFrom,
            schedule.earningTo,
            schedule.scheduledPaymentDate,
            installment.calculatedAmount ?? installment.amount ?? 0,
            JSON.stringify(snapshot),
            user?.username || null
        ]
    );
    return result.rows[0] || null;
}

async function loadAdvanceInstallmentDecisions(month, db = pool) {
    const result = await db.query(
        `WITH movement_totals AS (
            SELECT installment_id,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'payment'), 0)::numeric AS payment_total,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'reversal'), 0)::numeric AS reversal_total
            FROM payroll_payment_movements
            GROUP BY installment_id
         )
         SELECT pi.*, pr.staff_id,
                COALESCE(mt.payment_total, 0)::numeric AS payment_total,
                COALESCE(mt.reversal_total, 0)::numeric AS reversal_total
         FROM payroll_installments pi
         JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
         LEFT JOIN movement_totals mt ON mt.installment_id = pi.id
         WHERE pr.period_month = $1
           AND pr.settlement_model = $2
           AND pi.kind = 'advance'
           AND pi.workflow_status IN ('approved', 'cancelled')`,
        [month, PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS]
    );
    return new Map(result.rows.map(row => [Number(row.staff_id), mapPayrollInstallment(row)]));
}

async function generatePayrollReports(month, user) {
    const normalizedMonth = await assertPayrollInstallmentMonthWritable(month);
    const client = await pool.connect();
    const generated = [];
    const skipped = [];
    let report;

    try {
        await client.query('BEGIN');
        await lockPayrollPeriodMutation(normalizedMonth, client);
        await assertPayrollPeriodOpen(normalizedMonth, client);
        report = await getSalaryReport(normalizedMonth, client);
        const monthRange = payrollMonthRange(report.month);
        const advancePreview = await getPayrollRangePreview({
            month: report.month,
            from: monthRange.from,
            to: `${report.month}-15`
        }, client);
        const advanceRowMap = new Map((advancePreview.staff || []).map(row => [Number(row.staffId), row]));
        const advanceDecisionMap = await loadAdvanceInstallmentDecisions(report.month, client);
        for (const row of report.staff) {
            const existing = await client.query(
                'SELECT * FROM payroll_reports WHERE period_month = $1 AND staff_id = $2',
                [report.month, row.staffId]
            );
            if (existing.rowCount && (
                existing.rows[0].voided_at
                || ['approved', 'paid', 'voided'].includes(existing.rows[0].status)
            )) {
                skipped.push({ staffId: row.staffId, status: existing.rows[0].status });
                continue;
            }
            if (existing.rowCount
                && existing.rows[0].settlement_model === PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS
                && existing.rows[0].status !== 'draft') {
                throw payrollWorkflowError(
                    'Installment payroll report status drift must be resolved before recalculation',
                    409,
                    'PAYROLL_REPORT_STATE_DRIFT',
                    {
                        reportId: Number(existing.rows[0].id),
                        status: existing.rows[0].status
                    }
                );
            }
            if (existing.rowCount && (
                existing.rows[0].finance_transaction_id
                || existing.rows[0].reversal_transaction_id
            )) {
                throw payrollWorkflowError(
                    'Legacy payroll report finance links require reconciliation before installment conversion',
                    409,
                    'PAYROLL_LEGACY_FINANCE_LINK_CONFLICT',
                    {
                        reportId: Number(existing.rows[0].id),
                        financeTransactionId: existing.rows[0].finance_transaction_id
                            ? Number(existing.rows[0].finance_transaction_id)
                            : null,
                        reversalTransactionId: existing.rows[0].reversal_transaction_id
                            ? Number(existing.rows[0].reversal_transaction_id)
                            : null
                    }
                );
            }

            const breakdown = payrollReportBreakdown(row);

            let result;
            if (existing.rowCount) {
                result = await client.query(`
                    UPDATE payroll_reports SET
                        scheme_id = $1,
                        gross_amount = $2,
                        deductions_amount = $3,
                        advances_amount = $4,
                        net_amount = $5,
                        status = 'draft',
                        settlement_model = $9,
                        breakdown_json = $6::jsonb,
                        generated_at = NOW(),
                        updated_by = $7,
                        updated_at = NOW()
                    WHERE id = $8
                    RETURNING *
                `, [row.schemeId, row.grossAmount, row.deductionsAmount, row.advancesAmount, row.netAmount,
                    JSON.stringify(breakdown), user?.username || null, existing.rows[0].id,
                    PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS]);
            } else {
                result = await client.query(`
                    INSERT INTO payroll_reports
                        (period_month, staff_id, scheme_id, gross_amount, deductions_amount, advances_amount,
                         net_amount, status, settlement_model, breakdown_json, generated_at, created_by, updated_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9::jsonb,NOW(),$10,$10)
                    RETURNING *
                `, [report.month, row.staffId, row.schemeId, row.grossAmount, row.deductionsAmount,
                    row.advancesAmount, row.netAmount, PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS,
                    JSON.stringify(breakdown), user?.username || null]);
            }
            const reportId = Number(result.rows[0].id);
            const advanceRow = advanceRowMap.get(Number(row.staffId)) || {};
            const advanceInstallment = calculateAdvanceInstallment({
                staff: { id: row.staffId, hourlyRate: row.hourlyRate, rateUnit: row.rateUnit },
                scheme: { id: row.schemeId, schemeType: row.schemeType, title: row.schemeTitle },
                monthMetrics: {
                    plannedMinutes: row.plannedMinutes,
                    paidPlannedMinutes: row.paidPlannedMinutes,
                    monthlyNormMinutes: row.monthlyNormMinutes,
                    monthlyNormSource: row.monthlyNormSource,
                    monthlyNormConfirmed: row.monthlyNormConfirmed,
                    monthlyNormMonth: row.monthlyNormMonth
                },
                advanceMetrics: {
                    plannedMinutes: advanceRow.plannedMinutes,
                    paidPlannedMinutes: advanceRow.paidPlannedMinutes
                },
                monthlyCalculation: { summary: { base: row.baseAmount } },
                rangeCalculation: {
                    lines: advanceRow.lines || [],
                    blockers: payrollCommitBlockingIssues(advanceRow)
                },
                earningFrom: monthRange.from,
                earningTo: `${report.month}-15`
            });
            const advanceDecision = advanceDecisionMap.get(Number(row.staffId));
            const finalInstallment = calculateFinalInstallment({
                monthlyPayroll: {
                    summary: { net: row.netAmount },
                    blockers: payrollCommitBlockingIssues(row)
                },
                advanceInstallment: advanceDecision || null,
                plannedAdvanceInstallment: advanceDecision ? null : advanceInstallment,
                currentAdvanceInstallment: advanceInstallment
            });
            row.periodMonth = report.month;
            await upsertDraftPayrollInstallment(client, reportId, row, 'advance', advanceInstallment, user, advanceRow);
            await upsertDraftPayrollInstallment(client, reportId, row, 'final', finalInstallment, user);
            const additionalLines = (row.lines || []).filter(lineItem =>
                lineItem.lineType === SIMULTANEOUS_ADDITIONAL_LINE_TYPE
                || lineItem.line_type === SIMULTANEOUS_ADDITIONAL_LINE_TYPE);
            if (additionalLines.length) {
                await client.query(
                    `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
                     VALUES ('payroll_additional_line_generated', $1, $2, $3::jsonb, NULL)`,
                    [
                        row.staffId,
                        user?.username || null,
                        JSON.stringify({
                            eventVersion: 1,
                            month: report.month,
                            reportId: Number(result.rows[0].id),
                            reportStatus: 'draft',
                            regenerated: existing.rowCount > 0,
                            physicalMinutes: row.physicalMinutes,
                            baseRoleMinutes: row.payrollTransparency?.baseRoleMinutes,
                            additionalRoleMinutes: row.payrollTransparency?.additionalRoleMinutes,
                            additionalAmount: row.additionalAmount,
                            lines: additionalLines
                        })
                    ]
                );
            }
            generated.push(result.rows[0]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return {
        success: true,
        month: report.month,
        generated: generated.length,
        skipped,
        reports: generated
    };
}

async function calculateCurrentPayrollInstallment(row, advanceDecisionRow = null, db = pool) {
    const month = normalizePayrollMonth(row.period_month);
    const staffId = Number(row.staff_id);
    const monthRange = payrollMonthRange(month);
    const monthlyRow = await getPayrollPreview(staffId, month, db);
    const advancePreview = await getPayrollRangePreview({
        month,
        from: monthRange.from,
        to: `${month}-15`,
        staffId
    }, db);
    monthlyRow.periodMonth = month;
    const advanceRow = advancePreview.staff?.[0] || {};
    const currentAdvance = calculateAdvanceInstallment({
        staff: {
            id: monthlyRow.staffId,
            hourlyRate: monthlyRow.hourlyRate,
            rateUnit: monthlyRow.rateUnit
        },
        scheme: {
            id: monthlyRow.schemeId,
            schemeType: monthlyRow.schemeType,
            title: monthlyRow.schemeTitle
        },
        monthMetrics: {
            plannedMinutes: monthlyRow.plannedMinutes,
            paidPlannedMinutes: monthlyRow.paidPlannedMinutes,
            monthlyNormMinutes: monthlyRow.monthlyNormMinutes,
            monthlyNormSource: monthlyRow.monthlyNormSource,
            monthlyNormConfirmed: monthlyRow.monthlyNormConfirmed,
            monthlyNormMonth: monthlyRow.monthlyNormMonth
        },
        advanceMetrics: {
            plannedMinutes: advanceRow.plannedMinutes,
            paidPlannedMinutes: advanceRow.paidPlannedMinutes
        },
        monthlyCalculation: { summary: { base: monthlyRow.baseAmount } },
        rangeCalculation: {
            lines: advanceRow.lines || [],
            blockers: payrollCommitBlockingIssues(advanceRow)
        },
        earningFrom: monthRange.from,
        earningTo: `${month}-15`
    });
    const advanceDecision = advanceDecisionRow
        ? mapPayrollInstallment(advanceDecisionRow)
        : null;
    const installment = row.kind === 'advance'
        ? currentAdvance
        : calculateFinalInstallment({
            monthlyPayroll: {
                summary: { net: monthlyRow.netAmount },
                blockers: payrollCommitBlockingIssues(monthlyRow)
            },
            advanceInstallment: advanceDecision,
            plannedAdvanceInstallment: advanceDecision ? null : currentAdvance,
            currentAdvanceInstallment: currentAdvance
        });
    const snapshot = payrollInstallmentSnapshot(row.kind, monthlyRow, installment, {
        earningFrom: normalizeDateValue(row.earning_from),
        earningTo: normalizeDateValue(row.earning_to),
        scheduledPaymentDate: normalizeDateValue(row.scheduled_payment_date)
    }, row.kind === 'advance' ? advanceRow : monthlyRow);
    return { monthlyRow, currentAdvance, installment, snapshot };
}

async function lockPayrollInstallmentPeriodFirst(client, installmentId) {
    const owner = await client.query(
        `SELECT pr.period_month
         FROM payroll_installments pi
         JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
         WHERE pi.id = $1`,
        [installmentId]
    );
    if (!owner.rowCount) {
        throw payrollWorkflowError('payroll installment not found', 404, 'PAYROLL_INSTALLMENT_NOT_FOUND');
    }
    const month = owner.rows[0].period_month;
    await lockPayrollPeriodMutation(month, client);
    return month;
}

async function lockPayrollMovementPeriodFirst(client, movementId) {
    const owner = await client.query(
        `SELECT pr.period_month
         FROM payroll_payment_movements ppm
         JOIN payroll_installments pi ON pi.id = ppm.installment_id
         JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
         WHERE ppm.id = $1`,
        [movementId]
    );
    if (!owner.rowCount) {
        throw payrollWorkflowError('payroll payment movement not found', 404, 'PAYROLL_PAYMENT_MOVEMENT_NOT_FOUND');
    }
    const month = owner.rows[0].period_month;
    await lockPayrollPeriodMutation(month, client);
    return month;
}

async function lockPayrollReportPeriodFirst(client, reportId) {
    const owner = await client.query(
        'SELECT period_month FROM payroll_reports WHERE id = $1',
        [reportId]
    );
    if (!owner.rowCount) {
        const err = new Error('report not found');
        err.status = 404;
        throw err;
    }
    const month = owner.rows[0].period_month;
    await lockPayrollPeriodMutation(month, client);
    return month;
}

async function approvePayrollInstallment(id, user, options = {}) {
    const installmentId = Number(id);
    if (!Number.isInteger(installmentId) || installmentId <= 0) {
        throw payrollWorkflowError('valid installment id is required', 400, 'PAYROLL_INSTALLMENT_ID_INVALID');
    }
    const actor = payrollWorkflowActor(user);
    assertPayrollActionPermission(user, 'approve_payroll_installment', actor, 'PAYROLL_APPROVAL_PERMISSION_DENIED');
    const businessContext = String(options.businessContext || options.business_context || '').trim();
    if (!businessContext) {
        throw payrollWorkflowError('business context is required to approve payroll installment', 400, 'PAYROLL_BUSINESS_CONTEXT_REQUIRED');
    }
    assertPayrollBusinessContextAccess(user, businessContext);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockPayrollInstallmentPeriodFirst(client, installmentId);
        const current = await client.query(
            `SELECT pi.*, pr.period_month, pr.staff_id, pr.status AS report_status, pr.settlement_model,
                    pr.net_amount AS report_net_amount
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pi.id = $1
             FOR UPDATE OF pi, pr`,
            [installmentId]
        );
        if (!current.rowCount) throw payrollWorkflowError('payroll installment not found', 404, 'PAYROLL_INSTALLMENT_NOT_FOUND');
        const row = current.rows[0];
        if (row.settlement_model !== PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS) {
            throw payrollWorkflowError('legacy payroll report cannot be approved through installment workflow', 409, 'PAYROLL_LEGACY_REPORT_APPROVAL_BLOCKED');
        }
        if (row.workflow_status !== 'draft') {
            throw payrollWorkflowError('only draft payroll installments can be approved', 409, 'PAYROLL_INSTALLMENT_APPROVAL_TRANSITION_INVALID', {
                installmentId,
                workflowStatus: row.workflow_status
            });
        }
        await assertPayrollPeriodOpen(row.period_month, client);
        const asOfDate = normalizeDateValue(options.asOfDate || options.as_of_date || new Date());
        const earningTo = normalizeDateValue(row.earning_to);
        if (!asOfDate || !earningTo || earningTo > asOfDate) {
            throw payrollWorkflowError(
                'Payroll earning range must be closed before installment approval',
                409,
                'PAYROLL_EARNING_RANGE_OPEN',
                { installmentId, earningTo, asOfDate }
            );
        }
        const snapshot = parseConfig(row.calculation_snapshot);
        const calculationBusinessContexts = Array.isArray(snapshot.businessContexts)
            ? snapshot.businessContexts.filter(Boolean)
            : [];
        if (calculationBusinessContexts.length > 1) {
            throw payrollWorkflowError(
                'Payroll installment contains unresolved mixed business contexts',
                409,
                'PAYROLL_ALLOCATION_UNRESOLVED',
                { installmentId, businessContexts: calculationBusinessContexts }
            );
        }
        if (calculationBusinessContexts.length === 1 && calculationBusinessContexts[0] !== businessContext) {
            throw payrollWorkflowError(
                'Payroll calculation business context does not match approval context',
                409,
                'PAYROLL_BUSINESS_CONTEXT_MISMATCH',
                {
                    installmentId,
                    calculationBusinessContext: calculationBusinessContexts[0],
                    requestedBusinessContext: businessContext
                }
            );
        }
        const storedBlockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
        let advanceRow = null;
        if (row.kind === 'final') {
            const advance = await client.query(
                `SELECT id, workflow_status, calculated_amount, locked_amount
                 FROM payroll_installments
                 WHERE payroll_report_id = $1 AND kind = 'advance'
                 FOR UPDATE`,
                [row.payroll_report_id]
            );
            advanceRow = advance.rows[0] || null;
            if (advanceRow?.workflow_status === 'draft') {
                throw payrollWorkflowError(
                    'final payroll installment requires an approved or cancelled advance decision',
                    409,
                    'PAYROLL_ADVANCE_DECISION_REQUIRED',
                    { installmentId, advanceInstallmentId: Number(advanceRow.id) }
                );
            }
            const advanceDue = advanceRow?.workflow_status === 'approved'
                ? roundMoney(advanceRow.locked_amount ?? advanceRow.calculated_amount)
                : 0;
            const expectedFinalAmount = Math.max(roundMoney(row.report_net_amount) - advanceDue, 0);
            if (roundMoney(row.calculated_amount) !== expectedFinalAmount) {
                throw payrollWorkflowError(
                    'final payroll installment must be recalculated after the advance decision',
                    409,
                    'PAYROLL_FINAL_RECALCULATION_REQUIRED',
                    {
                        installmentId,
                        calculatedAmount: roundMoney(row.calculated_amount),
                        expectedFinalAmount,
                        advanceDueAmount: advanceDue
                    }
                );
            }
        }
        const fresh = await calculateCurrentPayrollInstallment(row, advanceRow, client);
        const freshBlockers = Array.isArray(fresh.installment.blockers)
            ? fresh.installment.blockers
            : [];
        if (freshBlockers.length) {
            throw payrollWorkflowError('payroll installment approval is blocked by unresolved calculation issues', 409, 'PAYROLL_INSTALLMENT_APPROVAL_BLOCKED', {
                installmentId,
                blockers: freshBlockers
            });
        }
        const calculatedAmount = roundMoney(row.calculated_amount);
        const freshAmount = roundMoney(fresh.installment.calculatedAmount ?? fresh.installment.amount);
        if (calculatedAmount !== freshAmount
            || !snapshot.sourceFingerprint
            || snapshot.sourceFingerprint !== fresh.snapshot.sourceFingerprint
            || storedBlockers.length > 0) {
            throw payrollWorkflowError(
                'Payroll installment sources changed; recalculate before approval',
                409,
                row.kind === 'final'
                    ? 'PAYROLL_FINAL_RECALCULATION_REQUIRED'
                    : 'PAYROLL_INSTALLMENT_RECALCULATION_REQUIRED',
                {
                    installmentId,
                    calculatedAmount,
                    freshAmount,
                    sourceFingerprintChanged: snapshot.sourceFingerprint !== fresh.snapshot.sourceFingerprint,
                    storedBlockers
                }
            );
        }
        const approved = await client.query(
            `UPDATE payroll_installments
             SET workflow_status = 'approved',
                 locked_amount = ROUND(calculated_amount)::int,
                 allocation_status = 'single',
                 business_context = $1,
                 approved_by_user_id = $2,
                 approved_by_username = $3,
                 approved_by_role = $4,
                 approved_at = NOW(),
                 updated_by = $3,
                 updated_at = NOW()
             WHERE id = $5
               AND workflow_status = 'draft'
             RETURNING *`,
            [businessContext, actor.userId, actor.username, actor.role, installmentId]
        );
        if (!approved.rowCount) {
            throw payrollWorkflowError('payroll installment approval transition failed', 409, 'PAYROLL_INSTALLMENT_APPROVAL_CONFLICT');
        }
        await client.query(
            `UPDATE payroll_reports pr
             SET status = CASE
                    WHEN pr.status = 'draft'
                     AND NOT EXISTS (
                        SELECT 1
                        FROM payroll_installments pending
                        WHERE pending.payroll_report_id = pr.id
                          AND pending.workflow_status = 'draft'
                     )
                    THEN 'approved'
                    ELSE pr.status
                 END,
                  updated_by = $1,
                  updated_at = NOW()
             WHERE pr.id = $2
               AND pr.status <> 'paid'`,
            [actor.username, row.payroll_report_id]
        );
        await client.query('COMMIT');
        return mapPayrollInstallment(approved.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function cancelPayrollAdvanceInstallment(id, user, options = {}) {
    const installmentId = Number(id);
    if (!Number.isInteger(installmentId) || installmentId <= 0) {
        throw payrollWorkflowError('valid installment id is required', 400, 'PAYROLL_INSTALLMENT_ID_INVALID');
    }
    const actor = payrollWorkflowActor(user);
    assertPayrollActionPermission(user, 'approve_payroll_installment', actor, 'PAYROLL_APPROVAL_PERMISSION_DENIED');
    const reason = normalizePayrollReason(options.reason, '', 'PAYROLL_ADVANCE_CANCEL_REASON_REQUIRED');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockPayrollInstallmentPeriodFirst(client, installmentId);
        const current = await client.query(
            `SELECT pi.*, pr.period_month, pr.staff_id, pr.status AS report_status, pr.settlement_model
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pi.id = $1
             FOR UPDATE OF pi, pr`,
            [installmentId]
        );
        if (!current.rowCount) {
            throw payrollWorkflowError('payroll installment not found', 404, 'PAYROLL_INSTALLMENT_NOT_FOUND');
        }
        const row = current.rows[0];
        if (row.settlement_model !== PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS || row.kind !== 'advance') {
            throw payrollWorkflowError(
                'only installment-workflow advance can be cancelled',
                409,
                'PAYROLL_ADVANCE_CANCEL_TARGET_INVALID'
            );
        }
        if (row.workflow_status !== 'draft') {
            throw payrollWorkflowError(
                'only a draft advance can be cancelled',
                409,
                'PAYROLL_ADVANCE_CANCEL_TRANSITION_INVALID',
                { installmentId, workflowStatus: row.workflow_status }
            );
        }
        await assertPayrollPeriodOpen(row.period_month, client);
        const finalResult = await client.query(
            `SELECT pi.*, pr.period_month, pr.staff_id
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pi.payroll_report_id = $1
               AND pi.kind = 'final'
             FOR UPDATE OF pi`,
            [row.payroll_report_id]
        );
        const finalRow = finalResult.rows[0] || null;
        if (!finalRow || finalRow.workflow_status !== 'draft') {
            throw payrollWorkflowError(
                'advance cancellation requires a draft final installment',
                409,
                'PAYROLL_ADVANCE_CANCEL_FINAL_IMMUTABLE',
                { finalWorkflowStatus: finalRow?.workflow_status || null }
            );
        }
        const cancelledAdvance = { ...row, workflow_status: 'cancelled' };
        const freshFinal = await calculateCurrentPayrollInstallment(finalRow, cancelledAdvance, client);
        const cancelledSnapshot = {
            ...parseConfig(row.calculation_snapshot),
            cancellation: {
                reason,
                actorUserId: actor.userId,
                actorUsername: actor.username,
                actorRole: actor.role,
                cancelledAt: new Date().toISOString()
            }
        };
        const cancelled = await client.query(
            `UPDATE payroll_installments
             SET workflow_status = 'cancelled',
                 calculation_snapshot = $1::jsonb,
                 updated_by = $2,
                 updated_at = NOW()
             WHERE id = $3
               AND workflow_status = 'draft'
             RETURNING *`,
            [JSON.stringify(cancelledSnapshot), actor.username, installmentId]
        );
        if (!cancelled.rowCount) {
            throw payrollWorkflowError('advance cancellation conflict', 409, 'PAYROLL_ADVANCE_CANCEL_CONFLICT');
        }
        const finalUpdated = await client.query(
            `UPDATE payroll_installments
             SET calculated_amount = $1,
                 calculation_snapshot = $2::jsonb,
                 updated_by = $3,
                 updated_at = NOW()
             WHERE id = $4
               AND workflow_status = 'draft'
             RETURNING *`,
            [
                roundMoney(freshFinal.installment.calculatedAmount ?? freshFinal.installment.amount),
                JSON.stringify(freshFinal.snapshot),
                actor.username,
                Number(finalRow.id)
            ]
        );
        if (!finalUpdated.rowCount) {
            throw payrollWorkflowError('final installment update conflict', 409, 'PAYROLL_ADVANCE_CANCEL_FINAL_CONFLICT');
        }
        await client.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ('payroll_advance_cancelled', $1, $2, $3::jsonb, NULL)`,
            [
                Number(row.staff_id),
                actor.username,
                JSON.stringify({
                    eventVersion: 1,
                    month: row.period_month,
                    reportId: Number(row.payroll_report_id),
                    installmentId,
                    finalInstallmentId: Number(finalRow.id),
                    reason,
                    actorUserId: actor.userId,
                    actorRole: actor.role
                })
            ]
        );
        await client.query('COMMIT');
        return {
            advance: mapPayrollInstallment(cancelled.rows[0]),
            final: mapPayrollInstallment(finalUpdated.rows[0])
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function getPayrollSettlement(month, db = pool) {
    return loadPayrollSettlementReadModels(month, db);
}

async function confirmPayrollInstallmentPayment(id, user, options = {}) {
    const installmentId = Number(id);
    if (!Number.isInteger(installmentId) || installmentId <= 0) {
        throw payrollWorkflowError('valid installment id is required', 400, 'PAYROLL_INSTALLMENT_ID_INVALID');
    }
    const actor = payrollWorkflowActor(user);
    assertPayrollActionPermission(user, 'confirm_payroll_payment', actor, 'PAYROLL_PAYMENT_PERMISSION_DENIED');
    const idempotencyKey = normalizePayrollIdempotencyKey(options.idempotencyKey || options.idempotency_key);
    const businessContext = normalizePayrollPaymentBusinessContext(options.businessContext || options.business_context);
    const actualPaymentDate = normalizePayrollWorkflowDate(
        options.actualPaymentDate || options.actual_payment_date || options.date
    );
    const paymentMethod = normalizePayrollPaymentMethod(options.paymentMethod || options.payment_method);
    const reason = normalizePayrollReason(options.reason, 'Payroll installment payment');
    const idempotencyRequest = {
        movementType: 'payment',
        targetId: installmentId,
        actualPaymentDate,
        businessContext,
        paymentMethod,
        reason
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const idempotent = await loadPayrollPaymentIdempotency(client, idempotencyKey);
        if (idempotent) {
            assertPayrollMovementIdempotentReplay(idempotent, idempotencyRequest, options);
            assertPayrollBusinessContextAccess(user, businessContext);
            await client.query('COMMIT');
            return payrollIdempotentMovementResult(idempotent);
        }
        assertPayrollBusinessContextAccess(user, businessContext);

        await lockPayrollInstallmentPeriodFirst(client, installmentId);
        const lockedIdempotent = await loadPayrollPaymentIdempotency(client, idempotencyKey);
        if (lockedIdempotent) {
            assertPayrollMovementIdempotentReplay(lockedIdempotent, idempotencyRequest, options);
            await client.query('COMMIT');
            return payrollIdempotentMovementResult(lockedIdempotent);
        }
        const row = await loadPayrollInstallmentForPayment(client, installmentId);
        await assertPayrollPeriodOpen(row.period_month, client);
        assertPayrollInstallmentPayable(row, businessContext);
        const readModel = mapPayrollInstallment(row);
        const balance = Number(readModel.outstandingAmount || 0);
        if (balance <= 0) {
            throw payrollWorkflowError('payroll installment has no outstanding balance', 409, 'PAYROLL_INSTALLMENT_BALANCE_EMPTY', {
                installmentId,
                settlementStatus: readModel.settlementStatus
            });
        }
        const amount = normalizePositiveMoneyAmount(options.amount, balance);
        if (amount > balance) {
            throw payrollWorkflowError('payroll payment exceeds installment balance', 409, 'PAYROLL_PAYMENT_EXCEEDS_BALANCE', {
                installmentId,
                amount,
                balance
            });
        }

        const category = await assertFinanceCategoryForPayroll(client, options.categoryId || options.category_id, businessContext, 'expense');
        const account = await assertFinanceAccountForPayroll(client, options.accountId || options.account_id, businessContext);
        const recognitionDate = payrollRecognitionDate(row);
        const description = options.description || movementDescription(row, 'payment');
        const finance = await client.query(
            `INSERT INTO finance_transactions
                (business_context, type, category_id, amount, description, date, payment_method,
                 staff_id, account_id, account_name, object_name, source, recognition_date, created_by)
             VALUES ($1, 'expense', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'payroll', $11, $12)
             RETURNING *`,
            [
                businessContext,
                Number(category.id),
                amount,
                description,
                actualPaymentDate,
                paymentMethod,
                Number(row.staff_id),
                Number(account.id),
                account.name,
                row.staff_name || null,
                recognitionDate,
                actor.username
            ]
        );

        const movement = await client.query(
            `INSERT INTO payroll_payment_movements
                (installment_id, movement_type, amount, actual_payment_date, actor_user_id,
                 actor_username, actor_role, reason, idempotency_key, finance_transaction_id)
             VALUES ($1, 'payment', $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
                installmentId,
                amount,
                actualPaymentDate,
                actor.userId,
                actor.username,
                actor.role,
                reason,
                idempotencyKey,
                Number(finance.rows[0].id)
            ]
        );
        await client.query('COMMIT');
        return {
            success: true,
            idempotent: false,
            movement: mapPayrollPaymentMovement(movement.rows[0]),
            financeTransaction: finance.rows[0]
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') {
            const existing = await loadPayrollPaymentIdempotency(pool, idempotencyKey).catch(() => null);
            if (existing) {
                assertPayrollMovementIdempotentReplay(existing, idempotencyRequest, options);
                return payrollIdempotentMovementResult(existing);
            }
        }
        throw err;
    } finally {
        client.release();
    }
}

async function reversePayrollPaymentMovement(id, user, options = {}) {
    const reversesMovementId = Number(id);
    if (!Number.isInteger(reversesMovementId) || reversesMovementId <= 0) {
        throw payrollWorkflowError('valid payment movement id is required', 400, 'PAYROLL_PAYMENT_MOVEMENT_ID_INVALID');
    }
    const actor = payrollWorkflowActor(user);
    assertPayrollActionPermission(user, 'reverse_payroll_payment', actor, 'PAYROLL_REVERSAL_PERMISSION_DENIED');
    const idempotencyKey = normalizePayrollIdempotencyKey(options.idempotencyKey || options.idempotency_key);
    const businessContext = normalizePayrollPaymentBusinessContext(options.businessContext || options.business_context);
    const actualPaymentDate = normalizePayrollWorkflowDate(
        options.actualPaymentDate || options.actual_payment_date || options.date
    );
    const paymentMethod = normalizePayrollPaymentMethod(options.paymentMethod || options.payment_method);
    const reason = normalizePayrollReason(options.reason, '', 'PAYROLL_REVERSAL_REASON_REQUIRED');
    const idempotencyRequest = {
        movementType: 'reversal',
        targetId: reversesMovementId,
        actualPaymentDate,
        businessContext,
        paymentMethod,
        reason
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const idempotent = await loadPayrollPaymentIdempotency(client, idempotencyKey);
        if (idempotent) {
            assertPayrollMovementIdempotentReplay(idempotent, idempotencyRequest, options);
            assertPayrollBusinessContextAccess(user, businessContext);
            await client.query('COMMIT');
            return payrollIdempotentMovementResult(idempotent);
        }
        assertPayrollBusinessContextAccess(user, businessContext);
        await lockPayrollMovementPeriodFirst(client, reversesMovementId);
        const lockedIdempotent = await loadPayrollPaymentIdempotency(client, idempotencyKey);
        if (lockedIdempotent) {
            assertPayrollMovementIdempotentReplay(lockedIdempotent, idempotencyRequest, options);
            await client.query('COMMIT');
            return payrollIdempotentMovementResult(lockedIdempotent);
        }
        const target = await client.query(
            `WITH target_reversals AS (
                SELECT reverses_movement_id,
                       COALESCE(SUM(amount), 0)::numeric AS reversed_amount
                FROM payroll_payment_movements
                WHERE movement_type = 'reversal'
                  AND reverses_movement_id = $1
                GROUP BY reverses_movement_id
             )
             SELECT ppm.*, pi.kind, pi.earning_from, pi.earning_to, pi.business_context,
                    pi.workflow_status, pi.locked_amount, pi.allocation_status,
                    pr.period_month, pr.staff_id, pr.settlement_model,
                    s.name AS staff_name,
                    COALESCE(tr.reversed_amount, 0)::numeric AS reversed_amount
             FROM payroll_payment_movements ppm
             JOIN payroll_installments pi ON pi.id = ppm.installment_id
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             LEFT JOIN staff s ON s.id = pr.staff_id
             LEFT JOIN target_reversals tr ON tr.reverses_movement_id = ppm.id
             WHERE ppm.id = $1
             FOR UPDATE OF ppm, pi, pr`,
            [reversesMovementId]
        );
        if (!target.rowCount) throw payrollWorkflowError('payroll payment movement not found', 404, 'PAYROLL_PAYMENT_MOVEMENT_NOT_FOUND');
        const row = target.rows[0];
        if (row.movement_type !== 'payment') {
            throw payrollWorkflowError('only payment movements can be reversed', 409, 'PAYROLL_REVERSAL_TARGET_INVALID');
        }
        assertPayrollInstallmentPayable(row, businessContext);
        const remaining = Math.max(0, Number(row.amount || 0) - Number(row.reversed_amount || 0));
        if (remaining <= 0) {
            throw payrollWorkflowError('payroll payment movement is already fully reversed', 409, 'PAYROLL_PAYMENT_ALREADY_REVERSED');
        }
        const amount = normalizePositiveMoneyAmount(options.amount, remaining, 'PAYROLL_REVERSAL_AMOUNT_INVALID');
        if (amount > remaining) {
            throw payrollWorkflowError('payroll reversal exceeds remaining payment amount', 409, 'PAYROLL_REVERSAL_EXCEEDS_PAYMENT', {
                reversesMovementId,
                amount,
                remaining
            });
        }
        const paymentDate = normalizeDateValue(row.actual_payment_date);
        if (actualPaymentDate < paymentDate) {
            throw payrollWorkflowError('payroll reversal date cannot precede payment date', 400, 'PAYROLL_REVERSAL_DATE_BEFORE_PAYMENT', {
                paymentDate,
                actualPaymentDate
            });
        }
        const periodLock = await loadPayrollPeriodLock(row.period_month, client);
        if (periodLock.is_locked) {
            await setPayrollPeriodLock(
                row.period_month,
                false,
                actor.username,
                `Automatically reopened for append-only payroll reversal ${reversesMovementId}`,
                client
            );
        }
        const category = await assertFinanceCategoryForPayroll(client, options.categoryId || options.category_id, businessContext, 'income');
        const account = await assertFinanceAccountForPayroll(client, options.accountId || options.account_id, businessContext);
        const recognitionDate = payrollRecognitionDate(row);
        const description = options.description || movementDescription(row, 'reversal');
        const finance = await client.query(
            `INSERT INTO finance_transactions
                (business_context, type, category_id, amount, description, date, payment_method,
                 staff_id, account_id, account_name, object_name, source, recognition_date, created_by)
             VALUES ($1, 'income', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'payroll', $11, $12)
             RETURNING *`,
            [
                businessContext,
                Number(category.id),
                amount,
                description,
                actualPaymentDate,
                paymentMethod,
                Number(row.staff_id),
                Number(account.id),
                account.name,
                row.staff_name || null,
                recognitionDate,
                actor.username
            ]
        );
        const movement = await client.query(
            `INSERT INTO payroll_payment_movements
                (installment_id, movement_type, amount, actual_payment_date, actor_user_id,
                 actor_username, actor_role, reason, idempotency_key, finance_transaction_id, reverses_movement_id)
             VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                Number(row.installment_id),
                amount,
                actualPaymentDate,
                actor.userId,
                actor.username,
                actor.role,
                reason,
                idempotencyKey,
                Number(finance.rows[0].id),
                reversesMovementId
            ]
        );
        await client.query('COMMIT');
        return {
            success: true,
            idempotent: false,
            movement: mapPayrollPaymentMovement(movement.rows[0]),
            financeTransaction: finance.rows[0]
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') {
            const existing = await loadPayrollPaymentIdempotency(pool, idempotencyKey).catch(() => null);
            if (existing) {
                assertPayrollMovementIdempotentReplay(existing, idempotencyRequest, options);
                return payrollIdempotentMovementResult(existing);
            }
        }
        throw err;
    } finally {
        client.release();
    }
}

async function updatePayrollInstallmentScheduledDate(id, user, options = {}) {
    const installmentId = Number(id);
    if (!Number.isInteger(installmentId) || installmentId <= 0) {
        throw payrollWorkflowError('valid installment id is required', 400, 'PAYROLL_INSTALLMENT_ID_INVALID');
    }
    const actor = payrollWorkflowActor(user);
    assertPayrollActionPermission(user, 'manage_payroll_accrual', actor, 'PAYROLL_SCHEDULE_PERMISSION_DENIED');
    const scheduledPaymentDate = normalizePayrollWorkflowDate(
        options.scheduledPaymentDate || options.scheduled_payment_date || options.date,
        'PAYROLL_SCHEDULE_DATE_INVALID'
    );
    const reason = normalizePayrollReason(options.reason, 'Manual payroll scheduled date change');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockPayrollInstallmentPeriodFirst(client, installmentId);
        const current = await client.query(
            `SELECT pi.*, pr.period_month, pr.staff_id, pr.settlement_model
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pi.id = $1
             FOR UPDATE OF pi, pr`,
            [installmentId]
        );
        if (!current.rowCount) throw payrollWorkflowError('payroll installment not found', 404, 'PAYROLL_INSTALLMENT_NOT_FOUND');
        const row = current.rows[0];
        await assertPayrollPeriodOpen(row.period_month, client);
        if (row.settlement_model !== PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS) {
            throw payrollWorkflowError('legacy payroll report has no installment schedule', 409, 'PAYROLL_LEGACY_SCHEDULE_BLOCKED');
        }
        if (row.workflow_status !== 'draft') {
            throw payrollWorkflowError('scheduled payment date can be changed only while installment is draft', 409, 'PAYROLL_SCHEDULE_IMMUTABLE', {
                installmentId,
                workflowStatus: row.workflow_status
            });
        }
        const previousDate = normalizeDateValue(row.scheduled_payment_date);
        const updated = await client.query(
            `UPDATE payroll_installments
             SET scheduled_payment_date = $1,
                 updated_by = $2,
                 updated_at = NOW()
             WHERE id = $3
               AND workflow_status = 'draft'
             RETURNING *`,
            [scheduledPaymentDate, actor.username, installmentId]
        );
        if (!updated.rowCount) {
            throw payrollWorkflowError('payroll scheduled date update conflict', 409, 'PAYROLL_SCHEDULE_UPDATE_CONFLICT');
        }
        await client.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ('payroll_installment_schedule_changed', $1, $2, $3::jsonb, NULL)`,
            [
                row.staff_id,
                actor.username,
                JSON.stringify({
                    eventVersion: 1,
                    payrollReportId: Number(row.payroll_report_id),
                    installmentId,
                    kind: row.kind,
                    month: row.period_month,
                    previousScheduledPaymentDate: previousDate,
                    scheduledPaymentDate,
                    actorUserId: actor.userId,
                    actorRole: actor.role,
                    reason
                })
            ]
        );
        await client.query('COMMIT');
        return mapPayrollInstallment(updated.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function payrollCommitBlockingIssues(value = {}) {
    const breakdown = value.breakdown_json !== undefined
        ? parseConfig(value.breakdown_json)
        : value;
    const direct = breakdown.payrollBlockingIssues || breakdown.payroll_blocking_issues;
    if (Array.isArray(direct)) return direct;
    const reconciliationIssues = breakdown.reconciliation?.blockingIssues
        || breakdown.reconciliation?.blocking_issues;
    return Array.isArray(reconciliationIssues) ? reconciliationIssues : [];
}

function payrollCommitBlockedError(blockingIssues = []) {
    const err = new Error('Payroll commit blocked: compensation snapshot requires correction');
    err.status = 409;
    err.statusCode = 409;
    err.code = 'PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED';
    err.details = { blockingIssues };
    return err;
}

function assertPayrollRowsCommitReady(rows = []) {
    const blockingIssues = [];
    for (const row of rows || []) {
        for (const issue of payrollCommitBlockingIssues(row)) {
            blockingIssues.push({
                staffId: row.staff_id ?? row.staffId ?? null,
                staffName: row.staff_name ?? row.name ?? null,
                ...issue
            });
        }
    }
    if (blockingIssues.length) throw payrollCommitBlockedError(blockingIssues);
    return true;
}

async function updatePayrollReportStatus(id, status, user) {
    const reportId = Number(id);
    if (!reportId || !REPORT_STATUSES.includes(status)) {
        const err = new Error('valid report id and status are required');
        err.status = 400;
        throw err;
    }
    if (!MANUAL_PAYROLL_REPORT_STATUSES.includes(status)) {
        throw payrollWorkflowError(
            'Payroll report paid status can only be derived from payment movements',
            409,
            'PAYROLL_REPORT_PAID_STATUS_MANUAL_BLOCKED',
            { status }
        );
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockPayrollReportPeriodFirst(client, reportId);
        const current = await client.query(
            'SELECT * FROM payroll_reports WHERE id = $1 FOR UPDATE',
            [reportId]
        );
        if (!current.rowCount) {
            const err = new Error('report not found');
            err.status = 404;
            throw err;
        }
        const currentReport = current.rows[0];
        await assertPayrollPeriodOpen(currentReport.period_month, client);
        if (currentReport.status === 'paid' && status !== 'paid') {
            throw payrollWorkflowError(
                'Paid payroll reports cannot be moved back through PATCH',
                409,
                'PAYROLL_REPORT_PAID_TRANSITION_BLOCKED',
                { reportId, currentStatus: currentReport.status, requestedStatus: status }
            );
        }
        if (currentReport.settlement_model === PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS) {
            throw payrollWorkflowError(
                'Installment payroll report status is derived from installment and movement transitions',
                409,
                'PAYROLL_REPORT_INSTALLMENT_STATUS_MANUAL_BLOCKED',
                { reportId, requestedStatus: status }
            );
        }
        if (status === 'approved') {
            assertPayrollRowsCommitReady(current.rows);
        }
        const result = await client.query(`
            UPDATE payroll_reports
            SET status = $1, updated_by = $2, updated_at = NOW()
            WHERE id = $3
            RETURNING *
        `, [status, user?.username || null, reportId]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    OVERTIME_MULTIPLIER,
    SCHEME_TYPES,
    REPORT_STATUSES,
    SIMULTANEOUS_ADDITIONAL_LINE_TYPE,
    PAYROLL_ROLE_HOURS_EXPLANATION,
    PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED,
    PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_MESSAGE,
    PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE,
    PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_MESSAGE,
    PAYROLL_ADJUSTMENTS_UNAVAILABLE,
    PAYROLL_ADJUSTMENTS_UNAVAILABLE_MESSAGE,
    PAYROLL_INSTALLMENT_KINDS,
    PAYROLL_KPI_BONUS_TYPE,
    PAYROLL_KPI_BONUS_RULE_VERSION,
    applyReportSnapshot,
    assertPayrollRowsCommitReady,
    assertPayrollRowsGenerationReady,
    assertPayrollBusinessContextAccess,
    assertPayrollInstallmentMonthWritable,
    approvePayrollInstallment,
    cancelPayrollAdvanceInstallment,
    buildPayrollKpiAuditSnapshot,
    buildPayrollTransparencyMetrics,
    calculateAdvanceInstallment,
    calculateFinalInstallment,
    calculateMonthlyPayroll,
    buildCanonicalPayrollInstallmentPreview,
    calculateProfessionPay,
    calculatePayroll,
    payrollAdjustmentsUnavailableError,
    calculatePayrollRangePreview,
    confirmPayrollInstallmentPayment,
    getPayrollSettlement,
    loadActivePayrollSchemeMap,
    fetchPayrollKpiAuditSnapshots,
    loadOffRosterDraftReportReconciliation,
    loadPayrollAttendanceMetrics,
    loadPayrollProfileContext,
    loadProfessionRateMap,
    resolveEffectivePayrollProfile,
    resolveProfessionPayRate,
    resolveSimultaneousAdditionalRate,
    normalizePayrollMonth,
    normalizePayrollAdjustmentType,
    normalizePayrollEntryLineType,
    employmentOverlapsPayrollRange,
    payrollInstallmentSchedule,
    payrollCalculationBlockers,
    payrollInstallmentSnapshot,
    payrollSchemeConfigHash,
    getSalaryReport,
    getPayrollRangePreview,
    getPayrollWorkspace,
    getPayrollPreview,
    createPayrollScheme,
    updatePayrollScheme,
    generatePayrollReports,
    reversePayrollPaymentMovement,
    updatePayrollInstallmentScheduledDate,
    updatePayrollReportStatus,
    calcPayrollPreview
};
