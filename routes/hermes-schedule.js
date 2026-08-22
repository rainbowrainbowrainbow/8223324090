'use strict';

const express = require('express');
const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { canUseAction } = require('../middleware/auth');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const {
    activeStaffWhere,
    scheduleableStaffWhere
} = require('../services/staffOperationalFilters');
const {
    normalizeRequestedProfessionKey,
    normalizeSecondaryProfessions,
    staffProfessionKeys
} = require('../services/professions');
const { staffProfessionCategoryRule } = require('../services/staffDisplayGroups');
const {
    applyHermesScheduleImport,
    buildScheduleCellStateHash,
    normalizeHermesScheduleStatus,
    previewHermesScheduleImport
} = require('../services/hermesScheduleImport');
const {
    applyHermesAttendanceImport,
    previewHermesAttendanceImport
} = require('../services/hermesAttendanceImport');
const { createHermesMutationGuard } = require('../services/hermesMutationGuard');
const { withHermesIdempotency } = require('../services/hermesIdempotency');
const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { broadcast, broadcastLineEvent } = require('../services/websocket');
const { createLogger } = require('../utils/logger');

const log = createLogger('HermesSchedule');
const MAX_STAFF_LIMIT = 50;
const MAX_SCHEDULE_DAYS = 31;
const MAX_STAFF_IDS = 50;
const HERMES_SCHEDULE_BUSINESS_CONTEXT = DEFAULT_BUSINESS_CONTEXT;
const HERMES_STAFF_APPROVAL_SOURCE_CONTEXT = 'staff_registration';
const HERMES_STAFF_APPROVAL_TYPE = 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE';
const HERMES_STAFF_APPROVAL_ACTION = 'APPROVE_CANDIDATE';
const HERMES_STAFF_CRM_WRITE_APPROVAL_PREFIX = 'APPROVE_EG_STAFF_REGISTRATION_CRM_ROSTER_CREATE_';
const HERMES_STAFF_CRM_WRITE_APPROVAL_SUFFIX = '_STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE';
const HERMES_STAFF_CRM_WRITE_APPROVAL_REQUIRED = 'HERMES_STAFF_REGISTRATION_CRM_WRITE_APPROVAL_REQUIRED';
const HERMES_STAFF_FORBIDDEN_POLICY_CODE = 'FORBIDDEN_FIELDS_FOR_STAFF_ONLY_CREATE';
const HERMES_STAFF_SCHEDULE_APPROVAL_CODE = 'HERMES_STAFF_CREATE_SCHEDULE_SEPARATE_APPROVAL_REQUIRED';
const HERMES_STAFF_SCHEDULE_FIELD_KEYS = new Set([
    'schedule',
    'scheduledata',
    'schedulepayload',
    'schedulerows',
    'schedulewrites',
    'staffschedule',
    'staffscheduledata',
    'staffschedulepayload',
    'date',
    'datefrom',
    'dateto',
    'starttime',
    'endtime',
    'shiftstart',
    'shiftend',
    'status'
]);
const HERMES_STAFF_CROSS_LANE_FIELD_KEYS = new Set([
    'account',
    'accounts',
    'accountid',
    'accountdata',
    'accountpayload',
    'accountprofile',
    'accountwrites',
    'createaccount',
    'useraccount',
    'username',
    'login',
    'loginname',
    'password',
    'passwordconfirm',
    'passwordconfirmation',
    'passwordhash',
    'passwordpayload',
    'credentials',
    'dryrun',
    'payroll',
    'payrolldata',
    'payrollpayload',
    'payrollprofile',
    'payrollwrites',
    'salary',
    'hourlyrate',
    'rateunit',
    'attendance',
    'attendancerows',
    'attendancedata',
    'attendancepayload',
    'attendancewrites',
    'kpi',
    'kpis',
    'kpidata',
    'kpipayload',
    'kpiwrites',
    'kpiprofile'
]);
const HERMES_STAFF_ALLOWED_FIELD_KEYS = new Set([
    'name',
    'department',
    'position',
    'roletype',
    'phone',
    'color',
    'telegramusername',
    'address',
    'hiredate',
    'secondaryprofessions',
    'businesscontext',
    'approvalcontext'
]);

function hermesStaffBusinessWrites(staffWrites = 0) {
    return {
        staffWrites,
        accountWrites: 0,
        scheduleWrites: 0,
        attendanceWrites: 0,
        payrollWrites: 0
    };
}

function normalizeHermesStaffFieldKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function expectedHermesStaffCrmWriteApproval(packetId) {
    return `${HERMES_STAFF_CRM_WRITE_APPROVAL_PREFIX}${packetId}${HERMES_STAFF_CRM_WRITE_APPROVAL_SUFFIX}`;
}

function sanitizeHermesStaffApprovalContext(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawSourceContext = typeof source.sourceContext === 'string' ? source.sourceContext.trim() : '';
    const rawPacketId = typeof source.packetId === 'string' ? source.packetId.trim() : '';
    const rawChatId = typeof source.chatId === 'string' ? source.chatId.trim() : '';
    const rawMessageId = typeof source.messageId === 'string' ? source.messageId.trim() : '';
    const rawApprovalType = typeof source.approvalType === 'string' ? source.approvalType.trim() : '';
    const rawApprovalAction = typeof source.approvalAction === 'string' ? source.approvalAction.trim() : '';
    const packetId = /^[A-Z0-9][A-Z0-9_-]{0,159}$/.test(rawPacketId) ? rawPacketId : '';
    const crmWriteApproval = source.crmWriteApproval;
    return {
        sourceContext: rawSourceContext === HERMES_STAFF_APPROVAL_SOURCE_CONTEXT ? rawSourceContext : '',
        packetId,
        chatId: /^-?\d{1,30}$/.test(rawChatId) ? rawChatId : '',
        messageId: /^[1-9]\d{0,29}$/.test(rawMessageId) ? rawMessageId : '',
        approvalType: rawApprovalType === HERMES_STAFF_APPROVAL_TYPE ? rawApprovalType : '',
        approvalAction: rawApprovalAction === HERMES_STAFF_APPROVAL_ACTION ? rawApprovalAction : '',
        crmWriteApprovalPresent: typeof crmWriteApproval === 'string' && crmWriteApproval.length > 0,
        crmWriteApprovalMatchesPacket: typeof crmWriteApproval === 'string'
            && packetId.length > 0
            && crmWriteApproval === expectedHermesStaffCrmWriteApproval(packetId)
    };
}

function normalizeHermesStaffApprovalContext(value, receipt) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    const exactStrings = source
        && source.sourceContext === receipt.sourceContext
        && source.packetId === receipt.packetId
        && source.chatId === receipt.chatId
        && source.messageId === receipt.messageId
        && source.approvalType === receipt.approvalType
        && source.approvalAction === receipt.approvalAction;
    const valid = exactStrings
        && receipt.sourceContext === HERMES_STAFF_APPROVAL_SOURCE_CONTEXT
        && /^[A-Z0-9][A-Z0-9_-]{0,159}$/.test(receipt.packetId)
        && /^-?\d{1,30}$/.test(receipt.chatId)
        && /^[1-9]\d{0,29}$/.test(receipt.messageId)
        && receipt.approvalType === HERMES_STAFF_APPROVAL_TYPE
        && receipt.approvalAction === HERMES_STAFF_APPROVAL_ACTION
        && receipt.crmWriteApprovalMatchesPacket;

    if (!valid) {
        throw hermesScheduleError(
            400,
            HERMES_STAFF_CRM_WRITE_APPROVAL_REQUIRED,
            'Exact CRM staff-registration write approval is required'
        );
    }

    return {
        sourceContext: receipt.sourceContext,
        packetId: receipt.packetId,
        chatId: receipt.chatId,
        messageId: receipt.messageId,
        approvalType: receipt.approvalType,
        approvalAction: receipt.approvalAction
    };
}

function setHermesStaffAuditReceipt(req, approvalContext, options = {}) {
    const businessWrites = options.businessWrites || hermesStaffBusinessWrites(0);
    req.hermesMutation = {
        ...(req.hermesMutation || {}),
        auditReceipt: {
            approvalContext,
            outcome: options.outcome || 'NO_CREATE',
            ...(Number.isSafeInteger(options.staffId) && options.staffId > 0
                ? { staffId: options.staffId }
                : {}),
            ...(typeof options.idempotencyReplay === 'boolean'
                ? { idempotencyReplay: options.idempotencyReplay }
                : {}),
            businessWrites: { ...businessWrites }
        }
    };
}

function syncHermesStaffAuditReceiptFromIdempotency(req, approvalContext, result = {}) {
    const body = result.body && typeof result.body === 'object' ? result.body : {};
    const isReplay = result.state === 'replay';
    const businessWrites = isReplay
        ? hermesStaffBusinessWrites(0)
        : {
            staffWrites: Number.isSafeInteger(body.staffWrites) && body.staffWrites >= 0 ? body.staffWrites : 0,
            accountWrites: Number.isSafeInteger(body.accountWrites) && body.accountWrites >= 0 ? body.accountWrites : 0,
            scheduleWrites: Number.isSafeInteger(body.scheduleWrites) && body.scheduleWrites >= 0 ? body.scheduleWrites : 0,
            attendanceWrites: Number.isSafeInteger(body.attendanceWrites) && body.attendanceWrites >= 0 ? body.attendanceWrites : 0,
            payrollWrites: Number.isSafeInteger(body.payrollWrites) && body.payrollWrites >= 0 ? body.payrollWrites : 0
        };
    const staffId = Number(body.staffId ?? body.data?.staffId);
    const outcome = typeof body.outcome === 'string' && body.outcome
        ? body.outcome
        : (body.success === true ? 'CREATED_STAFF_ONLY' : 'NO_CREATE');

    setHermesStaffAuditReceipt(req, approvalContext, {
        outcome,
        staffId,
        idempotencyReplay: isReplay,
        businessWrites
    });
}

function hermesStaffCreateErrorBody(error) {
    const details = error.details && typeof error.details === 'object' ? error.details : {};
    const businessWrites = details.businessWrites || hermesStaffBusinessWrites(0);
    const body = {
        success: false,
        ok: false,
        error: error.message,
        code: error.code || 'HERMES_STAFF_CREATE_INVALID_PAYLOAD',
        outcome: details.outcome || 'NO_CREATE',
        ...businessWrites
    };
    if (details.policyCode) body.policyCode = details.policyCode;
    if (Array.isArray(details.forbiddenFields)) body.forbiddenFields = details.forbiddenFields;
    if (Array.isArray(details.matches)) body.matches = details.matches;
    if (Number.isSafeInteger(details.staffId) && details.staffId > 0) body.staffId = details.staffId;
    if (details.meta && typeof details.meta === 'object' && Object.keys(details.meta).length) {
        body.meta = details.meta;
    }
    return body;
}

function sendHermesStaffCreateError(res, error) {
    return res.status(error.statusCode || 400).json(hermesStaffCreateErrorBody(error));
}

function sendHermesScheduleError(res, status, code, error, meta = undefined) {
    const body = { success: false, error, code };
    if (meta && typeof meta === 'object' && Object.keys(meta).length) body.meta = meta;
    return res.status(status).json(body);
}

function hermesScheduleError(statusCode, code, message, details = undefined) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
}

function parseBoolean(value, fallback, fieldName) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', `${fieldName} must be true or false`);
}

function parseStaffLimit(value) {
    if (value === undefined || value === null || value === '') return MAX_STAFF_LIMIT;
    if (!/^\d+$/.test(String(value).trim())) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'limit must be a positive integer');
    }
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'limit must be a positive integer');
    }
    return Math.min(limit, MAX_STAFF_LIMIT);
}

function encodeStaffCursor(staffId) {
    return Buffer.from(JSON.stringify({ staffId: Number(staffId) })).toString('base64url');
}

function decodeStaffCursor(value) {
    if (!value) return null;
    try {
        const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        const staffId = Number(decoded.staffId ?? decoded.staff_id);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) throw new Error('invalid cursor');
        return staffId;
    } catch {
        throw hermesScheduleError(400, 'HERMES_INVALID_CURSOR', 'Invalid staff cursor');
    }
}

function normalizeStaffQuery(value) {
    if (value === undefined || value === null || value === '') return null;
    const query = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
    if (!query) return null;
    if (query.length > 160) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'q is too long');
    }
    return query;
}

function parseDateOnly(value, fieldName) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw hermesScheduleError(400, 'HERMES_INVALID_DATE_RANGE', `${fieldName} must use YYYY-MM-DD`);
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw hermesScheduleError(400, 'HERMES_INVALID_DATE_RANGE', `${fieldName} is not a valid date`);
    }
    return { text, time: parsed.getTime() };
}

function parseScheduleDateRange(query = {}) {
    const from = parseDateOnly(query.dateFrom, 'dateFrom');
    const to = parseDateOnly(query.dateTo, 'dateTo');
    const days = Math.floor((to.time - from.time) / 86400000) + 1;
    if (days <= 0 || days > MAX_SCHEDULE_DAYS) {
        throw hermesScheduleError(
            400,
            'HERMES_INVALID_DATE_RANGE',
            `dateFrom/dateTo must cover between 1 and ${MAX_SCHEDULE_DAYS} days`
        );
    }
    return { dateFrom: from.text, dateTo: to.text, days };
}

function parseStaffIds(value) {
    if (value === undefined || value === null || value === '') return [];
    const rawItems = Array.isArray(value) ? value : String(value).split(',');
    const ids = [];
    const seen = new Set();
    for (const raw of rawItems) {
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) {
            throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'staffIds must contain positive integers');
        }
        const id = Number(text);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'staffIds must contain positive integers');
        }
        if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    if (ids.length > MAX_STAFF_IDS) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', `staffIds supports at most ${MAX_STAFF_IDS} ids`);
    }
    return ids.sort((left, right) => left - right);
}

function actorBusinessContexts(user = {}) {
    return new Set([
        ...(Array.isArray(user.businessContexts) ? user.businessContexts : []),
        ...(Array.isArray(user.business_contexts) ? user.business_contexts : []),
        user.defaultBusinessContext,
        user.default_business_context
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function assertHermesScheduleAccess(req) {
    if (req.integration?.id !== HERMES_INTEGRATION_ID
        || !['x-api-key', 'authorization-bearer'].includes(req.integration?.authMode)) {
        throw hermesScheduleError(401, 'HERMES_AUTH_REQUIRED', 'Hermes API key authentication is required');
    }
    const requestedContext = String(
        req.query?.businessContext
        ?? req.query?.business_context
        ?? req.body?.businessContext
        ?? req.body?.business_context
        ?? HERMES_SCHEDULE_BUSINESS_CONTEXT
    ).trim().toLowerCase();
    if (requestedContext !== HERMES_SCHEDULE_BUSINESS_CONTEXT
        || !actorBusinessContexts(req.user).has(HERMES_SCHEDULE_BUSINESS_CONTEXT)) {
        throw hermesScheduleError(
            403,
            'HERMES_SCHEDULE_BUSINESS_CONTEXT_UNAVAILABLE',
            'Hermes staff schedule reads currently support event_genix only'
        );
    }
    return HERMES_SCHEDULE_BUSINESS_CONTEXT;
}

function mapHermesStaff(row = {}) {
    return {
        staffId: Number(row.id),
        name: row.name || '',
        displayName: row.display_name || row.name || '',
        department: row.department || null,
        position: row.position || null,
        roleType: row.role_type || null,
        professions: staffProfessionKeys(row),
        scheduleable: row.scheduleable === true
    };
}

function normalizeHermesStaffText(value, fieldName, options = {}) {
    const text = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!text) {
        if (options.required === false) return null;
        throw hermesScheduleError(400, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD', `${fieldName} is required`);
    }
    if (text.length > (options.maxLength || 160)) {
        throw hermesScheduleError(
            400,
            'HERMES_STAFF_CREATE_INVALID_PAYLOAD',
            `${fieldName} is too long`
        );
    }
    return text;
}

function normalizeHermesStaffCreateDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw hermesScheduleError(400, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD', 'hireDate must use YYYY-MM-DD');
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw hermesScheduleError(400, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD', 'hireDate is not a valid date');
    }
    return text;
}

function normalizeHermesStaffCreatePayload(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw hermesScheduleError(400, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD', 'Request body must be an object');
    }

    const attemptedScheduleFields = [];
    const attemptedCrossLaneFields = [];
    for (const field of Object.keys(body)) {
        const normalizedField = normalizeHermesStaffFieldKey(field);
        if (HERMES_STAFF_SCHEDULE_FIELD_KEYS.has(normalizedField)) {
            attemptedScheduleFields.push(field);
        } else if (HERMES_STAFF_CROSS_LANE_FIELD_KEYS.has(normalizedField)
            || !HERMES_STAFF_ALLOWED_FIELD_KEYS.has(normalizedField)) {
            attemptedCrossLaneFields.push(field);
        }
    }

    const forbiddenFields = [...attemptedScheduleFields, ...attemptedCrossLaneFields];
    if (forbiddenFields.length) {
        const legacyScheduleCode = attemptedScheduleFields.length > 0;
        throw hermesScheduleError(
            400,
            legacyScheduleCode ? HERMES_STAFF_SCHEDULE_APPROVAL_CODE : HERMES_STAFF_FORBIDDEN_POLICY_CODE,
            'Staff-only creation payload contains fields owned by a separate business lane',
            {
                policyCode: HERMES_STAFF_FORBIDDEN_POLICY_CODE,
                forbiddenFields,
                outcome: 'NO_CREATE',
                businessWrites: hermesStaffBusinessWrites(0),
                meta: { fields: forbiddenFields }
            }
        );
    }

    const name = normalizeHermesStaffText(body.name, 'name', { maxLength: 160 });
    const department = normalizeHermesStaffText(body.department, 'department', { maxLength: 80 });
    const position = normalizeHermesStaffText(body.position, 'position', { maxLength: 120 });
    const primaryRoleInput = normalizeHermesStaffText(body.role_type ?? body.roleType, 'role_type', {
        maxLength: 80
    });
    const primaryRole = normalizeRequestedProfessionKey(primaryRoleInput);
    if (!primaryRole) {
        throw hermesScheduleError(
            400,
            'HERMES_STAFF_CREATE_INVALID_PAYLOAD',
            'role_type must be a canonical profession key'
        );
    }
    const phone = normalizeHermesStaffText(body.phone, 'phone', { required: false, maxLength: 40 });
    const color = normalizeHermesStaffText(body.color, 'color', { required: false, maxLength: 20 });
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw hermesScheduleError(400, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD', 'color must be a #RRGGBB value');
    }
    const rawTelegram = normalizeHermesStaffText(
        body.telegramUsername ?? body.telegram_username,
        'telegramUsername',
        { required: false, maxLength: 64 }
    );
    const telegramUsername = rawTelegram ? rawTelegram.replace(/^@+/, '') : null;
    const address = normalizeHermesStaffText(body.address, 'address', { required: false, maxLength: 255 });
    const hireDate = normalizeHermesStaffCreateDate(body.hireDate ?? body.hire_date);
    const secondaryRoles = normalizeSecondaryProfessions(
        body.secondary_professions ?? body.secondaryProfessions,
        primaryRole
    );
    const normalizedName = normalizeStaffQuery(name);

    return {
        name,
        normalizedName,
        department,
        position,
        phone,
        hireDate,
        color,
        telegramUsername,
        primaryRole,
        address,
        secondaryRoles
    };
}

function normalizeHermesStaffComparisonText(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
}

async function assertHermesStaffCreateUnique(query, payload) {
    const scheduleableSql = scheduleableStaffWhere('s', {
        dateExpression: 'CURRENT_DATE',
        includeFreelance: true
    });
    const existing = await query.query(
        `SELECT s.id,
                s.name,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                s.department,
                s.position,
                s.role_type,
                COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                s.is_active,
                COALESCE(s.hr_pool_status, 'core') AS hr_pool_status,
                s.termination_date,
                COALESCE(s.is_freelance, false) AS is_freelance,
                (${scheduleableSql}) AS scheduleable
         FROM staff s
         WHERE LOWER(REGEXP_REPLACE(BTRIM(s.name), '\\s+', ' ', 'g')) = $1
            OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\\s+', ' ', 'g')) = $1
         ORDER BY s.id ASC
         LIMIT 5`,
        [payload.normalizedName]
    );
    if (existing.rows.length) {
        const sanitizedExisting = existing.rows.map(mapHermesStaff);
        const firstExisting = sanitizedExisting[0];
        const firstRow = existing.rows[0];
        const mappingMismatch = existing.rows.length === 1 && (
            normalizeHermesStaffComparisonText(firstRow.department)
                !== normalizeHermesStaffComparisonText(payload.department)
            || normalizeHermesStaffComparisonText(firstRow.position)
                !== normalizeHermesStaffComparisonText(payload.position)
            || normalizeRequestedProfessionKey(firstRow.role_type) !== payload.primaryRole
        );
        const ambiguous = existing.rows.length > 1
            || existing.rows.some(row => row.scheduleable !== true)
            || mappingMismatch;
        if (ambiguous) {
            throw hermesScheduleError(
                409,
                'STAFF_DUPLICATE_AMBIGUOUS_REVIEW_REQUIRED',
                'Matching staff records require manual review before any create',
                {
                    outcome: 'NO_CREATE_REVIEW_REQUIRED',
                    businessWrites: hermesStaffBusinessWrites(0),
                    matches: sanitizedExisting,
                    meta: {
                        matches: sanitizedExisting,
                        userMessage: 'У CRM є неоднозначні збіги за ПІБ. Створення зупинено для ручної перевірки.'
                    }
                }
            );
        }
        throw hermesScheduleError(
            409,
            'HERMES_STAFF_ALREADY_EXISTS',
            'Staff member with this normalized name already exists',
            {
                outcome: 'ALREADY_EXISTS_NO_CREATE',
                staffId: firstExisting.staffId,
                businessWrites: hermesStaffBusinessWrites(0),
                meta: {
                    existing: sanitizedExisting,
                    userMessage: `${firstExisting.displayName} вже є в CRM (#${firstExisting.staffId}). Нічого не дублюю.`
                }
            }
        );
    }
}

async function assertHermesStaffRoleMapping(query, payload) {
    if (payload.primaryRole !== 'waiter') return;

    const categoryRule = staffProfessionCategoryRule(payload.primaryRole);
    const profession = await query.query(
        `SELECT key AS profession_key, title
         FROM hr_professions
         WHERE key = $1
           AND is_active = true
         LIMIT 1`,
        [payload.primaryRole]
    );
    const catalogRow = profession.rows[0] || null;
    const expected = {
        department: categoryRule?.displayGroup || null,
        position: catalogRow?.title || null,
        roleType: payload.primaryRole
    };
    const received = {
        department: payload.department,
        position: payload.position,
        roleType: payload.primaryRole
    };
    const consistent = expected.department === received.department
        && expected.position === received.position
        && catalogRow?.profession_key === received.roleType;

    if (!consistent) {
        throw hermesScheduleError(
            409,
            'INCONSISTENT_STAFF_ROLE_MAPPING',
            'Staff department, position, and roleType do not match the active waiter catalog mapping',
            {
                outcome: 'NO_CREATE',
                businessWrites: hermesStaffBusinessWrites(0),
                meta: { expected, received }
            }
        );
    }
}

async function lockHermesStaffCreateName(query, normalizedName) {
    await query.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedName]
    );
}

async function createHermesStaffRecord(query, payload) {
    const scheduleableSql = scheduleableStaffWhere('s', {
        dateExpression: 'CURRENT_DATE',
        includeFreelance: true
    });
    const result = await query.query(
        `WITH inserted AS (
             INSERT INTO staff (
                 name,
                 department,
                 position,
                 phone,
                 hire_date,
                 color,
                 telegram_username,
                 role_type,
                 address,
                 secondary_professions
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
             RETURNING id,
                       name,
                       display_name,
                       department,
                       position,
                       role_type,
                       secondary_professions,
                       is_active,
                       hr_pool_status,
                       termination_date,
                       is_freelance
         )
         SELECT s.id,
                s.name,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                s.department,
                s.position,
                s.role_type,
                COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                (${scheduleableSql}) AS scheduleable
         FROM inserted s`,
        [
            payload.name,
            payload.department,
            payload.position,
            payload.phone,
            payload.hireDate,
            payload.color,
            payload.telegramUsername,
            payload.primaryRole,
            payload.address,
            JSON.stringify(payload.secondaryRoles)
        ]
    );
    return result.rows[0];
}

function mapHermesScheduleCell(row = {}) {
    const cell = {
        staffId: Number(row.staff_id),
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || '').slice(0, 10),
        status: normalizeHermesScheduleStatus(row.status),
        startTime: row.shift_start ? String(row.shift_start).slice(0, 5) : null,
        endTime: row.shift_end ? String(row.shift_end).slice(0, 5) : null,
        note: row.note || null,
        professionKey: row.profession_key || null
    };
    return { ...cell, stateHash: buildScheduleCellStateHash(cell) };
}

async function notifyHermesScheduleApplySummary(db, changes = [], options = {}) {
    if (!changes.length) return { sent: false, reason: 'no_changes' };
    const staffIds = [...new Set(changes.map(change => Number(change.staffId)).filter(Boolean))];
    const staff = await db.query(
        `SELECT id, name, telegram_username
         FROM staff
         WHERE id = ANY($1::int[])`,
        [staffIds]
    );
    const staffById = new Map(staff.rows.map(row => [Number(row.id), row]));
    const details = changes.slice(0, 20).map(change => {
        const staffRow = staffById.get(Number(change.staffId));
        const staffLabel = staffRow?.telegram_username
            ? `@${staffRow.telegram_username}`
            : (staffRow?.name || `#${change.staffId}`);
        const time = change.plan?.plannedStart && change.plan?.plannedEnd
            ? ` · ${change.plan.plannedStart}–${change.plan.plannedEnd}`
            : '';
        return `• ${change.date} · ${staffLabel} · ${change.status}${time}`;
    });
    if (changes.length > details.length) details.push(`… ще ${changes.length - details.length} змін`);
    const previewId = options.previewId ? ` · ${options.previewId}` : '';
    const text = `📅 Hermes застосував графік (${changes.length})${previewId}\n${details.join('\n')}`;
    const getChatId = options.getConfiguredChatId || getConfiguredChatId;
    const sendMessage = options.sendTelegramMessage || sendTelegramMessage;
    const chatId = await getChatId();
    if (!chatId) return { sent: false, reason: 'chat_not_configured' };
    await sendMessage(chatId, text.length > 3900 ? `${text.slice(0, 3870)}\n…` : text);
    return { sent: true };
}

function broadcastHermesRosterDates(dates = [], actorUserId = null, options = {}) {
    const broadcastRoster = options.broadcastLineEvent || broadcastLineEvent;
    const uniqueDates = [...new Set(dates.map(value => String(value || '').slice(0, 10)).filter(Boolean))].sort();
    for (const date of uniqueDates) {
        broadcastRoster('timeline:roster-updated', {
            businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
            date
        }, actorUserId);
    }
    return uniqueDates;
}

function broadcastHermesAttendanceChanges(changes = [], actorUserId = null, options = {}) {
    if (!changes.length) return 0;
    const broadcastAttendance = options.broadcast || broadcast;
    const dates = [...new Set(changes.map(change => change.date).filter(Boolean))].sort();
    return broadcastAttendance('hr:attendance-updated', {
        businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
        dates,
        staffIds: [...new Set(changes.map(change => Number(change.staffId)).filter(Boolean))].sort((a, b) => a - b),
        attendanceRecordIds: [...new Set(changes
            .map(change => Number(change.attendanceRecordId))
            .filter(Boolean))].sort((a, b) => a - b),
        source: 'hermes_attendance_import'
    }, actorUserId, dates[0] || null);
}

function createHermesScheduleRouter(options = {}) {
    const router = express.Router();
    const db = options.pool;
    if (!db || typeof db.query !== 'function') {
        throw new Error('Hermes schedule router requires a queryable pool');
    }
    const applyMutationGuard = createHermesMutationGuard({
        integrationId: HERMES_INTEGRATION_ID,
        requireIntegrationId: true
    });
    const runWithIdempotency = options.withIdempotency || withHermesIdempotency;
    const applyScheduleImport = options.applyScheduleImport || applyHermesScheduleImport;
    const previewAttendanceImport = options.previewAttendanceImport || previewHermesAttendanceImport;
    const applyAttendanceImport = options.applyAttendanceImport || applyHermesAttendanceImport;
    const notifyScheduleBatch = options.notifyScheduleBatch || notifyHermesScheduleApplySummary;
    const broadcastRosterDates = options.broadcastRosterDates || broadcastHermesRosterDates;
    const broadcastAttendanceChanges = options.broadcastAttendanceChanges || broadcastHermesAttendanceChanges;

    const requireHermesScheduleAccess = (req, res, next) => {
        try {
            assertHermesScheduleAccess(req);
            next();
        } catch (error) {
            sendHermesScheduleError(res, error.statusCode || 403, error.code || 'HERMES_SCHEDULE_FORBIDDEN', error.message);
        }
    };

    router.post(
        '/staff',
        requireHermesScheduleAccess,
        (req, res, next) => {
            const approvalReceipt = sanitizeHermesStaffApprovalContext(req.body?.approvalContext);
            res.locals.hermesStaffApprovalReceipt = approvalReceipt;
            setHermesStaffAuditReceipt(req, approvalReceipt, {
                outcome: 'NO_CREATE',
                businessWrites: hermesStaffBusinessWrites(0)
            });
            next();
        },
        applyMutationGuard,
        (req, res, next) => {
            const approvalReceipt = res.locals.hermesStaffApprovalReceipt;
            setHermesStaffAuditReceipt(req, approvalReceipt, {
                outcome: 'NO_CREATE',
                businessWrites: hermesStaffBusinessWrites(0)
            });
            if (!canUseAction(req.user, 'hermes.staff.manage')) {
                return sendHermesScheduleError(
                    res,
                    403,
                    'HERMES_CAPABILITY_REQUIRED',
                    'Hermes actor does not have the required granular capability'
                );
            }
            return next();
        },
        async (req, res) => {
            if (typeof db.connect !== 'function') {
                return sendHermesScheduleError(
                    res,
                    503,
                    'HERMES_STAFF_TRANSACTION_UNAVAILABLE',
                    'Hermes staff create requires a transactional database pool'
                );
            }
            const approvalReceipt = res.locals.hermesStaffApprovalReceipt;
            try {
                normalizeHermesStaffApprovalContext(req.body?.approvalContext, approvalReceipt);
                const payload = normalizeHermesStaffCreatePayload(req.body || {});
                return await runWithIdempotency(req, res, async context => {
                    await lockHermesStaffCreateName(context.pool, payload.normalizedName);
                    try {
                        await assertHermesStaffRoleMapping(context.pool, payload);
                        await assertHermesStaffCreateUnique(context.pool, payload);
                    } catch (error) {
                        if (!error.statusCode || error.statusCode >= 500) throw error;
                        const body = hermesStaffCreateErrorBody(error);
                        body.meta = {
                            ...(body.meta || {}),
                            approvalContext: approvalReceipt
                        };
                        return {
                            status: error.statusCode || 409,
                            body
                        };
                    }
                    const created = await createHermesStaffRecord(context.pool, payload);
                    const data = mapHermesStaff(created);
                    const businessWrites = hermesStaffBusinessWrites(1);
                    return {
                        status: 201,
                        body: {
                            success: true,
                            ok: true,
                            outcome: 'CREATED_STAFF_ONLY',
                            staffId: data.staffId,
                            ...businessWrites,
                            data,
                            meta: {
                                businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                                staffWrites: 1,
                                scheduleWrites: 0,
                                scheduleTouched: false,
                                applyRequiresSeparateScheduleApproval: true,
                                sanitized: true,
                                approvalContext: approvalReceipt,
                                userMessage: `${data.displayName} створено у списку персоналу. Графік не змінювався.`
                            }
                        }
                    };
                }, {
                    pool: db,
                    transactional: true,
                    requestPath: '/api/hermes/staff',
                    onResult: result => syncHermesStaffAuditReceiptFromIdempotency(
                        req,
                        approvalReceipt,
                        result
                    )
                });
            } catch (error) {
                setHermesStaffAuditReceipt(req, approvalReceipt, {
                    outcome: 'NO_CREATE',
                    businessWrites: hermesStaffBusinessWrites(0)
                });
                if (error.statusCode && error.statusCode < 500) {
                    return sendHermesStaffCreateError(res, error);
                }
                log.error('POST /api/hermes/staff failed', error);
                return sendHermesScheduleError(
                    res,
                    500,
                    'HERMES_INTERNAL_ERROR',
                    'Failed to create Hermes staff member'
                );
            }
        }
    );

    router.get('/staff', requireHermesScheduleAccess, async (req, res) => {
        try {
            const scheduleableOnly = parseBoolean(req.query.scheduleable, true, 'scheduleable');
            const includeFreelance = parseBoolean(
                req.query.includeFreelance ?? req.query.include_freelance,
                false,
                'includeFreelance'
            );
            const limit = parseStaffLimit(req.query.limit);
            const cursor = decodeStaffCursor(req.query.cursor);
            const normalizedQuery = normalizeStaffQuery(req.query.q);
            const params = [];
            const where = [];
            const scheduleableSql = scheduleableStaffWhere('s', {
                dateExpression: 'CURRENT_DATE',
                includeFreelance
            });

            where.push(scheduleableOnly
                ? scheduleableSql
                : activeStaffWhere('s', {
                    poolMode: 'not_blacklisted',
                    dateExpression: 'CURRENT_DATE',
                    includeFreelance
                }));
            if (cursor) {
                params.push(cursor);
                where.push(`s.id > $${params.length}`);
            }
            if (normalizedQuery) {
                params.push(normalizedQuery);
                const ref = `$${params.length}`;
                where.push(`(
                    LOWER(REGEXP_REPLACE(BTRIM(s.name), '\\s+', ' ', 'g')) = ${ref}
                    OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\\s+', ' ', 'g')) = ${ref}
                )`);
            }
            params.push(limit + 1);
            const result = await db.query(
                `SELECT s.id,
                        s.name,
                        COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                        s.department,
                        s.position,
                        s.role_type,
                        COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                        (${scheduleableSql}) AS scheduleable
                 FROM staff s
                 WHERE ${where.join('\n                   AND ')}
                 ORDER BY s.id ASC
                 LIMIT $${params.length}`,
                params
            );
            const hasMore = result.rows.length > limit;
            const pageRows = result.rows.slice(0, limit);
            return res.json({
                success: true,
                items: pageRows.map(mapHermesStaff),
                pagination: {
                    nextCursor: hasMore && pageRows.length ? encodeStaffCursor(pageRows.at(-1).id) : null,
                    hasMore,
                    limit
                },
                meta: {
                    businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                    scheduleable: scheduleableOnly,
                    includeFreelance,
                    qMatch: normalizedQuery ? 'normalized_exact' : null,
                    sanitized: true,
                    readOnly: true
                }
            });
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('GET /api/hermes/staff failed', error);
            return sendHermesScheduleError(res, 500, 'HERMES_INTERNAL_ERROR', 'Failed to read Hermes staff');
        }
    });

    router.get('/staff-schedule', requireHermesScheduleAccess, async (req, res) => {
        try {
            const range = parseScheduleDateRange(req.query);
            const staffIds = parseStaffIds(req.query.staffIds ?? req.query.staff_ids);
            const params = [range.dateFrom, range.dateTo];
            const where = [
                'ss.date >= $1',
                'ss.date <= $2',
                scheduleableStaffWhere('s', { dateExpression: 'ss.date', includeFreelance: false })
            ];
            if (staffIds.length) {
                params.push(staffIds);
                where.push(`ss.staff_id = ANY($${params.length}::int[])`);
            }
            const result = await db.query(
                `SELECT ss.staff_id,
                        ss.date::text AS date,
                        ss.status,
                        ss.shift_start,
                        ss.shift_end,
                        ss.note,
                        ss.profession_key
                 FROM staff_schedule ss
                 JOIN staff s ON s.id = ss.staff_id
                 WHERE ${where.join('\n                   AND ')}
                 ORDER BY ss.date ASC, ss.staff_id ASC`,
                params
            );
            return res.json({
                success: true,
                items: result.rows.map(mapHermesScheduleCell),
                meta: {
                    businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                    dateFrom: range.dateFrom,
                    dateTo: range.dateTo,
                    days: range.days,
                    staffIds,
                    sanitized: true,
                    readOnly: true
                }
            });
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('GET /api/hermes/staff-schedule failed', error);
            return sendHermesScheduleError(res, 500, 'HERMES_INTERNAL_ERROR', 'Failed to read Hermes staff schedule');
        }
    });

    router.post(
        '/attendance/preview',
        requireHermesScheduleAccess,
        (req, res, next) => {
            if (!canUseAction(req.user, 'hermes.attendance.manage')) {
                return sendHermesScheduleError(
                    res,
                    403,
                    'HERMES_CAPABILITY_REQUIRED',
                    'Hermes actor does not have the required granular capability'
                );
            }
            return next();
        },
        async (req, res) => {
            try {
                const preview = await previewAttendanceImport(db, req.body || {}, {
                    actorUserId: req.integration?.actorUserId || req.user?.id,
                    businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT
                });
                return res.status(preview.created ? 201 : 200).json(preview);
            } catch (error) {
                if (error.statusCode && error.statusCode < 500) {
                    return sendHermesScheduleError(
                        res,
                        error.statusCode,
                        error.code || 'HERMES_ATTENDANCE_PREVIEW_INVALID',
                        error.message,
                        error.details
                    );
                }
                log.error('POST /api/hermes/attendance/preview failed', error);
                return sendHermesScheduleError(
                    res,
                    500,
                    'HERMES_INTERNAL_ERROR',
                    'Failed to create Hermes attendance preview'
                );
            }
        }
    );

    router.post(
        '/attendance/apply',
        requireHermesScheduleAccess,
        applyMutationGuard,
        (req, res, next) => {
            if (!canUseAction(req.user, 'hermes.attendance.manage')) {
                return sendHermesScheduleError(
                    res,
                    403,
                    'HERMES_CAPABILITY_REQUIRED',
                    'Hermes actor does not have the required granular capability'
                );
            }
            return next();
        },
        async (req, res) => {
            if (typeof db.connect !== 'function') {
                return sendHermesScheduleError(
                    res,
                    503,
                    'HERMES_ATTENDANCE_TRANSACTION_UNAVAILABLE',
                    'Hermes attendance apply requires a transactional database pool'
                );
            }
            try {
                return await runWithIdempotency(req, res, async context => {
                    const applied = await applyAttendanceImport(context.pool, req.body || {}, {
                        actor: { user: req.user, ip: req.ip },
                        actorUserId: req.integration?.actorUserId || req.user?.id,
                        businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                        integrationId: HERMES_INTEGRATION_ID
                    });
                    if (applied.changes.length) {
                        context.afterCommit.push(() => {
                            try {
                                broadcastAttendanceChanges(
                                    applied.changes,
                                    null
                                );
                            } catch (error) {
                                log.error('Hermes attendance broadcast failed', error);
                            }
                        });
                    }
                    return { status: 200, body: applied.response };
                }, {
                    pool: db,
                    transactional: true,
                    requestPath: '/api/hermes/attendance/apply'
                });
            } catch (error) {
                if (error.statusCode && error.statusCode < 500) {
                    return sendHermesScheduleError(
                        res,
                        error.statusCode,
                        error.code || 'HERMES_ATTENDANCE_APPLY_INVALID',
                        error.message,
                        error.details
                    );
                }
                log.error('POST /api/hermes/attendance/apply failed', error);
                return sendHermesScheduleError(
                    res,
                    500,
                    'HERMES_INTERNAL_ERROR',
                    'Failed to apply Hermes attendance preview'
                );
            }
        }
    );

    router.post('/staff-schedule/preview', requireHermesScheduleAccess, (req, res, next) => {
        if (!canUseAction(req.user, 'hermes.schedule.manage')) {
            return sendHermesScheduleError(res, 403, 'HERMES_CAPABILITY_REQUIRED', 'Hermes actor does not have the required granular capability');
        }
        return next();
    }, async (req, res) => {
        try {
            const preview = await previewHermesScheduleImport(db, req.body || {}, {
                actorUserId: req.integration?.actorUserId || req.user?.id,
                businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT
            });
            return res.status(preview.created ? 201 : 200).json(preview);
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('POST /api/hermes/staff-schedule/preview failed', error);
            return sendHermesScheduleError(
                res,
                500,
                'HERMES_INTERNAL_ERROR',
                'Failed to create Hermes schedule preview'
            );
        }
    });

    router.post(
        '/staff-schedule/apply',
        requireHermesScheduleAccess,
        applyMutationGuard,
        (req, res, next) => {
            if (!canUseAction(req.user, 'hermes.schedule.manage')) {
                return sendHermesScheduleError(
                    res,
                    403,
                    'HERMES_CAPABILITY_REQUIRED',
                    'Hermes actor does not have the required granular capability'
                );
            }
            return next();
        },
        async (req, res) => {
            if (typeof db.connect !== 'function') {
                return sendHermesScheduleError(
                    res,
                    503,
                    'HERMES_SCHEDULE_TRANSACTION_UNAVAILABLE',
                    'Hermes schedule apply requires a transactional database pool'
                );
            }
            try {
                return await runWithIdempotency(req, res, async context => {
                    const applied = await applyScheduleImport(context.pool, req.body || {}, {
                        actor: { user: req.user, ip: req.ip },
                        actorUserId: req.integration?.actorUserId || req.user?.id,
                        businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                        integrationId: HERMES_INTEGRATION_ID
                    });
                    if (applied.changes.length) {
                        context.afterCommit.push(() => {
                            Promise.resolve(notifyScheduleBatch(db, applied.changes, {
                                previewId: applied.response.previewId
                            })).catch(error => log.error('Hermes schedule apply notification failed', error));
                            broadcastRosterDates(
                                applied.dates,
                                req.integration?.actorUserId || req.user?.id
                            );
                        });
                    }
                    return { status: 200, body: applied.response };
                }, {
                    pool: db,
                    transactional: true,
                    requestPath: '/api/hermes/staff-schedule/apply'
                });
            } catch (error) {
                log.error('POST /api/hermes/staff-schedule/apply failed', error);
                return sendHermesScheduleError(
                    res,
                    500,
                    'HERMES_INTERNAL_ERROR',
                    'Failed to apply Hermes schedule preview'
                );
            }
        }
    );

    return router;
}

module.exports = createHermesScheduleRouter({
    pool: require('../db').pool
});
module.exports.createHermesScheduleRouter = createHermesScheduleRouter;
module.exports.decodeStaffCursor = decodeStaffCursor;
module.exports.encodeStaffCursor = encodeStaffCursor;
module.exports.mapHermesScheduleCell = mapHermesScheduleCell;
module.exports.mapHermesStaff = mapHermesStaff;
module.exports.broadcastHermesRosterDates = broadcastHermesRosterDates;
module.exports.broadcastHermesAttendanceChanges = broadcastHermesAttendanceChanges;
module.exports.notifyHermesScheduleApplySummary = notifyHermesScheduleApplySummary;
module.exports.parseScheduleDateRange = parseScheduleDateRange;
module.exports.parseStaffIds = parseStaffIds;
