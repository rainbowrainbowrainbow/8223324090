'use strict';

// Offline review validator only. No DB, network, application startup or apply mode.
const fs = require('node:fs');
// These three source modules expose pure registry/normalization functions;
// none loads the application, database, middleware or provider transports.
const { ROLE_HIERARCHY, PAGE_PERMISSIONS, ACTION_PERMISSIONS } = require('../../../../../config/permissionRegistry');
const { businessModuleCatalog } = require('../../../../../services/businessModuleRegistry');
const { normalizeBusinessContext, normalizeBusinessScopeMode } = require('../../../../../services/businessContext');
const CONTEXTS = new Set(['maysternya_doli', 'crm']);
const ROLES = new Set(ROLE_HIERARCHY.filter(role => role !== 'creator'));
const ORGANIZATION_ROLES = new Set(['owner', 'admin', 'member']);
const PAGE_KEYS = new Set(PAGE_PERMISSIONS.filter(entry => entry.deprecated !== true).map(entry => entry.key));
const ACTION_KEYS = new Set(ACTION_PERMISSIONS.filter(entry => entry.deprecated !== true).map(entry => entry.key));
const DECISION_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
const uniqueStrings = value => Array.isArray(value) && value.every(text)
    && new Set(value).size === value.length;
const nullable = (value, predicate) => value === null || predicate(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const identifierList = (value, allowed) => uniqueStrings(value) && value.every(item => allowed.has(item));

function shape(value, required, optional = []) {
    return object(value) && required.every(key => Object.hasOwn(value, key))
        && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function utcTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const millis = Date.parse(value);
    return Number.isFinite(millis)
        && new Date(millis).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}

function canonicalContext(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(value)
        && normalizeBusinessContext(value) === value && normalizeBusinessScopeMode(value) === 'single';
}

function validate(document) {
    const result = { formatValid: false, collectionStatus: ['NOT_COLLECTED', 'PARTIAL', 'COMPLETE'].includes(document?.collectionStatus)
        ? document.collectionStatus : 'UNKNOWN',
        readyForMigration: false, authorizationVerified: false, safeToApply: false, errors: [], blockers: [] };
    const error = (code, at) => result.errors.push({ code, at });
    if (!object(document)) {
        error('DOCUMENT_REQUIRED', '$'); return result;
    }
    const keys = ['schemaVersion', 'businessContext', 'dataKind', 'collectionStatus', 'source', 'target',
        'approval', 'memberships', 'defaults', 'historicalOwnerMapping'];
    if (!shape(document, keys)) {
        error('UNEXPECTED_DOCUMENT_SHAPE', '$');
    }
    if (document.schemaVersion !== 1 || !CONTEXTS.has(document.businessContext)) error('INVALID_CONTEXT_OR_VERSION', '$');
    if (!['production', 'synthetic'].includes(document.dataKind)) error('INVALID_DATA_KIND', '$.dataKind');
    if (!['NOT_COLLECTED', 'PARTIAL', 'COMPLETE'].includes(document.collectionStatus)) error('INVALID_COLLECTION_STATUS', '$.collectionStatus');
    if (!shape(document.source, ['deploymentSha', 'snapshotAtUtc', 'snapshotSha256', 'effectiveAccessMatrixSha256'])
        || !nullable(document.source?.deploymentSha, sha) || !nullable(document.source?.snapshotAtUtc, utcTimestamp)
        || !nullable(document.source?.snapshotSha256, hash) || !nullable(document.source?.effectiveAccessMatrixSha256, hash))
        error('INVALID_SOURCE', '$.source');
    const moduleKeys = new Set(businessModuleCatalog(document.businessContext).map(module => module.key));
    if (!shape(document.target, ['organizationId', 'businessId', 'contextKey', 'modules'])
        || !nullable(document.target?.organizationId, positive) || !nullable(document.target?.businessId, positive)
        || document.target?.contextKey !== document.businessContext || !identifierList(document.target?.modules, moduleKeys))
        error('INVALID_TARGET', '$.target');
    if (!shape(document.approval, ['status', 'reference', 'mappingSha256'])
        || !DECISION_STATUSES.has(document.approval?.status) || !nullable(document.approval?.reference, text)
        || !nullable(document.approval?.mappingSha256, hash)) error('INVALID_APPROVAL', '$.approval');
    if (!shape(document.historicalOwnerMapping, ['reference', 'sha256', 'decisionsStatus'])
        || !DECISION_STATUSES.has(document.historicalOwnerMapping?.decisionsStatus)
        || !nullable(document.historicalOwnerMapping?.reference, text) || !nullable(document.historicalOwnerMapping?.sha256, hash))
        error('INVALID_HISTORICAL_MAPPING', '$.historicalOwnerMapping');
    if (!Array.isArray(document.memberships) || !Array.isArray(document.defaults)) error('ROWS_REQUIRED', '$');
    const complete = document.collectionStatus === 'COMPLETE';
    if (complete) {
        if (!sha(document.source?.deploymentSha) || !hash(document.source?.snapshotSha256)
            || !hash(document.source?.effectiveAccessMatrixSha256)
            || !utcTimestamp(document.source?.snapshotAtUtc)) error('COMPLETE_SOURCE_BINDING_REQUIRED', '$.source');
        if (!positive(document.target?.organizationId) || !positive(document.target?.businessId)) error('VERIFIED_TARGET_REQUIRED', '$.target');
    }
    const seen = new Set();
    const proposals = new Map();
    for (const [index, row] of (Array.isArray(document.memberships) ? document.memberships : []).entries()) {
        const at = '$.memberships[' + index + ']';
        if (!shape(row, ['userId', 'organizationId', 'businessId', 'sourceUserFingerprint', 'driftPolicy',
            'unchangedOutsideTarget', 'sourceOrganizationRole', 'sourceUserActive', 'before', 'after', 'desired'],
        ['approvedRestrictionRef'])) {
            error('INVALID_MEMBERSHIP_SHAPE', at); continue;
        }
        if (!positive(row.userId) || seen.has(row.userId)) {
            error('INVALID_OR_DUPLICATE_USER', at); continue;
        }
        seen.add(row.userId);
        proposals.set(row.userId, row.desired);
        if (!positive(row.organizationId) || !positive(row.businessId)
            || row.organizationId !== document.target?.organizationId || row.businessId !== document.target?.businessId)
            error('TARGET_MISMATCH', at);
        if (!hash(row.sourceUserFingerprint) || row.driftPolicy !== 'ABORT' || row.unchangedOutsideTarget !== true)
            error('SOURCE_AND_DRIFT_BINDING_REQUIRED', at);
        if (typeof row.sourceUserActive !== 'boolean' || !nullable(row.sourceOrganizationRole, value => ORGANIZATION_ROLES.has(value)))
            error('INVALID_SOURCE_MEMBERSHIP_STATE', at);
        if (Object.hasOwn(row, 'approvedRestrictionRef') && !nullable(row.approvedRestrictionRef, text))
            error('INVALID_RESTRICTION_REFERENCE', at);
        const before = row.before, after = row.after, desired = row.desired;
        if (!shape(before, ['contextAccessible', 'allowedSurfaces']) || !shape(after, ['contextAccessible', 'allowedSurfaces'])
            || typeof before?.contextAccessible !== 'boolean' || typeof after?.contextAccessible !== 'boolean'
            || !uniqueStrings(before?.allowedSurfaces) || !uniqueStrings(after?.allowedSurfaces)) {
            error('EFFECTIVE_MATRIX_REQUIRED', at); continue;
        }
        if ((!before.contextAccessible && after.contextAccessible)
            || after.allowedSurfaces.some(surface => !before.allowedSurfaces.includes(surface)))
            error('ACCESS_EXPANSION_FORBIDDEN', at);
        if (((before.contextAccessible && !after.contextAccessible)
            || before.allowedSurfaces.some(surface => !after.allowedSurfaces.includes(surface))) && !text(row.approvedRestrictionRef))
            error('RESTRICTION_DECISION_REQUIRED', at);
        if (!shape(desired, ['role', 'extraRoles', 'organizationRole', 'isActive', 'isDefault',
            'pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist'])
            || !ROLES.has(desired?.role) || !identifierList(desired?.extraRoles, ROLES)
            || !ORGANIZATION_ROLES.has(desired?.organizationRole)
            || typeof desired?.isActive !== 'boolean' || typeof desired?.isDefault !== 'boolean'
            || (desired?.isDefault && !desired?.isActive))
            error('INVALID_MEMBERSHIP_PROPOSAL', at);
        for (const field of ['pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist']) {
            const registryKeys = field.startsWith('page') ? PAGE_KEYS : ACTION_KEYS;
            if (!identifierList(desired?.[field], registryKeys)) error('INVALID_OVERRIDE_ARRAY', at + '.desired.' + field);
        }
        if (desired?.organizationRole !== 'member' && desired?.organizationRole !== row.sourceOrganizationRole)
            error('ORGANIZATION_PRIVILEGE_EXPANSION_FORBIDDEN', at);
        if (row.sourceUserActive === false && desired?.isActive) error('ACCOUNT_REACTIVATION_FORBIDDEN', at);
    }
    const defaultUsers = new Set();
    for (const [index, row] of (Array.isArray(document.defaults) ? document.defaults : []).entries()) {
        const at = '$.defaults[' + index + ']';
        if (!shape(row, ['userId', 'beforeContext', 'afterContext', 'unchangedOutsideTarget'])
            || !positive(row.userId) || !seen.has(row.userId) || defaultUsers.has(row.userId)
            || !nullable(row.beforeContext, canonicalContext) || !nullable(row.afterContext, canonicalContext)) {
            error('INVALID_DEFAULT_ROW', at); continue;
        }
        defaultUsers.add(row.userId);
        if (row.afterContext !== row.beforeContext || row.unchangedOutsideTarget !== true)
            error('DEFAULT_CHANGE_REQUIRES_SEPARATE_REVIEW', at);
        if (proposals.get(row.userId)?.isDefault !== (row.afterContext === document.businessContext))
            error('DEFAULT_MEMBERSHIP_MISMATCH', at);
    }
    for (const [userId, proposal] of proposals) {
        if (proposal?.isDefault === true && !defaultUsers.has(userId)) error('DEFAULT_RECORD_REQUIRED', '$.defaults');
    }
    if (document.dataKind !== 'production') result.blockers.push('SYNTHETIC_INPUT_IS_NOT_PRODUCTION_MAPPING');
    if (!complete) result.blockers.push('REAL_SOURCE_NOT_FULLY_COLLECTED');
    if (!document.memberships?.length) result.blockers.push('MEMBERSHIP_INVENTORY_EMPTY');
    if (document.approval?.status !== 'APPROVED' || !text(document.approval?.reference) || !hash(document.approval?.mappingSha256))
        result.blockers.push('OWNER_APPROVAL_REFERENCE_MISSING');
    if (document.historicalOwnerMapping?.decisionsStatus !== 'APPROVED'
        || !text(document.historicalOwnerMapping?.reference) || !hash(document.historicalOwnerMapping?.sha256))
        result.blockers.push('HISTORICAL_OWNER_MAPPING_APPROVAL_MISSING');
    // Metadata and supplied capability strings cannot authenticate an owner or
    // prove the live resolver/profile snapshot. This tool never certifies apply.
    result.blockers.push('SERVER_SIDE_MATRIX_AND_SOURCE_REVALIDATION_REQUIRED', 'EXACT_RELEASE_AUTHORIZATION_REQUIRED');
    result.formatValid = result.errors.length === 0;
    return result;
}

if (require.main === module) {
    try {
        if (process.argv.length !== 3) throw new Error('INPUT_REQUIRED');
        const result = validate(JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '')));
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        process.exitCode = result.formatValid ? 0 : 2;
    } catch {
        process.stdout.write(JSON.stringify({ formatValid: false, safeToApply: false, code: 'INVALID_REVIEW_INPUT' }) + '\n');
        process.exitCode = 2;
    }
}

module.exports = { validate };
