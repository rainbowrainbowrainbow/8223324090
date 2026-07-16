'use strict';

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const {
    ROLE_HIERARCHY,
    ROLE_LEVEL,
    ACTION_PERMISSIONS,
    NON_DELEGABLE_ACTIONS,
    canUseAction
} = require('../middleware/auth');
const {
    BUSINESS_CONTEXTS,
    DEFAULT_BUSINESS_CONTEXT
} = require('./businessContext');
const {
    generateOneTimePassword,
    oneTimeCredential,
    verifyIssuedCredential,
    reserveUsernameIdentity,
    linkUserToStaffProfile
} = require('./accountLinking');
const { recordAccountSecurityEvent } = require('./accountSecurity');
const {
    normalizeProfessionKey,
    normalizeProfessionKeyArray,
    professionCatalogInventory,
    saveStaffProfessionCondition
} = require('./professions');
const { normalizeStaffCompanyStructurePayload } = require('./staffDisplayGroups');

const SYSTEM_ACCOUNT_USERNAMES = Object.freeze(['guardian', 'system']);
const SYSTEM_ACCOUNT_USERNAME = SYSTEM_ACCOUNT_USERNAMES;
const SYSTEM_ACCOUNT_USERNAME_PREFIXES = Object.freeze(['openclaw', 'open_claw', 'open-claw']);

const PROFESSION_ACCOUNT_ROLE_MAP = Object.freeze({
    trampoline_instructor: 'animator',
    cleaner: 'cleaning',
    technician: 'maintenance',
    head_cook: 'head_chef',
    bartender: 'barista',
    hr_manager: 'hr',
    pizzaiolo: 'cook',
    host: 'animator',
    intern: 'animator'
});

const ASSIGNMENT_STATUSES = new Set(['active', 'inactive', 'suspended']);
const ADMISSION_STATUSES = new Set(['pending', 'approved', 'blocked']);
const INTERNSHIP_STATUSES = new Set(['none', 'in_progress', 'completed']);
const RATE_UNITS = new Set(['hour', 'day', 'month']);
const DAY_TYPES = Object.freeze(['weekday', 'weekend']);

function onboardingError(message, statusCode = 400, code = 'ACCOUNT_ONBOARDING_INVALID', details = {}) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function objectOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null);
}

function cleanText(value, maxLength = 255) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function requiredText(value, fieldName, maxLength) {
    const raw = value === undefined || value === null ? '' : String(value).replace(/\u0000/g, '').trim();
    if (!raw) throw onboardingError(`Поле ${fieldName} є обов'язковим`, 400, 'ACCOUNT_ONBOARDING_REQUIRED_FIELD', { fieldName });
    if (raw.length > maxLength) {
        throw onboardingError(`Поле ${fieldName} перевищує ${maxLength} символів`, 400, 'ACCOUNT_ONBOARDING_FIELD_TOO_LONG', { fieldName, maxLength });
    }
    return raw;
}

function normalizePositiveId(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw onboardingError(`Некоректний ${fieldName}`, 400, 'ACCOUNT_ONBOARDING_INVALID_ID', { fieldName });
    }
    return parsed;
}

function normalizeBoolean(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeStringArray(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/[,;\s]+/) : []);
    const seen = new Set();
    const result = [];
    for (const item of source) {
        const normalized = cleanText(item, 200);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function normalizeDate(value, fieldName = 'hireDate') {
    const raw = cleanText(value, 20);
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw onboardingError(`${fieldName} має бути у форматі YYYY-MM-DD`, 400, 'ACCOUNT_ONBOARDING_INVALID_DATE', { fieldName });
    }
    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw onboardingError(`${fieldName} містить неіснуючу дату`, 400, 'ACCOUNT_ONBOARDING_INVALID_DATE', { fieldName });
    }
    return raw;
}

function normalizeRate(value, fieldName = 'hourlyRate', { allowZero = false, max = 1000000 } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    const lowerBoundOk = allowZero ? parsed >= 0 : parsed > 0;
    if (!Number.isFinite(parsed) || !lowerBoundOk || parsed > max) {
        throw onboardingError(`Некоректне значення ${fieldName}`, 400, 'ACCOUNT_ONBOARDING_INVALID_RATE', { fieldName });
    }
    return Math.round(parsed * 100) / 100;
}

function normalizeTime(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    const hour = Number(match?.[1]);
    const minute = Number(match?.[2]);
    if (!match || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw onboardingError(`${fieldName} має бути коректним часом HH:MM`, 400, 'ACCOUNT_ONBOARDING_INVALID_TIME', { fieldName });
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function accountSystemStatus(account = {}) {
    const existing = cleanText(account.system_status || account.systemStatus, 40).toLowerCase();
    if (['guardian', 'system', 'openclaw'].includes(existing)) return existing;
    const username = cleanText(account.username, 100).toLowerCase();
    if (SYSTEM_ACCOUNT_USERNAMES.includes(username)) return username;
    const name = cleanText(account.name, 100).toLowerCase();
    if (
        SYSTEM_ACCOUNT_USERNAME_PREFIXES.some(prefix => username.startsWith(prefix))
        || name.startsWith('openclaw')
        || name.startsWith('open claw')
    ) {
        return 'openclaw';
    }
    if (account.is_system === true || account.isSystem === true) return 'system';
    return null;
}

function isProtectedSystemAccount(account = {}) {
    return accountSystemStatus(account) !== null;
}

function accountRoles(account = {}) {
    const source = [
        account.role,
        ...(Array.isArray(account.extra_roles) ? account.extra_roles : []),
        ...(Array.isArray(account.extraRoles) ? account.extraRoles : [])
    ];
    return [...new Set(source.map(role => cleanText(role, 64)).filter(role => ROLE_HIERARCHY.includes(role)))];
}

function actorCanManageRoleSet(actor, primaryRole, extraRoles = []) {
    const role = cleanText(primaryRole, 64);
    const extras = normalizeStringArray(extraRoles).filter(extraRole => extraRole !== role);
    if (!actor || !canUseAction(actor, 'manage_accounts')) return false;
    if (!ROLE_HIERARCHY.includes(role) || extras.some(extraRole => !ROLE_HIERARCHY.includes(extraRole))) return false;
    if (actor.role === 'creator') return true;
    if (actor.role !== 'director') return false;
    const maxTargetLevel = [role, ...extras].reduce(
        (max, targetRole) => Math.max(max, ROLE_LEVEL[targetRole] ?? -1),
        -1
    );
    return maxTargetLevel >= 0 && maxTargetLevel < ROLE_LEVEL.director;
}

function actorCanManageTarget(actor, target) {
    if (!actor || !target || isProtectedSystemAccount(target) || !canUseAction(actor, 'manage_accounts')) return false;
    if (actor.role === 'creator') return true;
    if (actor.role !== 'director') return false;
    const maxTargetLevel = accountRoles(target).reduce(
        (max, targetRole) => Math.max(max, ROLE_LEVEL[targetRole] ?? -1),
        -1
    );
    return maxTargetLevel >= 0 && maxTargetLevel < ROLE_LEVEL.director;
}

function canToggleAccount(actor, target) {
    if (!actor || !target || Number(actor.id) === Number(target.id)) return false;
    return actorCanManageTarget(actor, target);
}

function professionToAccountRole(professionKey) {
    const key = normalizeProfessionKey(professionKey);
    if (!key) return null;
    const mapped = PROFESSION_ACCOUNT_ROLE_MAP[key] || key;
    return ROLE_HIERARCHY.includes(mapped) ? mapped : null;
}

async function assertLastActiveCreatorInvariant(client, target = {}, next = {}) {
    const currentDenylist = normalizeStringArray(target.action_denylist || target.actionDenylist);
    const currentlyProtectsManagement = target.role === 'creator'
        && target.is_active !== false
        && !currentDenylist.includes('manage_accounts');
    const nextRole = cleanText(firstDefined(next.role, target.role), 64);
    const nextActive = hasOwn(next, 'isActive')
        ? normalizeBoolean(next.isActive)
        : (hasOwn(next, 'is_active') ? normalizeBoolean(next.is_active) : target.is_active !== false);
    const nextDenylist = hasOwn(next, 'actionDenylist') || hasOwn(next, 'action_denylist')
        ? normalizeStringArray(firstDefined(next.actionDenylist, next.action_denylist))
        : currentDenylist;
    const nextProtectsManagement = nextRole === 'creator'
        && nextActive
        && !nextDenylist.includes('manage_accounts');
    if (!currentlyProtectsManagement || nextProtectsManagement) return true;
    if (!client || typeof client.query !== 'function') throw new TypeError('Database client is required');

    // The transaction-level advisory lock serializes all cooperative creator
    // demotions/deactivations without locking a second creator row and creating
    // a target-row/advisory-lock deadlock between two concurrent editors.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:last-active-creator'))");
    const remaining = await client.query(
        `SELECT id
         FROM users
         WHERE role = 'creator'
           AND COALESCE(is_active, true) = true
           AND NOT ('manage_accounts' = ANY(COALESCE(action_denylist, '{}'::text[])))
           AND id <> $1
         LIMIT 1`,
        [Number(target.id)]
    );
    if (!remaining.rows.length) {
        throw onboardingError(
            'Не можна вимкнути або змінити роль останнього активного creator',
            409,
            'LAST_ACTIVE_CREATOR'
        );
    }
    return true;
}

function normalizeProfessionAssignments(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw onboardingError('Потрібно вибрати щонайменше одну професію', 400, 'ACCOUNT_ONBOARDING_PROFESSION_REQUIRED');
    }
    const seen = new Set();
    const assignments = value.map((item, index) => {
        const source = typeof item === 'string' ? { key: item } : objectOrEmpty(item);
        const key = normalizeProfessionKey(firstDefined(source.key, source.professionKey, source.profession_key));
        if (!key) throw onboardingError('Некоректний ключ професії', 400, 'ACCOUNT_ONBOARDING_INVALID_PROFESSION', { index });
        if (seen.has(key)) throw onboardingError(`Професія ${key} вибрана двічі`, 400, 'ACCOUNT_ONBOARDING_DUPLICATE_PROFESSION', { key });
        seen.add(key);
        const status = cleanText(source.status || 'active', 32).toLowerCase();
        const admissionStatus = cleanText(firstDefined(source.admissionStatus, source.admission_status), 32).toLowerCase();
        const internshipStatus = cleanText(firstDefined(source.internshipStatus, source.internship_status), 32).toLowerCase();
        if (!ASSIGNMENT_STATUSES.has(status)) {
            throw onboardingError(`Некоректний статус призначення для ${key}`, 400, 'ACCOUNT_ONBOARDING_INVALID_ASSIGNMENT_STATUS', { key });
        }
        if (admissionStatus && !ADMISSION_STATUSES.has(admissionStatus)) {
            throw onboardingError(`Некоректний admission status для ${key}`, 400, 'ACCOUNT_ONBOARDING_INVALID_ADMISSION_STATUS', { key });
        }
        if (internshipStatus && !INTERNSHIP_STATUSES.has(internshipStatus)) {
            throw onboardingError(`Некоректний internship status для ${key}`, 400, 'ACCOUNT_ONBOARDING_INVALID_INTERNSHIP_STATUS', { key });
        }
        return {
            key,
            isPrimary: source.isPrimary === true || source.is_primary === true,
            status,
            admissionStatus: admissionStatus || null,
            internshipStatus: internshipStatus || null,
            statusProvided: hasOwn(source, 'status'),
            admissionStatusProvided: hasOwn(source, 'admissionStatus') || hasOwn(source, 'admission_status'),
            internshipStatusProvided: hasOwn(source, 'internshipStatus') || hasOwn(source, 'internship_status')
        };
    });
    const primaryCount = assignments.filter(item => item.isPrimary).length;
    if (primaryCount === 0 && assignments.length === 1) assignments[0].isPrimary = true;
    else if (primaryCount !== 1) {
        throw onboardingError('Рівно одна професія має бути основною', 400, 'ACCOUNT_ONBOARDING_PRIMARY_PROFESSION_REQUIRED');
    }
    return assignments;
}

function normalizeShiftPreferences(value) {
    if (!Array.isArray(value)) {
        throw onboardingError('shiftPreferences має бути масивом', 400, 'ACCOUNT_ONBOARDING_INVALID_SHIFT_PREFERENCES');
    }
    const byDayType = new Map();
    for (const item of value) {
        const source = objectOrEmpty(item);
        const dayType = cleanText(firstDefined(source.dayType, source.day_type), 16).toLowerCase();
        if (!DAY_TYPES.includes(dayType) || byDayType.has(dayType)) {
            throw onboardingError('Потрібні унікальні weekday/weekend налаштування', 400, 'ACCOUNT_ONBOARDING_INVALID_SHIFT_PREFERENCES');
        }
        const rawStart = firstDefined(source.startTime, source.start_time);
        const rawEnd = firstDefined(source.endTime, source.end_time);
        const empty = (rawStart === undefined || rawStart === null || rawStart === '')
            && (rawEnd === undefined || rawEnd === null || rawEnd === '');
        if (empty) {
            byDayType.set(dayType, { dayType, startTime: null, endTime: null });
            continue;
        }
        const startTime = normalizeTime(rawStart, `${dayType}.startTime`);
        const endTime = normalizeTime(rawEnd, `${dayType}.endTime`);
        if (!startTime || !endTime || startTime === endTime) {
            throw onboardingError(`${dayType}: початок і кінець мають бути заповнені та відрізнятися`, 400, 'ACCOUNT_ONBOARDING_INVALID_SHIFT_PREFERENCES');
        }
        byDayType.set(dayType, { dayType, startTime, endTime });
    }
    if (byDayType.size !== DAY_TYPES.length) {
        throw onboardingError('Потрібні налаштування для weekday і weekend', 400, 'ACCOUNT_ONBOARDING_INVALID_SHIFT_PREFERENCES');
    }
    return DAY_TYPES.map(dayType => byDayType.get(dayType));
}

function normalizeConditions(value, selectedProfessionKeys) {
    if (value === undefined || value === null || value === '') return [];
    const source = Array.isArray(value) ? value : [value];
    const seen = new Set();
    return source.map(item => {
        const row = objectOrEmpty(item);
        const professionKey = normalizeProfessionKey(firstDefined(row.professionKey, row.profession_key, row.key));
        if (!professionKey || !selectedProfessionKeys.has(professionKey)) {
            throw onboardingError('Умови можна додати лише для вибраної професії', 400, 'ACCOUNT_ONBOARDING_CONDITION_PROFESSION_MISMATCH', { professionKey });
        }
        if (seen.has(professionKey)) {
            throw onboardingError(`Умови для ${professionKey} вказані двічі`, 400, 'ACCOUNT_ONBOARDING_DUPLICATE_CONDITIONS', { professionKey });
        }
        seen.add(professionKey);
        const rateMode = cleanText(firstDefined(row.rateMode, row.rate_mode, row.rate?.mode) || 'fallback', 20).toLowerCase();
        if (!['explicit', 'fallback', 'unchanged'].includes(rateMode)) {
            throw onboardingError('rateMode має бути explicit, fallback або unchanged', 400, 'ACCOUNT_ONBOARDING_INVALID_RATE_MODE');
        }
        const hourlyRate = rateMode === 'explicit'
            ? normalizeRate(firstDefined(row.hourlyRate, row.hourly_rate, row.rate?.amount, row.rate), 'hourlyRate')
            : null;
        return {
            professionKey,
            rateMode,
            hourlyRate,
            shiftPreferences: normalizeShiftPreferences(firstDefined(row.shiftPreferences, row.shift_preferences, row.preferences))
        };
    });
}

function normalizeAccess(value, primaryProfessionKey) {
    const source = objectOrEmpty(value);
    const role = cleanText(source.role || professionToAccountRole(primaryProfessionKey), 64);
    if (!ROLE_HIERARCHY.includes(role)) {
        throw onboardingError('Для основної професії не визначена коректна CRM role', 400, 'ACCOUNT_ONBOARDING_INVALID_ACCOUNT_ROLE', { primaryProfessionKey });
    }

    const extraRoles = normalizeStringArray(firstDefined(source.extraRoles, source.extra_roles))
        .filter(extraRole => extraRole !== role);
    if (extraRoles.length > 3 || extraRoles.some(extraRole => !ROLE_HIERARCHY.includes(extraRole))) {
        throw onboardingError('Некоректні додаткові ролі', 400, 'ACCOUNT_ONBOARDING_INVALID_EXTRA_ROLES');
    }

    const pageAllowlist = normalizeStringArray(firstDefined(source.pageAllowlist, source.page_allowlist));
    if (pageAllowlist.length > 50 || pageAllowlist.some(page => !page.startsWith('/'))) {
        throw onboardingError('Некоректний список дозволених сторінок', 400, 'ACCOUNT_ONBOARDING_INVALID_PAGE_ALLOWLIST');
    }

    const validActions = new Set(Object.keys(ACTION_PERMISSIONS));
    const rawAllowlist = normalizeStringArray(firstDefined(source.actionAllowlist, source.action_allowlist));
    const actionDenylist = normalizeStringArray(firstDefined(source.actionDenylist, source.action_denylist));
    if (rawAllowlist.some(action => !validActions.has(action)) || actionDenylist.some(action => !validActions.has(action))) {
        throw onboardingError('Некоректний action override', 400, 'ACCOUNT_ONBOARDING_INVALID_ACTION_OVERRIDE');
    }
    const denySet = new Set(actionDenylist);
    const actionAllowlist = rawAllowlist.filter(action => !NON_DELEGABLE_ACTIONS.has(action) && !denySet.has(action));

    let businessContexts = [DEFAULT_BUSINESS_CONTEXT];
    let defaultBusinessContext = DEFAULT_BUSINESS_CONTEXT;
    if (['creator', 'director'].includes(role)) {
        const requestedContexts = normalizeStringArray(firstDefined(source.businessContexts, source.business_contexts));
        if (requestedContexts.some(context => !BUSINESS_CONTEXTS[context])) {
            throw onboardingError('Некоректний бізнес-контекст', 400, 'ACCOUNT_ONBOARDING_INVALID_BUSINESS_CONTEXT');
        }
        businessContexts = requestedContexts.length ? requestedContexts : [DEFAULT_BUSINESS_CONTEXT];
        const requestedDefault = cleanText(firstDefined(source.defaultBusinessContext, source.default_business_context), 64);
        if (requestedDefault && !BUSINESS_CONTEXTS[requestedDefault]) {
            throw onboardingError('Некоректний бізнес-контекст за замовчуванням', 400, 'ACCOUNT_ONBOARDING_INVALID_BUSINESS_CONTEXT');
        }
        defaultBusinessContext = requestedDefault || businessContexts[0];
        if (!businessContexts.includes(defaultBusinessContext)) businessContexts.push(defaultBusinessContext);
    }

    return {
        role,
        extraRoles,
        pageAllowlist,
        actionAllowlist,
        actionDenylist,
        businessContexts,
        defaultBusinessContext
    };
}

function normalizeAccountOnboardingPayload(payload = {}) {
    const source = objectOrEmpty(payload);
    const personalSource = objectOrEmpty(source.personal);
    const accountSource = objectOrEmpty(source.account || source.crmAccount);
    const staffSource = objectOrEmpty(source.staff || source.hrProfile);
    const accessSource = {
        ...accountSource,
        ...objectOrEmpty(source.access)
    };

    const manualPassword = firstDefined(
        source.password,
        source.manualPassword,
        personalSource.password,
        accountSource.password,
        accessSource.password
    );
    if (manualPassword !== undefined && manualPassword !== null && String(manualPassword) !== '') {
        throw onboardingError(
            'У контрольованому onboarding використовується лише згенерований тимчасовий пароль',
            400,
            'MANUAL_PASSWORD_NOT_ALLOWED'
        );
    }

    const name = requiredText(firstDefined(personalSource.name, accountSource.name, source.name), 'name', 100);
    const username = requiredText(firstDefined(personalSource.username, accountSource.username, source.username), 'username', 50);
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        throw onboardingError('Username має містити 3–50 латинських символів, цифр, крапок, дефісів або підкреслень', 400, 'ACCOUNT_ONBOARDING_INVALID_USERNAME');
    }
    if (isProtectedSystemAccount({ username })) {
        throw onboardingError('Цей username зарезервований для системного акаунта', 409, 'PROTECTED_SYSTEM_ACCOUNT_USERNAME');
    }

    const rawStaffId = firstDefined(staffSource.id, staffSource.staffId, source.staffId);
    const mode = cleanText(firstDefined(staffSource.mode, source.staffMode) || (rawStaffId ? 'existing' : 'new'), 20).toLowerCase();
    if (!['existing', 'new'].includes(mode)) {
        throw onboardingError('staff.mode має бути existing або new', 400, 'ACCOUNT_ONBOARDING_INVALID_STAFF_MODE');
    }
    const staffId = mode === 'existing' ? normalizePositiveId(rawStaffId, 'staff.id') : null;
    const department = mode === 'new'
        ? requiredText(firstDefined(staffSource.department, source.department), 'staff.department', 50)
        : cleanText(staffSource.department, 50) || null;
    const position = mode === 'new'
        ? requiredText(firstDefined(staffSource.position, source.position), 'staff.position', 100)
        : cleanText(staffSource.position, 100) || null;
    const phoneValue = firstDefined(personalSource.phone, staffSource.phone, source.phone);
    const phoneProvided = phoneValue !== undefined && phoneValue !== null && String(phoneValue).trim() !== '';
    const phone = phoneProvided ? cleanText(phoneValue, 30) : null;
    const hireDate = normalizeDate(firstDefined(staffSource.hireDate, staffSource.hire_date, source.hireDate));
    const fallbackRateValue = firstDefined(staffSource.hourlyRate, staffSource.hourly_rate, source.hourlyRate);
    const fallbackRateProvided = fallbackRateValue !== undefined && fallbackRateValue !== null && fallbackRateValue !== '';
    const fallbackHourlyRate = fallbackRateProvided
        ? normalizeRate(fallbackRateValue, 'staff.hourlyRate', { allowZero: true, max: 999999.99 })
        : null;
    const rawRateUnit = cleanText(firstDefined(staffSource.rateUnit, staffSource.rate_unit), 20).toLowerCase();
    if (rawRateUnit && !RATE_UNITS.has(rawRateUnit)) {
        throw onboardingError('staff.rateUnit має бути hour, day або month', 400, 'ACCOUNT_ONBOARDING_INVALID_RATE_UNIT');
    }

    const professionSource = firstDefined(source.professions, source.professionAssignments, staffSource.professions);
    const professions = normalizeProfessionAssignments(professionSource);
    const primaryProfessionKey = professions.find(item => item.isPrimary).key;
    const selectedProfessionKeys = new Set(professions.map(item => item.key));
    const conditions = normalizeConditions(firstDefined(source.conditions, source.professionConditions), selectedProfessionKeys);

    const structureProvided = hasOwn(source, 'structureNodeId')
        || hasOwn(source, 'structure_node_id')
        || hasOwn(staffSource, 'structureNodeId')
        || hasOwn(staffSource, 'companyStructureNodeId')
        || hasOwn(staffSource, 'company_structure_node_id');
    const structureNodeId = cleanText(firstDefined(
        source.structureNodeId,
        source.structure_node_id,
        staffSource.structureNodeId,
        staffSource.companyStructureNodeId,
        staffSource.company_structure_node_id
    ), 64) || null;

    return {
        issueOneTime: true,
        personal: { name, username, phone, phoneProvided },
        staff: {
            mode,
            id: staffId,
            department,
            position,
            hireDate,
            fallbackHourlyRate,
            fallbackRateProvided,
            rateUnit: rawRateUnit || null,
            rateUnitProvided: Boolean(rawRateUnit)
        },
        structureNodeId,
        structureProvided,
        professions,
        primaryProfessionKey,
        conditions,
        access: normalizeAccess(accessSource, primaryProfessionKey)
    };
}

async function lockUsernameIdentity(client, username) {
    return reserveUsernameIdentity(client, username, {
        code: 'ACCOUNT_USERNAME_OCCUPIED',
        message: 'Акаунт або login alias з таким username вже існує'
    });
}

async function validateStructureNode(client, normalized) {
    if (!normalized.structureNodeId) return null;
    const result = await client.query(
        "SELECT value FROM settings WHERE key = 'hr_company_structure' FOR SHARE"
    );
    const structure = normalizeStaffCompanyStructurePayload(result.rows[0]?.value || {});
    const node = structure.nodes.find(item => item.id === normalized.structureNodeId) || null;
    if (!node) {
        throw onboardingError('Вузол структури не знайдено', 409, 'ACCOUNT_ONBOARDING_STRUCTURE_NODE_NOT_FOUND', { nodeId: normalized.structureNodeId });
    }
    if (node.archived === true && normalized.staff.mode !== 'existing') {
        throw onboardingError('Не можна прив’язати нового працівника до архівного вузла', 409, 'ACCOUNT_ONBOARDING_STRUCTURE_NODE_ARCHIVED', { nodeId: normalized.structureNodeId });
    }
    return node;
}

async function lockAndValidateProfessions(client, normalized) {
    const keys = normalized.professions.map(item => item.key);
    const result = await client.query(
        `SELECT id, key, title, is_active
         FROM hr_professions
         WHERE key = ANY($1::text[])
         ORDER BY key
         FOR UPDATE`,
        [keys]
    );
    const rowsByKey = new Map(result.rows.map(row => [normalizeProfessionKey(row.key), row]));
    const virtualKeys = new Set(professionCatalogInventory().virtual);
    for (const key of keys) {
        const row = rowsByKey.get(key);
        if (!row && !virtualKeys.has(key)) {
            throw onboardingError(`Професію ${key} не знайдено`, 404, 'ACCOUNT_ONBOARDING_PROFESSION_NOT_FOUND', { key });
        }
        if (row?.is_active === false) {
            throw onboardingError(`Професія ${key} архівна`, 409, 'ACCOUNT_ONBOARDING_PROFESSION_ARCHIVED', { key });
        }
    }
    for (const condition of normalized.conditions) {
        if (!rowsByKey.has(condition.professionKey)) {
            throw onboardingError(
                'Ставку й типовий час не можна зберігати для readonly system profession',
                409,
                'ACCOUNT_ONBOARDING_SYSTEM_PROFESSION_CONDITIONS_UNSUPPORTED',
                { key: condition.professionKey }
            );
        }
    }
    return rowsByKey;
}

async function loadAndLockStaff(client, normalized) {
    const staffResult = await client.query(
        `SELECT id, name, department, position, phone, hire_date, role_type,
                COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                company_structure_node_id, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit,
                COALESCE(is_active, true) AS is_active
         FROM staff
         WHERE id = $1
         FOR UPDATE`,
        [normalized.staff.id]
    );
    const staff = staffResult.rows[0];
    if (!staff) throw onboardingError('Staff-профіль не знайдено', 404, 'ACCOUNT_ONBOARDING_STAFF_NOT_FOUND');
    if (staff.is_active === false) {
        throw onboardingError('Не можна створити акаунт для неактивного staff-профілю', 409, 'ACCOUNT_ONBOARDING_STAFF_INACTIVE');
    }

    const profiles = await client.query(
        `SELECT ep.id, ep.user_id, ep.is_active, u.username
         FROM employee_profiles ep
         LEFT JOIN users u ON u.id = ep.user_id
         WHERE ep.staff_id = $1
         FOR UPDATE OF ep`,
        [staff.id]
    );
    const occupied = profiles.rows.find(row => row.user_id !== null && row.user_id !== undefined);
    if (occupied) {
        throw onboardingError(
            `Staff-профіль уже прив’язаний до ${occupied.username || 'іншого акаунта'}`,
            409,
            'ACCOUNT_ONBOARDING_STAFF_OCCUPIED',
            { staffId: staff.id, linkedUserId: occupied.user_id }
        );
    }
    return staff;
}

async function createStaff(client, normalized) {
    const secondary = normalized.professions.filter(item => !item.isPrimary).map(item => item.key);
    const result = await client.query(
        `INSERT INTO staff
            (name, department, position, phone, hire_date, is_active, role_type,
             secondary_professions, company_structure_node_id, hourly_rate, rate_unit)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb, $8, $9, $10)
         RETURNING id, name, department, position, phone, hire_date, role_type,
                   secondary_professions, company_structure_node_id, hourly_rate, rate_unit, is_active`,
        [
            normalized.personal.name,
            normalized.staff.department,
            normalized.staff.position,
            normalized.personal.phone,
            normalized.staff.hireDate,
            normalized.primaryProfessionKey,
            JSON.stringify(secondary),
            normalized.structureNodeId,
            normalized.staff.fallbackRateProvided ? normalized.staff.fallbackHourlyRate : 0,
            normalized.staff.rateUnit || 'hour'
        ]
    );
    return result.rows[0];
}

async function updateExistingStaffSetup(client, staff, normalized, secondaryProfessionKeys = []) {
    const secondary = normalizeProfessionKeyArray(secondaryProfessionKeys)
        .filter(key => key !== normalized.primaryProfessionKey);
    const values = [normalized.primaryProfessionKey, JSON.stringify(secondary)];
    const sets = ['role_type = $1', 'secondary_professions = $2::jsonb'];
    if (normalized.structureProvided) {
        values.push(normalized.structureNodeId);
        sets.push(`company_structure_node_id = $${values.length}`);
    }
    if (normalized.personal.phoneProvided) {
        values.push(normalized.personal.phone);
        sets.push(`phone = $${values.length}`);
    }
    if (normalized.staff.fallbackRateProvided) {
        values.push(normalized.staff.fallbackHourlyRate);
        sets.push(`hourly_rate = $${values.length}`);
    }
    if (normalized.staff.rateUnitProvided) {
        values.push(normalized.staff.rateUnit);
        sets.push(`rate_unit = $${values.length}`);
    }
    values.push(staff.id);
    const result = await client.query(
        `UPDATE staff
         SET ${sets.join(', ')}
         WHERE id = $${values.length}
         RETURNING id, name, department, position, phone, hire_date, role_type,
                   secondary_professions, company_structure_node_id, hourly_rate, rate_unit, is_active`,
        values
    );
    return result.rows[0];
}

async function loadExistingRoleAssignments(client, staffId) {
    const result = await client.query(
        `SELECT profession_key, status, admission_status, internship_status,
                hourly_rate, payroll_scheme_id, notes
         FROM staff_role_assignments
         WHERE staff_id = $1
         FOR UPDATE`,
        [staffId]
    );
    return result.rows;
}

function mergeExistingProfessionAssignments(staff, requestedAssignments, existingRows = []) {
    const requested = requestedAssignments.map(item => ({ ...item }));
    const requestedKeys = new Set(requested.map(item => item.key));
    const preservedKeys = [
        normalizeProfessionKey(staff?.role_type),
        ...normalizeProfessionKeyArray(staff?.secondary_professions),
        ...existingRows.map(row => normalizeProfessionKey(row.profession_key))
    ].filter(Boolean);

    for (const key of preservedKeys) {
        if (requestedKeys.has(key)) continue;
        requestedKeys.add(key);
        requested.push({
            key,
            isPrimary: false,
            status: 'active',
            admissionStatus: null,
            internshipStatus: null,
            statusProvided: false,
            admissionStatusProvided: false,
            internshipStatusProvided: false
        });
    }
    return requested;
}

function legacySecondaryProfessionKeys(staff, assignments, existingRows = []) {
    const originalLegacyKeys = new Set([
        normalizeProfessionKey(staff?.role_type),
        ...normalizeProfessionKeyArray(staff?.secondary_professions)
    ].filter(Boolean));
    const existingByKey = new Map(
        existingRows.map(row => [normalizeProfessionKey(row.profession_key), row])
    );

    return assignments
        .filter(assignment => !assignment.isPrimary)
        .filter(assignment => {
            if (assignment.statusProvided) return assignment.status === 'active';
            if (originalLegacyKeys.has(assignment.key)) return true;
            const existing = existingByKey.get(assignment.key);
            return !existing || !['inactive', 'suspended'].includes(existing.status);
        })
        .map(assignment => assignment.key);
}

async function replaceAuthoritativeAssignments(client, staffId, assignments, actorUsername, existingRows = null) {
    const lockedRows = Array.isArray(existingRows)
        ? existingRows
        : await loadExistingRoleAssignments(client, staffId);
    const existingByKey = new Map(lockedRows.map(row => [normalizeProfessionKey(row.profession_key), row]));
    const keys = assignments.map(item => item.key);

    await client.query(
        `UPDATE staff_role_assignments
         SET is_primary = false, updated_by = $2, updated_at = NOW()
         WHERE staff_id = $1 AND is_primary = true`,
        [staffId, actorUsername]
    );
    await client.query(
        'DELETE FROM staff_role_assignments WHERE staff_id = $1 AND NOT (profession_key = ANY($2::text[]))',
        [staffId, keys]
    );

    const saved = [];
    for (const assignment of assignments) {
        const existing = existingByKey.get(assignment.key) || {};
        const status = assignment.statusProvided ? assignment.status : (existing.status || 'active');
        const admissionStatus = assignment.admissionStatusProvided
            ? assignment.admissionStatus
            : (existing.admission_status || (assignment.isPrimary ? 'approved' : 'pending'));
        const internshipStatus = assignment.internshipStatusProvided
            ? assignment.internshipStatus
            : (existing.internship_status || (assignment.key === 'intern' ? 'in_progress' : 'none'));
        const result = await client.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status, internship_status,
                 hourly_rate, payroll_scheme_id, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
             ON CONFLICT (staff_id, profession_key) DO UPDATE SET
                is_primary = EXCLUDED.is_primary,
                status = EXCLUDED.status,
                admission_status = EXCLUDED.admission_status,
                internship_status = EXCLUDED.internship_status,
                hourly_rate = EXCLUDED.hourly_rate,
                payroll_scheme_id = EXCLUDED.payroll_scheme_id,
                notes = EXCLUDED.notes,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
             RETURNING id, profession_key, is_primary, status, admission_status, internship_status`,
            [
                staffId,
                assignment.key,
                assignment.isPrimary,
                status,
                admissionStatus,
                internshipStatus,
                existing.hourly_rate ?? null,
                existing.payroll_scheme_id ?? null,
                existing.notes ?? null,
                actorUsername
            ]
        );
        saved.push(result.rows[0]);
    }
    return saved;
}

function requestIp(req) {
    return cleanText(
        String(req?.headers?.['x-forwarded-for'] || req?.ip || req?.connection?.remoteAddress || '').split(',')[0],
        45
    ) || null;
}

async function insertStrictHrAudit(client, actor, staffId, details, req) {
    await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
            'account_onboarding_created',
            staffId,
            cleanText(actor?.username, 50) || null,
            JSON.stringify(details),
            requestIp(req)
        ]
    );
}

async function addDefaultChatMemberships(dbPool, userId) {
    const channels = await dbPool.query('SELECT id FROM chat_channels WHERE is_default = true ORDER BY id');
    for (const channel of channels.rows) {
        await dbPool.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [channel.id, userId]
        );
    }
    return channels.rows.length;
}

function normalizeDatabaseError(error) {
    if (error?.code === '23505') {
        return onboardingError('Акаунт або зв’язок із такими даними вже існує', 409, 'ACCOUNT_ONBOARDING_CONFLICT');
    }
    if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
        return onboardingError('Дані onboarding більше не відповідають актуальному стану системи', 409, 'ACCOUNT_ONBOARDING_STALE_DATA');
    }
    return error;
}

async function createAccountOnboarding({ payload, actor, req, dbPool = pool } = {}) {
    const normalized = normalizeAccountOnboardingPayload(payload);
    if (!actorCanManageRoleSet(actor, normalized.access.role, normalized.access.extraRoles)) {
        throw onboardingError('Недостатньо прав для створення акаунта з таким рівнем доступу', 403, 'ACCOUNT_ONBOARDING_ROLE_FORBIDDEN');
    }
    if (!dbPool || typeof dbPool.connect !== 'function') throw new TypeError('Database pool is required');

    const temporaryPassword = generateOneTimePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    if (!await bcrypt.compare(temporaryPassword, passwordHash)) {
        throw new Error('account_onboarding_password_hash_verification_failed');
    }

    const client = await dbPool.connect();
    let committed = false;
    let user;
    let staff;
    let staffCreated = false;
    let loginCheck;
    let savedAssignments = [];
    let effectiveAssignments = normalized.professions;
    const savedConditions = [];
    try {
        await client.query('BEGIN');
        await lockUsernameIdentity(client, normalized.personal.username);
        const structureNode = await validateStructureNode(client, normalized);
        await lockAndValidateProfessions(client, normalized);

        if (normalized.staff.mode === 'existing') {
            const currentStaff = await loadAndLockStaff(client, normalized);
            if (structureNode?.archived === true && currentStaff.company_structure_node_id !== normalized.structureNodeId) {
                throw onboardingError('Не можна перемістити працівника до архівного вузла', 409, 'ACCOUNT_ONBOARDING_STRUCTURE_NODE_ARCHIVED', { nodeId: normalized.structureNodeId });
            }
            const existingAssignments = await loadExistingRoleAssignments(client, currentStaff.id);
            effectiveAssignments = mergeExistingProfessionAssignments(
                currentStaff,
                normalized.professions,
                existingAssignments
            );
            staff = await updateExistingStaffSetup(
                client,
                currentStaff,
                normalized,
                legacySecondaryProfessionKeys(currentStaff, effectiveAssignments, existingAssignments)
            );
            savedAssignments = await replaceAuthoritativeAssignments(
                client,
                staff.id,
                effectiveAssignments,
                cleanText(actor?.username, 100) || null,
                existingAssignments
            );
        } else {
            staff = await createStaff(client, normalized);
            staffCreated = true;
            savedAssignments = await replaceAuthoritativeAssignments(
                client,
                staff.id,
                effectiveAssignments,
                cleanText(actor?.username, 100) || null
            );
        }

        for (const condition of normalized.conditions) {
            const saved = await saveStaffProfessionCondition(
                client,
                staff.id,
                condition.professionKey,
                {
                    rateMode: condition.rateMode,
                    hourlyRate: condition.hourlyRate,
                    rateUnit: staff.rate_unit || 'hour',
                    shiftPreferences: condition.shiftPreferences
                },
                { actor: cleanText(actor?.username, 100) || null }
            );
            const summarizeCondition = value => ({
                rateMode: value.rateMode,
                explicitRate: value.explicitRate,
                fallbackRate: value.fallbackRate,
                effectiveRate: value.effectiveRate,
                rateUnit: value.rateUnit,
                shiftPreferences: value.shiftPreferences.map(item => ({
                    dayType: item.dayType,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    isActive: item.isActive === true
                }))
            });
            savedConditions.push({
                professionKey: condition.professionKey,
                before: summarizeCondition(saved.before),
                after: summarizeCondition(saved.after)
            });
        }

        const userResult = await client.query(
            `INSERT INTO users
                (username, password_hash, name, role, extra_roles, page_allowlist,
                 action_allowlist, action_denylist, business_contexts,
                 default_business_context, password_changed_at, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), true)
             RETURNING id, username, name, role, extra_roles, page_allowlist,
                       action_allowlist, action_denylist, business_contexts,
                       default_business_context, is_active, password_changed_at`,
            [
                normalized.personal.username,
                passwordHash,
                normalized.personal.name,
                normalized.access.role,
                normalized.access.extraRoles,
                normalized.access.pageAllowlist,
                normalized.access.actionAllowlist,
                normalized.access.actionDenylist,
                normalized.access.businessContexts,
                normalized.access.defaultBusinessContext
            ]
        );
        user = userResult.rows[0];
        loginCheck = await verifyIssuedCredential({
            client,
            username: user.username,
            password: temporaryPassword
        });
        if (!loginCheck.loginReady) {
            throw new Error(`account_onboarding_login_ready_check_failed:${loginCheck.reason}`);
        }

        await linkUserToStaffProfile(client, {
            userId: user.id,
            staffId: staff.id,
            actor,
            req,
            eventType: 'account_onboarding_staff_linked',
            details: { source: 'account_onboarding', staffCreated }
        });

        const safeAuditDetails = {
            source: 'account_onboarding',
            accountRole: normalized.access.role,
            extraRoleCount: normalized.access.extraRoles.length,
            pageOverrideCount: normalized.access.pageAllowlist.length,
            actionAllowOverrideCount: normalized.access.actionAllowlist.length,
            actionDenyOverrideCount: normalized.access.actionDenylist.length,
            businessContexts: normalized.access.businessContexts,
            defaultBusinessContext: normalized.access.defaultBusinessContext,
            staffId: staff.id,
            staffCreated,
            structureNodeId: normalized.structureNodeId,
            primaryProfessionKey: normalized.primaryProfessionKey,
            professionKeys: normalized.professions.map(item => item.key),
            finalProfessionKeys: effectiveAssignments.map(item => item.key),
            conditionProfessionKeys: normalized.conditions.map(item => item.professionKey),
            conditionChanges: savedConditions,
            oneTimeIssued: true,
            loginReady: true
        };
        await recordAccountSecurityEvent({
            actor,
            target: user,
            eventType: 'account_onboarding_created',
            reason: 'account_management',
            details: safeAuditDetails,
            req,
            client,
            strict: true
        });
        await insertStrictHrAudit(client, actor, staff.id, safeAuditDetails, req);
        await client.query('COMMIT');
        committed = true;
    } catch (error) {
        if (!committed) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        throw normalizeDatabaseError(error);
    } finally {
        client.release();
    }

    const warnings = [];
    let defaultChatMemberships = 0;
    try {
        defaultChatMemberships = await addDefaultChatMemberships(dbPool, user.id);
    } catch {
        warnings.push({
            code: 'DEFAULT_CHAT_SETUP_FAILED',
            message: 'Акаунт створено, але не всі default chat channels вдалося підключити автоматично.'
        });
    }

    const receipt = {
        account: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            extraRoles: user.extra_roles || normalized.access.extraRoles,
            businessContexts: user.business_contexts || normalized.access.businessContexts,
            defaultBusinessContext: user.default_business_context || normalized.access.defaultBusinessContext,
            active: user.is_active !== false
        },
        staff: {
            id: staff.id,
            name: staff.name,
            created: staffCreated,
            linked: true
        },
        structure: { nodeId: normalized.structureNodeId },
        professions: savedAssignments.map(item => ({
            key: item.profession_key,
            isPrimary: item.is_primary === true,
            status: item.status,
            admissionStatus: item.admission_status,
            internshipStatus: item.internship_status
        })),
        conditions: savedConditions,
        access: {
            role: normalized.access.role,
            extraRoles: normalized.access.extraRoles,
            businessContexts: normalized.access.businessContexts,
            defaultBusinessContext: normalized.access.defaultBusinessContext
        },
        postCommit: { defaultChatMemberships },
        warnings,
        nextActions: [
            { key: 'open_staff_card', staffId: staff.id },
            { key: 'add_documents', staffId: staff.id },
            { key: 'assign_resources', staffId: staff.id },
            { key: 'open_checklist', staffId: staff.id, professionKey: normalized.primaryProfessionKey }
        ]
    };

    return {
        user,
        staff,
        receipt,
        loginReady: loginCheck.loginReady,
        loginReadyReason: loginCheck.reason,
        credential: oneTimeCredential(user.username, temporaryPassword, 'account_onboarding')
    };
}

module.exports = {
    SYSTEM_ACCOUNT_USERNAME,
    SYSTEM_ACCOUNT_USERNAMES,
    SYSTEM_ACCOUNT_USERNAME_PREFIXES,
    PROFESSION_ACCOUNT_ROLE_MAP,
    accountSystemStatus,
    isProtectedSystemAccount,
    actorCanManageRoleSet,
    actorCanManageTarget,
    canToggleAccount,
    professionToAccountRole,
    assertLastActiveCreatorInvariant,
    normalizeAccountOnboardingPayload,
    mergeExistingProfessionAssignments,
    legacySecondaryProfessionKeys,
    createAccountOnboarding
};
