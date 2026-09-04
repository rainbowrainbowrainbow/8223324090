/**
 * routes/users.js — User management (v20.1.0)
 * Creator + Director only: list users, change roles, reset passwords, deactivate
 */
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const {
    requireAction,
    authenticateToken,
    ROLE_HIERARCHY,
    ROLE_LEVEL,
    PAGE_ACCESS,
    NON_DELEGABLE_ACTIONS,
    revokeAllUserTokens,
    canUseAction
} = require('../middleware/auth');
const {
    ACTION_PERMISSION_BY_KEY,
    getPublicPagePermissionMetadata
} = require('../config/permissionRegistry');
const {
    CAPABILITY_TYPES,
    normalizeCapabilityList,
    normalizePageAllowlist,
    assertNoCapabilityConflicts
} = require('../services/accountAccessPolicy');
const { createLogger } = require('../utils/logger');
const { recordAccountSecurityEvent, listAccountSecurityEvents } = require('../services/accountSecurity');
const { normalizeManualPassword } = require('../services/credentialInput');
const {
    BUSINESS_CONTEXTS,
    DEFAULT_BUSINESS_CONTEXT,
    businessContextCatalog,
    normalizeBusinessContext,
    normalizeBusinessContextList
} = require('../services/businessContext');
const {
    linkUserToStaffProfile,
    unlinkUserFromStaffProfiles,
    getAccountLinkConflicts,
    generateOneTimePassword,
    oneTimeCredential,
    verifyIssuedCredential,
    reserveUsernameIdentity
} = require('../services/accountLinking');
const {
    PROFESSION_ACCOUNT_ROLE_MAP,
    accountSystemStatus,
    isProtectedSystemAccount,
    assertLastActiveCreatorInvariant,
    createAccountOnboarding
} = require('../services/accountOnboarding');
const { normalizeStaffCompanyStructurePayload } = require('../services/staffDisplayGroups');
const { curateProfessionCatalogRows } = require('../services/professions');
const {
    QA_CREATOR_ROLE,
    normalizeQaCreatorLeaseDuration,
    normalizeLeaseId,
    isQaLeaseCandidate
} = require('../services/qaCreatorLease');

const log = createLogger('Users');

const ACCOUNT_MANAGER_ROLES = ['creator', 'director'];

function qaCreatorLeaseError(message, code, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function qaLeaseAccountId(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw qaCreatorLeaseError('Некоректний account id', 'QA_CREATOR_LEASE_ACCOUNT_INVALID');
    }
    return parsed;
}

async function assertPermanentCreatorForQaLease(client, actor) {
    const actorResult = await client.query(
        'SELECT id, username, role, is_active FROM users WHERE id = $1 FOR UPDATE',
        [actor?.id]
    );
    const permanentActor = actorResult.rows[0];
    if (!permanentActor || permanentActor.is_active === false || permanentActor.role !== QA_CREATOR_ROLE) {
        throw qaCreatorLeaseError('Лише постійний creator може керувати QA lease', 'QA_CREATOR_LEASE_ACTOR_FORBIDDEN', 403);
    }
    return permanentActor;
}

async function selectQaLeaseTarget(client, userId) {
    const result = await client.query(
        `SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.is_active,
                u.qa_creator_lease_id::text AS qa_creator_lease_id, u.qa_creator_lease_expires_at,
                EXISTS (
                    SELECT 1
                    FROM employee_profiles ep
                    WHERE ep.user_id = u.id
                      AND COALESCE(ep.is_active, true) IS TRUE
                ) AS has_active_staff_profile
         FROM users u
         WHERE u.id = $1
         FOR UPDATE`,
        [userId]
    );
    return result.rows[0] || null;
}

function assertQaLeaseTarget(target, actorId) {
    if (!target) throw qaCreatorLeaseError('QA account не знайдено', 'QA_CREATOR_LEASE_TARGET_MISSING', 404);
    if (Number(target.id) === Number(actorId)) {
        throw qaCreatorLeaseError('Не можна видати QA lease самому собі', 'QA_CREATOR_LEASE_SELF_FORBIDDEN', 403);
    }
    if (target.is_active === false || accountRoles(target).includes(QA_CREATOR_ROLE)) {
        throw qaCreatorLeaseError('QA account не придатний для тимчасового creator lease', 'QA_CREATOR_LEASE_TARGET_FORBIDDEN', 403);
    }
    if (target.has_active_staff_profile || !isQaLeaseCandidate(target)) {
        throw qaCreatorLeaseError('Lease дозволений лише ізольованому QA account', 'QA_CREATOR_LEASE_TARGET_NOT_ISOLATED', 403);
    }
    assertAccountMutable(target, 'qa_creator_lease');
}
function normalizeRoleSet(...roleLists) {
    const roles = [];
    roleLists.flat().forEach(role => {
        if (typeof role !== 'string') return;
        const value = role.trim();
        if (value && !roles.includes(value)) roles.push(value);
    });
    return roles;
}

function accountRoles(account = {}) {
    return normalizeRoleSet([account.role], account.extra_roles, account.extraRoles);
}

function roleLevel(role) {
    return ROLE_LEVEL[String(role || '').trim()] ?? -1;
}

function accountMaxRoleLevel(account = {}) {
    return accountRoles(account).reduce((max, role) => Math.max(max, roleLevel(role)), -1);
}

function actorCanManageRoleSet(actor, primaryRole, extraRoles = []) {
    if (!actor || !canUseAction(actor, 'manage_accounts') || !ACCOUNT_MANAGER_ROLES.includes(actor.role)) return false;
    if (actor.role === 'creator') return true;
    const maxTargetLevel = normalizeRoleSet([primaryRole], extraRoles).reduce(
        (max, role) => Math.max(max, roleLevel(role)),
        -1
    );
    return maxTargetLevel >= 0 && maxTargetLevel < roleLevel('director');
}

function actorCanManageTarget(actor, target) {
    if (!actor || !target || !canUseAction(actor, 'manage_accounts') || !ACCOUNT_MANAGER_ROLES.includes(actor.role)) return false;
    if (actor.role === 'creator') return true;
    return accountMaxRoleLevel(target) < roleLevel('director');
}

function canToggleAccount(actor, target) {
    if (!actor || !target) return false;
    if (target.id === actor.id) return false;
    return actorCanManageTarget(actor, target);
}

function canMutateSensitiveAccount(actor, target) {
    if (!actor || !target) return false;
    return actorCanManageTarget(actor, target);
}

function canCreateAccount(actor, primaryRole, extraRoles = []) {
    return actorCanManageRoleSet(actor, primaryRole, extraRoles);
}

function protectedAccountError(target, action = 'change') {
    const err = new Error(`Системний акаунт ${target?.username || ''} захищений від дії: ${action}`.trim());
    err.statusCode = 403;
    err.code = 'PROTECTED_SYSTEM_ACCOUNT';
    return err;
}

function assertAccountMutable(target, action = 'change') {
    if (isProtectedSystemAccount(target)) throw protectedAccountError(target, action);
}

function normalizeActionOverrideList(value, options = {}) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.ACTION, options).values;
}

function accountPageDenylist(account = {}) {
    return normalizeCapabilityList(
        account.page_denylist || account.pageDenylist,
        CAPABILITY_TYPES.PAGE
    ).values;
}

function accountActionAllowlist(account = {}) {
    return normalizeActionOverrideList(account.action_allowlist || account.actionAllowlist);
}

function accountActionDenylist(account = {}) {
    return normalizeActionOverrideList(account.action_denylist || account.actionDenylist);
}

function normalizePageDenylistInput(value, options = {}) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.PAGE, { ...options, excludeNonConfigurable: true }).values;
}

function normalizeActionAllowlist(value, options = {}) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.ACTION, {
        ...options,
        excludeNonDelegable: true,
        excludeExplicitAllowDisabled: true,
        excludeDeprecated: true
    }).values;
}

function normalizePageAllowlistInput(value, options = {}) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.PAGE, {
        ...options,
        excludeExplicitAllowDisabled: true,
        excludeDeprecated: true,
        excludeNonConfigurable: true
    }).values;
}

function normalizePageAllowlistUpdateInput(value, options = {}) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.PAGE, { ...options, excludeNonConfigurable: true }).values;
}

function assertNoNewExplicitAllowDisabledPages(requestedAllowlist, currentAllowlist, fieldName = 'pageAllowlist') {
    if (!Array.isArray(requestedAllowlist)) return;
    const currentKeys = new Set(normalizePageAllowlist(currentAllowlist));
    const { explicitAllowDisabledKeys } = normalizeCapabilityList(requestedAllowlist, CAPABILITY_TYPES.PAGE, {
        excludeExplicitAllowDisabled: true
    });
    const newlyAddedKeys = explicitAllowDisabledKeys.filter(key => !currentKeys.has(key));
    if (!newlyAddedKeys.length) return;

    // Reuse the canonical validator so callers receive the existing 400 contract.
    normalizePageAllowlistInput(newlyAddedKeys, { strict: true, fieldName });
}

function assertSelfAccountAccessSafe(actor, prospectiveAccount) {
    if (!actor || !prospectiveAccount || Number(actor.id) !== Number(prospectiveAccount.id)) return;
    if (!canUseAction(prospectiveAccount, 'manage_accounts')) {
        const err = new Error('Не можна забрати в себе доступ до керування акаунтами');
        err.statusCode = 400;
        throw err;
    }
}

function normalizeUsername(value) {
    return String(value || '').trim();
}

function normalizeStaffId(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function normalizeStoredArray(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function canSwitchBusinessContextsForRole(primaryRole = '') {
    return ['creator', 'director'].includes(primaryRole);
}

function normalizeAccountBusinessContexts(value, primaryRole = '') {
    if (!canSwitchBusinessContextsForRole(primaryRole)) return [DEFAULT_BUSINESS_CONTEXT];
    const fallback = ['creator', 'director', 'vice_director', 'senior_manager'].includes(primaryRole)
        ? Object.keys(BUSINESS_CONTEXTS)
        : [DEFAULT_BUSINESS_CONTEXT];
    return normalizeBusinessContextList(value, fallback).slice(0, Object.keys(BUSINESS_CONTEXTS).length);
}

function defaultBusinessContextForSelection(value, contexts, primaryRole = '') {
    if (!canSwitchBusinessContextsForRole(primaryRole)) return DEFAULT_BUSINESS_CONTEXT;
    const selected = normalizeAccountBusinessContexts(contexts, primaryRole);
    const requested = value === undefined || value === null || value === ''
        ? null
        : normalizeBusinessContext(value);
    if (requested && BUSINESS_CONTEXTS[requested]) return requested;
    const nonDefault = selected.filter(ctx => ctx !== DEFAULT_BUSINESS_CONTEXT);
    if (nonDefault.length === 1) return nonDefault[0];
    return selected.includes(DEFAULT_BUSINESS_CONTEXT)
        ? DEFAULT_BUSINESS_CONTEXT
        : (selected[0] || DEFAULT_BUSINESS_CONTEXT);
}

function businessContextsWithDefault(contexts, defaultContext, primaryRole = '') {
    if (!canSwitchBusinessContextsForRole(primaryRole)) return [DEFAULT_BUSINESS_CONTEXT];
    const selected = normalizeAccountBusinessContexts(contexts, primaryRole);
    const key = normalizeBusinessContext(defaultContext || defaultBusinessContextForSelection(null, selected, primaryRole));
    if (BUSINESS_CONTEXTS[key] && !selected.includes(key)) selected.push(key);
    return selected.slice(0, Object.keys(BUSINESS_CONTEXTS).length);
}

function sameStringArray(left = [], right = []) {
    const a = normalizeStoredArray(left);
    const b = normalizeStoredArray(right);
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

function resetPasswordFromPayload(body = {}) {
    const candidates = [body.newPassword, body.password, body.manualPassword];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const value = normalizeManualPassword(candidate);
        if (value.length > 0) return value;
    }
    return '';
}

function truthyResetFlag(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function shouldActivateAfterPasswordReset(body = {}) {
    return truthyResetFlag(body.activateOnReset) || truthyResetFlag(body.activate) || truthyResetFlag(body.reactivate);
}

function decorateManagedAccount(row = {}, actor = null) {
    const systemStatus = accountSystemStatus(row);
    const protectedAccount = Boolean(systemStatus);
    const canMutate = !protectedAccount && canMutateSensitiveAccount(actor, row);
    const canToggle = !protectedAccount && canToggleAccount(actor, row);
    const hasStaff = Number.isInteger(Number(row.staff_id)) && Number(row.staff_id) > 0;
    const linkActive = row.profile_active !== false && row.staff_active !== false;
    return {
        ...row,
        page_allowlist: normalizePageAllowlist(row),
        pageAllowlist: normalizePageAllowlist(row),
        page_denylist: accountPageDenylist(row),
        pageDenylist: accountPageDenylist(row),
        action_allowlist: accountActionAllowlist(row),
        actionAllowlist: accountActionAllowlist(row),
        action_denylist: accountActionDenylist(row),
        actionDenylist: accountActionDenylist(row),
        system_status: systemStatus,
        is_system: protectedAccount,
        protected_account: protectedAccount,
        link_status: hasStaff ? (linkActive ? 'linked_active' : 'linked_inactive') : 'unlinked',
        can_mutate: canMutate,
        can_toggle: canToggle,
        can_unlink: canMutate && hasStaff
    };
}

// GET /api/users — list all users for account management (creator/director)
// v39.8: Security — require authentication
router.use(authenticateToken);
router.get('/', requireAction('manage_accounts'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.page_allowlist, u.page_denylist, u.action_allowlist, u.action_denylist,
                    u.business_contexts, u.default_business_context, u.is_active, u.created_at, u.last_seen_at,
                    u.password_changed_at, u.session_revoked_at,
                    ep.staff_id, ep.id AS profile_id, ep.full_name AS profile_name, ep.is_active AS profile_active,
                    s.name AS staff_name, s.department AS staff_department, s.position AS staff_position,
                    s.role_type AS staff_role_type, s.is_active AS staff_active
             FROM users u
             LEFT JOIN LATERAL (
                 SELECT profile.id, profile.staff_id, profile.full_name, profile.is_active
                 FROM employee_profiles profile
                 WHERE profile.user_id = u.id
                 ORDER BY COALESCE(profile.is_active, true) DESC, profile.id DESC
                 LIMIT 1
             ) ep ON true
             LEFT JOIN staff s ON s.id = ep.staff_id
             ORDER BY COALESCE(u.is_active, true) DESC, lower(COALESCE(NULLIF(u.name, ''), u.username)), u.id`
        );
        res.json(result.rows.map(row => decorateManagedAccount(row, req.user)));
    } catch (err) {
        log.error('List users error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/roles — return role definitions and access matrix
router.get('/roles', requireAction('manage_accounts'), async (req, res) => {
    const configurableActions = Object.values(ACTION_PERMISSION_BY_KEY).filter(action => action.deprecated !== true);
    const configurableActionPermissions = Object.fromEntries(configurableActions.map(action => [action.key, action.defaultRoles]));
    const pages = getPublicPagePermissionMetadata();
    res.json({
        hierarchy: ROLE_HIERARCHY,
        rolePresets: {
            executive: ['creator', 'director', 'vice_director'],
            management: ['senior_manager', 'manager'],
            operations: ['admin', 'reception', 'security'],
            creative: ['art_director', 'marketer'],
            finance: ['accountant'],
            programs: ['senior_instructor', 'instructor', 'animator'],
            maysternyaDoli: ['director', 'manager', 'admin'],
            support: ['barista', 'wardrobe', 'cleaning', 'maintenance', 'dishwasher', 'waiter']
        },
        pageAccess: PAGE_ACCESS,
        pages,
        actionPermissions: configurableActionPermissions,
        nonDelegableActions: Array.from(NON_DELEGABLE_ACTIONS),
        professionRoleMap: PROFESSION_ACCOUNT_ROLE_MAP,
        actions: configurableActions.map(action => ({
            key: action.key,
            label: action.label,
            group: action.group,
            roles: action.defaultRoles,
            delegable: !NON_DELEGABLE_ACTIONS.has(action.key),
            deprecated: false
        })),
        businessContexts: businessContextCatalog()
    });
});

// GET /api/users/staff-options — staff profiles available for account linking
router.get('/staff-options', requireAction('manage_accounts'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.name, s.department, s.position, s.phone, s.hire_date,
                    s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                    s.company_structure_node_id, s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit,
                    COALESCE(s.is_active, true) AS staff_active,
                    ep.user_id AS linked_user_id,
                    ep.is_active AS profile_active,
                    u.username AS linked_username,
                    u.is_active AS linked_user_active
             FROM staff s
             LEFT JOIN LATERAL (
                 SELECT profile.user_id, profile.is_active
                 FROM employee_profiles profile
                 WHERE profile.staff_id = s.id
                 ORDER BY (profile.user_id IS NOT NULL) DESC, COALESCE(profile.is_active, true) DESC, profile.id DESC
                 LIMIT 1
             ) ep ON true
             LEFT JOIN users u ON u.id = ep.user_id
             WHERE COALESCE(s.is_active, true) = true
             ORDER BY s.department, lower(s.name), s.id`
        );
        res.json({ success: true, staff: result.rows });
    } catch (err) {
        log.error('List staff options error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/link-conflicts — account/person/staff linkage health summary
router.get('/link-conflicts', requireAction('manage_accounts'), async (req, res) => {
    try {
        const result = await getAccountLinkConflicts({ limit: req.query.limit || 25 });
        res.json({
            success: true,
            ...result,
            canonical: {
                accountTruth: 'users',
                bridgeTruth: 'employee_profiles',
                staffTruth: 'staff'
            }
        });
    } catch (err) {
        log.error('Account link conflict report error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/onboarding/options — aggregate data for the controlled account onboarding wizard
router.get('/onboarding/options', requireAction('manage_accounts'), requireAction('hr.staff.manage'), async (req, res) => {
    try {
        const [staffResult, professionResult, structureResult, conditionResult] = await Promise.all([
            pool.query(
                `SELECT s.id, s.name, s.department, s.position, s.phone, s.hire_date,
                        s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                        s.company_structure_node_id, s.hourly_rate, COALESCE(s.rate_unit, 'hour') AS rate_unit,
                        COALESCE(s.is_active, true) AS is_active,
                        COALESCE(assignments.items, '[]'::jsonb) AS role_assignments,
                        ep.user_id AS linked_user_id, ep.is_active AS profile_active,
                        u.username AS linked_username, u.is_active AS linked_user_active
                 FROM staff s
                 LEFT JOIN LATERAL (
                     SELECT profile.user_id, profile.is_active
                     FROM employee_profiles profile
                     WHERE profile.staff_id = s.id
                     ORDER BY (profile.user_id IS NOT NULL) DESC, COALESCE(profile.is_active, true) DESC, profile.id DESC
                     LIMIT 1
                 ) ep ON true
                 LEFT JOIN users u ON u.id = ep.user_id
                 LEFT JOIN LATERAL (
                     SELECT jsonb_agg(
                         jsonb_build_object(
                             'key', assignment.profession_key,
                             'isPrimary', assignment.is_primary,
                             'status', assignment.status,
                             'admissionStatus', assignment.admission_status,
                             'internshipStatus', assignment.internship_status
                         )
                         ORDER BY assignment.is_primary DESC, assignment.id
                     ) AS items
                     FROM staff_role_assignments assignment
                     WHERE assignment.staff_id = s.id
                 ) assignments ON true
                 WHERE COALESCE(s.is_active, true) = true
                 ORDER BY s.department, lower(s.name), s.id`
            ),
            pool.query(
                `SELECT id, key, title, department, short_info, responsibilities, checklist,
                        color, structure_node_id, sort_order, is_active
                 FROM hr_professions
                 ORDER BY sort_order, lower(title), id`
            ),
            pool.query("SELECT value FROM settings WHERE key = 'hr_company_structure'"),
            pool.query(
                `SELECT keys.staff_id, keys.profession_key,
                        rate.hourly_rate AS explicit_rate,
                        COALESCE(
                            jsonb_agg(
                                jsonb_build_object(
                                    'dayType', pref.day_type,
                                    'startTime', to_char(pref.start_time, 'HH24:MI'),
                                    'endTime', to_char(pref.end_time, 'HH24:MI'),
                                    'isActive', COALESCE(pref.is_active, true)
                                )
                                ORDER BY CASE pref.day_type WHEN 'weekday' THEN 1 WHEN 'weekend' THEN 2 ELSE 3 END
                            ) FILTER (WHERE pref.day_type IS NOT NULL),
                            '[]'::jsonb
                        ) AS shift_preferences
                 FROM (
                     SELECT staff_id, profession_key FROM staff_role_assignments
                     UNION
                     SELECT staff_id, profession_key FROM staff_profession_rates
                     UNION
                     SELECT staff_id, profession_key FROM staff_shift_preferences
                 ) keys
                 JOIN staff s ON s.id = keys.staff_id AND COALESCE(s.is_active, true) IS TRUE
                 LEFT JOIN staff_profession_rates rate
                   ON rate.staff_id = keys.staff_id AND rate.profession_key = keys.profession_key
                 LEFT JOIN staff_shift_preferences pref
                   ON pref.staff_id = keys.staff_id AND pref.profession_key = keys.profession_key
                 GROUP BY keys.staff_id, keys.profession_key, rate.hourly_rate
                 ORDER BY keys.staff_id, keys.profession_key`
            )
        ]);
        const structure = normalizeStaffCompanyStructurePayload(structureResult.rows[0]?.value || {});
        const conditionsByStaff = new Map();
        conditionResult.rows.forEach(row => {
            const staffId = Number(row.staff_id);
            if (!conditionsByStaff.has(staffId)) conditionsByStaff.set(staffId, []);
            conditionsByStaff.get(staffId).push({
                professionKey: row.profession_key,
                rateMode: row.explicit_rate == null ? 'fallback' : 'explicit',
                explicitRate: row.explicit_rate == null ? null : Number(row.explicit_rate),
                shiftPreferences: row.shift_preferences || []
            });
        });
        res.json({
            success: true,
            staff: staffResult.rows.map(staff => ({
                ...staff,
                profession_conditions: conditionsByStaff.get(Number(staff.id)) || []
            })),
            professions: curateProfessionCatalogRows(professionResult.rows).filter(row => row.is_active !== false),
            structureNodes: structure.nodes.map(node => ({
                id: node.id,
                title: node.title,
                parentId: node.parentId || null,
                archived: node.archived === true
            })),
            roleHierarchy: ROLE_HIERARCHY,
            rolePresets: {
                management: ['senior_manager', 'manager'],
                operations: ['admin', 'reception', 'security'],
                creative: ['art_director', 'marketer'],
                finance: ['accountant'],
                programs: ['senior_instructor', 'instructor', 'animator'],
                support: ['barista', 'wardrobe', 'cleaning', 'maintenance', 'dishwasher', 'waiter']
            },
            businessContexts: businessContextCatalog(),
            professionRoleMap: PROFESSION_ACCOUNT_ROLE_MAP,
            nonDelegableActions: Array.from(NON_DELEGABLE_ACTIONS)
        });
    } catch (err) {
        log.error('Account onboarding options error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити дані для створення акаунта' });
    }
});

// POST /api/users/onboarding — atomically create/link account and HR working setup
router.post('/onboarding', requireAction('manage_accounts'), requireAction('hr.staff.manage'), async (req, res) => {
    try {
        const result = await createAccountOnboarding({
            payload: req.body || {},
            actor: req.user,
            req
        });
        log.info(`User ${req.user.username} completed controlled account onboarding for ${result?.receipt?.account?.username || 'new account'}`);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Controlled account onboarding error', err);
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'ACCOUNT_ONBOARDING_FAILED',
            error: err.statusCode ? err.message : 'Не вдалося завершити створення акаунта'
        });
    }
});

// GET /api/users/:id/workspace — canonical account detail payload for master-detail UI
router.get('/:id/workspace', requireAction('manage_accounts'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, error: 'Некоректний account id' });
        }
        const result = await pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.page_allowlist, u.page_denylist,
                    u.action_allowlist, u.action_denylist, u.business_contexts, u.default_business_context,
                    u.is_active, u.created_at, u.last_seen_at, u.password_changed_at, u.session_revoked_at,
                    ep.id AS profile_id, ep.staff_id, ep.full_name AS profile_name, ep.is_active AS profile_active,
                    s.name AS staff_name, s.department AS staff_department, s.position AS staff_position,
                    s.role_type AS staff_role_type, s.is_active AS staff_active, s.company_structure_node_id
             FROM users u
             LEFT JOIN LATERAL (
                 SELECT profile.id, profile.staff_id, profile.full_name, profile.is_active
                 FROM employee_profiles profile
                 WHERE profile.user_id = u.id
                 ORDER BY COALESCE(profile.is_active, true) DESC, profile.id DESC
                 LIMIT 1
             ) ep ON true
             LEFT JOIN staff s ON s.id = ep.staff_id
             WHERE u.id = $1`,
            [userId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Акаунт не знайдено' });
        const user = decorateManagedAccount(result.rows[0], req.user);
        const history = await listAccountSecurityEvents(userId, 20);
        res.json({
            success: true,
            user,
            history,
            actions: {
                canMutate: user.can_mutate,
                canToggle: user.can_toggle,
                canUnlink: user.can_unlink,
                protectedAccount: user.protected_account
            }
        });
    } catch (err) {
        log.error('Account workspace error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити картку акаунта' });
    }
});

// PATCH /api/users/:id/profile — edit account identity and HR staff binding
router.patch('/:id/profile', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { name } = req.body;
        const staffId = normalizeStaffId(req.body.staffId);

        if (!name || !String(name).trim()) return res.status(400).json({ error: 'Імʼя обовʼязкове' });
        if (Number.isNaN(staffId)) {
            return res.status(400).json({ error: 'Некоректний staff-профіль' });
        }

        await client.query('BEGIN');
        const target = await client.query(
            'SELECT id, username, name, role, extra_roles, is_active FROM users WHERE id = $1 FOR UPDATE',
            [parseInt(id, 10)]
        );
        if (target.rows.length === 0) {
            const err = new Error('Користувача не знайдено');
            err.statusCode = 404;
            throw err;
        }
        const current = target.rows[0];
        assertAccountMutable(current, 'profile_update');
        if (!canMutateSensitiveAccount(req.user, current)) {
            const err = new Error('Цей акаунт не можна редагувати з поточного рівня доступу');
            err.statusCode = 403;
            throw err;
        }
        const requestedUsername = req.body.username == null
            ? current.username
            : normalizeUsername(req.body.username);
        if (!requestedUsername || requestedUsername.toLowerCase() !== String(current.username).toLowerCase()) {
            const err = new Error('Username є незмінним після створення акаунта');
            err.statusCode = 409;
            err.code = 'USERNAME_IMMUTABLE';
            throw err;
        }

        const updated = await client.query(
            `UPDATE users
             SET name = $1
             WHERE id = $2
             RETURNING id, username, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, is_active`,
            [String(name).trim(), parseInt(id, 10)]
        );

        const staffLink = staffId
            ? await linkUserToStaffProfile(client, {
                userId: parseInt(id, 10),
                staffId,
                actor: req.user,
                req,
                eventType: 'account_profile_staff_linked',
                details: { source: 'users_profile_editor' }
            })
            : await unlinkUserFromStaffProfiles(client, {
                userId: parseInt(id, 10),
                actor: req.user,
                req,
                eventType: 'account_profile_staff_unlinked',
                details: { source: 'users_profile_editor' }
            });
        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: 'account_profile_updated',
            reason: 'account_management',
            details: {
                changedUsername: false,
                staffLinked: !!staffId
            },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} updated account profile for ${target.rows[0].username}`);
        res.json({ success: true, user: updated.rows[0], staff: staffLink?.staff || null, link: staffLink || null });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Update account profile error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// PATCH /api/users/:id/role — change user role (creator + director only)
router.patch('/:id/access', requireAction('manage_accounts'), updateAccountAccess);
router.patch('/:id/role', requireAction('manage_accounts'), updateAccountAccess);

// A QA lease overlays creator access without ever changing the account's base role.
router.post('/:id/qa-creator-lease', requireAction('manage_accounts'), async (req, res) => {
    let client = null;
    try {
        const userId = qaLeaseAccountId(req.params.id);
        const durationSeconds = normalizeQaCreatorLeaseDuration(req.body?.durationSeconds);
        client = await pool.connect();
        await client.query('BEGIN');
        const actor = await assertPermanentCreatorForQaLease(client, req.user);
        const target = await selectQaLeaseTarget(client, userId);
        assertQaLeaseTarget(target, actor.id);

        const leaseId = crypto.randomUUID();
        const updated = await client.query(
            `UPDATE users
             SET qa_creator_lease_id = $1::uuid,
                 qa_creator_lease_expires_at = NOW() + ($2 * INTERVAL '1 second'),
                 qa_creator_lease_granted_by_user_id = $3
             WHERE id = $4
             RETURNING qa_creator_lease_id::text AS qa_creator_lease_id, qa_creator_lease_expires_at`,
            [leaseId, durationSeconds, actor.id, userId]
        );
        const lease = updated.rows[0];
        if (!lease) throw qaCreatorLeaseError('QA lease не вдалося створити', 'QA_CREATOR_LEASE_CREATE_FAILED', 500);
        await recordAccountSecurityEvent({
            actor,
            target,
            eventType: 'qa_creator_lease_started',
            reason: 'authenticated_live_qa',
            details: { durationSeconds, expiresAt: lease.qa_creator_lease_expires_at, leaseId },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            leaseId: lease.qa_creator_lease_id,
            expiresAt: lease.qa_creator_lease_expires_at,
            role: QA_CREATOR_ROLE
        });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        log.error('Create QA creator lease error', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Internal server error',
            ...(err.code ? { code: err.code } : {})
        });
    } finally {
        client?.release();
    }
});

router.delete('/:id/qa-creator-lease', requireAction('manage_accounts'), async (req, res) => {
    let client = null;
    try {
        const userId = qaLeaseAccountId(req.params.id);
        const leaseId = normalizeLeaseId(req.body?.leaseId);
        if (!leaseId) throw qaCreatorLeaseError('Некоректний QA lease id', 'QA_CREATOR_LEASE_ID_INVALID');
        client = await pool.connect();
        await client.query('BEGIN');
        const actor = await assertPermanentCreatorForQaLease(client, req.user);
        const target = await selectQaLeaseTarget(client, userId);
        assertQaLeaseTarget(target, actor.id);
        const revoked = await client.query(
            `UPDATE users
             SET qa_creator_lease_id = NULL,
                 qa_creator_lease_expires_at = NULL,
                 qa_creator_lease_granted_by_user_id = NULL
             WHERE id = $1 AND qa_creator_lease_id = $2::uuid
             RETURNING id`,
            [userId, leaseId]
        );
        if (!revoked.rowCount) {
            throw qaCreatorLeaseError('QA lease вже протух або був замінений', 'QA_CREATOR_LEASE_NOT_ACTIVE', 409);
        }
        await recordAccountSecurityEvent({
            actor,
            target,
            eventType: 'qa_creator_lease_revoked',
            reason: 'authenticated_live_qa',
            details: { leaseId },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');
        res.json({ success: true, leaseId });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        log.error('Revoke QA creator lease error', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Internal server error',
            ...(err.code ? { code: err.code } : {})
        });
    } finally {
        client?.release();
    }
});

async function updateAccountAccess(req, res) {
    let client = null;
    try {
        const { id } = req.params;
        const { role, extraRoles, businessContexts } = req.body;
        const pageAllowlistInput = req.body.pageAllowlist ?? req.body.page_allowlist;
        const pageDenylistInput = req.body.pageDenylist ?? req.body.page_denylist;
        const actionAllowlistInput = req.body.actionAllowlist ?? req.body.action_allowlist;
        const actionDenylistInput = req.body.actionDenylist ?? req.body.action_denylist;
        const requestedDefaultBusinessContext = req.body.defaultBusinessContext ?? req.body.default_business_context;

        if (!role || !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        const normalizedExtraRoles = Array.isArray(extraRoles)
            ? Array.from(new Set(extraRoles.filter(item => ROLE_HIERARCHY.includes(item) && item !== role))).slice(0, 3)
            : null;
        const normalizedPageAllowlist = pageAllowlistInput !== undefined
            ? normalizePageAllowlistUpdateInput(pageAllowlistInput, { strict: true, fieldName: 'pageAllowlist' }).slice(0, 50)
            : null;
        const normalizedPageDenylist = pageDenylistInput !== undefined
            ? normalizePageDenylistInput(pageDenylistInput, { strict: true, fieldName: 'pageDenylist' }).slice(0, 50)
            : null;
        const normalizedActionAllowlist = actionAllowlistInput !== undefined
            ? normalizeActionAllowlist(actionAllowlistInput, { strict: true, fieldName: 'actionAllowlist' })
            : null;
        const normalizedActionDenylist = actionDenylistInput !== undefined
            ? normalizeActionOverrideList(actionDenylistInput, { strict: true, fieldName: 'actionDenylist', excludeDeprecated: true })
            : null;

        client = await pool.connect();
        await client.query('BEGIN');
        const target = await client.query(
            `SELECT id, username, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist,
                    action_denylist, business_contexts, default_business_context, is_active
             FROM users WHERE id = $1 FOR UPDATE`,
            [parseInt(id)]
        );
        if (target.rows.length === 0) {
            const err = new Error('Користувача не знайдено');
            err.statusCode = 404;
            throw err;
        }
        const current = target.rows[0];
        assertAccountMutable(current, 'access_update');
        if (!canMutateSensitiveAccount(req.user, current)) {
            const err = new Error('Цей акаунт не можна змінити з поточного рівня доступу');
            err.statusCode = 403;
            throw err;
        }
        if (!canCreateAccount(req.user, role, normalizedExtraRoles || normalizeStoredArray(current.extra_roles))) {
            const err = new Error('Не можна призначити акаунту такий рівень доступу');
            err.statusCode = 403;
            throw err;
        }

        const oldRole = current.role;
        const oldExtraRoles = normalizeStoredArray(current.extra_roles);
        const oldPageAllowlist = normalizePageAllowlist(current);
        const oldPageDenylist = accountPageDenylist(current);
        assertNoNewExplicitAllowDisabledPages(normalizedPageAllowlist, oldPageAllowlist);
        const oldActionAllowlist = accountActionAllowlist(current);
        const oldActionDenylist = accountActionDenylist(current);
        const oldBusinessContexts = normalizeStoredArray(current.business_contexts);
        const oldDefaultBusinessContext = current.default_business_context
            || defaultBusinessContextForSelection(null, oldBusinessContexts, oldRole);
        const defaultNeedsUpdate = Object.prototype.hasOwnProperty.call(req.body, 'defaultBusinessContext')
            || Object.prototype.hasOwnProperty.call(req.body, 'default_business_context')
            || Array.isArray(businessContexts);
        const normalizedDefaultBusinessContext = defaultNeedsUpdate
            ? defaultBusinessContextForSelection(
                requestedDefaultBusinessContext || oldDefaultBusinessContext,
                Array.isArray(businessContexts) ? businessContexts : oldBusinessContexts,
                role
            )
            : null;
        const normalizedBusinessContexts = Array.isArray(businessContexts) || normalizedDefaultBusinessContext
            ? businessContextsWithDefault(
                Array.isArray(businessContexts) ? businessContexts : oldBusinessContexts,
                normalizedDefaultBusinessContext || oldDefaultBusinessContext,
                role
            )
            : null;
        const prospectiveAccount = {
            ...current,
            role,
            extra_roles: normalizedExtraRoles || oldExtraRoles,
            page_allowlist: normalizedPageAllowlist || oldPageAllowlist,
            page_denylist: normalizedPageDenylist || oldPageDenylist,
            action_allowlist: normalizedActionAllowlist || oldActionAllowlist,
            action_denylist: normalizedActionDenylist || oldActionDenylist,
            business_contexts: normalizedBusinessContexts || oldBusinessContexts,
            default_business_context: normalizedDefaultBusinessContext || oldDefaultBusinessContext
        };
        assertNoCapabilityConflicts(prospectiveAccount.page_allowlist, prospectiveAccount.page_denylist, CAPABILITY_TYPES.PAGE);
        assertNoCapabilityConflicts(prospectiveAccount.action_allowlist, prospectiveAccount.action_denylist);
        assertSelfAccountAccessSafe(req.user, prospectiveAccount);
        await assertLastActiveCreatorInvariant(client, current, {
            role,
            extraRoles: prospectiveAccount.extra_roles,
            actionDenylist: prospectiveAccount.action_denylist,
            isActive: current.is_active !== false
        });
        const updated = await client.query(
            `UPDATE users
             SET role = $1,
                 extra_roles = COALESCE($2::text[], extra_roles),
                 page_allowlist = COALESCE($3::text[], page_allowlist),
                 page_denylist = COALESCE($4::text[], page_denylist),
                 action_allowlist = COALESCE($5::text[], action_allowlist),
                 action_denylist = COALESCE($6::text[], action_denylist),
                 business_contexts = COALESCE($7::text[], business_contexts),
                 default_business_context = COALESCE($8::text, default_business_context),
                 session_revoked_at = clock_timestamp()
             WHERE id = $9
             RETURNING id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context`,
            [role, normalizedExtraRoles, normalizedPageAllowlist, normalizedPageDenylist, normalizedActionAllowlist, normalizedActionDenylist, normalizedBusinessContexts, normalizedDefaultBusinessContext, parseInt(id)]
        );
        const updatedUser = updated.rows[0] || target.rows[0];
        const newExtraRoles = normalizeStoredArray(updatedUser.extra_roles);
        const newPageAllowlist = normalizePageAllowlist(updatedUser);
        const newPageDenylist = accountPageDenylist(updatedUser);
        const newActionAllowlist = accountActionAllowlist(updatedUser);
        const newActionDenylist = accountActionDenylist(updatedUser);
        const newBusinessContexts = normalizeStoredArray(updatedUser.business_contexts);
        const newDefaultBusinessContext = updatedUser.default_business_context
            || defaultBusinessContextForSelection(null, newBusinessContexts, updatedUser.role);
        await revokeAllUserTokens(parseInt(id), client);

        await recordAccountSecurityEvent({
            actor: req.user,
            target: current,
            eventType: 'account_access_updated',
            reason: 'account_management',
            details: {
                oldRole,
                newRole: updatedUser.role,
                oldExtraRoles,
                newExtraRoles,
                oldPageAllowlist,
                newPageAllowlist,
                oldPageDenylist,
                newPageDenylist,
                oldActionAllowlist,
                newActionAllowlist,
                oldActionDenylist,
                newActionDenylist,
                oldBusinessContexts,
                newBusinessContexts,
                oldDefaultBusinessContext,
                newDefaultBusinessContext,
                sessionsRevoked: true,
                changed: {
                    role: oldRole !== updatedUser.role,
                    extraRoles: !sameStringArray(oldExtraRoles, newExtraRoles),
                    pageAllowlist: !sameStringArray(oldPageAllowlist, newPageAllowlist),
                    pageDenylist: !sameStringArray(oldPageDenylist, newPageDenylist),
                    actionAllowlist: !sameStringArray(oldActionAllowlist, newActionAllowlist),
                    actionDenylist: !sameStringArray(oldActionDenylist, newActionDenylist),
                    businessContexts: !sameStringArray(oldBusinessContexts, newBusinessContexts),
                    defaultBusinessContext: oldDefaultBusinessContext !== newDefaultBusinessContext
                }
            },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} changed role of ${current.username}: ${oldRole} → ${updatedUser.role}`);
        res.json({
            success: true,
            username: current.username,
            oldRole,
            newRole: updatedUser.role,
            extraRoles: newExtraRoles,
            pageAllowlist: newPageAllowlist,
            pageDenylist: newPageDenylist,
            page_denylist: newPageDenylist,
            actionAllowlist: newActionAllowlist,
            actionDenylist: newActionDenylist,
            action_allowlist: newActionAllowlist,
            action_denylist: newActionDenylist,
            businessContexts: newBusinessContexts,
            defaultBusinessContext: newDefaultBusinessContext
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        log.error('Change role error', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Internal server error',
            ...(err.code ? { code: err.code } : {}),
            ...(err.details ? { details: err.details } : {})
        });
    } finally {
        client?.release();
    }
}

// POST /api/users/:id/reset-password — reset password (account admins, guarded)
router.post('/:id/reset-password', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const manualPassword = resetPasswordFromPayload(req.body || {});
        const issueOneTime = req.body?.issueOneTime === true || req.body?.generate === true;
        const activateOnReset = shouldActivateAfterPasswordReset(req.body || {});

        if (!manualPassword && !issueOneTime) {
            return res.status(400).json({ error: 'Потрібен новий пароль або one-time reissue' });
        }
        const finalPassword = issueOneTime ? generateOneTimePassword() : manualPassword;
        if (finalPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }

        await client.query('BEGIN');
        const target = await client.query(
            'SELECT id, username, name, role, extra_roles, is_active, login_aliases FROM users WHERE id = $1 FOR UPDATE',
            [parseInt(id)]
        );
        if (target.rows.length === 0) {
            const err = new Error('Користувача не знайдено');
            err.statusCode = 404;
            throw err;
        }
        assertAccountMutable(target.rows[0], 'password_reset');
        if (!canMutateSensitiveAccount(req.user, target.rows[0])) {
            const err = new Error('Цей акаунт не можна змінити з поточного рівня доступу');
            err.statusCode = 403;
            throw err;
        }
        if (activateOnReset && target.rows[0].is_active === false && !canToggleAccount(req.user, target.rows[0])) {
            const err = new Error('Цей акаунт не можна активувати з поточного рівня доступу');
            err.statusCode = 403;
            throw err;
        }

        const hash = await bcrypt.hash(finalPassword, 10);
        const hashVerified = await bcrypt.compare(finalPassword, hash);
        if (!hashVerified) {
            throw new Error('password_hash_verified_after_reset_failed');
        }
        const updated = await client.query(
            `UPDATE users
             SET password_hash = $1,
                 password_changed_at = NOW(),
                 session_revoked_at = clock_timestamp(),
                 is_active = CASE WHEN $3::boolean THEN true ELSE is_active END
             WHERE id = $2
             RETURNING id, username, is_active, password_changed_at, session_revoked_at`,
            [hash, parseInt(id), activateOnReset]
        );
        const activatedByReset = activateOnReset && target.rows[0].is_active === false && updated.rows[0]?.is_active !== false;
        if (activatedByReset) {
            await client.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1 AND staff_id IS NOT NULL', [parseInt(id)]);
        }
        const loginCheck = await verifyIssuedCredential({
            client,
            username: updated.rows[0]?.username || target.rows[0].username,
            password: finalPassword
        });
        if (updated.rows[0]?.is_active !== false && !loginCheck.loginReady) {
            throw new Error(`password_login_ready_check_failed_after_reset:${loginCheck.reason}`);
        }
        await revokeAllUserTokens(parseInt(id), client);
        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: issueOneTime ? 'password_one_time_reissued' : 'password_reset_by_admin',
            reason: 'account_management',
            details: { sessionsRevoked: true, oneTimeIssued: issueOneTime, activateOnReset, activatedByReset, loginReady: loginCheck.loginReady },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} reset password for ${target.rows[0].username}`);
        res.json({
            success: true,
            username: target.rows[0].username,
            login: target.rows[0].username,
            loginAliases: Array.isArray(target.rows[0].login_aliases) ? target.rows[0].login_aliases : [],
            isActive: updated.rows[0]?.is_active !== false,
            wasActive: target.rows[0].is_active !== false,
            activated: activatedByReset,
            loginReady: loginCheck.loginReady,
            loginReadyReason: loginCheck.reason,
            passwordChangedAt: updated.rows[0]?.password_changed_at || null,
            sessionRevokedAt: updated.rows[0]?.session_revoked_at || null,
            credential: issueOneTime ? oneTimeCredential(target.rows[0].username, finalPassword, 'password_reissue') : null
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Reset password error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// PATCH /api/users/:id/active — activate/deactivate user (account admins, guarded)
router.patch('/:id/active', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive має бути boolean' });
        }

        await client.query('BEGIN');
        const target = await client.query(
            'SELECT id, username, name, role, extra_roles, action_denylist, is_active FROM users WHERE id = $1 FOR UPDATE',
            [parseInt(id)]
        );
        if (target.rows.length === 0) {
            const err = new Error('Користувача не знайдено');
            err.statusCode = 404;
            throw err;
        }
        assertAccountMutable(target.rows[0], 'active_status_update');

        if (!canToggleAccount(req.user, target.rows[0])) {
            const err = new Error('Цей акаунт не можна змінити з поточного рівня доступу');
            err.statusCode = 403;
            throw err;
        }

        await assertLastActiveCreatorInvariant(client, target.rows[0], {
            role: target.rows[0].role,
            extraRoles: normalizeStoredArray(target.rows[0].extra_roles),
            actionDenylist: normalizeStoredArray(target.rows[0].action_denylist),
            isActive: !!isActive
        });
        await client.query(
            `UPDATE users
             SET is_active = $1,
                 session_revoked_at = CASE WHEN $1 = false THEN clock_timestamp() ELSE session_revoked_at END
             WHERE id = $2`,
            [!!isActive, parseInt(id)]
        );
        if (!isActive) {
            await client.query('UPDATE employee_profiles SET is_active = false WHERE user_id = $1', [parseInt(id)]);
            await revokeAllUserTokens(parseInt(id), client);
        } else {
            await client.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1 AND staff_id IS NOT NULL', [parseInt(id)]);
        }

        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: isActive ? 'account_activated' : 'account_deactivated',
            reason: 'account_management',
            details: { sessionsRevoked: !isActive },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} ${isActive ? 'activated' : 'deactivated'} ${target.rows[0].username}`);
        res.json({ success: true, username: target.rows[0].username, isActive: !!isActive });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Toggle active error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/users — create new user (account admins, guarded)
router.post('/', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { password, name, role, extraRoles, businessContexts } = req.body;
        const pageAllowlistInput = req.body.pageAllowlist ?? req.body.page_allowlist;
        const pageDenylistInput = req.body.pageDenylist ?? req.body.page_denylist;
        const actionAllowlistInput = req.body.actionAllowlist ?? req.body.action_allowlist;
        const actionDenylistInput = req.body.actionDenylist ?? req.body.action_denylist;
        const requestedDefaultBusinessContext = req.body.defaultBusinessContext ?? req.body.default_business_context;
        const issueOneTime = req.body?.issueOneTime === true || req.body?.generate === true || !password;
        const username = normalizeUsername(req.body.username);
        const staffId = normalizeStaffId(req.body.staffId);

        if (!username || !name) {
            return res.status(400).json({ error: 'username та name обов\'язкові' });
        }
        if (username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(username)) {
            return res.status(400).json({ error: 'Логін має містити 3-50 символів: латиниця, цифри, крапка, дефіс або підкреслення' });
        }
        if (isProtectedSystemAccount({ username, name })) {
            return res.status(409).json({ error: 'Це імʼя зарезервоване для захищеного системного акаунта' });
        }
        const finalPassword = issueOneTime ? generateOneTimePassword() : normalizeManualPassword(password);
        if (finalPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }
        if (Number.isNaN(staffId)) {
            return res.status(400).json({ error: 'Некоректний staff-профіль' });
        }
        if (role && !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        const primaryRole = role || 'admin';
        const normalizedExtraRoles = Array.isArray(extraRoles)
            ? Array.from(new Set(extraRoles.filter(item => ROLE_HIERARCHY.includes(item) && item !== primaryRole))).slice(0, 3)
            : [];
        const normalizedPageAllowlist = pageAllowlistInput !== undefined
            ? normalizePageAllowlistInput(pageAllowlistInput, { strict: true, fieldName: 'pageAllowlist' }).slice(0, 50)
            : [];
        const normalizedPageDenylist = pageDenylistInput !== undefined
            ? normalizePageDenylistInput(pageDenylistInput, { strict: true, fieldName: 'pageDenylist' }).slice(0, 50)
            : [];
        const normalizedActionAllowlist = actionAllowlistInput !== undefined
            ? normalizeActionAllowlist(actionAllowlistInput, { strict: true, fieldName: 'actionAllowlist' })
            : [];
        const normalizedActionDenylist = actionDenylistInput !== undefined
            ? normalizeActionOverrideList(actionDenylistInput, { strict: true, fieldName: 'actionDenylist', excludeDeprecated: true })
            : [];
        assertNoCapabilityConflicts(normalizedPageAllowlist, normalizedPageDenylist, CAPABILITY_TYPES.PAGE);
        assertNoCapabilityConflicts(normalizedActionAllowlist, normalizedActionDenylist);
        const normalizedDefaultBusinessContext = defaultBusinessContextForSelection(
            requestedDefaultBusinessContext,
            Array.isArray(businessContexts) ? businessContexts : [],
            primaryRole
        );
        const normalizedBusinessContexts = businessContextsWithDefault(
            Array.isArray(businessContexts) ? businessContexts : [],
            normalizedDefaultBusinessContext,
            primaryRole
        );

        if (!canCreateAccount(req.user, primaryRole, normalizedExtraRoles)) {
            return res.status(403).json({ error: 'Не можна створити акаунт з таким рівнем доступу' });
        }

        await client.query('BEGIN');
        await reserveUsernameIdentity(client, username, {
            code: 'ACCOUNT_USERNAME_OCCUPIED',
            message: 'Акаунт або login alias з таким username вже існує'
        });
        const hash = await bcrypt.hash(finalPassword, 10);
        const hashVerified = await bcrypt.compare(finalPassword, hash);
        if (!hashVerified) {
            throw new Error('password_hash_verified_after_create_failed');
        }
        const result = await client.query(
            'INSERT INTO users (username, password_hash, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, password_changed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id, username, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, is_active',
            [username, hash, name.trim(), primaryRole, normalizedExtraRoles, normalizedPageAllowlist, normalizedPageDenylist, normalizedActionAllowlist, normalizedActionDenylist, normalizedBusinessContexts, normalizedDefaultBusinessContext]
        );
        const loginCheck = await verifyIssuedCredential({
            client,
            username: result.rows[0].username,
            password: finalPassword
        });
        if (!loginCheck.loginReady) {
            throw new Error(`password_login_ready_check_failed_after_create:${loginCheck.reason}`);
        }

        if (staffId) {
            await linkUserToStaffProfile(client, {
                userId: result.rows[0].id,
                staffId,
                actor: req.user,
                req,
                eventType: 'account_created_with_staff_link',
                details: { source: 'users_create', oneTimeIssued: issueOneTime }
            });
        }
        await recordAccountSecurityEvent({
            actor: req.user,
            target: result.rows[0],
            eventType: 'account_created',
            reason: 'account_management',
            details: { role: primaryRole, extraRoles: normalizedExtraRoles, pageAllowlist: normalizedPageAllowlist, pageDenylist: normalizedPageDenylist, actionAllowlist: normalizedActionAllowlist, actionDenylist: normalizedActionDenylist, businessContexts: normalizedBusinessContexts, defaultBusinessContext: normalizedDefaultBusinessContext, staffLinked: !!staffId, oneTimeIssued: issueOneTime, loginReady: loginCheck.loginReady },
            req,
            client,
            strict: true
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} created user ${username} (role: ${primaryRole})`);

        // Auto-add new user to default chat channels
        try {
            const newUserId = result.rows[0].id;
            const defaultChannels = await pool.query(
                'SELECT id FROM chat_channels WHERE is_default = true'
            );
            for (const ch of defaultChannels.rows) {
                await pool.query(
                    'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [ch.id, newUserId]
                );
            }
        } catch (e) { /* non-critical */ }

        res.json({
            success: true,
            user: result.rows[0],
            loginReady: loginCheck.loginReady,
            loginReadyReason: loginCheck.reason,
            credential: issueOneTime ? oneTimeCredential(result.rows[0].username, finalPassword, 'account_create') : null
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Create user error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
