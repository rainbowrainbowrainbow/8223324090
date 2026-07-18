const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { attendanceFactMinutes, hydrateAttendanceRecords } = require('./hrAttendance');
const { buildPayrollRateUnitWarnings, buildPayrollSourceReconciliation } = require('./hrPayrollPeriod');
const { normalizeProfessionKey } = require('./professions');

const log = createLogger('Payroll');
const OVERTIME_MULTIPLIER = 1.5;
const WORKED_ATTENDANCE_STATUSES = new Set(['present', 'late', 'early_leave', 'auto_closed', 'unscheduled', 'clocked_in']);
const SIMULTANEOUS_ADDITIONAL_LINE_TYPE = 'simultaneous_additional';
const EXPLICIT_ADDITIONAL_RATE_SOURCES = new Set(['staff_profession_rates.hourly_rate']);
const SIMULTANEOUS_PROFESSION_PAY_EFFECTIVE_FROM = '2026-07-18';
const PAYROLL_ROLE_HOURS_EXPLANATION = 'Оплачувані години професій можуть перевищувати фізичні години через одночасну роботу';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED = 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_MESSAGE = 'Формула подвійної оплати для цієї схеми не налаштована';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE = 'PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_NON_POSITIVE';
const PAYROLL_SIMULTANEOUS_ADDITIONAL_AMOUNT_MESSAGE = 'Додаткова оплата не може бути нульовою для оплачуваних хвилин';

const SCHEME_TYPES = ['per_shift', 'hourly', 'monthly_fixed', 'percent', 'hybrid', 'manual'];
const REPORT_STATUSES = ['draft', 'reviewed', 'approved', 'paid'];
const PAYROLL_LINE_GROUPS = {
    base: 'base',
    bonus: 'bonus',
    percent: 'percent',
    manual: 'manual',
    deduction: 'deduction',
    advance: 'advance',
    adjustment: 'bonus'
};

function normalizePayrollMonth(month) {
    const value = String(month || '').trim();
    if (/^\d{4}-\d{2}$/.test(value)) return value;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function assertPayrollMonth(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        const err = new Error('month (YYYY-MM) required');
        err.status = 400;
        throw err;
    }
    return month;
}

function getMonthBounds(month) {
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    return {
        from: `${year}-${String(mon).padStart(2, '0')}-01`,
        to: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
}

function isMissingTableError(err) {
    return err && err.code === '42P01';
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

function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
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
    return {
        id: row.id,
        staffId: row.staff_id,
        schemeType: row.scheme_type,
        title: row.title || '',
        isActive: row.is_active === true,
        config: parseConfig(row.config_json),
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
        rateUnit: normalizeStaffRateUnit(row.rate_unit)
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
        manual: 'Ручна'
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

function buildBaseLines(base, staff, metrics, labelPrefix = 'База') {
    const cfg = parseConfig(base);
    const kind = cfg.kind || cfg.type || 'hourly';

    if (kind === 'per_shift') {
        const rate = toNumber(cfg.rate ?? cfg.perShiftRate ?? cfg.amount, 0);
        const quantity = pickQuantity(metrics.daysWorked, cfg.quantity ?? cfg.shifts ?? cfg.shiftCount);
        return [line('base', 'base', `${labelPrefix}: сума за вихід`, rate * quantity, { quantity, rate, source: 'scheme' })];
    }

    if (kind === 'monthly_fixed') {
        const amount = toNumber(cfg.amount ?? cfg.fixedAmount ?? cfg.monthlyAmount, 0);
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
    const config = parseConfig(scheme?.config);
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
        const amount = toNumber(config.monthlyAmount ?? config.fixedAmount ?? config.amount, 0);
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
    const advances = normalizeRuleArray(config, 'advances', 'advanceAmount', 'Аванс');
    const percentRules = Array.isArray(config.percentRules) ? config.percentRules : [];

    lines.push(...buildAmountRuleLines(bonusRules, 'bonus', 'bonus', 'Бонус', metrics));
    lines.push(...buildAmountRuleLines(percentRules, 'percent', 'percent', 'Відсоток', metrics));
    lines.push(...buildAmountRuleLines(deductions, 'deduction', 'deduction', 'Утримання', metrics));
    lines.push(...buildAmountRuleLines(advances, 'advance', 'advance', 'Аванс', metrics));
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
    if (advance) result.push(line('advance', 'adjustment', 'ЗРС з HR', advance, { source: 'salary_adjustments' }));
    return result;
}

function buildEntryLines(entries) {
    return entries.map(entry => {
        const group = PAYROLL_LINE_GROUPS[entry.line_type] || 'bonus';
        return line(group, entry.line_type, entry.label || entry.line_type, entry.amount, {
            quantity: entry.quantity,
            rate: entry.rate,
            source: 'payroll_entries',
            meta: parseConfig(entry.meta_json)
        });
    }).filter(item => item.amount !== 0);
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
    const advances = lines
        .filter(item => item.group === 'advance')
        .reduce((sum, item) => sum + Math.abs(toNumber(item.amount, 0)), 0);

    return {
        base: roundMoney(base),
        additional: roundMoney(additional),
        overtime: roundMoney(overtime),
        bonuses: roundMoney(bonuses),
        percent: roundMoney(percent),
        manual: roundMoney(manual),
        gross: roundMoney(gross),
        deductions: roundMoney(deductions),
        advances: roundMoney(advances),
        net: roundMoney(gross - deductions - advances)
    };
}

function calculatePayroll(staff, scheme, metrics, adjustments = {}, entries = [], professionPay = null) {
    const activeScheme = scheme || fallbackSchemeForStaff(staff);
    const baseLines = professionPay?.applies
        ? [
            ...professionPay.baseLines,
            ...(professionPay.additionalLines || []),
            ...professionPay.overtimeLines
        ]
        : buildSchemeLines(staff, activeScheme, metrics);
    const lines = [
        ...baseLines,
        ...buildAdjustmentLines(adjustments),
        ...buildEntryLines(entries)
    ].filter(item => item.amount !== 0 || ['base', 'manual'].includes(item.group));
    const summary = calcPayrollPreview(lines);
    return { scheme: activeScheme, lines, summary, professionPay };
}

async function fetchStaffList(month) {
    const bounds = getMonthBounds(month);
    const readStaff = async (withStatusFilter = true) => {
        const statusFilter = withStatusFilter ? "AND COALESCE(sa.status, 'applied') = 'applied'" : '';
        return pool.query(`
            SELECT DISTINCT s.id, s.name, s.department, s.position, s.role_type, s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit
            FROM staff s
            WHERE (s.is_freelance = false OR s.is_freelance IS NULL)
              AND (
                  s.is_active = true
                  OR EXISTS (
                      SELECT 1
                      FROM hr_time_records tr
                      WHERE tr.staff_id = s.id
                        AND tr.record_date >= $2 AND tr.record_date <= $3
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM hr_shifts hs
                      WHERE hs.staff_id = s.id
                        AND hs.shift_date >= $2 AND hs.shift_date <= $3
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM salary_adjustments sa
                      WHERE sa.staff_id = s.id
                        AND sa.month = $1
                        ${statusFilter}
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM payroll_reports pr
                      WHERE pr.staff_id = s.id
                        AND pr.period_month = $1
                        AND pr.voided_at IS NULL
                        AND pr.status <> 'draft'
                  )
              )
            ORDER BY s.name
        `, [month, bounds.from, bounds.to]);
    };

    try {
        let result;
        try {
            result = await readStaff(true);
        } catch (err) {
            if (err.code !== '42703') throw err;
            result = await readStaff(false);
        }
        return result.rows.map(mapStaff);
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('payroll staff query failed:', err.message);
        const fallback = await pool.query(`
            SELECT id, name, department, position, role_type, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit
            FROM staff
            WHERE is_active = true
            ORDER BY name
        `);
        return fallback.rows.map(mapStaff);
    }
}

function payrollMetricBucket(staffId) {
    return {
        staffId: Number(staffId),
        physicalMinutes: 0,
        totalMinutes: 0,
        allocatedMinutes: 0,
        plannedMinutes: 0,
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
        allocationIssues: [],
        payrollBlockingIssues: [],
        reconciliation: { days: [], warnings: [] }
    };
}

function payrollIssue(code, message, details = {}, severity = 'warning') {
    return { code, message, severity, ...details };
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
        const worked = actualMinutes > 0 || WORKED_ATTENDANCE_STATUSES.has(status);
        if (worked && date) workedDates.get(staffId).add(date);

        bucket.physicalMinutes += actualMinutes;
        bucket.totalMinutes += actualMinutes;
        bucket.allocatedMinutes += allocatedMinutes;
        bucket.overtimeMinutes += overtimeMinutes;
        bucket.plannedMinutes += plannedMinutes;

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
        const [assignmentResult, defaultResult] = await Promise.all([
            db.query(
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
            ),
            db.query(
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
            )
        ]);

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
        const amount = roundMoney(monthlyResolution.rate);
        const formula = payrollFormula('month', 1, monthlyResolution.rate);
        baseLines.push(line('base', 'profession_month', 'Monthly profile salary', amount, {
            quantity: 1,
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
        const amount = roundMoney(resolved.rate);
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

async function fetchTimeMetrics(month) {
    const bounds = getMonthBounds(month);
    try {
        return await loadPayrollAttendanceMetrics(bounds);
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('time metrics query failed:', err.message);
        return new Map();
    }
}

async function fetchAdjustments(month) {
    const readAdjustments = async (withStatusFilter) => {
        const statusFilter = withStatusFilter ? "AND COALESCE(status, 'applied') = 'applied'" : '';
        return pool.query(`
            SELECT staff_id, type, COALESCE(SUM(amount), 0)::numeric AS total
            FROM salary_adjustments
            WHERE month = $1 ${statusFilter}
            GROUP BY staff_id, type
        `, [month]);
    };

    try {
        let result;
        try {
            result = await readAdjustments(true);
        } catch (err) {
            if (err.code !== '42703') throw err;
            result = await readAdjustments(false);
        }
        const map = new Map();
        for (const row of result.rows) {
            if (!map.has(row.staff_id)) map.set(row.staff_id, { bonus: 0, tip: 0, deduction: 0, penalty: 0, advance: 0 });
            map.get(row.staff_id)[row.type] = toNumber(row.total, 0);
        }
        return map;
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('salary_adjustments query failed:', err.message);
        return new Map();
    }
}

async function fetchPayrollEntries(month) {
    try {
        const result = await pool.query(`
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

async function fetchPeriodIncome(month) {
    const bounds = getMonthBounds(month);
    try {
        const result = await pool.query(`
            SELECT COALESCE(SUM(amount), 0)::numeric AS total
            FROM finance_transactions
            WHERE type = 'income' AND date >= $1 AND date <= $2
        `, [bounds.from, bounds.to]);
        return toNumber(result.rows[0]?.total, 0);
    } catch (err) {
        log.warn('finance income metric query failed:', err.message);
        return 0;
    }
}

async function loadActivePayrollSchemeMap(staffIds, month, db = pool) {
    if (!staffIds.length) return new Map();
    const bounds = getMonthBounds(month);
    try {
        const result = await db.query(`
            SELECT DISTINCT ON (staff_id) *
            FROM payroll_schemes
            WHERE staff_id = ANY($1::int[])
              AND is_active = true
              AND (effective_from IS NULL OR effective_from <= $3::date)
              AND (effective_to IS NULL OR effective_to >= $2::date)
            ORDER BY staff_id, effective_from DESC NULLS LAST, updated_at DESC, id DESC
        `, [staffIds, bounds.from, bounds.to]);
        return new Map(result.rows.map(row => [row.staff_id, mapScheme(row)]));
    } catch (err) {
        if (!isMissingTableError(err)) log.warn('payroll_schemes query failed:', err.message);
        return new Map();
    }
}

async function fetchAllSchemes(staffId = null) {
    try {
        const params = [];
        let where = '';
        if (staffId) {
            params.push(staffId);
            where = 'WHERE staff_id = $1';
        }
        const result = await pool.query(`
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

async function fetchReportsByMonth(month) {
    try {
        const result = await pool.query(`
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
        additional_roles: transparency.additionalRoles
    };
}

async function buildPayrollContext(month) {
    const normalizedMonth = assertPayrollMonth(normalizePayrollMonth(month));
    const staff = await fetchStaffList(normalizedMonth);
    const staffIds = staff.map(item => item.id);
    const [timeMap, adjustmentMap, entryMap, schemeMap, reportMap, periodIncome, allSchemes, professionRateMap, payrollProfileContext] = await Promise.all([
        fetchTimeMetrics(normalizedMonth),
        fetchAdjustments(normalizedMonth),
        fetchPayrollEntries(normalizedMonth),
        loadActivePayrollSchemeMap(staffIds, normalizedMonth),
        fetchReportsByMonth(normalizedMonth),
        fetchPeriodIncome(normalizedMonth),
        fetchAllSchemes(),
        loadProfessionRateMap(staffIds),
        loadPayrollProfileContext(staffIds, normalizedMonth)
    ]);

    return { month: normalizedMonth, staff, timeMap, adjustmentMap, entryMap, schemeMap, reportMap, periodIncome, allSchemes, professionRateMap, payrollProfileContext };
}

function rowFromCalculation(staff, calculation, metrics, report) {
    const scheme = calculation.scheme;
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
        schemeId: scheme.id,
        schemeType: scheme.schemeType,
        schemeTypeLabel: schemeTypeLabel(scheme.schemeType),
        schemeTitle: scheme.title || schemeTypeLabel(scheme.schemeType),
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
        allocatedMinutes: metrics.allocatedMinutes || 0,
        overtimeMinutes: metrics.overtimeMinutes || 0,
        baseAmount: summary.base,
        additionalAmount: summary.additional || 0,
        overtimeAmount: summary.overtime || 0,
        bonusesAmount: summary.bonuses + summary.percent + summary.manual,
        percentAmount: summary.percent,
        deductionsAmount: summary.deductions,
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
        payrollBlockingIssues: calculation.professionPay?.blockingIssues || [],
        payroll_blocking_issues: calculation.professionPay?.blockingIssues || [],
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

async function getSalaryReport(month) {
    const context = await buildPayrollContext(month);
    const staffRows = context.staff.map(staff => {
        const metrics = {
            ...(context.timeMap.get(staff.id) || { totalMinutes: 0, overtimeMinutes: 0, hoursWorked: 0, overtimeHours: 0, daysWorked: 0 }),
            periodIncome: context.periodIncome
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
        return rowFromCalculation(staff, calculation, metrics, context.reportMap.get(staff.id));
    });

    const totals = staffRows.reduce((acc, row) => ({
        base: acc.base + row.baseAmount,
        additional: acc.additional + row.additionalAmount,
        bonuses: acc.bonuses + row.bonusesAmount,
        deductions: acc.deductions + row.deductionsAmount,
        advances: acc.advances + row.advancesAmount,
        gross: acc.gross + row.grossAmount,
        net: acc.net + row.netAmount
    }), { base: 0, additional: 0, bonuses: 0, deductions: 0, advances: 0, gross: 0, net: 0 });
    const offRosterDraftReports = await loadOffRosterDraftReportReconciliation(
        context.month,
        staffRows.map(row => row.staffId)
    );

    return {
        month: context.month,
        staff: staffRows.sort((a, b) => b.netAmount - a.netAmount || String(a.name || '').localeCompare(String(b.name || ''), 'uk')),
        totalSalary: roundMoney(totals.net),
        totals: {
            base: roundMoney(totals.base),
            additional: roundMoney(totals.additional),
            bonuses: roundMoney(totals.bonuses),
            deductions: roundMoney(totals.deductions),
            advances: roundMoney(totals.advances),
            gross: roundMoney(totals.gross),
            net: roundMoney(totals.net)
        },
        schemeTypes: SCHEME_TYPES,
        reconciliation: {
            offRosterDraftReports
        }
    };
}

async function getPayrollWorkspace(month) {
    const report = await getSalaryReport(month);
    const schemes = await fetchAllSchemes();
    return { ...report, schemes };
}

async function getPayrollPreview(staffId, month) {
    const context = await buildPayrollContext(month);
    const staff = context.staff.find(item => item.id === Number(staffId));
    if (!staff) {
        const err = new Error('staff not found');
        err.status = 404;
        throw err;
    }
    const metrics = {
        ...(context.timeMap.get(staff.id) || { totalMinutes: 0, overtimeMinutes: 0, hoursWorked: 0, overtimeHours: 0, daysWorked: 0 }),
        periodIncome: context.periodIncome
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
    return rowFromCalculation(staff, calculation, metrics, context.reportMap.get(staff.id));
}

async function createPayrollScheme(payload, user) {
    const staffId = Number(payload.staffId || payload.staff_id);
    const schemeType = String(payload.schemeType || payload.scheme_type || '').trim();
    if (!staffId || !SCHEME_TYPES.includes(schemeType)) {
        const err = new Error('staffId and valid schemeType are required');
        err.status = 400;
        throw err;
    }

    const staffCheck = await pool.query('SELECT id FROM staff WHERE id = $1', [staffId]);
    if (!staffCheck.rowCount) {
        const err = new Error('staff not found');
        err.status = 404;
        throw err;
    }

    const isActive = payload.isActive !== false && payload.is_active !== false;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (isActive) {
            await client.query(
                'UPDATE payroll_schemes SET is_active = false, updated_at = NOW(), updated_by = $2 WHERE staff_id = $1 AND is_active = true',
                [staffId, user?.username || null]
            );
        }
        const result = await client.query(`
            INSERT INTO payroll_schemes
                (staff_id, scheme_type, title, is_active, config_json, effective_from, effective_to, created_by, updated_by)
            VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8)
            RETURNING *
        `, [
            staffId,
            schemeType,
            payload.title ? String(payload.title).trim().slice(0, 160) : schemeTypeLabel(schemeType),
            isActive,
            JSON.stringify(parseConfig(payload.config || payload.config_json)),
            payload.effectiveFrom || payload.effective_from || null,
            payload.effectiveTo || payload.effective_to || null,
            user?.username || null
        ]);
        await client.query('COMMIT');
        return mapScheme(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function updatePayrollScheme(id, payload, user) {
    const schemeId = Number(id);
    if (!schemeId) {
        const err = new Error('invalid scheme id');
        err.status = 400;
        throw err;
    }

    const existing = await pool.query('SELECT * FROM payroll_schemes WHERE id = $1', [schemeId]);
    if (!existing.rowCount) {
        const err = new Error('scheme not found');
        err.status = 404;
        throw err;
    }

    const current = existing.rows[0];
    const nextType = payload.schemeType || payload.scheme_type || current.scheme_type;
    if (!SCHEME_TYPES.includes(nextType)) {
        const err = new Error('invalid schemeType');
        err.status = 400;
        throw err;
    }

    const nextActive = payload.isActive !== undefined ? payload.isActive === true : (
        payload.is_active !== undefined ? payload.is_active === true : current.is_active
    );

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (nextActive) {
            await client.query(
                'UPDATE payroll_schemes SET is_active = false, updated_at = NOW(), updated_by = $2 WHERE staff_id = $1 AND id <> $3 AND is_active = true',
                [current.staff_id, user?.username || null, schemeId]
            );
        }
        const result = await client.query(`
            UPDATE payroll_schemes SET
                scheme_type = $1,
                title = $2,
                is_active = $3,
                config_json = $4::jsonb,
                effective_from = $5,
                effective_to = $6,
                updated_by = $7,
                updated_at = NOW()
            WHERE id = $8
            RETURNING *
        `, [
            nextType,
            payload.title !== undefined ? String(payload.title || '').trim().slice(0, 160) : current.title,
            nextActive,
            JSON.stringify(payload.config !== undefined || payload.config_json !== undefined
                ? parseConfig(payload.config || payload.config_json)
                : parseConfig(current.config_json)),
            payload.effectiveFrom !== undefined ? (payload.effectiveFrom || null) : current.effective_from,
            payload.effectiveTo !== undefined ? (payload.effectiveTo || null) : current.effective_to,
            user?.username || null,
            schemeId
        ]);
        await client.query('COMMIT');
        return mapScheme(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
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

async function generatePayrollReports(month, user) {
    const report = await getSalaryReport(month);
    try {
        assertPayrollRowsGenerationReady(report.staff);
    } catch (error) {
        await auditBlockedPayrollGeneration(report.month, error, user)
            .catch(auditError => log.error('blocked payroll generation audit failed', auditError));
        throw error;
    }
    const client = await pool.connect();
    const generated = [];
    const skipped = [];

    try {
        await client.query('BEGIN');
        for (const row of report.staff) {
            const existing = await client.query(
                'SELECT * FROM payroll_reports WHERE period_month = $1 AND staff_id = $2',
                [report.month, row.staffId]
            );
            if (existing.rowCount && ['approved', 'paid'].includes(existing.rows[0].status)) {
                skipped.push({ staffId: row.staffId, status: existing.rows[0].status });
                continue;
            }

            const breakdown = {
                scheme: {
                    id: row.schemeId,
                    type: row.schemeType,
                    title: row.schemeTitle
                },
                metrics: {
                    hoursWorked: row.hoursWorked,
                    daysWorked: row.daysWorked,
                    totalMinutes: row.totalMinutes,
                    physicalMinutes: row.physicalMinutes,
                    allocatedMinutes: row.allocatedMinutes,
                    overtimeMinutes: row.overtimeMinutes,
                    plannedMinutes: row.plannedMinutes,
                    compensationMinutes: row.compensationMinutes,
                    roleMinutes: row.roleMinutes,
                    baseProfessionAllocations: row.baseProfessionAllocations,
                    additionalProfessionAllocations: row.additionalProfessionAllocations
                },
                professionRateSummary: row.professionRateSummary,
                reconciliation: row.reconciliation,
                allocationIssues: row.allocationIssues,
                payrollBlockingIssues: row.payrollBlockingIssues,
                transparency: row.payrollTransparency,
                lines: row.lines,
                summary: row.summary
            };

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
                        breakdown_json = $6::jsonb,
                        generated_at = NOW(),
                        updated_by = $7,
                        updated_at = NOW()
                    WHERE id = $8
                    RETURNING *
                `, [row.schemeId, row.grossAmount, row.deductionsAmount, row.advancesAmount, row.netAmount,
                    JSON.stringify(breakdown), user?.username || null, existing.rows[0].id]);
            } else {
                result = await client.query(`
                    INSERT INTO payroll_reports
                        (period_month, staff_id, scheme_id, gross_amount, deductions_amount, advances_amount,
                         net_amount, status, breakdown_json, generated_at, created_by, updated_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8::jsonb,NOW(),$9,$9)
                    RETURNING *
                `, [report.month, row.staffId, row.schemeId, row.grossAmount, row.deductionsAmount,
                    row.advancesAmount, row.netAmount, JSON.stringify(breakdown), user?.username || null]);
            }
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(
            'SELECT * FROM payroll_reports WHERE id = $1 FOR UPDATE',
            [reportId]
        );
        if (!current.rowCount) {
            const err = new Error('report not found');
            err.status = 404;
            throw err;
        }
        if (['approved', 'paid'].includes(status)) {
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
    assertPayrollRowsCommitReady,
    assertPayrollRowsGenerationReady,
    buildPayrollTransparencyMetrics,
    calculateProfessionPay,
    calculatePayroll,
    loadActivePayrollSchemeMap,
    loadOffRosterDraftReportReconciliation,
    loadPayrollAttendanceMetrics,
    loadPayrollProfileContext,
    loadProfessionRateMap,
    resolveEffectivePayrollProfile,
    resolveProfessionPayRate,
    resolveSimultaneousAdditionalRate,
    normalizePayrollMonth,
    getSalaryReport,
    getPayrollWorkspace,
    getPayrollPreview,
    createPayrollScheme,
    updatePayrollScheme,
    generatePayrollReports,
    updatePayrollReportStatus,
    calcPayrollPreview
};
