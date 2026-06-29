/**
 * routes/reports.js — Reports module API (v32.7)
 *
 * CRUD for financial reports, summary/analytics, accountant management.
 * Hashtag-based grouping and filtering. Accepts data from Telegram bot, web UI, or manual entry.
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { requireRole } = require('../middleware/auth');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest,
    normalizeBusinessContext,
    pushBusinessContextCondition,
    pushBusinessScopeCondition,
    requireBusinessScope,
    resolveBusinessScope
} = require('../services/businessContext');
const { listTaskOwnerCandidates } = require('../services/taskExecution');
const ExcelJS = require('exceljs');

const log = createLogger('Reports');
function getKleshnya() { return require('../services/kleshnya'); }

// RBAC: Reports access — aligned with /reports page/sidebar visibility.
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'accountant'));

// ==========================================
// HELPERS
// ==========================================

function parseHashtags(val) {
    if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean);
    if (!val) return [];
    try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
    } catch { return []; }
}

function sanitizeHashtags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(
        tags.map(t => String(t).trim().slice(0, 50)).filter(Boolean)
    )];
}

function parseRawData(val) {
    if (!val) return {};
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch {
        return {};
    }
}

function currentUsername(req) {
    return req.user?.username || req.user?.displayName || 'system';
}

function currentReportBusinessContext(req) {
    return normalizeBusinessContext(businessContextFromRequest(req) || DEFAULT_BUSINESS_CONTEXT);
}

function ensureReportBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function reportScopeCondition(params, scope, alias = 'r') {
    return pushBusinessScopeCondition(params, scope || DEFAULT_BUSINESS_CONTEXT, alias);
}

function reportContextCondition(params, req, alias = 'r') {
    return pushBusinessContextCondition(params, currentReportBusinessContext(req), alias);
}

function optionalInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function currentUserId(req) {
    return optionalInteger(req.user?.id);
}

const REPORT_APPROVAL_ASSIGNEE_SETTING = 'reports.approval.assignee_user_id';

function userLabel(row = {}) {
    return row.name || row.username || (row.id ? `User #${row.id}` : null);
}

function normalizeApprovalStatus(value) {
    return ['none', 'pending', 'task_created', 'in_review', 'approved', 'rejected'].includes(value) ? value : 'none';
}

async function getReportApprovalAssignee() {
    const setting = await pool.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [REPORT_APPROVAL_ASSIGNEE_SETTING]);
    const userId = optionalInteger(setting.rows[0]?.value);
    if (!userId) return null;
    const user = await pool.query(
        `SELECT id, username, name, role
         FROM users
         WHERE id = $1 AND COALESCE(is_active, true) = true
         LIMIT 1`,
        [userId]
    );
    if (!user.rows.length) return null;
    return {
        id: user.rows[0].id,
        username: user.rows[0].username,
        name: user.rows[0].name || null,
        role: user.rows[0].role || null,
        label: userLabel(user.rows[0])
    };
}

async function getReportWorkflowSettings(req) {
    let users = [];
    try {
        users = await listTaskOwnerCandidates({ actor: req.user });
    } catch (err) {
        log.warn('Report workflow owner candidates lookup failed', { error: err.message });
    }
    const assignee = await getReportApprovalAssignee();
    if (assignee && !users.some(user => Number(user.id) === Number(assignee.id))) {
        users.unshift(assignee);
    }
    return {
        approvalAssigneeUserId: assignee?.id || null,
        approvalAssigneeLabel: assignee?.label || null,
        users,
        taskContract: {
            sourceType: 'report',
            sourceEntityType: 'report',
            canonicalOwnerField: 'tasks.owner_user_id'
        }
    };
}

async function saveReportWorkflowSettings(req, body) {
    const assigneeUserId = optionalInteger(body?.approvalAssigneeUserId ?? body?.assigneeUserId ?? body?.ownerUserId);
    if (!assigneeUserId) {
        await pool.query('DELETE FROM settings WHERE key = $1', [REPORT_APPROVAL_ASSIGNEE_SETTING]);
        return getReportWorkflowSettings(req);
    }
    const user = await pool.query(
        `SELECT id, username, name, role
         FROM users
         WHERE id = $1 AND COALESCE(is_active, true) = true
         LIMIT 1`,
        [assigneeUserId]
    );
    if (!user.rows.length) {
        const err = new Error('Selected task receiver is not active');
        err.statusCode = 400;
        throw err;
    }
    await pool.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [REPORT_APPROVAL_ASSIGNEE_SETTING, String(assigneeUserId)]
    );
    return getReportWorkflowSettings(req);
}

function canManageReportTemplates(req) {
    const roles = new Set([req.user?.role, ...(Array.isArray(req.user?.roles) ? req.user.roles : [])].filter(Boolean));
    return ['creator', 'director', 'vice_director', 'senior_manager'].some(role => roles.has(role));
}

function sanitizeSubmittedVia(value, fallback = 'web') {
    return ['bot', 'web', 'manual', 'web-template', 'template'].includes(value) ? value : fallback;
}

function sanitizeTemplateBody(body, req, existing = {}) {
    const schema = parseRawData(body.schema || body.schemaJson || body.schema_json || {});
    const columns = Array.isArray(schema.columns) ? schema.columns : (Array.isArray(body.columns) ? body.columns : []);
    const rows = Array.isArray(schema.rows) ? schema.rows : (Array.isArray(body.rows) ? body.rows : []);
    if (!columns.length) {
        const err = new Error('columns required');
        err.statusCode = 400;
        throw err;
    }

    const title = String(body.title || existing.title || '').trim();
    if (!title) {
        const err = new Error('title required');
        err.statusCode = 400;
        throw err;
    }

    const requestedScope = body.scope || existing.scope || 'personal';
    const scope = requestedScope === 'global' && canManageReportTemplates(req) ? 'global' : 'personal';
    const source = existing.source === 'system' ? 'system' : (body.source === 'uploaded' ? 'uploaded' : 'custom');
    const businessContext = normalizeBusinessContext(existing.business_context || body.businessContext || body.business_context || currentReportBusinessContext(req));
    const codeBase = String(body.code || existing.code || title).trim().toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 90) || `template-${Date.now()}`;
    const codeSuffix = scope === 'personal'
        ? `-${currentUsername(req)}-${businessContext}`
        : (source === 'system' ? '' : `-${businessContext}`);

    return {
        code: existing.code || `${codeBase}${codeSuffix}`.slice(0, 100),
        title,
        category: String(body.category || existing.category || 'Custom').slice(0, 120),
        layout: String(body.layout || existing.layout || 'custom').slice(0, 80),
        description: body.description || existing.description || null,
        purpose: body.purpose || existing.purpose || null,
        schemaJson: { columns, rows },
        defaultReportJson: parseRawData(body.defaultReport || body.defaultReportJson || body.default_report_json || existing.default_report_json || {}),
        source,
        scope,
        businessContext
    };
}

function mapTemplateRow(r) {
    const schema = parseRawData(r.schema_json);
    return {
        id: r.id,
        code: r.code,
        title: r.title,
        category: r.category,
        layout: r.layout,
        description: r.description,
        purpose: r.purpose,
        source: r.source,
        scope: r.scope,
        businessContext: normalizeBusinessContext(r.business_context || DEFAULT_BUSINESS_CONTEXT),
        isActive: r.is_active,
        createdByUsername: r.created_by_username,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        schema,
        columns: Array.isArray(schema.columns) ? schema.columns : [],
        rows: Array.isArray(schema.rows) ? schema.rows : [],
        defaultReport: parseRawData(r.default_report_json)
    };
}

function normalizeTablePayload(raw) {
    const payload = normalizeReportRawPayload(parseRawData(raw));
    const table = payload.reportTableTemplate || payload.table || payload;
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    if (!columns.length) {
        const err = new Error('table columns required');
        err.statusCode = 400;
        throw err;
    }
    return {
        payload,
        table: normalizePayrollTable({
            ...table,
            title: table.title || payload.title || 'Табличний звіт',
            columns,
            rows
        })
    };
}

function numericValue(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function calculateTableAmount(table, defaultReport = {}) {
    const amountColumn = defaultReport.amountColumn || table.defaultReport?.amountColumn;
    if (!amountColumn) return 0;
    return Math.max(0, Math.round((table.rows || []).reduce((sum, row) => sum + numericValue(row?.[amountColumn]), 0)));
}

function isPayrollTable(table = {}) {
    const identity = [
        table.id,
        table.code,
        table.layout,
        table.category,
        table.defaultReport?.hashtag
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return identity.includes('payroll') || identity.includes('table-payroll');
}

function payrollStaffId(row = {}) {
    return String(row.staff_id || row.employee_staff_id || row.staffId || '').trim();
}

function payrollDateKey(row = {}) {
    return String(row.date || row.shift_date || row.work_date || '').slice(0, 10);
}

function payrollLookupKey(row = {}) {
    const staffId = payrollStaffId(row);
    const date = payrollDateKey(row);
    return staffId && date ? `${staffId}_${date}` : '';
}

function pushPayrollIssue(issues, code) {
    if (code && !issues.includes(code)) issues.push(code);
}

function normalizePayrollRows(table = {}) {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const duplicateCounts = {};
    rows.forEach(row => {
        const key = payrollLookupKey(row);
        if (key) duplicateCounts[key] = (duplicateCounts[key] || 0) + 1;
    });

    const rowMeta = rows.map((row, index) => {
        const next = { ...(row || {}) };
        const issues = Array.isArray(next.reconciliation_issues) ? [...next.reconciliation_issues] : [];
        const staffId = payrollStaffId(next);
        const date = payrollDateKey(next);
        const key = staffId && date ? `${staffId}_${date}` : '';
        const hasAnyValue = Object.values(next).some(value => {
            if (value === null || value === undefined) return false;
            if (Array.isArray(value)) return value.length > 0;
            if (typeof value === 'object') return Object.keys(value).length > 0;
            return String(value).trim() !== '';
        });

        if (staffId) next.staff_id = staffId;
        next.display_snapshot = next.display_snapshot || next.employee || next.name || '';
        next.role_snapshot = next.role_snapshot || next.role || '';
        next.planned_hours = numericValue(next.planned_hours);
        next.actual_hours = numericValue(next.actual_hours);
        next.paid_hours = numericValue(next.hours || next.paid_hours);
        next.manual_amount = numericValue(next.manual_amount);
        next.bonuses = numericValue(next.bonus || next.bonuses);
        next.penalties = numericValue(next.penalty || next.penalties);
        next.notes = next.notes || '';

        if (!staffId && hasAnyValue) pushPayrollIssue(issues, 'missing_staff_id');
        if (!date && hasAnyValue) pushPayrollIssue(issues, 'missing_payroll_date');
        if (staffId && date && !next.planned_shift_ref) pushPayrollIssue(issues, 'no_shift');
        if (next.planned_shift_ref && !next.attendance_ref) pushPayrollIssue(issues, 'no_attendance');
        if (next.actual_hours > 0 && next.paid_hours > 0 && Math.abs(next.actual_hours - next.paid_hours) > 0.05) {
            pushPayrollIssue(issues, 'actual_paid_hours_mismatch');
        }
        if (key && duplicateCounts[key] > 1) pushPayrollIssue(issues, 'duplicate_payroll_row');
        if (hasAnyValue && numericValue(next.total || next.amount) <= 0) pushPayrollIssue(issues, 'amount_missing_or_zero');
        if (String(next.staff_status || '').toLowerCase() === 'offboarded') pushPayrollIssue(issues, 'offboarded_staff');

        const manualStatus = String(next.payroll_status || next.reconciliation_status || '').trim();
        const status = manualStatus === 'approved'
            ? 'approved'
            : !hasAnyValue
                ? 'draft'
                : issues.length
                    ? 'needs_review'
                    : 'reconciled';
        next.reconciliation_status = status;
        next.reconciliation_issues = issues;

        return {
            index,
            row: next,
            status,
            issues,
            plannedHours: numericValue(next.planned_hours),
            actualHours: numericValue(next.actual_hours),
            paidHours: numericValue(next.paid_hours),
            amount: numericValue(next.total || next.amount)
        };
    });

    const totals = rowMeta.reduce((acc, item) => {
        acc.planned += item.plannedHours;
        acc.actual += item.actualHours;
        acc.paid += item.paidHours;
        acc.amount += item.amount;
        return acc;
    }, { planned: 0, actual: 0, paid: 0, amount: 0 });
    Object.keys(totals).forEach(key => { totals[key] = Math.round(totals[key] * 100) / 100; });

    const issueCounts = {};
    rowMeta.forEach(item => item.issues.forEach(code => { issueCounts[code] = (issueCounts[code] || 0) + 1; }));
    const nonDraft = rowMeta.filter(item => item.status !== 'draft');
    const status = nonDraft.length === 0
        ? 'draft'
        : rowMeta.some(item => item.status === 'needs_review')
            ? 'needs_review'
            : rowMeta.every(item => item.status === 'approved')
                ? 'approved'
                : 'reconciled';

    return {
        rows: rowMeta.map(item => item.row),
        payrollReconciliation: {
            status,
            totals,
            issueCounts,
            generatedAt: new Date().toISOString(),
            source: 'reports_rawData_payroll_reconciliation_v1'
        }
    };
}

function normalizePayrollTable(table = {}) {
    if (!isPayrollTable(table)) return table;
    const normalized = normalizePayrollRows(table);
    return {
        ...table,
        schemaVersion: Math.max(Number(table.schemaVersion || 1), 1),
        rows: normalized.rows,
        payrollReconciliation: normalized.payrollReconciliation
    };
}

function normalizeReportRawPayload(rawData = {}) {
    const payload = parseRawData(rawData);
    if (!payload.reportTableTemplate) return payload;
    return {
        ...payload,
        reportTableTemplate: normalizePayrollTable(payload.reportTableTemplate)
    };
}

function normalizedComparable(value) {
    return String(value || '').trim().toLocaleLowerCase('uk-UA');
}

function reportLifecycleStatus(row) {
    const raw = parseRawData(row?.raw_data);
    const table = raw.reportTableTemplate || {};
    return row?.report_lifecycle_status === 'closed' || table.lifecycle?.status === 'closed' ? 'closed' : 'open';
}

function isReportLifecycleClosed(row) {
    return reportLifecycleStatus(row) === 'closed';
}

function buildClosedTablePayload(raw, req, closedAt = new Date().toISOString()) {
    const normalized = normalizeTablePayload(raw);
    const currentPayload = normalized.payload.reportTableTemplate
        ? normalized.payload
        : { reportTableTemplate: normalized.table };
    const lifecycle = {
        status: 'closed',
        closedAt,
        closedBy: currentUsername(req),
        closedByUserId: currentUserId(req)
    };
    const table = {
        ...normalized.table,
        lifecycle,
        lockedAt: closedAt,
        lockedBy: currentUsername(req)
    };
    const lockedPayload = {
        ...currentPayload,
        reportTableTemplate: table
    };
    return { normalized, table, lockedPayload, lifecycle };
}

function tableSummaryRows(table) {
    if (!table) return [];
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const defaultReport = table.defaultReport || {};
    const totalColumns = columns.filter(col => col.total === 'sum');
    const summary = [];
    const amountColumn = defaultReport.amountColumn || (totalColumns.length === 1 ? totalColumns[0].key : null);
    if (amountColumn) {
        summary.push({
            label: defaultReport.totalLabel || 'Ітого',
            amount: rows.reduce((sum, row) => sum + numericValue(row?.[amountColumn]), 0),
            amountColumn
        });
    }
    const rules = Array.isArray(defaultReport.subtotalRules) ? defaultReport.subtotalRules : [];
    for (const rule of rules) {
        if (!rule?.categoryColumn || !rule?.amountColumn) continue;
        const matchingRows = rows.filter(row =>
            normalizedComparable(row?.[rule.categoryColumn]) === normalizedComparable(rule.categoryValue)
        );
        if (!matchingRows.length) continue;
        summary.push({
            label: rule.label || 'Ітого',
            amount: matchingRows.reduce((sum, row) => sum + numericValue(row?.[rule.amountColumn]), 0),
            amountColumn: rule.amountColumn
        });
    }
    return summary;
}

function summaryCsvRows(table) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length) return [];
    return tableSummaryRows(table).map(item => {
        const values = columns.map(() => '');
        values[0] = item.label;
        const amountIndex = Math.max(0, columns.findIndex(col => col.key === item.amountColumn));
        values[amountIndex] = item.amount;
        return values.map(csvCell).join(';');
    });
}

function mapDraftRow(r) {
    return {
        id: r.id,
        templateId: r.template_id,
        title: r.title,
        status: r.status,
        tableJson: parseRawData(r.table_json),
        reportId: r.report_id,
        closedAt: r.closed_at || null,
        closedByUserId: r.closed_by_user_id || null,
        closedByUsername: r.closed_by_username || null,
        lockedSnapshot: parseRawData(r.locked_snapshot),
        createdByUsername: r.created_by_username,
        submittedAt: r.submitted_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        templateTitle: r.template_title || null,
        businessContext: normalizeBusinessContext(r.business_context || DEFAULT_BUSINESS_CONTEXT)
    };
}

async function assignOnDutyAccountant(report) {
    const businessContext = normalizeBusinessContext(report.businessContext || report.business_context || DEFAULT_BUSINESS_CONTEXT);
    const dutyAccountant = await pool.query(
        'SELECT id, name, chat_id, staff_id FROM accountants WHERE is_on_duty = true LIMIT 1'
    );
    if (dutyAccountant.rows.length > 0) {
        await pool.query(
            'UPDATE reports SET assigned_to = $1, assigned_at = NOW() WHERE id = $2 AND COALESCE(business_context, $3) = $3',
            [dutyAccountant.rows[0].id, report.id, businessContext]
        );
        report.assignedTo = dutyAccountant.rows[0].id;
        report.accountantName = dutyAccountant.rows[0].name;
        report.accountantStaffId = dutyAccountant.rows[0].staff_id || null;
    }
    return report;
}

async function createReportHandoffTask(report, req) {
    if (!report?.id) return null;
    try {
        const reportId = String(report.id);
        const reportBusinessContext = normalizeBusinessContext(report.businessContext || report.business_context || currentReportBusinessContext(req));
        const reviewer = await getReportApprovalAssignee();
        const assigneeLabel = reviewer?.label || report.accountantName || 'Бухгалтер';
        const reportUrl = `/reports?businessContext=${encodeURIComponent(reportBusinessContext)}&reportId=${encodeURIComponent(reportId)}`;
        const title = `Перевірити звіт #${reportId}`;
        const description = [
            `Звіт: ${report.description || report.rawData?.reportTableTemplate?.title || report.category || 'табличний звіт'}`,
            `Сума: ${Number(report.amount || 0).toLocaleString('uk-UA')} грн`,
            `Статус звіту: ${report.lifecycleStatus === 'closed' ? 'закритий' : 'потребує перевірки'}`,
            `Хто подав: ${report.submittedBy || currentUsername(req)}`,
            report.closedByUsername ? `Закрив: ${report.closedByUsername}` : null,
            report.closedAt ? `Дата закриття: ${new Date(report.closedAt).toLocaleString('uk-UA')}` : null,
            `Відкрити звіт: ${reportUrl}`
        ].filter(Boolean).join('\n');

        const task = await getKleshnya().createTask({
            title,
            description,
            date: new Date().toISOString().slice(0, 10),
            priority: 'normal',
            assigned_to: assigneeLabel,
            owner: assigneeLabel,
            owner_user_id: reviewer?.id || null,
            created_by: currentUsername(req),
            created_by_user_id: currentUserId(req),
            category: 'finance',
            subcategory: 'reports',
            source_type: 'report',
            source_id: reportId,
            source_entity_type: 'report',
            source_entity_id: reportId,
            related_entity_type: 'report',
            related_entity_id: reportId,
            source_module: 'reports',
            task_mode: 'work',
            task_kind: 'action',
            visibility: 'team',
            workflow_state: 'todo',
            control_meta: {
                reportApproval: true,
                reportId: Number(report.id),
                businessContext: reportBusinessContext,
                reportUrl,
                approvalStatus: 'task_created'
            },
            duplicateMode: 'skip'
        });
        if (task?.id) {
            await pool.query(
                `UPDATE reports
                 SET approval_status = 'task_created',
                     approval_task_id = $1,
                     approval_assignee_user_id = $2,
                     approval_assignee_name = $3,
                     approval_requested_at = COALESCE(approval_requested_at, NOW()),
                     updated_at = NOW()
                 WHERE id = $4`,
                [task.id, reviewer?.id || null, assigneeLabel, report.id]
            );
        } else {
            await pool.query(
                `UPDATE reports
                 SET approval_status = CASE WHEN approval_status IN ('none', 'pending') THEN 'pending' ELSE approval_status END,
                     approval_assignee_user_id = $1,
                     approval_assignee_name = $2,
                     updated_at = NOW()
                 WHERE id = $3`,
                [reviewer?.id || null, assigneeLabel, report.id]
            );
        }
        return task?.id ? task : null;
    } catch (err) {
        log.warn('Report handoff task creation skipped', { reportId: report?.id, error: err.message });
        await pool.query(
            `UPDATE reports
             SET approval_status = CASE WHEN approval_status IN ('none', 'pending') THEN 'pending' ELSE approval_status END,
                 updated_at = NOW()
             WHERE id = $1`,
            [report.id]
        ).catch(() => {});
        return null;
    }
}

async function createReportFromTablePayload(req, tablePayload, overrides = {}) {
    const businessContext = currentReportBusinessContext(req);
    const normalized = normalizeTablePayload(tablePayload);
    const defaultReport = normalized.table.defaultReport || parseRawData(overrides.defaultReport || {});
    const type = defaultReport.type === 'income' ? 'income' : 'expense';
    const category = overrides.category || defaultReport.category || normalized.table.category || 'Інше';
    const amount = overrides.amount !== undefined
        ? numericValue(overrides.amount)
        : calculateTableAmount(normalized.table, defaultReport);
    const hashtags = sanitizeHashtags(overrides.hashtags || [defaultReport.hashtag || 'table-report']);
    const rawData = normalized.payload.reportTableTemplate
        ? normalized.payload
        : { reportTableTemplate: normalized.table };

    const result = await pool.query(`
        INSERT INTO reports (business_context, type, amount, description, category, submitted_by, submitted_by_id,
            submitted_via, raw_data, hashtags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'web-template', $8, $9)
        RETURNING *
    `, [
        businessContext,
        type,
        amount,
        overrides.description || `Табличний звіт: ${normalized.table.title}`,
        category,
        req.user?.displayName || req.user?.name || currentUsername(req),
        currentUserId(req),
        JSON.stringify(rawData),
        JSON.stringify(hashtags)
    ]);

    return assignOnDutyAccountant(mapReportRow(result.rows[0]));
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function mapReportRow(r) {
    const rawData = parseRawData(r.raw_data);
    return {
        id: r.id,
        businessContext: normalizeBusinessContext(r.business_context || DEFAULT_BUSINESS_CONTEXT),
        type: r.type,
        amount: parseFloat(r.amount) || 0,
        description: r.description,
        category: r.category,
        submittedBy: r.submitted_by,
        submittedById: r.submitted_by_id,
        submittedVia: r.submitted_via,
        photoUrl: r.photo_url,
        ocrText: r.ocr_text,
        voiceTranscript: r.voice_transcript,
        rawData,
        lifecycleStatus: reportLifecycleStatus(r),
        closedAt: r.closed_at || rawData.reportTableTemplate?.lifecycle?.closedAt || null,
        closedByUserId: r.closed_by_user_id || rawData.reportTableTemplate?.lifecycle?.closedByUserId || null,
        closedByUsername: r.closed_by_username || rawData.reportTableTemplate?.lifecycle?.closedBy || null,
        lockedSnapshot: parseRawData(r.locked_snapshot),
        status: r.status,
        assignedTo: r.assigned_to,
        assignedAt: r.assigned_at,
        processedAt: r.processed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hashtags: parseHashtags(r.hashtags),
        hashtagActive: r.hashtag_active !== false && r.hashtag_active !== 0,
        // joined fields
        accountantName: r.accountant_name || null,
        approvalStatus: normalizeApprovalStatus(r.approval_status),
        approvalTaskId: r.approval_task_id || null,
        approvalTaskStatus: r.approval_task_status || null,
        approvalAssigneeUserId: r.approval_assignee_user_id || null,
        approvalAssigneeName: r.approval_assignee_name || null,
        approvalRequestedAt: r.approval_requested_at || null,
        approvalReviewedAt: r.approval_reviewed_at || null,
        approvalReviewedByUserId: r.approval_reviewed_by_user_id || null,
        approvalReviewedByUsername: r.approval_reviewed_by_username || null,
        approvalComment: r.approval_comment || null
    };
}

function mapAccountantRow(r) {
    return {
        id: r.id,
        name: r.name,
        chatId: r.chat_id,
        schedule: r.schedule,
        isOnDuty: r.is_on_duty,
        phone: r.phone,
        staffId: r.staff_id,
        createdAt: r.created_at
    };
}

async function loadReportRow(id, scopeOrContext = DEFAULT_BUSINESS_CONTEXT) {
    const params = [id];
    const businessSql = scopeOrContext && typeof scopeOrContext === 'object'
        ? reportScopeCondition(params, scopeOrContext, 'r')
        : pushBusinessContextCondition(params, scopeOrContext || DEFAULT_BUSINESS_CONTEXT, 'r');
    const result = await pool.query(`
        SELECT r.*, a.name AS accountant_name, t.status AS approval_task_status
        FROM reports r
        LEFT JOIN accountants a ON a.id = r.assigned_to
        LEFT JOIN tasks t ON t.id = r.approval_task_id
        WHERE r.id = $1
          AND ${businessSql}
    `, params);
    return result.rows[0] || null;
}

async function loadReportPayload(id, scopeOrContext = DEFAULT_BUSINESS_CONTEXT) {
    const row = await loadReportRow(id, scopeOrContext);
    return row ? mapReportRow(row) : null;
}

async function completeApprovalTask(taskId, actor) {
    if (!taskId) return null;
    try {
        return await getKleshnya().updateTaskStatus(taskId, 'done', actor);
    } catch (err) {
        log.warn('Report approval task status update skipped', { taskId, error: err.message });
        return null;
    }
}

function updateReportApprovalFromStatus(status, updates, params, req) {
    if (status === 'processing') {
        updates.push(`approval_status = CASE WHEN approval_status IN ('none', 'pending', 'task_created') THEN 'in_review' ELSE approval_status END`);
    }
    if (status === 'done' || status === 'rejected') {
        const approvalStatus = status === 'done' ? 'approved' : 'rejected';
        params.push(approvalStatus);
        updates.push(`approval_status = $${params.length}`);
        updates.push(`approval_reviewed_at = COALESCE(approval_reviewed_at, NOW())`);
        params.push(currentUserId(req));
        updates.push(`approval_reviewed_by_user_id = COALESCE(approval_reviewed_by_user_id, $${params.length})`);
        params.push(currentUsername(req));
        updates.push(`approval_reviewed_by_username = COALESCE(approval_reviewed_by_username, $${params.length})`);
    }
}

function scheduleFinanceTransactionForReport(report, req) {
    if (!report || Number(report.amount || 0) <= 0) return;
    const reportId = report.id;
    const businessContext = normalizeBusinessContext(report.businessContext || report.business_context || currentReportBusinessContext(req));
    setImmediate(async () => {
        try {
            const exists = await pool.query(
                `SELECT id FROM finance_transactions
                 WHERE description LIKE $1
                   AND COALESCE(business_context, $2) = $2
                 LIMIT 1`,
                [`%#${reportId}%`, businessContext]
            );
            if (exists.rowCount) return;

            const finType = report.type === 'expense' ? 'expense' : 'income';
            const categoryName = report.category || 'Інше';
            const catQuery = await pool.query(
                `SELECT id FROM finance_categories
                 WHERE name ILIKE $1
                   AND type = $2
                   AND COALESCE(business_context, $3) = $3
                 LIMIT 1`,
                [`%${categoryName}%`, finType, businessContext]
            );
            const catId = catQuery.rows[0]?.id || null;

            await pool.query(
                `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    businessContext,
                    finType,
                    catId,
                    Math.round(Number(report.amount || 0)),
                    `${report.description || 'Звіт'} (звіт #${reportId})`,
                    report.created_at ? new Date(report.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                    'report',
                    report.submitted_by || req.user?.username || 'system'
                ]
            );
        } catch (err) {
            log.warn(`[ReportFinance] Error: ${err.message}`);
        }
    });
}

// ==========================================
// GET /api/reports — list with filters
// ==========================================
router.get('/', async (req, res) => {
    try {
        const businessScope = ensureReportBusinessScope(req, res);
        if (!businessScope) return;
        const { type, status, submittedBy, category, hashtag, dateFrom, dateTo, limit = 100, offset = 0 } = req.query;

        function buildWhere(params) {
            let where = ` AND ${reportScopeCondition(params, businessScope, 'r')}`;
            if (type && ['income', 'expense'].includes(type)) {
                params.push(type);
                where += ` AND r.type = $${params.length}`;
            }
            if (status) {
                params.push(status);
                where += ` AND r.status = $${params.length}`;
            }
            if (submittedBy) {
                params.push(`%${submittedBy}%`);
                where += ` AND r.submitted_by ILIKE $${params.length}`;
            }
            if (category) {
                params.push(category);
                where += ` AND r.category = $${params.length}`;
            }
            if (hashtag) {
                params.push(JSON.stringify([hashtag]));
                where += ` AND r.hashtags @> $${params.length}::jsonb`;
            }
            if (dateFrom) {
                params.push(dateFrom);
                where += ` AND r.created_at >= $${params.length}::date`;
            }
            if (dateTo) {
                params.push(dateTo);
                where += ` AND r.created_at < ($${params.length}::date + interval '1 day')`;
            }
            return where;
        }

        const params = [];
        let sql = `
            SELECT r.*, a.name AS accountant_name, t.status AS approval_task_status
            FROM reports r
            LEFT JOIN accountants a ON a.id = r.assigned_to
            LEFT JOIN tasks t ON t.id = r.approval_task_id
            WHERE 1=1
        `;
        sql += buildWhere(params);
        sql += ` ORDER BY r.created_at DESC`;
        params.push(parseInt(limit));
        sql += ` LIMIT $${params.length}`;
        params.push(parseInt(offset));
        sql += ` OFFSET $${params.length}`;

        const result = await pool.query(sql, params);

        const countParams = [];
        let countSql = `SELECT COUNT(*) FROM reports r WHERE 1=1`;
        countSql += buildWhere(countParams);
        const countResult = await pool.query(countSql, countParams);

        res.json({
            reports: result.rows.map(mapReportRow),
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        log.error('GET /reports error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/summary — aggregated data for dashboard/charts
// ==========================================
router.get('/summary', async (req, res) => {
    try {
        const businessScope = ensureReportBusinessScope(req, res);
        if (!businessScope) return;
        const { period = 'month', dateFrom, dateTo } = req.query;
        let fromDate, toDate;

        if (dateFrom && dateTo) {
            fromDate = dateFrom;
            toDate = dateTo;
        } else {
            const now = new Date();
            if (period === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                fromDate = weekAgo.toISOString().slice(0, 10);
            } else if (period === 'year') {
                fromDate = `${now.getFullYear()}-01-01`;
            } else {
                fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            }
            toDate = now.toISOString().slice(0, 10);
        }

        function reportSummaryParams(...values) {
            const params = [...values];
            const scopeSql = reportScopeCondition(params, businessScope, '');
            return { params, scopeSql };
        }

        // Totals (only hashtag_active reports)
        const totalQuery = reportSummaryParams(fromDate, toDate);
        const totalsResult = await pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
              AND hashtag_active IS NOT FALSE
              AND ${totalQuery.scopeSql}
            GROUP BY type
        `, totalQuery.params);

        const income = totalsResult.rows.find(r => r.type === 'income');
        const expense = totalsResult.rows.find(r => r.type === 'expense');

        // By day (for line chart)
        const dailyQuery = reportSummaryParams(fromDate, toDate);
        const dailyResult = await pool.query(`
            SELECT
                created_at::date AS day,
                type,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
              AND hashtag_active IS NOT FALSE
              AND ${dailyQuery.scopeSql}
            GROUP BY day, type
            ORDER BY day
        `, dailyQuery.params);

        // By category (for pie chart)
        const categoryQuery = reportSummaryParams(fromDate, toDate);
        const categoryResult = await pool.query(`
            SELECT
                COALESCE(category, 'Інше') AS category,
                type,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
              AND hashtag_active IS NOT FALSE
              AND ${categoryQuery.scopeSql}
            GROUP BY category, type
            ORDER BY total DESC
        `, categoryQuery.params);

        // Status counts
        const statusQuery = reportSummaryParams(fromDate, toDate);
        const statusResult = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
              AND hashtag_active IS NOT FALSE
              AND ${statusQuery.scopeSql}
            GROUP BY status
        `, statusQuery.params);

        // Today's stats
        const today = new Date().toISOString().slice(0, 10);
        const todayQuery = reportSummaryParams(today);
        const todayResult = await pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at::date = $1::date
              AND hashtag_active IS NOT FALSE
              AND ${todayQuery.scopeSql}
            GROUP BY type
        `, todayQuery.params);

        const todayIncome = todayResult.rows.find(r => r.type === 'income');
        const todayExpense = todayResult.rows.find(r => r.type === 'expense');

        res.json({
            period: { from: fromDate, to: toDate },
            totals: {
                income: parseFloat(income?.total || 0),
                incomeCount: parseInt(income?.count || 0),
                expense: parseFloat(expense?.total || 0),
                expenseCount: parseInt(expense?.count || 0),
                profit: parseFloat((income?.total || 0) - (expense?.total || 0))
            },
            today: {
                income: parseFloat(todayIncome?.total || 0),
                expense: parseFloat(todayExpense?.total || 0),
                newReports: parseInt((todayIncome?.count || 0)) + parseInt((todayExpense?.count || 0))
            },
            daily: dailyResult.rows.map(r => ({
                day: r.day,
                type: r.type,
                total: parseFloat(r.total)
            })),
            categories: categoryResult.rows.map(r => ({
                category: r.category,
                type: r.type,
                total: parseFloat(r.total)
            })),
            statuses: statusResult.rows.reduce((acc, r) => {
                acc[r.status] = parseInt(r.count);
                return acc;
            }, {})
        });
    } catch (err) {
        log.error('GET /reports/summary error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/accountants — list accountants
// ==========================================
router.get('/accountants', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM accountants ORDER BY is_on_duty DESC, name');
        res.json(result.rows.map(mapAccountantRow));
    } catch (err) {
        log.error('GET /accountants error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/hashtags — hashtag stats
// ==========================================
router.get('/hashtags', async (req, res) => {
    try {
        const businessScope = ensureReportBusinessScope(req, res);
        if (!businessScope) return;
        const params = [];
        const scopeSql = reportScopeCondition(params, businessScope, '');
        const result = await pool.query(
            `SELECT hashtags, amount, hashtag_active, type
             FROM reports
             WHERE status IN ('done', 'new', 'processing')
               AND ${scopeSql}`,
            params
        );

        const stats = {};
        for (const row of result.rows) {
            const tags = parseHashtags(row.hashtags);
            for (const tag of tags) {
                if (!stats[tag]) stats[tag] = { hashtag: tag, total: 0, count: 0, activeCount: 0, inactiveCount: 0 };
                const isActive = row.hashtag_active !== false && row.hashtag_active !== 0;
                stats[tag].count += 1;
                if (isActive) {
                    stats[tag].total += parseFloat(row.amount) || 0;
                    stats[tag].activeCount += 1;
                } else {
                    stats[tag].inactiveCount += 1;
                }
            }
        }

        res.json(Object.values(stats).sort((a, b) => b.total - a.total));
    } catch (err) {
        log.error('GET /reports/hashtags error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PATCH /api/reports/hashtags/toggle — bulk toggle hashtagActive for all reports with a given hashtag
// ==========================================
router.patch('/hashtags/toggle', async (req, res) => {
    try {
        const { hashtag, active } = req.body;
        if (!hashtag || typeof hashtag !== 'string') {
            return res.status(400).json({ error: 'hashtag (string) required' });
        }
        const isActive = active !== false && active !== 0;
        const params = [isActive, JSON.stringify([hashtag])];
        const scopeSql = reportContextCondition(params, req, '');
        const result = await pool.query(
            `UPDATE reports SET hashtag_active = $1, updated_at = NOW()
             WHERE hashtags @> $2::jsonb
               AND ${scopeSql}
             RETURNING id`,
            params
        );
        log.info(`Hashtag toggle: #${hashtag} → ${isActive ? 'ON' : 'OFF'} (${result.rowCount} reports)`);
        res.json({ updated: result.rowCount, active: isActive });
    } catch (err) {
        log.error('PATCH /reports/hashtags/toggle error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// TEMPLATE REGISTRY — durable report table schemas
// ==========================================
router.get('/templates', async (req, res) => {
    try {
        const username = currentUsername(req);
        const businessContext = currentReportBusinessContext(req);
        const result = await pool.query(`
            SELECT *
            FROM report_templates
            WHERE is_active = true
              AND (
                  (source = 'system' AND scope = 'global')
                  OR (
                      COALESCE(business_context, $2) = $2
                      AND (scope = 'global' OR created_by_username = $1)
                  )
              )
            ORDER BY CASE WHEN source = 'system' THEN 0 ELSE 1 END, category, title
        `, [username, businessContext]);
        res.json({ success: true, templates: result.rows.map(mapTemplateRow), canManage: canManageReportTemplates(req) });
    } catch (err) {
        log.error('GET /reports/templates error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/templates', async (req, res) => {
    try {
        const body = sanitizeTemplateBody(req.body || {}, req);
        const result = await pool.query(`
            INSERT INTO report_templates (
                code, title, category, layout, description, purpose, schema_json,
                default_report_json, source, scope, business_context, created_by_user_id, created_by_username
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (code) DO UPDATE SET
                title = EXCLUDED.title,
                category = EXCLUDED.category,
                layout = EXCLUDED.layout,
                description = EXCLUDED.description,
                purpose = EXCLUDED.purpose,
                schema_json = EXCLUDED.schema_json,
                default_report_json = EXCLUDED.default_report_json,
                source = EXCLUDED.source,
                scope = EXCLUDED.scope,
                business_context = EXCLUDED.business_context,
                is_active = true,
                updated_at = NOW()
            RETURNING *
        `, [
            body.code,
            body.title,
            body.category,
            body.layout,
            body.description,
            body.purpose,
            JSON.stringify(body.schemaJson),
            JSON.stringify(body.defaultReportJson),
            body.source,
            body.scope,
            body.businessContext,
            currentUserId(req),
            currentUsername(req)
        ]);
        res.status(201).json({ success: true, template: mapTemplateRow(result.rows[0]) });
    } catch (err) {
        log.error('POST /reports/templates error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.put('/templates/:id', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const existing = await pool.query(
            `SELECT * FROM report_templates
             WHERE id = $1
               AND (source = 'system' OR COALESCE(business_context, $2) = $2)`,
            [req.params.id, businessContext]
        );
        if (!existing.rows.length) return res.status(404).json({ error: 'Template not found' });
        const row = existing.rows[0];
        const ownsTemplate = row.created_by_username === currentUsername(req);
        if (row.source === 'system' || (!ownsTemplate && !canManageReportTemplates(req))) {
            return res.status(403).json({ error: 'Not allowed to edit this template' });
        }
        const body = sanitizeTemplateBody(req.body || {}, req, row);
        const result = await pool.query(`
            UPDATE report_templates SET
                title = $1,
                category = $2,
                layout = $3,
                description = $4,
                purpose = $5,
                schema_json = $6,
                default_report_json = $7,
                scope = $8,
                business_context = $9,
                updated_at = NOW()
            WHERE id = $10
            RETURNING *
        `, [
            body.title,
            body.category,
            body.layout,
            body.description,
            body.purpose,
            JSON.stringify(body.schemaJson),
            JSON.stringify(body.defaultReportJson),
            body.scope,
            body.businessContext,
            req.params.id
        ]);
        res.json({ success: true, template: mapTemplateRow(result.rows[0]) });
    } catch (err) {
        log.error('PUT /reports/templates/:id error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.delete('/templates/:id', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const existing = await pool.query(
            `SELECT * FROM report_templates
             WHERE id = $1
               AND (source = 'system' OR COALESCE(business_context, $2) = $2)`,
            [req.params.id, businessContext]
        );
        if (!existing.rows.length) return res.status(404).json({ error: 'Template not found' });
        const row = existing.rows[0];
        const ownsTemplate = row.created_by_username === currentUsername(req);
        if (row.source === 'system' || (!ownsTemplate && !canManageReportTemplates(req))) {
            return res.status(403).json({ error: 'Not allowed to delete this template' });
        }
        await pool.query('UPDATE report_templates SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
        res.json({ success: true, id: parseInt(req.params.id, 10) });
    } catch (err) {
        log.error('DELETE /reports/templates/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// TABLE DRAFTS — save/reopen template report work
// ==========================================
router.get('/drafts', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const result = await pool.query(`
            SELECT d.*, t.title AS template_title
            FROM report_table_drafts d
            LEFT JOIN report_templates t ON t.id = d.template_id
            WHERE d.created_by_username = $1
              AND COALESCE(d.business_context, $2) = $2
              AND d.status = 'draft'
            ORDER BY d.updated_at DESC
            LIMIT 100
        `, [currentUsername(req), businessContext]);
        res.json({ success: true, drafts: result.rows.map(mapDraftRow) });
    } catch (err) {
        log.error('GET /reports/drafts error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/drafts', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const normalized = normalizeTablePayload(req.body.tableJson || req.body.rawData || req.body);
        const title = String(req.body.title || normalized.table.title || 'Чернетка звіту').trim();
        const result = await pool.query(`
            INSERT INTO report_table_drafts (
                business_context, template_id, title, table_json, created_by_user_id, created_by_username
            )
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *
        `, [
            businessContext,
            optionalInteger(req.body.templateId || normalized.table.templateId),
            title,
            JSON.stringify(normalized.payload.reportTableTemplate ? normalized.payload : { reportTableTemplate: normalized.table }),
            currentUserId(req),
            currentUsername(req)
        ]);
        res.status(201).json({ success: true, draft: mapDraftRow(result.rows[0]) });
    } catch (err) {
        log.error('POST /reports/drafts error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.put('/drafts/:id', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const normalized = normalizeTablePayload(req.body.tableJson || req.body.rawData || req.body);
        const title = String(req.body.title || normalized.table.title || 'Чернетка звіту').trim();
        const result = await pool.query(`
            UPDATE report_table_drafts SET
                template_id = $1,
                title = $2,
                table_json = $3,
                updated_at = NOW()
            WHERE id = $4 AND created_by_username = $5 AND status = 'draft'
              AND COALESCE(business_context, $6) = $6
            RETURNING *
        `, [
            optionalInteger(req.body.templateId || normalized.table.templateId),
            title,
            JSON.stringify(normalized.payload.reportTableTemplate ? normalized.payload : { reportTableTemplate: normalized.table }),
            req.params.id,
            currentUsername(req),
            businessContext
        ]);
        if (!result.rows.length) return res.status(404).json({ error: 'Draft not found' });
        res.json({ success: true, draft: mapDraftRow(result.rows[0]) });
    } catch (err) {
        log.error('PUT /reports/drafts/:id error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.delete('/drafts/:id', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const result = await pool.query(
            "DELETE FROM report_table_drafts WHERE id = $1 AND created_by_username = $2 AND status = 'draft' AND COALESCE(business_context, $3) = $3 RETURNING id",
            [req.params.id, currentUsername(req), businessContext]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Draft not found' });
        res.json({ success: true, id: parseInt(req.params.id, 10) });
    } catch (err) {
        log.error('DELETE /reports/drafts/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/drafts/:id/submit', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const draftResult = await pool.query(
            "SELECT * FROM report_table_drafts WHERE id = $1 AND created_by_username = $2 AND status = 'draft' AND COALESCE(business_context, $3) = $3",
            [req.params.id, currentUsername(req), businessContext]
        );
        if (!draftResult.rows.length) return res.status(404).json({ error: 'Draft not found' });
        const report = await createReportFromTablePayload(req, draftResult.rows[0].table_json, req.body || {});
        const updated = await pool.query(`
            UPDATE report_table_drafts
            SET status = 'submitted', report_id = $1, submitted_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND COALESCE(business_context, $3) = $3
            RETURNING *
        `, [report.id, req.params.id, businessContext]);
        res.status(201).json({ success: true, draft: mapDraftRow(updated.rows[0]), report });
    } catch (err) {
        log.error('POST /reports/drafts/:id/submit error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

// ==========================================
// TABLE EXPORTS — current editable table payload
// ==========================================
// ==========================================
// TABLE CLOSE FLOW - immutable handoff to accountant queue
// ==========================================
router.post('/table/close', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const closedAt = new Date().toISOString();
        const { table, lockedPayload } = buildClosedTablePayload(req.body.tableJson || req.body.rawData || req.body, req, closedAt);
        const defaultReport = table.defaultReport || parseRawData(req.body.defaultReport || {});
        const type = defaultReport.type === 'income' ? 'income' : 'expense';
        const amount = req.body.amount !== undefined
            ? numericValue(req.body.amount)
            : calculateTableAmount(table, defaultReport);
        const category = req.body.category || defaultReport.category || table.category || 'Інше';
        const description = req.body.description || `Табличний звіт: ${table.title}`;
        const hashtags = sanitizeHashtags(req.body.hashtags || [defaultReport.hashtag || 'table-report']);
        const reportId = optionalInteger(req.body.reportId);
        const draftId = optionalInteger(req.body.draftId);

        let row;
        if (reportId) {
            const existingParams = [reportId];
            const existingScopeSql = reportContextCondition(existingParams, req, '');
            const existing = await pool.query(`SELECT * FROM reports WHERE id = $1 AND ${existingScopeSql}`, existingParams);
            if (!existing.rows.length) return res.status(404).json({ error: 'Report not found' });
            if (isReportLifecycleClosed(existing.rows[0])) {
                return res.status(409).json({ error: 'Report already closed' });
            }
            const result = await pool.query(`
                UPDATE reports SET
                    type = $1,
                    amount = $2,
                    description = $3,
                    category = $4,
                    raw_data = $5,
                    hashtags = $6,
                    status = 'new',
                    processed_at = NULL,
                    report_lifecycle_status = 'closed',
                    closed_at = $7,
                    closed_by_user_id = $8,
                    closed_by_username = $9,
                    locked_snapshot = $5,
                    updated_at = NOW()
                WHERE id = $10
                  AND COALESCE(business_context, $11) = $11
                RETURNING *
            `, [
                type,
                amount,
                description,
                category,
                JSON.stringify(lockedPayload),
                JSON.stringify(hashtags),
                closedAt,
                currentUserId(req),
                currentUsername(req),
                reportId,
                businessContext
            ]);
            row = result.rows[0];
        } else {
            const result = await pool.query(`
                INSERT INTO reports (
                    business_context, type, amount, description, category, submitted_by, submitted_by_id,
                    submitted_via, raw_data, hashtags, status, report_lifecycle_status,
                    closed_at, closed_by_user_id, closed_by_username, locked_snapshot
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,'web-template',$8,$9,'new','closed',$10,$11,$12,$8)
                RETURNING *
            `, [
                businessContext,
                type,
                amount,
                description,
                category,
                req.user?.displayName || req.user?.name || currentUsername(req),
                currentUserId(req),
                JSON.stringify(lockedPayload),
                JSON.stringify(hashtags),
                closedAt,
                currentUserId(req),
                currentUsername(req)
            ]);
            row = result.rows[0];
        }

        let report = await assignOnDutyAccountant(mapReportRow(row));

        if (draftId) {
            await pool.query(`
                UPDATE report_table_drafts SET
                    status = 'closed',
                    report_id = $1,
                    submitted_at = COALESCE(submitted_at, NOW()),
                    closed_at = $2,
                    closed_by_user_id = $3,
                    closed_by_username = $4,
                    locked_snapshot = $5,
                    updated_at = NOW()
                WHERE id = $6 AND created_by_username = $7 AND status = 'draft'
                  AND COALESCE(business_context, $8) = $8
            `, [
                report.id,
                closedAt,
                currentUserId(req),
                currentUsername(req),
                JSON.stringify(lockedPayload),
                draftId,
                currentUsername(req),
                businessContext
            ]);
        }

        report = {
            ...report,
            lifecycleStatus: 'closed',
            closedAt,
            closedByUserId: currentUserId(req),
            closedByUsername: currentUsername(req),
            lockedSnapshot: lockedPayload
        };
        const handoffTask = await createReportHandoffTask(report, req);
        if (handoffTask?.id) {
            report.handoffTaskId = handoffTask.id;
            report.approvalTaskId = handoffTask.id;
            report.approvalStatus = 'task_created';
            report.approvalTaskStatus = handoffTask.status || null;
            report.approvalAssigneeName = handoffTask.assigned_to || handoffTask.owner || report.approvalAssigneeName || null;
            report.handoffDuplicateSkipped = Boolean(handoffTask.duplicateSkipped);
        }
        res.status(reportId ? 200 : 201).json({ success: true, report });
    } catch (err) {
        log.error('POST /reports/table/close error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

// ==========================================
// TABLE EXPORTS - current table payload or locked snapshot
// ==========================================
router.post('/table/export-csv', async (req, res) => {
    try {
        const { table } = normalizeTablePayload(req.body);
        const header = table.columns.map(col => csvCell(col.label || col.key)).join(';');
        const rows = table.rows.map(row => table.columns.map(col => csvCell(row?.[col.key])).join(';'));
        const csv = '\uFEFF' + [header, ...rows, ...summaryCsvRows(table)].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${String(table.title || 'report').replace(/[^\w-]+/g, '_')}.csv"`);
        res.send(csv);
    } catch (err) {
        log.error('POST /reports/table/export-csv error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.post('/table/export-xlsx', async (req, res) => {
    try {
        const { table } = normalizeTablePayload(req.body);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Event Genix';
        const sheet = workbook.addWorksheet('Звіт');
        sheet.columns = table.columns.map(col => ({
            header: col.label || col.key,
            key: col.key,
            width: Math.max(12, Math.min(32, String(col.label || col.key).length + 8))
        }));
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        for (const row of table.rows) {
            const output = {};
            table.columns.forEach(col => {
                output[col.key] = col.type === 'number' ? numericValue(row?.[col.key]) : (row?.[col.key] || '');
            });
            sheet.addRow(output);
        }
        const summaryRows = tableSummaryRows(table);
        if (summaryRows.length) {
            for (const item of summaryRows) {
                const totalRow = {};
                table.columns.forEach((col, index) => {
                    if (index === 0) totalRow[col.key] = item.label;
                    else if (col.key === item.amountColumn) totalRow[col.key] = item.amount;
                    else totalRow[col.key] = '';
                });
                const row = sheet.addRow(totalRow);
                row.font = { bold: true };
            }
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${String(table.title || 'report').replace(/[^\w-]+/g, '_')}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        log.error('POST /reports/table/export-xlsx error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

// ==========================================
// GET /api/reports/:id — single report
// ==========================================
// ==========================================
// REPORT APPROVAL WORKFLOW - task-backed accountant review
// ==========================================
router.get('/workflow-settings', async (req, res) => {
    try {
        res.json(await getReportWorkflowSettings(req));
    } catch (err) {
        log.error('GET /reports/workflow-settings error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.put('/workflow-settings', async (req, res) => {
    try {
        res.json(await saveReportWorkflowSettings(req, req.body || {}));
    } catch (err) {
        log.error('PUT /reports/workflow-settings error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
    }
});

router.post('/:id/request-approval', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const report = await loadReportPayload(req.params.id, businessContext);
        if (!report) return res.status(404).json({ error: 'Report not found' });
        const task = await createReportHandoffTask(report, req);
        const updated = await loadReportPayload(req.params.id, businessContext);
        res.json({ report: updated, taskId: task?.id || updated?.approvalTaskId || null, duplicateSkipped: Boolean(task?.duplicateSkipped) });
    } catch (err) {
        log.error('POST /reports/:id/request-approval error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/:id/in-review', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const existing = await loadReportRow(req.params.id, businessContext);
        if (!existing) return res.status(404).json({ error: 'Report not found' });
        const result = await pool.query(
            `UPDATE reports
             SET status = CASE WHEN status = 'new' THEN 'processing' ELSE status END,
                 approval_status = CASE WHEN approval_status IN ('none', 'pending', 'task_created') THEN 'in_review' ELSE approval_status END,
                 updated_at = NOW()
             WHERE id = $1
               AND COALESCE(business_context, $2) = $2
             RETURNING *`,
            [req.params.id, businessContext]
        );
        if (existing.approval_task_id) {
            getKleshnya().updateTaskStatus(existing.approval_task_id, 'in_progress', currentUsername(req)).catch(err => {
                log.warn('Report approval task in-progress update skipped', { taskId: existing.approval_task_id, error: err.message });
            });
        }
        res.json(mapReportRow({ ...result.rows[0], accountant_name: existing.accountant_name, approval_task_status: existing.approval_task_status }));
    } catch (err) {
        log.error('POST /reports/:id/in-review error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/:id/approve', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const existing = await loadReportRow(req.params.id, businessContext);
        if (!existing) return res.status(404).json({ error: 'Report not found' });
        const comment = String(req.body?.comment || '').trim().slice(0, 2000);
        const result = await pool.query(
            `UPDATE reports
             SET status = 'done',
                 processed_at = NOW(),
                 approval_status = 'approved',
                 approval_reviewed_at = NOW(),
                 approval_reviewed_by_user_id = $2,
                 approval_reviewed_by_username = $3,
                 approval_comment = NULLIF($4, ''),
                 updated_at = NOW()
             WHERE id = $1
               AND COALESCE(business_context, $5) = $5
             RETURNING *`,
            [req.params.id, currentUserId(req), currentUsername(req), comment, businessContext]
        );
        await completeApprovalTask(existing.approval_task_id, currentUsername(req));
        scheduleFinanceTransactionForReport(result.rows[0], req);
        res.json(mapReportRow({ ...result.rows[0], accountant_name: existing.accountant_name, approval_task_status: 'done' }));
    } catch (err) {
        log.error('POST /reports/:id/approve error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/:id/reject', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const existing = await loadReportRow(req.params.id, businessContext);
        if (!existing) return res.status(404).json({ error: 'Report not found' });
        const comment = String(req.body?.comment || '').trim().slice(0, 2000);
        const result = await pool.query(
            `UPDATE reports
             SET status = 'rejected',
                 approval_status = 'rejected',
                 approval_reviewed_at = NOW(),
                 approval_reviewed_by_user_id = $2,
                 approval_reviewed_by_username = $3,
                 approval_comment = NULLIF($4, ''),
                 updated_at = NOW()
             WHERE id = $1
               AND COALESCE(business_context, $5) = $5
             RETURNING *`,
            [req.params.id, currentUserId(req), currentUsername(req), comment, businessContext]
        );
        await completeApprovalTask(existing.approval_task_id, currentUsername(req));
        res.json(mapReportRow({ ...result.rows[0], accountant_name: existing.accountant_name, approval_task_status: 'done' }));
    } catch (err) {
        log.error('POST /reports/:id/reject error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const businessScope = ensureReportBusinessScope(req, res);
        if (!businessScope) return;
        const report = await loadReportPayload(id, businessScope);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json(report);
    } catch (err) {
        log.error('GET /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// POST /api/reports — create report
// ==========================================
router.post('/', async (req, res) => {
    try {
        const businessContext = currentReportBusinessContext(req);
        const {
            type, amount, description, category, hashtags,
            submittedBy, submittedById, submittedVia = 'web',
            photoUrl, ocrText, voiceTranscript, rawData
        } = req.body;
        const safeSubmittedVia = sanitizeSubmittedVia(submittedVia);

        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type (income/expense)' });
        }

        const result = await pool.query(`
            INSERT INTO reports (business_context, type, amount, description, category, submitted_by, submitted_by_id,
                submitted_via, photo_url, ocr_text, voice_transcript, raw_data, hashtags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            businessContext,
            type,
            parseFloat(amount) || 0,
            description || null,
            category || null,
            submittedBy || req.user?.displayName || 'Unknown',
            submittedById || req.user?.id || null,
            safeSubmittedVia,
            photoUrl || null,
            ocrText || null,
            voiceTranscript || null,
            rawData ? JSON.stringify(normalizeReportRawPayload(rawData)) : '{}',
            JSON.stringify(sanitizeHashtags(hashtags || []))
        ]);

        const report = mapReportRow(result.rows[0]);

        await assignOnDutyAccountant(report);

        log.info(`Report #${report.id} created: ${type} ${amount} by ${report.submittedBy}`);
        res.status(201).json(report);
    } catch (err) {
        log.error('POST /reports error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PUT /api/reports/:id — update report
// ==========================================
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const businessContext = currentReportBusinessContext(req);
        const {
            type, amount, description, category,
            status, photoUrl, ocrText,
            hashtags, hashtagActive, rawData
        } = req.body;

        const existing = await pool.query(
            'SELECT * FROM reports WHERE id = $1 AND COALESCE(business_context, $2) = $2',
            [id, businessContext]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        const contentMutationRequested = [
            type,
            amount,
            description,
            category,
            photoUrl,
            ocrText,
            hashtags,
            rawData
        ].some(value => value !== undefined);
        if (isReportLifecycleClosed(existing.rows[0]) && contentMutationRequested) {
            return res.status(423).json({ error: 'Closed report is locked for editing' });
        }

        const updates = [];
        const params = [];

        if (type) { params.push(type); updates.push(`type = $${params.length}`); }
        if (amount !== undefined) { params.push(parseFloat(amount)); updates.push(`amount = $${params.length}`); }
        if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
        if (category !== undefined) { params.push(category); updates.push(`category = $${params.length}`); }
        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
            if (status === 'done') updates.push(`processed_at = NOW()`);
            updateReportApprovalFromStatus(status, updates, params, req);
        }
        if (photoUrl !== undefined) { params.push(photoUrl); updates.push(`photo_url = $${params.length}`); }
        if (ocrText !== undefined) { params.push(ocrText); updates.push(`ocr_text = $${params.length}`); }
        if (hashtags !== undefined) { params.push(JSON.stringify(sanitizeHashtags(hashtags))); updates.push(`hashtags = $${params.length}`); }
        if (hashtagActive !== undefined) { params.push(!!hashtagActive); updates.push(`hashtag_active = $${params.length}`); }
        if (rawData !== undefined) { params.push(JSON.stringify(normalizeReportRawPayload(rawData || {}))); updates.push(`raw_data = $${params.length}`); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        params.push(id);
        const idParam = params.length;
        params.push(businessContext);

        const result = await pool.query(`
            UPDATE reports SET ${updates.join(', ')}
            WHERE id = $${idParam}
              AND COALESCE(business_context, $${params.length}) = $${params.length}
            RETURNING *
        `, params);

        const updatedReport = result.rows[0];
        if ((status === 'done' || status === 'rejected') && updatedReport.approval_task_id) {
            completeApprovalTask(updatedReport.approval_task_id, currentUsername(req)).catch(() => {});
        }

        // v33.8.0: When report is marked as done, create finance transaction (fire-and-forget)
        if (status === 'done' && updatedReport.amount > 0) {
            setImmediate(async () => {
                try {
                    // Check if already recorded
                    const exists = await pool.query(
                        `SELECT id FROM finance_transactions
                         WHERE description LIKE $1
                           AND COALESCE(business_context, $2) = $2
                         LIMIT 1`,
                        [`%звіт #${id}%`, businessContext]
                    );
                    if (exists.rowCount) return;

                    const finType = updatedReport.type === 'expense' ? 'expense' : 'income';
                    const catQuery = await pool.query(
                        `SELECT id FROM finance_categories
                         WHERE name ILIKE $1
                           AND type = $2
                           AND COALESCE(business_context, $3) = $3
                         LIMIT 1`,
                        [`%${updatedReport.category || 'Інше'}%`, finType, businessContext]
                    );
                    const catId = catQuery.rows[0]?.id || null;

                    await pool.query(
                        `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [businessContext, finType, catId, Math.round(updatedReport.amount),
                         `${updatedReport.description || 'Звіт'} (звіт #${id})`,
                         updatedReport.created_at ? new Date(updatedReport.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                         'report', updatedReport.submitted_by || req.user?.username || 'system']
                    );
                    log.info(`[ReportFinance] Report #${id} → finance transaction (${finType} ${updatedReport.amount})`);
                } catch (e) {
                    log.warn(`[ReportFinance] Error: ${e.message}`);
                }
            });
        }

        res.json(mapReportRow(updatedReport));
    } catch (err) {
        log.error('PUT /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// DELETE /api/reports/:id
// ==========================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const businessContext = currentReportBusinessContext(req);
        const existing = await pool.query(
            'SELECT * FROM reports WHERE id = $1 AND COALESCE(business_context, $2) = $2',
            [id, businessContext]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        if (isReportLifecycleClosed(existing.rows[0])) {
            return res.status(423).json({ error: 'Closed report is locked for deletion' });
        }
        const result = await pool.query(
            'DELETE FROM reports WHERE id = $1 AND COALESCE(business_context, $2) = $2 RETURNING id',
            [id, businessContext]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json({ success: true, id: parseInt(id) });
    } catch (err) {
        log.error('DELETE /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// POST /api/reports/:id/assign — assign to accountant
// ==========================================
router.post('/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { accountantId } = req.body;
        const businessContext = currentReportBusinessContext(req);

        if (!accountantId) {
            return res.status(400).json({ error: 'accountantId required' });
        }

        const result = await pool.query(`
            UPDATE reports SET assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
            WHERE id = $2
              AND COALESCE(business_context, $3) = $3
            RETURNING *
        `, [accountantId, id, businessContext]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        res.json(mapReportRow(result.rows[0]));
    } catch (err) {
        log.error('POST /reports/:id/assign error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PUT /api/reports/accountants/:id — update accountant
// ==========================================
router.put('/accountants/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, schedule, isOnDuty, phone } = req.body;

        const updates = [];
        const params = [];

        if (name) { params.push(name); updates.push(`name = $${params.length}`); }
        if (schedule !== undefined) { params.push(JSON.stringify(schedule)); updates.push(`schedule = $${params.length}`); }
        if (isOnDuty !== undefined) { params.push(isOnDuty); updates.push(`is_on_duty = $${params.length}`); }
        if (phone !== undefined) { params.push(phone); updates.push(`phone = $${params.length}`); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        params.push(id);

        const result = await pool.query(`
            UPDATE accountants SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *
        `, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Accountant not found' });
        }

        res.json(mapAccountantRow(result.rows[0]));
    } catch (err) {
        log.error('PUT /accountants/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
