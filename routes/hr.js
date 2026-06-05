/**
 * routes/hr.js — HR module API (v30.7)
 *
 * Endpoints: staff HR data, shifts, clock-in/out, time records, reports, templates
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getKyivDate, getKyivDateStr } = require('../services/booking');
const costumeInventory = require('../services/costumeInventory');
const { requireRole } = require('../middleware/auth');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest
} = require('../services/businessContext');
const {
    SCHEME_TYPES: PAYROLL_SCHEME_TYPES,
    createPayrollScheme
} = require('../services/payroll');
const {
    parseTextList,
    normalizeProfessionKey,
    normalizeSecondaryProfessions,
    normalizeProfessionCatalogRow,
    validateProfessionKeys,
    staffProfessionKeys,
    resolveStaffProfessionAssignment
} = require('../services/professions');

// RBAC: HR module — security can inspect HR surfaces, but mutations stay manager/HR owned.
const HR_VIEW_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'security'];
const HR_MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'];
const PAYROLL_CONTROL_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'admin'];
const PAYROLL_EVENT_TYPES = new Set(['lock', 'unlock', 'commit', 'reverse']);
const PAYROLL_EVENT_LABELS = {
    lock: 'Період закрито',
    unlock: 'Період відкрито',
    commit: 'Зарплату нараховано',
    reverse: 'Сторно зарплати'
};
const requireHrManage = requireRole(...HR_MANAGE_ROLES);
const requirePayrollControl = requireRole(...PAYROLL_CONTROL_ROLES);
router.use(requireRole(...HR_VIEW_ROLES));
// v40: Validate numeric ID params
router.param('id', (req, res, next, val) => { if (val && !/^[0-9]+$/.test(val)) return res.status(400).json({ error: 'Invalid ID' }); next(); });

const log = createLogger('HR');

const COMPANY_STRUCTURE_SCHEMA_VERSION = 1;
const COMPANY_STRUCTURE_NODE_LIMIT = 60;
const COMPANY_STRUCTURE_ALLOWED_TONES = new Set(['gold', 'blue', 'purple', 'violet']);
const COMPANY_STRUCTURE_ALLOWED_LANES = new Set(['root', 'deputy', 'leadership', 'operations', 'support']);

const RESUME_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const RESUME_UPLOAD_LIMIT_FILES = 3;
const RESUME_TEXT_LIMIT = 50000;
const RESUME_ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.rtf', '.odt']);
const RESUME_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const RESUME_ALLOWED_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/octet-stream'
]);

const STAFF_DOCUMENT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const STAFF_DOCUMENT_TYPES = new Set(['passport', 'tax_id', 'contract', 'medical_book', 'certificate', 'training', 'other']);
const STAFF_DOCUMENT_STATUSES = new Set(['active', 'archived', 'expired', 'revoked']);
const STAFF_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);
const STAFF_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/octet-stream'
]);
const STAFF_RESOURCE_KINDS = new Set(['warehouse_stock', 'costume', 'custom']);
const STAFF_RESOURCE_STATUSES = new Set(['issued', 'returned', 'lost', 'written_off']);
const STAFF_ROLE_ASSIGNMENT_STATUSES = new Set(['active', 'inactive', 'suspended']);
const STAFF_ROLE_ADMISSION_STATUSES = new Set(['pending', 'approved', 'blocked']);
const STAFF_ROLE_INTERNSHIP_STATUSES = new Set(['none', 'in_progress', 'completed']);
const STAFF_OFFBOARDING_POOL_STATUSES = new Set(['core', 'reserve', 'blacklisted']);
const STAFF_OFFBOARDING_ACCOUNT_ACTIONS = new Set(['none', 'review', 'disable']);

function resumeFileExt(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function validateResumeUploadFile(file) {
    const ext = resumeFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!RESUME_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Непідтримуваний формат резюме');
        err.statusCode = 400;
        throw err;
    }
    if (mime && !mime.startsWith('text/') && !RESUME_ALLOWED_MIME_TYPES.has(mime)) {
        const err = new Error('Непідтримуваний MIME-тип резюме');
        err.statusCode = 400;
        throw err;
    }
}

const resumeUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: RESUME_UPLOAD_LIMIT_BYTES,
        files: RESUME_UPLOAD_LIMIT_FILES
    },
    fileFilter: (req, file, cb) => {
        try {
            validateResumeUploadFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleResumeUpload(req, res, next) {
    resumeUpload.array('files', RESUME_UPLOAD_LIMIT_FILES)(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        const error = err.code === 'LIMIT_FILE_COUNT'
            ? `Можна додати не більше ${RESUME_UPLOAD_LIMIT_FILES} файлів`
            : (err.message || 'Не вдалося завантажити резюме');
        res.status(status).json({ success: false, error });
    });
}

function staffDocumentFileExt(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function validateStaffDocumentUploadFile(file) {
    const ext = staffDocumentFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!STAFF_DOCUMENT_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Непідтримуваний формат HR-документа');
        err.statusCode = 400;
        throw err;
    }
    if (mime && !mime.startsWith('text/') && !STAFF_DOCUMENT_ALLOWED_MIME_TYPES.has(mime)) {
        const err = new Error('Непідтримуваний MIME-тип HR-документа');
        err.statusCode = 400;
        throw err;
    }
}

const staffDocumentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: STAFF_DOCUMENT_UPLOAD_LIMIT_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        try {
            validateStaffDocumentUploadFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleStaffDocumentUpload(req, res, next) {
    staffDocumentUpload.single('document')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        const error = err.code === 'LIMIT_FILE_SIZE'
            ? 'HR-документ завеликий. Максимум 10 МБ'
            : (err.message || 'Не вдалося завантажити HR-документ');
        res.status(status).json({ success: false, error });
    });
}

function cleanStaffText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function cleanStaffDate(value) {
    const normalized = cleanStaffText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeStaffDocumentType(value) {
    const type = cleanStaffText(value, 64) || 'other';
    return STAFF_DOCUMENT_TYPES.has(type) ? type : 'other';
}

function normalizeStaffDocumentStatus(value) {
    const status = cleanStaffText(value, 32) || 'active';
    return STAFF_DOCUMENT_STATUSES.has(status) ? status : 'active';
}

function normalizeStaffCertificationStatus(value) {
    const status = cleanStaffText(value, 32) || 'active';
    return ['active', 'expired', 'revoked'].includes(status) ? status : 'active';
}

function normalizeStaffResourceKind(value) {
    const kind = cleanStaffText(value, 64) || 'custom';
    return STAFF_RESOURCE_KINDS.has(kind) ? kind : 'custom';
}

function normalizeStaffResourceStatus(value) {
    const status = cleanStaffText(value, 32) || 'issued';
    return STAFF_RESOURCE_STATUSES.has(status) ? status : 'issued';
}

function normalizeStaffRoleAssignmentStatus(value) {
    const status = cleanStaffText(value, 32) || 'active';
    return STAFF_ROLE_ASSIGNMENT_STATUSES.has(status) ? status : 'active';
}

function normalizeStaffRoleAdmissionStatus(value) {
    const status = cleanStaffText(value, 32) || 'pending';
    return STAFF_ROLE_ADMISSION_STATUSES.has(status) ? status : 'pending';
}

function normalizeStaffRoleInternshipStatus(value) {
    const status = cleanStaffText(value, 32) || 'none';
    return STAFF_ROLE_INTERNSHIP_STATUSES.has(status) ? status : 'none';
}

function normalizeStaffOffboardingPoolStatus(value) {
    const status = cleanStaffText(value, 32) || 'reserve';
    return STAFF_OFFBOARDING_POOL_STATUSES.has(status) ? status : 'reserve';
}

function normalizeStaffOffboardingAccountAction(value) {
    const action = cleanStaffText(value, 32) || 'review';
    return STAFF_OFFBOARDING_ACCOUNT_ACTIONS.has(action) ? action : 'review';
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

function staffRoleAssignmentMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        staffId: row.staff_id,
        profession_key: normalizeProfessionKey(row.profession_key),
        professionKey: normalizeProfessionKey(row.profession_key),
        profession_title: row.profession_title || row.profession_key,
        professionTitle: row.profession_title || row.profession_key,
        is_primary: row.is_primary === true,
        isPrimary: row.is_primary === true,
        status: row.status || 'active',
        admission_status: row.admission_status || 'pending',
        admissionStatus: row.admission_status || 'pending',
        internship_status: row.internship_status || 'none',
        internshipStatus: row.internship_status || 'none',
        hourly_rate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
        hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
        payroll_scheme_id: row.payroll_scheme_id || null,
        payrollSchemeId: row.payroll_scheme_id || null,
        payroll_scheme_title: row.payroll_scheme_title || null,
        payrollSchemeTitle: row.payroll_scheme_title || null,
        payroll_scheme_type: row.payroll_scheme_type || null,
        payrollSchemeType: row.payroll_scheme_type || null,
        notes: row.notes || null,
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at
    };
}

function safeDownloadFilename(value, fallback = 'staff-document') {
    const raw = cleanStaffText(value, 180) || fallback;
    return raw.replace(/[\r\n"\\]/g, '_');
}

function staffDocumentMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        document_type: row.document_type,
        title: row.title,
        original_name: row.original_name,
        mime_type: row.mime_type,
        file_ext: row.file_ext,
        file_size: row.file_size,
        file_sha256: row.file_sha256,
        issued_at: row.issued_at,
        expires_at: row.expires_at,
        status: row.status,
        notes: row.notes,
        uploaded_by: row.uploaded_by,
        archived_at: row.archived_at,
        archived_by: row.archived_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        download_url: `/api/hr/staff/${row.staff_id}/documents/${row.id}/download`
    };
}

function staffResourceAssignmentMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        resource_kind: row.resource_kind,
        warehouse_stock_id: row.warehouse_stock_id,
        costume_id: row.costume_id,
        warehouse_stock_name: row.warehouse_stock_name || null,
        costume_name: row.costume_name || null,
        title: row.title,
        quantity: Number(row.quantity || 0),
        issued_at: row.issued_at,
        due_return_at: row.due_return_at,
        returned_at: row.returned_at,
        status: row.status,
        notes: row.notes,
        issued_by: row.issued_by,
        returned_by: row.returned_by,
        warehouse_issue_movement_id: row.warehouse_issue_movement_id || null,
        warehouse_return_movement_id: row.warehouse_return_movement_id || null,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function loadStaffRowOrNull(staffId, db = pool, { lock = false } = {}) {
    const result = await db.query(
        `SELECT id, name, is_active, hr_pool_status, blacklist_reason, notes
         FROM staff
         WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        [staffId]
    );
    return result.rows[0] || null;
}

function hrBusinessContextFromRequest(req) {
    return businessContextFromRequest(req) || DEFAULT_BUSINESS_CONTEXT;
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
    const type = cleanStaffText(value, 32) || 'hourly';
    return PAYROLL_SCHEME_TYPES.includes(type) ? type : 'hourly';
}

function normalizePayrollBaseKind(value) {
    const kind = cleanStaffText(value, 32) || 'hourly';
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
    const label = cleanStaffText(labelKeys.map(key => body[key]).find(value => value !== undefined), 80) || defaultLabel;
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
                label: cleanStaffText(body.percent_label ?? body.percentLabel, 80) || 'Відсоток',
                rate: percentRate,
                baseAmount: percentBase,
                sourceMetric: cleanStaffText(body.percent_source_metric ?? body.percentSourceMetric, 40) || 'manual'
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

function roleKeysFromStaffRecord(staff = {}) {
    return staffProfessionKeys({
        role_type: staff.role_type,
        secondary_professions: staff.secondary_professions || []
    });
}

function compatibilityRoleAssignmentsFromStaff(staff = {}, professionRates = []) {
    const rateMap = new Map((professionRates || []).map(row => [
        normalizeProfessionKey(row.profession_key),
        Number(row.hourly_rate || 0)
    ]));
    const primary = normalizeProfessionKey(staff.role_type);
    return roleKeysFromStaffRecord(staff).map(key => staffRoleAssignmentMeta({
        id: null,
        staff_id: staff.id,
        profession_key: key,
        profession_title: null,
        is_primary: key === primary,
        status: staff.is_active === false ? 'inactive' : 'active',
        admission_status: key === primary ? 'approved' : 'pending',
        internship_status: key === 'intern' ? 'in_progress' : 'none',
        hourly_rate: rateMap.get(key) || (key === primary ? Number(staff.hourly_rate || 0) : null),
        payroll_scheme_id: null,
        notes: null
    }));
}

async function loadStaffRoleAssignments(staffId, db = pool) {
    const result = await db.query(
        `SELECT sra.*,
                hp.title AS profession_title,
                ps.title AS payroll_scheme_title,
                ps.scheme_type AS payroll_scheme_type
         FROM staff_role_assignments sra
         LEFT JOIN hr_professions hp ON hp.key = sra.profession_key
         LEFT JOIN payroll_schemes ps ON ps.id = sra.payroll_scheme_id
         WHERE sra.staff_id = $1
         ORDER BY sra.is_primary DESC, hp.sort_order ASC NULLS LAST, sra.profession_key`,
        [staffId]
    ).catch(err => {
        log.warn('staff_role_assignments lookup failed:', err.message);
        return { rows: [] };
    });
    if (result.rows.length) return result.rows.map(staffRoleAssignmentMeta);

    const staff = await db.query(
        `SELECT id, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                is_active, hourly_rate
         FROM staff WHERE id = $1`,
        [staffId]
    );
    const rates = await db.query(
        `SELECT profession_key, hourly_rate
         FROM staff_profession_rates
         WHERE staff_id = $1`,
        [staffId]
    ).catch(() => ({ rows: [] }));
    return compatibilityRoleAssignmentsFromStaff(staff.rows[0] || {}, rates.rows);
}

function normalizeRoleAssignmentInputRows(rows = [], primaryRole = '') {
    const primaryKey = normalizeProfessionKey(primaryRole);
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(rows) ? rows : []) {
        const professionKey = normalizeProfessionKey(item.profession_key || item.professionKey || item.key);
        if (!professionKey || seen.has(professionKey)) continue;
        seen.add(professionKey);
        result.push({
            profession_key: professionKey,
            is_primary: item.is_primary === true || item.isPrimary === true || professionKey === primaryKey,
            status: normalizeStaffRoleAssignmentStatus(item.status),
            admission_status: normalizeStaffRoleAdmissionStatus(item.admission_status || item.admissionStatus),
            internship_status: normalizeStaffRoleInternshipStatus(item.internship_status || item.internshipStatus),
            hourly_rate: numberOrNull(item.hourly_rate ?? item.hourlyRate),
            payroll_scheme_id: numberOrNull(item.payroll_scheme_id ?? item.payrollSchemeId),
            notes: cleanStaffText(item.notes, 1000)
        });
    }
    if (primaryKey && !result.some(row => row.profession_key === primaryKey)) {
        result.unshift({
            profession_key: primaryKey,
            is_primary: true,
            status: 'active',
            admission_status: 'approved',
            internship_status: primaryKey === 'intern' ? 'in_progress' : 'none',
            hourly_rate: null,
            payroll_scheme_id: null,
            notes: null
        });
    }
    if (result.length && !result.some(row => row.is_primary)) result[0].is_primary = true;
    const finalPrimaryKey = primaryKey || result.find(row => row.is_primary)?.profession_key || result[0]?.profession_key || '';
    return result.map(row => ({ ...row, is_primary: row.profession_key === finalPrimaryKey }));
}

async function replaceStaffRoleAssignments(db, staffId, rows = [], actor = null) {
    const id = Number(staffId);
    if (!Number.isFinite(id) || id <= 0) return [];
    await db.query('DELETE FROM staff_role_assignments WHERE staff_id = $1', [id]);
    const saved = [];
    for (const row of rows) {
        const result = await db.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status, internship_status,
                 hourly_rate, payroll_scheme_id, notes, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
             RETURNING *`,
            [
                id,
                row.profession_key,
                row.is_primary,
                row.status,
                row.admission_status,
                row.internship_status,
                row.hourly_rate,
                row.payroll_scheme_id,
                row.notes,
                actor
            ]
        );
        saved.push(staffRoleAssignmentMeta(result.rows[0]));
    }
    return saved;
}

async function syncStaffRoleAssignmentsFromStaff(db, staffId, staffRow = {}, professionRates = [], actor = null) {
    const existing = await db.query(
        `SELECT profession_key, status, admission_status, internship_status, payroll_scheme_id, notes
         FROM staff_role_assignments
         WHERE staff_id = $1`,
        [staffId]
    ).catch(() => ({ rows: [] }));
    const existingByProfession = new Map(existing.rows.map(row => [normalizeProfessionKey(row.profession_key), row]));
    const rows = compatibilityRoleAssignmentsFromStaff(staffRow, professionRates);
    if (!rows.length) return [];
    const normalized = rows.map(row => ({
        profession_key: row.profession_key,
        is_primary: row.is_primary,
        status: existingByProfession.get(row.profession_key)?.status || row.status,
        admission_status: existingByProfession.get(row.profession_key)?.admission_status || row.admission_status,
        internship_status: existingByProfession.get(row.profession_key)?.internship_status || row.internship_status,
        hourly_rate: row.hourly_rate,
        payroll_scheme_id: existingByProfession.get(row.profession_key)?.payroll_scheme_id || null,
        notes: existingByProfession.get(row.profession_key)?.notes || row.notes
    }));
    return replaceStaffRoleAssignments(db, staffId, normalized, actor);
}

function normalizeResumeText(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(0, RESUME_TEXT_LIMIT);
}

function extractResumeText(file) {
    const ext = resumeFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (RESUME_TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
        const text = normalizeResumeText(file.buffer.toString('utf8'));
        return {
            text,
            status: text ? 'extracted' : 'failed',
            note: text ? 'Текст імпортовано з файлу' : 'Файл не містить читабельного тексту'
        };
    }
    return {
        text: null,
        status: 'stored_only',
        note: 'Файл збережено як вкладення; для PDF/DOC/DOCX текст можна додати вручну у поле резюме'
    };
}

function resumeFileMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        application_id: row.application_id,
        original_name: row.original_name,
        mime_type: row.mime_type,
        file_ext: row.file_ext,
        file_size: row.file_size,
        extracted_text: row.extracted_text || null,
        extraction_status: row.extraction_status || 'stored_only',
        extraction_note: row.extraction_note || null,
        uploaded_by: row.uploaded_by || null,
        created_at: row.created_at,
        download_url: `/api/hr/applications/${row.application_id}/resume-files/${row.id}/download`
    };
}

function sanitizeCompanyStructureString(value, limit) {
    return String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function normalizeCompanyStructureId(value, fallback, usedIds) {
    const base = String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64) || fallback;
    let id = base;
    const suffixBase = (base || fallback || 'node').slice(0, 58);
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${suffixBase}_${suffix}`.slice(0, 64);
        suffix += 1;
    }
    usedIds.add(id);
    return id;
}

function sanitizeCompanyStructureNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    const usedIds = new Set();
    const normalized = nodes.slice(0, COMPANY_STRUCTURE_NODE_LIMIT).map((node, index) => {
        const source = node && typeof node === 'object' ? node : {};
        const id = normalizeCompanyStructureId(source.id, `node_${index + 1}`, usedIds);
        const tone = COMPANY_STRUCTURE_ALLOWED_TONES.has(source.tone) ? source.tone : 'blue';
        const lane = COMPANY_STRUCTURE_ALLOWED_LANES.has(source.lane) ? source.lane : 'leadership';
        const order = Number.isFinite(Number(source.order)) ? Number(source.order) : index;
        const x = Number.isFinite(Number(source.x)) ? Math.max(0, Math.min(5000, Number(source.x))) : null;
        const y = Number.isFinite(Number(source.y)) ? Math.max(0, Math.min(5000, Number(source.y))) : null;
        return {
            id,
            title: sanitizeCompanyStructureString(source.title, 80) || 'Роль',
            description: sanitizeCompanyStructureString(source.description, 1200),
            tone,
            lane,
            parentId: sanitizeCompanyStructureString(source.parentId, 64) || null,
            stack: sanitizeCompanyStructureString(source.stack, 64) || null,
            order,
            x,
            y,
            meta: sanitizeCompanyStructureString(source.meta, 80) || null
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map(node => {
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId
        };
    });
}

function normalizeCompanyStructurePayload(value) {
    let source = value && typeof value === 'object' ? value : {};
    if (typeof value === 'string') {
        try {
            source = JSON.parse(value);
        } catch {
            source = { instructions: value };
        }
    }
    return {
        schemaVersion: COMPANY_STRUCTURE_SCHEMA_VERSION,
        structure: sanitizeCompanyStructureString(source.structure || source.structure_text, 20000),
        instructions: sanitizeCompanyStructureString(source.instructions || source.instructions_text, 20000),
        nodes: sanitizeCompanyStructureNodes(source.nodes),
        updatedBy: source.updatedBy || null,
        updatedAt: source.updatedAt || null
    };
}

function safeDownloadName(name) {
    return String(name || 'resume')
        .replace(/[\r\n"]/g, '')
        .slice(0, 160) || 'resume';
}

async function loadResumeFilesForApplications(applicationIds) {
    const ids = [...new Set((applicationIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite))];
    if (!ids.length) return new Map();
    const files = await pool.query(
        `SELECT id, application_id, original_name, mime_type, file_ext, file_size,
                extracted_text, extraction_status, extraction_note, uploaded_by, created_at
         FROM job_application_resume_files
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at DESC, id DESC`,
        [ids]
    );
    const grouped = new Map(ids.map(id => [id, []]));
    for (const row of files.rows) {
        const key = parseInt(row.application_id, 10);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(resumeFileMeta(row));
    }
    return grouped;
}

// Helper: get today's date in Kyiv timezone as YYYY-MM-DD
function todayKyiv() {
    return getKyivDateStr();
}

// Helper: get current Kyiv time as Date object
function nowKyiv() {
    return getKyivDate();
}

// Helper: time string "HH:MM" to minutes since midnight
function timeToMin(t) {
    if (!t) return 0;
    const s = typeof t === 'string' ? t : t.toString();
    const parts = s.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// Helper: minutes diff between now (Kyiv) and a TIME value on today
function minutesSincePlannedStart(plannedStart) {
    const now = nowKyiv();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin - timeToMin(plannedStart);
}

// Helper: audit log entry
async function auditLog(action, staffId, performedBy, details, ipAddress) {
    try {
        await pool.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [action, staffId, performedBy, details ? JSON.stringify(details) : null, ipAddress]
        );
    } catch (err) {
        log.error('Audit log error', err);
    }
}

async function activeProfessionKeySet(db = pool) {
    const result = await db.query('SELECT key FROM hr_professions WHERE is_active = true');
    return new Set(result.rows.map(row => normalizeProfessionKey(row.key)).filter(Boolean));
}

function normalizeProfessionPayload(body = {}, current = {}) {
    const key = normalizeProfessionKey(body.key ?? current.key);
    const title = String(body.title ?? current.title ?? '').replace(/\u0000/g, '').trim().slice(0, 120);
    const department = String(body.department ?? current.department ?? '').replace(/\u0000/g, '').trim().slice(0, 80) || null;
    const shortInfo = String(body.short_info ?? body.shortInfo ?? current.short_info ?? current.shortInfo ?? '').replace(/\u0000/g, '').trim().slice(0, 2000) || null;
    const responsibilities = parseTextList(body.responsibilities ?? current.responsibilities, 16);
    const checklist = parseTextList(body.checklist ?? current.checklist, 32);
    const colorRaw = String(body.color ?? current.color ?? '').trim();
    const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : (colorRaw ? colorRaw.slice(0, 20) : null);
    const structureNodeId = normalizeCompanyStructureNodeRef(body.structure_node_id ?? body.structureNodeId ?? current.structure_node_id ?? current.structureNodeId);
    const sortOrder = Number.isFinite(Number(body.sort_order ?? body.sortOrder ?? current.sort_order ?? current.sortOrder))
        ? Math.round(Number(body.sort_order ?? body.sortOrder ?? current.sort_order ?? current.sortOrder))
        : 100;
    const isActive = body.is_active ?? body.isActive ?? current.is_active ?? current.isActive;
    return {
        key,
        title,
        department,
        shortInfo,
        responsibilities,
        checklist,
        color,
        structureNodeId,
        sortOrder,
        isActive: isActive === undefined ? true : isActive !== false && isActive !== 'false'
    };
}

async function validateStaffProfessionInput(roleType, secondaryProfessions, options = {}) {
    const activeKeys = await activeProfessionKeySet();
    const allowedExistingKeys = new Set((options.allowedExistingKeys || []).map(normalizeProfessionKey).filter(Boolean));
    const allowedKeys = new Set([...activeKeys, ...allowedExistingKeys]);
    const primaryKey = normalizeProfessionKey(roleType);
    if (primaryKey && !allowedKeys.has(primaryKey)) {
        return { error: `Невідома основна професія: ${primaryKey}` };
    }
    const normalizedSecondary = normalizeSecondaryProfessions(secondaryProfessions, primaryKey);
    const invalid = validateProfessionKeys(normalizedSecondary, allowedKeys);
    if (invalid.length) {
        return { error: `Невідомі додаткові професії: ${invalid.join(', ')}` };
    }
    return { secondaryProfessions: normalizedSecondary };
}

function checklistKeyForIndex(index) {
    return `item_${Number(index) + 1}`;
}

function checklistItemsForProfession(row = {}) {
    const source = Array.isArray(row.checklist) ? row.checklist : parseTextList(row.checklist, 32);
    return source.map((title, index) => ({
        key: checklistKeyForIndex(index),
        title
    })).filter(item => item.title);
}

async function attachTrainingReadiness(staffRows = []) {
    if (!Array.isArray(staffRows) || !staffRows.length) return staffRows;
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isFinite);
    const professionKeys = [...new Set(staffRows.flatMap(row => staffProfessionKeys(row)))];
    if (!staffIds.length || !professionKeys.length) {
        staffRows.forEach(row => { row.training_readiness = { percent: 0, completed: 0, total: 0, professions: [] }; });
        return staffRows;
    }

    const [professionRows, courseRows, enrollmentRows, checklistProgressRows] = await Promise.all([
        pool.query(
            `SELECT key, title, checklist
             FROM hr_professions
             WHERE key = ANY($1::text[]) AND is_active = true`,
            [professionKeys]
        ),
        pool.query(
            `SELECT c.id, c.profession_key, c.target_roles, c.title, c.source,
                    COUNT(l.id)::integer AS total_lectures
             FROM training_courses c
             LEFT JOIN training_course_lectures l ON l.course_id = c.id AND l.is_published = true
             WHERE c.is_active = true
               AND (c.profession_key = ANY($1::text[]) OR c.target_roles && $1::text[])
             GROUP BY c.id, c.profession_key, c.target_roles, c.title, c.source`,
            [professionKeys]
        ),
        pool.query(
            `SELECT course_id, staff_id, current_lecture, completed_at
             FROM training_course_enrollment
             WHERE staff_id = ANY($1::int[])`,
            [staffIds]
        ),
        pool.query(
            `SELECT staff_id, profession_key, checklist_key, title, completed_at, completed_by, notes
             FROM hr_staff_profession_checklist_progress
             WHERE staff_id = ANY($1::int[])
               AND profession_key = ANY($2::text[])`,
            [staffIds, professionKeys]
        )
    ]);

    const professionsByKey = new Map(professionRows.rows.map(row => [normalizeProfessionKey(row.key), row]));
    const coursesByProfession = new Map();
    courseRows.rows.forEach(row => {
        const keys = row.profession_key
            ? [normalizeProfessionKey(row.profession_key)]
            : (Array.isArray(row.target_roles) ? row.target_roles.map(normalizeProfessionKey).filter(Boolean) : []);
        keys.forEach(key => {
            if (!professionKeys.includes(key)) return;
            if (!coursesByProfession.has(key)) coursesByProfession.set(key, []);
            coursesByProfession.get(key).push(row);
        });
    });
    const enrollmentByStaffCourse = new Map(enrollmentRows.rows.map(row => [`${row.staff_id}:${row.course_id}`, row]));
    const checklistProgressByStaffProfession = new Map();
    checklistProgressRows.rows.forEach(row => {
        const key = `${row.staff_id}:${normalizeProfessionKey(row.profession_key)}`;
        if (!checklistProgressByStaffProfession.has(key)) checklistProgressByStaffProfession.set(key, new Map());
        checklistProgressByStaffProfession.get(key).set(row.checklist_key, row);
    });

    staffRows.forEach(row => {
        const entries = staffProfessionKeys(row).map(professionKey => {
            const profession = professionsByKey.get(professionKey) || { key: professionKey, title: professionKey, checklist: [] };
            const checklist = checklistItemsForProfession(profession);
            const progressMap = checklistProgressByStaffProfession.get(`${row.id}:${professionKey}`) || new Map();
            const checklistItems = checklist.map(item => {
                const progress = progressMap.get(item.key);
                return {
                    ...item,
                    completed_at: progress?.completed_at || null,
                    completed_by: progress?.completed_by || null,
                    notes: progress?.notes || null
                };
            });
            const checklistCompleted = checklistItems.filter(item => item.completed_at).length;
            const courses = (coursesByProfession.get(professionKey) || [])
                .filter(course => !(course.source === 'hr_profession_seed' && checklistItems.length))
                .map(course => {
                    const totalLectures = Number(course.total_lectures || 0);
                    const enrollment = enrollmentByStaffCourse.get(`${row.id}:${course.id}`);
                    const completedLectures = enrollment?.completed_at
                        ? totalLectures
                        : Math.max(0, Math.min(totalLectures, Number(enrollment?.current_lecture || 0)));
                    return {
                        id: course.id,
                        title: course.title,
                        total_lectures: totalLectures,
                        completed_lectures: completedLectures,
                        completed_at: enrollment?.completed_at || null
                    };
                });
            const courseTotal = courses.reduce((sum, course) => sum + course.total_lectures, 0);
            const courseCompleted = courses.reduce((sum, course) => sum + course.completed_lectures, 0);
            const total = checklistItems.length + courseTotal;
            const completed = checklistCompleted + courseCompleted;
            return {
                key: professionKey,
                title: profession.title || professionKey,
                checklist: checklistItems,
                courses,
                completed,
                total,
                percent: total ? Math.round((completed / total) * 100) : 0
            };
        });
        const total = entries.reduce((sum, entry) => sum + entry.total, 0);
        const completed = entries.reduce((sum, entry) => sum + entry.completed, 0);
        row.training_readiness = {
            percent: total ? Math.round((completed / total) * 100) : 0,
            completed,
            total,
            professions: entries
        };
    });
    return staffRows;
}

function toDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function staffScheduleStatusForShift(shiftType) {
    return shiftType === 'remote' ? 'remote' : 'working';
}

function buildReplacementNote(shift) {
    if (!shift?.original_staff_id) return shift?.notes || null;
    const reason = shift.replacement_reason ? `: ${shift.replacement_reason}` : '';
    return `Підміна за співробітника #${shift.original_staff_id}${reason}`;
}

function scheduleProfessionFromPayload(payload = {}) {
    return normalizeProfessionKey(payload.profession_key ?? payload.professionKey ?? payload.role_type ?? payload.roleType);
}

async function resolveHrShiftProfession(staffId, payload = {}, db = pool) {
    return resolveStaffProfessionAssignment(db, staffId, scheduleProfessionFromPayload(payload));
}

function normalizeCompanyStructureNodeRef(value) {
    const raw = sanitizeCompanyStructureString(value, 64);
    if (!raw) return null;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_').slice(0, 64) || null;
}

function normalizeStaffProfessionRates(value, allowedProfessionKeys = []) {
    const source = Array.isArray(value) ? value : [];
    const allowed = new Set((allowedProfessionKeys || []).map(normalizeProfessionKey).filter(Boolean));
    const seen = new Set();
    const rates = [];
    source.forEach(item => {
        const row = item && typeof item === 'object' ? item : {};
        const professionKey = normalizeProfessionKey(row.profession_key ?? row.professionKey ?? row.key);
        const rate = Number(row.hourly_rate ?? row.hourlyRate ?? row.rate);
        if (!professionKey || seen.has(professionKey)) return;
        if (allowed.size && !allowed.has(professionKey)) return;
        if (!Number.isFinite(rate) || rate <= 0) return;
        seen.add(professionKey);
        rates.push({ profession_key: professionKey, hourly_rate: Math.round(rate * 100) / 100 });
    });
    return rates;
}

async function attachStaffProfessionRates(staffRows = [], db = pool) {
    if (!Array.isArray(staffRows) || !staffRows.length) return staffRows;
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isFinite);
    if (!staffIds.length) return staffRows;
    const result = await db.query(
        `SELECT staff_id, profession_key, hourly_rate
         FROM staff_profession_rates
         WHERE staff_id = ANY($1::int[])
         ORDER BY profession_key`,
        [staffIds]
    ).catch(err => {
        log.warn('staff_profession_rates query failed:', err.message);
        return { rows: [] };
    });
    const byStaff = new Map();
    result.rows.forEach(row => {
        const staffId = Number(row.staff_id);
        if (!byStaff.has(staffId)) byStaff.set(staffId, []);
        byStaff.get(staffId).push({
            profession_key: normalizeProfessionKey(row.profession_key),
            hourly_rate: Number(row.hourly_rate || 0)
        });
    });
    staffRows.forEach(row => {
        row.profession_rates = byStaff.get(Number(row.id)) || [];
    });
    return staffRows;
}

async function replaceStaffProfessionRates(db, staffId, rates = []) {
    const id = Number(staffId);
    if (!Number.isFinite(id) || id <= 0) return [];
    await db.query('DELETE FROM staff_profession_rates WHERE staff_id = $1', [id]);
    const saved = [];
    for (const row of rates) {
        const result = await db.query(
            `INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (staff_id, profession_key) DO UPDATE SET
                hourly_rate = EXCLUDED.hourly_rate,
                updated_at = NOW()
             RETURNING profession_key, hourly_rate`,
            [id, row.profession_key, row.hourly_rate]
        );
        saved.push({
            profession_key: normalizeProfessionKey(result.rows[0].profession_key),
            hourly_rate: Number(result.rows[0].hourly_rate || 0)
        });
    }
    return saved;
}

async function loadStaffProfessionRateMap(staffIds = [], db = pool) {
    const ids = [...new Set((staffIds || []).map(Number).filter(Number.isFinite))];
    if (!ids.length) return new Map();
    const result = await db.query(
        `SELECT staff_id, profession_key, hourly_rate
         FROM staff_profession_rates
         WHERE staff_id = ANY($1::int[])`,
        [ids]
    ).catch(err => {
        log.warn('staff profession rate map query failed:', err.message);
        return { rows: [] };
    });
    return new Map(result.rows.map(row => [
        `${Number(row.staff_id)}:${normalizeProfessionKey(row.profession_key)}`,
        Number(row.hourly_rate || 0)
    ]));
}

function rateForStaffProfession(staff = {}, professionKey = '', rateMap = new Map()) {
    const staffId = Number(staff.staff_id ?? staff.id);
    const normalized = normalizeProfessionKey(professionKey || staff.profession_key || staff.role_type);
    const override = rateMap.get(`${staffId}:${normalized}`);
    return Number.isFinite(override) && override > 0
        ? override
        : Number(staff.hourly_rate || 0);
}

function normalizePayrollMonth(value) {
    const month = String(value || '').trim();
    if (/^\d{4}-\d{2}$/.test(month)) return month;
    const now = nowKyiv();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function requirePayrollMonth(value) {
    const month = String(value || '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function payrollTotals(rows = []) {
    return rows.reduce((acc, row) => ({
        total_base: acc.total_base + Number(row.base_salary || 0),
        total_overtime: acc.total_overtime + Number(row.overtime_pay || 0),
        total_bonuses: acc.total_bonuses + Number(row.bonuses || 0) + Number(row.tips || 0),
        total_deductions: acc.total_deductions + Number(row.deductions || 0) + Number(row.penalties || 0),
        total_salary: acc.total_salary + Number(row.total_salary || 0)
    }), { total_base: 0, total_overtime: 0, total_bonuses: 0, total_deductions: 0, total_salary: 0 });
}

function payrollActor(user = {}) {
    return user.username || user.name || user.email || 'crm';
}

function payrollMonthRange(month) {
    const year = Number(String(month).slice(0, 4));
    const monthNumber = Number(String(month).slice(5, 7));
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(lastDay).padStart(2, '0')}`
    };
}

function payrollDefaultLock(month) {
    return {
        period_month: month,
        is_locked: false,
        locked_at: null,
        locked_by: null,
        unlocked_at: null,
        unlocked_by: null,
        note: null,
        meta_json: {}
    };
}

async function loadPayrollPeriodLock(month, db = pool) {
    const result = await db.query(
        `SELECT period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, meta_json
         FROM payroll_period_locks
         WHERE period_month = $1`,
        [month]
    );
    const row = result.rows[0];
    if (!row) return payrollDefaultLock(month);
    return {
        period_month: row.period_month,
        is_locked: row.is_locked === true,
        locked_at: row.locked_at || null,
        locked_by: row.locked_by || null,
        unlocked_at: row.unlocked_at || null,
        unlocked_by: row.unlocked_by || null,
        note: row.note || null,
        meta_json: row.meta_json && typeof row.meta_json === 'object' ? row.meta_json : {}
    };
}

async function assertPayrollPeriodOpen(month, db = pool) {
    const lock = await loadPayrollPeriodLock(month, db);
    if (lock.is_locked) {
        const err = new Error(`Зарплатний період ${month} закрито. Відкрийте період або зробіть сторно перед змінами.`);
        err.statusCode = 423;
        err.payrollLock = lock;
        throw err;
    }
    return lock;
}

function normalizePayrollPeriodEvent(row = {}) {
    const type = row.event_type || '';
    return {
        id: Number(row.id || 0),
        period_month: row.period_month || null,
        event_type: type,
        event_label: PAYROLL_EVENT_LABELS[type] || type,
        actor: row.actor || null,
        note: row.note || null,
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        items_count: row.items_count === null || row.items_count === undefined ? null : Number(row.items_count),
        meta_json: row.meta_json && typeof row.meta_json === 'object' ? row.meta_json : {},
        created_at: row.created_at || null
    };
}

async function recordPayrollPeriodEvent(month, eventType, actor, note = '', meta = {}, db = pool) {
    if (!PAYROLL_EVENT_TYPES.has(eventType)) return null;
    const payload = meta && typeof meta === 'object' ? meta : {};
    const amount = Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : null;
    const count = Number.isFinite(Number(payload.count)) ? Math.trunc(Number(payload.count)) : null;
    const result = await db.query(
        `INSERT INTO payroll_period_events
            (period_month, event_type, actor, note, amount, items_count, meta_json)
         VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7::jsonb)
         RETURNING id, period_month, event_type, actor, note, amount, items_count, meta_json, created_at`,
        [month, eventType, actor || null, String(note || '').trim(), amount, count, JSON.stringify(payload)]
    );
    return normalizePayrollPeriodEvent(result.rows[0]);
}

async function loadPayrollPeriodEvents(month, db = pool, limit = 12) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 12, 50));
    const result = await db.query(
        `SELECT id, period_month, event_type, actor, note, amount, items_count, meta_json, created_at
         FROM payroll_period_events
         WHERE period_month = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [month, safeLimit]
    );
    return result.rows.map(normalizePayrollPeriodEvent);
}

async function setPayrollPeriodLock(month, locked, actor, note = '', db = pool) {
    const result = await db.query(
        `INSERT INTO payroll_period_locks
            (period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, updated_at)
         VALUES (
            $1, $2,
            CASE WHEN $2 THEN NOW() ELSE NULL END,
            CASE WHEN $2 THEN $3 ELSE NULL END,
            CASE WHEN $2 THEN NULL ELSE NOW() END,
            CASE WHEN $2 THEN NULL ELSE $3 END,
            NULLIF($4, ''), NOW()
         )
         ON CONFLICT (period_month) DO UPDATE SET
            is_locked = EXCLUDED.is_locked,
            locked_at = CASE WHEN EXCLUDED.is_locked THEN NOW() ELSE payroll_period_locks.locked_at END,
            locked_by = CASE WHEN EXCLUDED.is_locked THEN EXCLUDED.locked_by ELSE payroll_period_locks.locked_by END,
            unlocked_at = CASE WHEN EXCLUDED.is_locked THEN payroll_period_locks.unlocked_at ELSE NOW() END,
            unlocked_by = CASE WHEN EXCLUDED.is_locked THEN payroll_period_locks.unlocked_by ELSE EXCLUDED.unlocked_by END,
            note = EXCLUDED.note,
            updated_at = NOW()
         RETURNING period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, meta_json`,
        [month, locked === true, actor, String(note || '').trim()]
    );
    await recordPayrollPeriodEvent(
        result.rows[0].period_month,
        locked === true ? 'lock' : 'unlock',
        actor,
        note,
        { locked: locked === true },
        db
    );
    return loadPayrollPeriodLock(result.rows[0].period_month, db);
}

async function loadPayrollReconciliation(month, db = pool) {
    const range = payrollMonthRange(month);
    const result = await db.query(
        `WITH active_reports AS (
            SELECT id, staff_id, net_amount, finance_transaction_id
            FROM payroll_reports
            WHERE period_month = $1
              AND status = 'paid'
              AND voided_at IS NULL
        ),
        voided_reports AS (
            SELECT id
            FROM payroll_reports
            WHERE period_month = $1
              AND voided_at IS NOT NULL
        ),
        salary_finance AS (
            SELECT ft.id, ft.amount, ft.staff_id
            FROM finance_transactions ft
            WHERE ft.payment_method = 'salary'
              AND ft.date::date >= $2::date
              AND ft.date::date <= $3::date
        ),
        reversal_finance AS (
            SELECT ft.id, ft.amount
            FROM finance_transactions ft
            WHERE ft.payment_method = 'salary_reversal'
              AND ft.date::date >= $2::date
              AND ft.date::date <= $3::date
        ),
        missing_finance AS (
            SELECT ar.id
            FROM active_reports ar
            LEFT JOIN finance_transactions ft ON ft.id = ar.finance_transaction_id
            WHERE ar.finance_transaction_id IS NULL OR ft.id IS NULL
        ),
        orphan_salary AS (
            SELECT sf.id
            FROM salary_finance sf
            LEFT JOIN payroll_reports pr ON pr.finance_transaction_id = sf.id AND pr.period_month = $1
            WHERE pr.id IS NULL
        )
        SELECT
            COALESCE((SELECT COUNT(*) FROM active_reports), 0)::int AS payroll_count,
            COALESCE((SELECT SUM(net_amount) FROM active_reports), 0)::numeric AS payroll_total,
            COALESCE((SELECT COUNT(*) FROM voided_reports), 0)::int AS voided_count,
            COALESCE((SELECT COUNT(*) FROM salary_finance), 0)::int AS finance_salary_count,
            COALESCE((SELECT SUM(amount) FROM salary_finance), 0)::numeric AS finance_salary_total,
            COALESCE((SELECT COUNT(*) FROM reversal_finance), 0)::int AS finance_reversal_count,
            COALESCE((SELECT SUM(amount) FROM reversal_finance), 0)::numeric AS finance_reversal_total,
            COALESCE((SELECT COUNT(*) FROM missing_finance), 0)::int AS missing_finance_count,
            COALESCE((SELECT COUNT(*) FROM orphan_salary), 0)::int AS orphan_salary_count`,
        [month, range.from, range.to]
    );
    const row = result.rows[0] || {};
    const payrollTotal = Number(row.payroll_total || 0);
    const financeSalaryTotal = Number(row.finance_salary_total || 0);
    const financeReversalTotal = Number(row.finance_reversal_total || 0);
    const financeNetTotal = financeSalaryTotal - financeReversalTotal;
    const variance = payrollTotal - financeNetTotal;
    const missingFinanceCount = Number(row.missing_finance_count || 0);
    const orphanSalaryCount = Number(row.orphan_salary_count || 0);
    return {
        month,
        payroll_count: Number(row.payroll_count || 0),
        payroll_total: payrollTotal,
        voided_count: Number(row.voided_count || 0),
        finance_salary_count: Number(row.finance_salary_count || 0),
        finance_salary_total: financeSalaryTotal,
        finance_reversal_count: Number(row.finance_reversal_count || 0),
        finance_reversal_total: financeReversalTotal,
        finance_net_total: financeNetTotal,
        missing_finance_count: missingFinanceCount,
        orphan_salary_count: orphanSalaryCount,
        variance,
        status: variance === 0 && missingFinanceCount === 0 && orphanSalaryCount === 0 ? 'ok' : 'attention'
    };
}

async function loadPayrollCalculation(monthValue, db = pool) {
    const month = normalizePayrollMonth(monthValue);
    const result = await db.query(`
        WITH params AS (
            SELECT $1::varchar(7) AS month,
                   ($1 || '-01')::date AS date_from,
                   (($1 || '-01')::date + INTERVAL '1 month - 1 day')::date AS date_to
        ),
        active_staff AS (
            SELECT id, name, role_type, hourly_rate, department
            FROM staff
            WHERE is_active = true
              AND (is_freelance = false OR is_freelance IS NULL)
        ),
        time_segments AS (
            SELECT s.id AS staff_id,
                   COALESCE(hs.profession_key, s.role_type) AS profession_key,
                   COALESCE(NULLIF(spr.hourly_rate, 0), s.hourly_rate, 0)::numeric AS rate,
                   COALESCE(SUM(tr.total_worked_minutes), 0)::numeric AS total_minutes,
                   SUM(tr.overtime_minutes) AS overtime_minutes,
                   COUNT(*) FILTER (WHERE tr.status IN ('present', 'late', 'early_leave', 'auto_closed', 'unscheduled'))::int AS days_worked
            FROM active_staff s
            CROSS JOIN params p
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id
                AND tr.record_date >= p.date_from AND tr.record_date <= p.date_to
            LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = tr.record_date
            LEFT JOIN staff_profession_rates spr ON spr.staff_id = s.id
                AND spr.profession_key = COALESCE(hs.profession_key, s.role_type)
            GROUP BY s.id, COALESCE(hs.profession_key, s.role_type),
                     COALESCE(NULLIF(spr.hourly_rate, 0), s.hourly_rate, 0)
        ),
        time_totals AS (
            SELECT staff_id,
                   SUM(total_minutes)::numeric AS total_minutes,
                   SUM(overtime_minutes)::numeric AS overtime_minutes,
                   SUM(days_worked)::int AS days_worked,
                   SUM((total_minutes / 60.0) * rate)::numeric AS base_salary,
                   SUM((overtime_minutes / 60.0) * rate * 1.5)::numeric AS overtime_pay,
                   COALESCE(
                       jsonb_agg(jsonb_build_object(
                           'profession_key', profession_key,
                           'rate', rate,
                           'hours', ROUND(total_minutes / 60.0, 1)
                       ) ORDER BY profession_key) FILTER (WHERE total_minutes > 0 OR overtime_minutes > 0),
                       '[]'::jsonb
                   ) AS profession_rates
            FROM time_segments
            WHERE profession_key IS NOT NULL
            GROUP BY staff_id
        ),
        adjustment_totals AS (
            SELECT sa.staff_id,
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'bonus'), 0)::numeric AS bonuses,
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'tip'), 0)::numeric AS tips,
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'deduction'), 0)::numeric AS deductions,
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'penalty'), 0)::numeric AS penalties
            FROM salary_adjustments sa
            JOIN params p ON sa.month = p.month
            GROUP BY sa.staff_id
        ),
        report_snapshots AS (
            SELECT pr.staff_id, pr.status AS payroll_status, pr.id AS payroll_report_id
            FROM payroll_reports pr
            JOIN params p ON pr.period_month = p.month
            WHERE pr.voided_at IS NULL
        )
        SELECT s.id AS staff_id,
               s.name AS staff_name,
               s.role_type,
               s.department,
               COALESCE(s.hourly_rate, 0)::numeric AS hourly_rate,
               COALESCE(tt.profession_rates, '[]'::jsonb) AS profession_rate_summary,
               COALESCE(tt.days_worked, 0)::int AS days_worked,
               ROUND(COALESCE(tt.total_minutes, 0) / 60.0, 1)::numeric AS hours_worked,
               ROUND(COALESCE(tt.overtime_minutes, 0) / 60.0, 1)::numeric AS overtime_hours,
               ROUND(COALESCE(tt.base_salary, 0))::int AS base_salary,
               ROUND(COALESCE(tt.overtime_pay, 0))::int AS overtime_pay,
               ROUND(COALESCE(at.bonuses, 0))::int AS bonuses,
               ROUND(COALESCE(at.tips, 0))::int AS tips,
               ROUND(COALESCE(at.deductions, 0))::int AS deductions,
               ROUND(COALESCE(at.penalties, 0))::int AS penalties,
               ROUND(COALESCE(tt.base_salary, 0) + COALESCE(tt.overtime_pay, 0) + COALESCE(at.bonuses, 0) + COALESCE(at.tips, 0) - COALESCE(at.deductions, 0) - COALESCE(at.penalties, 0))::int AS total_salary,
               rs.payroll_status,
               rs.payroll_report_id
        FROM active_staff s
        LEFT JOIN time_totals tt ON tt.staff_id = s.id
        LEFT JOIN adjustment_totals at ON at.staff_id = s.id
        LEFT JOIN report_snapshots rs ON rs.staff_id = s.id
        ORDER BY s.name
    `, [month]);
    const data = result.rows.map(row => ({
        staff_id: Number(row.staff_id),
        staff_name: row.staff_name,
        role_type: row.role_type,
        department: row.department,
        hourly_rate: Number(row.hourly_rate || 0),
        profession_rate_summary: Array.isArray(row.profession_rate_summary) ? row.profession_rate_summary : [],
        days_worked: Number(row.days_worked || 0),
        hours_worked: Number(row.hours_worked || 0),
        overtime_hours: Number(row.overtime_hours || 0),
        base_salary: Number(row.base_salary || 0),
        overtime_pay: Number(row.overtime_pay || 0),
        bonuses: Number(row.bonuses || 0),
        tips: Number(row.tips || 0),
        deductions: Number(row.deductions || 0),
        penalties: Number(row.penalties || 0),
        total_salary: Number(row.total_salary || 0),
        payroll_status: row.payroll_status || null,
        payroll_report_id: row.payroll_report_id || null
    }));
    return { month, data, totals: payrollTotals(data) };
}

async function loadKpiSnapshot(monthValue, db = pool) {
    const month = normalizePayrollMonth(monthValue);
    const result = await db.query(`
        WITH params AS (
            SELECT $1::varchar(7) AS month,
                   ($1 || '-01')::date AS date_from,
                   (($1 || '-01')::date + INTERVAL '1 month - 1 day')::date AS date_to
        ),
        active_staff AS (
            SELECT id, name, department, role_type, color, photo_url,
                   COALESCE(avg_rating, 0)::numeric AS avg_rating,
                   COALESCE(total_ratings, 0)::int AS total_ratings
            FROM staff
            WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL)
        ),
        shift_stats AS (
            SELECT hs.staff_id, COUNT(*)::int AS days_scheduled
            FROM hr_shifts hs
            JOIN params p ON hs.shift_date >= p.date_from AND hs.shift_date <= p.date_to
            GROUP BY hs.staff_id
        ),
        time_stats AS (
            SELECT tr.staff_id,
                   COUNT(*) FILTER (WHERE tr.status IN ('present', 'late', 'early_leave', 'auto_closed', 'unscheduled'))::int AS days_worked,
                   COUNT(*) FILTER (WHERE tr.status = 'late')::int AS late_count,
                   COUNT(*) FILTER (WHERE tr.status IN ('absent', 'no_show'))::int AS days_absent,
                   COALESCE(SUM(tr.late_minutes), 0)::int AS total_late_minutes,
                   COALESCE(SUM(tr.total_worked_minutes), 0)::numeric AS total_worked_minutes,
                   COALESCE(SUM(tr.overtime_minutes), 0)::numeric AS total_overtime_minutes
            FROM hr_time_records tr
            JOIN params p ON tr.record_date >= p.date_from AND tr.record_date <= p.date_to
            GROUP BY tr.staff_id
        ),
        task_stats AS (
            SELECT ep.staff_id,
                   COUNT(t.id)::int AS tasks_assigned,
                   COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') IN ('done', 'completed'))::int AS tasks_done,
                   COUNT(t.id) FILTER (
                       WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled')
                         AND t.deadline IS NOT NULL
                         AND t.deadline < NOW()
                   )::int AS tasks_overdue
            FROM tasks t
            JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active = true
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
                   COALESCE(SUM(op.completed_items), 0)::int AS onboarding_completed_items
            FROM onboarding_progress op
            GROUP BY op.staff_id
        ),
        contribution_stats AS (
            SELECT s.id AS staff_id,
                   COUNT(DISTINCT b.id)::int AS events_period
            FROM active_staff s
            CROSS JOIN params p
            LEFT JOIN bookings b ON (
                b.line_id = s.id::text
                OR LOWER(BTRIM(COALESCE(b.second_animator, ''))) = LOWER(BTRIM(s.name))
                OR BTRIM(COALESCE(b.second_animator, '')) = s.id::text
            )
                AND b.status IN ('completed', 'confirmed')
                AND b.date::date >= p.date_from AND b.date::date <= p.date_to
            GROUP BY s.id
        ),
        base_metrics AS (
            SELECT s.id AS staff_id,
                   s.name AS staff_name,
                   s.department,
                   s.role_type,
                   s.color,
                   s.photo_url,
                   COALESCE(ss.days_scheduled, 0)::int AS days_scheduled,
                   COALESCE(ts.days_worked, 0)::int AS days_worked,
                   COALESCE(ts.late_count, 0)::int AS late_count,
                   COALESCE(ts.days_absent, 0)::int AS days_absent,
                   COALESCE(ts.total_late_minutes, 0)::int AS total_late_minutes,
                   ROUND(COALESCE(ts.total_worked_minutes, 0) / 60.0, 1)::numeric AS total_worked_hours,
                   ROUND(COALESCE(ts.total_overtime_minutes, 0) / 60.0, 1)::numeric AS total_overtime_hours,
                   COALESCE(tks.tasks_assigned, 0)::int AS tasks_assigned,
                   COALESCE(tks.tasks_done, 0)::int AS tasks_done,
                   COALESCE(tks.tasks_overdue, 0)::int AS tasks_overdue,
                   COALESCE(os.onboarding_total, 0)::int AS onboarding_total,
                   COALESCE(os.onboarding_completed, 0)::int AS onboarding_completed,
                   COALESCE(os.onboarding_active, 0)::int AS onboarding_active,
                   COALESCE(os.onboarding_total_items, 0)::int AS onboarding_total_items,
                   COALESCE(os.onboarding_completed_items, 0)::int AS onboarding_completed_items,
                   COALESCE(cs.events_period, 0)::int AS events_period,
                   s.avg_rating,
                   s.total_ratings
            FROM active_staff s
            LEFT JOIN shift_stats ss ON ss.staff_id = s.id
            LEFT JOIN time_stats ts ON ts.staff_id = s.id
            LEFT JOIN task_stats tks ON tks.staff_id = s.id
            LEFT JOIN onboarding_stats os ON os.staff_id = s.id
            LEFT JOIN contribution_stats cs ON cs.staff_id = s.id
        ),
        scored AS (
            SELECT *,
                   CASE WHEN days_scheduled > 0 THEN ROUND(days_worked::numeric / days_scheduled * 100)::int ELSE NULL END AS attendance_rate,
                   CASE WHEN days_scheduled > 0 OR days_worked > 0 THEN GREATEST(0, 100 - (late_count * 10) - (days_absent * 25))::int ELSE NULL END AS reliability_score,
                   CASE WHEN tasks_assigned > 0 THEN ROUND(tasks_done::numeric / tasks_assigned * 100)::int ELSE NULL END AS task_completion_rate,
                   CASE
                       WHEN onboarding_total_items > 0 THEN ROUND(onboarding_completed_items::numeric / onboarding_total_items * 100)::int
                       WHEN onboarding_total > 0 THEN ROUND(onboarding_completed::numeric / onboarding_total * 100)::int
                       ELSE NULL
                   END AS development_rate,
                   CASE WHEN events_period > 0 THEN LEAST(100, events_period * 10)::int ELSE NULL END AS contribution_score
            FROM base_metrics
        )
        SELECT *,
               COALESCE((
                   SELECT ROUND(AVG(value))::int
                   FROM unnest(ARRAY[attendance_rate, reliability_score, task_completion_rate, development_rate, contribution_score]) AS metric(value)
                   WHERE value IS NOT NULL
               ), 0)::int AS kpi_score
        FROM scored
        ORDER BY kpi_score DESC, staff_name
    `, [month]);
    const data = result.rows.map(row => ({
        staff_id: Number(row.staff_id),
        staff_name: row.staff_name,
        department: row.department,
        role_type: row.role_type,
        color: row.color,
        photo_url: row.photo_url,
        days_scheduled: Number(row.days_scheduled || 0),
        days_worked: Number(row.days_worked || 0),
        late_count: Number(row.late_count || 0),
        days_absent: Number(row.days_absent || 0),
        total_late_minutes: Number(row.total_late_minutes || 0),
        total_worked_hours: Number(row.total_worked_hours || 0),
        total_overtime_hours: Number(row.total_overtime_hours || 0),
        attendance_rate: row.attendance_rate === null ? null : Number(row.attendance_rate),
        reliability_score: row.reliability_score === null ? null : Number(row.reliability_score),
        task_kpi: {
            tasks_assigned: Number(row.tasks_assigned || 0),
            tasks_done: Number(row.tasks_done || 0),
            tasks_overdue: Number(row.tasks_overdue || 0)
        },
        task_completion_rate: row.task_completion_rate === null ? null : Number(row.task_completion_rate),
        development_kpi: {
            total: Number(row.onboarding_total || 0),
            completed: Number(row.onboarding_completed || 0),
            active: Number(row.onboarding_active || 0),
            total_items: Number(row.onboarding_total_items || 0),
            completed_items: Number(row.onboarding_completed_items || 0),
            percent: row.development_rate === null ? null : Number(row.development_rate)
        },
        contribution_kpi: {
            events_period: Number(row.events_period || 0),
            score: row.contribution_score === null ? null : Number(row.contribution_score),
            avg_rating: Number(row.avg_rating || 0),
            total_ratings: Number(row.total_ratings || 0)
        },
        kpi_score: Number(row.kpi_score || 0)
    }));
    return {
        month,
        data,
        sources: {
            staffRows: data.length,
            scheduleRows: data.filter(row => row.days_scheduled > 0).length,
            taskRows: data.filter(row => row.task_kpi.tasks_assigned > 0).length,
            onboardingRows: data.filter(row => row.development_kpi.total > 0).length,
            contributionRows: data.filter(row => row.contribution_kpi.events_period > 0 || row.contribution_kpi.total_ratings > 0).length
        }
    };
}

function normalizeAuditValue(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(item => String(item)).sort();
    if (value && typeof value === 'object') {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return String(value);
        }
    }
    if (value === undefined) return null;
    return value;
}

function auditValuesEqual(a, b) {
    return JSON.stringify(normalizeAuditValue(a)) === JSON.stringify(normalizeAuditValue(b));
}

function buildStaffProfileChanges(before = {}, after = {}, fields = []) {
    const changes = {};
    fields.forEach(field => {
        const beforeValue = field === 'secondary_professions'
            ? staffProfessionKeys({ role_type: null, secondary_professions: before.secondary_professions })
            : before[field];
        const afterValue = field === 'secondary_professions'
            ? staffProfessionKeys({ role_type: null, secondary_professions: after.secondary_professions })
            : after[field];
        if (!auditValuesEqual(beforeValue, afterValue)) {
            changes[field] = {
                from: normalizeAuditValue(beforeValue),
                to: normalizeAuditValue(afterValue)
            };
        }
    });
    return changes;
}

async function mirrorHrShiftToStaffSchedule(shift, db = pool) {
    const date = toDateOnly(shift?.shift_date);
    if (!shift?.staff_id || !date) return;
    await db.query(
        `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (staff_id, date)
         DO UPDATE SET shift_start = EXCLUDED.shift_start,
                       shift_end = EXCLUDED.shift_end,
                       status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       profession_key = EXCLUDED.profession_key`,
        [
            shift.staff_id,
            date,
            shift.planned_start || null,
            shift.planned_end || null,
            staffScheduleStatusForShift(shift.shift_type),
            buildReplacementNote(shift),
            shift.profession_key || null
        ]
    );
}

async function removeMirroredStaffSchedule(staffId, shiftDate, db = pool) {
    const date = toDateOnly(shiftDate);
    if (!staffId || !date) return;
    await db.query(
        `DELETE FROM staff_schedule
         WHERE staff_id = $1
           AND date = $2
           AND status IN ('working', 'remote')`,
        [staffId, date]
    );
}

// ==========================================
// PROFESSIONS CATALOG
// ==========================================

router.get('/professions', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, key, title, department, short_info, responsibilities, checklist,
                    color, structure_node_id, sort_order, is_active, created_at, updated_at
             FROM hr_professions
             ORDER BY is_active DESC, sort_order ASC, title ASC`
        );
        res.json({
            success: true,
            data: result.rows.map(normalizeProfessionCatalogRow)
        });
    } catch (err) {
        log.error('GET /hr/professions error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/professions', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const payload = normalizeProfessionPayload(req.body);
        if (!payload.key || !payload.title) {
            return res.status(400).json({ success: false, error: 'Потрібні key і title професії' });
        }
        const result = await pool.query(
            `INSERT INTO hr_professions (key, title, department, short_info, responsibilities, checklist, color, structure_node_id, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
             RETURNING *`,
            [
                payload.key,
                payload.title,
                payload.department,
                payload.shortInfo,
                JSON.stringify(payload.responsibilities),
                JSON.stringify(payload.checklist),
                payload.color,
                payload.structureNodeId,
                payload.sortOrder,
                payload.isActive
            ]
        );
        await auditLog('profession_create', null, req.user?.username, { key: payload.key }, req.ip);
        res.json({ success: true, data: normalizeProfessionCatalogRow(result.rows[0]) });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Професія з таким key вже існує' });
        }
        log.error('POST /hr/professions error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/professions/:id', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const current = await pool.query('SELECT * FROM hr_professions WHERE id = $1', [req.params.id]);
        if (!current.rows.length) return res.status(404).json({ success: false, error: 'Професію не знайдено' });
        const payload = normalizeProfessionPayload(req.body, current.rows[0]);
        if (!payload.key || !payload.title) {
            return res.status(400).json({ success: false, error: 'Потрібні key і title професії' });
        }
        const currentKey = normalizeProfessionKey(current.rows[0].key);
        if (payload.key !== currentKey) {
            return res.status(409).json({
                success: false,
                error: 'Key професії не можна змінювати після створення. Змініть назву або створіть нову професію.'
            });
        }
        const result = await pool.query(
            `UPDATE hr_professions SET
                title = $1,
                department = $2,
                short_info = $3,
                responsibilities = $4::jsonb,
                checklist = $5::jsonb,
                color = $6,
                structure_node_id = $7,
                sort_order = $8,
                is_active = $9,
                updated_at = NOW()
             WHERE id = $10
             RETURNING *`,
            [
                payload.title,
                payload.department,
                payload.shortInfo,
                JSON.stringify(payload.responsibilities),
                JSON.stringify(payload.checklist),
                payload.color,
                payload.structureNodeId,
                payload.sortOrder,
                payload.isActive,
                req.params.id
            ]
        );
        await auditLog('profession_update', null, req.user?.username, { id: req.params.id, key: currentKey }, req.ip);
        res.json({ success: true, data: normalizeProfessionCatalogRow(result.rows[0]) });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Професія з таким key вже існує' });
        }
        log.error('PUT /hr/professions/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// STAFF HR DATA
// ==========================================

// GET /api/hr/staff — list all staff with HR fields (v39.8: filter freelance, add is_freelance)
router.get('/staff', async (req, res) => {
    try {
        const { active, role_type, include_freelance } = req.query;
        let sql = `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hire_date, birth_date, address, is_active, hourly_rate, company_structure_node_id, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    is_freelance, unique_person_key, hr_pool_status, blacklist_reason, blacklisted_at,
                    termination_date, termination_reason, termination_recorded_at, termination_recorded_by,
                    (EXISTS(SELECT 1 FROM staff_face_descriptors sfd WHERE sfd.staff_id = staff.id)) AS has_face_descriptor,
                    (EXISTS(SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = staff.id AND ep.is_active = true)) AS has_account
                    FROM staff`;
        const params = [];
        const conds = [];
        if (active !== undefined) {
            params.push(active === 'true');
            conds.push(`is_active = $${params.length}`);
        }
        if (role_type) {
            params.push(role_type);
            conds.push(`(role_type = $${params.length} OR COALESCE(secondary_professions, '[]'::jsonb) ? $${params.length})`);
        }
        // v39.8: hide freelance placeholder slots by default
        if (include_freelance !== 'true') {
            conds.push(`(is_freelance = false OR is_freelance IS NULL)`);
        }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY name';
        const result = await pool.query(sql, params);
        await attachStaffProfessionRates(result.rows);
        await attachTrainingReadiness(result.rows);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/history', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
        const result = await pool.query(
            `SELECT id, action, staff_id, performed_by, details, ip_address, created_at
             FROM hr_audit_log
             WHERE staff_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2`,
            [req.params.id, limit]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff/:id/history error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/staff/:id/profession-checklist', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr'), async (req, res) => {
    try {
        const professionKey = normalizeProfessionKey(req.body.profession_key ?? req.body.professionKey);
        const checklistKey = String(req.body.checklist_key ?? req.body.checklistKey ?? '').trim().slice(0, 128);
        const title = String(req.body.title || '').replace(/\u0000/g, '').trim().slice(0, 500);
        const completed = req.body.completed !== false && req.body.completed !== 'false';
        const notes = String(req.body.notes || '').replace(/\u0000/g, '').trim().slice(0, 1000) || null;
        if (!professionKey || !checklistKey || !title) {
            return res.status(400).json({ success: false, error: 'Потрібні profession_key, checklist_key та title' });
        }
        const assignment = await resolveStaffProfessionAssignment(pool, req.params.id, professionKey, { requireActive: false });
        if (!assignment.ok) {
            return res.status(assignment.status || 400).json({ success: false, error: assignment.error });
        }
        const result = await pool.query(
            `INSERT INTO hr_staff_profession_checklist_progress
                (staff_id, profession_key, checklist_key, title, completed_at, completed_by, notes, updated_at)
             VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN NOW() ELSE NULL END, $6, $7, NOW())
             ON CONFLICT (staff_id, profession_key, checklist_key) DO UPDATE SET
                title = EXCLUDED.title,
                completed_at = CASE WHEN $5 THEN COALESCE(hr_staff_profession_checklist_progress.completed_at, NOW()) ELSE NULL END,
                completed_by = CASE WHEN $5 THEN $6 ELSE NULL END,
                notes = EXCLUDED.notes,
                updated_at = NOW()
             RETURNING *`,
            [req.params.id, professionKey, checklistKey, title, completed, req.user?.username || null, notes]
        );
        await auditLog('staff_profession_checklist_update', parseInt(req.params.id), req.user?.username, {
            profession_key: professionKey,
            checklist_key: checklistKey,
            title,
            completed
        }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/profession-checklist error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/staff/:id — full profile
router.get('/staff/:id', async (req, res) => {
    try {
        const staff = await pool.query(
            `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hire_date, birth_date, address, is_active, hourly_rate, company_structure_node_id, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    hr_pool_status, blacklist_reason, blacklisted_at,
                    termination_date, termination_reason, termination_recorded_at, termination_recorded_by
             FROM staff WHERE id = $1`, [req.params.id]
        );
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await attachStaffProfessionRates(staff.rows);
        await attachTrainingReadiness(staff.rows);
        res.json({ success: true, data: staff.rows[0] });
    } catch (err) {
        log.error('GET /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/staff/:id/documents — private metadata only; binary is served by guarded download route.
router.get('/staff/:id/documents', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const includeArchived = req.query.include_archived === 'true';
        let sql = `SELECT id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                          file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                          archived_at, archived_by, created_at, updated_at
                   FROM staff_documents
                   WHERE staff_id = $1`;
        if (!includeArchived) sql += ` AND status = 'active'`;
        sql += ` ORDER BY expires_at ASC NULLS LAST, created_at DESC, id DESC`;
        const result = await pool.query(sql, [req.params.id]);
        res.json({ success: true, data: result.rows.map(staffDocumentMeta) });
    } catch (err) {
        log.error('GET /hr/staff/:id/documents error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/staff/:id/documents — private DB-backed upload, never public /uploads.
router.post('/staff/:id/documents', requireHrManage, handleStaffDocumentUpload, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const file = req.file;
        if (!file?.buffer?.length) return res.status(400).json({ success: false, error: 'Файл обовʼязковий' });

        const documentType = normalizeStaffDocumentType(req.body.document_type || req.body.documentType);
        const originalName = cleanStaffText(file.originalname, 255) || 'document';
        const title = cleanStaffText(req.body.title, 160) || path.basename(originalName, staffDocumentFileExt(file)) || 'HR-документ';
        const mimeType = cleanStaffText(file.mimetype, 120) || 'application/octet-stream';
        const fileExt = staffDocumentFileExt(file).slice(0, 16) || null;
        const fileSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const issuedAt = cleanStaffDate(req.body.issued_at || req.body.issuedAt);
        const expiresAt = cleanStaffDate(req.body.expires_at || req.body.expiresAt);
        const notes = cleanStaffText(req.body.notes, 2000);

        const result = await pool.query(
            `INSERT INTO staff_documents
                (staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                 file_sha256, file_data, issued_at, expires_at, notes, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                       file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                       archived_at, archived_by, created_at, updated_at`,
            [
                req.params.id,
                documentType,
                title,
                originalName,
                mimeType,
                fileExt,
                file.size,
                fileSha256,
                file.buffer,
                issuedAt,
                expiresAt,
                notes,
                req.user?.username || null
            ]
        );
        await auditLog('staff_document_upload', parseInt(req.params.id), req.user?.username, {
            document_id: result.rows[0].id,
            document_type: documentType,
            title,
            original_name: originalName,
            file_size: file.size
        }, req.ip);
        res.json({ success: true, data: staffDocumentMeta(result.rows[0]) });
    } catch (err) {
        log.error('POST /hr/staff/:id/documents error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/documents/:documentId/download', requireHrManage, async (req, res) => {
    try {
        if (!/^[0-9]+$/.test(String(req.params.documentId || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid document ID' });
        }
        const result = await pool.query(
            `SELECT id, staff_id, original_name, mime_type, file_size, file_data
             FROM staff_documents
             WHERE id = $1 AND staff_id = $2`,
            [req.params.documentId, req.params.id]
        );
        const doc = result.rows[0];
        if (!doc) return res.status(404).json({ success: false, error: 'Документ не знайдено' });
        res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', String(doc.file_size || doc.file_data.length || 0));
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadFilename(doc.original_name)}"`);
        res.send(doc.file_data);
    } catch (err) {
        log.error('GET /hr/staff/:id/documents/:documentId/download error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.delete('/staff/:id/documents/:documentId', requireHrManage, async (req, res) => {
    try {
        if (!/^[0-9]+$/.test(String(req.params.documentId || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid document ID' });
        }
        const result = await pool.query(
            `UPDATE staff_documents
             SET status = 'archived', archived_at = NOW(), archived_by = $3, updated_at = NOW()
             WHERE id = $1 AND staff_id = $2
             RETURNING id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                       file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                       archived_at, archived_by, created_at, updated_at`,
            [req.params.documentId, req.params.id, req.user?.username || null]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Документ не знайдено' });
        await auditLog('staff_document_archive', parseInt(req.params.id), req.user?.username, {
            document_id: result.rows[0].id,
            title: result.rows[0].title
        }, req.ip);
        res.json({ success: true, data: staffDocumentMeta(result.rows[0]) });
    } catch (err) {
        log.error('DELETE /hr/staff/:id/documents/:documentId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/medical-book', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const result = await pool.query(
            `SELECT sc.*, sd.title AS document_title
             FROM staff_certifications sc
             LEFT JOIN staff_documents sd ON sd.id = sc.document_id
             WHERE sc.staff_id = $1 AND sc.category = 'medical_book'
             ORDER BY sc.expires_at DESC NULLS LAST, sc.created_at DESC, sc.id DESC`,
            [req.params.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff/:id/medical-book error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/staff/:id/medical-book', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const issuedAt = cleanStaffDate(req.body.issued_at || req.body.issuedAt);
        const expiresAt = cleanStaffDate(req.body.expires_at || req.body.expiresAt);
        const notes = cleanStaffText(req.body.notes, 2000);
        const documentId = numberOrNull(req.body.document_id || req.body.documentId);
        let status = normalizeStaffCertificationStatus(req.body.status);
        if (expiresAt && new Date(`${expiresAt}T00:00:00Z`) < new Date()) status = 'expired';
        const result = await pool.query(
            `INSERT INTO staff_certifications
                (staff_id, name, category, issued_at, expires_at, status, notes, document_id, business_context)
             VALUES ($1, 'Медкнижка', 'medical_book', $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                req.params.id,
                issuedAt,
                expiresAt,
                status,
                notes,
                documentId,
                cleanStaffText(req.body.business_context || req.body.businessContext, 64)
            ]
        );
        await auditLog('medical_book_update', parseInt(req.params.id), req.user?.username, {
            certification_id: result.rows[0].id,
            expires_at: expiresAt,
            status
        }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/staff/:id/medical-book error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/resources', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const includeReturned = req.query.include_returned === 'true';
        let sql = `SELECT sra.*, ws.name AS warehouse_stock_name, c.name AS costume_name
                   FROM staff_resource_assignments sra
                   LEFT JOIN warehouse_stock ws ON ws.id = sra.warehouse_stock_id
                   LEFT JOIN costumes c ON c.id = sra.costume_id
                   WHERE sra.staff_id = $1`;
        if (!includeReturned) sql += ` AND sra.status = 'issued'`;
        sql += ` ORDER BY sra.status = 'issued' DESC, sra.due_return_at ASC NULLS LAST, sra.created_at DESC`;
        const result = await pool.query(sql, [req.params.id]);
        res.json({ success: true, data: result.rows.map(staffResourceAssignmentMeta) });
    } catch (err) {
        log.error('GET /hr/staff/:id/resources error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/resource-options', requireHrManage, async (req, res) => {
    try {
        const kind = normalizeStaffResourceKind(req.query.kind);
        const query = cleanStaffText(req.query.q || req.query.search, 80);
        const limit = Math.max(1, Math.min(80, Number(req.query.limit || 50)));
        if (kind === 'warehouse_stock') {
            const businessContext = hrBusinessContextFromRequest(req);
            const params = [businessContext];
            const conditions = [
                `COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1`,
                'ws.is_active = true'
            ];
            if (query) {
                params.push(`%${query}%`);
                conditions.push(`(
                    ws.name ILIKE $${params.length}
                    OR COALESCE(ws.category, '') ILIKE $${params.length}
                    OR COALESCE(ws.sku, '') ILIKE $${params.length}
                    OR COALESCE(wl.name, '') ILIKE $${params.length}
                )`);
            }
            params.push(limit);
            const result = await pool.query(
                `SELECT ws.id, ws.name, ws.category, ws.quantity, ws.unit, ws.owner,
                        ws.location_id, wl.name AS location_name
                 FROM warehouse_stock ws
                 LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY ws.quantity > 0 DESC, wl.sort_order NULLS LAST, ws.category, ws.name
                 LIMIT $${params.length}`,
                params
            );
            return res.json({
                success: true,
                kind,
                data: result.rows.map(row => ({
                    id: row.id,
                    kind,
                    label: row.name,
                    subtitle: [row.category, row.location_name, `${Number(row.quantity || 0)} ${row.unit || 'шт'}`].filter(Boolean).join(' · '),
                    category: row.category,
                    quantity: Number(row.quantity || 0),
                    unit: row.unit || 'шт',
                    owner: row.owner || 'park',
                    location_id: row.location_id,
                    location_name: row.location_name
                }))
            });
        }
        if (kind === 'costume') {
            const params = [];
            const conditions = [];
            if (query) {
                params.push(`%${query}%`);
                conditions.push(`(
                    c.name ILIKE $${params.length}
                    OR COALESCE(c.category, '') ILIKE $${params.length}
                    OR COALESCE(c.size, '') ILIKE $${params.length}
                    OR COALESCE(c.condition, '') ILIKE $${params.length}
                    OR COALESCE(s.name, '') ILIKE $${params.length}
                )`);
            }
            params.push(limit);
            const result = await pool.query(
                `SELECT c.id, c.name, c.category, c.size, c.condition, c.assigned_to, s.name AS assigned_name
                 FROM costumes c
                 LEFT JOIN staff s ON s.id = c.assigned_to
                 ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
                 ORDER BY c.assigned_to IS NULL DESC, c.name
                 LIMIT $${params.length}`,
                params
            );
            return res.json({
                success: true,
                kind,
                data: result.rows.map(row => ({
                    id: row.id,
                    kind,
                    label: row.name,
                    subtitle: [row.category, row.size, row.condition, row.assigned_name ? `закріплено: ${row.assigned_name}` : 'вільний'].filter(Boolean).join(' · '),
                    category: row.category,
                    size: row.size,
                    condition: row.condition,
                    assigned_to: row.assigned_to,
                    assigned_name: row.assigned_name,
                    is_available: !row.assigned_to
                }))
            });
        }
        res.json({ success: true, kind: 'custom', data: [] });
    } catch (err) {
        log.error('GET /hr/resource-options error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження ресурсів' });
    }
});

router.post('/staff/:id/resources', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const resourceKind = normalizeStaffResourceKind(req.body.resource_kind || req.body.resourceKind);
        const warehouseStockId = resourceKind === 'warehouse_stock' ? numberOrNull(req.body.warehouse_stock_id || req.body.warehouseStockId) : null;
        const costumeId = resourceKind === 'costume' ? numberOrNull(req.body.costume_id || req.body.costumeId) : null;
        const requestedQuantity = numberOrNull(req.body.quantity);
        const quantity = requestedQuantity === null ? 1 : requestedQuantity;
        const issuedAt = cleanStaffDate(req.body.issued_at || req.body.issuedAt) || todayKyiv();
        const dueReturnAt = cleanStaffDate(req.body.due_return_at || req.body.dueReturnAt);
        const notes = cleanStaffText(req.body.notes, 2000);
        const actor = req.user?.username || null;
        const businessContext = hrBusinessContextFromRequest(req);
        let title = cleanStaffText(req.body.title, 160);

        await client.query('BEGIN');
        const staff = await loadStaffRowOrNull(req.params.id, client, { lock: true });
        if (!staff) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        }
        if (resourceKind === 'warehouse_stock' && !warehouseStockId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Виберіть складську позицію' });
        }
        if (resourceKind === 'costume' && !costumeId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Виберіть костюм' });
        }
        if (quantity <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Кількість має бути більшою за нуль' });
        }
        if (resourceKind === 'warehouse_stock' && !Number.isInteger(quantity)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Кількість складського ресурсу має бути цілим числом' });
        }

        let warehouseStock = null;
        if (warehouseStockId) {
            const stock = await client.query(
                `SELECT id, name, quantity, unit, location_id, business_context
                 FROM warehouse_stock
                 WHERE id = $1
                   AND is_active = true
                   AND COALESCE(business_context, $2) = $3
                 FOR UPDATE`,
                [warehouseStockId, DEFAULT_BUSINESS_CONTEXT, businessContext]
            );
            warehouseStock = stock.rows[0] || null;
            if (!warehouseStock) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Складську позицію не знайдено' });
            }
            if (Number(warehouseStock.quantity || 0) < quantity) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: `Недостатньо на складі: доступно ${Number(warehouseStock.quantity || 0)} ${warehouseStock.unit || 'шт.'}` });
            }
            if (!title) title = warehouseStock.name || null;
        }
        let costume = null;
        if (costumeId) {
            const costumeResult = await client.query('SELECT name, assigned_to FROM costumes WHERE id = $1 FOR UPDATE', [costumeId]);
            costume = costumeResult.rows[0] || null;
            if (!costume) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Костюм не знайдено' });
            }
            const assignedTo = Number(costume.assigned_to || 0);
            if (assignedTo && assignedTo !== Number(req.params.id)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'Костюм вже закріплено за іншим співробітником' });
            }
            if (!title) title = costume.name || null;
        }
        if (!title) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Назва ресурсу обовʼязкова' });
        }
        const result = await client.query(
            `INSERT INTO staff_resource_assignments
                (staff_id, resource_kind, warehouse_stock_id, costume_id, title, quantity,
                 issued_at, due_return_at, notes, issued_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [req.params.id, resourceKind, warehouseStockId, costumeId, title, quantity, issuedAt, dueReturnAt, notes, actor]
        );
        let assignment = result.rows[0];

        if (warehouseStockId && warehouseStock) {
            const reason = `HR-видача співробітнику: ${staff.name || `#${req.params.id}`}`;
            await client.query(
                `UPDATE warehouse_stock
                 SET quantity = quantity - $1, updated_at = NOW(), updated_by = $2
                 WHERE id = $3`,
                [quantity, actor, warehouseStockId]
            );
            await client.query(
                `INSERT INTO warehouse_history (stock_id, change, reason, created_by, business_context)
                 VALUES ($1, $2, $3, $4, $5)`,
                [warehouseStockId, -quantity, reason, actor, businessContext]
            );
            const movement = await client.query(
                `INSERT INTO warehouse_stock_movements (
                    warehouse_stock_id, movement_type, from_location_id, to_location_id,
                    quantity, reason, created_by, business_context
                 )
                 VALUES ($1, 'issue', $2, NULL, $3, $4, $5, $6)
                 RETURNING id`,
                [warehouseStockId, warehouseStock.location_id || null, quantity, reason, actor, businessContext]
            );
            const linked = await client.query(
                `UPDATE staff_resource_assignments
                 SET warehouse_issue_movement_id = $2, updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [assignment.id, movement.rows[0].id]
            );
            assignment = linked.rows[0];
            assignment.warehouse_stock_name = warehouseStock.name;
        }
        if (costumeId) {
            await client.query(
                `UPDATE costumes
                 SET assigned_to = $2, assigned_at = NOW()
                 WHERE id = $1 AND (assigned_to IS NULL OR assigned_to = $2)`,
                [costumeId, req.params.id]
            );
            assignment.costume_name = costume?.name || null;
        }
        await client.query('COMMIT');
        await auditLog('staff_resource_issue', parseInt(req.params.id), actor, {
            assignment_id: assignment.id,
            resource_kind: resourceKind,
            warehouse_stock_id: warehouseStockId,
            costume_id: costumeId,
            warehouse_issue_movement_id: assignment.warehouse_issue_movement_id || null,
            quantity,
            title,
            due_return_at: dueReturnAt
        }, req.ip);
        res.json({ success: true, data: staffResourceAssignmentMeta(assignment) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/staff/:id/resources error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

router.put('/staff/:id/resources/:assignmentId/return', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        if (!/^[0-9]+$/.test(String(req.params.assignmentId || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid assignment ID' });
        }
        const returnedAt = cleanStaffDate(req.body.returned_at || req.body.returnedAt) || todayKyiv();
        const actor = req.user?.username || null;
        await client.query('BEGIN');
        const assignmentResult = await client.query(
            `SELECT sra.*, ws.name AS warehouse_stock_name, ws.location_id AS warehouse_location_id,
                    ws.business_context AS warehouse_business_context, c.name AS costume_name
             FROM staff_resource_assignments sra
             LEFT JOIN warehouse_stock ws ON ws.id = sra.warehouse_stock_id
             LEFT JOIN costumes c ON c.id = sra.costume_id
             WHERE sra.id = $1 AND sra.staff_id = $2
             FOR UPDATE OF sra`,
            [req.params.assignmentId, req.params.id]
        );
        const existing = assignmentResult.rows[0] || null;
        if (!existing) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Ресурс не знайдено' });
        }
        if (existing.status !== 'issued') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Ресурс вже не має статусу “видано”' });
        }

        let returnMovementId = null;
        if (existing.warehouse_stock_id) {
            const stock = await client.query(
                `SELECT id, location_id, business_context
                 FROM warehouse_stock
                 WHERE id = $1
                 FOR UPDATE`,
                [existing.warehouse_stock_id]
            );
            if (stock.rows[0]) {
                const stockRow = stock.rows[0];
                const businessContext = stockRow.business_context || DEFAULT_BUSINESS_CONTEXT;
                const reason = `HR-повернення від співробітника #${req.params.id}`;
                await client.query(
                    `UPDATE warehouse_stock
                     SET quantity = quantity + $1, updated_at = NOW(), updated_by = $2
                     WHERE id = $3`,
                    [existing.quantity, actor, existing.warehouse_stock_id]
                );
                await client.query(
                    `INSERT INTO warehouse_history (stock_id, change, reason, created_by, business_context)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [existing.warehouse_stock_id, existing.quantity, reason, actor, businessContext]
                );
                const movement = await client.query(
                    `INSERT INTO warehouse_stock_movements (
                        warehouse_stock_id, movement_type, from_location_id, to_location_id,
                        quantity, reason, created_by, business_context
                     )
                     VALUES ($1, 'return', NULL, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    [existing.warehouse_stock_id, stockRow.location_id || null, existing.quantity, reason, actor, businessContext]
                );
                returnMovementId = movement.rows[0].id;
            }
        }

        const result = await client.query(
            `UPDATE staff_resource_assignments
             SET status = 'returned',
                 returned_at = $3,
                 returned_by = $4,
                 warehouse_return_movement_id = $5,
                 updated_at = NOW()
             WHERE id = $1 AND staff_id = $2
             RETURNING *`,
            [req.params.assignmentId, req.params.id, returnedAt, actor, returnMovementId]
        );
        if (result.rows[0].costume_id) {
            await client.query(
                `UPDATE costumes
                 SET assigned_to = NULL, assigned_at = NULL
                 WHERE id = $1 AND assigned_to = $2`,
                [result.rows[0].costume_id, req.params.id]
            );
        }
        await client.query('COMMIT');
        const assignment = {
            ...result.rows[0],
            warehouse_stock_name: existing.warehouse_stock_name || null,
            costume_name: existing.costume_name || null
        };
        await auditLog('staff_resource_return', parseInt(req.params.id), actor, {
            assignment_id: result.rows[0].id,
            title: result.rows[0].title,
            warehouse_stock_id: result.rows[0].warehouse_stock_id || null,
            costume_id: result.rows[0].costume_id || null,
            warehouse_return_movement_id: returnMovementId,
            returned_at: returnedAt
        }, req.ip);
        res.json({ success: true, data: staffResourceAssignmentMeta(assignment) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/staff/:id/resources/:assignmentId/return error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

router.get('/staff/:id/payroll-scheme', requireHrManage, async (req, res) => {
    try {
        const staff = await pool.query('SELECT id, name, hourly_rate FROM staff WHERE id = $1', [req.params.id]);
        if (!staff.rows.length) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const schemes = await loadPayrollSchemesForStaff(req.params.id);
        res.json({
            success: true,
            data: {
                staff_id: Number(req.params.id),
                active_scheme: schemes.find(scheme => scheme.is_active) || null,
                schemes,
                scheme_types: PAYROLL_SCHEME_TYPES.map(type => ({ value: type, label: payrollSchemeTypeTitle(type) })),
                fallback_hourly_rate: Number(staff.rows[0].hourly_rate || 0)
            }
        });
    } catch (err) {
        log.error('GET /hr/staff/:id/payroll-scheme error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження зарплатної схеми' });
    }
});

router.put('/staff/:id/payroll-scheme', requireHrManage, async (req, res) => {
    try {
        const staff = await pool.query('SELECT id, name, hourly_rate FROM staff WHERE id = $1', [req.params.id]);
        if (!staff.rows.length) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const schemeType = normalizePayrollSchemeType(req.body.scheme_type || req.body.schemeType);
        const config = payrollSchemeConfigFromRequest(schemeType, req.body || {}, staff.rows[0].hourly_rate);
        const title = cleanStaffText(req.body.title, 160) || payrollSchemeTypeTitle(schemeType);
        const scheme = await createPayrollScheme({
            staffId: req.params.id,
            schemeType,
            title,
            config,
            effectiveFrom: cleanStaffDate(req.body.effective_from || req.body.effectiveFrom),
            effectiveTo: cleanStaffDate(req.body.effective_to || req.body.effectiveTo),
            isActive: true
        }, req.user);
        await auditLog('staff_payroll_scheme_update', parseInt(req.params.id), req.user?.username, {
            scheme_id: scheme.id,
            scheme_type: scheme.schemeType,
            title: scheme.title
        }, req.ip);
        res.json({ success: true, data: scheme });
    } catch (err) {
        log.error('PUT /hr/staff/:id/payroll-scheme error', err);
        res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Помилка оновлення зарплатної схеми' });
    }
});

router.get('/staff/:id/role-assignments', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const data = await loadStaffRoleAssignments(req.params.id);
        res.json({ success: true, data });
    } catch (err) {
        log.error('GET /hr/staff/:id/role-assignments error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження ролей' });
    }
});

router.get('/role-assignments/report', async (req, res) => {
    try {
        const includeInactive = req.query.include_inactive === 'true';
        const whereSql = includeInactive ? '' : 'WHERE COALESCE(s.is_active, true) = true';
        const summary = await pool.query(
            `SELECT
                COUNT(DISTINCT s.id)::int AS staff_count,
                COUNT(*)::int AS role_count,
                COUNT(*) FILTER (WHERE sra.status = 'active')::int AS active_roles,
                COUNT(*) FILTER (WHERE sra.status = 'suspended')::int AS suspended_roles,
                COUNT(*) FILTER (WHERE sra.status = 'inactive')::int AS inactive_roles,
                COUNT(*) FILTER (WHERE sra.admission_status = 'approved')::int AS approved_admissions,
                COUNT(*) FILTER (WHERE sra.admission_status = 'pending')::int AS pending_admissions,
                COUNT(*) FILTER (WHERE sra.admission_status = 'blocked')::int AS blocked_admissions,
                COUNT(*) FILTER (WHERE sra.internship_status = 'in_progress')::int AS internships_in_progress,
                COUNT(*) FILTER (WHERE sra.internship_status = 'completed')::int AS internships_completed
             FROM staff_role_assignments sra
             JOIN staff s ON s.id = sra.staff_id
             ${whereSql}`
        );
        const rows = await pool.query(
            `SELECT sra.id, sra.staff_id, s.name AS staff_name, s.position, s.department, s.is_active,
                    sra.profession_key, COALESCE(hp.title, sra.profession_key) AS profession_title,
                    sra.is_primary, sra.status, sra.admission_status, sra.internship_status,
                    sra.updated_at
             FROM staff_role_assignments sra
             JOIN staff s ON s.id = sra.staff_id
             LEFT JOIN hr_professions hp ON hp.key = sra.profession_key
             ${whereSql}
             ORDER BY
                CASE
                    WHEN sra.status = 'suspended' OR sra.admission_status = 'blocked' THEN 0
                    WHEN sra.admission_status = 'pending' OR sra.internship_status = 'in_progress' THEN 1
                    ELSE 2
                END,
                s.name,
                sra.is_primary DESC,
                sra.profession_key
             LIMIT 500`
        );
        res.json({
            success: true,
            summary: summary.rows[0] || {},
            data: rows.rows.map(row => ({
                id: row.id,
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                position: row.position,
                department: row.department,
                is_active: row.is_active === true,
                profession_key: normalizeProfessionKey(row.profession_key),
                profession_title: row.profession_title || row.profession_key,
                is_primary: row.is_primary === true,
                status: row.status || 'active',
                admission_status: row.admission_status || 'pending',
                internship_status: row.internship_status || 'none',
                updated_at: row.updated_at
            }))
        });
    } catch (err) {
        log.error('GET /hr/role-assignments/report error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження звіту по ролях' });
    }
});

router.put('/staff/:id/role-assignments', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const rawRows = Array.isArray(req.body.assignments) ? req.body.assignments : (Array.isArray(req.body.data) ? req.body.data : []);
        await client.query('BEGIN');
        const staffResult = await client.query(
            `SELECT id, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    is_active, hourly_rate
             FROM staff WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        const staff = staffResult.rows[0];
        if (!staff) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        }
        const requestedPrimary = normalizeProfessionKey(
            req.body.primary_role
            || req.body.primaryRole
            || (() => {
                const primaryRow = rawRows.find(row => row?.is_primary === true || row?.isPrimary === true);
                return primaryRow?.profession_key || primaryRow?.professionKey || primaryRow?.key;
            })()
            || staff.role_type
        );
        const rows = normalizeRoleAssignmentInputRows(rawRows, requestedPrimary);
        const primaryRole = rows.find(row => row.is_primary)?.profession_key || normalizeProfessionKey(staff.role_type);
        const secondaryRows = rows.filter(row => !row.is_primary).map(row => row.profession_key);
        const validation = await validateStaffProfessionInput(primaryRole, secondaryRows, {
            allowedExistingKeys: staffProfessionKeys(staff)
        });
        if (validation.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: validation.error });
        }
        const saved = await replaceStaffRoleAssignments(client, req.params.id, rows, req.user?.username || null);
        await client.query(
            `UPDATE staff
             SET role_type = $2,
                 secondary_professions = $3::jsonb,
                 hourly_rate = COALESCE($4, hourly_rate)
             WHERE id = $1`,
            [
                req.params.id,
                primaryRole,
                JSON.stringify(validation.secondaryProfessions || []),
                rows.find(row => row.is_primary && row.hourly_rate !== null)?.hourly_rate ?? null
            ]
        );
        const rateRows = rows
            .filter(row => row.hourly_rate !== null && Number(row.hourly_rate) > 0)
            .map(row => ({ profession_key: row.profession_key, hourly_rate: row.hourly_rate }));
        await replaceStaffProfessionRates(client, req.params.id, rateRows);
        await client.query('COMMIT');
        await auditLog('staff_role_assignments_update', parseInt(req.params.id), req.user?.username, {
            primary_role: primaryRole,
            secondary_professions: validation.secondaryProfessions || [],
            roles: saved.map(row => ({
                profession_key: row.profession_key,
                status: row.status,
                admission_status: row.admission_status,
                internship_status: row.internship_status
            }))
        }, req.ip);
        res.json({ success: true, data: saved });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/staff/:id/role-assignments error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення ролей' });
    } finally {
        client.release();
    }
});

router.get('/staff/:id/offboarding', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const result = await pool.query(
            `SELECT *
             FROM staff_offboarding_events
             WHERE staff_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT 20`,
            [req.params.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff/:id/offboarding error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/staff/:id/offboarding', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const reason = cleanStaffText(req.body.reason, 2000);
        if (!reason) return res.status(400).json({ success: false, error: 'Причина завершення співпраці обовʼязкова' });
        const effectiveDate = cleanStaffDate(req.body.effective_date || req.body.effectiveDate) || todayKyiv();
        const targetPoolStatus = normalizeStaffOffboardingPoolStatus(req.body.target_pool_status || req.body.targetPoolStatus);
        const accountAction = normalizeStaffOffboardingAccountAction(req.body.account_action || req.body.accountAction);
        const notes = cleanStaffText(req.body.notes, 2000);

        await client.query('BEGIN');
        const staff = await loadStaffRowOrNull(req.params.id, client, { lock: true });
        if (!staff) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        }
        const openResources = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM staff_resource_assignments
             WHERE staff_id = $1 AND status = 'issued'`,
            [req.params.id]
        );
        const openResourceCount = openResources.rows[0]?.count || 0;
        const event = await client.query(
            `INSERT INTO staff_offboarding_events
                (staff_id, status, effective_date, reason, target_pool_status, account_action,
                 resource_check_required, open_resource_count, notes, created_by, completed_by)
             VALUES ($1, 'completed', $2, $3, $4, $5, true, $6, $7, $8, $8)
             RETURNING *`,
            [
                req.params.id,
                effectiveDate,
                reason,
                targetPoolStatus,
                accountAction,
                openResourceCount,
                notes,
                req.user?.username || null
            ]
        );
        const staffUpdate = await client.query(
            `UPDATE staff
             SET is_active = false,
                 hr_pool_status = $2,
                 blacklist_reason = CASE WHEN $2 = 'blacklisted' THEN $3 ELSE NULL END,
                 blacklisted_at = CASE WHEN $2 = 'blacklisted' THEN COALESCE(blacklisted_at, NOW()) ELSE NULL END,
                 termination_date = $4,
                 termination_reason = $3,
                 termination_recorded_at = NOW(),
                 termination_recorded_by = $5
             WHERE id = $1
             RETURNING *`,
            [req.params.id, targetPoolStatus, reason, effectiveDate, req.user?.username || null]
        );
        let disabledAccounts = 0;
        if (accountAction === 'disable') {
            const disabledProfiles = await client.query(
                `UPDATE employee_profiles
                 SET is_active = false
                 WHERE staff_id = $1 AND is_active = true
                 RETURNING user_id`,
                [req.params.id]
            );
            const userIds = disabledProfiles.rows.map(row => Number(row.user_id)).filter(Number.isFinite);
            if (userIds.length) {
                const disabledUsers = await client.query(
                    `UPDATE users SET is_active = false WHERE id = ANY($1::int[]) RETURNING id`,
                    [userIds]
                );
                disabledAccounts = disabledUsers.rowCount || 0;
            }
        }
        await client.query('COMMIT');
        await auditLog('staff_offboarding_complete', parseInt(req.params.id), req.user?.username, {
            event_id: event.rows[0].id,
            effective_date: effectiveDate,
            target_pool_status: targetPoolStatus,
            account_action: accountAction,
            disabled_accounts: disabledAccounts,
            open_resource_count: openResourceCount
        }, req.ip);
        res.json({
            success: true,
            data: event.rows[0],
            staff: staffUpdate.rows[0],
            open_resource_count: openResourceCount,
            disabled_accounts: disabledAccounts
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/staff/:id/offboarding error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// PUT /api/hr/staff/:id — update HR fields
router.put('/staff/:id', requireHrManage, async (req, res) => {
    try {
        const { phone, emergency_contact, emergency_phone, role_type, hourly_rate, birth_date, address, notes, telegram_id, telegram_username, contract_type, skills, hr_pool_status, blacklist_reason, company_structure_node_id } = req.body;
        const hasBodyField = field => Object.prototype.hasOwnProperty.call(req.body || {}, field);
        const hasSecondaryProfessions = hasBodyField('secondary_professions') || hasBodyField('secondaryProfessions');
        const hasProfessionRates = hasBodyField('profession_rates') || hasBodyField('professionRates');
        const secondaryInput = hasBodyField('secondary_professions')
            ? req.body.secondary_professions
            : req.body.secondaryProfessions;
        const professionRateInput = hasBodyField('profession_rates')
            ? req.body.profession_rates
            : req.body.professionRates;
        const fieldPresence = {
            phone: hasBodyField('phone'),
            emergency_contact: hasBodyField('emergency_contact'),
            emergency_phone: hasBodyField('emergency_phone'),
            role_type: hasBodyField('role_type'),
            hourly_rate: hasBodyField('hourly_rate'),
            birth_date: hasBodyField('birth_date'),
            notes: hasBodyField('notes'),
            telegram_id: hasBodyField('telegram_id'),
            telegram_username: hasBodyField('telegram_username'),
            contract_type: hasBodyField('contract_type'),
            skills: hasBodyField('skills'),
            address: hasBodyField('address'),
            company_structure_node_id: hasBodyField('company_structure_node_id') || hasBodyField('companyStructureNodeId'),
            hr_pool_status: hasBodyField('hr_pool_status'),
            blacklist_reason: hasBodyField('blacklist_reason')
        };
        const beforeStaffResult = await pool.query(
            `SELECT id, phone, emergency_contact, emergency_phone, role_type,
                    COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hourly_rate, company_structure_node_id, birth_date, address, notes, telegram_id, telegram_username,
                    contract_type, skills, hr_pool_status, blacklist_reason, blacklisted_at
             FROM staff
             WHERE id = $1`,
            [req.params.id]
        );
        if (!beforeStaffResult.rows.length) return res.status(404).json({ success: false, error: 'Не знайдено' });
        const beforeStaff = beforeStaffResult.rows[0];
        let effectiveRoleType = fieldPresence.role_type ? role_type : null;
        if (hasSecondaryProfessions && !effectiveRoleType) {
            effectiveRoleType = beforeStaff.role_type;
        }
        const professionValidation = fieldPresence.role_type || hasSecondaryProfessions
            ? await validateStaffProfessionInput(effectiveRoleType, hasSecondaryProfessions ? secondaryInput : [], {
                allowedExistingKeys: staffProfessionKeys(beforeStaff)
            })
            : { secondaryProfessions: [] };
        if (professionValidation.error) {
            return res.status(400).json({ success: false, error: professionValidation.error });
        }
        const effectiveProfessionKeys = staffProfessionKeys({
            role_type: fieldPresence.role_type ? role_type : beforeStaff.role_type,
            secondary_professions: hasSecondaryProfessions ? professionValidation.secondaryProfessions : beforeStaff.secondary_professions
        });
        const normalizedProfessionRates = hasProfessionRates
            ? normalizeStaffProfessionRates(professionRateInput, effectiveProfessionKeys)
            : [];
        const beforeRateRows = hasProfessionRates
            ? (await pool.query(
                `SELECT profession_key, hourly_rate
                 FROM staff_profession_rates
                 WHERE staff_id = $1
                 ORDER BY profession_key`,
                [req.params.id]
            ).catch(() => ({ rows: [] }))).rows.map(row => ({
                profession_key: normalizeProfessionKey(row.profession_key),
                hourly_rate: Number(row.hourly_rate || 0)
            }))
            : [];
        const values = [];
        const setClauses = [];
        const queueStaffUpdate = (column, value, cast = '') => {
            values.push(value);
            setClauses.push(`${column} = $${values.length}${cast}`);
        };
        const textOrNull = value => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized || null;
        };
        const arrayOrNull = value => {
            if (value === null || value === undefined || value === '') return null;
            if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
            return [String(value).trim()].filter(Boolean);
        };
        const numberOrNull = value => {
            if (value === null || value === undefined || value === '') return null;
            const normalized = Number(value);
            return Number.isFinite(normalized) ? normalized : null;
        };

        if (fieldPresence.phone) queueStaffUpdate('phone', textOrNull(phone));
        if (fieldPresence.emergency_contact) queueStaffUpdate('emergency_contact', textOrNull(emergency_contact));
        if (fieldPresence.emergency_phone) queueStaffUpdate('emergency_phone', textOrNull(emergency_phone));
        if (fieldPresence.role_type) queueStaffUpdate('role_type', textOrNull(role_type));
        if (fieldPresence.hourly_rate) queueStaffUpdate('hourly_rate', numberOrNull(hourly_rate));
        if (fieldPresence.birth_date) queueStaffUpdate('birth_date', birth_date || null);
        if (fieldPresence.notes) queueStaffUpdate('notes', textOrNull(notes));
        if (fieldPresence.telegram_id) queueStaffUpdate('telegram_id', textOrNull(telegram_id));
        if (fieldPresence.telegram_username) queueStaffUpdate('telegram_username', textOrNull(telegram_username));
        if (fieldPresence.contract_type) queueStaffUpdate('contract_type', textOrNull(contract_type));
        if (fieldPresence.skills) queueStaffUpdate('skills', arrayOrNull(skills), '::text[]');
        if (fieldPresence.address) queueStaffUpdate('address', textOrNull(address));
        if (fieldPresence.company_structure_node_id) {
            queueStaffUpdate('company_structure_node_id', normalizeCompanyStructureNodeRef(company_structure_node_id ?? req.body.companyStructureNodeId));
        }
        if (fieldPresence.hr_pool_status) {
            queueStaffUpdate('hr_pool_status', textOrNull(hr_pool_status));
            setClauses.push(hr_pool_status === 'blacklisted'
                ? 'blacklisted_at = COALESCE(blacklisted_at, NOW())'
                : 'blacklisted_at = NULL');
        }
        if (fieldPresence.hr_pool_status && hr_pool_status !== 'blacklisted') {
            setClauses.push('blacklist_reason = NULL');
        } else if (fieldPresence.blacklist_reason) {
            queueStaffUpdate('blacklist_reason', textOrNull(blacklist_reason));
        }
        if (hasSecondaryProfessions) {
            queueStaffUpdate('secondary_professions', JSON.stringify(professionValidation.secondaryProfessions || []), '::jsonb');
        }

        let afterRateRows = beforeRateRows;
        let result;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (setClauses.length) {
                values.push(req.params.id);
                result = await client.query(
                    `UPDATE staff SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
                    values
                );
            } else {
                result = await client.query('SELECT * FROM staff WHERE id = $1 FOR UPDATE', [req.params.id]);
            }
            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Не знайдено' });
            }
            if (hasProfessionRates) {
                afterRateRows = await replaceStaffProfessionRates(client, req.params.id, normalizedProfessionRates);
                result.rows[0].profession_rates = afterRateRows;
            }
            if (fieldPresence.role_type || hasSecondaryProfessions || hasProfessionRates) {
                if (!hasProfessionRates) {
                    afterRateRows = (await client.query(
                        `SELECT profession_key, hourly_rate
                         FROM staff_profession_rates
                         WHERE staff_id = $1
                         ORDER BY profession_key`,
                        [req.params.id]
                    ).catch(() => ({ rows: [] }))).rows.map(row => ({
                        profession_key: normalizeProfessionKey(row.profession_key),
                        hourly_rate: Number(row.hourly_rate || 0)
                    }));
                }
                await syncStaffRoleAssignmentsFromStaff(client, req.params.id, result.rows[0], afterRateRows, req.user?.username || null);
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        const changedFields = [
            'phone', 'emergency_contact', 'emergency_phone', 'role_type', 'secondary_professions',
            'hourly_rate', 'company_structure_node_id', 'birth_date', 'address', 'notes', 'telegram_id', 'telegram_username',
            'contract_type', 'skills', 'hr_pool_status', 'blacklist_reason', 'blacklisted_at'
        ];
        const changes = buildStaffProfileChanges(beforeStaff, result.rows[0], changedFields);
        if (hasProfessionRates && !auditValuesEqual(beforeRateRows, afterRateRows)) {
            changes.profession_rates = {
                from: normalizeAuditValue(beforeRateRows),
                to: normalizeAuditValue(afterRateRows)
            };
        }
        await auditLog('staff_update', parseInt(req.params.id), req.user?.username, {
            source: 'hr_staff_profile',
            changed_fields: Object.keys(changes),
            changes,
            requested_fields: Object.keys(req.body || {})
        }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id/status — activate/deactivate
router.put('/staff/:id/status', requireHrManage, async (req, res) => {
    try {
        const { is_active } = req.body;
        const result = await pool.query(
            'UPDATE staff SET is_active = $1 WHERE id = $2 RETURNING *',
            [is_active, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('status_change', parseInt(req.params.id), req.user?.username, { is_active }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/pool — reserve/blacklist operational lists
router.get('/pool', async (req, res) => {
    try {
        const status = req.query.status === 'blacklisted' ? 'blacklisted' : 'reserve';
        const result = await pool.query(
            `SELECT id, name, department, position, phone, role_type, contract_type,
                    is_active, hr_pool_status, blacklist_reason, blacklisted_at, notes
             FROM staff
             WHERE hr_pool_status = $1
             ORDER BY is_active DESC, name`,
            [status]
        );
        res.json({ success: true, status, data: result.rows });
    } catch (err) {
        log.error('GET /hr/pool error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id/pool-status — move staff between core/reserve/blacklist
router.put('/staff/:id/pool-status', requireHrManage, async (req, res) => {
    try {
        const { status, reason } = req.body;
        if (!['core', 'reserve', 'blacklisted'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус пулу' });
        }
        const result = await pool.query(
            `UPDATE staff SET
                hr_pool_status = $1,
                blacklist_reason = CASE WHEN $1 = 'blacklisted' THEN COALESCE($2, blacklist_reason) ELSE NULL END,
                blacklisted_at = CASE WHEN $1 = 'blacklisted' THEN COALESCE(blacklisted_at, NOW()) ELSE NULL END
             WHERE id = $3
             RETURNING id, name, department, role_type, hr_pool_status, blacklist_reason, blacklisted_at`,
            [status, reason || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('pool_status_update', parseInt(req.params.id), req.user?.username, { status, reason }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/pool-status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET/PUT /api/hr/company-structure — HR-owned instructions without Control Center refactor
router.get('/company-structure', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'hr_company_structure'");
        const payload = normalizeCompanyStructurePayload(result.rows[0]?.value || {});
        res.json({ success: true, data: payload });
    } catch (err) {
        log.error('GET /hr/company-structure error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/company-structure', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const source = req.body || {};
        const expectedUpdatedAt = source.baseUpdatedAt || source.expectedUpdatedAt || null;

        await client.query('BEGIN');
        const current = await client.query(
            "SELECT value FROM settings WHERE key = 'hr_company_structure' FOR UPDATE"
        );
        const currentPayload = normalizeCompanyStructurePayload(current.rows[0]?.value || {});
        if (expectedUpdatedAt && currentPayload.updatedAt && expectedUpdatedAt !== currentPayload.updatedAt) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Структуру вже оновили в іншій вкладці. Оновіть сторінку та повторіть зміни.',
                current: currentPayload
            });
        }

        const payload = {
            ...normalizeCompanyStructurePayload(source),
            updatedBy: req.user?.username || null,
            updatedAt: new Date().toISOString()
        };
        await client.query(
            `INSERT INTO settings (key, value)
             VALUES ('hr_company_structure', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [JSON.stringify(payload)]
        );
        const nodeIds = payload.nodes.map(node => node.id).filter(Boolean);
        const staffCleanup = await client.query(
            `UPDATE staff
             SET company_structure_node_id = NULL
             WHERE company_structure_node_id IS NOT NULL
               AND NOT (company_structure_node_id = ANY($1::text[]))`,
            [nodeIds]
        );
        const professionCleanup = await client.query(
            `UPDATE hr_professions
             SET structure_node_id = NULL, updated_at = NOW()
             WHERE structure_node_id IS NOT NULL
               AND NOT (structure_node_id = ANY($1::text[]))`,
            [nodeIds]
        );
        const staleRefsCleared = {
            staff: staffCleanup.rowCount || 0,
            professions: professionCleanup.rowCount || 0
        };
        await client.query('COMMIT');
        await auditLog('company_structure_update', null, req.user?.username, { updatedAt: payload.updatedAt, nodes: payload.nodes.length }, req.ip);
        res.json({ success: true, data: payload, staleRefsCleared });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/company-structure error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// ==========================================
// SHIFT TEMPLATES
// ==========================================

router.get('/shift-templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hr_shift_templates ORDER BY is_default DESC, name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/shift-templates', requireHrManage, async (req, res) => {
    try {
        const { name, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!name || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: name, planned_start, planned_end' });
        }
        const result = await pool.query(
            `INSERT INTO hr_shift_templates (name, planned_start, planned_end, break_minutes, shift_type)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, planned_start, planned_end, break_minutes || 0, shift_type || 'regular']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.delete('/shift-templates/:id', requireHrManage, async (req, res) => {
    try {
        await pool.query('DELETE FROM hr_shift_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SHIFTS (SCHEDULE)
// ==========================================

// GET /api/hr/shifts — query by week/month/range
router.get('/shifts', async (req, res) => {
    try {
        const { week, month, from, to, staff_id } = req.query;
        let dateFrom, dateTo;

        if (week) {
            const d = new Date(week);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            dateFrom = new Date(d.setDate(diff)).toISOString().split('T')[0];
            dateTo = new Date(new Date(dateFrom).setDate(new Date(dateFrom).getDate() + 6)).toISOString().split('T')[0];
        } else if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current week
            const now = nowKyiv();
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const mon = new Date(now);
            mon.setDate(diff);
            dateFrom = mon.toISOString().split('T')[0];
            dateTo = new Date(mon.setDate(mon.getDate() + 6)).toISOString().split('T')[0];
        }

        let sql = `SELECT hs.*, s.name AS staff_name, s.color AS staff_color, s.role_type,
                    COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions
                    FROM hr_shifts hs
                    JOIN staff s ON s.id = hs.staff_id
                    WHERE hs.shift_date >= $1 AND hs.shift_date <= $2`;
        const params = [dateFrom, dateTo];

        if (staff_id) {
            params.push(parseInt(staff_id));
            sql += ` AND hs.staff_id = $${params.length}`;
        }

        sql += ' ORDER BY s.name, hs.shift_date';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts — create single shift
router.post('/shifts', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const { staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        if (!staff_id || !shift_date || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, shift_date, planned_start, planned_end' });
        }
        await client.query('BEGIN');
        const profession = await resolveHrShiftProfession(staff_id, req.body, client);
        if (!profession.ok) {
            await client.query('ROLLBACK');
            return res.status(profession.status || 400).json({ success: false, error: profession.error });
        }
        const result = await client.query(
            `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes, created_by, profession_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                shift_type = EXCLUDED.shift_type, break_minutes = EXCLUDED.break_minutes,
                notes = EXCLUDED.notes, profession_key = EXCLUDED.profession_key, updated_at = NOW()
             RETURNING *`,
            [staff_id, shift_date, planned_start, planned_end, shift_type || 'regular', break_minutes || 0, notes, req.user?.username, profession.professionKey]
        );
        await mirrorHrShiftToStaffSchedule(result.rows[0], client);
        await client.query('COMMIT');
        await auditLog('shift_create', staff_id, req.user?.username, { shift_date, planned_start, planned_end }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// PUT /api/hr/shifts/:id — update shift
router.put('/shifts/:id', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const { planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        await client.query('BEGIN');
        const current = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        const hasProfessionField = Object.prototype.hasOwnProperty.call(req.body || {}, 'profession_key')
            || Object.prototype.hasOwnProperty.call(req.body || {}, 'professionKey');
        let professionKey = null;
        if (hasProfessionField || !current.rows[0].profession_key) {
            const profession = await resolveHrShiftProfession(current.rows[0].staff_id, hasProfessionField ? req.body : {}, client);
            if (!profession.ok) {
                await client.query('ROLLBACK');
                return res.status(profession.status || 400).json({ success: false, error: profession.error });
            }
            professionKey = profession.professionKey;
        }
        const result = await client.query(
            `UPDATE hr_shifts SET
                planned_start = COALESCE($1, planned_start),
                planned_end = COALESCE($2, planned_end),
                shift_type = COALESCE($3, shift_type),
                break_minutes = COALESCE($4, break_minutes),
                notes = COALESCE($5, notes),
                profession_key = COALESCE($6, profession_key),
                updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [planned_start, planned_end, shift_type, break_minutes, notes, professionKey, req.params.id]
        );
        await mirrorHrShiftToStaffSchedule(result.rows[0], client);
        await client.query('COMMIT');
        await auditLog('shift_update', result.rows[0].staff_id, req.user?.username, req.body, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// DELETE /api/hr/shifts/:id
router.delete('/shifts/:id', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        await client.query('DELETE FROM hr_shifts WHERE id = $1', [req.params.id]);
        await removeMirroredStaffSchedule(existing.rows[0].staff_id, existing.rows[0].shift_date, client);
        await client.query('COMMIT');
        await auditLog('shift_delete', existing.rows[0].staff_id, req.user?.username,
            { shift_date: existing.rows[0].shift_date }, req.ip);
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('DELETE /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/shifts/:id/replace — move a shift to a replacement staff member
router.post('/shifts/:id/replace', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const replacementStaffId = parseInt(req.body.replacement_staff_id, 10);
        const reason = String(req.body.reason || '').trim() || null;
        if (!replacementStaffId) {
            return res.status(400).json({ success: false, error: 'Потрібен replacement_staff_id' });
        }

        await client.query('BEGIN');
        const existing = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Зміну не знайдено' });
        }
        const oldShift = existing.rows[0];
        if (Number(oldShift.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого співробітника не потрібна' });
        }

        const replacement = await client.query(
            'SELECT id, name FROM staff WHERE id = $1 AND is_active = true',
            [replacementStaffId]
        );
        if (!replacement.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Підмінний співробітник неактивний або не існує' });
        }

        let replacementProfessionKey = oldShift.profession_key || null;
        if (!replacementProfessionKey) {
            const oldStaff = await client.query('SELECT role_type FROM staff WHERE id = $1', [oldShift.staff_id]);
            replacementProfessionKey = oldStaff.rows[0]?.role_type || null;
        }
        const replacementProfession = await resolveStaffProfessionAssignment(client, replacementStaffId, replacementProfessionKey);
        if (!replacementProfession.ok) {
            await client.query('ROLLBACK');
            return res.status(replacementProfession.status || 400).json({ success: false, error: replacementProfession.error });
        }
        replacementProfessionKey = replacementProfession.professionKey;

        const conflict = await client.query(
            `SELECT id FROM hr_shifts
             WHERE staff_id = $1 AND shift_date = $2 AND id <> $3
             LIMIT 1`,
            [replacementStaffId, oldShift.shift_date, req.params.id]
        );
        if (conflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У підмінного співробітника вже є зміна на цю дату' });
        }

        const updated = await client.query(
            `UPDATE hr_shifts SET
                original_staff_id = COALESCE(original_staff_id, staff_id),
                staff_id = $1,
                replacement_reason = $2,
                replaced_by = $3,
                replaced_at = NOW(),
                profession_key = $5,
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [replacementStaffId, reason, req.user?.username || null, req.params.id, replacementProfessionKey]
        );

        await removeMirroredStaffSchedule(oldShift.staff_id, oldShift.shift_date, client);
        await mirrorHrShiftToStaffSchedule(updated.rows[0], client);
        await client.query('COMMIT');

        await auditLog('shift_replace', oldShift.staff_id, req.user?.username, {
            shift_id: parseInt(req.params.id),
            replacement_staff_id: replacementStaffId,
            reason
        }, req.ip);

        res.json({ success: true, data: updated.rows[0], replacement: replacement.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/shifts/:id/replace error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/shifts/bulk — mass create from template
router.post('/shifts/bulk', requireHrManage, async (req, res) => {
    try {
        const { staff_ids, dates, template_id, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!staff_ids || !dates || (!template_id && !planned_start)) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_ids, dates та template_id або planned_start/planned_end' });
        }

        let start = planned_start, end = planned_end, brk = break_minutes || 0, stype = shift_type || 'regular';
        if (template_id) {
            const tpl = await pool.query('SELECT * FROM hr_shift_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
            start = tpl.rows[0].planned_start;
            end = tpl.rows[0].planned_end;
            brk = tpl.rows[0].break_minutes;
            stype = tpl.rows[0].shift_type;
        }

        let count = 0;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const sid of staff_ids) {
                const profession = await resolveHrShiftProfession(sid, req.body, client);
                if (!profession.ok) {
                    await client.query('ROLLBACK');
                    return res.status(profession.status || 400).json({ success: false, error: profession.error, staff_id: sid });
                }
                for (const d of dates) {
                    const result = await client.query(
                        `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, created_by, profession_key)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                         ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                            planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                            break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type,
                            profession_key = EXCLUDED.profession_key, updated_at = NOW()
                         RETURNING *`,
                        [sid, d, start, end, brk, stype, req.user?.username, profession.professionKey]
                    );
                    await mirrorHrShiftToStaffSchedule(result.rows[0], client);
                    count++;
                }
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        await auditLog('shift_bulk', null, req.user?.username, { staff_ids, dates, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/bulk error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/copy-week
router.post('/shifts/copy-week', requireHrManage, async (req, res) => {
    try {
        const { source_week, target_week } = req.body;
        if (!source_week || !target_week) {
            return res.status(400).json({ success: false, error: 'Потрібні source_week і target_week' });
        }

        const srcMon = new Date(source_week);
        const tgtMon = new Date(target_week);
        const srcDates = [];
        const tgtDates = [];
        for (let i = 0; i < 7; i++) {
            const s = new Date(srcMon); s.setDate(srcMon.getDate() + i);
            const t = new Date(tgtMon); t.setDate(tgtMon.getDate() + i);
            srcDates.push(s.toISOString().split('T')[0]);
            tgtDates.push(t.toISOString().split('T')[0]);
        }

        const source = await pool.query(
            `SELECT hs.* FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id
             WHERE hs.shift_date >= $1 AND hs.shift_date <= $2 AND s.is_active = true`,
            [srcDates[0], srcDates[6]]
        );

        let count = 0;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const row of source.rows) {
                const sourceDate = row.shift_date instanceof Date ? row.shift_date.toISOString().split('T')[0] : row.shift_date;
                const dayIndex = srcDates.indexOf(sourceDate);
                if (dayIndex === -1) continue;
                const profession = await resolveHrShiftProfession(row.staff_id, { profession_key: row.profession_key }, client);
                if (!profession.ok) {
                    await client.query('ROLLBACK');
                    return res.status(profession.status || 400).json({
                        success: false,
                        error: profession.error,
                        staff_id: row.staff_id
                    });
                }
                const copied = await client.query(
                    `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, notes, created_by, profession_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                        planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                        break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type,
                        profession_key = EXCLUDED.profession_key, updated_at = NOW()
                     RETURNING *`,
                    [row.staff_id, tgtDates[dayIndex], row.planned_start, row.planned_end, row.break_minutes, row.shift_type, row.notes, req.user?.username, profession.professionKey]
                );
                await mirrorHrShiftToStaffSchedule(copied.rows[0], client);
                count++;
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        await auditLog('shift_copy_week', null, req.user?.username, { source_week, target_week, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CLOCK IN / CLOCK OUT
// ==========================================

// GET /api/hr/today — dashboard
router.get('/today', async (req, res) => {
    try {
        const today = todayKyiv();
        const staff = await pool.query(
            `SELECT id, name, department, position, color, role_type, photo_url FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL) ORDER BY department, name`
        );

        const shifts = await pool.query(
            'SELECT * FROM hr_shifts WHERE shift_date = $1', [today]
        );
        const shiftMap = {};
        for (const s of shifts.rows) shiftMap[s.staff_id] = s;

        const records = await pool.query(
            'SELECT * FROM hr_time_records WHERE record_date = $1', [today]
        );
        const recordMap = {};
        for (const r of records.rows) recordMap[r.staff_id] = r;

        let present = 0, late = 0, absent = 0, onVacation = 0, sick = 0;
        const data = staff.rows.map(s => {
            const shift = shiftMap[s.id] || null;
            const record = recordMap[s.id] || null;

            if (record) {
                if (record.status === 'late' || record.status === 'present' || record.status === 'clocked_in' || record.status === 'unscheduled') present++;
                else if (record.status === 'vacation') onVacation++;
                else if (record.status === 'sick') sick++;
                else if (record.status === 'early_leave' || record.status === 'auto_closed') present++;
                if (record.status === 'late') late++;
            } else if (shift) {
                absent++;
            }

            return {
                staff_id: s.id,
                staff_name: s.name,
                department: s.department,
                position: s.position,
                staff_color: s.color,
                role_type: s.role_type,
                photo_url: s.photo_url,
                shift: shift ? { planned_start: shift.planned_start, planned_end: shift.planned_end, shift_type: shift.shift_type } : null,
                record: record ? {
                    id: record.id,
                    clock_in: record.clock_in,
                    clock_out: record.clock_out,
                    status: record.status,
                    late_minutes: record.late_minutes,
                    early_leave_minutes: record.early_leave_minutes,
                    overtime_minutes: record.overtime_minutes,
                    total_worked_minutes: record.total_worked_minutes,
                    auto_closed: record.auto_closed
                } : null
            };
        });

        res.json({
            success: true,
            date: today,
            data,
            summary: { total_staff: staff.rows.length, present, late, absent, on_vacation: onVacation, sick }
        });
    } catch (err) {
        log.error('GET /hr/today error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-in
router.post('/clock-in', requireHrManage, async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const now = nowKyiv();

        // Check existing
        const existing = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (existing.rows.length > 0 && existing.rows[0].clock_in) {
            return res.status(409).json({ success: false, error: 'Вже відмічений сьогодні' });
        }

        // Find planned shift
        const shift = await pool.query(
            'SELECT * FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        const hasShift = shift.rows.length > 0;
        let plannedStart = null, plannedEnd = null, lateMin = 0, status = 'unscheduled';

        if (hasShift) {
            plannedStart = shift.rows[0].planned_start;
            plannedEnd = shift.rows[0].planned_end;
            const diff = minutesSincePlannedStart(plannedStart);
            lateMin = Math.max(0, diff);
            status = lateMin > 5 ? 'late' : 'present';
        }

        const clockIn = new Date().toISOString();

        let result;
        if (existing.rows.length > 0) {
            // Update existing absent record
            result = await pool.query(
                `UPDATE hr_time_records SET
                    clock_in = $1, planned_start = $2, planned_end = $3,
                    late_minutes = $4, status = $5, ip_address = $6, user_agent = $7, updated_at = NOW()
                 WHERE id = $8 RETURNING *`,
                [clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent'], existing.rows[0].id]
            );
        } else {
            result = await pool.query(
                `INSERT INTO hr_time_records (staff_id, record_date, clock_in, planned_start, planned_end, late_minutes, status, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [staff_id, today, clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent']]
            );
        }

        await auditLog('clock_in', staff_id, req.user?.username, { clock_in: clockIn, late_minutes: lateMin, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-in error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-out
router.post('/clock-out', requireHrManage, async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const record = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (record.rows.length === 0 || !record.rows[0].clock_in) {
            return res.status(400).json({ success: false, error: 'Спочатку відмітьте прихід' });
        }
        if (record.rows[0].clock_out) {
            return res.status(409).json({ success: false, error: 'Вже завершено' });
        }

        const rec = record.rows[0];
        const clockOut = new Date().toISOString();
        const clockInDate = new Date(rec.clock_in);
        const clockOutDate = new Date(clockOut);

        // Get break from shift
        let breakMin = 0;
        const shift = await pool.query(
            'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;

        const totalWorked = Math.round((clockOutDate - clockInDate) / 60000) - breakMin;
        let earlyLeave = 0, overtime = 0;
        let status = rec.status;

        if (rec.planned_end) {
            const now = nowKyiv();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const plannedEndMin = timeToMin(rec.planned_end);
            const diff = plannedEndMin - nowMin;

            if (diff > 15) {
                earlyLeave = diff;
                status = 'early_leave';
            } else if (diff < -15) {
                overtime = Math.abs(diff);
            }
        }

        // Keep 'late' if was late
        if (rec.status === 'late' && status !== 'early_leave') status = 'late';
        if (status === 'present' || status === 'unscheduled' || status === 'clocked_in') status = 'present';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_out = $1, total_worked_minutes = $2, early_leave_minutes = $3,
                overtime_minutes = $4, status = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [clockOut, Math.max(0, totalWorked), earlyLeave, overtime, status, rec.id]
        );

        await auditLog('clock_out', staff_id, req.user?.username,
            { clock_out: clockOut, total_worked_minutes: totalWorked, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-out error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/mark-absent — mark sick/vacation/day_off
router.post('/mark-absent', requireHrManage, async (req, res) => {
    try {
        const { staff_id, status, notes } = req.body;
        if (!staff_id || !status) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_id та status' });
        }
        const validStatuses = ['sick', 'vacation', 'day_off'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус' });
        }

        const today = todayKyiv();
        const result = await pool.query(
            `INSERT INTO hr_time_records (staff_id, record_date, status, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (staff_id, record_date) DO UPDATE SET status = $3, notes = $4, updated_at = NOW()
             RETURNING *`,
            [staff_id, today, status, notes]
        );

        await auditLog('mark_absent', staff_id, req.user?.username, { status, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/mark-absent error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CORRECTION (admin only)
// ==========================================

router.put('/records/:id/correct', requireHrManage, async (req, res) => {
    try {
        const { clock_in, clock_out, notes } = req.body;
        const rec = await pool.query('SELECT * FROM hr_time_records WHERE id = $1', [req.params.id]);
        if (rec.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const original = rec.rows[0];
        const newClockIn = clock_in ? new Date(clock_in).toISOString() : original.clock_in;
        const newClockOut = clock_out ? new Date(clock_out).toISOString() : original.clock_out;

        // Recalculate
        let totalWorked = 0, lateMin = 0, earlyLeave = 0, overtime = 0;
        if (newClockIn && newClockOut) {
            let breakMin = 0;
            const shift = await pool.query(
                'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
                [original.staff_id, original.record_date]
            );
            if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;
            totalWorked = Math.max(0, Math.round((new Date(newClockOut) - new Date(newClockIn)) / 60000) - breakMin);
        }

        if (original.planned_start && newClockIn) {
            const ciDate = new Date(newClockIn);
            const ciMin = ciDate.getHours() * 60 + ciDate.getMinutes();
            lateMin = Math.max(0, ciMin - timeToMin(original.planned_start));
        }

        if (original.planned_end && newClockOut) {
            const coDate = new Date(newClockOut);
            const coMin = coDate.getHours() * 60 + coDate.getMinutes();
            const plannedEndMin = timeToMin(original.planned_end);
            if (plannedEndMin - coMin > 15) earlyLeave = plannedEndMin - coMin;
            if (coMin - plannedEndMin > 15) overtime = coMin - plannedEndMin;
        }

        let status = lateMin > 5 ? 'late' : 'present';
        if (earlyLeave > 0) status = 'early_leave';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_in = $1, clock_out = $2,
                total_worked_minutes = $3, late_minutes = $4, early_leave_minutes = $5, overtime_minutes = $6,
                status = $7,
                original_clock_in = COALESCE(original_clock_in, $8),
                original_clock_out = COALESCE(original_clock_out, $9),
                corrected_by = $10, corrected_at = NOW(), correction_reason = $11,
                updated_at = NOW()
             WHERE id = $12 RETURNING *`,
            [newClockIn, newClockOut, totalWorked, lateMin, earlyLeave, overtime, status,
             original.clock_in, original.clock_out, req.user?.username, notes, req.params.id]
        );

        await auditLog('correction', original.staff_id, req.user?.username,
            { old_clock_in: original.clock_in, old_clock_out: original.clock_out, new_clock_in: newClockIn, new_clock_out: newClockOut, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/records/:id/correct error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// REPORTS
// ==========================================

// GET /api/hr/report/monthly
router.get('/report/monthly', async (req, res) => {
    try {
        const { month, from, to } = req.query;
        let dateFrom, dateTo;

        if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current month
            const now = nowKyiv();
            const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
            dateFrom = `${y}-${m}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        }

        const staffList = await pool.query(
            'SELECT id, name, role_type, hourly_rate FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL) ORDER BY name'
        );
        const professionRateMap = await loadStaffProfessionRateMap(staffList.rows.map(st => st.id));
        const staffById = new Map(staffList.rows.map(st => [Number(st.id), st]));

        const shifts = await pool.query(
            'SELECT staff_id, COUNT(*) AS cnt FROM hr_shifts WHERE shift_date >= $1 AND shift_date <= $2 GROUP BY staff_id',
            [dateFrom, dateTo]
        );
        const shiftCounts = {};
        for (const r of shifts.rows) shiftCounts[r.staff_id] = parseInt(r.cnt);

        const records = await pool.query(
            `SELECT tr.staff_id,
                    COALESCE(hs.profession_key, s.role_type) AS profession_key,
                    tr.status, tr.late_minutes, tr.early_leave_minutes, tr.overtime_minutes, tr.total_worked_minutes
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date >= $1 AND tr.record_date <= $2`,
            [dateFrom, dateTo]
        );

        const taskKpiRows = await pool.query(
            `SELECT ep.staff_id,
                    COUNT(t.id)::int AS tasks_assigned,
                    COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') = 'done')::int AS tasks_done,
                    COUNT(t.id) FILTER (
                        WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
                          AND t.deadline IS NOT NULL
                          AND t.deadline < NOW()
                    )::int AS tasks_overdue
             FROM tasks t
             JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active = true
             WHERE t.owner_user_id IS NOT NULL
               AND (
                    t.created_at::date BETWEEN $1::date AND $2::date
                    OR t.completed_at::date BETWEEN $1::date AND $2::date
               )
             GROUP BY ep.staff_id`,
            [dateFrom, dateTo]
        ).catch(err => {
            log.warn('Task KPI query failed:', err.message);
            return { rows: [] };
        });

        const taskKpiMap = {};
        for (const r of taskKpiRows.rows) {
            taskKpiMap[r.staff_id] = {
                tasks_assigned: parseInt(r.tasks_assigned) || 0,
                tasks_done: parseInt(r.tasks_done) || 0,
                tasks_overdue: parseInt(r.tasks_overdue) || 0
            };
        }

        const statsMap = {};
        for (const r of records.rows) {
            if (!statsMap[r.staff_id]) {
                statsMap[r.staff_id] = {
                    days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                    days_sick: 0, days_vacation: 0,
                    total_worked_minutes: 0, total_overtime_minutes: 0,
                    late_count: 0, total_late_minutes: 0
                };
            }
            const s = statsMap[r.staff_id];
            if (['present', 'late', 'early_leave', 'auto_closed', 'unscheduled'].includes(r.status)) {
                s.days_worked++;
                s.total_worked_minutes += r.total_worked_minutes || 0;
                s.total_overtime_minutes += r.overtime_minutes || 0;
                const rate = rateForStaffProfession(staffById.get(Number(r.staff_id)) || { id: r.staff_id }, r.profession_key, professionRateMap);
                s.estimated_salary = (s.estimated_salary || 0) + (((Number(r.total_worked_minutes) || 0) / 60) * rate);
            }
            if (r.status === 'late') { s.days_late++; s.late_count++; s.total_late_minutes += r.late_minutes || 0; }
            if (r.status === 'early_leave') s.days_early_leave++;
            if (r.status === 'absent' || r.status === 'no_show') s.days_absent++;
            if (r.status === 'sick') s.days_sick++;
            if (r.status === 'vacation') s.days_vacation++;
        }

        const data = staffList.rows.map(st => {
            const s = statsMap[st.id] || {
                days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                days_sick: 0, days_vacation: 0, total_worked_minutes: 0, total_overtime_minutes: 0,
                late_count: 0, total_late_minutes: 0
            };
            const daysScheduled = shiftCounts[st.id] || 0;
            const totalWorkedHours = Math.round(s.total_worked_minutes / 60 * 10) / 10;
            const totalOvertimeHours = Math.round(s.total_overtime_minutes / 60 * 10) / 10;
            const rate = parseFloat(st.hourly_rate) || 0;
            const taskKpi = taskKpiMap[st.id] || { tasks_assigned: 0, tasks_done: 0, tasks_overdue: 0 };

            return {
                staff_id: st.id,
                staff_name: st.name,
                role_type: st.role_type,
                hourly_rate: rate,
                days_scheduled: daysScheduled,
                days_worked: s.days_worked,
                days_late: s.days_late,
                days_early_leave: s.days_early_leave,
                days_absent: s.days_absent,
                days_sick: s.days_sick,
                days_vacation: s.days_vacation,
                total_worked_hours: totalWorkedHours,
                total_overtime_hours: totalOvertimeHours,
                estimated_salary: Math.round(s.estimated_salary || totalWorkedHours * rate),
                late_count: s.late_count,
                avg_late_minutes: s.late_count > 0 ? Math.round(s.total_late_minutes / s.late_count) : 0,
                attendance_rate: daysScheduled > 0 ? Math.round(s.days_worked / daysScheduled * 100) : 0,
                task_kpi: taskKpi,
                task_completion_rate: taskKpi.tasks_assigned > 0 ? Math.round(taskKpi.tasks_done / taskKpi.tasks_assigned * 100) : 0
            };
        });

        res.json({ success: true, data, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/report/monthly error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/kpi — single backend-owned KPI snapshot
router.get('/kpi', async (req, res) => {
    try {
        const snapshot = await loadKpiSnapshot(req.query.month);
        res.json({ success: true, ...snapshot });
    } catch (err) {
        log.error('GET /hr/kpi error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/daily
router.get('/report/daily', async (req, res) => {
    try {
        const date = req.query.date || todayKyiv();
        const result = await pool.query(
            `SELECT tr.*, s.name AS staff_name, s.role_type, s.color,
                    hs.planned_start AS shift_start, hs.planned_end AS shift_end
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date = $1 ORDER BY s.name`, [date]
        );
        res.json({ success: true, data: result.rows, date });
    } catch (err) {
        log.error('GET /hr/report/daily error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/export — CSV export
router.get('/report/export', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ success: false, error: 'Потрібні from та to' });

        const result = await pool.query(
            `SELECT s.id AS staff_id, s.name, s.role_type, tr.record_date, tr.clock_in, tr.clock_out,
                    tr.planned_start, tr.planned_end,
                    tr.total_worked_minutes, tr.late_minutes, tr.early_leave_minutes, tr.overtime_minutes,
                    s.hourly_rate, COALESCE(hs.profession_key, s.role_type) AS profession_key
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date >= $1 AND tr.record_date <= $2
             ORDER BY s.name, tr.record_date`,
            [from, to]
        );
        const professionRateMap = await loadStaffProfessionRateMap(result.rows.map(row => row.staff_id));

        const header = 'ПІБ;Дата;Прихід;Відхід;Заплановано початок;Заплановано кінець;Відпрацьовано хв;Запізнення хв;Рано пішов хв;Переробка хв;Ставка;Сума\n';
        const rows = result.rows.map(r => {
            const ci = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const co = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const workedH = ((r.total_worked_minutes || 0) / 60).toFixed(1);
            const rate = rateForStaffProfession(r, r.profession_key, professionRateMap);
            const salary = (parseFloat(workedH) * rate).toFixed(0);
            return `${r.name};${r.record_date};${ci};${co};${r.planned_start || ''};${r.planned_end || ''};${r.total_worked_minutes || 0};${r.late_minutes || 0};${r.early_leave_minutes || 0};${r.overtime_minutes || 0};${rate};${salary}`;
        }).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="hr_report_${from}_${to}.csv"`);
        res.send('\uFEFF' + header + rows);
    } catch (err) {
        log.error('GET /hr/report/export error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// LEAVE REQUESTS (#2)
// ==========================================

// GET /api/hr/leave-requests
router.get('/leave-requests', async (req, res) => {
    try {
        const { status, staff_id } = req.query;
        let sql = `SELECT lr.*, s.name AS staff_name, s.department,
                    u.username AS reviewer_name
                   FROM leave_requests lr
                   JOIN staff s ON s.id = lr.staff_id
                   LEFT JOIN users u ON u.id = lr.reviewed_by`;
        const params = [];
        const conds = [];
        if (status) { params.push(status); conds.push(`lr.status = $${params.length}`); }
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`lr.staff_id = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY lr.created_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/leave-requests error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/leave-requests — submit new request
router.post('/leave-requests', requireHrManage, async (req, res) => {
    try {
        const { staff_id, type, date_from, date_to, reason } = req.body;
        if (!staff_id || !type || !date_from || !date_to) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, type, date_from, date_to' });
        }
        const days = Math.ceil((new Date(date_to) - new Date(date_from)) / 86400000) + 1;
        const result = await pool.query(
            `INSERT INTO leave_requests (staff_id, type, date_from, date_to, days, reason)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [staff_id, type, date_from, date_to, days, reason]
        );
        await auditLog('leave_request_create', staff_id, req.user?.username, { type, date_from, date_to }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/leave-requests error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/leave-requests/:id/review — approve/reject
router.put('/leave-requests/:id/review', requireHrManage, async (req, res) => {
    try {
        const { status, comment } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Статус: approved або rejected' });
        }
        const result = await pool.query(
            `UPDATE leave_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_comment = $3
             WHERE id = $4 RETURNING *`,
            [status, req.user?.id, comment, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const lr = result.rows[0];
        // If approved, mark days as vacation/sick/day_off in time records
        if (status === 'approved') {
            const d = new Date(lr.date_from);
            const end = new Date(lr.date_to);
            while (d <= end) {
                const dateStr = d.toISOString().split('T')[0];
                await pool.query(
                    `INSERT INTO hr_time_records (staff_id, record_date, status, notes)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (staff_id, record_date) DO UPDATE SET status = $3, notes = $4`,
                    [lr.staff_id, dateStr, lr.type === 'vacation' ? 'vacation' : lr.type === 'sick' ? 'sick' : 'day_off', `Заявка #${lr.id}`]
                );
                d.setDate(d.getDate() + 1);
            }
        }
        await auditLog('leave_request_review', lr.staff_id, req.user?.username, { status, comment }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/leave-requests/:id/review error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/leave-requests/:id — cancel
router.delete('/leave-requests/:id', requireHrManage, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено або вже оброблено' });
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/leave-requests/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// STAFF RATINGS (#3)
// ==========================================

// GET /api/hr/ratings — staff leaderboard
router.get('/ratings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.name, s.department, s.role_type, s.color, s.photo_url,
                   COALESCE(s.avg_rating, 0) AS avg_rating,
                   COALESCE(s.total_ratings, 0) AS total_ratings,
                   COUNT(DISTINCT b.id) AS total_events,
                   COUNT(DISTINCT b.id) FILTER (WHERE b.date::date >= CURRENT_DATE - INTERVAL '30 days') AS events_30d
            FROM staff s
            LEFT JOIN bookings b ON (
                b.line_id = s.id::text
                OR b.second_animator = s.id::text
                OR LOWER(BTRIM(COALESCE(b.second_animator, ''))) = LOWER(BTRIM(s.name))
            )
                AND b.status IN ('completed', 'confirmed')
            WHERE s.is_active = true AND s.role_type IN ('animator', 'host')
            GROUP BY s.id
            ORDER BY COALESCE(s.avg_rating, 0) DESC, COUNT(DISTINCT b.id) DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/ratings error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/ratings/:staffId — add rating
router.post('/ratings/:staffId', requireHrManage, async (req, res) => {
    try {
        const { score, comment } = req.body;
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ success: false, error: 'Оцінка від 1 до 5' });
        }
        const staffId = parseInt(req.params.staffId);
        // Update staff avg_rating
        const staff = await pool.query('SELECT avg_rating, total_ratings FROM staff WHERE id = $1', [staffId]);
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const oldAvg = parseFloat(staff.rows[0].avg_rating) || 0;
        const oldCount = parseInt(staff.rows[0].total_ratings) || 0;
        const newCount = oldCount + 1;
        const newAvg = ((oldAvg * oldCount) + score) / newCount;

        await pool.query(
            'UPDATE staff SET avg_rating = $1, total_ratings = $2 WHERE id = $3',
            [Math.round(newAvg * 100) / 100, newCount, staffId]
        );
        await auditLog('rating_add', staffId, req.user?.username, { score, comment }, req.ip);
        res.json({ success: true, avg_rating: Math.round(newAvg * 100) / 100, total_ratings: newCount });
    } catch (err) {
        log.error('POST /hr/ratings/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// AUTO-ASSIGNMENT (#4)
// ==========================================

// POST /api/hr/auto-assign — find best animator for a booking
router.post('/auto-assign', requireHrManage, async (req, res) => {
    try {
        const { date, time_start, time_end, required_skills, exclude_ids } = req.body;
        if (!date || !time_start) {
            return res.status(400).json({ success: false, error: 'Потрібні date та time_start' });
        }

        // 1. Find available animators (have shift, not on leave)
        const available = await pool.query(`
            SELECT s.id, s.name, s.skills, s.avg_rating, s.total_events, s.color
            FROM staff s
            JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1
            WHERE s.is_active = true
              AND s.role_type IN ('animator', 'host')
              AND NOT EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.staff_id = s.id AND lr.status = 'approved'
                  AND $1::date BETWEEN lr.date_from AND lr.date_to
              )
              AND NOT EXISTS (
                SELECT 1 FROM hr_time_records tr
                WHERE tr.staff_id = s.id AND tr.record_date = $1
                  AND tr.status IN ('sick', 'vacation', 'day_off')
              )
            ORDER BY s.avg_rating DESC, s.total_events ASC
        `, [date]);

        let candidates = available.rows;

        // 2. Exclude already assigned
        if (exclude_ids && exclude_ids.length) {
            candidates = candidates.filter(c => !exclude_ids.includes(c.id));
        }

        // 3. Filter by skills
        if (required_skills && required_skills.length) {
            candidates = candidates.filter(c => {
                const skills = c.skills || [];
                return required_skills.some(s => skills.includes(s));
            });
        }

        // 4. Check booking conflicts — find busy animators by line/second animator id.
        const booked = await pool.query(`
            SELECT DISTINCT line_id::int AS staff_id FROM bookings
            WHERE date = $1 AND status IN ('confirmed', 'pending')
              AND time < $2 AND line_id ~ '^[0-9]+$'
            UNION
            SELECT DISTINCT second_animator::int AS staff_id FROM bookings
            WHERE date = $1 AND status IN ('confirmed', 'pending')
              AND time < $2 AND second_animator IS NOT NULL AND second_animator != ''
              AND second_animator ~ '^[0-9]+$'
        `, [date, time_end || '23:59']);

        const busyIds = booked.rows.map(r => r.staff_id);
        candidates = candidates.filter(c => !busyIds.includes(c.id));

        // 5. Score and rank
        const scored = candidates.map(c => ({
            ...c,
            score: (parseFloat(c.avg_rating) || 0) * 20 + Math.min(parseInt(c.total_events) || 0, 50)
        }));
        scored.sort((a, b) => b.score - a.score);

        res.json({ success: true, data: scored.slice(0, 5), total_available: scored.length });
    } catch (err) {
        log.error('POST /hr/auto-assign error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// ONBOARDING (#5)
// ==========================================

// GET /api/hr/onboarding/templates
router.get('/onboarding/templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM onboarding_templates ORDER BY name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/onboarding/templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/onboarding/templates
router.post('/onboarding/templates', requireHrManage, async (req, res) => {
    try {
        const { name, department, items } = req.body;
        if (!name || !items) return res.status(400).json({ success: false, error: 'Потрібні name та items' });
        const result = await pool.query(
            'INSERT INTO onboarding_templates (name, department, items) VALUES ($1, $2, $3) RETURNING *',
            [name, department, JSON.stringify(items)]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/onboarding/templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/onboarding/start — start onboarding for staff
router.post('/onboarding/start', requireHrManage, async (req, res) => {
    try {
        const { staff_id, template_id } = req.body;
        if (!staff_id || !template_id) return res.status(400).json({ success: false, error: 'Потрібні staff_id та template_id' });

        const tpl = await pool.query('SELECT * FROM onboarding_templates WHERE id = $1', [template_id]);
        if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });

        const items = (tpl.rows[0].items || []).map((it, i) => ({ ...it, id: i + 1, done: false, done_at: null }));
        const result = await pool.query(
            `INSERT INTO onboarding_progress (staff_id, template_id, items, total_items)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [staff_id, template_id, JSON.stringify(items), items.length]
        );
        await auditLog('onboarding_start', staff_id, req.user?.username, { template_id }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/onboarding/start error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/onboarding — list all progress
router.get('/onboarding', async (req, res) => {
    try {
        const { staff_id, status } = req.query;
        let sql = `SELECT op.*, s.name AS staff_name, s.department, ot.name AS template_name
                   FROM onboarding_progress op
                   JOIN staff s ON s.id = op.staff_id
                   LEFT JOIN onboarding_templates ot ON ot.id = op.template_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`op.staff_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`op.status = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY op.started_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/onboarding error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/onboarding/:id/check — toggle item completion
router.put('/onboarding/:id/check', requireHrManage, async (req, res) => {
    try {
        const { item_id, done } = req.body;
        const prog = await pool.query('SELECT * FROM onboarding_progress WHERE id = $1', [req.params.id]);
        if (prog.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const items = prog.rows[0].items || [];
        const item = items.find(i => i.id === item_id);
        if (!item) return res.status(404).json({ success: false, error: 'Пункт не знайдено' });

        item.done = done;
        item.done_at = done ? new Date().toISOString() : null;
        const completedItems = items.filter(i => i.done).length;
        const isComplete = completedItems === items.length;

        const result = await pool.query(
            `UPDATE onboarding_progress SET items = $1, completed_items = $2,
             status = $3, completed_at = $4 WHERE id = $5 RETURNING *`,
            [JSON.stringify(items), completedItems, isComplete ? 'completed' : 'in_progress',
             isComplete ? new Date().toISOString() : null, req.params.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/onboarding/:id/check error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CERTIFICATIONS (#6)
// ==========================================

// GET /api/hr/certifications
router.get('/certifications', async (req, res) => {
    try {
        const { staff_id, status } = req.query;
        let sql = `SELECT sc.*, s.name AS staff_name, s.department
                   FROM staff_certifications sc
                   JOIN staff s ON s.id = sc.staff_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`sc.staff_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`sc.status = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sc.expires_at ASC NULLS LAST';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/certifications error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/certifications
router.post('/certifications', requireHrManage, async (req, res) => {
    try {
        const { staff_id, name, category, issued_at, expires_at, training_id, notes, document_id, documentId, business_context, businessContext } = req.body;
        if (!staff_id || !name) return res.status(400).json({ success: false, error: 'Потрібні staff_id та name' });
        const result = await pool.query(
            `INSERT INTO staff_certifications (staff_id, name, category, issued_at, expires_at, training_id, notes, document_id, business_context)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [
                staff_id,
                name,
                category || 'general',
                issued_at,
                expires_at,
                training_id,
                notes,
                numberOrNull(document_id || documentId),
                cleanStaffText(business_context || businessContext, 64)
            ]
        );
        await auditLog('certification_add', staff_id, req.user?.username, { name, category }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/certifications error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/certifications/:id
router.delete('/certifications/:id', requireHrManage, async (req, res) => {
    try {
        await pool.query('DELETE FROM staff_certifications WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/certifications/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SALARY REPORT (#7)
// ==========================================

// GET /api/hr/salary — full salary calculation
router.get('/salary', async (req, res) => {
    try {
        const calculation = await loadPayrollCalculation(req.query.month);
        const [periodLock, reconciliation, events] = await Promise.all([
            loadPayrollPeriodLock(calculation.month),
            loadPayrollReconciliation(calculation.month),
            loadPayrollPeriodEvents(calculation.month)
        ]);
        res.json({ success: true, ...calculation, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        log.error('GET /hr/salary error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/salary/adjustment — add bonus/deduction/depremium
router.post('/salary/adjustment', requireHrManage, async (req, res) => {
    try {
        const { staff_id, month, type, amount, reason, template_id, violation_date, evidence_note, evidence_url } = req.body;
        if (!staff_id || !month || !type || amount === undefined) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, month, type, amount' });
        }

        const payrollMonth = requirePayrollMonth(month);
        if (!payrollMonth) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        await assertPayrollPeriodOpen(payrollMonth);

        let finalReason = reason;
        let finalAmount = Number(amount);
        let ruleCode = null, disciplineCategory = null, severity = null;
        let repeatIndex = 0, decisionMode = 'custom', needsReview = false;
        let tplId = template_id || null;

        // Template-based depremium flow
        if ((type === 'penalty' || type === 'deduction') && tplId) {
            const tplRes = await pool.query('SELECT * FROM depremium_templates WHERE id = $1 AND active = true', [tplId]);
            if (!tplRes.rows.length) return res.status(400).json({ success: false, error: 'Шаблон не знайдено' });
            const tpl = tplRes.rows[0];

            finalReason = tpl.official_reason;
            ruleCode = tpl.code;
            disciplineCategory = tpl.discipline_category;
            severity = tpl.severity;
            decisionMode = 'template';
            needsReview = !!tpl.requires_manual_review;

            if (!amount && tpl.amount) finalAmount = Number(tpl.amount);
            if (!tpl.can_be_edited && amount && Number(amount) !== Number(tpl.amount || 0)) {
                return res.status(400).json({ success: false, error: 'Суму критичного порушення не можна змінювати' });
            }

            // Repeat detection
            const repeatRes = await pool.query(
                `SELECT COUNT(*)::int AS c FROM salary_adjustments
                 WHERE staff_id = $1 AND type IN ('penalty','deduction')
                 AND (template_id = $2 OR rule_code = $3 OR discipline_category = $4)`,
                [staff_id, tpl.id, tpl.code, tpl.discipline_category]
            );
            repeatIndex = (repeatRes.rows[0]?.c || 0) + 1;
            if (tpl.is_repeat_offense || repeatIndex > 1 || severity === 'critical') needsReview = true;
        }

        const status = needsReview ? 'pending_review' : 'applied';
        const result = await pool.query(
            `INSERT INTO salary_adjustments (staff_id, month, type, amount, reason, created_by,
             template_id, rule_code, discipline_category, severity, repeat_index, decision_mode, status,
             violation_date, evidence_note, evidence_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [staff_id, payrollMonth, type, finalAmount, finalReason, req.user?.username,
             tplId, ruleCode, disciplineCategory, severity, repeatIndex, decisionMode, status,
             violation_date || null, evidence_note || null, evidence_url || null]
        );
        const adj = result.rows[0];

        // Audit log
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [adj.id, staff_id, 'create', req.user?.username, req.user?.role, tplId,
             JSON.stringify({ amount: finalAmount, reason: finalReason, severity, repeatIndex, needsReview })]
        ).catch(e => log.warn('Discipline log failed:', e.message));

        await auditLog('salary_adjustment', staff_id, req.user?.username, { type, amount: finalAmount, reason: finalReason, template_id: tplId }, req.ip);

        // Dry notification to staff (fire-and-forget, no word "штраф")
        if ((type === 'penalty' || type === 'deduction') && status === 'applied') {
            setImmediate(async () => {
                try {
                    const staffRow = await pool.query('SELECT telegram_id FROM staff WHERE id = $1', [staff_id]);
                    const tgId = staffRow.rows[0]?.telegram_id;
                    if (tgId) {
                        const msg = [
                            `📋 Депреміювання${finalAmount ? ` -${Number(finalAmount).toFixed(0)}₴` : ''}`,
                            `Причина: ${finalReason}`,
                            repeatIndex > 1 ? `Повторність: ${repeatIndex}-й зафіксований випадок` : null
                        ].filter(Boolean).join('\n');
                        await sendTelegramMessage(tgId, msg);
                    }
                } catch (e) { log.warn('Depremium TG notify failed:', e.message); }
            });
        }

        res.json({ success: true, data: adj, needsReview });
    } catch (err) {
        log.error('POST /hr/salary/adjustment error', err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.message, period_lock: err.payrollLock || null });
        }
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/salary/adjustments — list adjustments
router.get('/salary/adjustments', async (req, res) => {
    try {
        const { staff_id, month } = req.query;
        let sql = `SELECT sa.*, s.name AS staff_name FROM salary_adjustments sa
                   JOIN staff s ON s.id = sa.staff_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`sa.staff_id = $${params.length}`); }
        if (month) { params.push(month); conds.push(`sa.month = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sa.created_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/salary/adjustments error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// COSTUMES (#8)
// ==========================================

// LEGACY /api/hr/costumes — deprecated read/write compatibility.
// Current UI entry point is /warehouse#costumes and /api/warehouse/costumes.
function markLegacyCostumeResponse(res) {
    res.set('X-EventGenix-Deprecated', 'hr-costumes');
    res.set('X-EventGenix-Replacement', '/api/warehouse/costumes');
}

// GET /api/hr/costumes
router.get('/costumes', async (req, res) => {
    try {
        markLegacyCostumeResponse(res);
        const data = await costumeInventory.listCostumes();
        res.json({ success: true, data, deprecated: true, replacement: '/api/warehouse/costumes' });
    } catch (err) {
        log.error('GET /hr/costumes error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/costumes
router.post('/costumes', requireHrManage, async (req, res) => {
    try {
        markLegacyCostumeResponse(res);
        const data = await costumeInventory.createCostume(req.body);
        res.json({ success: true, data, deprecated: true, replacement: '/api/warehouse/costumes' });
    } catch (err) {
        log.error('POST /hr/costumes error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

// PUT /api/hr/costumes/:id
router.put('/costumes/:id', requireHrManage, async (req, res) => {
    try {
        markLegacyCostumeResponse(res);
        const data = await costumeInventory.updateCostume(req.params.id, req.body);
        res.json({ success: true, data, deprecated: true, replacement: '/api/warehouse/costumes' });
    } catch (err) {
        log.error('PUT /hr/costumes/:id error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

// DELETE /api/hr/costumes/:id
router.delete('/costumes/:id', requireHrManage, async (req, res) => {
    try {
        markLegacyCostumeResponse(res);
        await costumeInventory.deleteCostume(req.params.id);
        res.json({ success: true, deprecated: true, replacement: '/api/warehouse/costumes' });
    } catch (err) {
        log.error('DELETE /hr/costumes/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// AVAILABILITY (#10)
// ==========================================

// GET /api/hr/availability — real-time staff status
router.get('/availability', async (req, res) => {
    try {
        const today = todayKyiv();
        const result = await pool.query(`
            SELECT s.id, s.name, s.role_type, s.color, s.photo_url,
                   COALESCE(s.availability_status, 'offline') AS availability_status,
                   s.availability_updated_at, s.current_booking_id,
                   hs.planned_start, hs.planned_end,
                   tr.clock_in, tr.clock_out, tr.status AS time_status
            FROM staff s
            LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id AND tr.record_date = $1
            WHERE s.is_active = true
            ORDER BY
                CASE COALESCE(s.availability_status, 'offline')
                    WHEN 'busy' THEN 1 WHEN 'online' THEN 2 WHEN 'break' THEN 3 ELSE 4
                END,
                s.name
        `, [today]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/availability error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/availability/:staffId — update status
router.put('/availability/:staffId', requireHrManage, async (req, res) => {
    try {
        const { status, booking_id } = req.body;
        const validStatuses = ['online', 'busy', 'break', 'offline'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус' });
        }
        await pool.query(
            `UPDATE staff SET availability_status = $1, availability_updated_at = NOW(),
             current_booking_id = $2 WHERE id = $3`,
            [status, booking_id || null, req.params.staffId]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /hr/availability/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// в”Ђв”Ђв”Ђ Staff Shifts by display_name (v33.5) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// GET /api/hr/staff/:id/shifts?month=2026-03
router.get('/staff/:id/shifts', async (req, res) => {
    try {
        const staffRow = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.id]);
        if (!staffRow.rowCount) return res.status(404).json({ error: 'Staff not found' });
        const s           = staffRow.rows[0];
        const displayName = s.display_name || s.name;
        if (!displayName?.trim()) return res.json({ success: true, shifts: [], total: 0, displayName: null });
        const month    = req.query.month || new Date().toISOString().slice(0, 7);
        const [yr, mo] = month.split('-').map(Number);
        const dateFrom = `${month}-01`;
        const dateTo   = new Date(yr, mo, 0).toISOString().slice(0, 10);
        const result = await pool.query(
            `SELECT id, date, time, program_name, label,
                    CASE
                        WHEN hosts ILIKE '%' || $1 || '%' THEN 'host'
                        WHEN second_animator ILIKE '%' || $1 || '%' THEN 'second'
                    END AS role
             FROM bookings
             WHERE (hosts ILIKE '%' || $1 || '%' OR second_animator ILIKE '%' || $1 || '%')
               AND date >= $2 AND date <= $3
               AND status != 'cancelled'
             ORDER BY date, time`,
            [displayName.trim(), dateFrom, dateTo]
        );
        res.json({
            success: true,
            shifts: result.rows,
            total:    result.rowCount,
            asHost:   result.rows.filter(r => r.role === 'host').length,
            asSecond: result.rows.filter(r => r.role === 'second').length,
            displayName,
            period: { from: dateFrom, to: dateTo }
        });
    } catch (err) {
        log.error('GET /staff/:id/shifts', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/hr/shifts-summary?month=2026-03
router.get('/shifts-summary', async (req, res) => {
    try {
        const month    = req.query.month || new Date().toISOString().slice(0, 7);
        const [yr, mo] = month.split('-').map(Number);
        const dateFrom = `${month}-01`;
        const dateTo   = new Date(yr, mo, 0).toISOString().slice(0, 10);
        const staffList = await pool.query(
            `SELECT id, name, display_name FROM staff
             WHERE display_name IS NOT NULL AND display_name != '' AND is_active = true`
        );
        if (!staffList.rowCount) return res.json({ success: true, summary: [], period: { from: dateFrom, to: dateTo } });
        const summary = [];
        for (const s of staffList.rows) {
            const dn = s.display_name.trim();
            const r  = await pool.query(
                `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN hosts ILIKE '%'||$1||'%' THEN 1 ELSE 0 END) AS as_host,
                    SUM(CASE WHEN second_animator ILIKE '%'||$1||'%' THEN 1 ELSE 0 END) AS as_second
                 FROM bookings
                 WHERE (hosts ILIKE '%'||$1||'%' OR second_animator ILIKE '%'||$1||'%')
                   AND date >= $2 AND date <= $3
                   AND status != 'cancelled'`,
                [dn, dateFrom, dateTo]
            );
            summary.push({
                id: s.id, name: s.name, displayName: dn,
                total: parseInt(r.rows[0].total),
                asHost: parseInt(r.rows[0].as_host),
                asSecond: parseInt(r.rows[0].as_second)
            });
        }
        res.json({
            success: true,
            summary: summary.sort((a, b) => b.total - a.total),
            period: { from: dateFrom, to: dateTo }
        });
    } catch (err) {
        log.error('GET /shifts-summary', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/salary/reconciliation', async (req, res) => {
    try {
        const month = requirePayrollMonth(req.query.month);
        if (!month) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        const [periodLock, reconciliation, events] = await Promise.all([
            loadPayrollPeriodLock(month),
            loadPayrollReconciliation(month),
            loadPayrollPeriodEvents(month)
        ]);
        res.json({ success: true, month, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        log.error('GET /hr/salary/reconciliation error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/salary/period-lock', requirePayrollControl, async (req, res) => {
    try {
        const month = requirePayrollMonth(req.body?.month);
        if (!month) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        const actor = payrollActor(req.user);
        const locked = req.body?.locked !== false;
        const periodLock = await setPayrollPeriodLock(month, locked, actor, req.body?.note || '');
        const [reconciliation, events] = await Promise.all([
            loadPayrollReconciliation(month),
            loadPayrollPeriodEvents(month)
        ]);
        res.json({ success: true, month, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        log.error('POST /hr/salary/period-lock error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/salary/reverse', requirePayrollControl, async (req, res) => {
    const client = await pool.connect();
    try {
        const month = requirePayrollMonth(req.body?.month);
        if (!month) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        const reason = String(req.body?.reason || '').trim() || 'Сторно зарплатного періоду';
        const actor = payrollActor(req.user);
        const range = payrollMonthRange(month);

        await client.query('BEGIN');
        const reports = await client.query(
            `SELECT pr.id, pr.staff_id, pr.net_amount, pr.finance_transaction_id, s.name AS staff_name,
                    ft.category_id, ft.date AS finance_date
             FROM payroll_reports pr
             JOIN staff s ON s.id = pr.staff_id
             LEFT JOIN finance_transactions ft ON ft.id = pr.finance_transaction_id
             WHERE pr.period_month = $1
               AND pr.status = 'paid'
               AND pr.voided_at IS NULL
             ORDER BY s.name
             FOR UPDATE OF pr`,
            [month]
        );
        if (!reports.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: `Немає активних нарахувань зарплати за ${month}` });
        }

        const reversed = [];
        for (const report of reports.rows) {
            const amount = Math.round(Number(report.net_amount || 0));
            let reversalTransactionId = null;
            if (amount > 0) {
                const tx = await client.query(
                    `INSERT INTO finance_transactions
                        (type, category_id, amount, description, date, payment_method, staff_id, created_by)
                     VALUES ('income', $1, $2, $3, $4, 'salary_reversal', $5, $6)
                     RETURNING id`,
                    [
                        report.category_id || null,
                        amount,
                        `Сторно зарплати ${report.staff_name} за ${month}: ${reason}`,
                        range.to,
                        report.staff_id,
                        actor
                    ]
                );
                reversalTransactionId = tx.rows[0].id;
            }
            await client.query(
                `UPDATE payroll_reports
                 SET status = 'voided',
                     voided_at = NOW(),
                     voided_by = $1,
                     void_reason = $2,
                     reversal_transaction_id = $3,
                     updated_by = $1,
                     updated_at = NOW()
                 WHERE id = $4`,
                [actor, reason, reversalTransactionId, report.id]
            );
            reversed.push({ staffId: report.staff_id, name: report.staff_name, amount, reversalTransactionId });
        }

        const reversedTotal = reversed.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const periodLock = await setPayrollPeriodLock(month, false, actor, `Сторновано: ${reason}`, client);
        await recordPayrollPeriodEvent(month, 'reverse', actor, reason, { count: reversed.length, amount: reversedTotal }, client);
        const reconciliation = await loadPayrollReconciliation(month, client);
        const events = await loadPayrollPeriodEvents(month, client);
        await client.query('COMMIT');

        res.json({ success: true, month, reversed, count: reversed.length, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/salary/reverse error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// ==========================================
// v33.8.0 Integration 9: Salary commit to finance
// ==========================================

// POST /api/hr/salary/commit — record calculated salaries as finance transactions
router.post('/salary/commit', requirePayrollControl, async (req, res) => {
    const client = await pool.connect();
    try {
        const month = requirePayrollMonth(req.body?.month);
        if (!month) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        const actor = payrollActor(req.user);

        await client.query('BEGIN');
        await assertPayrollPeriodOpen(month, client);

        const activeReports = await client.query(
            `SELECT COUNT(*)::int AS c
             FROM payroll_reports
             WHERE period_month = $1
               AND status = 'paid'
               AND voided_at IS NULL`,
            [month]
        );
        if (parseInt(activeReports.rows[0].c, 10) > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: `Зарплати за ${month} вже мають активні payroll-звіти (${activeReports.rows[0].c})` });
        }

        // Check if already committed
        const already = await client.query(
            `SELECT COUNT(*)::int AS c
             FROM finance_transactions ft
             LEFT JOIN payroll_reports pr ON pr.finance_transaction_id = ft.id AND pr.period_month = $2
             WHERE ft.payment_method = 'salary'
               AND ft.date::date >= $1::date
               AND ft.date::date <= ($1::date + INTERVAL '1 month - 1 day')
               AND (pr.id IS NULL OR pr.voided_at IS NULL)`,
            [`${month}-01`, month]
        );
        if (parseInt(already.rows[0].c) > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: `Зарплати за ${month} вже нараховано (${already.rows[0].c} транзакцій)` });
        }

        const calculation = await loadPayrollCalculation(month, client);

        // Find salary expense category
        const salCat = await client.query(
            `SELECT id FROM finance_categories WHERE name ILIKE '%зарплат%' AND type = 'expense' LIMIT 1`
        );
        const catId = salCat.rows[0]?.id || null;

        const inserted = [];
        for (const row of calculation.data) {
            const totalSalary = Number(row.total_salary || 0);
            if (totalSalary <= 0) continue;
            const grossAmount = Number(row.base_salary || 0) + Number(row.overtime_pay || 0) + Number(row.bonuses || 0) + Number(row.tips || 0);
            const deductionsAmount = Number(row.deductions || 0) + Number(row.penalties || 0);
            const breakdown = {
                base_salary: row.base_salary,
                overtime_pay: row.overtime_pay,
                bonuses: row.bonuses,
                tips: row.tips,
                deductions: row.deductions,
                penalties: row.penalties,
                hours_worked: row.hours_worked,
                overtime_hours: row.overtime_hours,
                profession_rates: row.profession_rate_summary
            };

            const reportResult = await client.query(
                `INSERT INTO payroll_reports
                    (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount, status,
                     breakdown_json, generated_at, committed_at, committed_by, created_by, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4, 0, $5, 'paid', $6::jsonb, NOW(), NOW(), $7, $7, $7, NOW())
                 ON CONFLICT (period_month, staff_id) DO UPDATE SET
                    gross_amount = EXCLUDED.gross_amount,
                    deductions_amount = EXCLUDED.deductions_amount,
                    advances_amount = 0,
                    net_amount = EXCLUDED.net_amount,
                    status = 'paid',
                    breakdown_json = EXCLUDED.breakdown_json,
                    generated_at = NOW(),
                    committed_at = NOW(),
                    committed_by = EXCLUDED.committed_by,
                    finance_transaction_id = NULL,
                    reversal_transaction_id = NULL,
                    voided_at = NULL,
                    voided_by = NULL,
                    void_reason = NULL,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()
                 RETURNING id`,
                [month, row.staff_id, grossAmount, deductionsAmount, totalSalary, JSON.stringify(breakdown), actor]
            );

            await client.query('DELETE FROM payroll_entries WHERE staff_id = $1 AND period_month = $2', [row.staff_id, month]);
            const entryRows = [
                { type: 'base', label: 'Базова зарплата', amount: row.base_salary, quantity: row.hours_worked, meta: { profession_rates: row.profession_rate_summary } },
                { type: 'adjustment', label: 'Переробка', amount: row.overtime_pay, quantity: row.overtime_hours },
                { type: 'bonus', label: 'Бонуси', amount: row.bonuses },
                { type: 'bonus', label: 'Чайові', amount: row.tips },
                { type: 'deduction', label: 'Вирахування', amount: row.deductions },
                { type: 'deduction', label: 'Депреміювання', amount: row.penalties }
            ].filter(entry => Number(entry.amount || 0) !== 0);
            for (const entry of entryRows) {
                await client.query(
                    `INSERT INTO payroll_entries
                        (staff_id, period_month, line_type, label, amount, quantity, rate, meta_json, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, $8)`,
                    [row.staff_id, month, entry.type, entry.label, Number(entry.amount || 0), entry.quantity || null, JSON.stringify(entry.meta || {}), actor]
                );
            }

            const r = await client.query(
                `INSERT INTO finance_transactions
                    (type, category_id, amount, description, date, payment_method, staff_id, created_by)
                 VALUES ('expense', $1, $2, $3, $4, 'salary', $5, $6)
                 RETURNING id`,
                [
                    catId,
                    totalSalary,
                    `Зарплата ${row.staff_name} за ${month} (${Math.round(Number(row.hours_worked || 0))}г, ставки: ${(row.profession_rate_summary || []).map(segment => `${segment.profession_key} ${segment.rate} грн/г`).join(', ') || `${row.hourly_rate} грн/г`})`,
                    new Date(parseInt(month.split('-')[0], 10), parseInt(month.split('-')[1], 10), 0).toISOString().slice(0, 10),
                    row.staff_id,
                    actor
                ]
            );
            await client.query(
                `UPDATE payroll_reports
                 SET finance_transaction_id = $1,
                     updated_by = $2,
                     updated_at = NOW()
                 WHERE id = $3`,
                [r.rows[0].id, actor, reportResult.rows[0].id]
            );
            inserted.push({ staffId: row.staff_id, name: row.staff_name, amount: totalSalary, transactionId: r.rows[0].id });
        }

        const periodLock = await setPayrollPeriodLock(month, true, actor, 'Автоматично закрито після нарахування зарплати', client);
        const committedTotal = inserted.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        await recordPayrollPeriodEvent(month, 'commit', actor, 'Зарплату нараховано у фінанси', { count: inserted.length, amount: committedTotal }, client);
        const reconciliation = await loadPayrollReconciliation(month, client);
        const events = await loadPayrollPeriodEvents(month, client);
        await client.query('COMMIT');
        log.info(`[SalaryCommit] Committed ${inserted.length} salaries for ${month}`);
        res.json({ success: true, count: inserted.length, committed: inserted.length, transactions: inserted, totals: calculation.totals, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('[SalaryCommit] Error', err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.message, period_lock: err.payrollLock || null });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
// ВАКАНСІЇ — CRUD
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

router.get('/vacancies', async (req, res) => {
    try {
        const { status = 'open', role_type } = req.query;
        let q = `SELECT v.*, (SELECT COUNT(*) FROM job_applications a WHERE a.vacancy_id=v.id AND a.status!='rejected') as active_candidates FROM job_vacancies v`;
        const conds = [], params = [];
        if (status !== 'all') { conds.push(`v.status=$${params.length+1}`); params.push(status); }
        if (role_type)        { conds.push(`v.role_type=$${params.length+1}`); params.push(role_type); }
        if (conds.length) q += ' WHERE ' + conds.join(' AND ');
        q += ` ORDER BY CASE v.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, v.created_at DESC`;
        const r = await pool.query(q, params);
        res.json({ success: true, vacancies: r.rows });
    } catch (err) { log.error('GET /vacancies', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/vacancies', requireHrManage, async (req, res) => {
    const { title, role_type, department = 'animators', description, requirements,
            salary_from, salary_to, schedule, work_format = 'office',
            status = 'open', priority = 'normal' } = req.body;
    if (!title?.trim() || !role_type) return res.status(400).json({ error: 'title і role_type обов\'язкові' });
    try {
        const r = await pool.query(
            `INSERT INTO job_vacancies (title,role_type,department,description,requirements,salary_from,salary_to,schedule,work_format,status,priority,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [title.trim(), role_type, department, description||null, requirements||null,
             salary_from||null, salary_to||null, schedule||null, work_format, status, priority, req.user?.username||null]);
        res.json({ success: true, vacancy: r.rows[0] });
    } catch (err) { log.error('POST /vacancies', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/vacancies/:id', requireHrManage, async (req, res) => {
    const { status, priority, description, requirements, salary_from, salary_to, schedule, title } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (title !== undefined)       { sets.push(`title=$${i++}`);       vals.push(title); }
    if (status)                    { sets.push(`status=$${i++}`);      vals.push(status); }
    if (priority)                  { sets.push(`priority=$${i++}`);    vals.push(priority); }
    if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
    if (requirements !== undefined){ sets.push(`requirements=$${i++}`); vals.push(requirements); }
    if (salary_from !== undefined) { sets.push(`salary_from=$${i++}`); vals.push(salary_from); }
    if (salary_to !== undefined)   { sets.push(`salary_to=$${i++}`);   vals.push(salary_to); }
    if (schedule !== undefined)    { sets.push(`schedule=$${i++}`);    vals.push(schedule); }
    if (['filled','closed'].includes(status)) sets.push('closed_at=NOW()');
    if (!sets.length) return res.status(400).json({ error: 'Нічого оновлювати' });
    vals.push(parseInt(req.params.id));
    try {
        await pool.query(`UPDATE job_vacancies SET ${sets.join(',')} WHERE id=$${i}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/vacancies/:id', requireHrManage, async (req, res) => {
    try {
        await pool.query(`UPDATE job_vacancies SET status='closed', closed_at=NOW() WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
// КАНДИДАТИ — CRUD
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

router.get('/vacancies/:id/applications', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM job_applications WHERE vacancy_id=$1 ORDER BY created_at DESC', [req.params.id]);
        const filesByApplication = await loadResumeFilesForApplications(r.rows.map(row => row.id));
        const applications = r.rows.map(row => ({
            ...row,
            resume_files: filesByApplication.get(parseInt(row.id, 10)) || []
        }));
        res.json({ success: true, applications });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/vacancies/:id/applications', requireHrManage, async (req, res) => {
    const {
        name, phone, telegram_username, telegram_id, source = 'manual', notes, salary_expectation, cv_url,
        birth_date, address, availability, experience, interview_notes, raw_application_text, parsed_payload
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name обов\'язковий' });
    try {
        const r = await pool.query(
            `INSERT INTO job_applications
                (vacancy_id,name,phone,telegram_username,telegram_id,source,notes,salary_expectation,cv_url,added_by,
                 birth_date,address,availability,experience,interview_notes,raw_application_text,parsed_payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [parseInt(req.params.id), name.trim(), phone||null, telegram_username||null, telegram_id||null,
             source, notes||null, salary_expectation||null, cv_url||null, req.user?.username||null,
             birth_date || null, address || null, availability || null, experience || null, interview_notes || null,
             raw_application_text || null, parsed_payload ? JSON.stringify(parsed_payload) : null]);
        res.json({ success: true, application: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/applications/:id/resume-files', async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const app = await pool.query('SELECT id FROM job_applications WHERE id=$1 LIMIT 1', [appId]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });
        const filesByApplication = await loadResumeFilesForApplications([appId]);
        res.json({ success: true, files: filesByApplication.get(appId) || [] });
    } catch (err) {
        log.error('GET /applications/:id/resume-files', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/applications/:id/resume-files', requireHrManage, handleResumeUpload, async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) return res.status(400).json({ success: false, error: 'Додайте хоча б один файл резюме' });

        const app = await pool.query('SELECT id, raw_application_text, cv_url FROM job_applications WHERE id=$1 LIMIT 1', [appId]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });

        const inserted = [];
        for (const file of files) {
            const ext = resumeFileExt(file);
            const extraction = extractResumeText(file);
            const row = await pool.query(
                `INSERT INTO job_application_resume_files
                    (application_id, original_name, mime_type, file_ext, file_size, file_data,
                     extracted_text, extraction_status, extraction_note, uploaded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 RETURNING id, application_id, original_name, mime_type, file_ext, file_size,
                           extracted_text, extraction_status, extraction_note, uploaded_by, created_at`,
                [
                    appId,
                    file.originalname || 'resume',
                    file.mimetype || null,
                    ext || null,
                    file.size || file.buffer.length,
                    file.buffer,
                    extraction.text,
                    extraction.status,
                    extraction.note,
                    req.user?.username || null
                ]
            );
            inserted.push(resumeFileMeta(row.rows[0]));
        }

        const extractedBlocks = inserted
            .filter(file => file.extracted_text)
            .map(file => `Імпортовано з файлу ${file.original_name}:\n${file.extracted_text}`);
        const appendedText = extractedBlocks.length ? extractedBlocks.join('\n\n') : null;
        const firstDownloadUrl = inserted[0]?.download_url || null;
        await pool.query(
            `UPDATE job_applications
             SET raw_application_text = CASE
                    WHEN $2::text IS NULL THEN raw_application_text
                    WHEN NULLIF(BTRIM(COALESCE(raw_application_text, '')), '') IS NULL THEN $2::text
                    ELSE raw_application_text || E'\n\n' || $2::text
                 END,
                 cv_url = COALESCE(cv_url, $3),
                 updated_at = NOW()
             WHERE id=$1`,
            [appId, appendedText, firstDownloadUrl]
        );

        res.json({
            success: true,
            files: inserted,
            extracted_text_appended: Boolean(appendedText)
        });
    } catch (err) {
        log.error('POST /applications/:id/resume-files', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/applications/:id/resume-files/:fileId/download', async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const fileId = parseInt(req.params.fileId, 10);
        if (!Number.isFinite(fileId)) return res.status(400).json({ error: 'Invalid file id' });
        const r = await pool.query(
            `SELECT id, application_id, original_name, mime_type, file_size, file_data
             FROM job_application_resume_files
             WHERE id=$1 AND application_id=$2`,
            [fileId, appId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        const file = r.rows[0];
        const filename = safeDownloadName(file.original_name);
        const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', file.file_size || file.file_data.length);
        res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(file.file_data);
    } catch (err) {
        log.error('GET /applications/:id/resume-files/:fileId/download', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/applications/:id', requireHrManage, async (req, res) => {
    const { status, notes, interview_date, salary_expectation, address, birth_date, availability, experience, interview_notes, raw_application_text, parsed_payload } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (status)              { sets.push(`status=$${i++}`); vals.push(status); }
    if (notes !== undefined) { sets.push(`notes=$${i++}`);  vals.push(notes); }
    if (interview_date)      { sets.push(`interview_date=$${i++}`); vals.push(interview_date); }
    if (salary_expectation)  { sets.push(`salary_expectation=$${i++}`); vals.push(salary_expectation); }
    if (address !== undefined) { sets.push(`address=$${i++}`); vals.push(address); }
    if (birth_date !== undefined) { sets.push(`birth_date=$${i++}`); vals.push(birth_date || null); }
    if (availability !== undefined) { sets.push(`availability=$${i++}`); vals.push(availability); }
    if (experience !== undefined) { sets.push(`experience=$${i++}`); vals.push(experience); }
    if (interview_notes !== undefined) { sets.push(`interview_notes=$${i++}`); vals.push(interview_notes); }
    if (raw_application_text !== undefined) { sets.push(`raw_application_text=$${i++}`); vals.push(raw_application_text); }
    if (parsed_payload !== undefined) { sets.push(`parsed_payload=$${i++}`); vals.push(parsed_payload ? JSON.stringify(parsed_payload) : null); }
    sets.push('updated_at=NOW()');
    vals.push(parseInt(req.params.id));
    try {
        await pool.query(`UPDATE job_applications SET ${sets.join(',')} WHERE id=$${i}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/applications/:id/hire', requireHrManage, async (req, res) => {
    try {
        const app = await pool.query(
            `SELECT a.*, v.role_type, v.title as vac_title FROM job_applications a
             JOIN job_vacancies v ON v.id=a.vacancy_id WHERE a.id=$1`, [req.params.id]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });
        const a = app.rows[0];
        await pool.query("UPDATE job_applications SET status='hired', updated_at=NOW() WHERE id=$1", [req.params.id]);
        await pool.query("UPDATE job_vacancies SET status='filled', closed_at=NOW() WHERE id=$1", [a.vacancy_id]);
        const { department = 'animators', salary } = req.body;
        const staffResult = await pool.query(
            `INSERT INTO staff (name, department, position, phone, role_type, hire_date, telegram_username, telegram_id, hourly_rate, address, is_active)
             VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7,$8,$9,true) RETURNING id`,
            [a.name, department, a.vac_title, a.phone||null, a.role_type,
             a.telegram_username||null, a.telegram_id||null, salary||0, a.address || null]);
        res.json({ success: true, staff_id: staffResult.rows[0].id, message: `${a.name} найнятий як ${a.role_type}` });
    } catch (err) { log.error('POST /applications/:id/hire', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ==========================================
// v43.0: DEPREMIUM COMPLIANCE SYSTEM
// ==========================================

// GET /api/hr/depremium-templates — catalog of official rules
router.get('/depremium-templates', async (req, res) => {
    try {
        const { q, category, severity, active = 'true' } = req.query;
        const params = []; const conds = [];
        if (active !== 'all') { params.push(active === 'true'); conds.push(`active = $${params.length}`); }
        if (category) { params.push(category); conds.push(`discipline_category = $${params.length}`); }
        if (severity) { params.push(severity); conds.push(`severity = $${params.length}`); }
        if (q) { params.push(`%${q}%`); conds.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length} OR official_reason ILIKE $${params.length})`); }
        let sql = 'SELECT * FROM depremium_templates';
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sort_order, id';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /depremium-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/depremium-templates/:id/staff-history/:staffId — repeat detection
router.get('/depremium-templates/:templateId/staff-history/:staffId', async (req, res) => {
    try {
        const { templateId, staffId } = req.params;
        const result = await pool.query(
            `SELECT sa.id, sa.created_at, sa.amount, sa.reason, sa.status, sa.rule_code, sa.repeat_index
             FROM salary_adjustments sa
             WHERE sa.staff_id = $1 AND sa.type IN ('penalty','deduction')
             AND (sa.template_id = $2 OR sa.template_id IN (SELECT id FROM depremium_templates WHERE repeat_of_template_id = $2))
             ORDER BY sa.created_at DESC LIMIT 20`,
            [staffId, templateId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /depremium-templates/:id/staff-history/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/depremium-summary — analytics for period
router.get('/depremium-summary', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const { month } = req.query;
        if (!month) return res.status(400).json({ success: false, error: 'month обовʼязковий (YYYY-MM)' });
        const topReasons = await pool.query(
            `SELECT COALESCE(rule_code,'CUSTOM') AS rule_code, COUNT(*)::int AS count, SUM(COALESCE(amount,0))::int AS total
             FROM salary_adjustments WHERE type IN ('penalty','deduction') AND month = $1
             GROUP BY COALESCE(rule_code,'CUSTOM') ORDER BY count DESC LIMIT 10`, [month]);
        const repeatStaff = await pool.query(
            `SELECT sa.staff_id, s.name AS staff_name, COUNT(*)::int AS cnt
             FROM salary_adjustments sa JOIN staff s ON s.id = sa.staff_id
             WHERE sa.type IN ('penalty','deduction') AND sa.month = $1
             GROUP BY sa.staff_id, s.name HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 10`, [month]);
        const criticalCount = await pool.query(
            `SELECT COUNT(*)::int AS c FROM salary_adjustments
             WHERE type IN ('penalty','deduction') AND month = $1 AND severity = 'critical'`, [month]);
        const totalCount = await pool.query(
            `SELECT COUNT(*)::int AS c, SUM(COALESCE(amount,0))::int AS total
             FROM salary_adjustments WHERE type IN ('penalty','deduction') AND month = $1`, [month]);
        res.json({
            success: true,
            data: {
                total: totalCount.rows[0]?.c || 0,
                totalAmount: totalCount.rows[0]?.total || 0,
                critical: criticalCount.rows[0]?.c || 0,
                topReasons: topReasons.rows,
                repeatStaff: repeatStaff.rows
            }
        });
    } catch (err) {
        log.error('GET /depremium-summary error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/salary/adjustment/:id/approve — approve pending review
router.put('/salary/adjustment/:id/approve', requireRole('creator', 'director', 'vice_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE salary_adjustments SET status = 'applied', approved_by = $1, approved_at = NOW()
             WHERE id = $2 AND status = 'pending_review' RETURNING *`,
            [req.user?.username, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не знайдено або вже затверджено' });
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,'approve',$3,$4,$5,'{}')`,
            [result.rows[0].id, result.rows[0].staff_id, req.user?.username, req.user?.role, result.rows[0].template_id]
        ).catch(e => log.warn('Discipline approve log failed:', e.message));
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /salary/adjustment/:id/approve error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/salary/adjustment/:id/reject — reject pending review
router.put('/salary/adjustment/:id/reject', requireRole('creator', 'director', 'vice_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE salary_adjustments SET status = 'rejected', approved_by = $1, approved_at = NOW()
             WHERE id = $2 AND status = 'pending_review' RETURNING *`,
            [req.user?.username, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не знайдено або вже оброблено' });
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,'reject',$3,$4,$5,$6)`,
            [result.rows[0].id, result.rows[0].staff_id, req.user?.username, req.user?.role, result.rows[0].template_id, JSON.stringify({ reason: req.body.reason || '' })]
        ).catch(e => log.warn('Discipline reject log failed:', e.message));
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /salary/adjustment/:id/reject error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/discipline-log — audit trail
router.get('/discipline-log', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const { staff_id, limit = 50 } = req.query;
        const params = [parseInt(limit)];
        let where = '';
        if (staff_id) { params.push(staff_id); where = `WHERE dal.staff_id = $${params.length}`; }
        const result = await pool.query(
            `SELECT dal.*, s.name AS staff_name, dt.code AS template_code, dt.title AS template_title
             FROM discipline_actions_log dal
             LEFT JOIN staff s ON s.id = dal.staff_id
             LEFT JOIN depremium_templates dt ON dt.id = dal.template_id
             ${where} ORDER BY dal.created_at DESC LIMIT $1`, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /discipline-log error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

module.exports = router;
