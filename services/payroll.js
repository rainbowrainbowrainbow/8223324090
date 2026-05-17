const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Payroll');

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

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
    return Math.round(toNumber(value, 0));
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
        hourlyRate: toNumber(row.hourly_rate)
    };
}

function fallbackSchemeForStaff(staff) {
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

    if (bonus) result.push(line('bonus', 'adjustment', 'Бонуси з HR', bonus, { source: 'salary_adjustments' }));
    if (tip) result.push(line('bonus', 'adjustment', 'Чайові з HR', tip, { source: 'salary_adjustments' }));
    if (deduction) result.push(line('deduction', 'adjustment', 'Утримання з HR', deduction, { source: 'salary_adjustments' }));
    if (penalty) result.push(line('deduction', 'adjustment', 'Депреміювання з HR', penalty, { source: 'salary_adjustments' }));
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
        .filter(item => ['base', 'bonus', 'percent', 'manual'].includes(item.group))
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const base = lines
        .filter(item => item.group === 'base')
        .reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
    const bonuses = lines
        .filter(item => item.group === 'bonus')
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
        bonuses: roundMoney(bonuses),
        percent: roundMoney(percent),
        manual: roundMoney(manual),
        gross: roundMoney(gross),
        deductions: roundMoney(deductions),
        advances: roundMoney(advances),
        net: roundMoney(gross - deductions - advances)
    };
}

function calculatePayroll(staff, scheme, metrics, adjustments = {}, entries = []) {
    const activeScheme = scheme || fallbackSchemeForStaff(staff);
    const lines = [
        ...buildSchemeLines(staff, activeScheme, metrics),
        ...buildAdjustmentLines(adjustments),
        ...buildEntryLines(entries)
    ].filter(item => item.amount !== 0 || ['base', 'manual'].includes(item.group));
    const summary = calcPayrollPreview(lines);
    return { scheme: activeScheme, lines, summary };
}

async function fetchStaffList() {
    const result = await pool.query(`
        SELECT id, name, department, position, role_type, hourly_rate
        FROM staff
        WHERE is_active = true
        ORDER BY name
    `);
    return result.rows.map(mapStaff);
}

async function fetchTimeMetrics(month) {
    const bounds = getMonthBounds(month);
    try {
        const result = await pool.query(`
            SELECT staff_id,
                   COALESCE(SUM(total_worked_minutes), 0)::int AS total_minutes,
                   COALESCE(SUM(overtime_minutes), 0)::int AS overtime_minutes,
                   COUNT(*) FILTER (
                       WHERE COALESCE(total_worked_minutes, 0) > 0
                          OR status IN ('present', 'late', 'early_leave', 'auto_closed')
                   )::int AS days_worked
            FROM hr_time_records
            WHERE record_date >= $1 AND record_date <= $2
            GROUP BY staff_id
        `, [bounds.from, bounds.to]);
        return new Map(result.rows.map(row => [row.staff_id, {
            totalMinutes: toNumber(row.total_minutes, 0),
            overtimeMinutes: toNumber(row.overtime_minutes, 0),
            hoursWorked: Math.round(toNumber(row.total_minutes, 0) / 60 * 10) / 10,
            overtimeHours: Math.round(toNumber(row.overtime_minutes, 0) / 60 * 10) / 10,
            daysWorked: toNumber(row.days_worked, 0)
        }]));
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
            if (!map.has(row.staff_id)) map.set(row.staff_id, { bonus: 0, tip: 0, deduction: 0, penalty: 0 });
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

async function fetchActiveSchemes(staffIds, month) {
    if (!staffIds.length) return new Map();
    const bounds = getMonthBounds(month);
    try {
        const result = await pool.query(`
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

function applyReportSnapshot(row, report) {
    if (!report || !['reviewed', 'approved', 'paid'].includes(report.status)) return row;
    const breakdown = parseConfig(report.breakdown_json);
    return {
        ...row,
        baseAmount: roundMoney(breakdown.summary?.base ?? row.baseAmount),
        bonusesAmount: roundMoney(breakdown.summary?.bonuses ?? row.bonusesAmount),
        percentAmount: roundMoney(breakdown.summary?.percent ?? row.percentAmount),
        deductionsAmount: roundMoney(report.deductions_amount),
        advancesAmount: roundMoney(report.advances_amount),
        grossAmount: roundMoney(report.gross_amount),
        netAmount: roundMoney(report.net_amount),
        estimatedSalary: roundMoney(report.net_amount),
        totalSalary: roundMoney(report.net_amount),
        lines: Array.isArray(breakdown.lines) ? breakdown.lines : row.lines
    };
}

async function buildPayrollContext(month) {
    const normalizedMonth = assertPayrollMonth(normalizePayrollMonth(month));
    const staff = await fetchStaffList();
    const staffIds = staff.map(item => item.id);
    const [timeMap, adjustmentMap, entryMap, schemeMap, reportMap, periodIncome, allSchemes] = await Promise.all([
        fetchTimeMetrics(normalizedMonth),
        fetchAdjustments(normalizedMonth),
        fetchPayrollEntries(normalizedMonth),
        fetchActiveSchemes(staffIds, normalizedMonth),
        fetchReportsByMonth(normalizedMonth),
        fetchPeriodIncome(normalizedMonth),
        fetchAllSchemes()
    ]);

    return { month: normalizedMonth, staff, timeMap, adjustmentMap, entryMap, schemeMap, reportMap, periodIncome, allSchemes };
}

function rowFromCalculation(staff, calculation, metrics, report) {
    const scheme = calculation.scheme;
    const summary = calculation.summary;
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
        totalMinutes: metrics.totalMinutes || 0,
        totalHours: metrics.hoursWorked || 0,
        hoursWorked: metrics.hoursWorked || 0,
        shifts: metrics.daysWorked || 0,
        daysWorked: metrics.daysWorked || 0,
        baseAmount: summary.base,
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
        const calculation = calculatePayroll(
            staff,
            scheme,
            metrics,
            context.adjustmentMap.get(staff.id),
            context.entryMap.get(staff.id) || []
        );
        return rowFromCalculation(staff, calculation, metrics, context.reportMap.get(staff.id));
    });

    const totals = staffRows.reduce((acc, row) => ({
        base: acc.base + row.baseAmount,
        bonuses: acc.bonuses + row.bonusesAmount,
        deductions: acc.deductions + row.deductionsAmount,
        advances: acc.advances + row.advancesAmount,
        gross: acc.gross + row.grossAmount,
        net: acc.net + row.netAmount
    }), { base: 0, bonuses: 0, deductions: 0, advances: 0, gross: 0, net: 0 });

    return {
        month: context.month,
        staff: staffRows.sort((a, b) => b.netAmount - a.netAmount || String(a.name || '').localeCompare(String(b.name || ''), 'uk')),
        totalSalary: roundMoney(totals.net),
        totals: {
            base: roundMoney(totals.base),
            bonuses: roundMoney(totals.bonuses),
            deductions: roundMoney(totals.deductions),
            advances: roundMoney(totals.advances),
            gross: roundMoney(totals.gross),
            net: roundMoney(totals.net)
        },
        schemeTypes: SCHEME_TYPES
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
    const calculation = calculatePayroll(
        staff,
        scheme,
        metrics,
        context.adjustmentMap.get(staff.id),
        context.entryMap.get(staff.id) || []
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

async function generatePayrollReports(month, user) {
    const report = await getSalaryReport(month);
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
                    totalMinutes: row.totalMinutes
                },
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

async function updatePayrollReportStatus(id, status, user) {
    const reportId = Number(id);
    if (!reportId || !REPORT_STATUSES.includes(status)) {
        const err = new Error('valid report id and status are required');
        err.status = 400;
        throw err;
    }
    const result = await pool.query(`
        UPDATE payroll_reports
        SET status = $1, updated_by = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *
    `, [status, user?.username || null, reportId]);
    if (!result.rowCount) {
        const err = new Error('report not found');
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

module.exports = {
    SCHEME_TYPES,
    REPORT_STATUSES,
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
