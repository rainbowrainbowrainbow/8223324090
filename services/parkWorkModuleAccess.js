'use strict';

const { DEFAULT_BUSINESS_CONTEXT, BUSINESS_SCOPE_SINGLE, resolveBusinessScope } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkMembership } = require('./parkLegacyModuleAccess');
const { userBusinessModuleState } = require('./businessModuleRegistry');
const { buildMembershipAccess, applyMembershipAccess } = require('./businessMembership');

const WORK_PAGES = Object.freeze({ chat: '/chat', training: '/training' });

// Owner-approved exclusive Park namespaces. A page preset alone cannot open one.
function canUseParkWorkModule(user, moduleId, context = DEFAULT_BUSINESS_CONTEXT) {
    return Object.hasOwn(WORK_PAGES, moduleId)
        && hasCurrentParkMembership(user, context)
        && userBusinessModuleState(user, context, moduleId).available
        && resolveCapability(user, WORK_PAGES[moduleId], { type: 'page' }).allowed;
}

function requireParkWorkModule(moduleId) {
    if (!Object.hasOwn(WORK_PAGES, moduleId)) throw new TypeError('Unknown Park work module');
    return (req, res, next) => {
        const scope = resolveBusinessScope(req);
        const read = ['GET', 'HEAD'].includes(String(req.method).toUpperCase());
        if (!scope.invalid && scope.mode === BUSINESS_SCOPE_SINGLE
            && (read || scope.canWrite === true)
            && canUseParkWorkModule(req.user, moduleId, scope.activeContext)) return next();
        return res.status(req.user ? 403 : 401).json({ success: false,
            code: `${moduleId}_park_access_required`, error: 'Розділ доступний лише з чинним робочим доступом Парку.' });
    };
}

// Two bounded-shape queries, no per-recipient authorization cache or N+1 loads.
// Resolve target capabilities from current memberships, never a caller's role.
async function loadParkWorkParticipants(db, moduleId, candidateIds = null, { action = null } = {}) {
    if (!Object.hasOwn(WORK_PAGES, moduleId)) throw new TypeError('Unknown Park work module');
    if (action !== null && !(moduleId === 'training' && action === 'training.manage')) throw new TypeError('Invalid recipient action');
    if (candidateIds !== null && (!Array.isArray(candidateIds) || candidateIds.length > 1000
        || candidateIds.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new TypeError('Invalid participant IDs');
    if (candidateIds?.length === 0) return new Map();
    const registry = await db.query(`SELECT b.id AS business_id, b.organization_id, b.context_key,
        b.access_mode, b.status AS business_status, o.status AS organization_status
        FROM businesses b JOIN organizations o ON o.id = b.organization_id WHERE b.context_key = $1`, [DEFAULT_BUSINESS_CONTEXT]);
    const members = await db.query(`SELECT u.id AS user_id, u.username, u.role AS platform_role,
        ARRAY(SELECT profile.staff_id FROM employee_profiles profile
            JOIN staff staff_card ON staff_card.id = profile.staff_id AND staff_card.is_active IS TRUE
            WHERE profile.user_id = u.id AND profile.is_active IS TRUE) AS staff_ids,
        bm.business_id, b.organization_id, b.context_key, b.access_mode,
        b.modules AS business_modules, bm.role, bm.extra_roles, bm.page_allowlist, bm.page_denylist,
        bm.action_allowlist, bm.action_denylist, bm.is_default
        FROM users u
        JOIN business_memberships bm ON bm.user_id = u.id AND bm.is_active IS TRUE
        JOIN businesses b ON b.id = bm.business_id AND b.organization_id = bm.organization_id AND b.status = 'active'
        JOIN organizations o ON o.id = b.organization_id AND o.status = 'active'
        JOIN organization_memberships om ON om.user_id = u.id AND om.organization_id = o.id AND om.is_active IS TRUE
        WHERE u.is_active IS TRUE AND b.context_key = $1
          AND ($2::integer[] IS NULL OR u.id = ANY($2::integer[]))`, [DEFAULT_BUSINESS_CONTEXT, candidateIds]);
    const byUser = new Map();
    for (const row of members.rows) {
        const id = Number(row.user_id);
        if (!byUser.has(id)) byUser.set(id, []);
        byUser.get(id).push(row);
    }
    const allowed = new Map();
    for (const [id, rows] of byUser) {
        const staffIds = Array.isArray(rows[0].staff_ids) ? rows[0].staff_ids.filter(value => Number.isSafeInteger(value) && value > 0) : [];
        const account = { id, role: rows[0].platform_role, username: rows[0].username,
            staffIds: staffIds.length === 1 ? staffIds : [] };
        const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, DEFAULT_BUSINESS_CONTEXT, registry.rows));
        if (canUseParkWorkModule(user, moduleId) && (!action || resolveCapability(user, action).allowed)) allowed.set(id, user);
    }
    return allowed;
}

async function loadParkWorkParticipantIds(...args) {
    return new Set((await loadParkWorkParticipants(...args)).keys());
}

module.exports = { canUseParkWorkModule, requireParkWorkModule, loadParkWorkParticipantIds, loadParkWorkParticipants };
