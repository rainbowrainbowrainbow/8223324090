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

function payrollBlockingIssues(row = {}) {
    const issues = row.payrollBlockingIssues || row.payroll_blocking_issues
        || row.reconciliation?.blockingIssues || row.reconciliation?.blocking_issues;
    return Array.isArray(issues) ? issues : [];
}

function payrollBlockingIssueForRole(row = {}, role = {}) {
    if (role.blockerCode || role.blocker_code) {
        return {
            code: role.blockerCode || role.blocker_code,
            message: role.blockerMessage || role.blocker_message || role.blockerCode || role.blocker_code
        };
    }
    return payrollBlockingIssues(row).find(issue => (
        (!issue.professionKey && !issue.profession_key
            || (issue.professionKey || issue.profession_key) === (role.professionKey || role.profession_key))
        && (!issue.date || issue.date === (role.workDate || role.work_date))
    )) || null;
}

function payrollAdditionalLineRows(row = {}) {
    const roles = payrollAdditionalRoles(row);
    const issues = payrollBlockingIssues(row);
    const lines = roles.map(role => {
        const blocker = payrollBlockingIssueForRole(row, role);
        const status = blocker || role.status === 'blocked' || role.amount === null || role.amount === undefined
            ? 'blocked'
            : 'ready';
        return {
            ...role,
            status,
            blockerCode: blocker?.code || null,
            blockerMessage: blocker?.message || null
        };
    });
    for (const issue of issues) {
        const issueProfession = issue.professionKey || issue.profession_key || null;
        const matched = lines.some(role => (
            role.blockerCode === issue.code
            && (!issueProfession || issueProfession === (role.professionKey || role.profession_key))
            && (!issue.date || issue.date === (role.workDate || role.work_date))
        ));
        if (matched) continue;
        lines.push({
            professionKey: issue.professionKey || issue.profession_key || null,
            minutes: issue.paidRoleMinutes ?? issue.minutes ?? 0,
            hours: Number(issue.paidRoleHours ?? 0),
            workDate: issue.date || null,
            attendanceRef: issue.attendanceRef ?? issue.attendance_ref ?? issue.attendanceRefs?.[0] ?? null,
            segmentRef: issue.segmentRef ?? issue.segment_ref ?? issue.segmentRefs?.[0] ?? null,
            roleRef: issue.roleRef ?? issue.role_ref ?? issue.roleRefs?.[0] ?? null,
            rate: null,
            multiplier: null,
            amount: null,
            status: 'blocked',
            blockerCode: issue.code || null,
            blockerMessage: issue.message || issue.code || 'Payroll blocked'
        });
    }
    return lines;
}

function payrollExportFields(row = {}) {
    const transparency = row.payrollTransparency || row.payroll_transparency || {};
    const roles = payrollAdditionalLineRows(row);
    const blockingIssues = payrollBlockingIssues(row);
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
        additional_amount: Number(transparency.additionalAmount ?? row.additionalAmount ?? 0),
        additional_line_status: joined('status'),
        blocker_code: joined('blockerCode'),
        blocker_message: joined('blockerMessage'),
        payroll_blocking_codes: [...new Set(blockingIssues.map(issue => issue.code).filter(Boolean))].join('|'),
        payroll_blocking_details: blockingIssues.map(issue => [
            issue.professionKey || '',
            issue.paidRoleMinutes ?? issue.minutes ?? '',
            issue.message || issue.code || ''
        ].join(':')).join(' | ')
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
            'additional_profession', 'additional_rate', 'additional_multiplier', 'additional_amount',
            'payroll_blocking_codes', 'payroll_blocking_details',
            'additional_line_status', 'blocker_code', 'blocker_message'
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
                exportFields.additional_amount,
                exportFields.payroll_blocking_codes,
                exportFields.payroll_blocking_details,
                exportFields.additional_line_status,
                exportFields.blocker_code,
                exportFields.blocker_message
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
            { header: 'additional_amount', key: 'additional_amount', width: 20 },
            { header: 'payroll_blocking_codes', key: 'payroll_blocking_codes', width: 48 },
            { header: 'payroll_blocking_details', key: 'payroll_blocking_details', width: 64 },
            { header: 'additional_line_status', key: 'additional_line_status', width: 24 },
            { header: 'blocker_code', key: 'blocker_code', width: 48 },
            { header: 'blocker_message', key: 'blocker_message', width: 64 }
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
        summary.autoFilter = { from: 'A1', to: 'V1' };
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
            { header: 'formula', key: 'formula', width: 34 },
            { header: 'status', key: 'status', width: 16 },
            { header: 'blocker_code', key: 'blocker_code', width: 48 },
            { header: 'blocker_message', key: 'blocker_message', width: 64 }
        ];
        for (const row of report.staff) {
            for (const role of payrollAdditionalLineRows(row)) {
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
                    formula: role.formula || null,
                    status: role.status,
                    blocker_code: role.blockerCode || null,
                    blocker_message: role.blockerMessage || null
                });
            }
        }
        additionalLines.views = [{ state: 'frozen', ySplit: 1 }];
        additionalLines.autoFilter = { from: 'A1', to: 'R1' };
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
