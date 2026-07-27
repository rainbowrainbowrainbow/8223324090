/**
 * routes/payroll.js — Salary schemes, payroll preview, and monthly snapshots.
 */

const router = require('express').Router();
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { requireAction } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const {
    SCHEME_TYPES,
    REPORT_STATUSES,
    approvePayrollInstallment,
    cancelPayrollAdvanceInstallment,
    confirmPayrollInstallmentPayment,
    getSalaryReport,
    getPayrollSettlement,
    getPayrollWorkspace,
    getPayrollPreview,
    getPayrollRangePreview,
    createPayrollScheme,
    updatePayrollScheme,
    generatePayrollReports,
    reversePayrollPaymentMovement,
    updatePayrollInstallmentScheduledDate,
    updatePayrollReportStatus,
    normalizePayrollMonth
} = require('../services/payroll');
const { closePayrollPeriod } = require('../services/hrPayrollPeriod');
const {
    requireWritableBusinessScope,
    resolveBusinessScope
} = require('../services/businessContext');

const log = createLogger('PayrollRoutes');

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

function offRosterDraftReports(report = {}) {
    const payload = report.reconciliation?.offRosterDraftReports
        || report.reconciliation?.off_roster_draft_reports;
    return Array.isArray(payload?.reports) ? payload.reports : [];
}

function offRosterStaffStatus(row = {}) {
    const status = row.staffStatus || row.staff_status || {};
    return [
        status.missingHrCard || status.missing_hr_card ? 'missing_hr_card' : '',
        status.isFreelance || status.is_freelance ? 'freelance' : '',
        status.isActive === false || status.is_active === false ? 'inactive' : '',
        status.hasTerminationDate || status.has_termination_date ? 'terminated' : '',
        status.hrPoolStatus || status.hr_pool_status || ''
    ].filter(Boolean).join('|');
}

function payrollReportStatusExportFields(row = {}) {
    const settlement = row.payrollSettlement || row.payroll_settlement || {};
    const legacy = settlement.legacy || null;
    const rawStatus = row.status || row.reportStatus || row.report_status || '';
    return {
        report_status: legacy?.historicalStatus || legacy?.historical_status || rawStatus,
        legacy_report_status: legacy
            ? (legacy.reportStatus || legacy.report_status || rawStatus)
            : ''
    };
}

function writablePayrollBusinessContext(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireWritableBusinessScope(req, res, scope)) return null;
    return scope.activeContext;
}

function payrollInstallmentsForExport(row = {}) {
    const installments = Array.isArray(row.installments) ? row.installments : [];
    return installments.length ? installments : [null];
}

function payrollMovementRows(row = {}) {
    return (Array.isArray(row.installments) ? row.installments : [])
        .flatMap(installment => (installment.movements || installment.paymentMovements || [])
            .map(movement => ({ installment, movement })));
}

function payrollInstallmentExportFields(installment = null) {
    if (!installment) {
        return {
            installment_kind: '',
            earning_range: '',
            scheduled_payment_date: '',
            actual_payment_dates: '',
            calculated_amount: '',
            locked_amount: '',
            paid_amount: '',
            balance_amount: '',
            installment_status: '',
            approver: '',
            confirmer: '',
            approved_at: '',
            confirmed_at: '',
            finance_transaction_ids: '',
            reversal_transaction_ids: ''
        };
    }
    const movements = installment.movements || installment.paymentMovements || [];
    const payments = movements.filter(movement => movement.movementType === 'payment');
    const reversals = movements.filter(movement => movement.movementType === 'reversal');
    const actualDates = [...new Set(payments.map(movement => movement.actualPaymentDate).filter(Boolean))];
    const approver = [
        installment.approvedByUsername || '',
        installment.approvedByRole ? `(${installment.approvedByRole})` : ''
    ].filter(Boolean).join(' ');
    const confirmer = [...new Set(payments.map(movement => [
        movement.actorUsername || movement.actor_username || '',
        (movement.actorRole || movement.actor_role) ? `(${movement.actorRole || movement.actor_role})` : ''
    ].filter(Boolean).join(' ')).filter(Boolean))].join('|');
    const confirmedAt = [...new Set(payments.map(movement => movement.createdAt || movement.created_at).filter(Boolean))].join('|');
    return {
        installment_kind: installment.kind || '',
        earning_range: [installment.earningFrom, installment.earningTo].filter(Boolean).join(' — '),
        scheduled_payment_date: installment.scheduledPaymentDate || '',
        actual_payment_dates: actualDates.join('|'),
        calculated_amount: installment.calculatedAmount ?? '',
        locked_amount: installment.lockedAmount ?? '',
        paid_amount: installment.paidAmount ?? 0,
        balance_amount: installment.outstandingAmount ?? installment.balanceAmount ?? 0,
        installment_status: installment.settlementStatus || installment.workflowStatus || '',
        approver,
        confirmer,
        approved_at: installment.approvedAt || '',
        confirmed_at: confirmedAt,
        finance_transaction_ids: payments.map(movement => movement.financeTransactionId).filter(Boolean).join('|'),
        reversal_transaction_ids: reversals.map(movement => movement.financeTransactionId).filter(Boolean).join('|')
    };
}

router.get('/schemes', requireAction('view_payroll'), async (req, res) => {
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

router.post('/schemes', requireAction('manage_payroll_rules'), async (req, res) => {
    try {
        const scheme = await createPayrollScheme(req.body || {}, req.user);
        res.status(201).json({
            success: true,
            versionCreated: true,
            supersedesSchemeId: scheme.supersedesSchemeId || null,
            scheme
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.patch('/schemes/:id', requireAction('manage_payroll_rules'), async (req, res) => {
    try {
        const scheme = await updatePayrollScheme(req.params.id, req.body || {}, req.user);
        res.json({
            success: true,
            versionCreated: true,
            supersedesSchemeId: Number(req.params.id),
            scheme
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/payment-options', requireAction('confirm_payroll_payment'), async (req, res) => {
    try {
        const businessContext = businessContextFromRequest(req);
        const [categories, accounts] = await Promise.all([
            pool.query(
                `SELECT id, name, type, icon, color
                 FROM finance_categories
                 WHERE is_active = true
                   AND type IN ('expense', 'income')
                   AND COALESCE(business_context, 'event_genix') = $1
                 ORDER BY type, sort_order, name`,
                [businessContext]
            ),
            pool.query(
                `SELECT id, name, emoji, type
                 FROM finance_accounts
                 WHERE is_active = true
                   AND COALESCE(business_context, 'event_genix') = $1
                 ORDER BY sort_order, name`,
                [businessContext]
            )
        ]);
        res.json({
            success: true,
            businessContext,
            paymentMethods: ['cash', 'card', 'transfer', 'mixed'],
            categories: {
                expense: categories.rows.filter(row => row.type === 'expense'),
                income: categories.rows.filter(row => row.type === 'income')
            },
            accounts: accounts.rows
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/preview', requireAction('view_payroll'), async (req, res) => {
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

router.get('/range-preview', requireAction('view_payroll'), async (req, res) => {
    try {
        const month = String(req.query.month || String(req.query.from || '').slice(0, 7) || '').trim();
        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM), from and to (YYYY-MM-DD) required' });
        }
        const preview = await getPayrollRangePreview({
            month,
            from,
            to,
            staffId: req.query.staffId || req.query.staff_id
        });
        res.json({ success: true, ...preview });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/export', requireAction('view_payroll'), async (req, res) => {
    try {
        const month = String(req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const report = await getSalaryReport(month);
        const header = [
            'Staff ID', 'Працівник', 'Днів відпрацьовано', 'Фактичні години',
            'База', 'Overtime', 'Нараховано', 'Утримання', 'ЗРС', 'До виплати',
            'Розподіл за професіями', 'Payroll source refs',
            'physical_hours', 'base_role_hours', 'additional_role_hours',
            'additional_profession', 'additional_rate', 'additional_multiplier', 'additional_amount',
            'payroll_blocking_codes', 'payroll_blocking_details',
            'additional_line_status', 'blocker_code', 'blocker_message',
            'reconciliation_scope', 'payroll_report_id', 'report_status', 'legacy_report_status',
            'installment_kind', 'earning_range', 'scheduled_payment_date', 'actual_payment_dates',
            'calculated_amount', 'locked_amount', 'paid_amount', 'balance_amount',
            'installment_status', 'approver', 'approved_at', 'confirmer', 'confirmed_at',
            'finance_transaction_ids', 'reversal_transaction_ids',
            'off_roster_reason', 'staff_status'
        ];
        const rows = report.staff.flatMap(row => payrollInstallmentsForExport(row).map(installment => {
            const exportFields = payrollExportFields(row);
            const installmentFields = payrollInstallmentExportFields(installment);
            const reportStatusFields = payrollReportStatusExportFields(row);
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
                exportFields.blocker_message,
                'active_roster',
                row.reportId || row.report_id || '',
                reportStatusFields.report_status,
                reportStatusFields.legacy_report_status,
                installmentFields.installment_kind,
                installmentFields.earning_range,
                installmentFields.scheduled_payment_date,
                installmentFields.actual_payment_dates,
                installmentFields.calculated_amount,
                installmentFields.locked_amount,
                installmentFields.paid_amount,
                installmentFields.balance_amount,
                installmentFields.installment_status,
                installmentFields.approver,
                installmentFields.approved_at,
                installmentFields.confirmer,
                installmentFields.confirmed_at,
                installmentFields.finance_transaction_ids,
                installmentFields.reversal_transaction_ids,
                '',
                ''
            ].map(csvCell).join(';');
        }));
        for (const row of offRosterDraftReports(report)) {
            const offRosterValues = [
                row.staffId ?? row.staff_id ?? '',
                '',
                '', '', '', '', '', '', '', '',
                '', '',
                '', '', '',
                '', '', '', '',
                '', '',
                '', '', '',
                'off_active_roster',
                row.reportId ?? row.report_id ?? '',
                row.reportStatus || row.report_status || 'draft',
                row.reportStatus || row.report_status || 'draft',
                '', '', '', '',
                '', '', '', '',
                '', '', '', '', '',
                row.reason || '',
                offRosterStaffStatus(row)
            ];
            while (offRosterValues.length < header.length) {
                offRosterValues.splice(offRosterValues.length - 2, 0, '');
            }
            rows.push(offRosterValues.map(csvCell).join(';'));
        }
        const csv = '\uFEFF' + [header.map(csvCell).join(';'), ...rows].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="payroll_${month}.csv"`);
        res.send(csv);
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/export-xlsx', requireAction('view_payroll'), async (req, res) => {
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
            { header: 'ЗРС', key: 'advances_amount', width: 14 },
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
            { header: 'blocker_message', key: 'blocker_message', width: 64 },
            { header: 'reconciliation_scope', key: 'reconciliation_scope', width: 24 },
            { header: 'payroll_report_id', key: 'payroll_report_id', width: 18 },
            { header: 'report_status', key: 'report_status', width: 18 },
            { header: 'legacy_report_status', key: 'legacy_report_status', width: 22 },
            { header: 'installment_kind', key: 'installment_kind', width: 18 },
            { header: 'earning_range', key: 'earning_range', width: 26 },
            { header: 'scheduled_payment_date', key: 'scheduled_payment_date', width: 22 },
            { header: 'actual_payment_dates', key: 'actual_payment_dates', width: 28 },
            { header: 'calculated_amount', key: 'calculated_amount', width: 18 },
            { header: 'locked_amount', key: 'locked_amount', width: 18 },
            { header: 'paid_amount', key: 'paid_amount', width: 18 },
            { header: 'balance_amount', key: 'balance_amount', width: 18 },
            { header: 'installment_status', key: 'installment_status', width: 22 },
            { header: 'approver', key: 'approver', width: 28 },
            { header: 'approved_at', key: 'approved_at', width: 28 },
            { header: 'confirmer', key: 'confirmer', width: 28 },
            { header: 'confirmed_at', key: 'confirmed_at', width: 28 },
            { header: 'finance_transaction_ids', key: 'finance_transaction_ids', width: 28 },
            { header: 'reversal_transaction_ids', key: 'reversal_transaction_ids', width: 28 },
            { header: 'off_roster_reason', key: 'off_roster_reason', width: 24 },
            { header: 'staff_status', key: 'staff_status', width: 36 }
        ];
        for (const row of report.staff) {
            for (const installment of payrollInstallmentsForExport(row)) {
                const exportFields = payrollExportFields(row);
                const installmentFields = payrollInstallmentExportFields(installment);
                const reportStatusFields = payrollReportStatusExportFields(row);
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
                    ...exportFields,
                    reconciliation_scope: 'active_roster',
                    payroll_report_id: row.reportId || null,
                    ...reportStatusFields,
                    ...installmentFields,
                    off_roster_reason: null,
                    staff_status: null
                });
            }
        }
        summary.views = [{ state: 'frozen', ySplit: 1 }];
        summary.autoFilter = { from: 'A1', to: 'AQ1' };
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

        const paymentsSheet = workbook.addWorksheet('Payments');
        paymentsSheet.columns = [
            { header: 'payroll_report_id', key: 'payroll_report_id', width: 18 },
            { header: 'staff_id', key: 'staff_id', width: 12 },
            { header: 'staff_name', key: 'staff_name', width: 28 },
            { header: 'installment_id', key: 'installment_id', width: 16 },
            { header: 'installment_kind', key: 'installment_kind', width: 18 },
            { header: 'earning_range', key: 'earning_range', width: 26 },
            { header: 'movement_id', key: 'movement_id', width: 16 },
            { header: 'movement_type', key: 'movement_type', width: 18 },
            { header: 'amount', key: 'amount', width: 14 },
            { header: 'actual_payment_date', key: 'actual_payment_date', width: 22 },
            { header: 'actor', key: 'actor', width: 28 },
            { header: 'actor_role', key: 'actor_role', width: 18 },
            { header: 'reason', key: 'reason', width: 36 },
            { header: 'finance_transaction_id', key: 'finance_transaction_id', width: 24 },
            { header: 'reverses_movement_id', key: 'reverses_movement_id', width: 22 },
            { header: 'created_at', key: 'created_at', width: 28 }
        ];
        for (const row of report.staff) {
            for (const { installment, movement } of payrollMovementRows(row)) {
                paymentsSheet.addRow({
                    payroll_report_id: row.reportId || null,
                    staff_id: row.staffId,
                    staff_name: row.name,
                    installment_id: installment.id,
                    installment_kind: installment.kind,
                    earning_range: [installment.earningFrom, installment.earningTo].filter(Boolean).join(' — '),
                    movement_id: movement.id,
                    movement_type: movement.movementType,
                    amount: movement.amount,
                    actual_payment_date: movement.actualPaymentDate,
                    actor: movement.actorUsername,
                    actor_role: movement.actorRole,
                    reason: movement.reason,
                    finance_transaction_id: movement.financeTransactionId,
                    reverses_movement_id: movement.reversesMovementId,
                    created_at: movement.createdAt
                });
            }
        }
        paymentsSheet.views = [{ state: 'frozen', ySplit: 1 }];
        paymentsSheet.autoFilter = { from: 'A1', to: 'P1' };
        paymentsSheet.getRow(1).font = { bold: true };

        const reconciliationSheet = workbook.addWorksheet('Reconciliation');
        reconciliationSheet.columns = [
            { header: 'reconciliation_scope', key: 'reconciliation_scope', width: 24 },
            { header: 'payroll_report_id', key: 'payroll_report_id', width: 18 },
            { header: 'staff_id', key: 'staff_id', width: 12 },
            { header: 'period_month', key: 'period_month', width: 14 },
            { header: 'report_status', key: 'report_status', width: 18 },
            { header: 'off_roster_reason', key: 'off_roster_reason', width: 24 },
            { header: 'staff_status', key: 'staff_status', width: 36 },
            { header: 'generated_at', key: 'generated_at', width: 28 },
            { header: 'updated_at', key: 'updated_at', width: 28 }
        ];
        for (const row of offRosterDraftReports(report)) {
            reconciliationSheet.addRow({
                reconciliation_scope: 'off_active_roster',
                payroll_report_id: row.reportId ?? row.report_id ?? null,
                staff_id: row.staffId ?? row.staff_id ?? null,
                period_month: row.periodMonth || row.period_month || null,
                report_status: row.reportStatus || row.report_status || 'draft',
                off_roster_reason: row.reason || null,
                staff_status: offRosterStaffStatus(row),
                generated_at: row.generatedAt || row.generated_at || null,
                updated_at: row.updatedAt || row.updated_at || null
            });
        }
        reconciliationSheet.views = [{ state: 'frozen', ySplit: 1 }];
        reconciliationSheet.autoFilter = { from: 'A1', to: 'I1' };
        reconciliationSheet.getRow(1).font = { bold: true };

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="payroll_${month}.xlsx"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(buffer));
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/generate', requireAction('manage_payroll_accrual'), async (req, res) => {
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

router.get('/settlement', requireAction('view_payroll'), async (req, res) => {
    try {
        const month = String(req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const settlement = await getPayrollSettlement(month);
        res.json({ success: true, settlement });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/installments/calculate', requireAction('manage_payroll_accrual'), async (req, res) => {
    try {
        const month = String(req.query.month || req.body?.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const result = await generatePayrollReports(month, req.user);
        const settlement = await getPayrollSettlement(month);
        res.json({
            ...result,
            operation: 'calculate_draft',
            settlement,
            financeChanged: false
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/installments/:id/approve', requireAction('approve_payroll_installment'), async (req, res) => {
    try {
        const businessContext = writablePayrollBusinessContext(req, res);
        if (!businessContext) return;
        const installment = await approvePayrollInstallment(req.params.id, req.user, {
            businessContext
        });
        res.json({ success: true, operation: 'approve_installment', installment, financeChanged: false });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/installments/:id/cancel', requireAction('approve_payroll_installment'), async (req, res) => {
    try {
        const result = await cancelPayrollAdvanceInstallment(req.params.id, req.user, req.body || {});
        res.json({ success: true, operation: 'cancel_advance', financeChanged: false, ...result });
    } catch (err) {
        sendError(res, err);
    }
});

router.patch('/installments/:id/schedule', requireAction('manage_payroll_accrual'), async (req, res) => {
    try {
        const installment = await updatePayrollInstallmentScheduledDate(req.params.id, req.user, req.body || {});
        res.json({ success: true, operation: 'update_scheduled_payment_date', installment, financeChanged: false });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/installments/:id/payments/confirm', requireAction('confirm_payroll_payment'), async (req, res) => {
    try {
        const businessContext = writablePayrollBusinessContext(req, res);
        if (!businessContext) return;
        const result = await confirmPayrollInstallmentPayment(req.params.id, req.user, {
            ...(req.body || {}),
            businessContext,
            idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key
        });
        res.status(result.idempotent ? 200 : 201).json({
            success: true,
            operation: 'confirm_payment',
            financeChanged: !result.idempotent,
            ...result
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/payments/:id/reverse', requireAction('reverse_payroll_payment'), async (req, res) => {
    try {
        const businessContext = writablePayrollBusinessContext(req, res);
        if (!businessContext) return;
        const result = await reversePayrollPaymentMovement(req.params.id, req.user, {
            ...(req.body || {}),
            businessContext,
            idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key
        });
        res.status(result.idempotent ? 200 : 201).json({
            success: true,
            operation: 'reverse_payment',
            financeChanged: !result.idempotent,
            ...result
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/period/close', requireAction('close_payroll_period'), async (req, res) => {
    try {
        const month = String(req.body?.month || req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month (YYYY-MM) required' });
        }
        const actor = req.user?.username || req.user?.name || req.user?.email || 'crm';
        const result = await closePayrollPeriod(month, actor, req.body?.note || '');
        res.json({ success: true, operation: 'close_month', ...result });
    } catch (err) {
        sendError(res, err);
    }
});

router.patch('/report/:id', requireAction('manage_payroll_accrual'), async (req, res) => {
    try {
        const status = String(req.body?.status || '').trim();
        const report = await updatePayrollReportStatus(req.params.id, status, req.user);
        res.json({ success: true, report });
    } catch (err) {
        sendError(res, err);
    }
});

module.exports = router;
module.exports.__payrollExportTestHooks = Object.freeze({
    payrollReportStatusExportFields
});
