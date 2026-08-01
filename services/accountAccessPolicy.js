'use strict';

const {
    ROLE_HIERARCHY,
    PAGE_PERMISSIONS,
    ACTION_PERMISSIONS: ACTION_PERMISSION_ENTRIES,
    PAGE_PERMISSION_BY_KEY,
    ACTION_PERMISSION_BY_KEY,
    PAGE_ALIAS_TO_CANONICAL,
    canonicalizePageKey
} = require('../config/permissionRegistry');

const CAPABILITY_TYPES = Object.freeze({
    PAGE: 'page',
    ACTION: 'action'
});

const PAGE_ACCESS = Object.freeze(Object.fromEntries(
    PAGE_PERMISSIONS.map(entry => [entry.key, entry.defaultRoles])
));
const ACTION_PERMISSIONS = Object.freeze(Object.fromEntries(
    ACTION_PERMISSION_ENTRIES.map(entry => [entry.key, entry.defaultRoles])
));
const NON_DELEGABLE_ACTIONS = new Set(
    ACTION_PERMISSION_ENTRIES.filter(entry => entry.delegable === false).map(entry => entry.key)
);
const ACTION_ALIAS_TO_CANONICAL = Object.freeze(ACTION_PERMISSION_ENTRIES.reduce((result, entry) => {
    entry.aliases.forEach(alias => { result[alias] = entry.key; });
    return result;
}, {}));

class CapabilityValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'CapabilityValidationError';
        this.code = code;
        this.statusCode = 400;
        this.details = details;
    }
}

function normalizeRawList(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[,;\s]+/);
    return source.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeRoleList(user = {}) {
    const roles = [];
    if (user?.role) roles.push(user.role);
    if (Array.isArray(user?.roles)) roles.push(...user.roles);
    if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
    if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
    return Array.from(new Set(roles.filter(role => ROLE_HIERARCHY.includes(role))));
}

function normalizeCapability(capability, context = {}) {
    const requestedType = context.type || capability?.type || null;
    let rawKey = typeof capability === 'object' && capability !== null
        ? capability.key
        : capability;
    rawKey = String(rawKey || '').trim();

    let type = requestedType;
    if (rawKey.startsWith('page:')) {
        type = CAPABILITY_TYPES.PAGE;
        rawKey = rawKey.slice(5);
    } else if (rawKey.startsWith('action:')) {
        type = CAPABILITY_TYPES.ACTION;
        rawKey = rawKey.slice(7);
    } else if (!type) {
        type = rawKey.startsWith('/') || rawKey.startsWith('#')
            ? CAPABILITY_TYPES.PAGE
            : CAPABILITY_TYPES.ACTION;
    }

    if (type === CAPABILITY_TYPES.PAGE) {
        const key = canonicalizePageKey(rawKey);
        return {
            type,
            requestedKey: rawKey,
            key,
            id: key ? `page:${key}` : '',
            definition: PAGE_PERMISSION_BY_KEY[key] || null,
            known: Boolean(key && PAGE_PERMISSION_BY_KEY[key])
        };
    }

    if (type === CAPABILITY_TYPES.ACTION) {
        const key = ACTION_ALIAS_TO_CANONICAL[rawKey] || rawKey;
        return {
            type,
            requestedKey: rawKey,
            key,
            id: key ? `action:${key}` : '',
            definition: ACTION_PERMISSION_BY_KEY[key] || null,
            known: Boolean(key && ACTION_PERMISSION_BY_KEY[key])
        };
    }

    return {
        type: String(type || ''),
        requestedKey: rawKey,
        key: rawKey,
        id: '',
        definition: null,
        known: false
    };
}

function normalizeCapabilityList(value, type, options = {}) {
    const result = [];
    const unknownKeys = [];
    const nonDelegableKeys = [];
    const explicitAllowDisabledKeys = [];

    for (const rawKey of normalizeRawList(value)) {
        const normalized = normalizeCapability(rawKey, { type });
        if (!normalized.known) {
            unknownKeys.push(rawKey);
            continue;
        }
        if (options.excludeNonDelegable === true
            && normalized.type === CAPABILITY_TYPES.ACTION
            && NON_DELEGABLE_ACTIONS.has(normalized.key)) {
            nonDelegableKeys.push(normalized.key);
            continue;
        }
        if (options.excludeExplicitAllowDisabled === true && normalized.definition.explicitAllow === false) {
            explicitAllowDisabledKeys.push(normalized.key);
            continue;
        }
        if (!result.includes(normalized.key)) result.push(normalized.key);
    }

    if (options.strict === true && unknownKeys.length) {
        const fieldName = options.fieldName || `${type} capabilities`;
        throw new CapabilityValidationError(
            `${fieldName} contains unknown permission keys: ${unknownKeys.join(', ')}`,
            'UNKNOWN_CAPABILITY_KEYS',
            { field: fieldName, unknownKeys }
        );
    }

    if (options.strict === true && explicitAllowDisabledKeys.length) {
        const fieldName = options.fieldName || `${type} capabilities`;
        throw new CapabilityValidationError(
            `${fieldName} contains capabilities that cannot be granted explicitly: ${explicitAllowDisabledKeys.join(', ')}`,
            'EXPLICIT_ALLOW_DISABLED_CAPABILITY',
            { field: fieldName, explicitAllowDisabledKeys }
        );
    }

    return { values: result, unknownKeys, nonDelegableKeys, explicitAllowDisabledKeys };
}

function normalizePageAllowlist(userOrValue) {
    const values = [];
    if (Array.isArray(userOrValue)) values.push(...userOrValue);
    else if (userOrValue && typeof userOrValue === 'object') {
        if (Array.isArray(userOrValue.page_allowlist)) values.push(...userOrValue.page_allowlist);
        if (Array.isArray(userOrValue.pageAllowlist)) values.push(...userOrValue.pageAllowlist);
    }
    return normalizeCapabilityList(values, CAPABILITY_TYPES.PAGE).values;
}

function normalizeActionOverrideList(value) {
    return normalizeCapabilityList(value, CAPABILITY_TYPES.ACTION).values;
}

function assertNoCapabilityConflicts(allowlist, denylist, type = CAPABILITY_TYPES.ACTION) {
    const allowed = normalizeCapabilityList(allowlist, type).values;
    const denied = normalizeCapabilityList(denylist, type).values;
    const conflicts = allowed.filter(key => denied.includes(key));
    if (!conflicts.length) return;
    throw new CapabilityValidationError(
        `Permission keys cannot be both allowed and denied: ${conflicts.join(', ')}`,
        'CAPABILITY_ALLOW_DENY_CONFLICT',
        { type, conflicts }
    );
}

function explicitListsFor(user, type) {
    if (type === CAPABILITY_TYPES.PAGE) {
        return {
            allow: normalizePageAllowlist(user),
            deny: normalizeCapabilityList(
                user?.page_denylist || user?.pageDenylist,
                CAPABILITY_TYPES.PAGE
            ).values
        };
    }
    return {
        allow: normalizeActionOverrideList(user?.action_allowlist || user?.actionAllowlist),
        deny: normalizeActionOverrideList(user?.action_denylist || user?.actionDenylist)
    };
}

function decision(normalized, allowed, source, sourceRole, reason) {
    return Object.freeze({
        allowed,
        source,
        sourceRole: sourceRole || null,
        reason,
        capability: normalized.id,
        type: normalized.type,
        key: normalized.key,
        requestedKey: normalized.requestedKey
    });
}

function resolveCapability(user, capability, context = {}) {
    const normalized = normalizeCapability(capability, context);
    if (!user) {
        return decision(normalized, false, 'default_deny', null, 'user_missing');
    }
    if (!normalized.known) {
        return decision(normalized, false, 'default_deny', null, 'unknown_capability');
    }

    const lists = explicitListsFor(user, normalized.type);
    const overrideKeys = normalized.type === CAPABILITY_TYPES.ACTION
        ? [normalized.key, ...(normalized.definition.legacyKeys || [])]
        : [normalized.key];
    if (overrideKeys.some(key => lists.deny.includes(key))) {
        return decision(normalized, false, 'explicit_deny', null, 'listed_in_explicit_deny');
    }

    const actionNonDelegable = normalized.type === CAPABILITY_TYPES.ACTION
        && NON_DELEGABLE_ACTIONS.has(normalized.key);
    const explicitAllowSupported = normalized.definition.explicitAllow !== false && !actionNonDelegable;
    if (explicitAllowSupported && overrideKeys.some(key => lists.allow.includes(key))) {
        return decision(normalized, true, 'explicit_allow', null, 'listed_in_explicit_allow');
    }

    const roles = context.roles
        ? normalizeRoleList({ role: context.primaryRole, roles: context.roles })
        : normalizeRoleList(user);
    const roleCandidates = actionNonDelegable
        ? [String(context.primaryRole || user.role || '')].filter(Boolean)
        : roles;
    const sourceRole = roleCandidates.find(role => normalized.definition.defaultRoles.includes(role)) || null;
    if (sourceRole) {
        return decision(normalized, true, 'role_preset', sourceRole, 'granted_by_role_preset');
    }

    if (!explicitAllowSupported && overrideKeys.some(key => lists.allow.includes(key))) {
        const reason = actionNonDelegable ? 'non_delegable_explicit_allow_ignored' : 'explicit_allow_disabled';
        return decision(normalized, false, 'default_deny', null, reason);
    }
    return decision(normalized, false, 'default_deny', null, 'no_matching_grant');
}

function buildCapabilityCatalog() {
    return Object.freeze({
        pageRoles: Object.freeze(Object.fromEntries(PAGE_PERMISSIONS.map(entry => [entry.key, entry.defaultRoles]))),
        actionRoles: ACTION_PERMISSIONS,
        pageAliases: PAGE_ALIAS_TO_CANONICAL,
        actionAliases: ACTION_ALIAS_TO_CANONICAL,
        actionLegacyKeys: Object.freeze(Object.fromEntries(ACTION_PERMISSION_ENTRIES.map(entry => [entry.key, entry.legacyKeys || []]))),
        explicitAllowDisabledPages: Object.freeze(PAGE_PERMISSIONS.filter(entry => entry.explicitAllow === false).map(entry => entry.key)),
        explicitAllowDisabledActions: Object.freeze(ACTION_PERMISSION_ENTRIES.filter(entry => entry.explicitAllow === false).map(entry => entry.key)),
        nonDelegableActions: Object.freeze(Array.from(NON_DELEGABLE_ACTIONS))
    });
}

function buildCapabilitySnapshot(user, context = {}) {
    const pages = {};
    const actions = {};
    const decisions = {};

    for (const entry of PAGE_PERMISSIONS) {
        const resolved = resolveCapability(user, entry.key, { ...context, type: CAPABILITY_TYPES.PAGE });
        pages[entry.key] = resolved.allowed;
        decisions[resolved.capability] = resolved;
    }
    for (const entry of ACTION_PERMISSION_ENTRIES) {
        const resolved = resolveCapability(user, entry.key, { ...context, type: CAPABILITY_TYPES.ACTION });
        actions[entry.key] = resolved.allowed;
        decisions[resolved.capability] = resolved;
    }

    return Object.freeze({
        pages: Object.freeze(pages),
        actions: Object.freeze(actions),
        decisions: Object.freeze(decisions),
        catalog: buildCapabilityCatalog()
    });
}

module.exports = {
    CAPABILITY_TYPES,
    CapabilityValidationError,
    ROLE_HIERARCHY,
    PAGE_ACCESS,
    ACTION_PERMISSIONS,
    NON_DELEGABLE_ACTIONS,
    ACTION_ALIAS_TO_CANONICAL,
    normalizeRoleList,
    normalizeCapability,
    normalizeCapabilityList,
    normalizePageAllowlist,
    normalizeActionOverrideList,
    assertNoCapabilityConflicts,
    resolveCapability,
    buildCapabilityCatalog,
    buildCapabilitySnapshot
};
