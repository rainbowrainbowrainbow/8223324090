'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool: defaultPool } = require('../db');
const { canUseAction } = require('../middleware/auth');
const {
    actorCanManageTarget,
    createAccountOnboarding,
    normalizeAccountOnboardingPayload
} = require('./accountOnboarding');
const {
    generateOneTimePassword,
    linkUserToStaffProfile,
    normalizeUsername,
    oneTimeCredential,
    verifyIssuedCredential
} = require('./accountLinking');
const { recordAccountSecurityEvent } = require('./accountSecurity');

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

const ACCOUNT_MODE_CREATE = 'create';
const ACCOUNT_MODE_LINK_EXISTING = 'link_existing';
const ACCOUNT_MODE_REISSUE_EXISTING = 'reissue_existing';
const ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE = 'link_existing_and_reissue';
const EXISTING_ACCOUNT_MODES = new Set([
    ACCOUNT_MODE_LINK_EXISTING,
    ACCOUNT_MODE_REISSUE_EXISTING,
    ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE
]);

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


function booleanFrom(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'так';
}

function normalizeAccountMode(value) {
    const raw = cleanText(value || ACCOUNT_MODE_CREATE, 80)
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    if (!raw || ['create', 'create_new', 'new', 'new_account', 'issue_new', 'issue'].includes(raw)) return ACCOUNT_MODE_CREATE;
    if (['link', 'existing', 'existing_account', 'link_existing', 'attach_existing', 'attach'].includes(raw)) return ACCOUNT_MODE_LINK_EXISTING;
    if (['reissue', 'reset', 'reset_login', 'reset_password', 'reissue_existing', 'reissue_login', 'reissue_password'].includes(raw)) return ACCOUNT_MODE_REISSUE_EXISTING;
    if (['link_and_reissue', 'link_existing_and_reissue', 'attach_and_reissue', 'link_reset', 'attach_reset'].includes(raw)) return ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE;
    throw onboardingFlowError('Unsupported staff/account onboarding account.mode', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_MODE_UNSUPPORTED', { mode: raw });
}

function isExistingAccountMode(mode) {
    return EXISTING_ACCOUNT_MODES.has(mode);
}

function accountModeIssuesCredential(mode) {
    return mode === ACCOUNT_MODE_CREATE || mode === ACCOUNT_MODE_REISSUE_EXISTING || mode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE;
}

function requestTypeFor(mode, staffMode) {
    if (mode === ACCOUNT_MODE_LINK_EXISTING) return 'existing_staff_link_existing_account';
    if (mode === ACCOUNT_MODE_REISSUE_EXISTING) return 'existing_staff_reissue_existing_account';
    if (mode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE) return 'existing_staff_link_existing_account_reissue_login';
    return staffMode === 'existing' ? 'existing_staff_with_account' : 'new_staff_with_account';
}

function accountIntentFromSource(source = {}, accountSource = {}) {
    const requestedMode = source.accountMode ?? source.account_mode ?? accountSource.mode ?? accountSource.accountMode ?? accountSource.account_mode;
    const reissueRequested = booleanFrom(source.reissueLogin || source.reissue_login || source.reissuePassword || source.reissue_password || accountSource.reissueLogin || accountSource.reissue_login);
    const linkRequested = booleanFrom(source.linkExisting || source.link_existing || accountSource.linkExisting || accountSource.link_existing);
    let mode = normalizeAccountMode(requestedMode || (linkRequested && reissueRequested ? ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE : (linkRequested ? ACCOUNT_MODE_LINK_EXISTING : (reissueRequested ? ACCOUNT_MODE_REISSUE_EXISTING : ACCOUNT_MODE_CREATE))));
    if (mode === ACCOUNT_MODE_LINK_EXISTING && reissueRequested) mode = ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE;
    const userId = parsePositiveInt(source.accountId ?? source.account_id ?? source.userId ?? source.user_id ?? accountSource.id ?? accountSource.accountId ?? accountSource.account_id ?? accountSource.userId ?? accountSource.user_id, 'accountId');
    return {
        mode,
        userId,
        action: mode,
        issueOneTimeLogin: accountModeIssuesCredential(mode),
        linkExisting: mode === ACCOUNT_MODE_LINK_EXISTING || mode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE,
        reissueLogin: mode === ACCOUNT_MODE_REISSUE_EXISTING || mode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE
    };
}

function buildCanonicalPayload(input = {}) {
    const source = objectOrEmpty(input.payload || input);
    if (source.personal && source.staff && source.professions && source.access) {
        const accountSource = objectOrEmpty(source.account || source.crmAccount);
        const accountIntent = accountIntentFromSource(source, accountSource);
        const canonical = stripSecretFields(source);
        normalizeBusinessContext(canonical.businessContext || canonical.business_context || BUSINESS_CONTEXT);
        const staffMode = cleanText(canonical.staff?.mode || (canonical.staff?.id || canonical.staff?.staffId ? 'existing' : 'new'), 20).toLowerCase();
        canonical.flowVersion = cleanText(canonical.flowVersion || FLOW_VERSION, 80);
        canonical.account = {
            ...(canonical.account || {}),
            mode: accountIntent.mode,
            userId: accountIntent.userId || canonical.account?.userId || canonical.account?.id || undefined,
            username: canonical.account?.username || canonical.personal?.username || source.username || undefined,
            action: accountIntent.action,
            issueOneTimeLogin: accountIntent.issueOneTimeLogin,
            linkExisting: accountIntent.linkExisting,
            reissueLogin: accountIntent.reissueLogin
        };
        canonical.requestType = cleanText(canonical.requestType || requestTypeFor(accountIntent.mode, staffMode), 100);
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
    const accountSource = objectOrEmpty(source.account || source.crmAccount);
    const personalSource = objectOrEmpty(source.personal || accountSource);
    const accountIntent = accountIntentFromSource(source, accountSource);
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
        requestType: requestTypeFor(accountIntent.mode, mode),
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
        account: {
            mode: accountIntent.mode,
            userId: accountIntent.userId || undefined,
            username,
            action: accountIntent.action,
            issueOneTimeLogin: accountIntent.issueOneTimeLogin,
            linkExisting: accountIntent.linkExisting,
            reissueLogin: accountIntent.reissueLogin
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
        active: row.is_active !== false,
        linkedStaffId: row.linked_staff_id == null ? null : Number(row.linked_staff_id),
        linkedStaffName: row.linked_staff_name || null
    };
}

async function readDuplicatePreview(query, normalized, canonicalPayload = {}) {
    const account = objectOrEmpty(canonicalPayload.account);
    const accountMode = normalizeAccountMode(account.mode || ACCOUNT_MODE_CREATE);
    const usernameIdentity = String(normalized.personal.username || '').trim().toLowerCase();
    const accountUserId = parsePositiveInt(account.userId, 'accountId');
    const userParams = accountUserId ? [usernameIdentity, accountUserId] : [usernameIdentity];
    const userResultPromise = query.query(
        `SELECT u.id, u.username, u.name, u.role, COALESCE(u.is_active, true) AS is_active,
                ep.staff_id AS linked_staff_id, s.name AS linked_staff_name
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND COALESCE(ep.is_active, true) = true
         LEFT JOIN staff s ON s.id = ep.staff_id
         WHERE ${accountUserId ? 'u.id = $2 OR ' : ''}LOWER(u.username) = $1
            OR EXISTS (
                SELECT 1
                FROM unnest(COALESCE(u.login_aliases, '{}'::text[])) AS alias(value)
                WHERE LOWER(TRIM(alias.value)) = $1
            )
         ORDER BY CASE WHEN LOWER(u.username) = $1 THEN 0 ELSE 1 END, u.id ASC
         LIMIT 5`,
        userParams
    );
    const staffResultPromise = normalized.staff.mode === 'existing'
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
             WHERE LOWER(REGEXP_REPLACE(BTRIM(s.name), '\s+', ' ', 'g')) = LOWER($1)
                OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\s+', ' ', 'g')) = LOWER($1)
             ORDER BY s.id ASC
             LIMIT 5`,
            [normalized.personal.name]
        );

    const [userResult, staffResult] = await Promise.all([userResultPromise, staffResultPromise]);
    const users = (userResult.rows || []).map(mapUserDuplicate);
    const staff = (staffResult.rows || []).map(mapStaffDuplicate);
    const targetUser = accountUserId
        ? users.find(row => row.accountId === accountUserId) || null
        : users.find(row => String(row.username).toLowerCase() === usernameIdentity) || users[0] || null;
    const targetStaff = normalized.staff.mode === 'existing'
        ? staff.find(row => row.staffId === normalized.staff.id) || staff[0] || null
        : null;
    const staffMissing = normalized.staff.mode === 'existing' && staff.length === 0;
    const duplicateStaff = normalized.staff.mode === 'new' && staff.length > 0;
    const createMode = accountMode === ACCOUNT_MODE_CREATE;
    const existingMode = isExistingAccountMode(accountMode);
    const staffLinkedToOtherAccount = normalized.staff.mode === 'existing'
        && targetStaff?.linkedAccountId
        && (!targetUser || targetStaff.linkedAccountId !== targetUser.accountId);
    const accountMissing = existingMode && !targetUser;
    const accountInactive = existingMode && targetUser && targetUser.active === false;
    const accountLinkedToOtherStaff = existingMode
        && targetUser?.linkedStaffId
        && (normalized.staff.mode !== 'existing' || targetUser.linkedStaffId !== normalized.staff.id);
    const usernameOccupied = createMode && users.length > 0;
    const occupiedExistingStaff = createMode && normalized.staff.mode === 'existing' && staff.some(row => row.linkedAccountId);
    const blocked = Boolean(
        usernameOccupied
        || staffMissing
        || occupiedExistingStaff
        || duplicateStaff
        || accountMissing
        || accountInactive
        || staffLinkedToOtherAccount
        || accountLinkedToOtherStaff
    );

    return {
        username: {
            value: normalized.personal.username,
            exists: users.length > 0,
            matches: users
        },
        account: {
            mode: accountMode,
            userId: accountUserId || null,
            target: targetUser,
            exists: Boolean(targetUser),
            reissueLogin: accountMode === ACCOUNT_MODE_REISSUE_EXISTING || accountMode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE,
            linkExisting: accountMode === ACCOUNT_MODE_LINK_EXISTING || accountMode === ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE
        },
        staff: {
            mode: normalized.staff.mode,
            staffId: normalized.staff.id || null,
            exists: staff.length > 0,
            missing: staffMissing,
            occupied: createMode ? occupiedExistingStaff : staffLinkedToOtherAccount,
            duplicates: staff
        },
        blocked,
        blockers: [
            usernameOccupied ? 'USERNAME_OCCUPIED' : null,
            staffMissing ? 'STAFF_NOT_FOUND' : null,
            occupiedExistingStaff ? 'STAFF_ALREADY_LINKED' : null,
            duplicateStaff ? 'STAFF_NAME_ALREADY_EXISTS' : null,
            accountMissing ? 'ACCOUNT_NOT_FOUND' : null,
            accountInactive ? 'ACCOUNT_INACTIVE' : null,
            staffLinkedToOtherAccount ? 'STAFF_ALREADY_LINKED_TO_OTHER_ACCOUNT' : null,
            accountLinkedToOtherStaff ? 'ACCOUNT_ALREADY_LINKED_TO_OTHER_STAFF' : null
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
    const duplicates = await readDuplicatePreview(pool, normalized, canonicalPayload);
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


function isExistingAccountPayload(payload = {}) {
    return isExistingAccountMode(normalizeAccountMode(objectOrEmpty(payload.account).mode || ACCOUNT_MODE_CREATE));
}

async function loadExistingAccountForOnboarding(client, payload = {}) {
    const account = objectOrEmpty(payload.account);
    const accountId = parsePositiveInt(account.userId ?? account.id, 'accountId');
    const username = normalizeUsername(account.username || payload.personal?.username || '');
    if (!accountId && !username) {
        throw onboardingFlowError('Existing-account onboarding requires account.userId or account.username', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_REQUIRED');
    }
    const params = accountId ? [accountId, String(username).toLowerCase()] : [String(username).toLowerCase()];
    const result = await client.query(
        `SELECT id, username, name, role, extra_roles, is_active, password_hash
         FROM users
         WHERE ${accountId ? 'id = $1 OR ' : ''}LOWER(username) = $${accountId ? 2 : 1}
            OR EXISTS (
                SELECT 1
                FROM unnest(COALESCE(login_aliases, '{}'::text[])) AS alias(value)
                WHERE LOWER(TRIM(alias.value)) = $${accountId ? 2 : 1}
            )
         ORDER BY CASE WHEN ${accountId ? 'id = $1' : 'LOWER(username) = $1'} THEN 0 ELSE 1 END, id
         LIMIT 2
         FOR UPDATE`,
        params
    );
    const rows = result.rows || [];
    if (!rows.length) {
        throw onboardingFlowError('Existing account was not found for staff/account onboarding', 404, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_NOT_FOUND');
    }
    if (accountId && rows[0].id !== accountId) {
        throw onboardingFlowError('Existing account id/username resolved ambiguously', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_AMBIGUOUS');
    }
    return rows[0];
}

async function assertExistingAccountNotLinkedElsewhere(client, userId, staffId) {
    const result = await client.query(
        `SELECT ep.id, ep.staff_id, s.name AS staff_name
         FROM employee_profiles ep
         LEFT JOIN staff s ON s.id = ep.staff_id
         WHERE ep.user_id = $1
           AND COALESCE(ep.is_active, true) = true
         FOR UPDATE OF ep`,
        [userId]
    );
    const other = (result.rows || []).find(row => Number(row.staff_id) !== Number(staffId));
    if (other) {
        throw onboardingFlowError(
            'Existing account is already linked to another active staff profile',
            409,
            'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_ALREADY_LINKED_TO_OTHER_STAFF',
            { accountId: userId, staffId: other.staff_id, staffName: other.staff_name || null }
        );
    }
}

async function reissueOneTimeLoginForExistingAccount(client, user, { actor = {}, req = null } = {}) {
    const temporaryPassword = generateOneTimePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    if (!await bcrypt.compare(temporaryPassword, passwordHash)) {
        throw new Error('staff_account_onboarding_reissue_hash_verification_failed');
    }
    const updated = await client.query(
        `UPDATE users
         SET password_hash = $1,
             password_changed_at = NOW(),
             session_revoked_at = NOW(),
             is_active = true
         WHERE id = $2
         RETURNING id, username, name, role, extra_roles, is_active, password_changed_at, session_revoked_at`,
        [passwordHash, user.id]
    );
    const target = updated.rows[0];
    const loginCheck = await verifyIssuedCredential({
        client,
        username: target.username,
        password: temporaryPassword
    });
    if (!loginCheck.loginReady) {
        throw new Error(`staff_account_onboarding_reissue_login_ready_failed:${loginCheck.reason}`);
    }
    await recordAccountSecurityEvent({
        actor,
        target,
        eventType: 'password_one_time_reissued',
        reason: 'staff_account_onboarding',
        details: {
            source: 'hermes_staff_account_onboarding',
            oneTimeIssued: true,
            sessionsRevoked: true,
            loginReady: loginCheck.loginReady
        },
        req,
        client,
        strict: true
    });
    return {
        user: target,
        loginCheck,
        credential: oneTimeCredential(target.username, temporaryPassword, 'staff_account_onboarding_reissue')
    };
}

async function executeExistingAccountOnboardingAction({ pool = defaultPool, payload = {}, actor = {}, req = null } = {}) {
    const account = objectOrEmpty(payload.account);
    const accountMode = normalizeAccountMode(account.mode || ACCOUNT_MODE_CREATE);
    if (!isExistingAccountMode(accountMode)) {
        throw onboardingFlowError('Existing-account executor received create-account mode', 400, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_MODE_MISMATCH');
    }
    const normalized = normalizeAccountOnboardingPayload(payload);
    if (normalized.staff.mode !== 'existing' || !normalized.staff.id) {
        throw onboardingFlowError(
            'Existing-account link/reissue requires an already-read-back staff.id; create/reactivate roster first',
            409,
            'HERMES_STAFF_ACCOUNT_ONBOARDING_EXISTING_STAFF_REQUIRED'
        );
    }
    const client = await pool.connect();
    let linked;
    let credential = null;
    let loginReady = false;
    let loginReadyReason = 'not_checked';
    let user;
    try {
        await client.query('BEGIN');
        user = await loadExistingAccountForOnboarding(client, payload);
        if (!actorCanManageTarget(actor, user)) {
            throw onboardingFlowError('Недостатньо прав для прив’язки або перевипуску цього акаунта', 403, 'HERMES_STAFF_ACCOUNT_ONBOARDING_TARGET_FORBIDDEN');
        }
        if (user.is_active === false && !accountModeIssuesCredential(accountMode)) {
            throw onboardingFlowError('Existing account is inactive; choose reissue_existing or link_existing_and_reissue', 409, 'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_INACTIVE');
        }
        if (normalized.access.role && user.role !== normalized.access.role) {
            throw onboardingFlowError(
                'Existing account role differs from the requested staff role; account role changes require a separate access update',
                409,
                'HERMES_STAFF_ACCOUNT_ONBOARDING_ACCOUNT_ROLE_MISMATCH',
                { accountId: user.id, currentRole: user.role, requestedRole: normalized.access.role }
            );
        }
        await assertExistingAccountNotLinkedElsewhere(client, user.id, normalized.staff.id);
        linked = await linkUserToStaffProfile(client, {
            userId: user.id,
            staffId: normalized.staff.id,
            actor,
            req,
            eventType: accountMode === ACCOUNT_MODE_REISSUE_EXISTING ? 'staff_account_reissue_existing_link_verified' : 'staff_account_existing_linked',
            details: {
                source: 'hermes_staff_account_onboarding',
                accountMode,
                reissueLogin: accountModeIssuesCredential(accountMode)
            }
        });
        if (accountModeIssuesCredential(accountMode)) {
            const reissued = await reissueOneTimeLoginForExistingAccount(client, user, { actor, req });
            user = reissued.user;
            credential = reissued.credential;
            loginReady = reissued.loginCheck.loginReady;
            loginReadyReason = reissued.loginCheck.reason;
        } else {
            loginReady = user.is_active !== false;
            loginReadyReason = loginReady ? 'existing_active_account_password_not_reissued' : 'inactive_account';
        }
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }

    const receipt = {
        action: accountMode,
        account: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            active: user.is_active !== false
        },
        staff: {
            id: linked.staff.id,
            name: linked.staff.name,
            created: false,
            linked: true
        },
        profile: linked.profile,
        access: {
            role: user.role,
            businessContexts: normalized.access.businessContexts,
            defaultBusinessContext: normalized.access.defaultBusinessContext
        },
        postCommit: { defaultChatMemberships: 0 },
        warnings: [],
        nextActions: [
            { key: 'handoff_one_time_login', accountId: user.id, required: Boolean(credential) },
            { key: 'open_staff_card', staffId: linked.staff.id }
        ]
    };

    return {
        user,
        staff: linked.staff,
        receipt,
        loginReady,
        loginReadyReason,
        credential,
        meta: {
            staffWrites: 0,
            staffProfileWrites: 1,
            accountWrites: accountModeIssuesCredential(accountMode) ? 1 : 0,
            scheduleWrites: 0,
            salaryWrites: 0,
            staffTelegramNotifications: 0,
            credentialIssued: Boolean(credential),
            credentialReturned: Boolean(credential),
            oneTimeCredentialOnly: Boolean(credential),
            secureCredentialHandoffRequired: Boolean(credential),
            sanitizedResultStored: true,
            accountMode
        }
    };
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
    createAccountOnboardingImpl = createAccountOnboarding,
    existingAccountActionImpl = executeExistingAccountOnboardingAction
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
        const requestPayload = jsonValue(row.request_payload, {});
        execution = isExistingAccountPayload(requestPayload)
            ? await existingAccountActionImpl({
                pool,
                payload: requestPayload,
                actor,
                req
            })
            : await createAccountOnboardingImpl({
                payload: requestPayload,
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
             credential_issued = $4,
             execution_error_code = NULL,
             execution_error_message = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [row.id, STATUS_EXECUTED, JSON.stringify(safeReceipt), Boolean(execution.credential)]
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
            oneTimeCredentialOnly: true,
            secureCredentialHandoffRequired: true,
            sanitizedResultStored: true,
            ...(execution.meta || {}),
            credentialIssued: Boolean(execution.credential),
            credentialReturned: Boolean(execution.credential)
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
    ACCOUNT_MODE_CREATE,
    ACCOUNT_MODE_LINK_EXISTING,
    ACCOUNT_MODE_REISSUE_EXISTING,
    ACCOUNT_MODE_LINK_EXISTING_AND_REISSUE,
    buildCanonicalPayload,
    suggestUsernameFromName,
    redactSecrets,
    previewStaffAccountOnboarding,
    createPendingStaffAccountOnboardingRequest,
    getStaffAccountOnboardingRequest,
    rejectStaffAccountOnboardingRequest,
    approveStaffAccountOnboardingRequest,
    executeExistingAccountOnboardingAction,
    normalizeAccountMode,
    mapRequestRow,
    onboardingFlowError
};
