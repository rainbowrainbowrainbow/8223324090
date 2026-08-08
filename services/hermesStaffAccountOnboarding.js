'use strict';

const crypto = require('crypto');
const { pool: defaultPool } = require('../db');
const { canUseAction } = require('../middleware/auth');
const {
    createAccountOnboarding,
    normalizeAccountOnboardingPayload
} = require('./accountOnboarding');
const { normalizeUsername } = require('./accountLinking');

const FLOW_VERSION = 'EG_STAFF_ACCOUNT_ONBOARDING_APPROVAL_FLOW_V1';
const BUSINESS_CONTEXT = 'event_genix';
const DEFAULT_PRIMARY_APPROVER_USER_ID = 4;
const DEFAULT_FALLBACK_APPROVER_USER_ID = 4;
const DEFAULT_FALLBACK_AFTER_HOURS = 2;

const STATUS_PENDING = 'pending_approval';
const STATUS_REJECTED = 'rejected';
const STATUS_EXECUTING = 'executing';
const STATUS_EXECUTED = 'executed';
const STATUS_FAILED = 'failed';

const SECRET_MATERIAL_FIELD_RE = /password|secret|token|api[_-]?key|cookie|session/i;
const STORAGE_SECRET_FIELD_RE = /password|credential|secret|token|api[_-]?key|cookie|session/i;
const STAFF_ACCOUNT_APPROVAL_ALLOWED_STATUSES = new Set([
    STATUS_PENDING,
    STATUS_REJECTED,
    STATUS_EXECUTING,
    STATUS_EXECUTED,
    STATUS_FAILED
]);

const ROLE_PRESETS = [
    {
        key: 'animator',
        department: 'animators',
        position: 'Аніматор',
        professionKey: 'animator',
        accountRole: 'animator',
        words: ['аніматор', 'аниматор', 'animator']
    },
    {
        key: 'admin',
        department: 'admin',
        position: 'Адміністратор',
        professionKey: 'admin',
        accountRole: 'admin',
        words: ['адміністратор', 'администратор', 'admin']
    }
];

const UK_TRANSLIT = Object.freeze({
    а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', ы: 'y', э: 'e', ё: 'yo', ъ: ''
});

function onboardingFlowError(message, statusCode = 400, code = 'HERMES_STAFF_ACCOUNT_ONBOARDING_INVALID', details = undefined) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
}

function objectOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, maxLength = 200) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function parsePositiveInt(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw onboardingFlowError(`${fieldName} must be a positive integer`, 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_INVALID_ID', { fieldName });
    }
    return parsed;
}

function normalizeBusinessContext(value) {
    const normalized = cleanText(value || BUSINESS_CONTEXT, 64).toLowerCase();
    if (normalized !== BUSINESS_CONTEXT) {
        throw onboardingFlowError(
            'Bot-native staff/account onboarding currently supports event_genix only',
            403,
            'HERMES_STAFF_ACCOUNT_ONBOARDING_BUSINESS_CONTEXT_UNAVAILABLE',
            { businessContext: normalized || null }
        );
    }
    return BUSINESS_CONTEXT;
}

function requireStaffAccountOnboardingActor(actor = {}) {
    if (!canUseAction(actor, 'hermes.staff.manage') || !canUseAction(actor, 'manage_accounts')) {
        throw onboardingFlowError(
            'Hermes actor needs hermes.staff.manage and manage_accounts for staff/account onboarding',
            403,
            'HERMES_STAFF_ACCOUNT_ONBOARDING_ACTION_FORBIDDEN'
        );
    }
    return true;
}

function rolePresetForText(text = '') {
    const normalized = cleanText(text, 500).toLocaleLowerCase('uk-UA');
    return ROLE_PRESETS.find(preset => preset.words.some(word => normalized.includes(word))) || null;
}

function rolePresetByKey(key) {
    const normalized = cleanText(key, 80).toLowerCase();
    return ROLE_PRESETS.find(preset => [preset.key, preset.professionKey, preset.accountRole].includes(normalized)) || null;
}

function stripNaturalCommandToName(text, preset) {
    let value = cleanText(text, 500);
    const removePatterns = [
        /(створи|створити|додай|добав|заведи|зроби|підготуй|працівника|працівницю|співробітника|співробітницю|нового|нову|новий)/giu,
        /(з|із|iз)?\s*(crm\s*)?(акаунтом|аккаунтом|account|логіном|логін|паролем|пароль)/giu,
        /в\s*crm/giu
    ];
    for (const pattern of removePatterns) value = value.replace(pattern, ' ');
    if (preset) {
        for (const word of preset.words) {
            const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            value = value.replace(new RegExp(`${escaped}[а-яіїєґ]*`, 'giu'), ' ');
        }
    }
    return cleanText(value.replace(/[,:;—-]+/g, ' '), 160);
}

function transliterateToken(value) {
    return cleanText(value, 80)
        .toLowerCase()
        .split('')
        .map(ch => UK_TRANSLIT[ch] ?? ch)
        .join('')
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 32);
}

function suggestUsernameFromName(name) {
    const parts = cleanText(name, 100).split(/\s+/).map(transliterateToken).filter(Boolean);
    if (parts.length >= 2) return normalizeUsername(`${parts[0]}.${parts[parts.length - 1]}`).slice(0, 50);
    if (parts.length === 1) return normalizeUsername(parts[0]).slice(0, 50);
    return '';
}

function redactSecrets(value) {
    if (Array.isArray(value)) return value.map(redactSecrets);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (SECRET_MATERIAL_FIELD_RE.test(key)) {
            output[key] = '[REDACTED]';
        } else {
            output[key] = redactSecrets(child);
        }
    }
    return output;
}

function stripSecretFields(value) {
    if (Array.isArray(value)) return value.map(stripSecretFields);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (STORAGE_SECRET_FIELD_RE.test(key)) continue;
        output[key] = stripSecretFields(child);
    }
    return output;
}

function jsonValue(value, fallback = null) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
}

function buildCanonicalPayload(input = {}) {
    const source = objectOrEmpty(input.payload || input);
    if (source.personal && source.staff && source.professions && source.access) {
        const canonical = stripSecretFields(source);
        normalizeBusinessContext(canonical.businessContext || canonical.business_context || BUSINESS_CONTEXT);
        canonical.flowVersion = cleanText(canonical.flowVersion || FLOW_VERSION, 80);
        canonical.requestType = cleanText(canonical.requestType || 'new_staff_with_account', 80);
        return canonical;
    }

    const text = cleanText(source.text || source.command || source.message || '', 500);
    const presetFromText = rolePresetForText(text);
    const explicitProfession = cleanText(
        source.professionKey || source.profession_key || source.roleType || source.role_type || source.role || '',
        80
    );
    const preset = rolePresetByKey(explicitProfession) || presetFromText;
    const staffSource = objectOrEmpty(source.staff || source.hrProfile);
    const personalSource = objectOrEmpty(source.personal || source.account || source.crmAccount);
    const rawStaffId = source.staffId ?? source.staff_id ?? staffSource.id ?? staffSource.staffId;
    const staffId = parsePositiveInt(rawStaffId, 'staffId');
    const mode = staffId ? 'existing' : cleanText(staffSource.mode || source.staffMode || 'new', 20).toLowerCase();
    if (!['new', 'existing'].includes(mode)) {
        throw onboardingFlowError('staff.mode must be new or existing', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_INVALID_STAFF_MODE');
    }

    const name = cleanText(
        source.name || personalSource.name || staffSource.name || (text ? stripNaturalCommandToName(text, preset) : ''),
        100
    );
    if (!name) {
        throw onboardingFlowError('Employee name is required', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_NAME_REQUIRED');
    }

    const username = normalizeUsername(source.username || personalSource.username || suggestUsernameFromName(name));
    if (!username) {
        throw onboardingFlowError('Username could not be generated', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_USERNAME_REQUIRED');
    }

    const professionKey = cleanText(
        source.professionKey || source.profession_key || preset?.professionKey || staffSource.roleType || staffSource.role_type || 'animator',
        80
    ).toLowerCase();
    const rolePreset = rolePresetByKey(professionKey) || preset;
    const department = cleanText(source.department || staffSource.department || rolePreset?.department, 80);
    const position = cleanText(source.position || staffSource.position || rolePreset?.position, 120);
    const accountRole = cleanText(source.accountRole || source.account_role || source.role || rolePreset?.accountRole || professionKey, 80).toLowerCase();

    const canonical = {
        flowVersion: FLOW_VERSION,
        requestType: mode === 'existing' ? 'existing_staff_with_account' : 'new_staff_with_account',
        businessContext: BUSINESS_CONTEXT,
        personal: {
            name,
            username,
            phone: cleanText(source.phone || personalSource.phone || staffSource.phone || '', 30) || undefined
        },
        staff: mode === 'existing'
            ? { mode, id: staffId }
            : {
                mode,
                department,
                position,
                hireDate: source.hireDate || staffSource.hireDate || staffSource.hire_date || undefined
            },
        professions: [{ key: professionKey, isPrimary: true }],
        access: {
            role: accountRole,
            businessContexts: [BUSINESS_CONTEXT],
            defaultBusinessContext: BUSINESS_CONTEXT
        },
        oneTimeLoginPolicy: 'readable_temp_v1',
        forbiddenSideEffects: {
            scheduleWrites: true,
            salaryWrites: true,
            staffTelegramNotifications: true
        }
    };

    return stripSecretFields(canonical);
}

function mapStaffDuplicate(row = {}) {
    return {
        staffId: Number(row.id ?? row.staff_id ?? row.staffId),
        name: row.name || row.display_name || row.displayName || '',
        displayName: row.display_name || row.displayName || row.name || '',
        department: row.department || null,
        position: row.position || null,
        roleType: row.role_type || row.roleType || null,
        linkedAccountId: row.linked_account_id == null ? null : Number(row.linked_account_id),
        linkedUsername: row.linked_username || null,
        active: row.is_active !== false
    };
}

function mapUserDuplicate(row = {}) {
    return {
        accountId: Number(row.id ?? row.account_id ?? row.accountId),
        username: row.username || '',
        name: row.name || '',
        role: row.role || null,
        active: row.is_active !== false
    };
}

async function readDuplicatePreview(query, normalized) {
    const usernameIdentity = String(normalized.personal.username || '').trim().toLowerCase();
    const [userResult, staffResult] = await Promise.all([
        query.query(
            `SELECT id, username, name, role, COALESCE(is_active, true) AS is_active
             FROM users
             WHERE LOWER(username) = $1
                OR EXISTS (
                    SELECT 1
                    FROM unnest(COALESCE(login_aliases, '{}'::text[])) AS alias(value)
                    WHERE LOWER(TRIM(alias.value)) = $1
                )
             ORDER BY id ASC
             LIMIT 5`,
            [usernameIdentity]
        ),
        normalized.staff.mode === 'existing'
            ? query.query(
                `SELECT s.id, s.name, COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                        s.department, s.position, s.role_type, COALESCE(s.is_active, true) AS is_active,
                        ep.user_id AS linked_account_id, u.username AS linked_username
                 FROM staff s
                 LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND COALESCE(ep.is_active, true) = true
                 LEFT JOIN users u ON u.id = ep.user_id
                 WHERE s.id = $1
                 ORDER BY ep.user_id NULLS LAST
                 LIMIT 5`,
                [normalized.staff.id]
            )
            : query.query(
                `SELECT s.id, s.name, COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                        s.department, s.position, s.role_type, COALESCE(s.is_active, true) AS is_active,
                        ep.user_id AS linked_account_id, u.username AS linked_username
                 FROM staff s
                 LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND COALESCE(ep.is_active, true) = true
                 LEFT JOIN users u ON u.id = ep.user_id
                 WHERE LOWER(REGEXP_REPLACE(BTRIM(s.name), '\\s+', ' ', 'g')) = LOWER($1)
                    OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\\s+', ' ', 'g')) = LOWER($1)
                 ORDER BY s.id ASC
                 LIMIT 5`,
                [normalized.personal.name]
            )
    ]);

    const users = (userResult.rows || []).map(mapUserDuplicate);
    const staff = (staffResult.rows || []).map(mapStaffDuplicate);
    const staffMissing = normalized.staff.mode === 'existing' && staff.length === 0;
    const occupiedExistingStaff = normalized.staff.mode === 'existing' && staff.some(row => row.linkedAccountId);
    const duplicateStaff = normalized.staff.mode === 'new' && staff.length > 0;
    const blocked = users.length > 0 || staffMissing || occupiedExistingStaff || duplicateStaff;

    return {
        username: {
            value: normalized.personal.username,
            exists: users.length > 0,
            matches: users
        },
        staff: {
            mode: normalized.staff.mode,
            staffId: normalized.staff.id || null,
            exists: staff.length > 0,
            missing: staffMissing,
            occupied: occupiedExistingStaff,
            duplicates: staff
        },
        blocked,
        blockers: [
            users.length ? 'USERNAME_OCCUPIED' : null,
            staffMissing ? 'STAFF_NOT_FOUND' : null,
            occupiedExistingStaff ? 'STAFF_ALREADY_LINKED' : null,
            duplicateStaff ? 'STAFF_NAME_ALREADY_EXISTS' : null
        ].filter(Boolean)
    };
}

function approvalConfigFrom(input = {}) {
    const source = objectOrEmpty(input.approval || input.approvalConfig || input);
    return {
        primaryApproverUserId: parsePositiveInt(source.primaryApproverUserId ?? source.primary_approver_user_id, 'primaryApproverUserId') || DEFAULT_PRIMARY_APPROVER_USER_ID,
        fallbackApproverUserId: parsePositiveInt(source.fallbackApproverUserId ?? source.fallback_approver_user_id, 'fallbackApproverUserId') || DEFAULT_FALLBACK_APPROVER_USER_ID,
        fallbackAfterHours: Number.isFinite(Number(source.fallbackAfterHours ?? source.fallback_after_hours))
            ? Math.max(1, Math.min(72, Number(source.fallbackAfterHours ?? source.fallback_after_hours)))
            : DEFAULT_FALLBACK_AFTER_HOURS
    };
}

function previewStatus(duplicates) {
    if (duplicates.blocked) return 'BLOCKED_DUPLICATE_OR_STALE';
    return 'READY_FOR_APPROVAL';
}

async function previewStaffAccountOnboarding({ pool = defaultPool, payload = {}, actor = {}, approval = {} } = {}) {
    requireStaffAccountOnboardingActor(actor);
    const canonicalPayload = buildCanonicalPayload(payload);
    normalizeBusinessContext(canonicalPayload.businessContext || BUSINESS_CONTEXT);
    const normalized = normalizeAccountOnboardingPayload(canonicalPayload);
    const duplicates = await readDuplicatePreview(pool, normalized);
    const status = previewStatus(duplicates);
    const approvalConfig = approvalConfigFrom(approval);
    return {
        success: true,
        status,
        readyForApproval: status === 'READY_FOR_APPROVAL',
        flowVersion: FLOW_VERSION,
        requestType: canonicalPayload.requestType,
        payload: redactSecrets(canonicalPayload),
        normalized: redactSecrets({
            personal: normalized.personal,
            staff: normalized.staff,
            primaryProfessionKey: normalized.primaryProfessionKey,
            access: normalized.access
        }),
        duplicateCheck: duplicates,
        approval: approvalConfig,
        sideEffects: {
            staffWrites: 0,
            accountWrites: 0,
            scheduleWrites: 0,
            salaryWrites: 0,
            staffTelegramNotifications: 0,
            oneTimeLoginIssued: false
        },
        oneTimeLoginPolicy: 'readable_temp_v1',
        oneTimeLoginMaterialPresent: false,
        sanitized: true
    };
}

function mapRequestRow(row = {}) {
    const result = jsonValue(row.result_receipt, null);
    return {
        id: Number(row.id),
        requestId: row.request_uuid,
        flowVersion: row.flow_version || FLOW_VERSION,
        requestType: row.request_type || null,
        status: row.status,
        requestedByUserId: row.requested_by_user_id == null ? null : Number(row.requested_by_user_id),
        primaryApproverUserId: row.primary_approver_user_id == null ? null : Number(row.primary_approver_user_id),
        fallbackApproverUserId: row.fallback_approver_user_id == null ? null : Number(row.fallback_approver_user_id),
        fallbackAfterHours: row.fallback_after_hours == null ? null : Number(row.fallback_after_hours),
        approvedByUserId: row.approved_by_user_id == null ? null : Number(row.approved_by_user_id),
        rejectedByUserId: row.rejected_by_user_id == null ? null : Number(row.rejected_by_user_id),
        payload: redactSecrets(jsonValue(row.request_payload, {})),
        preview: redactSecrets(jsonValue(row.preview_payload, {})),
        result: redactSecrets(result),
        credentialIssued: row.credential_issued === true,
        oneTimeCredentialAvailable: false,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        executedAt: row.executed_at || null,
        rejectedAt: row.rejected_at || null
    };
}

async function createPendingStaffAccountOnboardingRequest({ pool = defaultPool, payload = {}, actor = {}, approval = {} } = {}) {
    const preview = await previewStaffAccountOnboarding({ pool, payload, actor, approval });
    if (!preview.readyForApproval) {
        throw onboardingFlowError(
            'Staff/account onboarding request is blocked by duplicate or stale data',
            409,
            'HERMES_STAFF_ACCOUNT_ONBOARDING_PREVIEW_BLOCKED',
            preview.duplicateCheck
        );
    }
    const approvalConfig = preview.approval;
    const requestUuid = crypto.randomUUID();
    const result = await pool.query(
        `INSERT INTO staff_account_onboarding_approvals (
             request_uuid,
             flow_version,
             request_type,
             status,
             requested_by_user_id,
             primary_approver_user_id,
             fallback_approver_user_id,
             fallback_after_hours,
             request_payload,
             preview_payload,
             credential_issued
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, false)
         RETURNING *`,
        [
            requestUuid,
            FLOW_VERSION,
            preview.requestType,
            STATUS_PENDING,
            actor.id || null,
            approvalConfig.primaryApproverUserId,
            approvalConfig.fallbackApproverUserId,
            approvalConfig.fallbackAfterHours,
            JSON.stringify(preview.payload),
            JSON.stringify(preview)
        ]
    );
    return {
        success: true,
        request: mapRequestRow(result.rows[0]),
        meta: {
            staffWrites: 0,
            accountWrites: 0,
            scheduleWrites: 0,
            salaryWrites: 0,
            staffTelegramNotifications: 0,
            credentialIssued: false,
            sanitized: true,
            nextAction: 'send_approver_card'
        }
    };
}

async function getStaffAccountOnboardingRequest({ pool = defaultPool, requestId } = {}) {
    const result = await pool.query(
        `SELECT *
         FROM staff_account_onboarding_approvals
         WHERE request_uuid = $1 OR id::text = $1
         LIMIT 1`,
        [String(requestId || '').trim()]
    );
    if (!result.rows.length) {
        throw onboardingFlowError('Staff/account onboarding request not found', 404, 'HERMES_STAFF_ACCOUNT_ONBOARDING_NOT_FOUND');
    }
    return mapRequestRow(result.rows[0]);
}

function assertRequestStatus(row) {
    if (!STAFF_ACCOUNT_APPROVAL_ALLOWED_STATUSES.has(row.status)) {
        throw onboardingFlowError('Staff/account onboarding request has an unknown status', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_BAD_STATUS', { status: row.status });
    }
}

async function rejectStaffAccountOnboardingRequest({ pool = defaultPool, requestId, actor = {}, reason = '' } = {}) {
    requireStaffAccountOnboardingActor(actor);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT *
             FROM staff_account_onboarding_approvals
             WHERE request_uuid = $1 OR id::text = $1
             FOR UPDATE`,
            [String(requestId || '').trim()]
        );
        const row = current.rows[0];
        if (!row) throw onboardingFlowError('Staff/account onboarding request not found', 404, 'HERMES_STAFF_ACCOUNT_ONBOARDING_NOT_FOUND');
        assertRequestStatus(row);
        if (row.status === STATUS_EXECUTED) {
            throw onboardingFlowError('Executed onboarding request cannot be rejected', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ALREADY_EXECUTED');
        }
        if (row.status === STATUS_REJECTED) {
            await client.query('COMMIT');
            return { success: true, request: mapRequestRow(row), meta: { alreadyRejected: true, staffWrites: 0, accountWrites: 0, credentialIssued: false } };
        }
        const updated = await client.query(
            `UPDATE staff_account_onboarding_approvals
             SET status = $2,
                 rejected_by_user_id = $3,
                 rejected_at = NOW(),
                 rejection_reason = $4,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [row.id, STATUS_REJECTED, actor.id || null, cleanText(reason, 500) || null]
        );
        await client.query('COMMIT');
        return {
            success: true,
            request: mapRequestRow(updated.rows[0]),
            meta: { staffWrites: 0, accountWrites: 0, scheduleWrites: 0, credentialIssued: false, sanitized: true }
        };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

function sanitizedExecutionReceipt(execution = {}) {
    return redactSecrets({
        receipt: execution.receipt || null,
        loginReady: execution.loginReady === true,
        loginReadyReason: execution.loginReadyReason || null,
        staff: execution.staff ? {
            id: execution.staff.id,
            name: execution.staff.name,
            department: execution.staff.department,
            position: execution.staff.position,
            roleType: execution.staff.role_type || execution.staff.roleType || null
        } : null,
        account: execution.user ? {
            id: execution.user.id,
            username: execution.user.username,
            name: execution.user.name,
            role: execution.user.role,
            active: execution.user.is_active !== false
        } : null,
        credentialIssued: Boolean(execution.credential),
        credential: execution.credential ? { username: execution.credential.username, password: '[REDACTED]', oneTime: true, source: execution.credential.source } : null
    });
}

async function markExecutionFailed(pool, row, error) {
    try {
        await pool.query(
            `UPDATE staff_account_onboarding_approvals
             SET status = $2,
                 execution_error_code = $3,
                 execution_error_message = $4,
                 updated_at = NOW()
             WHERE id = $1`,
            [row.id, STATUS_FAILED, cleanText(error.code || 'ACCOUNT_ONBOARDING_FAILED', 80), cleanText(error.message || 'Account onboarding failed', 500)]
        );
    } catch {}
}

async function approveStaffAccountOnboardingRequest({
    pool = defaultPool,
    requestId,
    actor = {},
    req = null,
    createAccountOnboardingImpl = createAccountOnboarding
} = {}) {
    requireStaffAccountOnboardingActor(actor);
    const id = String(requestId || '').trim();
    if (!id) throw onboardingFlowError('requestId is required', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ID_REQUIRED');

    const client = await pool.connect();
    let row;
    try {
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT *
             FROM staff_account_onboarding_approvals
             WHERE request_uuid = $1 OR id::text = $1
             FOR UPDATE`,
            [id]
        );
        row = current.rows[0];
        if (!row) throw onboardingFlowError('Staff/account onboarding request not found', 404, 'HERMES_STAFF_ACCOUNT_ONBOARDING_NOT_FOUND');
        assertRequestStatus(row);
        if (row.status === STATUS_EXECUTED) {
            await client.query('COMMIT');
            return {
                success: true,
                request: mapRequestRow(row),
                credential: null,
                meta: { alreadyExecuted: true, credentialIssued: row.credential_issued === true, credentialReturned: false, sanitized: true }
            };
        }
        if (row.status === STATUS_REJECTED) {
            throw onboardingFlowError('Rejected onboarding request cannot be approved', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_REJECTED');
        }
        if (row.status === STATUS_EXECUTING) {
            throw onboardingFlowError('Onboarding request is already executing; no second credential will be generated', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_EXECUTION_IN_PROGRESS');
        }
        await client.query(
            `UPDATE staff_account_onboarding_approvals
             SET status = $2,
                 approved_by_user_id = $3,
                 approved_at = COALESCE(approved_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1`,
            [row.id, STATUS_EXECUTING, actor.id || null]
        );
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }

    let execution;
    try {
        execution = await createAccountOnboardingImpl({
            payload: jsonValue(row.request_payload, {}),
            actor,
            req,
            dbPool: pool
        });
    } catch (error) {
        await markExecutionFailed(pool, row, error);
        throw error;
    }

    const safeReceipt = sanitizedExecutionReceipt(execution);
    const updated = await pool.query(
        `UPDATE staff_account_onboarding_approvals
         SET status = $2,
             executed_at = NOW(),
             result_receipt = $3::jsonb,
             credential_issued = true,
             execution_error_code = NULL,
             execution_error_message = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [row.id, STATUS_EXECUTED, JSON.stringify(safeReceipt)]
    );

    return {
        success: true,
        request: mapRequestRow(updated.rows[0]),
        credential: execution.credential || null,
        meta: {
            staffWrites: 1,
            accountWrites: 1,
            scheduleWrites: 0,
            salaryWrites: 0,
            staffTelegramNotifications: 0,
            credentialIssued: Boolean(execution.credential),
            credentialReturned: Boolean(execution.credential),
            oneTimeCredentialOnly: true,
            secureCredentialHandoffRequired: true,
            sanitizedResultStored: true
        }
    };
}

module.exports = {
    FLOW_VERSION,
    BUSINESS_CONTEXT,
    STATUS_PENDING,
    STATUS_REJECTED,
    STATUS_EXECUTING,
    STATUS_EXECUTED,
    STATUS_FAILED,
    buildCanonicalPayload,
    suggestUsernameFromName,
    redactSecrets,
    previewStaffAccountOnboarding,
    createPendingStaffAccountOnboardingRequest,
    getStaffAccountOnboardingRequest,
    rejectStaffAccountOnboardingRequest,
    approveStaffAccountOnboardingRequest,
    mapRequestRow,
    onboardingFlowError
};
