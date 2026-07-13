/**
 * routes/payroll.js — Salary schemes, payroll preview, and monthly snapshots.
 */

const router = require('express').Router();
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
    const status = err.status || 500;
    if (status >= 500) log.error(err.message || fallback, err);
    res.status(status).json({ success: false, error: err.message || fallback });
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
            'Розподіл за професіями', 'Payroll source refs'
        ];
        const rows = report.staff.map(row => {
            const professionBreakdown = (row.professionRateSummary || []).map(item => [
                item.profession_key || '',
                item.kind || 'base',
                `${item.actual_hours || 0}h`,
                `${item.rate || 0}/${item.rate_unit || 'hour'}`,
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
                refs
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
