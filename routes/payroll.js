/**
 * routes/payroll.js — Salary schemes, payroll preview, and monthly snapshots.
 */

const router = require('express').Router();
const ExcelJS = require('exceljs');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const {
    SCHEME_TYPES,
    REPORT_STATUSES,
    getSalaryReport,
    getPayrollWorkspace,
    getPayrollPreview,
    createPayrollScheme,
    updatePayrollScheme,
    generatePayrollReports,
    updatePayrollReportStatus,
    normalizePayrollMonth
} = require('../services/payroll');

const log = createLogger('PayrollRoutes');

router.use(requireRole('creator', 'director', 'accountant'));

function sendError(res, err, fallback = 'Internal server error') {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error(err.message || fallback, err);
    res.status(status).json({
        success: false,
        code: err.code || null,
        error: err.message || fallback,
        details: err.details || null
    });
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function payrollAdditionalRoles(row = {}) {
    const transparency = row.payrollTransparency || row.payroll_transparency || {};
    return Array.isArray(transparency.additionalRoles)
        ? transparency.additionalRoles
        : (Array.isArray(row.additionalRoles) ? row.additionalRoles : []);
}

function payrollExportFields(row = {}) {
    const transparency = row.payrollTransparency || row.payroll_transparency || {};
    const roles = payrollAdditionalRoles(row);
    const joined = field => roles
        .map(role => role?.[field])
        .filter(value => value !== null && value !== undefined && value !== '')
        .join('|');
    return {
        physical_hours: Number(transparency.physicalHours ?? row.physicalHours ?? row.hoursWorked ?? 0),
        base_role_hours: Number(transparency.baseRoleHours ?? row.baseRoleHours ?? row.hoursWorked ?? 0),
        additional_role_hours: Number(transparency.additionalRoleHours ?? row.additionalRoleHours ?? 0),
        additional_profession: joined('professionKey'),
        additional_rate: joined('rate'),
        additional_multiplier: joined('multiplier'),
        additional_amount: Number(transparency.additionalAmount ?? row.additionalAmount ?? 0)
    };
}

router.get('/schemes', async (req, res) => {
    try {
        const month = normalizePayrollMonth(req.query.month);
        const data = await getPayrollWorkspace(month);
        res.json({
            success: true,
            month: data.month,
            schemeTypes: SCHEME_TYPES,
            reportStatuses: REPORT_STATUSES,
            staff: data.staff,
            schemes: data.schemes,
            totals: data.totals
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/schemes', async (req, res) => {
    try {
        const scheme = await createPayrollScheme(req.body || {}, req.user);
        res.status(201).json({ success: true, scheme });
    } catch (err) {
        sendError(res, err);
    }
});

router.patch('/schemes/:id', async (req, res) => {
    try {
        const scheme = await updatePayrollScheme(req.params.id, req.body || {}, req.user);
        res.json({ success: true, scheme });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/preview', async (req, res) => {
    try {
        const staffId = Number(req.query.staffId || req.query.staff_id);
        const month = String(req.query.month || '').trim();
        if (!staffId || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'staffId and month (YYYY-MM) required' });
        }
        const preview = await getPayrollPreview(staffId, month);
        res.json({ success: true, month, preview });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/export', async (req, res) => {
    try {
        const month = String(req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const report = await getSalaryReport(month);
        const header = [
            'Staff ID', 'Працівник', 'Днів відпрацьовано', 'Фактичні години',
            'База', 'Overtime', 'Нараховано', 'Утримання', 'Аванси', 'До виплати',
            'Розподіл за професіями', 'Payroll source refs',
            'physical_hours', 'base_role_hours', 'additional_role_hours',
            'additional_profession', 'additional_rate', 'additional_multiplier', 'additional_amount'
        ];
        const rows = report.staff.map(row => {
            const exportFields = payrollExportFields(row);
            const professionBreakdown = (row.professionRateSummary || []).map(item => [
                item.profession_key || '',
                item.kind || 'base',
                item.work_date || '',
                `${item.actual_hours || 0}h`,
                `${item.rate || 0}/${item.rate_unit || 'hour'}`,
                item.rate_source || 'unresolved',
                item.profile_title || '',
                item.profile_version_id || '',
                item.applied_rule || '',
                item.formula || '',
                item.amount || 0,
                item.allocation_source || 'none'
            ].join('|')).join(' / ');
            const refs = (row.reconciliation?.days || []).map(day => [
                day.date,
                `shift:${day.planned_shift_ref ?? ''}`,
                `segments:${(day.segment_refs || []).join(',')}`,
                `attendance:${day.attendance_ref ?? ''}`,
                `planned:${day.planned_hours || 0}h`
            ].join('|')).join(' / ');
            return [
                row.staffId,
                row.name,
                row.daysWorked,
                row.hoursWorked,
                row.baseAmount,
                row.overtimeAmount || 0,
                row.grossAmount,
                row.deductionsAmount,
                row.advancesAmount,
                row.netAmount,
                professionBreakdown,
                refs,
                exportFields.physical_hours,
                exportFields.base_role_hours,
                exportFields.additional_role_hours,
                exportFields.additional_profession,
                exportFields.additional_rate,
                exportFields.additional_multiplier,
                exportFields.additional_amount
            ].map(csvCell).join(';');
        });
        const csv = '\uFEFF' + [header.map(csvCell).join(';'), ...rows].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="payroll_${month}.csv"`);
        res.send(csv);
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/export-xlsx', async (req, res) => {
    try {
        const month = String(req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const report = await getSalaryReport(month);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Event Genix CRM';
        workbook.created = new Date();
        const summary = workbook.addWorksheet('Payroll');
        summary.columns = [
            { header: 'Staff ID', key: 'staff_id', width: 12 },
            { header: 'Працівник', key: 'staff_name', width: 28 },
            { header: 'Днів відпрацьовано', key: 'days_worked', width: 18 },
            { header: 'Фактичні години', key: 'hours_worked', width: 18 },
            { header: 'База', key: 'base_amount', width: 14 },
            { header: 'Overtime', key: 'overtime_amount', width: 14 },
            { header: 'Нараховано', key: 'gross_amount', width: 14 },
            { header: 'Утримання', key: 'deductions_amount', width: 14 },
            { header: 'Аванси', key: 'advances_amount', width: 14 },
            { header: 'До виплати', key: 'net_amount', width: 14 },
            { header: 'physical_hours', key: 'physical_hours', width: 16 },
            { header: 'base_role_hours', key: 'base_role_hours', width: 18 },
            { header: 'additional_role_hours', key: 'additional_role_hours', width: 22 },
            { header: 'additional_profession', key: 'additional_profession', width: 24 },
            { header: 'additional_rate', key: 'additional_rate', width: 18 },
            { header: 'additional_multiplier', key: 'additional_multiplier', width: 22 },
            { header: 'additional_amount', key: 'additional_amount', width: 20 }
        ];
        for (const row of report.staff) {
            const exportFields = payrollExportFields(row);
            summary.addRow({
                staff_id: row.staffId,
                staff_name: row.name,
                days_worked: row.daysWorked,
                hours_worked: row.hoursWorked,
                base_amount: row.baseAmount,
                overtime_amount: row.overtimeAmount || 0,
                gross_amount: row.grossAmount,
                deductions_amount: row.deductionsAmount,
                advances_amount: row.advancesAmount,
                net_amount: row.netAmount,
                ...exportFields
            });
        }
        summary.views = [{ state: 'frozen', ySplit: 1 }];
        summary.autoFilter = { from: 'A1', to: 'Q1' };
        summary.getRow(1).font = { bold: true };

        const additionalLines = workbook.addWorksheet('Additional lines');
        additionalLines.columns = [
            { header: 'staff_id', key: 'staff_id', width: 12 },
            { header: 'staff_name', key: 'staff_name', width: 28 },
            { header: 'work_date', key: 'work_date', width: 14 },
            { header: 'attendance_ref', key: 'attendance_ref', width: 16 },
            { header: 'segment_ref', key: 'segment_ref', width: 14 },
            { header: 'role_ref', key: 'role_ref', width: 12 },
            { header: 'additional_profession', key: 'profession', width: 24 },
            { header: 'minutes', key: 'minutes', width: 12 },
            { header: 'additional_role_hours', key: 'hours', width: 22 },
            { header: 'additional_rate', key: 'rate', width: 18 },
            { header: 'rate_source', key: 'rate_source', width: 34 },
            { header: 'additional_multiplier', key: 'multiplier', width: 22 },
            { header: 'additional_amount', key: 'amount', width: 20 },
            { header: 'policy_version', key: 'policy_version', width: 30 },
            { header: 'formula', key: 'formula', width: 34 }
        ];
        for (const row of report.staff) {
            for (const role of payrollAdditionalRoles(row)) {
                additionalLines.addRow({
                    staff_id: row.staffId,
                    staff_name: row.name,
                    work_date: role.workDate || null,
                    attendance_ref: role.attendanceRef ?? null,
                    segment_ref: role.segmentRef ?? null,
                    role_ref: role.roleRef ?? null,
                    profession: role.professionKey || null,
                    minutes: role.minutes || 0,
                    hours: role.hours || 0,
                    rate: role.rate ?? null,
                    rate_source: role.rateSource || null,
                    multiplier: role.multiplier ?? null,
                    amount: role.amount ?? null,
                    policy_version: role.policyVersion || null,
                    formula: role.formula || null
                });
            }
        }
        additionalLines.views = [{ state: 'frozen', ySplit: 1 }];
        additionalLines.autoFilter = { from: 'A1', to: 'O1' };
        additionalLines.getRow(1).font = { bold: true };

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="payroll_${month}.xlsx"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(buffer));
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/generate', async (req, res) => {
    try {
        const month = String(req.query.month || req.body?.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const result = await generatePayrollReports(month, req.user);
        res.json(result);
    } catch (err) {
        sendError(res, err);
    }
});

router.patch('/report/:id', async (req, res) => {
    try {
        const status = String(req.body?.status || '').trim();
        const report = await updatePayrollReportStatus(req.params.id, status, req.user);
        res.json({ success: true, report });
    } catch (err) {
        sendError(res, err);
    }
});

module.exports = router;
