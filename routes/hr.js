/**
 * routes/hr.js — HR module API (v30.7)
 *
 * Endpoints: staff HR data, shifts, clock-in/out, time records, reports, templates
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getKyivDate, getKyivDateStr, reconcileScheduledAnimatorLines } = require('../services/booking');
const { broadcastLineEvent } = require('../services/websocket');
const costumeInventory = require('../services/costumeInventory');
const { requireAction, requireRole, canUseAction, ROLE_LEVEL } = require('../middleware/auth');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');
const { isProtectedSystemAccount } = require('../services/accountOnboarding');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest
} = require('../services/businessContext');
const {
    lockAttendanceWriteMaintenance,
    lockAttendanceWriteTarget,
    lockAttendanceWriteTargets
} = require('../services/attendanceWriteLock');
const {
    attendancePlanFromCompensationSnapshot,
    buildLegacyAttendanceCompensationSnapshot,
    calculateAttendanceClockIn,
    calculateHrClockOutPayroll,
    attendanceCsvRow,
    attendanceFactMinutes,
    attendancePlanWarningMessage,
    decorateAttendanceRecord,
    finalizeAttendanceCompensationSnapshot,
    hydrateAttendanceRecords,
    parseAttendanceCompensationSnapshot,
    recordAttendanceClockIn,
    recordAttendanceClockOut,
    recordAttendanceStatus,
    summarizeHrTodayItems,
    timeToMinutes
} = require('../services/hrAttendance');
const { listTaskOwnerCandidates } = require('../services/taskExecution');
const {
    ONBOARDING_TASK_SOURCE_TYPE,
    assignOnboardingResponsible,
    attachOnboardingAssignments,
    attachProfessionOnboardingContext,
    loadActiveOnboardingProgress,
    loadOnboardingProcessesForStaff,
    loadStaffForOnboarding,
    onboardingProgressMeta,
    syncProfessionOnboardingProgress,
    syncProfessionOnboardingProgressForProfession
} = require('../services/hrOnboarding');
const {
    parseTextList,
    normalizeProfessionKey,
    normalizeSecondaryProfessions,
    normalizeProfessionCatalogRow,
    isHiddenProfessionKey,
    loadProfessionWorkspaceCatalog,
    loadProfessionWorkspace,
    saveStaffProfessionCondition,
    professionCatalogActiveKeySet,
    validateProfessionKeys,
    staffProfessionKeys
} = require('../services/professions');
const {
    isProfessionChecklistError,
    loadProfessionChecklistTemplate,
    createProfessionChecklistItem,
    renameProfessionChecklistItem,
    reorderProfessionChecklistItems,
    archiveProfessionChecklistItem,
    loadStaffProfessionChecklistProgress,
    loadProfessionChecklistProgressBatch,
    toggleStaffProfessionChecklistProgress,
    loadProfessionChecklistDashboard
} = require('../services/professionChecklists');
const {
    activeStaffWhere,
    loadStaffScheduleabilityCards,
    scheduleableStaffErrorPayload,
    scheduleableStaffWhere,
    validateStaffScheduleabilityCardForDate,
    validateStaffScheduleableForDate
} = require('../services/staffOperationalFilters');
const {
    decorateStaffRowsWithDisplayGroups,
    decorateStaffWithDisplayGroup,
    loadStaffDisplayGroupContext,
    listStaffDisplayGroups,
    normalizeStaffCompanyStructurePayload,
    staffStructureDisplayGroupKey
} = require('../services/staffDisplayGroups');
const {
    cleanupFutureStaffOperationalSchedule,
    syncLinkedStaffAccountDeactivation
} = require('../services/staffLifecycle');
const {
    listVacancyPlatformTemplates,
    formatVacancyForPlatform
} = require('../services/hrVacancyPlatformFormatter');
const {
    assertPayrollPeriodOpen,
    loadPayrollPeriodEvents,
    loadPayrollPeriodLock,
    loadPayrollReconciliation,
    payrollMonthRange,
    payrollPeriodRange,
    recordPayrollPeriodEvent,
    requirePayrollMonth,
    setPayrollPeriodLock
} = require('../services/hrPayrollPeriod');
const {
    assertPayrollRowsCommitReady,
    buildPayrollTransparencyMetrics,
    calculateProfessionPay,
    loadActivePayrollSchemeMap,
    loadPayrollAttendanceMetrics,
    loadPayrollProfileContext,
    loadProfessionRateMap
} = require('../services/payroll');
const {
    createStaffPayrollScheme,
    loadStaffPayrollSchemeWorkspace
} = require('../services/hrPayrollSchemes');
const {
    applyPayrollProfileBulk,
    archivePayrollProfile,
    createPayrollProfile,
    createPayrollProfileClone,
    createPayrollProfileVersion,
    diagnosePayrollProfiles,
    forecastPayrollProfiles,
    getPayrollProfile,
    impactPayrollProfilePreview,
    listPayrollProfiles,
    listStaffPayrollProfileAssignments,
    listStaffPayrollProfileHistory,
    previewPayrollProfileBulk,
    saveStaffPayrollProfileAssignments,
    simulatePayrollProfiles,
    syncPayrollProfileFromBase
} = require('../services/hrPayrollProfiles');
const {
    hrShiftPlanErrorPayload,
    hrShiftPlanUpdatedAt,
    hydrateHrShiftDayPlans,
    isHrShiftPlanError,
    loadHrShiftDayPlan,
    loadHrShiftDayPlansForStaffDates,
    loadPaidRoleValidationContext,
    normalizeHrShiftDayPlan,
    professionCardFromStaff,
    recordPaidRoleAuditEvents,
    saveHrShiftDayPlan,
    validateHrShiftDayPlanProfessions
} = require('../services/hrShiftSegments');
const {
    lockScheduleStaffRows,
    normalizeScheduleDate,
    scheduleDateSequence
} = require('../services/staffScheduleMutations');
const {
    LIVE_MULTI_SEGMENT_QA_CONFIRMATION,
    LIVE_MULTI_SEGMENT_QA_VERSION,
    assertLiveQaConfirmation,
    assertLiveQaStaff,
    liveQaMarker,
    normalizeLiveQaRunId,
    normalizeLiveQaTime
} = require('../services/liveMultiSegmentQa');
const {
    archiveStaffDocument,
    createStaffDocument,
    handleStaffDocumentUpload,
    listStaffDocuments,
    loadStaffDocumentDownload,
    safeStaffDocumentDownloadFilename
} = require('../services/hrStaffDocuments');
const {
    issueStaffResource,
    listStaffResourceOptions,
    listStaffResources,
    returnStaffResource
} = require('../services/hrStaffResources');
const {
    buildHrAttendanceDocumentSnapshot
} = require('../services/hrAttendanceDocuments');
const {
    buildHrAttendanceDocumentPdfBuffer,
    hrAttendanceDocumentPdfFilename
} = require('../services/hrAttendanceDocumentsPdf');
const {
    createAutomation: createHrAttendanceDocumentAutomation,
    disableAutomation: disableHrAttendanceDocumentAutomation,
    getJobPdf: getHrAttendanceDocumentJobPdf,
    listAutomations: listHrAttendanceDocumentAutomations,
    listJobs: listHrAttendanceDocumentJobs,
    manualRun: runHrAttendanceDocumentAutomation,
    requeueJob: requeueHrAttendanceDocumentJob,
    cancelJob: cancelHrAttendanceDocumentJob,
    updateAutomation: updateHrAttendanceDocumentAutomation
} = require('../services/hrAttendanceDocumentAutomation');

// RBAC: HR module — security can inspect HR surfaces, but mutations stay manager/HR owned.
const HR_VIEW_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'security'];
const HR_MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'];
const PAYROLL_CONTROL_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'admin'];
const requireHrManage = requireAction('manage_staff');
const requirePayrollControl = requireRole(...PAYROLL_CONTROL_ROLES);
// Operational caps keep Cartesian bulk work bounded while preserving the existing 500-row API ceiling.
const HR_SHIFT_BULK_MAX_ENTRIES = 500;
const HR_SHIFT_BULK_MAX_STAFF = 500;
const HR_SHIFT_BULK_MAX_DATES = 31;
const HR_SHIFT_COPY_WEEK_DATE_COUNT = 7;
const HR_SHIFT_COPY_WEEK_MAX_STAFF = 500;
router.use(requireRole(...HR_VIEW_ROLES));
// v40: Validate numeric ID params
router.param('id', (req, res, next, val) => { if (val && !/^[0-9]+$/.test(val)) return res.status(400).json({ error: 'Invalid ID' }); next(); });

const log = createLogger('HR');

function canViewPayrollDetails(user = {}) {
    return PAYROLL_CONTROL_ROLES.includes(String(user.role || '').trim());
}

function redactPayrollAuditValue(value) {
    if (Array.isArray(value)) return value.map(redactPayrollAuditValue);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const sensitive = normalized === 'rate'
            || normalized.endsWith('rate')
            || normalized.endsWith('rates')
            || normalized.endsWith('amount')
            || normalized.endsWith('multiplier')
            || normalized.endsWith('formula');
        if (sensitive) continue;
        result[key] = redactPayrollAuditValue(nested);
    }
    return result;
}

function publicHrAuditRow(row = {}, user = {}) {
    if (canViewPayrollDetails(user)) return row;
    return {
        ...row,
        details: {
            ...redactPayrollAuditValue(row.details || {}),
            payrollDetailsRedacted: true
        }
    };
}

function rosterDates(values = []) {
    return [...new Set(values.map(toDateOnly).filter(Boolean))].sort();
}

async function reconcileRosterDates(client, values = []) {
    for (const date of rosterDates(values)) await reconcileScheduledAnimatorLines(date, client);
}

function broadcastRosterDates(values = [], userId = null) {
    rosterDates(values).forEach(date => broadcastLineEvent('timeline:roster-updated', {
        date,
        businessContext: DEFAULT_BUSINESS_CONTEXT
    }, null));
}

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

function cleanStaffText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function cleanStaffDate(value) {
    const normalized = cleanStaffText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeStaffPhotoUrl(value) {
    if (value === null || value === undefined) return { ok: true, value: null };
    const normalized = String(value).replace(/\u0000/g, '').trim();
    if (!normalized) return { ok: true, value: null };
    if (normalized.length > 500) {
        return { ok: false, error: 'URL фото має бути до 500 символів' };
    }
    const lower = normalized.toLowerCase();
    if (lower.startsWith('https://') || normalized.startsWith('/uploads/') || normalized.startsWith('/images/')) {
        return { ok: true, value: normalized };
    }
    return { ok: false, error: 'Фото має бути https URL або шляхом /uploads/... чи /images/...' };
}

function normalizeStaffCertificationStatus(value) {
    const status = cleanStaffText(value, 32) || 'active';
    return ['active', 'expired', 'revoked'].includes(status) ? status : 'active';
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

function normalizeStaffRateUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    if (['day', 'daily', 'per_day', 'per-day'].includes(unit)) return 'day';
    if (['month', 'monthly', 'per_month', 'per-month'].includes(unit)) return 'month';
    return 'hour';
}

function staffRateUnit(row = {}) {
    return normalizeStaffRateUnit(row.rate_unit ?? row.rateUnit);
}

function payrollAmountForRate(rate, rateUnit, minutes = 0, days = 0) {
    const normalizedRate = Number(rate || 0);
    if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) return 0;
    const unit = normalizeStaffRateUnit(rateUnit);
    if (unit === 'month') return Math.max(0, Number(days || 0)) > 0 || Math.max(0, Number(minutes || 0)) > 0 ? normalizedRate : 0;
    return unit === 'day'
        ? normalizedRate * Math.max(0, Number(days || 0))
        : normalizedRate * (Math.max(0, Number(minutes || 0)) / 60.0);
}

function rateUnitLabel(unit) {
    const normalized = normalizeStaffRateUnit(unit);
    if (normalized === 'day') return 'день';
    if (normalized === 'month') return 'міс';
    return 'г';
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
        rate_unit: staffRateUnit(row),
        rateUnit: staffRateUnit(row),
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
        rate_unit: staffRateUnit(staff),
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
                is_active, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit
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

function accountHasCreatorRole(account = {}) {
    const extraRoles = Array.isArray(account.extra_roles) ? account.extra_roles : [];
    return [account.role, ...extraRoles].filter(Boolean).includes('creator');
}

function accountRoleLevel(role) {
    return ROLE_LEVEL[String(role || '').trim()] ?? -1;
}

function accountRoleSet(account = {}) {
    const roles = [];
    [account.role, ...(Array.isArray(account.extra_roles) ? account.extra_roles : [])].forEach(role => {
        const value = String(role || '').trim();
        if (value && !roles.includes(value)) roles.push(value);
    });
    return roles;
}

function accountMaxRoleLevel(account = {}) {
    return accountRoleSet(account).reduce((max, role) => Math.max(max, accountRoleLevel(role)), -1);
}

function actorCanDisableOffboardingAccount(actor, account = {}) {
    if (!actor || !canUseAction(actor, 'manage_accounts')) return false;
    if (Number(account.id) === Number(actor.id)) return false;
    if (isProtectedSystemAccount(account)) return false;
    if (accountHasCreatorRole(account)) return false;
    if (actor.role === 'creator') return true;
    return accountMaxRoleLevel(account) < accountRoleLevel('director');
}

function accountOffboardingBlockReason(actor, account = {}) {
    if (Number(account.id) === Number(actor?.id)) return 'current_user';
    if (isProtectedSystemAccount(account)) return 'protected_system_account';
    if (accountHasCreatorRole(account)) return 'protected_role';
    if (!canUseAction(actor, 'manage_accounts')) return 'requires_manage_accounts';
    if (!actorCanDisableOffboardingAccount(actor, account)) return 'protected_role';
    return null;
}

function staffOffboardingDisableError(blockers = []) {
    if (blockers.some(account => account.block_reason === 'requires_manage_accounts')) {
        return 'Вимкнення CRM-акаунта через offboarding потребує доступу manage_accounts';
    }
    if (blockers.some(account => account.is_current_user)) {
        return 'Не можна вимкнути власний CRM-акаунт через offboarding';
    }
    return 'Protected CRM-акаунт не можна вимкнути через HR offboarding';
}

function actorCanReactivateStaffAccount(actor, account = {}) {
    if (!actor || !canUseAction(actor, 'manage_accounts')) return false;
    if (isProtectedSystemAccount(account)) return false;
    if (actor.role === 'creator') return true;
    return accountMaxRoleLevel(account) < accountRoleLevel('director');
}

function accountRehireBlockReason(actor, account = {}) {
    if (isProtectedSystemAccount(account)) return 'protected_system_account';
    if (!canUseAction(actor, 'manage_accounts')) return 'requires_manage_accounts';
    if (!actorCanReactivateStaffAccount(actor, account)) return 'protected_role';
    return null;
}

function staffOffboardingAccountMeta(row = {}, currentUserId = null) {
    const userId = Number(row.id);
    return {
        id: userId,
        username: row.username || '',
        name: row.name || row.full_name || '',
        role: row.role || '',
        profile_id: row.profile_id ? Number(row.profile_id) : null,
        is_current_user: Number.isFinite(currentUserId) && currentUserId > 0 && userId === currentUserId,
        is_protected: accountHasCreatorRole(row)
    };
}

function staffOffboardingResourceMeta(row = {}) {
    return {
        id: Number(row.id),
        resource_kind: row.resource_kind || 'custom',
        title: row.warehouse_stock_name || row.costume_name || row.title || 'Ресурс',
        quantity: row.quantity,
        issued_at: row.issued_at || null,
        due_return_at: row.due_return_at || null,
        source_title: row.title || null
    };
}

function staffOffboardingDocumentAlertMeta(row = {}) {
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    return {
        id: Number(row.id),
        source: row.source || 'document',
        type: row.type || 'other',
        title: row.title || 'Документ',
        status: row.status || 'active',
        expires_at: row.expires_at || null,
        tone: expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt < new Date() ? 'expired' : 'expiring'
    };
}

async function loadStaffOffboardingReadiness(staffId, db = pool, options = {}) {
    const currentUserId = Number(options.currentUserId || 0);
    const actor = options.actor || null;
    const openResources = await db.query(
        `SELECT sra.id, sra.resource_kind, sra.title, sra.quantity, sra.issued_at, sra.due_return_at,
                ws.name AS warehouse_stock_name,
                c.name AS costume_name,
                COUNT(*) OVER()::int AS total_count
         FROM staff_resource_assignments sra
         LEFT JOIN warehouse_stock ws ON ws.id = sra.warehouse_stock_id
         LEFT JOIN costumes c ON c.id = sra.costume_id
         WHERE sra.staff_id = $1 AND sra.status = 'issued'
         ORDER BY sra.due_return_at ASC NULLS LAST, sra.created_at DESC, sra.id DESC
         LIMIT 10`,
        [staffId]
    );
    const activeAccounts = await db.query(
        `SELECT u.id, u.username, u.name, u.role, u.extra_roles, ep.id AS profile_id, ep.full_name
         FROM employee_profiles ep
         JOIN users u ON u.id = ep.user_id
         WHERE ep.staff_id = $1
           AND COALESCE(ep.is_active, true) = true
           AND COALESCE(u.is_active, true) = true
         ORDER BY u.id ASC`,
        [staffId]
    );
    const documentAlerts = await db.query(
        `SELECT source, id, type, title, expires_at, status, COUNT(*) OVER()::int AS total_count
         FROM (
            SELECT 'document'::text AS source,
                   sd.id,
                   sd.document_type AS type,
                   sd.title,
                   sd.expires_at,
                   sd.status
            FROM staff_documents sd
            WHERE sd.staff_id = $1
              AND sd.status = 'active'
              AND sd.expires_at IS NOT NULL
              AND sd.expires_at <= CURRENT_DATE + INTERVAL '30 days'
            UNION ALL
            SELECT 'certification'::text AS source,
                   sc.id,
                   sc.category AS type,
                   sc.name AS title,
                   sc.expires_at,
                   sc.status
            FROM staff_certifications sc
            WHERE sc.staff_id = $1
              AND sc.status IN ('active', 'expired')
              AND sc.expires_at IS NOT NULL
              AND sc.expires_at <= CURRENT_DATE + INTERVAL '30 days'
         ) alerts
         ORDER BY expires_at ASC NULLS LAST, source ASC, id DESC
         LIMIT 10`,
        [staffId]
    );

    const accounts = activeAccounts.rows.map(row => staffOffboardingAccountMeta(row, currentUserId));
    const openResourceCount = openResources.rows[0]?.total_count || 0;
    const documentAlertCount = documentAlerts.rows[0]?.total_count || 0;
    const blockedAccounts = accounts
        .map(account => ({
            ...account,
            block_reason: accountOffboardingBlockReason(actor, account)
        }))
        .filter(account => account.block_reason);
    return {
        staff_id: Number(staffId),
        open_resource_count: openResourceCount,
        open_resources: openResources.rows.map(staffOffboardingResourceMeta),
        active_account_count: accounts.length,
        active_accounts: accounts,
        document_alert_count: documentAlertCount,
        document_alerts: documentAlerts.rows.map(staffOffboardingDocumentAlertMeta),
        disable_available: blockedAccounts.length === 0,
        disable_blockers: blockedAccounts,
        disable_requires_manage_accounts: accounts.length > 0,
        ready_for_closure: openResourceCount === 0 && documentAlertCount === 0
    };
}

function lifecycleChecklistItem(key, label, complete, options = {}) {
    const applicable = options.applicable !== false;
    const unknown = options.unknown === true;
    const severity = complete ? 'ok' : (options.severity || 'warning');
    let status = complete ? 'done' : (severity === 'critical' ? 'blocked' : 'missing');
    if (!applicable) status = 'not_applicable';
    if (unknown) status = 'unknown';
    return {
        key,
        label,
        complete: complete === true,
        applicable,
        status,
        severity,
        count: Number.isFinite(Number(options.count)) ? Number(options.count) : null,
        detail: options.detail || null,
        action: options.action || null,
        source: options.source || null
    };
}

function buildLifecycleSection(key, label, items = []) {
    const countable = items.filter(item => item.applicable !== false && item.status !== 'unknown');
    const done = countable.filter(item => item.complete).length;
    const blocked = countable.filter(item => !item.complete && item.severity === 'critical').length;
    const warning = countable.filter(item => !item.complete && item.severity === 'warning').length;
    const unknown = items.filter(item => item.status === 'unknown').length;
    const total = countable.length;
    const status = blocked ? 'critical' : (warning ? 'warning' : (total && done < total ? 'info' : 'ok'));
    return {
        key,
        label,
        status,
        total,
        done,
        missing: Math.max(0, total - done),
        blocked,
        warning,
        unknown,
        percent: total ? Math.round((done / total) * 100) : 100,
        items
    };
}

async function loadStaffLifecycleChecklist(staffId, db = pool, options = {}) {
    const id = Number(staffId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const today = cleanStaffDate(options.today) || todayKyiv();
    const staffResult = await db.query(
        `SELECT id, name, department, position, role_type,
                COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                hire_date, is_active, is_freelance, hr_pool_status, blacklist_reason,
                termination_date, termination_reason, termination_recorded_at, termination_recorded_by
         FROM staff
         WHERE id = $1`,
        [id]
    );
    const staff = staffResult.rows[0];
    if (!staff) return null;
    await attachTrainingReadiness([staff]);

    const [
        accountResult,
        faceResult,
        documentResult,
        scheduleResult,
        shiftResult,
        openTimeResult,
        payrollResult,
        offboardingEventResult,
        applicationResult,
        onboardingProgress,
        offboardingReadiness
    ] = await Promise.all([
        db.query(
            `SELECT
                    COUNT(*) FILTER (
                        WHERE ep.user_id IS NOT NULL
                          AND COALESCE(ep.is_active, true) = true
                          AND COALESCE(u.is_active, true) = true
                    )::int AS active_account_count,
                    COUNT(*) FILTER (WHERE ep.user_id IS NOT NULL)::int AS linked_account_count,
                    COUNT(*) FILTER (
                        WHERE ep.user_id IS NOT NULL
                          AND (COALESCE(ep.is_active, true) = false OR COALESCE(u.is_active, true) = false)
                    )::int AS disabled_account_count
             FROM employee_profiles ep
             LEFT JOIN users u ON u.id = ep.user_id
             WHERE ep.staff_id = $1`,
            [id]
        ),
        db.query(
            `SELECT COUNT(*)::int AS face_descriptor_count
             FROM staff_face_descriptors
             WHERE staff_id = $1`,
            [id]
        ),
        db.query(
            `SELECT COUNT(*)::int AS document_count,
                    COUNT(*) FILTER (WHERE status = 'active')::int AS active_document_count,
                    COUNT(*) FILTER (WHERE status = 'archived')::int AS archived_document_count
             FROM staff_documents
             WHERE staff_id = $1`,
            [id]
        ),
        db.query(
            `SELECT COUNT(*) FILTER (
                        WHERE LEFT(date::text, 10) >= $2
                          AND COALESCE(status, 'working') NOT IN ('dayoff','day_off','vacation','sick','absent')
                    )::int AS future_staff_schedule_count,
                    MIN(LEFT(date::text, 10)) FILTER (
                        WHERE COALESCE(status, 'working') NOT IN ('dayoff','day_off','vacation','sick','absent')
                    ) AS first_staff_schedule_date
             FROM staff_schedule
             WHERE staff_id = $1`,
            [id, today]
        ),
        db.query(
            `SELECT COUNT(*) FILTER (WHERE shift_date >= $2::date)::int AS future_hr_shift_count,
                    MIN(shift_date)::date AS first_hr_shift_date
             FROM hr_shifts
             WHERE staff_id = $1`,
            [id, today]
        ),
        db.query(
            `SELECT COUNT(*)::int AS open_time_record_count
             FROM hr_time_records
             WHERE staff_id = $1
               AND clock_in IS NOT NULL
               AND clock_out IS NULL
               AND COALESCE(status, 'present') IN ('present','late','clocked_in','unscheduled')`,
            [id]
        ),
        db.query(
            `SELECT COUNT(*) FILTER (
                        WHERE COALESCE(status, 'draft') IN ('draft','reviewed')
                          AND voided_at IS NULL
                    )::int AS open_payroll_count,
                    COUNT(*) FILTER (
                        WHERE COALESCE(status, '') IN ('approved','paid')
                          AND voided_at IS NULL
                    )::int AS closed_payroll_count
             FROM payroll_reports
             WHERE staff_id = $1`,
            [id]
        ),
        db.query(
            `SELECT id, status, effective_date, reason, target_pool_status, account_action, notes, completed_at, created_at
             FROM staff_offboarding_events
             WHERE staff_id = $1
             ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            [id]
        ),
        db.query(
            `SELECT a.id, a.vacancy_id, a.status, a.profession_key, a.hired_at, a.hired_by,
                    v.title AS vacancy_title
             FROM job_applications a
             JOIN job_vacancies v ON v.id = a.vacancy_id
             WHERE a.staff_id = $1
             ORDER BY a.hired_at DESC NULLS LAST, a.updated_at DESC, a.id DESC
             LIMIT 1`,
            [id]
        ).catch(err => {
            log.warn(`Lifecycle application link skipped for staff ${id}: ${err.message}`);
            return { rows: [] };
        }),
        loadActiveOnboardingProgress(id, db).catch(err => {
            log.warn(`Lifecycle onboarding progress skipped for staff ${id}: ${err.message}`);
            return null;
        }),
        loadStaffOffboardingReadiness(id, db, options).catch(err => {
            log.warn(`Lifecycle offboarding readiness skipped for staff ${id}: ${err.message}`);
            return null;
        })
    ]);

    const account = accountResult.rows[0] || {};
    const face = faceResult.rows[0] || {};
    const documents = documentResult.rows[0] || {};
    const schedule = scheduleResult.rows[0] || {};
    const shifts = shiftResult.rows[0] || {};
    const openTime = openTimeResult.rows[0] || {};
    const payroll = payrollResult.rows[0] || {};
    const latestOffboarding = offboardingEventResult.rows[0] || null;
    const hiringApplication = applicationResult.rows[0] || null;
    const onboarding = onboardingProgress ? onboardingProgressMeta(onboardingProgress) : null;
    const professionKeys = staffProfessionKeys(staff);
    const readiness = staff.training_readiness || { percent: 0, total: 0, completed: 0 };
    const readinessTotal = Number(readiness.total || 0);
    const readinessPercent = Number(readiness.percent || 0);
    const activeAccountCount = Number(account.active_account_count || 0);
    const linkedAccountCount = Number(account.linked_account_count || 0);
    const faceDescriptorCount = Number(face.face_descriptor_count || 0);
    const documentCount = Number(documents.document_count || 0);
    const activeDocumentCount = Number(documents.active_document_count || 0);
    const archivedDocumentCount = Number(documents.archived_document_count || 0);
    const futureScheduleCount = Number(schedule.future_staff_schedule_count || 0) + Number(shifts.future_hr_shift_count || 0);
    const openTimeRecordCount = Number(openTime.open_time_record_count || 0);
    const openPayrollCount = Number(payroll.open_payroll_count || 0);
    const firstShiftDate = toDateOnly(shifts.first_hr_shift_date) || schedule.first_staff_schedule_date || null;
    const isOffboardingFlow = staff.is_active === false || Boolean(staff.termination_date) || Boolean(latestOffboarding);
    const poolStatus = staff.hr_pool_status || 'core';
    const isActiveCoreStaff = staff.is_active !== false && poolStatus === 'core';

    const onboardingItems = [
        lifecycleChecklistItem('candidate_approved', 'Кандидат погоджений', Boolean(hiringApplication), {
            unknown: !hiringApplication,
            severity: 'info',
            detail: hiringApplication
                ? `${hiringApplication.vacancy_title} · ${hiringApplication.profession_key || staff.role_type}`
                : 'Немає пов’язаної заявки з вакансії. Для працівника, створеного вручну, це допустимо.',
            source: hiringApplication ? `job_applications#${hiringApplication.id}` : 'job_applications.staff_id'
        }),
        lifecycleChecklistItem('hr_card_created', 'HR-картка створена', true, {
            action: 'profile',
            source: 'staff'
        }),
        lifecycleChecklistItem('department_set', 'Відділ заданий', Boolean(staff.department), {
            severity: 'critical',
            action: 'profile',
            detail: staff.department || 'Потрібно заповнити staff.department.',
            source: 'staff.department'
        }),
        lifecycleChecklistItem('role_type_set', 'Основна роль задана', Boolean(staff.role_type), {
            severity: 'critical',
            action: 'profile',
            detail: staff.role_type || 'Потрібно заповнити staff.role_type.',
            source: 'staff.role_type'
        }),
        lifecycleChecklistItem('professions_set', 'Професії задані', professionKeys.length > 0, {
            severity: 'critical',
            action: 'profile',
            count: professionKeys.length,
            detail: professionKeys.length ? professionKeys.join(', ') : 'Немає основної або додаткових професій.',
            source: 'staff.role_type + staff.secondary_professions'
        }),
        lifecycleChecklistItem('account_linked', 'CRM-акаунт привʼязаний', activeAccountCount > 0, {
            severity: 'critical',
            action: 'account',
            count: activeAccountCount || linkedAccountCount,
            detail: activeAccountCount ? `Активних акаунтів: ${activeAccountCount}.` : 'Немає активного linked account.',
            source: 'employee_profiles + users'
        }),
        lifecycleChecklistItem('face_descriptor_added', 'Face descriptor доданий', faceDescriptorCount > 0, {
            severity: 'warning',
            action: 'face',
            count: faceDescriptorCount,
            detail: faceDescriptorCount ? 'Face descriptor знайдено.' : 'Камера/face check-in не зможе підтвердити працівника.',
            source: 'staff_face_descriptors'
        }),
        lifecycleChecklistItem('documents_checked', 'Документи перевірені', activeDocumentCount > 0, {
            severity: 'warning',
            action: 'documents',
            count: activeDocumentCount,
            detail: activeDocumentCount ? `Активних HR-документів: ${activeDocumentCount}.` : 'У картці немає активних HR-документів.',
            source: 'staff_documents'
        }),
        lifecycleChecklistItem('readiness_approved', 'Readiness підтверджено', readinessTotal > 0 && readinessPercent >= 85, {
            severity: 'critical',
            action: 'training',
            count: readinessTotal,
            detail: readinessTotal ? `${readiness.completed || 0}/${readinessTotal}, ${readinessPercent}%.` : 'Немає checklist/training прогресу.',
            source: 'hr_staff_profession_checklist_progress + training_course_enrollment'
        }),
        lifecycleChecklistItem('first_shift_scheduled', 'Перша зміна запланована', Boolean(firstShiftDate), {
            severity: 'warning',
            action: 'schedule',
            detail: firstShiftDate || 'У staff_schedule/hr_shifts немає першої зміни.',
            source: 'staff_schedule + hr_shifts'
        }),
        lifecycleChecklistItem('manager_assigned', 'Відповідальний менеджер призначений', Boolean(onboarding?.responsible_user_id), {
            severity: 'warning',
            action: 'onboarding',
            detail: onboarding?.responsible_name || 'Немає active onboarding responsible.',
            source: 'onboarding_progress.responsible_user_id'
        })
    ];

    const offboardingItems = [
        lifecycleChecklistItem('removed_from_future_schedule', 'Прибрано з майбутнього графіка', futureScheduleCount === 0, {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'schedule',
            count: futureScheduleCount,
            detail: futureScheduleCount ? `Майбутніх планових записів: ${futureScheduleCount}.` : 'Майбутніх планових записів немає.',
            source: 'staff_schedule + hr_shifts'
        }),
        lifecycleChecklistItem('active_shifts_closed', 'Активні зміни закриті', openTimeRecordCount === 0, {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'attendance',
            count: openTimeRecordCount,
            detail: openTimeRecordCount ? `Відкритих time records: ${openTimeRecordCount}.` : 'Відкритих time records немає.',
            source: 'hr_time_records'
        }),
        lifecycleChecklistItem('payroll_closed', 'Payroll закритий', openPayrollCount === 0, {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'payroll',
            count: openPayrollCount,
            detail: openPayrollCount ? `Незакритих payroll reports: ${openPayrollCount}.` : 'Незакритих payroll reports немає.',
            source: 'payroll_reports'
        }),
        lifecycleChecklistItem('account_disabled_or_unlinked', 'Акаунт вимкнений або відвʼязаний', activeAccountCount === 0, {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'account',
            count: activeAccountCount,
            detail: activeAccountCount ? `Активних акаунтів ще є: ${activeAccountCount}.` : 'Активних акаунтів немає.',
            source: 'employee_profiles + users'
        }),
        lifecycleChecklistItem('access_removed', 'Доступи прибрані', activeAccountCount === 0, {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'account',
            count: activeAccountCount,
            detail: activeAccountCount ? 'Linked CRM account ще активний.' : 'Активний CRM-доступ не знайдено.',
            source: 'users.is_active'
        }),
        lifecycleChecklistItem('hr_status_changed', 'HR-статус змінений', staff.is_active === false && ['reserve', 'blacklisted'].includes(poolStatus), {
            applicable: isOffboardingFlow,
            severity: 'critical',
            action: 'profile',
            detail: `is_active=${staff.is_active !== false}, hr_pool_status=${poolStatus}.`,
            source: 'staff.is_active + staff.hr_pool_status'
        }),
        lifecycleChecklistItem('final_note_added', 'Фінальна нотатка додана', Boolean(staff.termination_reason || latestOffboarding?.reason || latestOffboarding?.notes), {
            applicable: isOffboardingFlow,
            severity: 'warning',
            action: 'offboarding',
            detail: staff.termination_reason || latestOffboarding?.reason || latestOffboarding?.notes || 'Немає причини або фінальної нотатки.',
            source: 'staff.termination_reason + staff_offboarding_events'
        }),
        lifecycleChecklistItem('documents_archived_if_applicable', 'Документи архівовані за потреби', documentCount === 0 || activeDocumentCount === 0, {
            applicable: isOffboardingFlow && documentCount > 0,
            severity: 'warning',
            action: 'documents',
            count: activeDocumentCount,
            detail: documentCount
                ? `Активних: ${activeDocumentCount}, архівних: ${archivedDocumentCount}.`
                : 'Документів у картці немає.',
            source: 'staff_documents'
        })
    ];

    const onboardingSection = buildLifecycleSection('onboarding', 'Onboarding readiness', onboardingItems);
    const offboardingSection = buildLifecycleSection('offboarding', 'Offboarding closure', offboardingItems);
    const sections = [onboardingSection, offboardingSection];
    const allItems = sections.flatMap(section => section.items);
    const blockers = allItems.filter(item => item.applicable !== false && !item.complete && item.severity === 'critical');
    const warnings = allItems.filter(item => item.applicable !== false && !item.complete && item.severity === 'warning');

    return {
        source: 'hr_staff_lifecycle_checklist_v1',
        generated_at: new Date().toISOString(),
        today,
        staff: {
            id: Number(staff.id),
            name: staff.name,
            department: staff.department,
            position: staff.position,
            role_type: staff.role_type,
            professions: professionKeys,
            is_active: staff.is_active !== false,
            hr_pool_status: poolStatus,
            termination_date: staff.termination_date || null
        },
        metrics: {
            active_account_count: activeAccountCount,
            linked_account_count: linkedAccountCount,
            disabled_account_count: Number(account.disabled_account_count || 0),
            face_descriptor_count: faceDescriptorCount,
            active_document_count: activeDocumentCount,
            future_schedule_count: futureScheduleCount,
            open_time_record_count: openTimeRecordCount,
            open_payroll_count: openPayrollCount,
            readiness_percent: readinessPercent,
            readiness_total: readinessTotal,
            onboarding_percent: onboarding?.percent ?? null,
            open_resource_count: Number(offboardingReadiness?.open_resource_count || 0),
            document_alert_count: Number(offboardingReadiness?.document_alert_count || 0)
        },
        summary: {
            status: blockers.length ? 'critical' : (warnings.length ? 'warning' : 'ok'),
            blocker_count: blockers.length,
            warning_count: warnings.length,
            unknown_count: allItems.filter(item => item.status === 'unknown').length,
            ready_for_schedule: isActiveCoreStaff && blockers.every(item => !['department_set', 'role_type_set', 'professions_set', 'account_linked', 'readiness_approved'].includes(item.key)),
            ready_for_payroll: staff.is_active !== false || openPayrollCount > 0,
            ready_for_offboarding: isOffboardingFlow && offboardingSection.blocked === 0,
            offboarding_started: isOffboardingFlow
        },
        sections,
        latest_offboarding_event: latestOffboarding,
        hiring_application: hiringApplication,
        onboarding_assignment: onboarding,
        findings: []
    };
}

const STAFF_DELETE_CONFIRMATION = 'ТАК';

const STAFF_DELETE_BLOCKER_CHECKS = [
    { key: 'accounts', label: 'CRM-профілі або акаунти', table: 'employee_profiles', where: 'staff_id = $1' },
    { key: 'bookings', label: 'бронювання на таймлайні', table: 'bookings', where: '(line_id = $1::text OR second_animator = $1::text)' },
    { key: 'legacy_schedule', label: 'legacy-графік staff_schedule', table: 'staff_schedule', where: 'staff_id = $1' },
    { key: 'hr_shifts', label: 'HR-зміни', table: 'hr_shifts', where: 'staff_id = $1' },
    { key: 'time_records', label: 'облік приходу/виходу', table: 'hr_time_records', where: 'staff_id = $1' },
    { key: 'camera_checkins', label: 'camera/manual check-in записи', table: 'staff_checkins', where: 'staff_id = $1' },
    { key: 'leave_requests', label: 'відпустки/лікарняні', table: 'leave_requests', where: 'staff_id = $1' },
    { key: 'payroll_reports', label: 'payroll reports', table: 'payroll_reports', where: 'staff_id = $1' },
    { key: 'salary_adjustments', label: 'ЗРС/штрафи/коригування зарплати', table: 'salary_adjustments', where: 'staff_id = $1' },
    { key: 'documents', label: 'HR-документи', table: 'staff_documents', where: 'staff_id = $1' },
    { key: 'certifications', label: 'сертифікації', table: 'staff_certifications', where: 'staff_id = $1' },
    { key: 'resources', label: 'видані ресурси або костюми', table: 'staff_resource_assignments', where: 'staff_id = $1' },
    { key: 'offboarding', label: 'історія offboarding', table: 'staff_offboarding_events', where: 'staff_id = $1' },
    { key: 'training', label: 'проходження навчання', table: 'training_course_enrollment', where: 'staff_id = $1' },
    { key: 'profession_progress', label: 'чеклісти професій', table: 'hr_staff_profession_checklist_progress', where: 'staff_id = $1' },
    { key: 'reports_submitted', label: 'фінансові звіти submitter', table: 'reports', where: 'submitted_by_id = $1' },
    { key: 'accountants', label: 'звʼязка бухгалтера', table: 'accountants', where: 'staff_id = $1' }
];

const STAFF_DELETE_CLEANUP_CHECKS = [
    { key: 'face_descriptors', label: 'біометричні descriptors для камери', table: 'staff_face_descriptors', where: 'staff_id = $1' },
    { key: 'role_assignments', label: 'рольові призначення HR', table: 'staff_role_assignments', where: 'staff_id = $1' },
    { key: 'profession_rates', label: 'ставки по професіях', table: 'staff_profession_rates', where: 'staff_id = $1' },
    { key: 'audit_entries', label: 'рядки HR audit log будуть відвʼязані від staff id', table: 'hr_audit_log', where: 'staff_id = $1' }
];

async function countStaffRowsIfTableExists(db, check, staffId) {
    const exists = await db.query('SELECT to_regclass($1) AS rel', [`public.${check.table}`]);
    if (!exists.rows[0]?.rel) return { ...check, count: 0, missing_table: true };
    const result = await db.query(`SELECT COUNT(*)::int AS count FROM ${check.table} WHERE ${check.where}`, [staffId]);
    return { ...check, count: Number(result.rows[0]?.count || 0), missing_table: false };
}

async function loadStaffDeleteReadiness(staffId, db = pool, options = {}) {
    const staffResult = await db.query(
        `SELECT id, name, department, position, role_type, is_active, hr_pool_status, created_at
         FROM staff
         WHERE id = $1
         ${options.lock ? 'FOR UPDATE' : ''}`,
        [staffId]
    );
    if (!staffResult.rows.length) return null;
    const [blockers, cleanup] = await Promise.all([
        Promise.all(STAFF_DELETE_BLOCKER_CHECKS.map(check => countStaffRowsIfTableExists(db, check, staffId))),
        Promise.all(STAFF_DELETE_CLEANUP_CHECKS.map(check => countStaffRowsIfTableExists(db, check, staffId)))
    ]);
    const activeBlockers = blockers.filter(item => item.count > 0);
    return {
        staff: staffResult.rows[0],
        can_delete: activeBlockers.length === 0,
        required_confirmation: STAFF_DELETE_CONFIRMATION,
        blockers: activeBlockers.map(({ key, label, count }) => ({ key, label, count })),
        cleanup: cleanup.filter(item => item.count > 0).map(({ key, label, count }) => ({ key, label, count }))
    };
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
            meta: sanitizeCompanyStructureString(source.meta, 80) || null,
            displayGroup: staffStructureDisplayGroupKey({ ...source, id }) || null,
            collapsed: source.collapsed === true,
            archived: source.archived === true
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
    return normalizeStaffCompanyStructurePayload(value);
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

function activeNonBlacklistedStaffWhere(alias = 's') {
    return activeStaffWhere(alias, {
        poolMode: 'not_blacklisted',
        includeFreelance: true
    });
}

function operationalStaffWhere(alias = 's') {
    return scheduleableStaffWhere(alias);
}

function operationalStaffForDateWhere(alias = 's', dateExpression = 'CURRENT_DATE') {
    return scheduleableStaffWhere(alias, { dateExpression });
}

async function rejectUnscheduleableStaff(res, client, validation, extra = {}) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(validation.status || 400).json(scheduleableStaffErrorPayload(validation, extra));
}

async function validateShiftWriteStaff(client, staffId, date, options = {}) {
    return validateStaffScheduleableForDate(client, staffId, date, {
        ...options,
        forUpdate: options.forUpdate !== false
    });
}

// Helper: get current Kyiv time as Date object
function nowKyiv() {
    return getKyivDate();
}

// Helper: audit log entry
async function insertAuditLog(action, staffId, performedBy, details, ipAddress, db = pool) {
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [action, staffId, performedBy, details ? JSON.stringify(details) : null, ipAddress]
    );
}

async function auditLog(action, staffId, performedBy, details, ipAddress, db = null) {
    try {
        await insertAuditLog(action, staffId, performedBy, details, ipAddress, db || pool);
    } catch (err) {
        log.error('Audit log error', err);
        if (db) {
            const auditError = new Error('Не вдалося зафіксувати audit. Операцію скасовано.');
            auditError.code = 'HR_AUDIT_WRITE_FAILED';
            auditError.statusCode = 500;
            auditError.cause = err;
            throw auditError;
        }
    }
}

function sendHrMutationFailure(res, error) {
    if (error?.code !== 'HR_AUDIT_WRITE_FAILED') return false;
    res.status(500).json({
        success: false,
        code: error.code,
        error: error.message
    });
    return true;
}

function payrollProfileActor(req) {
    return {
        username: req.user?.username || null,
        ipAddress: req.ip || null
    };
}

function payrollProfileQueryWithIds(query = {}) {
    const staffIds = query.staffIds ?? query.staff_ids;
    if (!staffIds || Array.isArray(staffIds)) return query;
    return {
        ...query,
        staffIds: String(staffIds).split(',').map(item => item.trim()).filter(Boolean)
    };
}

function sendPayrollProfileFailure(res, error, logContext) {
    const status = Number(error?.statusCode || error?.status || 500);
    if (status >= 500) log.error(logContext, error);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        code: error?.code || 'PAYROLL_PROFILE_REQUEST_FAILED',
        error: status < 500 ? error.message : 'Помилка роботи із зарплатним профілем',
        ...(error?.details ? { details: error.details } : {})
    });
}

function sendProfessionChecklistFailure(res, error, logContext) {
    if (sendHrMutationFailure(res, error)) return true;
    if (isProfessionChecklistError(error)) {
        const status = Number(error?.statusCode || error?.status || 400);
        const responseStatus = status >= 400 && status < 600 ? status : 400;
        if (responseStatus >= 500) log.error(logContext, error);
        res.status(responseStatus).json({
            success: false,
            code: error.code || 'PROFESSION_CHECKLIST_ERROR',
            error: responseStatus < 500 ? error.message : 'Помилка роботи з чеклістом професії',
            ...(error.details !== undefined ? { details: error.details } : {})
        });
        return true;
    }
    log.error(logContext, error);
    res.status(500).json({
        success: false,
        code: 'PROFESSION_CHECKLIST_REQUEST_FAILED',
        error: 'Помилка роботи з чеклістом професії'
    });
    return true;
}

function professionChecklistProgressAuditSnapshot(progress) {
    if (!progress) return null;
    return {
        id: progress.id || null,
        checklist_item_id: progress.checklistItemId || progress.checklist_item_id || null,
        checklist_key: progress.checklistKey || progress.checklist_key || null,
        completed: progress.completed === true,
        completed_at: progress.completedAt || progress.completed_at || null,
        completed_by: progress.completedBy || progress.completed_by || null,
        has_notes: Boolean(progress.notes),
        updated_at: progress.updatedAt || progress.updated_at || null
    };
}

function liveQaConfirmationFromRequest(req) {
    return req.get('x-eventgenix-live-qa-confirmation') || req.body?.confirmation || '';
}

function sendLiveQaError(res, error) {
    const status = Number(error?.status || error?.statusCode || 500);
    if (status >= 500) log.error('Live multi-segment QA helper error', error);
    return res.status(status).json({
        success: false,
        code: error?.code || 'LIVE_QA_HELPER_FAILED',
        error: error?.message || 'Live QA helper failed',
        ...(error?.details ? { data: error.details } : {})
    });
}

async function loadLiveQaStaff(db, staffId, runId, options = {}) {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0) {
        const error = new Error('valid disposable QA staffId is required');
        error.code = 'LIVE_QA_STAFF_ID_INVALID';
        error.status = 400;
        throw error;
    }
    const lock = options.forUpdate === true ? ' FOR UPDATE' : '';
    const result = await db.query(
        `SELECT id, name, is_active, hr_pool_status, notes
         FROM staff
         WHERE id = $1${lock}`,
        [id]
    );
    return assertLiveQaStaff(result.rows[0], runId);
}

async function loadLiveQaFixtureStatus(db, staffId, runId) {
    const staff = await loadLiveQaStaff(db, staffId, runId);
    // This helper can receive a transaction-scoped pg Client during cleanup.
    // Keep its reads sequential because pg does not support concurrent queries on one Client.
    const shiftResult = await db.query(
        'SELECT id, shift_date::text AS date FROM hr_shifts WHERE staff_id = $1 ORDER BY shift_date, id',
        [staff.id]
    );
    const scheduleResult = await db.query(
        'SELECT id, date::text AS date FROM staff_schedule WHERE staff_id = $1 ORDER BY date, id',
        [staff.id]
    );
    const attendanceResult = await db.query(
        'SELECT id, record_date::text AS date FROM hr_time_records WHERE staff_id = $1 ORDER BY record_date, id',
        [staff.id]
    );
    const checkinResult = await db.query(
        'SELECT id, date::text AS date FROM staff_checkins WHERE staff_id = $1 ORDER BY date, id',
        [staff.id]
    );
    const shiftPreferenceResult = await db.query(
        `SELECT id, profession_key, day_type
         FROM staff_shift_preferences
         WHERE staff_id = $1
         ORDER BY profession_key, day_type, id`,
        [staff.id]
    );
    const lineResult = await db.query(
        `SELECT id, date::text AS date
         FROM lines_by_date
         WHERE line_id = $1::text
           AND from_sheet IS TRUE
         ORDER BY date, id`,
        [staff.id]
    );
    const rows = {
        shifts: shiftResult.rows,
        schedule: scheduleResult.rows,
        attendance: attendanceResult.rows,
        checkins: checkinResult.rows,
        shiftPreferences: shiftPreferenceResult.rows,
        timelineLines: lineResult.rows
    };
    const counts = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length]));
    return {
        runId: normalizeLiveQaRunId(runId),
        staffId: Number(staff.id),
        active: staff.is_active !== false,
        archived: staff.is_active === false,
        counts,
        fixtureIds: Object.fromEntries(Object.entries(rows).map(([key, value]) => [
            key,
            value.map(row => Number(row.id)).filter(Number.isInteger)
        ])),
        confirmedClean: staff.is_active === false && Object.values(counts).every(count => count === 0)
    };
}

async function activeProfessionKeySet(db = pool) {
    const result = await db.query('SELECT key, title, department, short_info, responsibilities, checklist, color, structure_node_id, sort_order, is_active FROM hr_professions');
    return professionCatalogActiveKeySet(result.rows);
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

async function attachTrainingReadiness(staffRows = []) {
    if (!Array.isArray(staffRows) || !staffRows.length) return staffRows;
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isFinite);
    if (!staffIds.length) {
        staffRows.forEach(row => { row.training_readiness = { percent: 0, completed: 0, total: 0, professions: [] }; });
        return staffRows;
    }
    const assignmentResult = await pool.query(
        `SELECT staff_id, profession_key
         FROM staff_role_assignments
         WHERE staff_id = ANY($1::int[])
         ORDER BY staff_id, is_primary DESC, profession_key`,
        [staffIds]
    );
    const professionKeysByStaffId = new Map(staffRows.map(row => [Number(row.id), new Set(staffProfessionKeys(row))]));
    assignmentResult.rows.forEach(assignment => {
        const key = normalizeProfessionKey(assignment.profession_key);
        if (key && professionKeysByStaffId.has(Number(assignment.staff_id))) {
            professionKeysByStaffId.get(Number(assignment.staff_id)).add(key);
        }
    });
    const professionKeys = [...new Set([...professionKeysByStaffId.values()].flatMap(keys => [...keys]))];
    if (!professionKeys.length) {
        staffRows.forEach(row => { row.training_readiness = { percent: 0, completed: 0, total: 0, professions: [] }; });
        return staffRows;
    }

    const progressAssignments = staffRows.flatMap(row => [...(professionKeysByStaffId.get(Number(row.id)) || [])].map(professionKey => ({
        staffId: Number(row.id),
        professionKey
    })));
    const [professionRows, courseRows, enrollmentRows, checklistProgress] = await Promise.all([
        pool.query(
            `SELECT key, title
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
        loadProfessionChecklistProgressBatch(pool, progressAssignments, {
            includeArchived: false,
            includeOrphaned: true
        })
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
    staffRows.forEach(row => {
        const entries = [...(professionKeysByStaffId.get(Number(row.id)) || [])].map(professionKey => {
            const profession = professionsByKey.get(professionKey) || { key: professionKey, title: professionKey };
            const progressGroup = checklistProgress.byAssignment[`${Number(row.id)}:${professionKey}`];
            const checklistItems = (progressGroup?.items || []).map(item => ({
                id: item.id,
                key: item.itemKey,
                item_key: item.itemKey,
                checklist_key: item.itemKey,
                title: item.title,
                done: Boolean(item.progress?.completed),
                completed_at: item.progress?.completedAt || null,
                completed_by: item.progress?.completedBy || null,
                notes: item.progress?.notes || null
            }));
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
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
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
    const override = staffRateUnit(staff) === 'hour' ? rateMap.get(`${staffId}:${normalized}`) : null;
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

function payrollTotals(rows = []) {
    return rows.reduce((acc, row) => ({
        total_base: acc.total_base + Number(row.base_salary || 0),
        total_additional: acc.total_additional + Number(row.additional_pay || 0),
        total_overtime: acc.total_overtime + Number(row.overtime_pay || 0),
        total_bonuses: acc.total_bonuses + Number(row.bonuses || 0) + Number(row.tips || 0),
        total_deductions: acc.total_deductions + Number(row.deductions || 0) + Number(row.penalties || 0),
        total_advances: acc.total_advances + Number(row.advances || 0),
        total_salary: acc.total_salary + Number(row.total_salary || 0)
    }), {
        total_base: 0,
        total_additional: 0,
        total_overtime: 0,
        total_bonuses: 0,
        total_deductions: 0,
        total_advances: 0,
        total_salary: 0
    });
}

function payrollActor(user = {}) {
    return user.username || user.name || user.email || 'crm';
}

function parsePayrollSnapshot(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
}

function roundPayrollAmount(value, fallback = 0) {
    const num = Number(value);
    return Math.round(Number.isFinite(num) ? num : fallback);
}

function applyHrPayrollSnapshot(row, reportRow = {}) {
    if (!['reviewed', 'approved', 'paid'].includes(reportRow.payroll_status)) return row;
    const breakdown = parsePayrollSnapshot(reportRow.breakdown_json);
    const summary = breakdown.summary || {};
    const hasDetailedAdjustments = ['bonuses', 'tips', 'deductions', 'penalties', 'advances']
        .some(key => Object.prototype.hasOwnProperty.call(breakdown, key));
    const baseSalary = roundPayrollAmount(breakdown.base_salary ?? summary.base, row.base_salary);
    const additionalPay = roundPayrollAmount(
        breakdown.additional_pay ?? summary.additional,
        row.additional_pay
    );
    const overtimePay = roundPayrollAmount(breakdown.overtime_pay ?? summary.overtime, row.overtime_pay);
    const bonuses = hasDetailedAdjustments
        ? roundPayrollAmount(breakdown.bonuses, row.bonuses)
        : roundPayrollAmount(
            Number(summary.bonuses || 0) + Number(summary.percent || 0) + Number(summary.manual || 0),
            row.bonuses
        );
    const tips = hasDetailedAdjustments ? roundPayrollAmount(breakdown.tips, row.tips) : 0;
    const deductions = hasDetailedAdjustments
        ? roundPayrollAmount(breakdown.deductions, row.deductions)
        : roundPayrollAmount(summary.deductions ?? reportRow.deductions_amount, row.deductions);
    const penalties = hasDetailedAdjustments ? roundPayrollAmount(breakdown.penalties, row.penalties) : 0;
    const advances = roundPayrollAmount(breakdown.advances ?? summary.advances ?? reportRow.advances_amount, row.advances);
    const totalSalary = roundPayrollAmount(
        summary.net ?? reportRow.net_amount,
        baseSalary + additionalPay + overtimePay + bonuses + tips - deductions - penalties - advances
    );
    const transparency = breakdown.transparency || buildPayrollTransparencyMetrics({
        physicalMinutes: breakdown.metrics?.physicalMinutes ?? row.physical_minutes,
        baseProfessionAllocations: breakdown.metrics?.baseProfessionAllocations ?? row.base_profession_allocations,
        additionalProfessionAllocations: breakdown.metrics?.additionalProfessionAllocations ?? row.additional_profession_allocations
    }, {
        additionalAmount: additionalPay,
        lines: breakdown.lines || row.payroll_lines
    });
    return {
        ...row,
        base_salary: baseSalary,
        additional_pay: additionalPay,
        overtime_pay: overtimePay,
        bonuses,
        tips,
        deductions,
        penalties,
        advances,
        total_salary: totalSalary,
        profession_rate_summary: Array.isArray(breakdown.professionRateSummary)
            ? breakdown.professionRateSummary
            : (Array.isArray(breakdown.profession_rates) ? breakdown.profession_rates : row.profession_rate_summary),
        allocation_issues: Array.isArray(breakdown.allocationIssues)
            ? breakdown.allocationIssues
            : row.allocation_issues,
        payroll_blocking_issues: Array.isArray(breakdown.payrollBlockingIssues)
            ? breakdown.payrollBlockingIssues
            : row.payroll_blocking_issues,
        payroll_lines: Array.isArray(breakdown.lines) ? breakdown.lines : row.payroll_lines,
        physical_minutes: Number(breakdown.metrics?.physicalMinutes ?? row.physical_minutes ?? 0),
        base_profession_allocations: Array.isArray(breakdown.metrics?.baseProfessionAllocations)
            ? breakdown.metrics.baseProfessionAllocations
            : row.base_profession_allocations,
        additional_profession_allocations: Array.isArray(breakdown.metrics?.additionalProfessionAllocations)
            ? breakdown.metrics.additionalProfessionAllocations
            : row.additional_profession_allocations,
        compensation_minutes: Number(breakdown.metrics?.compensationMinutes ?? row.compensation_minutes ?? 0),
        role_minutes: Number(breakdown.metrics?.roleMinutes ?? row.role_minutes ?? 0),
        payroll_transparency: transparency,
        physical_hours: Number(transparency.physicalHours || 0),
        base_role_hours: Number(transparency.baseRoleHours || 0),
        additional_role_hours: Number(transparency.additionalRoleHours || 0),
        additional_profession: transparency.additionalProfession || null,
        additional_rate: transparency.additionalRate ?? null,
        additional_multiplier: transparency.additionalMultiplier ?? null,
        additional_roles: transparency.additionalRoles || [],
        reconciliation: breakdown.reconciliation || row.reconciliation,
        snapshot_locked: true
    };
}

// Payroll period range, lock, event, and reconciliation helpers live in services/hrPayrollPeriod.js.

async function loadPayrollCalculation(monthValue, db = pool, periodOptions = {}) {
    const month = normalizePayrollMonth(monthValue);
    const period = payrollPeriodRange(month, periodOptions.from, periodOptions.to);
    const result = await db.query(`
        WITH params AS (
            SELECT $1::varchar(7) AS month,
                   $2::date AS date_from,
                   $3::date AS date_to,
                   $4::varchar(7) AS month_from,
                   $5::varchar(7) AS month_to
        ),
        active_staff AS (
            SELECT DISTINCT s.id, s.name, s.role_type, s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit, s.department
            FROM staff s
            CROSS JOIN params p
            WHERE (s.is_freelance = false OR s.is_freelance IS NULL)
              AND (
                  s.is_active = true
                  OR EXISTS (
                      SELECT 1
                      FROM hr_time_records tr
                      WHERE tr.staff_id = s.id
                        AND tr.record_date >= p.date_from AND tr.record_date <= p.date_to
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM hr_shifts hs
                      WHERE hs.staff_id = s.id
                        AND hs.shift_date >= p.date_from AND hs.shift_date <= p.date_to
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM salary_adjustments sa
                      WHERE sa.staff_id = s.id
                        AND sa.month >= p.month_from AND sa.month <= p.month_to
                        AND COALESCE(sa.status, 'applied') = 'applied'
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM payroll_reports pr
                      WHERE pr.staff_id = s.id
                        AND pr.period_month >= p.month_from AND pr.period_month <= p.month_to
                        AND pr.voided_at IS NULL
                  )
              )
        ),
        time_segments AS (
            SELECT s.id AS staff_id,
                   COALESCE(hs.profession_key, s.role_type) AS profession_key,
                   COALESCE(NULLIF(spr.hourly_rate, 0), s.hourly_rate, 0)::numeric AS rate,
                   COALESCE(s.rate_unit, 'hour') AS rate_unit,
                   COALESCE(SUM(tr.total_worked_minutes), 0)::numeric AS total_minutes,
                   SUM(tr.overtime_minutes) AS overtime_minutes,
                   COUNT(*) FILTER (WHERE tr.clock_in IS NOT NULL)::int AS days_worked
            FROM active_staff s
            CROSS JOIN params p
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id
                AND tr.record_date >= p.date_from AND tr.record_date <= p.date_to
            LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = tr.record_date
            LEFT JOIN staff_profession_rates spr ON spr.staff_id = s.id
                AND spr.profession_key = COALESCE(hs.profession_key, s.role_type)
            GROUP BY s.id, COALESCE(hs.profession_key, s.role_type),
                     COALESCE(NULLIF(spr.hourly_rate, 0), s.hourly_rate, 0),
                     COALESCE(s.rate_unit, 'hour')
        ),
        time_totals AS (
            SELECT staff_id,
                   SUM(total_minutes)::numeric AS total_minutes,
                   SUM(overtime_minutes)::numeric AS overtime_minutes,
                   SUM(days_worked)::int AS days_worked,
                   (
                       MAX(CASE WHEN rate_unit = 'month' THEN rate ELSE 0 END)
                       + SUM(CASE
                           WHEN rate_unit = 'month' THEN 0
                           WHEN rate_unit = 'day' THEN days_worked * rate
                           ELSE (total_minutes / 60.0) * rate
                       END)
                   )::numeric AS base_salary,
                   SUM(CASE WHEN rate_unit IN ('day', 'month') THEN 0 ELSE (overtime_minutes / 60.0) * rate * 1.5 END)::numeric AS overtime_pay,
                   COALESCE(
                       jsonb_agg(jsonb_build_object(
                           'profession_key', profession_key,
                           'rate', rate,
                           'rate_unit', rate_unit,
                           'hours', ROUND(total_minutes / 60.0, 1),
                           'days', days_worked
                       ) ORDER BY profession_key) FILTER (WHERE total_minutes > 0 OR overtime_minutes > 0 OR rate_unit = 'month'),
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
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'penalty'), 0)::numeric AS penalties,
                   COALESCE(SUM(sa.amount) FILTER (WHERE sa.type = 'advance'), 0)::numeric AS advances
            FROM salary_adjustments sa
            JOIN params p ON sa.month >= p.month_from AND sa.month <= p.month_to
            WHERE COALESCE(sa.status, 'applied') = 'applied'
            GROUP BY sa.staff_id
        ),
        report_snapshots AS (
            SELECT DISTINCT ON (pr.staff_id)
                   pr.staff_id,
                   pr.status AS payroll_status,
                   pr.id AS payroll_report_id,
                   pr.gross_amount,
                   pr.deductions_amount,
                   pr.advances_amount,
                   pr.net_amount,
                   pr.breakdown_json
            FROM payroll_reports pr
            JOIN params p ON pr.period_month >= p.month_from AND pr.period_month <= p.month_to
            WHERE pr.voided_at IS NULL
            ORDER BY pr.staff_id, pr.period_month DESC, pr.id DESC
        )
        SELECT s.id AS staff_id,
               s.name AS staff_name,
               s.role_type,
               s.department,
               COALESCE(s.hourly_rate, 0)::numeric AS hourly_rate,
               COALESCE(s.rate_unit, 'hour') AS rate_unit,
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
               ROUND(COALESCE(at.advances, 0))::int AS advances,
               ROUND(COALESCE(tt.base_salary, 0) + COALESCE(tt.overtime_pay, 0) + COALESCE(at.bonuses, 0) + COALESCE(at.tips, 0) - COALESCE(at.deductions, 0) - COALESCE(at.penalties, 0) - COALESCE(at.advances, 0))::int AS total_salary,
               rs.payroll_status,
               rs.payroll_report_id,
               rs.gross_amount,
               rs.deductions_amount AS report_deductions_amount,
               rs.advances_amount AS report_advances_amount,
               rs.net_amount,
               rs.breakdown_json
        FROM active_staff s
        LEFT JOIN time_totals tt ON tt.staff_id = s.id
        LEFT JOIN adjustment_totals at ON at.staff_id = s.id
        LEFT JOIN report_snapshots rs ON rs.staff_id = s.id
        ORDER BY s.name
    `, [month, period.from, period.to, period.month_from, period.month_to]);
    const staffIds = result.rows.map(row => Number(row.staff_id)).filter(Number.isInteger);
    const [attendanceMetrics, professionRateMap, activeSchemeMap, payrollProfileContext] = await Promise.all([
        loadPayrollAttendanceMetrics({ from: period.from, to: period.to, staffIds }, db),
        loadProfessionRateMap(staffIds, db),
        loadActivePayrollSchemeMap(staffIds, month, db),
        loadPayrollProfileContext(staffIds, { from: period.from, to: period.to }, db)
    ]);
    const emptyMetrics = () => ({
        physicalMinutes: 0,
        totalMinutes: 0,
        allocatedMinutes: 0,
        plannedMinutes: 0,
        overtimeMinutes: 0,
        hoursWorked: 0,
        overtimeHours: 0,
        daysWorked: 0,
        professionAllocations: [],
        baseProfessionAllocations: [],
        additionalProfessionAllocations: [],
        compensationMinutes: 0,
        roleMinutes: 0,
        overtimeAllocations: [],
        primaryDays: [],
        attendanceDays: [],
        allocationIssues: [],
        payrollBlockingIssues: [],
        reconciliation: { days: [], warnings: [] }
    });
    const data = result.rows.map(row => {
        const staffId = Number(row.staff_id);
        const rateUnit = staffRateUnit(row);
        const staff = {
            id: staffId,
            roleType: row.role_type,
            hourlyRate: Number(row.hourly_rate || 0),
            rateUnit
        };
        const scheme = activeSchemeMap.get(staffId) || {
            schemeType: rateUnit === 'month' ? 'monthly_fixed' : (rateUnit === 'day' ? 'per_shift' : 'hourly'),
            config: {},
            isFallback: true
        };
        const metrics = attendanceMetrics.get(staffId) || emptyMetrics();
        const professionPay = calculateProfessionPay(staff, scheme, metrics, professionRateMap, payrollProfileContext);
        const transparency = buildPayrollTransparencyMetrics(metrics, professionPay);
        const payrollRateUnit = professionPay.rateUnit || rateUnit;
        const baseSalary = Number(professionPay.baseAmount || 0);
        const additionalPay = Number(professionPay.additionalAmount || 0);
        const overtimePay = Number(professionPay.overtimeAmount || 0);
        const bonuses = Number(row.bonuses || 0);
        const tips = Number(row.tips || 0);
        const deductions = Number(row.deductions || 0);
        const penalties = Number(row.penalties || 0);
        const advances = Number(row.advances || 0);
        const calculatedRow = {
            staff_id: staffId,
            staff_name: row.staff_name,
            role_type: row.role_type,
            department: row.department,
            hourly_rate: Number(row.hourly_rate || 0),
            rate_unit: payrollRateUnit,
            profession_rate_summary: professionPay.professionRateSummary,
            days_worked: Number(metrics.daysWorked || 0),
            hours_worked: Math.round((Number(metrics.totalMinutes || 0) / 60) * 10) / 10,
            physical_minutes: Number(metrics.physicalMinutes ?? metrics.totalMinutes ?? 0),
            base_profession_allocations: metrics.baseProfessionAllocations || metrics.professionAllocations || [],
            additional_profession_allocations: metrics.additionalProfessionAllocations || [],
            compensation_minutes: Number(metrics.compensationMinutes ?? metrics.totalMinutes ?? 0),
            role_minutes: Number(metrics.roleMinutes ?? metrics.totalMinutes ?? 0),
            payroll_transparency: transparency,
            physical_hours: Number(transparency.physicalHours || 0),
            base_role_hours: Number(transparency.baseRoleHours || 0),
            additional_role_hours: Number(transparency.additionalRoleHours || 0),
            additional_profession: transparency.additionalProfession || null,
            additional_rate: transparency.additionalRate ?? null,
            additional_multiplier: transparency.additionalMultiplier ?? null,
            additional_roles: transparency.additionalRoles || [],
            planned_hours: Math.round((Number(metrics.plannedMinutes || 0) / 60) * 10) / 10,
            overtime_hours: Math.round((Number(metrics.overtimeMinutes || 0) / 60) * 10) / 10,
            base_salary: baseSalary,
            additional_pay: additionalPay,
            overtime_pay: overtimePay,
            bonuses,
            tips,
            deductions,
            penalties,
            advances,
            total_salary: Math.round(baseSalary + additionalPay + overtimePay + bonuses + tips - deductions - penalties - advances),
            allocation_issues: professionPay.allocationIssues,
            payroll_blocking_issues: professionPay.blockingIssues || [],
            payroll_lines: [
                ...(professionPay.baseLines || []),
                ...(professionPay.additionalLines || []),
                ...(professionPay.overtimeLines || [])
            ],
            reconciliation: professionPay.reconciliation,
            payroll_status: row.payroll_status || null,
            payroll_report_id: row.payroll_report_id || null
        };
        return applyHrPayrollSnapshot(calculatedRow, row);
    });
    return { month, period, data, totals: payrollTotals(data) };
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
            SELECT s.id, s.name, s.department, s.role_type, s.color, s.photo_url,
                   COALESCE(s.avg_rating, 0)::numeric AS avg_rating,
                   COALESCE(s.total_ratings, 0)::int AS total_ratings
            FROM staff s
            WHERE ${scheduleableStaffWhere('s')}
        ),
        shift_stats AS (
            SELECT hs.staff_id, COUNT(*)::int AS days_scheduled
            FROM hr_shifts hs
            JOIN params p ON hs.shift_date >= p.date_from AND hs.shift_date <= p.date_to
            GROUP BY hs.staff_id
        ),
        time_stats AS (
            SELECT tr.staff_id,
                   COUNT(*) FILTER (WHERE tr.clock_in IS NOT NULL)::int AS days_worked,
                   COUNT(*) FILTER (WHERE COALESCE(tr.late_minutes, 0) > 5)::int AS late_count,
                   COUNT(*) FILTER (WHERE tr.status IN ('absent', 'no_show'))::int AS days_absent,
                   COALESCE(SUM(tr.late_minutes) FILTER (WHERE COALESCE(tr.late_minutes, 0) > 5), 0)::int AS total_late_minutes,
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

async function mirrorHrShiftToStaffSchedule(shift, db = pool, options = {}) {
    const date = toDateOnly(shift?.shift_date);
    if (!shift?.staff_id || !date) return;
    const validation = options.staffValidation || await validateStaffScheduleableForDate(
        db,
        shift.staff_id,
        date,
        { forUpdate: false }
    );
    if (!validation.ok) return;
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

async function mirrorHrDayPlanToStaffSchedule(saved, staffId, shiftDate, note = null, db = pool, options = {}) {
    if (saved?.shift) {
        await mirrorHrShiftToStaffSchedule(saved.shift, db, options);
        return;
    }
    const date = toDateOnly(shiftDate);
    const status = saved?.plan?.status;
    if (!staffId || !date || !['dayoff', 'vacation', 'sick'].includes(status)) {
        await removeMirroredStaffSchedule(staffId, shiftDate, db);
        return;
    }
    await db.query(
        `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
         VALUES ($1, $2, NULL, NULL, $3, $4, NULL)
         ON CONFLICT (staff_id, date)
         DO UPDATE SET shift_start = NULL,
                       shift_end = NULL,
                       status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       profession_key = NULL`,
        [staffId, date, status, note ?? null]
    );
}

function publicHrShiftSegment(segment = {}) {
    const shiftStart = segment.shiftStart ?? segment.planned_start ?? null;
    const shiftEnd = segment.shiftEnd ?? segment.planned_end ?? null;
    const additionalRoles = segment.additionalRoles ?? segment.additional_roles ?? [];
    const paidAdditionalProfessionKeys = segment.paidAdditionalProfessionKeys
        ?? segment.paid_additional_profession_keys
        ?? additionalRoles
            .filter(role => (role.compensationMode ?? role.compensation_mode) === 'paid_hourly')
            .map(role => role.professionKey ?? role.profession_key)
            .filter(Boolean);
    return {
        id: segment.id ?? null,
        professionKey: segment.professionKey ?? segment.profession_key ?? null,
        shiftStart: shiftStart === null ? null : String(shiftStart).slice(0, 5),
        shiftEnd: shiftEnd === null ? null : String(shiftEnd).slice(0, 5),
        breakMinutes: Number(segment.breakMinutes ?? segment.break_minutes ?? 0),
        note: segment.note ?? segment.notes ?? null,
        additionalRoles: additionalRoles.map(role => ({
            professionKey: role.professionKey ?? role.profession_key ?? null,
            compensationMode: role.compensationMode ?? role.compensation_mode ?? 'unpaid',
            payMultiplier: role.payMultiplier ?? role.pay_multiplier ?? null,
            policyVersion: role.policyVersion ?? role.policy_version ?? null,
            countsAsPhysicalTime: false
        })),
        additionalProfessionKeys: segment.additionalProfessionKeys ?? segment.additional_profession_keys ?? [],
        paidAdditionalProfessionKeys,
        countsAsPhysicalTime: true,
        physicalTimeSource: 'segment'
    };
}

function hrShiftWithDayPlan(shift, plan) {
    if (!shift) return null;
    const publicShift = { ...shift };
    const planUpdatedAt = hrShiftPlanUpdatedAt(shift);
    delete publicShift.plan_updated_at_token;
    let effectivePlan = plan;
    if (!effectivePlan) {
        try {
            effectivePlan = normalizeHrShiftDayPlan({
                professionKey: shift.profession_key,
                shiftStart: shift.planned_start,
                shiftEnd: shift.planned_end,
                breakMinutes: shift.break_minutes
            }, {
                status: shift.shift_type === 'remote' ? 'remote' : 'working',
                strictProfessionKeys: false
            });
        } catch {
            effectivePlan = null;
        }
    }
    if (!effectivePlan) {
        return {
            ...publicShift,
            primaryProfessionKey: shift.profession_key || null,
            primary_profession_key: shift.profession_key || null,
            professionKeys: shift.profession_key ? [shift.profession_key] : [],
            profession_keys: shift.profession_key ? [shift.profession_key] : [],
            segments: [],
            planUpdatedAt,
            plan_updated_at: planUpdatedAt,
            hrShiftUpdatedAt: shift.updated_at || null,
            hr_shift_updated_at: shift.updated_at || null
        };
    }
    return {
        ...publicShift,
        primaryProfessionKey: effectivePlan.primaryProfessionKey,
        primary_profession_key: effectivePlan.primaryProfessionKey,
        segments: effectivePlan.segments.map(publicHrShiftSegment),
        professionKeys: effectivePlan.professionKeys,
        profession_keys: effectivePlan.professionKeys,
        plannedMinutes: effectivePlan.plannedMinutes,
        planned_minutes: effectivePlan.plannedMinutes,
        gapMinutes: effectivePlan.gapMinutes,
        planUpdatedAt,
        plan_updated_at: planUpdatedAt,
        hrShiftUpdatedAt: shift.updated_at || null,
        hr_shift_updated_at: shift.updated_at || null
    };
}

function dayPlanPayload(plan, extra = {}) {
    return {
        ...extra,
        primaryProfessionKey: plan.primaryProfessionKey,
        segments: plan.segments.map(segment => {
            const { id, ...copyable } = publicHrShiftSegment(segment);
            return copyable;
        })
    };
}

function auditHrDayPlan(plan) {
    if (!plan) return null;
    return {
        primaryProfessionKey: plan.primaryProfessionKey || null,
        plannedMinutes: Number(plan.plannedMinutes || 0),
        segments: plan.segments.map(publicHrShiftSegment)
    };
}

async function attachHrShiftSegments(rows = [], db = pool) {
    if (!rows.length) return rows;
    const hydrated = await hydrateHrShiftDayPlans(db, rows);
    return hydrated.map(({ shift, plan }) => hrShiftWithDayPlan(shift, plan));
}

function sendHrShiftPlanError(res, error, extra = {}) {
    const status = Number(error?.statusCode || error?.status || 400);
    return res.status(status >= 400 && status < 500 ? status : 400)
        .json(hrShiftPlanErrorPayload(error, extra));
}

// ==========================================
// PROFESSIONS CATALOG
// ==========================================

router.get('/professions', async (req, res) => {
    try {
        const catalog = await loadProfessionWorkspaceCatalog(pool);
        res.json({
            success: true,
            data: catalog.items,
            structureNodes: catalog.structureNodes,
            inventory: catalog.inventory
        });
    } catch (err) {
        log.error('GET /hr/professions error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/professions', requireHrManage, async (req, res) => {
    try {
        const payload = normalizeProfessionPayload(req.body);
        if (!payload.key || !payload.title) {
            return res.status(400).json({ success: false, error: 'Потрібні key і title професії' });
        }
        if (isHiddenProfessionKey(payload.key)) {
            return res.status(400).json({
                success: false,
                error: `Професія "${payload.key}" прихована як дубль. Використайте актуальну професію замість цього key.`
            });
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
                JSON.stringify([]),
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

router.put('/professions/:id', requireHrManage, async (req, res) => {
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
                color = $5,
                structure_node_id = $6,
                sort_order = $7,
                is_active = $8,
                updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
                payload.title,
                payload.department,
                payload.shortInfo,
                JSON.stringify(payload.responsibilities),
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

router.get('/checklists/dashboard', async (req, res) => {
    try {
        const dashboard = await loadProfessionChecklistDashboard(pool, req.query || {});
        res.json({ success: true, data: dashboard });
    } catch (err) {
        sendProfessionChecklistFailure(res, err, 'GET /hr/checklists/dashboard error');
    }
});

router.get('/professions/:professionKey/checklist', async (req, res) => {
    try {
        const includeArchivedItems = req.query.include_archived === 'true'
            || req.query.includeArchived === 'true';
        const template = await loadProfessionChecklistTemplate(
            pool,
            { key: req.params.professionKey },
            { includeArchivedItems }
        );
        res.json({ success: true, data: template });
    } catch (err) {
        sendProfessionChecklistFailure(res, err, 'GET /hr/professions/:professionKey/checklist error');
    }
});

router.post('/professions/:professionKey/checklist/items', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const actor = req.user?.username || null;
        const result = await createProfessionChecklistItem(
            client,
            { key: req.params.professionKey },
            req.body || {},
            { actor }
        );
        const onboardingSync = await syncProfessionOnboardingProgressForProfession(
            result.profession.key,
            req.user,
            { db: client, ipAddress: req.ip }
        );
        await auditLog('profession_checklist_item_create', null, actor, {
            profession_key: result.profession.key,
            before: result.audit.before,
            after: result.audit.after,
            onboarding_sync: onboardingSync.audit
        }, req.ip, client);
        await client.query('COMMIT');
        inTransaction = false;
        res.status(201).json({
            success: true,
            data: {
                profession: result.profession,
                item: result.item,
                position: result.position,
                onboardingSync
            }
        });
    } catch (err) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {});
        sendProfessionChecklistFailure(res, err, 'POST /hr/professions/:professionKey/checklist/items error');
    } finally {
        client.release();
    }
});

router.put('/professions/:professionKey/checklist/reorder', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const actor = req.user?.username || null;
        const result = await reorderProfessionChecklistItems(
            client,
            { key: req.params.professionKey },
            req.body || {},
            { actor }
        );
        const onboardingSync = await syncProfessionOnboardingProgressForProfession(
            result.profession.key,
            req.user,
            { db: client, ipAddress: req.ip }
        );
        await auditLog('profession_checklist_items_reorder', null, actor, {
            profession_key: result.profession.key,
            before: result.audit.before,
            after: result.audit.after,
            onboarding_sync: onboardingSync.audit
        }, req.ip, client);
        await client.query('COMMIT');
        inTransaction = false;
        res.json({
            success: true,
            data: {
                profession: result.profession,
                items: result.items,
                changed: result.changed,
                onboardingSync
            }
        });
    } catch (err) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {});
        sendProfessionChecklistFailure(res, err, 'PUT /hr/professions/:professionKey/checklist/reorder error');
    } finally {
        client.release();
    }
});

router.put('/professions/:professionKey/checklist/items/:itemKey', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const actor = req.user?.username || null;
        const result = await renameProfessionChecklistItem(
            client,
            { key: req.params.professionKey },
            req.params.itemKey,
            req.body || {},
            { actor }
        );
        const onboardingSync = await syncProfessionOnboardingProgressForProfession(
            result.profession.key,
            req.user,
            { db: client, ipAddress: req.ip }
        );
        await auditLog('profession_checklist_item_rename', null, actor, {
            profession_key: result.profession.key,
            item_key: result.item.itemKey,
            before: result.audit.before,
            after: result.audit.after,
            onboarding_sync: onboardingSync.audit
        }, req.ip, client);
        await client.query('COMMIT');
        inTransaction = false;
        res.json({
            success: true,
            data: {
                profession: result.profession,
                item: result.item,
                changed: result.changed,
                onboardingSync
            }
        });
    } catch (err) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {});
        sendProfessionChecklistFailure(res, err, 'PUT /hr/professions/:professionKey/checklist/items/:itemKey error');
    } finally {
        client.release();
    }
});

router.put('/professions/:professionKey/checklist/items/:itemKey/archive', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const actor = req.user?.username || null;
        const result = await archiveProfessionChecklistItem(
            client,
            { key: req.params.professionKey },
            req.params.itemKey,
            { actor }
        );
        const onboardingSync = await syncProfessionOnboardingProgressForProfession(
            result.profession.key,
            req.user,
            { db: client, ipAddress: req.ip }
        );
        await auditLog('profession_checklist_item_archive', null, actor, {
            profession_key: result.profession.key,
            item_key: result.item.itemKey,
            before: result.audit.before,
            after: result.audit.after,
            impact: result.impact,
            onboarding_sync: onboardingSync.audit
        }, req.ip, client);
        await client.query('COMMIT');
        inTransaction = false;
        res.json({
            success: true,
            data: {
                profession: result.profession,
                item: result.item,
                impact: result.impact,
                changed: result.changed,
                onboardingSync
            }
        });
    } catch (err) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {});
        sendProfessionChecklistFailure(res, err, 'PUT /hr/professions/:professionKey/checklist/items/:itemKey/archive error');
    } finally {
        client.release();
    }
});

router.get('/professions/:professionKey/staff/:staffId/checklist', async (req, res) => {
    try {
        const progress = await loadStaffProfessionChecklistProgress(pool, {
            staffId: req.params.staffId,
            professionKey: req.params.professionKey
        }, {
            includeArchived: req.query.include_archived === 'true' || req.query.includeArchived === 'true',
            includeOrphaned: req.query.include_orphaned !== 'false' && req.query.includeOrphaned !== 'false'
        });
        res.json({ success: true, data: progress });
    } catch (err) {
        sendProfessionChecklistFailure(res, err, 'GET /hr/professions/:professionKey/staff/:staffId/checklist error');
    }
});

async function handleStaffProfessionChecklistToggle(req, res) {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const actor = req.user?.username || null;
        const staffId = req.params.staffId || req.params.id;
        const professionKey = req.params.professionKey
            || req.body?.profession_key
            || req.body?.professionKey;
        const itemKey = req.params.itemKey
            || req.body?.item_key
            || req.body?.itemKey
            || req.body?.checklist_key
            || req.body?.checklistKey;
        const result = await toggleStaffProfessionChecklistProgress(client, {
            staffId,
            professionKey,
            itemKey,
            itemTitle: req.body?.title ?? req.body?.item_title ?? req.body?.itemTitle,
            completed: req.body?.completed,
            notes: req.body?.notes
        }, { actor });
        const onboarding = await syncProfessionOnboardingProgress(
            result.context.staff.id,
            result.context.profession.key,
            req.user,
            {
                db: client,
                lock: true,
                ipAddress: req.ip
            }
        );
        await auditLog('staff_profession_checklist_update', result.context.staff.id, actor, {
            profession_key: result.context.profession.key,
            checklist_key: result.context.item.itemKey,
            title: result.context.item.title,
            before: professionChecklistProgressAuditSnapshot(result.before),
            after: professionChecklistProgressAuditSnapshot(result.after),
            notes_changed: (result.before?.notes || null) !== (result.after?.notes || null)
        }, req.ip, client);
        await client.query('COMMIT');
        inTransaction = false;
        res.json({
            success: true,
            data: result.after,
            progress: result.after,
            item: result.context.item,
            onboarding
        });
    } catch (err) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {});
        sendProfessionChecklistFailure(res, err, 'PUT /hr/staff/:id/profession-checklist error');
    } finally {
        client.release();
    }
}

function dayPlanHasPaidAdditionalRoles(plan = null) {
    return (plan?.segments || []).some(segment =>
        (segment.additionalRoles || segment.additional_roles || [])
            .some(role => (role.compensationMode || role.compensation_mode) === 'paid_hourly'));
}

router.put(
    '/professions/:professionKey/staff/:staffId/checklist/:itemKey',
    requireHrManage,
    handleStaffProfessionChecklistToggle
);

// ==========================================
// STAFF HR DATA
// ==========================================

// GET /api/hr/staff — list all staff with HR fields (v39.8: filter freelance, add is_freelance)
router.get('/staff', async (req, res) => {
    try {
        const { active, role_type, include_freelance } = req.query;
        let sql = `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hire_date, birth_date, address, is_active, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit,
                    company_structure_node_id, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    is_freelance, unique_person_key, hr_pool_status, blacklist_reason, blacklisted_at,
                    termination_date, termination_reason, termination_recorded_at, termination_recorded_by,
                    (EXISTS(SELECT 1 FROM staff_face_descriptors sfd WHERE sfd.staff_id = staff.id)) AS has_face_descriptor,
                    (EXISTS(SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = staff.id AND ep.is_active = true)) AS has_account
                    FROM staff`;
        const params = [];
        const conds = [];
        if (active !== undefined) {
            const activeRequested = active === 'true';
            if (activeRequested) {
                conds.push(scheduleableStaffWhere('staff', {
                    includeFreelance: include_freelance === 'true'
                }));
            } else {
                params.push(false);
                conds.push(`is_active = $${params.length}`);
            }
        }
        if (role_type) {
            params.push(role_type);
            conds.push(`(role_type = $${params.length} OR COALESCE(secondary_professions, '[]'::jsonb) ? $${params.length})`);
        }
        // v39.8: hide freelance placeholder slots by default
        if (active !== 'true' && include_freelance !== 'true') {
            conds.push(`(is_freelance = false OR is_freelance IS NULL)`);
        }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY name';
        const result = await pool.query(sql, params);
        await attachStaffProfessionRates(result.rows);
        await attachTrainingReadiness(result.rows);
        await attachOnboardingAssignments(result.rows);
        const displayGroupContext = await loadStaffDisplayGroupContext(pool);
        res.json({
            success: true,
            data: decorateStaffRowsWithDisplayGroups(result.rows, { displayGroupContext }),
            displayGroups: listStaffDisplayGroups()
        });
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
        res.json({
            success: true,
            data: result.rows.map(row => publicHrAuditRow(row, req.user))
        });
    } catch (err) {
        log.error('GET /hr/staff/:id/history error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/staff/:id/profession-checklist', requireHrManage, handleStaffProfessionChecklistToggle);

router.get('/professions/workspace/:identity', async (req, res) => {
    try {
        const rawIdentity = String(req.params.identity || '').trim();
        const identity = /^\d+$/.test(rawIdentity)
            ? { id: Number(rawIdentity) }
            : { key: rawIdentity };
        const workspace = await loadProfessionWorkspace(pool, identity);
        if (!workspace) return res.status(404).json({ success: false, error: 'Професію не знайдено' });
        res.json({ success: true, data: workspace });
    } catch (err) {
        log.error('GET /hr/professions/workspace/:identity error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження картки професії' });
    }
});

router.put('/professions/:professionKey/staff/:staffId/conditions', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        const actor = req.user?.username || null;
        const result = await saveStaffProfessionCondition(
            client,
            req.params.staffId,
            req.params.professionKey,
            req.body || {},
            { actor }
        );
        const auditSnapshot = condition => ({
            professionKey: condition.professionKey,
            rateMode: condition.rateMode,
            explicitRate: condition.explicitRate,
            fallbackRate: condition.fallbackRate,
            rateUnit: condition.rateUnit,
            shiftPreferences: condition.shiftPreferences.map(item => ({
                dayType: item.dayType,
                startTime: item.startTime,
                endTime: item.endTime,
                isActive: item.isActive
            }))
        });
        await auditLog('staff_profession_conditions_update', result.after.staffId, actor, {
            source: 'profession_workspace.people_conditions',
            before: auditSnapshot(result.before),
            after: auditSnapshot(result.after)
        }, req.ip, client);
        await client.query('COMMIT');
        committed = true;
        res.json({ success: true, data: result.after });
    } catch (err) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        if (sendHrMutationFailure(res, err)) return;
        const status = Number(err?.statusCode || 500);
        if (status >= 500) log.error('PUT /hr/professions/:professionKey/staff/:staffId/conditions error', err);
        res.status(status >= 400 && status < 600 ? status : 500).json({
            success: false,
            code: err?.code || 'PROFESSION_CONDITIONS_UPDATE_FAILED',
            error: status < 500 ? err.message : 'Помилка збереження умов професії'
        });
    } finally {
        client.release();
    }
});

router.get('/staff/:id', async (req, res) => {
    try {
        const staff = await pool.query(
            `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hire_date, birth_date, address, is_active, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit,
                    company_structure_node_id, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    hr_pool_status, blacklist_reason, blacklisted_at,
                    termination_date, termination_reason, termination_recorded_at, termination_recorded_by
             FROM staff WHERE id = $1`, [req.params.id]
        );
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await attachStaffProfessionRates(staff.rows);
        await attachTrainingReadiness(staff.rows);
        await attachOnboardingAssignments(staff.rows);
        res.json({ success: true, data: staff.rows[0] });
    } catch (err) {
        log.error('GET /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/lifecycle-checklist', requireHrManage, async (req, res) => {
    try {
        const data = await loadStaffLifecycleChecklist(req.params.id, pool, { currentUserId: req.user?.id, actor: req.user });
        if (!data) return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        res.json({ success: true, data });
    } catch (err) {
        log.error('GET /hr/staff/:id/lifecycle-checklist error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/staff/:id/documents — private metadata only; binary is served by guarded download route.
router.get('/staff/:id/documents', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const includeArchived = req.query.include_archived === 'true';
        const documents = await listStaffDocuments(req.params.id, { includeArchived });
        res.json({ success: true, data: documents });
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
        const created = await createStaffDocument(req.params.id, file, req.body, req.user?.username || null);
        await auditLog('staff_document_upload', parseInt(req.params.id), req.user?.username, {
            ...created.audit
        }, req.ip);
        res.json({ success: true, data: created.data });
    } catch (err) {
        log.error('POST /hr/staff/:id/documents error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

router.get('/staff/:id/documents/:documentId/download', requireHrManage, async (req, res) => {
    try {
        if (!/^[0-9]+$/.test(String(req.params.documentId || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid document ID' });
        }
        const doc = await loadStaffDocumentDownload(req.params.id, req.params.documentId);
        if (!doc) return res.status(404).json({ success: false, error: 'Документ не знайдено' });
        res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', String(doc.file_size || doc.file_data.length || 0));
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Content-Disposition', `attachment; filename="${safeStaffDocumentDownloadFilename(doc.original_name)}"`);
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
        const archived = await archiveStaffDocument(req.params.id, req.params.documentId, req.user?.username || null);
        if (!archived) return res.status(404).json({ success: false, error: 'Документ не знайдено' });
        await auditLog('staff_document_archive', parseInt(req.params.id), req.user?.username, {
            ...archived.audit
        }, req.ip);
        res.json({ success: true, data: archived.data });
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
        const resources = await listStaffResources(req.params.id, { includeReturned });
        res.json({ success: true, data: resources });
    } catch (err) {
        log.error('GET /hr/staff/:id/resources error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/resource-options', requireHrManage, async (req, res) => {
    try {
        const result = await listStaffResourceOptions({
            kind: req.query.kind,
            q: req.query.q || req.query.search,
            limit: req.query.limit,
            businessContext: hrBusinessContextFromRequest(req)
        });
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('GET /hr/resource-options error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження ресурсів' });
    }
});

router.post('/staff/:id/resources', requireHrManage, async (req, res) => {
    try {
        const actor = req.user?.username || null;
        const issued = await issueStaffResource(req.params.id, req.body, {
            actor,
            businessContext: hrBusinessContextFromRequest(req),
            today: todayKyiv()
        });
        await auditLog('staff_resource_issue', parseInt(req.params.id), actor, {
            ...issued.audit
        }, req.ip);
        res.json({ success: true, data: issued.data });
    } catch (err) {
        if (!err.statusCode || err.statusCode >= 500) {
            log.error('POST /hr/staff/:id/resources error', err);
        }
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

router.put('/staff/:id/resources/:assignmentId/return', requireHrManage, async (req, res) => {
    try {
        if (!/^[0-9]+$/.test(String(req.params.assignmentId || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid assignment ID' });
        }
        const actor = req.user?.username || null;
        const returned = await returnStaffResource(req.params.id, req.params.assignmentId, req.body, {
            actor,
            today: todayKyiv()
        });
        await auditLog('staff_resource_return', parseInt(req.params.id), actor, {
            ...returned.audit
        }, req.ip);
        res.json({ success: true, data: returned.data });
    } catch (err) {
        if (!err.statusCode || err.statusCode >= 500) {
            log.error('PUT /hr/staff/:id/resources/:assignmentId/return error', err);
        }
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

router.get('/payroll-profiles', requireHrManage, async (req, res) => {
    try {
        const data = await listPayrollProfiles(req.query);
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/payroll-profiles error');
    }
});

router.get('/payroll-profiles/diagnostics', requireHrManage, async (req, res) => {
    try {
        const data = await diagnosePayrollProfiles(req.query);
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/payroll-profiles/diagnostics error');
    }
});

router.post('/payroll-profiles/simulator', requireHrManage, async (req, res) => {
    try {
        const data = await simulatePayrollProfiles(req.body || {});
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/simulator error');
    }
});

router.get('/payroll-profiles/forecast', requireHrManage, async (req, res) => {
    try {
        const data = await forecastPayrollProfiles(payrollProfileQueryWithIds(req.query));
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/payroll-profiles/forecast error');
    }
});

router.post('/payroll-profiles/bulk/preview', requireHrManage, async (req, res) => {
    try {
        const data = await previewPayrollProfileBulk(req.body || {});
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/bulk/preview error');
    }
});

router.post('/payroll-profiles/bulk/apply', requireHrManage, async (req, res) => {
    try {
        const data = await applyPayrollProfileBulk(req.body || {}, payrollProfileActor(req));
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/bulk/apply error');
    }
});

router.get('/payroll-profiles/:id', requireHrManage, async (req, res) => {
    try {
        const data = await getPayrollProfile(req.params.id, {
            asOfDate: req.query.asOfDate || req.query.as_of_date
        });
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/payroll-profiles/:id error');
    }
});

router.post('/payroll-profiles', requireHrManage, async (req, res) => {
    try {
        const data = await createPayrollProfile(req.body, payrollProfileActor(req));
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles error');
    }
});

router.post('/payroll-profiles/:id/impact-preview', requireHrManage, async (req, res) => {
    try {
        const data = await impactPayrollProfilePreview(req.params.id, req.body || {});
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/:id/impact-preview error');
    }
});

router.post('/payroll-profiles/:id/clone', requireHrManage, async (req, res) => {
    try {
        const data = await createPayrollProfileClone(req.params.id, req.body, payrollProfileActor(req));
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/:id/clone error');
    }
});

router.post('/payroll-profiles/:id/versions', requireHrManage, async (req, res) => {
    try {
        const data = await createPayrollProfileVersion(req.params.id, req.body, payrollProfileActor(req));
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/:id/versions error');
    }
});

router.post('/payroll-profiles/:id/sync-from-base', requireHrManage, async (req, res) => {
    try {
        const data = await syncPayrollProfileFromBase(req.params.id, req.body, payrollProfileActor(req));
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'POST /hr/payroll-profiles/:id/sync-from-base error');
    }
});

router.put('/payroll-profiles/:id/archive', requireHrManage, async (req, res) => {
    try {
        const data = await archivePayrollProfile(req.params.id, req.body, payrollProfileActor(req));
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'PUT /hr/payroll-profiles/:id/archive error');
    }
});

router.get('/staff/:id/payroll-profile-assignments', requireHrManage, async (req, res) => {
    try {
        const data = await listStaffPayrollProfileAssignments(req.params.id, {
            includePast: req.query.include_past !== 'false'
        });
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/staff/:id/payroll-profile-assignments error');
    }
});

router.put('/staff/:id/payroll-profile-assignments', requireHrManage, async (req, res) => {
    try {
        const data = await saveStaffPayrollProfileAssignments(req.params.id, req.body, payrollProfileActor(req));
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'PUT /hr/staff/:id/payroll-profile-assignments error');
    }
});

router.get('/staff/:id/payroll-profile-history', requireHrManage, async (req, res) => {
    try {
        const data = await listStaffPayrollProfileHistory(req.params.id, {
            limit: req.query.limit
        });
        res.json({ success: true, data });
    } catch (err) {
        sendPayrollProfileFailure(res, err, 'GET /hr/staff/:id/payroll-profile-history error');
    }
});

router.get('/staff/:id/payroll-scheme', requireHrManage, async (req, res) => {
    try {
        const workspace = await loadStaffPayrollSchemeWorkspace(req.params.id);
        if (!workspace) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        res.json({ success: true, data: workspace.data });
    } catch (err) {
        log.error('GET /hr/staff/:id/payroll-scheme error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження зарплатної схеми' });
    }
});

router.put('/staff/:id/payroll-scheme', requireHrManage, async (req, res) => {
    try {
        const scheme = await createStaffPayrollScheme(req.params.id, req.body, req.user);
        if (!scheme) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        await auditLog('staff_payroll_scheme_update', parseInt(req.params.id), req.user?.username, {
            ...scheme.audit
        }, req.ip);
        res.json({ success: true, data: scheme.data });
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

router.get('/staff/:id/offboarding-readiness', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffRowOrNull(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Співробітника не знайдено' });
        const data = await loadStaffOffboardingReadiness(req.params.id, pool, { currentUserId: req.user?.id, actor: req.user });
        res.json({ success: true, data });
    } catch (err) {
        log.error('GET /hr/staff/:id/offboarding-readiness error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.get('/staff/:id/delete-readiness', requireHrManage, async (req, res) => {
    try {
        const data = await loadStaffDeleteReadiness(Number(req.params.id));
        if (!data) return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        res.json({ success: true, data });
    } catch (err) {
        log.error('GET /hr/staff/:id/delete-readiness error', err);
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
        const readiness = await loadStaffOffboardingReadiness(req.params.id, client, { currentUserId: req.user?.id, actor: req.user });
        const openResourceCount = readiness.open_resource_count || 0;
        if (accountAction === 'disable' && !readiness.disable_available) {
            await client.query('ROLLBACK');
            const blockers = readiness.disable_blockers || [];
            const currentUserBlocked = blockers.some(account => account.is_current_user);
            const permissionBlocked = blockers.some(account => account.block_reason === 'requires_manage_accounts');
            if (permissionBlocked) {
                return res.status(403).json({
                    success: false,
                    error: staffOffboardingDisableError(blockers),
                    blockers
                });
            }
            return res.status(409).json({
                success: false,
                error: currentUserBlocked
                    ? 'Не можна вимкнути власний CRM-акаунт через offboarding'
                    : 'Creator-акаунт не можна вимкнути через HR offboarding',
                blockers
            });
        }
        const event = await client.query(
            `INSERT INTO staff_offboarding_events
                (staff_id, status, effective_date, reason, target_pool_status, account_action,
                 resource_check_required, open_resource_count, notes, created_by, completed_by)
             VALUES ($1::int, 'completed', $2::date, $3::text, $4::text, $5::text, true, $6::int, $7::text, $8::text, $8::text)
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
                 hr_pool_status = $2::text,
                 blacklist_reason = CASE WHEN $2::text = 'blacklisted' THEN $3::text ELSE NULL END,
                 blacklisted_at = CASE WHEN $2::text = 'blacklisted' THEN COALESCE(blacklisted_at, NOW()) ELSE NULL END,
                 termination_date = $4::date,
                 termination_reason = $3::text,
                 termination_recorded_at = NOW(),
                 termination_recorded_by = $5::text
            WHERE id = $1::int
             RETURNING *`,
            [req.params.id, targetPoolStatus, reason, effectiveDate, req.user?.username || null]
        );
        const scheduleCleanupFromDate = effectiveDate < todayKyiv() ? todayKyiv() : effectiveDate;
        const scheduleCleanup = await cleanupFutureStaffOperationalSchedule(client, req.params.id, scheduleCleanupFromDate);
        const accountDeactivation = await syncLinkedStaffAccountDeactivation(client, req.params.id, {
            actor: req.user,
            req,
            reason: 'hr_offboarding',
            source: 'hr_staff_offboarding',
            canDisableAccount: account => accountAction === 'disable' && actorCanDisableOffboardingAccount(req.user, account),
            blockReason: account => accountAction === 'disable' ? accountOffboardingBlockReason(req.user, account) : null,
            accountMeta: account => staffOffboardingAccountMeta(account, req.user?.id),
            eventDetails: { offboardingEventId: event.rows[0].id },
            logger: log
        });
        await client.query('COMMIT');
        broadcastRosterDates(scheduleCleanup.dates || [], req.user?.id);
        await auditLog('staff_offboarding_complete', parseInt(req.params.id), req.user?.username, {
            event_id: event.rows[0].id,
            effective_date: effectiveDate,
            target_pool_status: targetPoolStatus,
            account_action: accountAction,
            disabled_accounts: accountDeactivation.disabled_accounts,
            disabled_account_usernames: accountDeactivation.disabled_account_usernames,
            open_resource_count: openResourceCount,
            schedule_cleanup: scheduleCleanup,
            account_deactivation: accountDeactivation
        }, req.ip);
        res.json({
            success: true,
            data: event.rows[0],
            staff: staffUpdate.rows[0],
            open_resource_count: openResourceCount,
            disabled_accounts: accountDeactivation.disabled_accounts,
            disabled_account_usernames: accountDeactivation.disabled_account_usernames,
            schedule_cleanup: scheduleCleanup,
            account_deactivation: accountDeactivation
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
        const { name, phone, emergency_contact, emergency_phone, role_type, hourly_rate, rate_unit, birth_date, photo_url, address, notes, telegram_id, telegram_username, contract_type, skills, hr_pool_status, blacklist_reason, company_structure_node_id } = req.body;
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
            name: hasBodyField('name'),
            phone: hasBodyField('phone'),
            emergency_contact: hasBodyField('emergency_contact'),
            emergency_phone: hasBodyField('emergency_phone'),
            role_type: hasBodyField('role_type'),
            hourly_rate: hasBodyField('hourly_rate'),
            rate_unit: hasBodyField('rate_unit') || hasBodyField('rateUnit'),
            birth_date: hasBodyField('birth_date'),
            photo_url: hasBodyField('photo_url') || hasBodyField('photoUrl'),
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
        const requestedPoolStatus = fieldPresence.hr_pool_status ? cleanStaffText(hr_pool_status, 32) : null;
        if (fieldPresence.hr_pool_status && !['core', 'reserve', 'blacklisted'].includes(requestedPoolStatus)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус пулу' });
        }
        const beforeStaffResult = await pool.query(
            `SELECT id, name, phone, emergency_contact, emergency_phone, role_type,
                    COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit, company_structure_node_id, birth_date, photo_url, address, notes, telegram_id, telegram_username,
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

        if (fieldPresence.name) {
            const normalizedName = textOrNull(name);
            if (!normalizedName) return res.status(400).json({ success: false, error: 'ПІБ співробітника обовʼязкове' });
            queueStaffUpdate('name', normalizedName);
        }
        if (fieldPresence.phone) queueStaffUpdate('phone', textOrNull(phone));
        if (fieldPresence.emergency_contact) queueStaffUpdate('emergency_contact', textOrNull(emergency_contact));
        if (fieldPresence.emergency_phone) queueStaffUpdate('emergency_phone', textOrNull(emergency_phone));
        if (fieldPresence.role_type) queueStaffUpdate('role_type', textOrNull(role_type));
        if (fieldPresence.hourly_rate) queueStaffUpdate('hourly_rate', numberOrNull(hourly_rate));
        if (fieldPresence.rate_unit) queueStaffUpdate('rate_unit', normalizeStaffRateUnit(rate_unit ?? req.body.rateUnit));
        if (fieldPresence.birth_date) queueStaffUpdate('birth_date', birth_date || null);
        if (fieldPresence.photo_url) {
            const normalizedPhotoUrl = normalizeStaffPhotoUrl(hasBodyField('photo_url') ? photo_url : req.body.photoUrl);
            if (!normalizedPhotoUrl.ok) return res.status(400).json({ success: false, error: normalizedPhotoUrl.error });
            queueStaffUpdate('photo_url', normalizedPhotoUrl.value);
        }
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
            queueStaffUpdate('hr_pool_status', requestedPoolStatus);
            setClauses.push(requestedPoolStatus === 'blacklisted'
                ? 'blacklisted_at = COALESCE(blacklisted_at, NOW())'
                : 'blacklisted_at = NULL');
        }
        if (fieldPresence.hr_pool_status && requestedPoolStatus !== 'blacklisted') {
            setClauses.push('blacklist_reason = NULL');
        } else if (fieldPresence.blacklist_reason) {
            queueStaffUpdate('blacklist_reason', textOrNull(blacklist_reason));
        }
        if (hasSecondaryProfessions) {
            queueStaffUpdate('secondary_professions', JSON.stringify(professionValidation.secondaryProfessions || []), '::jsonb');
        }

        let afterRateRows = beforeRateRows;
        let result;
        let scheduleCleanup = null;
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
            if (fieldPresence.hr_pool_status && ['blacklisted', 'reserve'].includes(requestedPoolStatus)) {
                scheduleCleanup = await cleanupFutureStaffOperationalSchedule(client, req.params.id, todayKyiv());
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
        broadcastRosterDates(scheduleCleanup?.dates || [], req.user?.id);
        const changedFields = [
            'phone', 'emergency_contact', 'emergency_phone', 'role_type', 'secondary_professions',
            'hourly_rate', 'rate_unit', 'company_structure_node_id', 'birth_date', 'photo_url', 'address', 'notes', 'telegram_id', 'telegram_username',
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
            requested_fields: Object.keys(req.body || {}),
            schedule_cleanup: scheduleCleanup
        }, req.ip);
        res.json({ success: true, data: result.rows[0], schedule_cleanup: scheduleCleanup });
    } catch (err) {
        log.error('PUT /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/staff/:id — permanent duplicate cleanup guarded by typed confirmation
router.delete('/staff/:id', requireHrManage, async (req, res) => {
    const confirmation = cleanStaffText(req.body?.confirmation, 20);
    if (confirmation !== STAFF_DELETE_CONFIRMATION) {
        return res.status(400).json({
            success: false,
            error: `Для видалення потрібно вручну ввести ${STAFF_DELETE_CONFIRMATION}`
        });
    }

    const client = await pool.connect();
    try {
        const staffId = Number(req.params.id);
        const reason = cleanStaffText(req.body?.reason, 1000) || 'duplicate_cleanup';
        await client.query('BEGIN');
        const readiness = await loadStaffDeleteReadiness(staffId, client, { lock: true });
        if (!readiness) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        }
        if (!readiness.can_delete) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Працівника не можна видалити, бо є звʼязані операційні записи',
                data: readiness
            });
        }

        await client.query('UPDATE hr_audit_log SET staff_id = NULL WHERE staff_id = $1', [staffId]);
        await insertAuditLog('staff_delete_permanent', null, req.user?.username, {
            deleted_staff: readiness.staff,
            reason,
            cleanup: readiness.cleanup
        }, req.ip, client);
        const deleted = await client.query('DELETE FROM staff WHERE id = $1 RETURNING id, name', [staffId]);
        await client.query('COMMIT');
        res.json({
            success: true,
            data: {
                deleted: deleted.rows[0],
                cleanup: readiness.cleanup
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('DELETE /hr/staff/:id error', err);
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                error: 'Працівника не можна видалити: база знайшла додаткові звʼязані записи. Використайте offboarding або приберіть звʼязки вручну.'
            });
        }
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// PUT /api/hr/staff/:id/status — activate/deactivate
router.put('/staff/:id/status', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const isActive = req.body?.is_active === true || req.body?.isActive === true;
        if (req.body?.is_active !== true && req.body?.is_active !== false && req.body?.isActive !== true && req.body?.isActive !== false) {
            return res.status(400).json({ success: false, error: 'is_active required' });
        }

        await client.query('BEGIN');
        const before = await client.query('SELECT * FROM staff WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!before.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }

        const result = isActive
            ? await client.query(
                `UPDATE staff
                 SET is_active = true,
                     termination_date = NULL,
                     termination_reason = NULL,
                     termination_recorded_at = NULL,
                     termination_recorded_by = NULL
                 WHERE id = $1
                 RETURNING *`,
                [req.params.id]
            )
            : await client.query(
                'UPDATE staff SET is_active = false WHERE id = $1 RETURNING *',
                [req.params.id]
            );

        let scheduleCleanup = null;
        let accountDeactivation = null;
        if (!isActive) {
            scheduleCleanup = await cleanupFutureStaffOperationalSchedule(client, req.params.id, todayKyiv());
            accountDeactivation = await syncLinkedStaffAccountDeactivation(client, req.params.id, {
                actor: req.user,
                req,
                reason: 'hr_staff_deactivation',
                source: 'hr_staff_status',
                canDisableAccount: account => actorCanDisableOffboardingAccount(req.user, account),
                blockReason: account => accountOffboardingBlockReason(req.user, account),
                accountMeta: account => staffOffboardingAccountMeta(account, req.user?.id),
                logger: log
            });
        }

        let reactivatedAccounts = [];
        let accountReactivationBlockers = [];
        if (isActive) {
            const linkedAccounts = await client.query(
                `SELECT u.id, u.username, u.name, u.role, u.extra_roles, ep.id AS profile_id
                 FROM employee_profiles ep
                 JOIN users u ON u.id = ep.user_id
                 WHERE ep.staff_id = $1 AND ep.user_id IS NOT NULL
                 FOR UPDATE OF ep, u`,
                [req.params.id]
            ).catch(err => {
                log.warn(`HR rehire account lookup skipped: ${err.message}`);
                return { rows: [] };
            });
            const allowedAccounts = linkedAccounts.rows.filter(account => actorCanReactivateStaffAccount(req.user, account));
            accountReactivationBlockers = linkedAccounts.rows
                .map(account => ({
                    ...staffOffboardingAccountMeta(account, req.user?.id),
                    block_reason: accountRehireBlockReason(req.user, account)
                }))
                .filter(account => account.block_reason);
            const userIds = allowedAccounts.map(row => Number(row.id)).filter(Number.isFinite);
            if (userIds.length) {
                await client.query(
                    `UPDATE employee_profiles
                     SET is_active = true
                     WHERE staff_id = $1 AND user_id = ANY($2::int[])
                     RETURNING user_id`,
                    [req.params.id, userIds]
                ).catch(err => {
                    log.warn(`HR rehire profile activation skipped: ${err.message}`);
                    return { rows: [] };
                });
                const activatedUsers = await client.query(
                    `UPDATE users
                     SET is_active = true
                     WHERE id = ANY($1::int[])
                     RETURNING id, username, name, role`,
                    [userIds]
                ).catch(err => {
                    log.warn(`HR rehire account activation skipped: ${err.message}`);
                    return { rows: [] };
                });
                reactivatedAccounts = activatedUsers.rows;
                for (const target of activatedUsers.rows) {
                    await recordAccountSecurityEvent({
                        actor: req.user,
                        target,
                        eventType: 'account_activated',
                        reason: 'hr_rehire',
                        details: {
                            staffId: Number(req.params.id),
                            terminationCleared: true
                        },
                        req,
                        client
                    });
                }
            }
        }

        await client.query('COMMIT');
        broadcastRosterDates(scheduleCleanup?.dates || [], req.user?.id);
        await auditLog(isActive ? 'staff_rehire' : 'status_change', parseInt(req.params.id), req.user?.username, {
            is_active: isActive,
            reactivated_accounts: reactivatedAccounts.length,
            reactivated_account_usernames: reactivatedAccounts.map(row => row.username).filter(Boolean),
            account_reactivation_blocked: accountReactivationBlockers.length > 0,
            account_reactivation_blockers: accountReactivationBlockers,
            schedule_cleanup: scheduleCleanup,
            account_deactivation: accountDeactivation
        }, req.ip);
        res.json({
            success: true,
            data: result.rows[0],
            reactivated_accounts: reactivatedAccounts.length,
            reactivated_account_usernames: reactivatedAccounts.map(row => row.username).filter(Boolean),
            account_reactivation_blocked: accountReactivationBlockers.length > 0,
            account_reactivation_blockers: accountReactivationBlockers,
            schedule_cleanup: scheduleCleanup,
            account_deactivation: accountDeactivation
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/staff/:id/status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
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
    const client = await pool.connect();
    try {
        const { status, reason } = req.body;
        if (!['core', 'reserve', 'blacklisted'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус пулу' });
        }

        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE staff SET
                hr_pool_status = $1,
                blacklist_reason = CASE WHEN $1 = 'blacklisted' THEN COALESCE($2, blacklist_reason) ELSE NULL END,
                blacklisted_at = CASE WHEN $1 = 'blacklisted' THEN COALESCE(blacklisted_at, NOW()) ELSE NULL END
             WHERE id = $3
             RETURNING id, name, department, role_type, hr_pool_status, blacklist_reason, blacklisted_at`,
            [status, reason || null, req.params.id]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        const scheduleCleanup = ['blacklisted', 'reserve'].includes(status)
            ? await cleanupFutureStaffOperationalSchedule(client, req.params.id, todayKyiv())
            : null;
        await client.query('COMMIT');
        broadcastRosterDates(scheduleCleanup?.dates || [], req.user?.id);
        await auditLog('pool_status_update', parseInt(req.params.id), req.user?.username, {
            status,
            reason,
            schedule_cleanup: scheduleCleanup
        }, req.ip);
        res.json({ success: true, data: result.rows[0], schedule_cleanup: scheduleCleanup });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/staff/:id/pool-status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// GET/PUT /api/hr/company-structure — HR-owned instructions without Control Center refactor
router.get('/company-structure', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'hr_company_structure'");
        const payload = normalizeCompanyStructurePayload(result.rows[0]?.value || {});
        const hasSavedStructure = Boolean(
            result.rows.length
            && (payload.nodes.length || payload.structure || payload.instructions || payload.updatedAt)
        );
        res.json({ success: true, data: payload, hasSavedStructure, displayGroups: listStaffDisplayGroups() });
    } catch (err) {
        log.error('GET /hr/company-structure error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/company-structure', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const source = req.body || {};
        const hasExpectedVersion = Object.prototype.hasOwnProperty.call(source, 'baseUpdatedAt')
            || Object.prototype.hasOwnProperty.call(source, 'expectedUpdatedAt');
        const expectedUpdatedAt = source.baseUpdatedAt ?? source.expectedUpdatedAt ?? null;

        await client.query('BEGIN');
        const current = await client.query(
            "SELECT value FROM settings WHERE key = 'hr_company_structure' FOR UPDATE"
        );
        const currentPayload = normalizeCompanyStructurePayload(current.rows[0]?.value || {});
        if (hasExpectedVersion && expectedUpdatedAt !== currentPayload.updatedAt) {
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
        res.json({ success: true, data: payload, displayGroups: listStaffDisplayGroups(), staleRefsCleared });
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
                    WHERE hs.shift_date >= $1 AND hs.shift_date <= $2
                      AND ${scheduleableStaffWhere('s', { dateExpression: 'hs.shift_date' })}`;
        const params = [dateFrom, dateTo];

        if (staff_id) {
            params.push(parseInt(staff_id));
            sql += ` AND hs.staff_id = $${params.length}`;
        }

        sql += ' ORDER BY s.name, hs.shift_date';
        const result = await pool.query(sql, params);
        const data = await attachHrShiftSegments(result.rows);
        res.json({ success: true, data, dateFrom, dateTo });
    } catch (err) {
        if (isHrShiftPlanError(err)) return sendHrShiftPlanError(res, err);
        log.error('GET /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts — create single shift
router.post('/shifts', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const staffId = req.body.staff_id ?? req.body.staffId;
        const shiftDate = req.body.shift_date ?? req.body.shiftDate ?? req.body.date;
        if (!staffId || !shiftDate) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, shift_date' });
        }
        await client.query('BEGIN');
        const shiftValidation = await validateShiftWriteStaff(client, staffId, shiftDate);
        if (!shiftValidation.ok) {
            return await rejectUnscheduleableStaff(res, client, shiftValidation, {
                entry: { staff_id: staffId, shift_date: shiftDate }
            });
        }
        const saved = await saveHrShiftDayPlan(client, {
            staffId,
            shiftDate,
            shiftType: req.body.shift_type ?? req.body.shiftType,
            payload: req.body
        }, {
            actor: req.user?.username || null,
            ipAddress: req.ip,
            auditSource: 'hr.shift.create',
            requireExpectedUpdatedAt: true
        });
        await mirrorHrDayPlanToStaffSchedule(
            saved,
            staffId,
            shiftDate,
            req.body.note ?? req.body.notes ?? null,
            client
        );
        await reconcileRosterDates(client, [shiftDate]);
        await auditLog('shift_create', staffId, req.user?.username, {
            shift_id: Number(saved.shift?.id) || null,
            shift_date: shiftDate,
            planned_start: saved.plan.plannedStart,
            planned_end: saved.plan.plannedEnd,
            segments_count: saved.plan.segments.length,
            before_plan: null,
            after_plan: auditHrDayPlan(saved.plan)
        }, req.ip, client);
        await client.query('COMMIT');
        broadcastRosterDates([shiftDate], req.user?.id);
        res.json({ success: true, data: hrShiftWithDayPlan(saved.shift, saved.plan) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            if (err.code === 'HR_SHIFT_PLAN_STALE') {
                await auditLog('shift_plan_stale_rejected', err.details?.staffId || null, req.user?.username, {
                    outcome: 'rejected',
                    code: err.code,
                    shift_date: err.details?.shiftDate || null,
                    shift_id: err.details?.hrShiftId || null,
                    expected_updated_at: err.details?.expectedUpdatedAt || null,
                    current_updated_at: err.details?.currentUpdatedAt || null,
                    changes: {}
                }, req.ip).catch(auditError => log.error('HR shift stale rejection audit error', auditError));
            }
            return sendHrShiftPlanError(res, err, {
                staff_id: Number(req.body.staff_id ?? req.body.staffId) || null,
                shift_date: req.body.shift_date ?? req.body.shiftDate ?? req.body.date ?? null
            });
        }
        if (sendHrMutationFailure(res, err)) return;
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
        await client.query('BEGIN');
        const loadedCurrent = await loadHrShiftDayPlan(client, { hrShiftId: req.params.id });
        if (!loadedCurrent) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        const observedShift = loadedCurrent.shift;
        const shiftValidation = await validateShiftWriteStaff(client, observedShift.staff_id, observedShift.shift_date);
        if (!shiftValidation.ok) {
            return await rejectUnscheduleableStaff(res, client, shiftValidation, {
                entry: { staff_id: observedShift.staff_id, shift_date: toDateOnly(observedShift.shift_date), shift_id: req.params.id }
            });
        }
        const lockedCurrent = await loadHrShiftDayPlan(client, { hrShiftId: req.params.id }, { forUpdate: true });
        if (!lockedCurrent
            || Number(lockedCurrent.shift.staff_id) !== Number(observedShift.staff_id)
            || toDateOnly(lockedCurrent.shift.shift_date) !== toDateOnly(observedShift.shift_date)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Зміна була оновлена паралельно; повторіть запит'
            });
        }
        const currentShift = lockedCurrent.shift;
        const saved = await saveHrShiftDayPlan(client, {
            hrShiftId: req.params.id,
            staffId: currentShift.staff_id,
            shiftDate: currentShift.shift_date,
            shiftType: req.body.shift_type ?? req.body.shiftType ?? currentShift.shift_type,
            payload: req.body
        }, {
            actor: req.user?.username || null,
            ipAddress: req.ip,
            auditSource: 'hr.shift.update',
            requireExpectedUpdatedAt: true
        });
        await mirrorHrDayPlanToStaffSchedule(
            saved,
            currentShift.staff_id,
            currentShift.shift_date,
            req.body.note ?? req.body.notes ?? null,
            client
        );
        await reconcileRosterDates(client, [currentShift.shift_date]);
        await auditLog('shift_update', currentShift.staff_id, req.user?.username, {
            ...req.body,
            shift_id: Number(saved.shift?.id) || Number(req.params.id),
            segments_count: saved.plan.segments.length,
            planned_start: saved.plan.plannedStart,
            planned_end: saved.plan.plannedEnd,
            before_plan: auditHrDayPlan(lockedCurrent.plan),
            after_plan: auditHrDayPlan(saved.plan)
        }, req.ip, client);
        await client.query('COMMIT');
        broadcastRosterDates([currentShift.shift_date], req.user?.id);
        res.json({ success: true, data: hrShiftWithDayPlan(saved.shift, saved.plan) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            if (err.code === 'HR_SHIFT_PLAN_STALE') {
                await auditLog('shift_plan_stale_rejected', err.details?.staffId || null, req.user?.username, {
                    outcome: 'rejected',
                    code: err.code,
                    shift_date: err.details?.shiftDate || null,
                    shift_id: err.details?.hrShiftId || Number(req.params.id),
                    expected_updated_at: err.details?.expectedUpdatedAt || null,
                    current_updated_at: err.details?.currentUpdatedAt || null,
                    changes: {}
                }, req.ip).catch(auditError => log.error('HR shift stale rejection audit error', auditError));
            }
            return sendHrShiftPlanError(res, err, { shift_id: Number(req.params.id) });
        }
        if (sendHrMutationFailure(res, err)) return;
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
        const observed = await client.query('SELECT * FROM hr_shifts WHERE id = $1', [req.params.id]);
        if (observed.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        await lockScheduleStaffRows(client, [observed.rows[0].staff_id]);
        const existing = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        if (Number(existing.rows[0].staff_id) !== Number(observed.rows[0].staff_id)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Зміна була оновлена паралельно; повторіть запит'
            });
        }
        const beforeDelete = await loadHrShiftDayPlan(client, { hrShiftId: req.params.id });
        await recordPaidRoleAuditEvents(client, {
            staffId: existing.rows[0].staff_id,
            shiftId: req.params.id,
            shiftDate: existing.rows[0].shift_date,
            beforePlan: beforeDelete?.plan,
            afterPlan: { segments: [] },
            actor: req.user?.username || null,
            ipAddress: req.ip,
            source: 'hr.shift.delete'
        });
        await client.query('DELETE FROM hr_shifts WHERE id = $1', [req.params.id]);
        await removeMirroredStaffSchedule(existing.rows[0].staff_id, existing.rows[0].shift_date, client);
        await reconcileRosterDates(client, [existing.rows[0].shift_date]);
        await auditLog('shift_delete', existing.rows[0].staff_id, req.user?.username,
            {
                shift_id: Number(req.params.id),
                shift_date: existing.rows[0].shift_date,
                before_plan: auditHrDayPlan(beforeDelete?.plan || null),
                after_plan: null
            }, req.ip, client);
        await client.query('COMMIT');
        broadcastRosterDates([existing.rows[0].shift_date], req.user?.id);
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (sendHrMutationFailure(res, err)) return;
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
        const observedPlan = await loadHrShiftDayPlan(client, { hrShiftId: req.params.id });
        if (!observedPlan) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Зміну не знайдено' });
        }
        const observedShift = observedPlan.shift;
        if (Number(observedShift.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого співробітника не потрібна' });
        }

        await lockScheduleStaffRows(client, [observedShift.staff_id, replacementStaffId]);
        const loaded = await loadHrShiftDayPlan(client, { hrShiftId: req.params.id }, { forUpdate: true });
        if (!loaded || Number(loaded.shift.staff_id) !== Number(observedShift.staff_id)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Зміна була оновлена паралельно; повторіть запит' });
        }
        const oldShift = loaded.shift;
        const replacementValidation = await validateShiftWriteStaff(client, replacementStaffId, oldShift.shift_date, {
            forUpdate: false
        });
        if (!replacementValidation.ok) {
            return await rejectUnscheduleableStaff(res, client, replacementValidation, {
                entry: { staff_id: replacementStaffId, shift_date: toDateOnly(oldShift.shift_date), shift_id: req.params.id }
            });
        }
        const replacement = { rows: [replacementValidation.staff] };
        if (!replacement.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Підмінний співробітник неактивний або не існує' });
        }
        await validateHrShiftDayPlanProfessions(client, replacementStaffId, loaded.plan);

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

        await recordPaidRoleAuditEvents(client, {
            staffId: oldShift.staff_id,
            shiftId: req.params.id,
            shiftDate: oldShift.shift_date,
            beforePlan: loaded.plan,
            afterPlan: { segments: [] },
            actor: req.user?.username || null,
            ipAddress: req.ip,
            source: 'hr.shift.replace.old_staff'
        });
        await recordPaidRoleAuditEvents(client, {
            staffId: replacementStaffId,
            shiftId: req.params.id,
            shiftDate: oldShift.shift_date,
            beforePlan: { segments: [] },
            afterPlan: loaded.plan,
            actor: req.user?.username || null,
            ipAddress: req.ip,
            source: 'hr.shift.replace.new_staff'
        });

        const updated = await client.query(
            `UPDATE hr_shifts SET
                original_staff_id = COALESCE(original_staff_id, staff_id),
                staff_id = $1,
                replacement_reason = $2,
                replaced_by = $3,
                replaced_at = NOW(),
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [replacementStaffId, reason, req.user?.username || null, req.params.id]
        );

        await removeMirroredStaffSchedule(oldShift.staff_id, oldShift.shift_date, client);
        await mirrorHrShiftToStaffSchedule(updated.rows[0], client);
        await reconcileRosterDates(client, [oldShift.shift_date]);
        await auditLog('shift_replace', oldShift.staff_id, req.user?.username, {
            shift_id: parseInt(req.params.id),
            replacement_staff_id: replacementStaffId,
            reason,
            before_plan: auditHrDayPlan(loaded.plan),
            after_plan: auditHrDayPlan(loaded.plan)
        }, req.ip, client);
        await client.query('COMMIT');
        broadcastRosterDates([oldShift.shift_date], req.user?.id);

        res.json({
            success: true,
            data: hrShiftWithDayPlan(updated.rows[0], loaded.plan),
            replacement: replacement.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            return sendHrShiftPlanError(res, err, {
                shift_id: Number(req.params.id),
                replacement_staff_id: Number(req.body.replacement_staff_id) || null
            });
        }
        if (sendHrMutationFailure(res, err)) return;
        log.error('POST /hr/shifts/:id/replace error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/shifts/bulk — mass create from template
router.post('/shifts/bulk', requireHrManage, async (req, res) => {
    let failedEntry = null;
    try {
        const { staff_ids, dates, template_id, planned_start, planned_end, break_minutes, shift_type } = req.body;
        const hasSegments = Object.prototype.hasOwnProperty.call(req.body || {}, 'segments');
        const hasLegacyStart = planned_start || req.body.plannedStart || req.body.shiftStart || req.body.shift_start;
        if (!Array.isArray(staff_ids) || !staff_ids.length || !Array.isArray(dates) || !dates.length
            || (!template_id && !hasSegments && !hasLegacyStart)) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_ids, dates та template_id або planned_start/planned_end' });
        }
        const orderedStaffIds = [...new Set(staff_ids.map(Number))].sort((a, b) => a - b);
        const normalizedDateValues = dates.map(normalizeScheduleDate);
        const orderedDates = [...new Set(normalizedDateValues)].sort((a, b) => String(a).localeCompare(String(b)));
        const invalidStaffIds = orderedStaffIds.some(id => !Number.isInteger(id) || id <= 0)
            || orderedStaffIds.length !== staff_ids.length;
        const invalidDates = normalizedDateValues.some(date => !date)
            || dates.some((date, index) => typeof date !== 'string' || date.trim() !== normalizedDateValues[index])
            || orderedDates.length !== dates.length;
        if (invalidStaffIds || invalidDates) {
            return res.status(400).json({
                success: false,
                code: 'HR_SHIFT_BULK_INPUT_INVALID',
                error: 'staff_ids і dates мають містити унікальні валідні значення'
            });
        }
        if (orderedStaffIds.length > HR_SHIFT_BULK_MAX_STAFF
            || orderedDates.length > HR_SHIFT_BULK_MAX_DATES
            || orderedStaffIds.length * orderedDates.length > HR_SHIFT_BULK_MAX_ENTRIES) {
            return res.status(400).json({
                success: false,
                code: 'HR_SHIFT_BULK_CAP_EXCEEDED',
                error: `Bulk підтримує максимум ${HR_SHIFT_BULK_MAX_ENTRIES} записів, ${HR_SHIFT_BULK_MAX_STAFF} працівників і ${HR_SHIFT_BULK_MAX_DATES} дат`
            });
        }

        let start = planned_start ?? req.body.plannedStart ?? req.body.shiftStart ?? req.body.shift_start;
        let end = planned_end ?? req.body.plannedEnd ?? req.body.shiftEnd ?? req.body.shift_end;
        let brk = break_minutes ?? req.body.breakMinutes ?? 0;
        let stype = shift_type ?? req.body.shiftType ?? 'regular';
        if (template_id) {
            const tpl = await pool.query('SELECT * FROM hr_shift_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
            start = tpl.rows[0].planned_start;
            end = tpl.rows[0].planned_end;
            brk = tpl.rows[0].break_minutes;
            stype = tpl.rows[0].shift_type;
        }

        let count = 0;
        const auditEntries = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await lockScheduleStaffRows(client, orderedStaffIds);
            const targetEntries = orderedStaffIds.flatMap(staffId => orderedDates.map(date => ({ staffId, date })));
            const staffCards = await loadStaffScheduleabilityCards(client, orderedStaffIds);
            const previousPlans = await loadHrShiftDayPlansForStaffDates(client, targetEntries);
            const paidRoleValidationContext = dayPlanHasPaidAdditionalRoles(req.body)
                ? await loadPaidRoleValidationContext(client, orderedStaffIds)
                : undefined;
            for (const sid of orderedStaffIds) {
                for (const d of orderedDates) {
                    failedEntry = { staff_id: sid, shift_date: d };
                    const staffRow = staffCards.get(Number(sid)) || null;
                    const shiftValidation = validateStaffScheduleabilityCardForDate(staffRow, d);
                    if (!shiftValidation.ok) {
                        return await rejectUnscheduleableStaff(res, client, shiftValidation, {
                            entry: { staff_id: sid, shift_date: d }
                        });
                    }
                    const payload = {
                        ...req.body,
                        planned_start: start,
                        planned_end: end,
                        break_minutes: brk,
                        shift_type: stype
                    };
                    const beforePlan = previousPlans.get(`${Number(sid)}:${d}`) || null;
                    const saved = await saveHrShiftDayPlan(client, {
                        staffId: sid,
                        shiftDate: d,
                        shiftType: stype,
                        payload
                    }, {
                        actor: req.user?.username || null,
                        ipAddress: req.ip,
                        auditSource: 'hr.shift.bulk',
                        ignoreExpectedUpdatedAt: true,
                        professionCard: professionCardFromStaff(staffRow),
                        paidRoleValidationContext
                    });
                    await mirrorHrDayPlanToStaffSchedule(
                        saved,
                        sid,
                        d,
                        payload.note ?? payload.notes ?? null,
                        client,
                        { staffValidation: shiftValidation }
                    );
                    auditEntries.push({
                        staff_id: Number(sid),
                        shift_date: d,
                        before_plan: auditHrDayPlan(beforePlan?.plan || null),
                        after_plan: auditHrDayPlan(saved.plan)
                    });
                    count++;
                    failedEntry = null;
                }
            }
            await reconcileRosterDates(client, orderedDates);
            await auditLog(
                'shift_bulk',
                null,
                req.user?.username,
                { staff_ids: orderedStaffIds, dates: orderedDates, count, entries: auditEntries },
                req.ip,
                client
            );
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        broadcastRosterDates(orderedDates, req.user?.id);
        res.json({ success: true, count });
    } catch (err) {
        if (isHrShiftPlanError(err)) return sendHrShiftPlanError(res, err, { entry: failedEntry });
        if (sendHrMutationFailure(res, err)) return;
        log.error('POST /hr/shifts/bulk error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/copy-week
router.post('/shifts/copy-week', requireHrManage, async (req, res) => {
    let failedEntry = null;
    try {
        const { source_week, target_week } = req.body;
        if (!source_week || !target_week) {
            return res.status(400).json({ success: false, error: 'Потрібні source_week і target_week' });
        }
        const normalizedSourceWeek = normalizeScheduleDate(source_week);
        const normalizedTargetWeek = normalizeScheduleDate(target_week);
        if (!normalizedSourceWeek || !normalizedTargetWeek
            || String(source_week).trim() !== normalizedSourceWeek
            || String(target_week).trim() !== normalizedTargetWeek) {
            return res.status(400).json({
                success: false,
                code: 'HR_SHIFT_COPY_WEEK_DATE_INVALID',
                error: 'source_week і target_week мають бути валідними календарними датами YYYY-MM-DD'
            });
        }
        const srcDates = scheduleDateSequence(normalizedSourceWeek, HR_SHIFT_COPY_WEEK_DATE_COUNT);
        const tgtDates = scheduleDateSequence(normalizedTargetWeek, HR_SHIFT_COPY_WEEK_DATE_COUNT);

        const source = await pool.query(
            `SELECT hs.*, hs.shift_date::text AS shift_date FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id
             WHERE hs.shift_date >= $1 AND hs.shift_date <= $2
               AND ${scheduleableStaffWhere('s', { dateExpression: 'hs.shift_date' })}`,
            [srcDates[0], srcDates[6]]
        );

        let count = 0;
        const auditEntries = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const orderedSourceRows = [...source.rows].sort((left, right) =>
                Number(left.staff_id) - Number(right.staff_id)
                || String(left.shift_date).localeCompare(String(right.shift_date)));
            const sourceStaffIds = [...new Set(orderedSourceRows.map(row => Number(row.staff_id)).filter(Number.isFinite))]
                .sort((left, right) => left - right);
            if (sourceStaffIds.length > HR_SHIFT_COPY_WEEK_MAX_STAFF) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    code: 'HR_SHIFT_COPY_WEEK_CAP_EXCEEDED',
                    error: `Copy-week підтримує максимум ${HR_SHIFT_COPY_WEEK_MAX_STAFF} працівників`
                });
            }
            await lockScheduleStaffRows(client, sourceStaffIds);
            const freshSource = await client.query(
                `SELECT hs.*, hs.shift_date::text AS shift_date FROM hr_shifts hs
                 JOIN staff s ON s.id = hs.staff_id
                 WHERE hs.shift_date >= $1 AND hs.shift_date <= $2
                   AND ${scheduleableStaffWhere('s', { dateExpression: 'hs.shift_date' })}
                 ORDER BY hs.staff_id, hs.shift_date, hs.id`,
                [srcDates[0], srcDates[6]]
            );
            const lockedStaffIds = new Set(sourceStaffIds);
            if (freshSource.rows.some(row => !lockedStaffIds.has(Number(row.staff_id)))) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'Тиждень-джерело змінився паралельно; повторіть копіювання'
                });
            }
            const freshSourceRows = freshSource.rows;
            const sourcePlans = await hydrateHrShiftDayPlans(client, freshSourceRows);
            const paidRoleValidationContext = sourcePlans.some(loaded => dayPlanHasPaidAdditionalRoles(loaded.plan))
                ? await loadPaidRoleValidationContext(client, sourceStaffIds)
                : undefined;
            const targetEntries = sourcePlans.map(loaded => {
                const sourceDate = toDateOnly(loaded.shift.shift_date);
                const dayIndex = srcDates.indexOf(sourceDate);
                return { staffId: Number(loaded.shift.staff_id), date: dayIndex === -1 ? null : tgtDates[dayIndex] };
            }).filter(entry => entry.date);
            const staffCards = await loadStaffScheduleabilityCards(client, sourceStaffIds);
            const previousPlans = await loadHrShiftDayPlansForStaffDates(client, targetEntries);
            for (const loaded of sourcePlans) {
                const row = loaded.shift;
                const sourceDate = toDateOnly(row.shift_date);
                const dayIndex = srcDates.indexOf(sourceDate);
                if (dayIndex === -1) continue;
                const targetDate = tgtDates[dayIndex];
                failedEntry = { staff_id: row.staff_id, shift_date: targetDate, sourceDate };
                const staffRow = staffCards.get(Number(row.staff_id)) || null;
                const shiftValidation = validateStaffScheduleabilityCardForDate(staffRow, targetDate);
                if (!shiftValidation.ok) {
                    return await rejectUnscheduleableStaff(res, client, shiftValidation, {
                        entry: { staff_id: row.staff_id, shift_date: targetDate, sourceDate }
                    });
                }
                const beforePlan = previousPlans.get(`${Number(row.staff_id)}:${targetDate}`) || null;
                const saved = await saveHrShiftDayPlan(client, {
                    staffId: row.staff_id,
                    shiftDate: targetDate,
                    shiftType: row.shift_type,
                    payload: dayPlanPayload(loaded.plan, {
                        shiftType: row.shift_type,
                        notes: row.notes
                    })
                }, {
                    actor: req.user?.username || null,
                    ipAddress: req.ip,
                    auditSource: 'hr.shift.copy_week',
                    ignoreExpectedUpdatedAt: true,
                    professionCard: professionCardFromStaff(staffRow),
                    paidRoleValidationContext
                });
                await mirrorHrShiftToStaffSchedule(saved.shift, client, {
                    staffValidation: shiftValidation
                });
                auditEntries.push({
                    staff_id: Number(row.staff_id),
                    source_date: sourceDate,
                    target_date: targetDate,
                    before_plan: auditHrDayPlan(beforePlan?.plan || null),
                    after_plan: auditHrDayPlan(saved.plan)
                });
                count++;
                failedEntry = null;
            }
            await reconcileRosterDates(client, tgtDates);
            await auditLog('shift_copy_week', null, req.user?.username, {
                source_week: normalizedSourceWeek,
                target_week: normalizedTargetWeek,
                count,
                entries: auditEntries
            }, req.ip, client);
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        broadcastRosterDates(tgtDates, req.user?.id);
        res.json({ success: true, count });
    } catch (err) {
        if (isHrShiftPlanError(err)) return sendHrShiftPlanError(res, err, { entry: failedEntry });
        if (sendHrMutationFailure(res, err)) return;
        log.error('POST /hr/shifts/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CLOCK IN / CLOCK OUT
// ==========================================

// POST /api/hr/attendance-documents/pdf — private server-owned HR form generation.
router.post('/attendance-documents/pdf', requireRole(...HR_VIEW_ROLES), async (req, res) => {
    const safeContext = {
        templateId: String(req.body?.templateId || '').slice(0, 32),
        rosterMode: String(req.body?.rosterMode || '').slice(0, 32),
        categoryCount: Array.isArray(req.body?.categoryIds) ? req.body.categoryIds.length : 0
    };
    try {
        const snapshot = await buildHrAttendanceDocumentSnapshot(pool, req.body || {});
        const buffer = await buildHrAttendanceDocumentPdfBuffer(snapshot);
        const filename = hrAttendanceDocumentPdfFilename(snapshot);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store, private, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Content-Type-Options': 'nosniff'
        });
        res.send(buffer);
    } catch (err) {
        const status = Number(err.statusCode) === 400 ? 400 : 500;
        if (status === 500) {
            log.error('POST /hr/attendance-documents/pdf error', {
                code: err.code || 'HR_ATTENDANCE_DOCUMENT_PDF_ERROR',
                ...safeContext
            });
        }
        res.status(status).json({
            success: false,
            code: err.code || 'HR_ATTENDANCE_DOCUMENT_PDF_ERROR',
            error: status === 400
                ? err.message
                : 'Не вдалося сформувати HR PDF'
        });
    }
});

function sendHrAttendanceAutomationError(res, err) {
    const status = [400, 404, 409, 410].includes(Number(err.statusCode)) ? Number(err.statusCode) : 500;
    if (status === 500) {
        log.error('HR attendance document automation error', {
            code: err.code || 'HR_ATTENDANCE_AUTOMATION_ERROR'
        });
    }
    return res.status(status).json({
        success: false,
        code: err.code || 'HR_ATTENDANCE_AUTOMATION_ERROR',
        error: status === 500 ? 'Не вдалося виконати операцію з HR-документом' : err.message
    });
}

router.get('/attendance-document-automations', async (_req, res) => {
    try {
        res.json({ success: true, automations: await listHrAttendanceDocumentAutomations(pool) });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.post('/attendance-document-automations', requireHrManage, async (req, res) => {
    try {
        const automation = await createHrAttendanceDocumentAutomation(req.body || {}, req.user, pool);
        res.status(201).json({ success: true, automation });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.patch('/attendance-document-automations/:id', requireHrManage, async (req, res) => {
    try {
        const automation = await updateHrAttendanceDocumentAutomation(req.params.id, req.body || {}, req.user, pool);
        res.json({ success: true, automation });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.post('/attendance-document-automations/:id/disable', requireHrManage, async (req, res) => {
    try {
        const automation = await disableHrAttendanceDocumentAutomation(req.params.id, req.user, pool);
        res.json({ success: true, automation });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.post('/attendance-document-automations/:id/run', requireHrManage, async (req, res) => {
    try {
        const job = await runHrAttendanceDocumentAutomation(req.params.id, req.user, {}, pool);
        res.status(job?.status === 'queued' ? 201 : 200).json({ success: true, job });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.get('/attendance-document-jobs', async (req, res) => {
    try {
        const jobs = await listHrAttendanceDocumentJobs({ limit: req.query.limit }, pool);
        res.json({ success: true, jobs });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.get('/attendance-document-jobs/:id/pdf', async (req, res) => {
    try {
        const artifact = await getHrAttendanceDocumentJobPdf(req.params.id, pool);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${artifact.filename || `hr-attendance-${req.params.id}.pdf`}"`,
            'Cache-Control': 'no-store, private, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Content-Type-Options': 'nosniff',
            'X-Document-SHA256': artifact.sha256 || ''
        });
        res.send(artifact.buffer);
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.post('/attendance-document-jobs/:id/cancel', requireHrManage, async (req, res) => {
    try {
        res.json({ success: true, job: await cancelHrAttendanceDocumentJob(req.params.id, pool) });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

router.post('/attendance-document-jobs/:id/requeue', requireHrManage, async (req, res) => {
    try {
        res.json({ success: true, job: await requeueHrAttendanceDocumentJob(req.params.id, pool) });
    } catch (err) {
        sendHrAttendanceAutomationError(res, err);
    }
});

// GET /api/hr/today — dashboard
router.get('/today', async (req, res) => {
    try {
        const today = todayKyiv();
        const staff = await pool.query(
            `SELECT id, name, department, position, color, role_type, company_structure_node_id, photo_url, birth_date,
                    (
                        birth_date IS NOT NULL
                        AND EXTRACT(MONTH FROM birth_date::date) = EXTRACT(MONTH FROM $1::date)
                        AND EXTRACT(DAY FROM birth_date::date) = EXTRACT(DAY FROM $1::date)
                    ) AS is_birthday_today
             FROM staff
             WHERE ${scheduleableStaffWhere('staff', { dateExpression: '$1' })}
             ORDER BY department, name`,
            [today]
        );

        const shifts = await pool.query(
            'SELECT * FROM hr_shifts WHERE shift_date = $1', [today]
        );
        const hydratedShifts = await hydrateHrShiftDayPlans(pool, shifts.rows);
        const shiftMap = {};
        for (const snapshot of hydratedShifts) shiftMap[snapshot.shift.staff_id] = snapshot;

        const records = await pool.query(
            'SELECT * FROM hr_time_records WHERE record_date = $1', [today]
        );
        const recordMap = {};
        for (const r of records.rows) recordMap[r.staff_id] = r;

        const displayGroupContext = await loadStaffDisplayGroupContext(pool);
        const data = staff.rows.map(s => {
            const displayStaff = decorateStaffWithDisplayGroup(s, { displayGroupContext });
            const shiftSnapshot = shiftMap[s.id] || null;
            const shift = shiftSnapshot?.shift || null;
            const record = recordMap[s.id]
                ? decorateAttendanceRecord(recordMap[s.id], shiftSnapshot)
                : null;

            return {
                staff_id: s.id,
                staff_name: s.name,
                department: s.department,
                company_structure_node_id: s.company_structure_node_id,
                display_group: displayStaff.display_group,
                display_group_label: displayStaff.display_group_label,
                displayGroup: displayStaff.displayGroup,
                displayGroupLabel: displayStaff.displayGroupLabel,
                position: s.position,
                staff_color: s.color,
                role_type: s.role_type,
                photo_url: s.photo_url,
                birth_date: s.birth_date,
                has_photo: Boolean(String(s.photo_url || '').trim()),
                is_birthday_today: Boolean(s.is_birthday_today),
                shift: shift ? {
                    planned_start: shift.planned_start,
                    planned_end: shift.planned_end,
                    shift_type: shift.shift_type,
                    primary_profession_key: shiftSnapshot.plan.primaryProfessionKey,
                    planned_minutes: shiftSnapshot.plan.plannedMinutes,
                    segments: shiftSnapshot.plan.segments
                } : null,
                record: record ? {
                    id: record.id,
                    clock_in: record.clock_in,
                    clock_out: record.clock_out,
                    planned_start: record.planned_start,
                    planned_end: record.planned_end,
                    status: record.status,
                    late_minutes: record.late_minutes,
                    early_leave_minutes: record.early_leave_minutes,
                    overtime_minutes: record.overtime_minutes,
                    total_worked_minutes: record.total_worked_minutes,
                    auto_closed: record.auto_closed,
                    segment_allocations: record.segment_allocations,
                    plannedMinutes: record.plannedMinutes,
                    actualMinutes: record.actualMinutes,
                    overtimeMinutes: record.overtimeMinutes,
                    allocationOvertimeMinutes: record.allocationOvertimeMinutes,
                    allocation_overtime_minutes: record.allocation_overtime_minutes,
                    allocation_source: record.allocation_source,
                    allocation_issues: record.allocation_issues,
                    overtime_allocation: record.overtime_allocation,
                    compensation_snapshot: record.compensation_snapshot,
                    compensation_allocations: record.compensation_allocations,
                    compensation_issues: record.compensation_issues,
                    compensation_manual_review: record.compensation_manual_review,
                    is_late: record.is_late,
                    is_early_leave: record.is_early_leave,
                    has_overtime: record.has_overtime,
                    plan_source: record.plan_source,
                    plan_warning: record.plan_warning,
                    attendance_facts: record.attendance_facts
                } : null
            };
        });
        const summary = summarizeHrTodayItems(data);

        res.json({
            success: true,
            date: today,
            data,
            displayGroups: listStaffDisplayGroups(),
            summary
        });
    } catch (err) {
        log.error('GET /hr/today error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/qa/multi-segment/capabilities — read-only preflight for the explicit live QA runner.
router.get('/qa/multi-segment/capabilities', requireRole('creator', 'director'), (req, res) => {
    res.json({
        success: true,
        fixtureVersion: LIVE_MULTI_SEGMENT_QA_VERSION,
        confirmationRequired: true,
        confirmationHeader: 'x-eventgenix-live-qa-confirmation',
        createsBookings: false,
        createsFinanceTransactions: false,
        payrollMode: 'preview_only'
    });
});

// GET /api/hr/qa/multi-segment/:runId — read-only cleanup verification for one disposable staff fixture.
router.get('/qa/multi-segment/:runId', requireRole('creator', 'director'), async (req, res) => {
    try {
        const runId = normalizeLiveQaRunId(req.params.runId);
        if (!runId) {
            return res.status(400).json({ success: false, code: 'LIVE_QA_RUN_ID_INVALID', error: 'valid runId is required' });
        }
        const status = await loadLiveQaFixtureStatus(pool, req.query.staffId ?? req.query.staff_id, runId);
        res.json({ success: true, data: status });
    } catch (error) {
        return sendLiveQaError(res, error);
    }
});

// POST /api/hr/qa/multi-segment/attendance — create one marker-bound attendance row for a disposable QA staff member.
router.post('/qa/multi-segment/attendance', requireRole('creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    try {
        assertLiveQaConfirmation(liveQaConfirmationFromRequest(req));
        const runId = normalizeLiveQaRunId(req.body?.runId ?? req.body?.run_id);
        if (!runId) {
            return res.status(400).json({ success: false, code: 'LIVE_QA_RUN_ID_INVALID', error: 'valid runId is required' });
        }
        const staffId = Number(req.body?.staffId ?? req.body?.staff_id);
        const date = normalizeScheduleDate(req.body?.date);
        const clockInTime = normalizeLiveQaTime(req.body?.clockInTime ?? req.body?.clock_in_time);
        const clockOutTime = normalizeLiveQaTime(req.body?.clockOutTime ?? req.body?.clock_out_time);
        if (!date || !clockInTime || !clockOutTime) {
            return res.status(400).json({
                success: false,
                code: 'LIVE_QA_ATTENDANCE_INVALID',
                error: 'valid date, clockInTime and clockOutTime are required'
            });
        }

        await client.query('BEGIN');
        await lockAttendanceWriteTarget(client, { staffId, date });
        const staff = await loadLiveQaStaff(client, staffId, runId, { forUpdate: true });
        if (staff.is_active === false) {
            const error = new Error('disposable QA staff is already archived');
            error.code = 'LIVE_QA_STAFF_ARCHIVED';
            error.status = 409;
            throw error;
        }
        const loadedShift = await loadHrShiftDayPlan(client, { staffId: staff.id, shiftDate: date }, { forUpdate: true });
        if (!loadedShift?.plan?.segments?.length) {
            const error = new Error('a canonical segment plan is required before attendance fixture creation');
            error.code = 'LIVE_QA_PLAN_REQUIRED';
            error.status = 409;
            throw error;
        }
        const existing = await client.query(
            'SELECT id FROM hr_time_records WHERE staff_id = $1 AND record_date = $2 FOR UPDATE',
            [staff.id, date]
        );
        if (existing.rows.length) {
            const error = new Error('attendance fixture already exists for this staff/date');
            error.code = 'LIVE_QA_ATTENDANCE_EXISTS';
            error.status = 409;
            throw error;
        }
        const timestamps = await client.query(
            `SELECT (($1::date + $2::time) AT TIME ZONE 'Europe/Kyiv') AS clock_in,
                    (($1::date + $3::time) AT TIME ZONE 'Europe/Kyiv') AS clock_out`,
            [date, clockInTime, clockOutTime]
        );
        const clockIn = timestamps.rows[0]?.clock_in;
        const clockOut = timestamps.rows[0]?.clock_out;
        if (!(clockIn instanceof Date) || !(clockOut instanceof Date) || clockOut <= clockIn) {
            const error = new Error('attendance interval must end after it starts');
            error.code = 'LIVE_QA_ATTENDANCE_INTERVAL_INVALID';
            error.status = 400;
            throw error;
        }
        const marker = liveQaMarker(runId);
        await recordAttendanceClockIn(client, {
            staffId: staff.id,
            recordDate: date,
            now: clockIn,
            businessContext: hrBusinessContextFromRequest(req),
            performedBy: req.user?.username || 'live_multi_segment_qa',
            method: 'live_multi_segment_qa',
            source: marker,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });
        const clockOutResult = await recordAttendanceClockOut(client, {
            staffId: staff.id,
            recordDate: date,
            now: clockOut,
            settlementMode: 'actual_time',
            performedBy: req.user?.username || 'live_multi_segment_qa',
            method: 'live_multi_segment_qa',
            source: marker,
            ip: req.ip
        });
        const attendanceRecord = clockOutResult.record;
        if (!attendanceRecord) {
            const error = new Error('canonical attendance fixture creation returned no record');
            error.code = 'LIVE_QA_ATTENDANCE_WRITE_FAILED';
            error.status = 500;
            throw error;
        }
        await auditLog('live_multi_segment_qa_attendance_create', staff.id, req.user?.username, {
            run_id: runId,
            attendance_id: Number(attendanceRecord.id) || null,
            date,
            planned_minutes: Number(attendanceRecord.plannedMinutes ?? attendanceRecord.planned_minutes) || 0,
            actual_minutes: Number(attendanceRecord.actualMinutes ?? attendanceRecord.actual_minutes) || 0,
            allocation_source: attendanceRecord.allocation_source || null,
            compensation_snapshot_state: attendanceRecord.compensation_snapshot?.state || null
        }, req.ip, client);
        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            data: attendanceRecord
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return sendLiveQaError(res, error);
    } finally {
        client.release();
    }
});

// DELETE /api/hr/qa/multi-segment/:runId — transactional cleanup restricted to the exact disposable staff marker.
router.delete('/qa/multi-segment/:runId', requireRole('creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    let affectedDates = [];
    try {
        assertLiveQaConfirmation(liveQaConfirmationFromRequest(req));
        const runId = normalizeLiveQaRunId(req.params.runId);
        if (!runId) {
            return res.status(400).json({ success: false, code: 'LIVE_QA_RUN_ID_INVALID', error: 'valid runId is required' });
        }
        const staffId = Number(req.body?.staffId ?? req.body?.staff_id);
        await client.query('BEGIN');
        await lockAttendanceWriteMaintenance(client);
        const staff = await loadLiveQaStaff(client, staffId, runId, { forUpdate: true });
        const before = await loadLiveQaFixtureStatus(client, staff.id, runId);
        affectedDates = [...new Set([
            ...(await client.query('SELECT shift_date::text AS date FROM hr_shifts WHERE staff_id = $1', [staff.id])).rows.map(row => row.date),
            ...(await client.query('SELECT date::text AS date FROM staff_schedule WHERE staff_id = $1', [staff.id])).rows.map(row => row.date)
        ])].filter(Boolean).sort();

        await client.query('DELETE FROM hr_time_records WHERE staff_id = $1', [staff.id]);
        await client.query('DELETE FROM staff_checkins WHERE staff_id = $1', [staff.id]);
        await client.query('DELETE FROM hr_shifts WHERE staff_id = $1', [staff.id]);
        await client.query('DELETE FROM staff_schedule WHERE staff_id = $1', [staff.id]);
        await client.query('DELETE FROM staff_shift_preferences WHERE staff_id = $1', [staff.id]);
        await reconcileRosterDates(client, affectedDates);
        await client.query(
            `UPDATE staff
             SET is_active = false,
                 hr_pool_status = CASE WHEN hr_pool_status = 'blacklisted' THEN 'blacklisted' ELSE 'reserve' END,
                 termination_date = COALESCE(termination_date, CURRENT_DATE),
                 termination_recorded_at = COALESCE(termination_recorded_at, NOW()),
                 termination_recorded_by = COALESCE(termination_recorded_by, $2),
                 termination_reason = COALESCE(termination_reason, $3)
             WHERE id = $1`,
            [staff.id, req.user?.username || null, `Disposable live QA cleanup ${runId}`]
        );
        await auditLog('live_multi_segment_qa_cleanup', staff.id, req.user?.username, {
            run_id: runId,
            before_counts: before.counts,
            fixture_ids: before.fixtureIds,
            affected_dates: affectedDates,
            staff_archived: true
        }, req.ip, client);
        await client.query('COMMIT');
        broadcastRosterDates(affectedDates, req.user?.id);
        const after = await loadLiveQaFixtureStatus(pool, staff.id, runId);
        if (!after.confirmedClean) {
            const error = new Error('cleanup verification failed; inspect returned fixture IDs');
            error.code = 'LIVE_QA_CLEANUP_UNCONFIRMED';
            error.status = 500;
            error.details = after;
            throw error;
        }
        res.json({ success: true, data: { before, after } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return sendLiveQaError(res, error);
    } finally {
        client.release();
    }
});

// POST /api/hr/clock-in
router.post('/clock-in', requireHrManage, async (req, res) => {
    const staffId = Number(req.body?.staff_id);
    if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647) {
        return res.status(400).json({ success: false, error: 'Потрібен staff_id' });
    }
    const client = await pool.connect();
    try {
        const today = todayKyiv();
        const businessContext = hrBusinessContextFromRequest(req);
        await client.query('BEGIN');
        await lockAttendanceWriteTarget(client, { staffId, date: today });
        const clockInResult = await recordAttendanceClockIn(client, {
            staffId,
            recordDate: today,
            businessContext,
            performedBy: req.user?.username || 'manual',
            method: 'manual',
            source: 'hr_today',
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            data: clockInResult.record,
            alreadyClockedIn: clockInResult.alreadyClockedIn,
            planSource: clockInResult.planSource
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/clock-in error', err);
        if (sendHrMutationFailure(res, err)) return;
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/clock-out
router.post('/clock-out', requireHrManage, async (req, res) => {
    const staffId = Number(req.body?.staff_id);
    if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647) {
        return res.status(400).json({ success: false, error: 'Потрібен staff_id' });
    }
    const client = await pool.connect();
    try {
        const { settlement_mode, settlementMode } = req.body;

        const today = todayKyiv();
        await client.query('BEGIN');
        await lockAttendanceWriteTarget(client, { staffId, date: today });
        const clockOutResult = await recordAttendanceClockOut(client, {
            staffId,
            recordDate: today,
            settlementMode: settlement_mode || settlementMode,
            performedBy: req.user?.username || 'manual',
            method: 'manual',
            source: 'hr_today',
            ip: req.ip
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            data: clockOutResult.record,
            alreadyClockedOut: clockOutResult.alreadyClockedOut,
            planSource: clockOutResult.planSource
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/clock-out error', err);
        if (err?.code === 'ATTENDANCE_CLOCK_IN_REQUIRED') {
            return res.status(err.statusCode || 400).json({ success: false, code: err.code, error: err.message });
        }
        if (sendHrMutationFailure(res, err)) return;
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/mark-absent — mark sick/vacation/day_off
router.post('/mark-absent', requireHrManage, async (req, res) => {
    const staffId = Number(req.body?.staff_id);
    const { status, notes } = req.body || {};
    if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647 || !status) {
        return res.status(400).json({ success: false, error: 'Потрібні staff_id та status' });
    }
    const validStatuses = ['sick', 'vacation', 'day_off'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Невалідний статус' });
    }
    const client = await pool.connect();
    try {
        const today = todayKyiv();
        await client.query('BEGIN');
        await lockAttendanceWriteTarget(client, { staffId, date: today });
        const result = await recordAttendanceStatus(client, {
            staffId,
            recordDate: today,
            status,
            notes,
            businessContext: businessContextFromRequest(req),
            performedBy: req.user?.username,
            source: 'hr_mark_absent',
            ip: req.ip
        });

        await auditLog('mark_absent', staffId, req.user?.username, { status, notes }, req.ip, client);
        await client.query('COMMIT');
        res.json({ success: true, data: result.record });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/mark-absent error', err);
        if (err?.code === 'ATTENDANCE_STATUS_CONFLICT') {
            return res.status(err.statusCode || 409).json({ success: false, code: err.code, error: err.message });
        }
        if (sendHrMutationFailure(res, err)) return;
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// ==========================================
// CORRECTION (admin only)
// ==========================================

router.put('/records/:id/correct', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            clock_in,
            clock_out,
            clock_in_time,
            clock_out_time,
            settlement_mode,
            settlementMode,
            notes
        } = req.body;
        const correctionReason = String(notes || '').trim();
        if (!correctionReason) {
            return res.status(400).json({
                success: false,
                code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED',
                error: 'Причина корекції обов’язкова'
            });
        }
        await client.query('BEGIN');

        // Resolve the advisory-lock target before taking the row lock so all
        // attendance writers keep the same lock ordering.
        const target = await client.query(
            'SELECT staff_id, record_date::text AS record_date FROM hr_time_records WHERE id = $1',
            [req.params.id]
        );
        if (target.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }

        await lockAttendanceWriteTarget(client, {
            staffId: target.rows[0].staff_id,
            date: target.rows[0].record_date
        });

        const rec = await client.query(
            'SELECT * FROM hr_time_records WHERE id = $1 FOR UPDATE',
            [req.params.id]
        );
        if (rec.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }

        const original = rec.rows[0];
        const compensationBefore = parseAttendanceCompensationSnapshot(original.compensation_snapshot);
        const snapshotPlan = attendancePlanFromCompensationSnapshot(compensationBefore);
        const loadedShift = snapshotPlan
            ? null
            : await loadHrShiftDayPlan(client, {
                staffId: original.staff_id,
                shiftDate: original.record_date
            });
        const shiftRow = loadedShift?.shift || {};
        const plannedStart = snapshotPlan?.plannedStart || original.planned_start || shiftRow.planned_start || null;
        const plannedEnd = snapshotPlan?.plannedEnd || original.planned_end || shiftRow.planned_end || null;
        const calculationPlan = snapshotPlan
            ? {
                primaryProfessionKey: snapshotPlan.professionKey || null,
                plannedStart: snapshotPlan.plannedStart,
                plannedEnd: snapshotPlan.plannedEnd,
                segments: snapshotPlan.segments || []
            }
            : loadedShift?.plan;
        const calculationPlannedMinutes = Array.isArray(calculationPlan?.segments)
            ? calculationPlan.segments.reduce(
                (sum, segment) => sum + Math.max(0, Number(segment.plannedMinutes || 0)),
                0
            )
            : null;
        const normalizeCorrectionTime = value => {
            const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
            if (!match) return null;
            const hour = Number(match[1]);
            const minute = Number(match[2]);
            return hour <= 23 && minute <= 59 ? `${match[1]}:${match[2]}` : null;
        };
        const localTimestamp = async (time, dayOffset = 0) => {
            const timestamp = await client.query(
                `SELECT (($1::date + $2::time + ($3::int * INTERVAL '1 day')) AT TIME ZONE 'Europe/Kyiv') AS value`,
                [original.record_date, time, dayOffset]
            );
            return timestamp.rows[0]?.value || null;
        };
        const inputClockInTime = clock_in_time === undefined ? null : normalizeCorrectionTime(clock_in_time);
        const inputClockOutTime = clock_out_time === undefined ? null : normalizeCorrectionTime(clock_out_time);
        if ((clock_in_time !== undefined && !inputClockInTime) || (clock_out_time !== undefined && !inputClockOutTime)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Час має бути у форматі HH:MM' });
        }

        let newClockIn = original.clock_in;
        let newClockOut = original.clock_out;
        if (inputClockInTime) newClockIn = await localTimestamp(inputClockInTime);
        else if (clock_in) newClockIn = new Date(clock_in);
        if (inputClockOutTime) newClockOut = await localTimestamp(inputClockOutTime);
        else if (clock_out) newClockOut = new Date(clock_out);
        if ((newClockIn && Number.isNaN(new Date(newClockIn).getTime()))
            || (newClockOut && Number.isNaN(new Date(newClockOut).getTime()))) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Некоректна дата або час' });
        }
        const isOvernightPlan = plannedStart && plannedEnd
            && timeToMinutes(plannedEnd) <= timeToMinutes(plannedStart);
        if (inputClockOutTime && newClockIn && new Date(newClockOut) <= new Date(newClockIn) && isOvernightPlan) {
            newClockOut = await localTimestamp(inputClockOutTime, 1);
        }
        if (newClockIn && newClockOut && new Date(newClockOut) <= new Date(newClockIn)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Час виходу має бути пізніше часу приходу' });
        }
        newClockIn = newClockIn ? new Date(newClockIn).toISOString() : null;
        newClockOut = newClockOut ? new Date(newClockOut).toISOString() : null;

        const settlementAudit = await client.query(
            `SELECT details->>'settlement_mode' AS settlement_mode
             FROM hr_audit_log
             WHERE action = 'clock_out' AND staff_id = $1
               AND (details->>'record_id' = $2 OR details->>'clock_out' = $3)
             ORDER BY id DESC LIMIT 1`,
            [original.staff_id, String(original.id), original.clock_out ? new Date(original.clock_out).toISOString() : '']
        );
        const correctionSettlementMode = settlement_mode
            || settlementMode
            || settlementAudit.rows[0]?.settlement_mode
            || 'actual_time';
        let effectiveSettlementMode = correctionSettlementMode;

        // Recalculate from the immutable attendance plan; legacy rows use base-only current-plan fallback.
        let totalWorked = 0, lateMin = 0, earlyLeave = 0, overtime = 0;
        let status = original.status || 'present';
        let compensationAfter = compensationBefore;
        if (newClockIn && newClockOut) {
            const payroll = calculateHrClockOutPayroll(original, {
                clockIn: newClockIn,
                clockOut: newClockOut,
                breakMinutes: shiftRow.break_minutes || 0,
                plannedStart,
                plannedEnd,
                scheduledWorkedMinutes: calculationPlannedMinutes || calculationPlan?.plannedMinutes,
                plan: calculationPlan,
                primaryProfessionKey: calculationPlan?.primaryProfessionKey || shiftRow.profession_key,
                recordDate: original.record_date,
                settlementMode: correctionSettlementMode
            });
            totalWorked = payroll.totalWorkedMinutes;
            lateMin = payroll.lateMinutes;
            earlyLeave = payroll.earlyLeaveMinutes;
            overtime = payroll.overtimeMinutes;
            status = payroll.status;
            effectiveSettlementMode = payroll.settlementMode;
            const compensationBase = compensationBefore
                || buildLegacyAttendanceCompensationSnapshot({
                    staffId: original.staff_id,
                    recordDate: original.record_date,
                    plan: {
                        ...(calculationPlan || {}),
                        professionKey: calculationPlan?.primaryProfessionKey || shiftRow.profession_key,
                        source: 'attendance_snapshot'
                    },
                    planSource: 'attendance_snapshot',
                    capturedAt: original.clock_in || newClockIn
                });
            compensationAfter = finalizeAttendanceCompensationSnapshot(
                compensationBase,
                payroll.allocation,
                {
                    finalizedAt: newClockOut,
                    correctedAt: new Date()
                }
            );
            if (compensationAfter.manualReview) status = 'manual_review';
        } else if (newClockIn) {
            const arrival = calculateAttendanceClockIn({
                source: plannedStart && plannedEnd ? 'attendance_snapshot' : 'unscheduled',
                plannedStart,
                plannedEnd
            }, newClockIn, original.record_date);
            lateMin = arrival.lateMinutes;
            status = arrival.status;
            compensationAfter = compensationBefore
                ? { ...compensationBefore, correctedAt: new Date().toISOString() }
                : buildLegacyAttendanceCompensationSnapshot({
                    staffId: original.staff_id,
                    recordDate: original.record_date,
                    plan: {
                        ...(calculationPlan || {}),
                        professionKey: calculationPlan?.primaryProfessionKey || shiftRow.profession_key,
                        source: 'attendance_snapshot'
                    },
                    planSource: 'attendance_snapshot',
                    capturedAt: original.clock_in || newClockIn
                });
        }

        const result = await client.query(
            `UPDATE hr_time_records SET
                clock_in = $1, clock_out = $2,
                total_worked_minutes = $3, late_minutes = $4, early_leave_minutes = $5, overtime_minutes = $6,
                status = $7,
                original_clock_in = COALESCE(original_clock_in, $8),
                original_clock_out = COALESCE(original_clock_out, $9),
                corrected_by = $10, corrected_at = NOW(), correction_reason = $11,
                compensation_snapshot = $12::jsonb, updated_at = NOW()
             WHERE id = $13 RETURNING *`,
            [newClockIn, newClockOut, totalWorked, lateMin, earlyLeave, overtime, status,
             original.clock_in, original.clock_out, req.user?.username, correctionReason,
             JSON.stringify(compensationAfter), req.params.id]
        );

        await auditLog('correction', original.staff_id, req.user?.username,
            {
                record_id: original.id,
                old_clock_in: original.clock_in,
                old_clock_out: original.clock_out,
                new_clock_in: newClockIn,
                new_clock_out: newClockOut,
                late_minutes: lateMin,
                early_leave_minutes: earlyLeave,
                overtime_minutes: overtime,
                total_worked_minutes: totalWorked,
                settlement_mode: effectiveSettlementMode,
                correction_reason: correctionReason,
                compensation_snapshot_before: compensationBefore,
                compensation_snapshot_after: compensationAfter
            }, req.ip, client);
        await auditLog('compensation_snapshot_corrected', original.staff_id, req.user?.username, {
            eventVersion: 1,
            recordId: original.id,
            recordDate: toDateOnly(original.record_date),
            correctionReason,
            compensationSnapshotBefore: compensationBefore,
            compensationSnapshotAfter: compensationAfter
        }, req.ip, client);
        await client.query('COMMIT');
        res.json({
            success: true,
            data: decorateAttendanceRecord({
                ...result.rows[0],
                compensation_snapshot: result.rows[0].compensation_snapshot || compensationAfter
            }, loadedShift)
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/records/:id/correct error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
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
            `SELECT id, name, role_type, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit
             FROM staff
             WHERE ${scheduleableStaffWhere('staff')}
             ORDER BY name`
        );
        const reportStaffIds = staffList.rows.map(st => st.id);
        const [professionRateMap, activeSchemeMap] = await Promise.all([
            loadStaffProfessionRateMap(reportStaffIds),
            loadActivePayrollSchemeMap(reportStaffIds, dateFrom.slice(0, 7))
        ]);

        const shifts = await pool.query(
            'SELECT staff_id, COUNT(*) AS cnt FROM hr_shifts WHERE shift_date >= $1 AND shift_date <= $2 GROUP BY staff_id',
            [dateFrom, dateTo]
        );
        const shiftCounts = {};
        for (const r of shifts.rows) shiftCounts[r.staff_id] = parseInt(r.cnt);

        const records = await pool.query(
            `SELECT tr.staff_id, tr.record_date, tr.clock_in, tr.clock_out,
                    tr.planned_start, tr.planned_end,
                    COALESCE(hs.profession_key, s.role_type) AS profession_key,
                    tr.status, tr.late_minutes, tr.early_leave_minutes, tr.overtime_minutes, tr.total_worked_minutes,
                    CASE
                        WHEN hs.id IS NOT NULL THEN 'hr_shift'
                        WHEN tr.planned_start IS NOT NULL AND tr.planned_end IS NOT NULL THEN 'profession_card'
                        ELSE 'unscheduled'
                    END AS plan_source
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date >= $1 AND tr.record_date <= $2`,
            [dateFrom, dateTo]
        );
        const payrollAttendanceMetrics = await loadPayrollAttendanceMetrics({
            from: dateFrom,
            to: dateTo,
            staffIds: staffList.rows.map(staff => staff.id)
        });

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
                    total_worked_minutes: 0, total_early_leave_minutes: 0, total_overtime_minutes: 0,
                    profession_card_days: 0, unscheduled_days: 0,
                    late_count: 0, total_late_minutes: 0
                };
            }
            const s = statsMap[r.staff_id];
            const facts = attendanceFactMinutes(r);
            if (r.clock_in) {
                s.days_worked++;
                s.total_worked_minutes += r.total_worked_minutes || 0;
                s.total_overtime_minutes += facts.overtimeMinutes;
            }
            if (facts.lateMinutes > 0) { s.days_late++; s.late_count++; s.total_late_minutes += facts.lateMinutes; }
            if (facts.earlyLeaveMinutes > 0) {
                s.days_early_leave++;
                s.total_early_leave_minutes += facts.earlyLeaveMinutes;
            }
            if (r.plan_source === 'profession_card') s.profession_card_days++;
            if (r.plan_source === 'unscheduled') s.unscheduled_days++;
            if (r.status === 'absent' || r.status === 'no_show') s.days_absent++;
            if (r.status === 'sick') s.days_sick++;
            if (r.status === 'vacation') s.days_vacation++;
        }

        const data = staffList.rows.map(st => {
            const s = statsMap[st.id] || {
                days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                days_sick: 0, days_vacation: 0, total_worked_minutes: 0, total_early_leave_minutes: 0, total_overtime_minutes: 0,
                profession_card_days: 0, unscheduled_days: 0,
                late_count: 0, total_late_minutes: 0
            };
            const daysScheduled = shiftCounts[st.id] || 0;
            const totalWorkedHours = Math.round(s.total_worked_minutes / 60 * 10) / 10;
            const totalOvertimeHours = Math.round(s.total_overtime_minutes / 60 * 10) / 10;
            const rate = parseFloat(st.hourly_rate) || 0;
            const rateUnit = staffRateUnit(st);
            const taskKpi = taskKpiMap[st.id] || { tasks_assigned: 0, tasks_done: 0, tasks_overdue: 0 };
            const payrollMetrics = payrollAttendanceMetrics.get(Number(st.id)) || {
                totalMinutes: 0,
                allocatedMinutes: 0,
                plannedMinutes: 0,
                overtimeMinutes: 0,
                hoursWorked: 0,
                overtimeHours: 0,
                daysWorked: 0,
                professionAllocations: [],
                overtimeAllocations: [],
                primaryDays: [],
                attendanceDays: [],
                allocationIssues: [],
                reconciliation: { days: [], warnings: [] }
            };
            const fallbackScheme = {
                schemeType: rateUnit === 'month' ? 'monthly_fixed' : (rateUnit === 'day' ? 'per_shift' : 'hourly'),
                config: {},
                isFallback: true
            };
            const professionPay = calculateProfessionPay({
                id: Number(st.id),
                roleType: st.role_type,
                hourlyRate: rate,
                rateUnit
            }, activeSchemeMap.get(Number(st.id)) || fallbackScheme, payrollMetrics, professionRateMap);
            const estimatedSalary = professionPay.totalAmount;
            const payrollRateUnit = professionPay.rateUnit || rateUnit;

            return {
                staff_id: st.id,
                staff_name: st.name,
                role_type: st.role_type,
                hourly_rate: rate,
                rate_unit: payrollRateUnit,
                days_scheduled: daysScheduled,
                days_worked: s.days_worked,
                days_late: s.days_late,
                days_early_leave: s.days_early_leave,
                total_early_leave_minutes: s.total_early_leave_minutes,
                days_absent: s.days_absent,
                days_sick: s.days_sick,
                days_vacation: s.days_vacation,
                total_worked_hours: totalWorkedHours,
                total_overtime_hours: totalOvertimeHours,
                profession_card_days: s.profession_card_days,
                unscheduled_days: s.unscheduled_days,
                plan_warning_count: s.profession_card_days + s.unscheduled_days,
                estimated_salary: Math.round(estimatedSalary),
                profession_rate_summary: professionPay.professionRateSummary,
                allocation_issues: professionPay.allocationIssues,
                reconciliation: professionPay.reconciliation,
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
        const data = await hydrateAttendanceRecords(pool, result.rows);
        res.json({ success: true, data, date });
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
                    s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit,
                    COALESCE(hs.profession_key, s.role_type) AS profession_key,
                    CASE
                        WHEN hs.id IS NOT NULL THEN 'hr_shift'
                        WHEN tr.planned_start IS NOT NULL AND tr.planned_end IS NOT NULL THEN 'profession_card'
                        ELSE 'unscheduled'
                    END AS plan_source
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date >= $1 AND tr.record_date <= $2
             ORDER BY s.name, tr.record_date`,
            [from, to]
        );
        const professionRateMap = await loadStaffProfessionRateMap(result.rows.map(row => row.staff_id));

        const header = [
            'ПІБ',
            'Дата',
            'Плановий прихід',
            'Плановий вихід',
            'Фактичний прихід',
            'Фактичний вихід',
            'Відпрацьовано хв',
            'Запізнення',
            'Запізнення хв',
            'Ранній вихід',
            'Ранній вихід хв',
            'Overtime',
            'Overtime хв',
            'Джерело плану',
            'Попередження',
            'Ставка',
            'Сума'
        ];
        const rows = result.rows.map(r => {
            const ci = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const co = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const facts = attendanceFactMinutes(r);
            const lateMinutes = facts.lateMinutes;
            const earlyLeaveMinutes = facts.earlyLeaveMinutes;
            const overtimeMinutes = facts.overtimeMinutes;
            const planWarning = attendancePlanWarningMessage(r.plan_source);
            const rate = rateForStaffProfession(r, r.profession_key, professionRateMap);
            const salary = staffRateUnit(r) === 'month'
                ? ''
                : payrollAmountForRate(rate, staffRateUnit(r), r.total_worked_minutes, 1).toFixed(0);
            return attendanceCsvRow([
                r.name,
                r.record_date,
                r.planned_start || '',
                r.planned_end || '',
                ci,
                co,
                r.total_worked_minutes || 0,
                lateMinutes > 0 ? 'Так' : 'Ні',
                lateMinutes,
                earlyLeaveMinutes > 0 ? 'Так' : 'Ні',
                earlyLeaveMinutes,
                overtimeMinutes > 0 ? 'Так' : 'Ні',
                overtimeMinutes,
                r.plan_source,
                planWarning,
                `${rate} грн/${rateUnitLabel(r.rate_unit)}`,
                salary
            ]);
        }).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="hr_report_${from}_${to}.csv"`);
        res.send('\uFEFF' + [attendanceCsvRow(header), rows].filter(Boolean).join('\n'));
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
    const { status, comment } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Статус: approved або rejected' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE leave_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_comment = $3
             WHERE id = $4 RETURNING *`,
            [status, req.user?.id, comment, req.params.id]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }

        const lr = result.rows[0];
        // If approved, mark days as vacation/sick/day_off in time records
        if (status === 'approved') {
            const d = new Date(lr.date_from);
            const end = new Date(lr.date_to);
            const attendanceDates = [];
            while (d <= end) {
                attendanceDates.push(d.toISOString().split('T')[0]);
                d.setDate(d.getDate() + 1);
            }

            await lockAttendanceWriteTargets(
                client,
                attendanceDates.map(date => ({ staffId: lr.staff_id, date }))
            );

            for (const dateStr of attendanceDates) {
                await recordAttendanceStatus(client, {
                    staffId: lr.staff_id,
                    recordDate: dateStr,
                    status: lr.type === 'vacation' ? 'vacation' : lr.type === 'sick' ? 'sick' : 'day_off',
                    notes: `Заявка #${lr.id}`,
                    businessContext: businessContextFromRequest(req),
                    performedBy: req.user?.username,
                    source: 'leave_request_approval',
                    ip: req.ip
                });
            }
        }
        await auditLog('leave_request_review', lr.staff_id, req.user?.username, { status, comment }, req.ip, client);
        await client.query('COMMIT');
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/leave-requests/:id/review error', err);
        if (err?.code === 'ATTENDANCE_STATUS_CONFLICT') {
            return res.status(err.statusCode || 409).json({ success: false, code: err.code, error: err.message });
        }
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
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
            WHERE ${operationalStaffWhere('s')} AND s.role_type IN ('animator', 'host')
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
            WHERE ${operationalStaffWhere('s')}
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

// GET /api/hr/onboarding/responsible-candidates - task-owner candidates for mentors/instructors
router.get('/onboarding/responsible-candidates', requireHrManage, async (req, res) => {
    try {
        const users = await listTaskOwnerCandidates({ actor: req.user });
        res.json({
            success: true,
            data: users,
            meta: {
                canonicalOwnerField: 'tasks.owner_user_id',
                onboardingOwnerField: 'onboarding_progress.responsible_user_id'
            }
        });
    } catch (err) {
        log.error('GET /hr/onboarding/responsible-candidates error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити відповідальних' });
    }
});

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
// GET /api/hr/staff/:id/onboarding-assignment - current responsible workflow
router.get('/staff/:id/onboarding-assignment', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffForOnboarding(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        const professionKey = normalizeProfessionKey(req.query.profession_key ?? req.query.professionKey);
        const progress = await loadActiveOnboardingProgress(staff.id, pool, { professionKey });
        res.json({
            success: true,
            staff,
            data: progress ? onboardingProgressMeta(progress) : null
        });
    } catch (err) {
        log.error('GET /hr/staff/:id/onboarding-assignment error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити відповідального' });
    }
});

// GET /api/hr/staff/:id/onboarding-processes - general and profession-scoped onboarding
router.get('/staff/:id/onboarding-processes', requireHrManage, async (req, res) => {
    try {
        const staff = await loadStaffForOnboarding(req.params.id);
        if (!staff) return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        const data = await loadOnboardingProcessesForStaff(staff.id);
        res.json({ success: true, staff, data });
    } catch (err) {
        log.error('GET /hr/staff/:id/onboarding-processes error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити процеси onboarding' });
    }
});

// PUT /api/hr/staff/:id/onboarding-assignment - assign/reassign responsible owner and sync onboarding tasks
router.put('/staff/:id/onboarding-assignment', requireHrManage, async (req, res) => {
    try {
        const responsibleUserId = Number(req.body.responsible_user_id ?? req.body.responsibleUserId);
        const templateId = req.body.template_id || req.body.templateId || null;
        const professionKey = normalizeProfessionKey(req.body.profession_key ?? req.body.professionKey);
        if (!Number.isInteger(responsibleUserId) || responsibleUserId <= 0) {
            return res.status(400).json({ success: false, error: 'Потрібен responsible_user_id' });
        }
        const result = await assignOnboardingResponsible(req.params.id, responsibleUserId, req.user, {
            templateId: templateId ? Number(templateId) : null,
            professionKey,
            ipAddress: req.ip
        });
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('PUT /hr/staff/:id/onboarding-assignment error', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.message || 'Не вдалося призначити відповідального',
            code: err.code || null
        });
    }
});

router.post('/onboarding/start', requireHrManage, async (req, res) => {
    try {
        const { staff_id, template_id } = req.body;
        const professionKey = normalizeProfessionKey(req.body.profession_key ?? req.body.professionKey);
        const responsibleUserId = Number((req.body.responsible_user_id ?? req.body.responsibleUserId) || 0);
        if (!Number.isInteger(responsibleUserId) || responsibleUserId <= 0) {
            return res.status(400).json({ success: false, error: 'Потрібен responsible_user_id' });
        }
        if (!staff_id || (!professionKey && !template_id)) {
            return res.status(400).json({ success: false, error: 'Потрібен staff_id; для загального onboarding також потрібен template_id' });
        }

        if (!professionKey) {
            const tpl = await pool.query('SELECT * FROM onboarding_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
        }

        const assigned = await assignOnboardingResponsible(staff_id, responsibleUserId, req.user, {
            templateId: template_id || null,
            professionKey,
            ipAddress: req.ip
        });
        res.json({ success: true, data: assigned.progress, ...assigned, reused: assigned.action !== 'assigned' });
    } catch (err) {
        log.error('POST /hr/onboarding/start error', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.message || 'Помилка сервера',
            code: err.code || null
        });
    }
});

// GET /api/hr/onboarding — list all progress
router.get('/onboarding', async (req, res) => {
    try {
        const { staff_id, status, scope } = req.query;
        const professionKey = normalizeProfessionKey(req.query.profession_key ?? req.query.professionKey);
        let sql = `SELECT op.*, s.name AS staff_name, s.department, ot.name AS template_name,
                          u.name AS responsible_name, u.username AS responsible_username, u.role AS responsible_role,
                          COUNT(t.id)::int AS generated_task_count,
                          COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') NOT IN ('done','completed','archived','cancelled'))::int AS active_task_count,
                          COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') IN ('done','completed'))::int AS completed_task_count
                   FROM onboarding_progress op
                   JOIN staff s ON s.id = op.staff_id
                   LEFT JOIN onboarding_templates ot ON ot.id = op.template_id
                   LEFT JOIN users u ON u.id = op.responsible_user_id
                   LEFT JOIN tasks t ON t.source_type = $1 AND t.source_id LIKE op.id::text || ':%'`;
        const params = [ONBOARDING_TASK_SOURCE_TYPE];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`op.staff_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`op.status = $${params.length}`); }
        if (professionKey) { params.push(professionKey); conds.push(`op.profession_key = $${params.length}`); }
        else if (scope === 'general') conds.push('op.profession_key IS NULL');
        else if (scope === 'profession') conds.push('op.profession_key IS NOT NULL');
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' GROUP BY op.id, s.name, s.department, ot.name, u.name, u.username, u.role';
        sql += ' ORDER BY op.started_at DESC';
        const result = await pool.query(sql, params);
        await attachProfessionOnboardingContext(result.rows, pool);
        res.json({ success: true, data: result.rows.map(onboardingProgressMeta) });
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
        if (normalizeProfessionKey(prog.rows[0].profession_key)) {
            return res.status(409).json({
                success: false,
                error: 'Професійний checklist оновлюється через /staff/:id/profession-checklist',
                code: 'PROFESSION_CHECKLIST_CANONICAL_ENDPOINT'
            });
        }

        const items = prog.rows[0].items || [];
        const item = items.find(i => i.id === item_id);
        if (!item) return res.status(404).json({ success: false, error: 'Пункт не знайдено' });

        item.done = done;
        item.done_at = done ? new Date().toISOString() : null;
        const completedItems = items.filter(i => i.done).length;
        const isComplete = completedItems === items.length;
        const nextTrainingStatus = isComplete ? 'completed' : (completedItems > 0 ? 'in_progress' : 'not_started');

        const result = await pool.query(
            `UPDATE onboarding_progress SET items = $1, completed_items = $2,
             status = $3, completed_at = $4, training_status = $6 WHERE id = $5 RETURNING *`,
            [JSON.stringify(items), completedItems, isComplete ? 'completed' : 'in_progress',
             isComplete ? new Date().toISOString() : null, req.params.id, nextTrainingStatus]
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
        const calculation = await loadPayrollCalculation(req.query.month, pool, {
            from: req.query.from,
            to: req.query.to
        });
        const [periodLock, reconciliation, events] = await Promise.all([
            loadPayrollPeriodLock(calculation.month),
            loadPayrollReconciliation(calculation.month),
            loadPayrollPeriodEvents(calculation.month)
        ]);
        res.json({ success: true, ...calculation, period_lock: periodLock, reconciliation, events });
    } catch (err) {
        log.error('GET /hr/salary error', err);
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/salary/adjustment — add bonus/deduction/depremium
router.post('/salary/adjustment', requireHrManage, async (req, res) => {
    try {
        const { staff_id, month, type, amount, reason, template_id, violation_date, evidence_note, evidence_url } = req.body;
        const rawType = String(type || '').trim().toLowerCase();
        const adjustmentType = rawType === 'zrs' ? 'advance' : rawType;
        if (!staff_id || !month || !adjustmentType || amount === undefined) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, month, type, amount' });
        }
        if (!['bonus', 'deduction', 'penalty', 'tip', 'advance'].includes(adjustmentType)) {
            return res.status(400).json({ success: false, error: 'Невідомий тип коригування зарплати' });
        }

        const payrollMonth = requirePayrollMonth(month);
        if (!payrollMonth) return res.status(400).json({ success: false, error: 'month required (YYYY-MM)' });
        await assertPayrollPeriodOpen(payrollMonth);

        let finalReason = reason;
        let finalAmount = Math.abs(Number(amount));
        if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Сума має бути більшою за 0' });
        }
        let ruleCode = null, disciplineCategory = null, severity = null;
        let repeatIndex = 0, decisionMode = 'custom', needsReview = false;
        let tplId = adjustmentType === 'advance' ? null : template_id || null;

        // Template-based depremium flow
        if ((adjustmentType === 'penalty' || adjustmentType === 'deduction') && tplId) {
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
            [staff_id, payrollMonth, adjustmentType, finalAmount, finalReason, req.user?.username,
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

        await auditLog('salary_adjustment', staff_id, req.user?.username, { type: adjustmentType, amount: finalAmount, reason: finalReason, template_id: tplId }, req.ip);

        // Dry notification to staff (fire-and-forget, no word "штраф")
        if ((adjustmentType === 'penalty' || adjustmentType === 'deduction') && status === 'applied') {
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
            return res.status(err.statusCode).json({
                success: false,
                code: err.code || null,
                error: err.message,
                details: err.details || null,
                period_lock: err.payrollLock || null
            });
        }
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/salary/adjustments — list adjustments
router.get('/salary/adjustments', async (req, res) => {
    try {
        const { staff_id, month } = req.query;
        const requestedType = String(req.query.type || '').trim().toLowerCase();
        const adjustmentType = requestedType === 'zrs' ? 'advance' : requestedType;
        let sql = `SELECT sa.*, s.name AS staff_name FROM salary_adjustments sa
                   JOIN staff s ON s.id = sa.staff_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`sa.staff_id = $${params.length}`); }
        if (month) { params.push(month); conds.push(`sa.month = $${params.length}`); }
        if (adjustmentType) { params.push(adjustmentType); conds.push(`sa.type = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sa.created_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/salary/adjustments error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/salary/adjustment/:id/void — cancel mistaken ZRS before payroll close
router.put('/salary/adjustment/:id/void', requireHrManage, async (req, res) => {
    const client = await pool.connect();
    try {
        const reason = cleanStaffText(req.body?.reason, 500) || 'Скасовано вручну';
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT *
             FROM salary_adjustments
             WHERE id = $1
             FOR UPDATE`,
            [req.params.id]
        );
        const adjustment = current.rows[0];
        if (!adjustment) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Коригування не знайдено' });
        }
        if (adjustment.type !== 'advance') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Цей сценарій скасування доступний тільки для ЗРС/авансу' });
        }
        if (!['applied', 'pending_review'].includes(adjustment.status || 'applied')) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Цей ЗРС вже оброблено або скасовано' });
        }
        await assertPayrollPeriodOpen(adjustment.month, client);
        const result = await client.query(
            `UPDATE salary_adjustments
             SET status = 'voided',
                 approved_by = $1,
                 approved_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [req.user?.username || null, req.params.id]
        );
        await client.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,'void',$3,$4,$5,$6)`,
            [
                result.rows[0].id,
                result.rows[0].staff_id,
                req.user?.username,
                req.user?.role,
                result.rows[0].template_id,
                JSON.stringify({ reason, previousStatus: adjustment.status || 'applied', type: adjustment.type })
            ]
        ).catch(e => log.warn('Discipline void log failed:', e.message));
        await client.query('COMMIT');
        await auditLog('salary_adjustment_void', Number(result.rows[0].staff_id), req.user?.username, {
            adjustment_id: Number(result.rows[0].id),
            type: result.rows[0].type,
            amount: Number(result.rows[0].amount || 0),
            month: result.rows[0].month,
            reason
        }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /hr/salary/adjustment/:id/void error', err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.message, period_lock: err.payrollLock || null });
        }
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
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
            WHERE ${operationalStaffForDateWhere('s', '$1')}
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
             WHERE display_name IS NOT NULL
               AND display_name != ''
               AND ${scheduleableStaffWhere('staff')}`
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

        const reversedStaffIds = [...new Set(reports.rows.map(report => Number(report.staff_id)).filter(Number.isInteger))];
        const removedEntries = reversedStaffIds.length
            ? await client.query(
                `DELETE FROM payroll_entries
                 WHERE period_month = $1
                   AND staff_id = ANY($2::int[])`,
                [month, reversedStaffIds]
            )
            : { rowCount: 0 };
        const removedPayrollEntries = Number(removedEntries.rowCount || 0);
        const reversedTotal = reversed.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const periodLock = await setPayrollPeriodLock(month, false, actor, `Сторновано: ${reason}`, client);
        await recordPayrollPeriodEvent(month, 'reverse', actor, reason, {
            count: reversed.length,
            amount: reversedTotal,
            removedPayrollEntries
        }, client);
        const reconciliation = await loadPayrollReconciliation(month, client);
        const events = await loadPayrollPeriodEvents(month, client);
        await client.query('COMMIT');

        res.json({
            success: true,
            month,
            reversed,
            count: reversed.length,
            removedPayrollEntries,
            period_lock: periodLock,
            reconciliation,
            events
        });
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
        assertPayrollRowsCommitReady(calculation.data);

        // Find salary expense category
        const salCat = await client.query(
            `SELECT id FROM finance_categories WHERE name ILIKE '%зарплат%' AND type = 'expense' LIMIT 1`
        );
        const catId = salCat.rows[0]?.id || null;

        const inserted = [];
        for (const row of calculation.data) {
            const totalSalary = Number(row.total_salary || 0);
            if (totalSalary <= 0) continue;
            const grossAmount = Number(row.base_salary || 0)
                + Number(row.additional_pay || 0)
                + Number(row.overtime_pay || 0)
                + Number(row.bonuses || 0)
                + Number(row.tips || 0);
            const deductionsAmount = Number(row.deductions || 0) + Number(row.penalties || 0);
            const advancesAmount = Number(row.advances || 0);
            const breakdown = {
                base_salary: row.base_salary,
                additional_pay: row.additional_pay,
                overtime_pay: row.overtime_pay,
                bonuses: row.bonuses,
                tips: row.tips,
                deductions: row.deductions,
                penalties: row.penalties,
                advances: row.advances,
                hours_worked: row.hours_worked,
                planned_hours: row.planned_hours,
                overtime_hours: row.overtime_hours,
                metrics: {
                    physicalMinutes: row.physical_minutes,
                    compensationMinutes: row.compensation_minutes,
                    roleMinutes: row.role_minutes,
                    baseProfessionAllocations: row.base_profession_allocations,
                    additionalProfessionAllocations: row.additional_profession_allocations
                },
                transparency: row.payroll_transparency,
                profession_rates: row.profession_rate_summary,
                professionRateSummary: row.profession_rate_summary,
                lines: row.payroll_lines,
                reconciliation: row.reconciliation,
                allocationIssues: row.allocation_issues,
                payrollBlockingIssues: row.payroll_blocking_issues
            };

            const reportResult = await client.query(
                `INSERT INTO payroll_reports
                    (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount, status,
                     breakdown_json, generated_at, committed_at, committed_by, created_by, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7::jsonb, NOW(), NOW(), $8, $8, $8, NOW())
                 ON CONFLICT (period_month, staff_id) DO UPDATE SET
                    gross_amount = EXCLUDED.gross_amount,
                    deductions_amount = EXCLUDED.deductions_amount,
                    advances_amount = EXCLUDED.advances_amount,
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
                [month, row.staff_id, grossAmount, deductionsAmount, advancesAmount, totalSalary, JSON.stringify(breakdown), actor]
            );
            const generatedAdditionalLines = (row.payroll_lines || [])
                .filter(line => line.lineType === 'simultaneous_additional');
            if (generatedAdditionalLines.length) {
                await auditLog('payroll_additional_line_generated', row.staff_id, actor, {
                    eventVersion: 1,
                    month,
                    reportId: Number(reportResult.rows[0].id),
                    reportStatus: 'paid',
                    physicalMinutes: row.physical_minutes,
                    baseRoleMinutes: row.payroll_transparency?.baseRoleMinutes,
                    additionalRoleMinutes: row.payroll_transparency?.additionalRoleMinutes,
                    additionalAmount: row.additional_pay,
                    lines: generatedAdditionalLines
                }, req.ip, client);
            }

            await client.query('DELETE FROM payroll_entries WHERE staff_id = $1 AND period_month = $2', [row.staff_id, month]);
            const entryRows = [
                {
                    type: 'adjustment',
                    label: 'Simultaneous additional pay',
                    amount: row.additional_pay,
                    quantity: (row.additional_profession_allocations || []).length,
                    meta: {
                        payrollLineType: 'simultaneous_additional',
                        lines: (row.payroll_lines || [])
                            .filter(line => line.lineType === 'simultaneous_additional')
                    }
                },
                { type: 'base', label: 'Базова зарплата', amount: row.base_salary, quantity: row.hours_worked, meta: { profession_rates: row.profession_rate_summary } },
                { type: 'adjustment', label: 'Переробка', amount: row.overtime_pay, quantity: row.overtime_hours },
                { type: 'bonus', label: 'Бонуси', amount: row.bonuses },
                { type: 'bonus', label: 'Чайові', amount: row.tips },
                { type: 'deduction', label: 'Вирахування', amount: row.deductions },
                { type: 'deduction', label: 'Депреміювання', amount: row.penalties },
                { type: 'advance', label: 'ЗРС', amount: row.advances }
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
                    `Зарплата ${row.staff_name} за ${month} (${Math.round(Number(row.hours_worked || 0))}г, ставки: ${(row.profession_rate_summary || []).map(segment => `${segment.profession_key} ${segment.rate} грн/${rateUnitLabel(segment.rate_unit)}`).join(', ') || `${row.hourly_rate} грн/${rateUnitLabel(row.rate_unit)}`})`,
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
            return res.status(err.statusCode).json({
                success: false,
                code: err.code || null,
                error: err.message,
                details: err.details || null,
                period_lock: err.payrollLock || null
            });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
// ВАКАНСІЇ — CRUD
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

router.get('/vacancy-platforms', (req, res) => {
    res.json({
        success: true,
        templates: listVacancyPlatformTemplates(),
        ai: {
            provider: 'openai',
            model: process.env.HR_VACANCY_AI_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
            configured: Boolean(process.env.OPENAI_API_KEY)
        }
    });
});

router.post('/vacancy-platforms/format-preview', requireHrManage, async (req, res) => {
    try {
        const { platform, vacancy = {}, source_text, sourceText, tone } = req.body || {};
        if (!platform) return res.status(400).json({ success: false, error: 'platform required' });
        const result = await formatVacancyForPlatform({
            platform,
            vacancy,
            sourceText: sourceText || source_text || '',
            tone
        });
        res.json({
            success: true,
            platform: result.platform,
            template: result.template,
            formatted_text: result.formattedText,
            prompt: result.prompt,
            ai_provider: result.provider,
            ai_model: result.model,
            ai_configured: result.aiConfigured,
            ai_used: result.aiUsed,
            ai_error: result.aiError
        });
    } catch (err) {
        log.error('POST /vacancy-platforms/format-preview', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/vacancies', async (req, res) => {
    try {
        const { status = 'open', role_type } = req.query;
        let q = `SELECT v.*,
                        (SELECT COUNT(*) FROM job_applications a WHERE a.vacancy_id=v.id AND a.status!='rejected') AS active_candidates,
                        (SELECT COUNT(*) FROM job_applications a WHERE a.vacancy_id=v.id AND a.status='hired' AND a.staff_id IS NOT NULL) AS hired_count
                 FROM job_vacancies v`;
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
    const targetHires = req.body.target_hires ?? req.body.targetHires ?? null;
    if (!title?.trim() || !role_type) return res.status(400).json({ error: 'title і role_type обов\'язкові' });
    if (targetHires !== null && targetHires !== '' && (!Number.isInteger(Number(targetHires)) || Number(targetHires) <= 0)) {
        return res.status(400).json({ error: 'target_hires має бути додатним цілим числом або null' });
    }
    try {
        const r = await pool.query(
            `INSERT INTO job_vacancies (title,role_type,department,description,requirements,salary_from,salary_to,schedule,work_format,status,priority,created_by,target_hires)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [title.trim(), role_type, department, description||null, requirements||null,
             salary_from||null, salary_to||null, schedule||null, work_format, status, priority, req.user?.username||null,
             targetHires === null || targetHires === '' ? null : Number(targetHires)]);
        res.json({ success: true, vacancy: r.rows[0] });
    } catch (err) { log.error('POST /vacancies', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/vacancies/:id', requireHrManage, async (req, res) => {
    const body = req.body || {};
    const { status, priority, description, requirements, salary_from, salary_to, schedule, title } = body;
    const vacancyId = Number(req.params.id);
    const hasTargetHires = Object.prototype.hasOwnProperty.call(body, 'target_hires')
        || Object.prototype.hasOwnProperty.call(body, 'targetHires');
    const targetHiresInput = Object.prototype.hasOwnProperty.call(body, 'target_hires')
        ? body.target_hires
        : body.targetHires;
    const targetHires = targetHiresInput === null || targetHiresInput === ''
        ? null
        : Number(targetHiresInput);
    if (!Number.isInteger(vacancyId) || vacancyId <= 0) {
        return res.status(400).json({ success: false, error: 'Некоректний id вакансії' });
    }
    if (hasTargetHires && targetHires !== null && (!Number.isInteger(targetHires) || targetHires <= 0)) {
        return res.status(400).json({ success: false, error: 'target_hires має бути додатним цілим числом або null' });
    }
    const hasUpdates = title !== undefined
        || Boolean(status)
        || Boolean(priority)
        || description !== undefined
        || requirements !== undefined
        || salary_from !== undefined
        || salary_to !== undefined
        || schedule !== undefined
        || hasTargetHires;
    if (!hasUpdates) return res.status(400).json({ success: false, error: 'Нічого оновлювати' });

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const currentResult = await client.query(
            'SELECT * FROM job_vacancies WHERE id = $1 FOR UPDATE',
            [vacancyId]
        );
        if (!currentResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Вакансію не знайдено' });
        }
        const current = currentResult.rows[0];
        const hiredResult = await client.query(
            `SELECT COUNT(*)::int AS hired_count
             FROM job_applications
             WHERE vacancy_id = $1
               AND status = 'hired'
               AND staff_id IS NOT NULL`,
            [vacancyId]
        );
        const hiredCount = Number(hiredResult.rows[0]?.hired_count || 0);
        const nextTargetHires = hasTargetHires
            ? targetHires
            : (current.target_hires == null ? null : Number(current.target_hires));
        let finalStatus = status || current.status;
        const headcountReached = nextTargetHires !== null && hiredCount >= nextTargetHires;
        const autoFilledByHeadcount = finalStatus === 'open' && headcountReached;
        if (autoFilledByHeadcount) finalStatus = 'filled';

        const updates = new Map();
        if (title !== undefined) updates.set('title', title);
        if (status || autoFilledByHeadcount) updates.set('status', finalStatus);
        if (priority) updates.set('priority', priority);
        if (description !== undefined) updates.set('description', description);
        if (requirements !== undefined) updates.set('requirements', requirements);
        if (salary_from !== undefined) updates.set('salary_from', salary_from);
        if (salary_to !== undefined) updates.set('salary_to', salary_to);
        if (schedule !== undefined) updates.set('schedule', schedule);
        if (hasTargetHires) updates.set('target_hires', nextTargetHires);

        const sets = [];
        const vals = [];
        for (const [column, value] of updates) {
            vals.push(value);
            sets.push(`${column}=$${vals.length}`);
        }
        if (['filled', 'closed'].includes(finalStatus) && (status || autoFilledByHeadcount)) {
            sets.push('closed_at=NOW()');
        }
        vals.push(vacancyId);
        const updatedResult = await client.query(
            `UPDATE job_vacancies SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,
            vals
        );
        const vacancy = {
            ...updatedResult.rows[0],
            hired_count: hiredCount
        };
        await client.query('COMMIT');
        res.json({
            success: true,
            vacancy,
            target_hires: vacancy.target_hires == null ? null : Number(vacancy.target_hires),
            hired_count: hiredCount,
            headcount_reached: headcountReached,
            status: vacancy.status,
            auto_filled_by_headcount: autoFilledByHeadcount
        });
    } catch (err) {
        try { await client?.query('ROLLBACK'); } catch {}
        log.error('PATCH /vacancies/:id', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client?.release();
    }
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
        const r = await pool.query(
            `SELECT a.*, v.role_type AS vacancy_role_type, v.title AS vacancy_title,
                    v.department AS vacancy_department, v.target_hires AS vacancy_target_hires
             FROM job_applications a
             JOIN job_vacancies v ON v.id = a.vacancy_id
             WHERE a.vacancy_id=$1
             ORDER BY a.created_at DESC`,
            [req.params.id]
        );
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
    if (status === 'hired') return res.status(400).json({ success: false, error: 'Статус hired встановлюється тільки через транзакційну дію Найняти' });
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
    const client = await pool.connect();
    const afterCommit = [];
    try {
        const hireMode = String(req.body.hire_mode || req.body.hireMode || 'new_staff').trim();
        const vacancyAction = String(req.body.vacancy_action || req.body.vacancyAction || '').trim();
        const startProfessionOnboarding = req.body.start_profession_onboarding === true || req.body.startProfessionOnboarding === true;
        const responsibleUserId = Number(req.body.responsible_user_id ?? req.body.responsibleUserId ?? 0);
        if (!['new_staff', 'existing_staff'].includes(hireMode)) {
            return res.status(400).json({ success: false, error: 'hire_mode має бути new_staff або existing_staff' });
        }
        if (startProfessionOnboarding && (!Number.isInteger(responsibleUserId) || responsibleUserId <= 0)) {
            return res.status(400).json({ success: false, error: 'Для запуску професійного онбордингу потрібен responsible_user_id' });
        }

        await client.query('BEGIN');
        const app = await client.query(
            `SELECT a.*, v.role_type, v.department AS vacancy_department, v.title AS vac_title,
                    v.status AS vacancy_status, v.target_hires
             FROM job_applications a
             JOIN job_vacancies v ON v.id = a.vacancy_id
             WHERE a.id=$1
             FOR UPDATE OF a, v`,
            [req.params.id]
        );
        if (!app.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Заявку не знайдено' });
        }
        const a = app.rows[0];
        const targetHires = a.target_hires == null ? null : Number(a.target_hires);
        if (targetHires === null && !['keep_open', 'mark_filled'].includes(vacancyAction)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Для вакансії без headcount потрібне явне рішення vacancy_action: keep_open або mark_filled' });
        }
        if (a.staff_id || a.status === 'hired') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'APPLICATION_ALREADY_HIRED',
                error: 'Цю заявку вже застосовано до працівника',
                staff_id: a.staff_id || null,
                profession_key: a.profession_key || null
            });
        }
        const professionKey = normalizeProfessionKey(a.role_type);
        const profession = await client.query('SELECT key, title FROM hr_professions WHERE key = $1 AND is_active = true LIMIT 1', [professionKey]);
        if (!profession.rows.length) {
            throw Object.assign(new Error('Професія вакансії відсутня або неактивна'), { statusCode: 409, code: 'VACANCY_PROFESSION_INACTIVE' });
        }

        let staff;
        if (hireMode === 'new_staff') {
            const department = cleanStaffText(req.body.department, 120) || a.vacancy_department || 'animators';
            const salary = Math.max(0, Number(req.body.salary || 0));
            const staffResult = await client.query(
                `INSERT INTO staff
                    (name, department, position, phone, role_type, secondary_professions, hire_date,
                     telegram_username, telegram_id, hourly_rate, address, is_active)
                 VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,CURRENT_DATE,$6,$7,$8,$9,true)
                 RETURNING id, name, department, position, role_type,
                           COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions, is_active`,
                [a.name, department, a.vac_title, a.phone || null, professionKey,
                 a.telegram_username || null, a.telegram_id || null, salary, a.address || null]
            );
            staff = staffResult.rows[0];
            await replaceStaffRoleAssignments(client, staff.id, [{
                profession_key: professionKey,
                is_primary: true,
                status: 'active',
                admission_status: 'pending',
                internship_status: 'in_progress',
                hourly_rate: salary || null,
                payroll_scheme_id: null,
                notes: `Найм із заявки #${a.id}`
            }], req.user?.username || null);
        } else {
            const existingStaffId = Number(req.body.existing_staff_id ?? req.body.existingStaffId);
            if (!Number.isInteger(existingStaffId) || existingStaffId <= 0) {
                throw Object.assign(new Error('Для existing_staff потрібен явний existing_staff_id'), { statusCode: 400, code: 'EXISTING_STAFF_REQUIRED' });
            }
            const staffResult = await client.query(
                `SELECT id, name, department, position, role_type,
                        COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions, is_active
                 FROM staff WHERE id = $1 FOR UPDATE`,
                [existingStaffId]
            );
            staff = staffResult.rows[0];
            if (!staff) throw Object.assign(new Error('Працівника не знайдено'), { statusCode: 404, code: 'STAFF_NOT_FOUND' });
            if (staff.is_active === false) throw Object.assign(new Error('Не можна додати професію неактивному працівнику'), { statusCode: 409, code: 'STAFF_INACTIVE' });
            if (staffProfessionKeys(staff).includes(professionKey)) {
                throw Object.assign(new Error('Ця професія вже призначена працівнику'), { statusCode: 409, code: 'PROFESSION_ALREADY_ASSIGNED' });
            }
            const secondaryProfessions = normalizeSecondaryProfessions([...(staff.secondary_professions || []), professionKey], staff.role_type);
            await client.query(
                `UPDATE staff SET secondary_professions = $2::jsonb WHERE id = $1`,
                [staff.id, JSON.stringify(secondaryProfessions)]
            );
            staff.secondary_professions = secondaryProfessions;
            const currentAssignments = await loadStaffRoleAssignments(staff.id, client);
            const assignmentRows = currentAssignments.map(row => ({
                profession_key: row.profession_key,
                is_primary: row.is_primary,
                status: row.status,
                admission_status: row.admission_status,
                internship_status: row.internship_status,
                hourly_rate: row.hourly_rate,
                payroll_scheme_id: row.payroll_scheme_id,
                notes: row.notes
            }));
            assignmentRows.push({
                profession_key: professionKey,
                is_primary: false,
                status: 'active',
                admission_status: 'pending',
                internship_status: 'in_progress',
                hourly_rate: null,
                payroll_scheme_id: null,
                notes: `Додаткова професія із заявки #${a.id}`
            });
            await replaceStaffRoleAssignments(
                client,
                staff.id,
                normalizeRoleAssignmentInputRows(assignmentRows, staff.role_type),
                req.user?.username || null
            );
        }

        let onboarding = null;
        if (startProfessionOnboarding) {
            onboarding = await assignOnboardingResponsible(staff.id, responsibleUserId, req.user, {
                professionKey,
                ipAddress: req.ip,
                db: client,
                afterCommit
            });
        }
        await client.query(
            `UPDATE job_applications
             SET status = 'hired', staff_id = $2, profession_key = $3, onboarding_progress_id = $4,
                 hired_at = NOW(), hired_by = $5, updated_at = NOW()
             WHERE id = $1`,
            [a.id, staff.id, professionKey, onboarding?.progress?.id || null, req.user?.username || null]
        );
        let hiredCount = null;
        let resolvedVacancyAction = vacancyAction;
        let vacancyStatus = a.vacancy_status;
        if (targetHires !== null) {
            const headcount = await client.query(
                `SELECT COUNT(*)::int AS hired_count
                 FROM job_applications
                 WHERE vacancy_id = $1 AND status = 'hired' AND staff_id IS NOT NULL`,
                [a.vacancy_id]
            );
            hiredCount = Number(headcount.rows[0]?.hired_count || 0);
            const reached = hiredCount >= targetHires;
            resolvedVacancyAction = reached ? 'auto_filled_by_headcount' : 'kept_open_by_headcount';
            vacancyStatus = reached ? 'filled' : 'open';
            await client.query(
                `UPDATE job_vacancies
                 SET status = $2, closed_at = CASE WHEN $2 = 'filled' THEN NOW() ELSE NULL END
                 WHERE id = $1`,
                [a.vacancy_id, vacancyStatus]
            );
        } else if (vacancyAction === 'mark_filled') {
            await client.query(
                `UPDATE job_vacancies SET status = 'filled', closed_at = NOW() WHERE id = $1`,
                [a.vacancy_id]
            );
            vacancyStatus = 'filled';
        }
        await auditLog(
            hireMode === 'new_staff' ? 'application_hired_new_staff' : 'application_hired_existing_staff_profession',
            staff.id,
            req.user?.username,
            {
                application_id: a.id,
                vacancy_id: a.vacancy_id,
                profession_key: professionKey,
                hire_mode: hireMode,
                vacancy_action: resolvedVacancyAction,
                target_hires: targetHires,
                hired_count: hiredCount,
                onboarding_progress_id: onboarding?.progress?.id || null
            },
            req.ip,
            client
        );
        await client.query('COMMIT');
        for (const callback of afterCommit) {
            try {
                Promise.resolve(callback()).catch(err => log.warn(`Hire post-commit hook skipped: ${err.message}`));
            } catch (err) {
                log.warn(`Hire post-commit hook skipped: ${err.message}`);
            }
        }
        res.json({
            success: true,
            staff_id: staff.id,
            profession_key: professionKey,
            onboarding_progress_id: onboarding?.progress?.id || null,
            hire_mode: hireMode,
            vacancy_action: resolvedVacancyAction,
            vacancy_status: vacancyStatus,
            target_hires: targetHires,
            hired_count: hiredCount,
            message: hireMode === 'new_staff'
                ? `${a.name} найнятий як ${profession.rows[0].title || professionKey}`
                : `${profession.rows[0].title || professionKey} додано працівнику ${staff.name}`
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /applications/:id/hire', err);
        res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({
            success: false,
            code: err.code || 'HIRE_FAILED',
            error: err.statusCode || err.code === '23505' ? err.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
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
