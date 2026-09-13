'use strict';

// Controlled registration for historical, reserved partitions. This service is
// deliberately separate from ordinary business creation: it never guesses an
// owner, reads a legacy user array as an approval, or persists the mapping body.

const crypto = require('node:crypto');
const {
    ROLE_HIERARCHY,
    normalizeActionOverrideList,
    normalizePageDenylist,
    normalizePageAllowlist
} = require('./accountAccessPolicy');
const { validateBusinessModules } = require('./businessModuleRegistry');
const { lockOrganizationOwnership } = require('./organizationOwnership');
const { getReleaseMetadata } = require('./release');

const RESERVED_CONTEXTS = new Set(['maysternya_doli', 'crm']);
const HASH_64 = /^[a-f0-9]{64}$/;
const SHA_40 = /^[a-f0-9]{40}$/;
const ENTRY_FAMILIES = new Set(['http', 'profile', 'service', 'websocket', 'provider', 'job', 'operator', 'public']);
const AUTHORITY_SOURCES = new Set(['membership', 'compatibility', 'machine_principal', 'missing_context', 'unknown']);
const OUTCOMES = new Set(['allowed', 'denied', 'unavailable']);
const ORGANIZATION_ROLES = new Set(['owner', 'admin', 'member']);
const RESERVED_DEFAULT_MODULES = Object.freeze({
    maysternya_doli: ['dashboard', 'timeline', 'tasks', 'customers', 'leads', 'omni', 'finance', 'programs', 'settings'],
    crm: ['dashboard', 'tasks', 'customers', 'leads', 'omni', 'finance', 'settings']
});

function failure(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function positiveId(value, code = 'cutover_invalid') {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, code, 'A valid positive ID is required');
    return id;
}

function cleanHash(value, field) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!HASH_64.test(normalized)) throw failure(400, 'cutover_invalid', `${field} must be a SHA-256 hash`);
    return normalized;
}

function cleanSha(value, field = 'sourceDeploymentSha') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!SHA_40.test(normalized)) throw failure(400, 'cutover_invalid', `${field} must be a full commit SHA`);
    return normalized;
}

function cleanContext(value) {
    const context = String(value || '').trim();
    if (!RESERVED_CONTEXTS.has(context)) throw failure(400, 'cutover_context_invalid', 'Only reserved Maysternya or CRM contexts are supported');
    return context;
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function descriptor(input) {
    const contextKey = cleanContext(input?.contextKey || input?.businessContext);
    return {
        contextKey,
        organizationId: positiveId(input?.organizationId, 'cutover_organization_invalid'),
        sourceSnapshotSha256: cleanHash(input?.sourceSnapshotSha256, 'sourceSnapshotSha256'),
        mappingSha256: cleanHash(input?.mappingSha256, 'mappingSha256'),
        sourceDeploymentSha: cleanSha(input?.sourceDeploymentSha)
    };
}

function cleanApprovalRef(value) {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9:_./@ -]{11,199}$/.test(text)) {
        throw failure(400, 'cutover_approval_invalid', 'A concrete approval reference is required');
    }
    return text;
}

function cleanRole(value, field = 'role') {
    const role = String(value || '').trim();
    if (!role || role === 'creator' || !ROLE_HIERARCHY.includes(role)) {
        throw failure(400, 'cutover_mapping_invalid', `A valid non-platform ${field} is required`);
    }
    return role;
}

function cleanOrganizationRole(value) {
    const role = String(value || 'member').trim();
    if (!ORGANIZATION_ROLES.has(role)) throw failure(400, 'cutover_mapping_invalid', 'Invalid organization role');
    return role;
}

function cleanStringList(value, field, normalizer = null) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw failure(400, 'cutover_mapping_invalid', `${field} must be an array of strings`);
    }
    return normalizer ? normalizer(value) : [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function cleanBusinessLabels(mapping, contextKey) {
    const business = mapping?.business || {};
    const label = String(business.label || (contextKey === 'crm' ? 'CRM продажі' : 'Майстерня долі')).trim();
    const shortLabel = String(business.shortLabel || business.short_label || (contextKey === 'crm' ? 'CRM' : 'МД')).trim();
    if (!label || label.length > 160 || !shortLabel || shortLabel.length > 80) {
        throw failure(400, 'cutover_mapping_invalid', 'Business label and shortLabel are required');
    }
    const modules = validateBusinessModules(
        Array.isArray(business.modules) ? business.modules : RESERVED_DEFAULT_MODULES[contextKey],
        { contextKey, existingModules: RESERVED_DEFAULT_MODULES[contextKey] }
    );
    return { label, shortLabel, modules };
}

function cleanApprovedMapping(input, next) {
    const mapping = input?.approvedMapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        throw failure(400, 'cutover_mapping_invalid', 'approvedMapping is required');
    }
    if (sha256(mapping) !== next.mappingSha256) {
        throw failure(409, 'cutover_mapping_hash_mismatch', 'approvedMapping does not match mappingSha256');
    }
    if (String(mapping.contextKey || mapping.businessContext || '').trim() !== next.contextKey) {
        throw failure(400, 'cutover_mapping_invalid', 'Mapping context does not match descriptor');
    }
    const mappingOrganizationId = positiveId(mapping.organizationId || next.organizationId, 'cutover_organization_invalid');
    if (mappingOrganizationId !== next.organizationId) {
        throw failure(409, 'cutover_mapping_organization_mismatch', 'Mapping organization does not match descriptor');
    }
    const memberships = Array.isArray(mapping.memberships) ? mapping.memberships : [];
    if (!memberships.length) throw failure(400, 'cutover_mapping_invalid', 'At least one business membership is required');
    return {
        contextKey: next.contextKey,
        organizationId: next.organizationId,
        approvalRef: cleanApprovalRef(input.approvalRef || mapping.approvalRef),
        business: cleanBusinessLabels(mapping, next.contextKey),
        memberships: memberships.map(row => {
            const userId = positiveId(row.userId || row.user_id, 'cutover_mapping_invalid');
            return {
                userId,
                organizationRole: cleanOrganizationRole(row.organizationRole || row.organization_role),
                role: cleanRole(row.role),
                extraRoles: cleanStringList(row.extraRoles || row.extra_roles, 'extraRoles').map(role => cleanRole(role, 'extra role')),
                pageAllowlist: cleanStringList(row.pageAllowlist || row.page_allowlist, 'pageAllowlist', normalizePageAllowlist),
                pageDenylist: cleanStringList(row.pageDenylist || row.page_denylist, 'pageDenylist', normalizePageDenylist),
                actionAllowlist: cleanStringList(row.actionAllowlist || row.action_allowlist, 'actionAllowlist', normalizeActionOverrideList),
                actionDenylist: cleanStringList(row.actionDenylist || row.action_denylist, 'actionDenylist', normalizeActionOverrideList),
                isDefault: row.isDefault === true || row.is_default === true
            };
        })
    };
}

function actorId(actor) {
    return positiveId(actor?.id, 'cutover_actor_invalid');
}

async function authorizeCutoverOwner(client, actor, organizationId) {
    const id = actorId(actor);
    const account = await client.query('SELECT role, is_active FROM users WHERE id=$1', [id]);
    const row = account.rows[0];
    if (!row?.is_active) throw failure(403, 'cutover_owner_denied', 'Active organization owner access is required');
    if (row.role === 'creator' && actor?.platformRole === 'creator') return { id, platform: true };
    const membership = await client.query(
        `SELECT role FROM organization_memberships
         WHERE organization_id=$1 AND user_id=$2 AND is_active IS TRUE`, [organizationId, id]
    );
    if (membership.rows[0]?.role !== 'owner') {
        throw failure(403, 'cutover_owner_denied', 'Active organization owner access is required');
    }
    return { id, platform: false };
}

async function withCutoverTransaction(db, actor, organizationId, operation) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await lockOrganizationOwnership(client);
        const organization = await client.query('SELECT id, status FROM organizations WHERE id=$1 FOR UPDATE', [organizationId]);
        if (!organization.rows[0]) throw failure(404, 'cutover_organization_not_found', 'Organization not found');
        if (organization.rows[0].status !== 'active') throw failure(403, 'cutover_organization_inactive', 'Organization is inactive');
        const owner = await authorizeCutoverOwner(client, actor, organizationId);
        const result = await operation(client, owner);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

async function prepareReservedCutover(db, actor, input) {
    const next = descriptor(input);
    return withCutoverTransaction(db, actor, next.organizationId, async (client, owner) => {
        const existing = await client.query(
            'SELECT id, organization_id, access_mode FROM businesses WHERE context_key=$1 FOR UPDATE', [next.contextKey]
        );
        if (existing.rows[0] && Number(existing.rows[0].organization_id) !== next.organizationId) {
            throw failure(409, 'cutover_context_claimed', 'Reserved context belongs to another organization');
        }
        const journal = await client.query('SELECT * FROM business_cutover_journal WHERE context_key=$1 FOR UPDATE', [next.contextKey]);
        const current = journal.rows[0];
        if (current && (Number(current.organization_id) !== next.organizationId
            || current.source_snapshot_sha256 !== next.sourceSnapshotSha256
            || current.mapping_sha256 !== next.mappingSha256
            || current.source_deployment_sha !== next.sourceDeploymentSha)) {
            throw failure(409, 'cutover_journal_drift', 'Existing cutover journal does not match the reviewed source');
        }

        if (!current) {
            await client.query(
                `INSERT INTO business_cutover_journal
                    (context_key, organization_id, business_id, state, source_snapshot_sha256, mapping_sha256, source_deployment_sha, prepared_by_user_id)
                 VALUES ($1,$2,$3,'prepared',$4,$5,$6,$7)`,
                [next.contextKey, next.organizationId, existing.rows[0]?.id || null, next.sourceSnapshotSha256,
                    next.mappingSha256, next.sourceDeploymentSha, owner.id]
            );
        }
        return { contextKey: next.contextKey, organizationId: next.organizationId,
            businessId: Number(existing.rows[0]?.id || 0) || null, state: current?.state || 'prepared', replay: Boolean(current) };
    });
}

async function currentCutoverFingerprint(client, contextKey, organizationId) {
    const result = await client.query(
        `SELECT
            (SELECT COUNT(*)::int FROM businesses WHERE context_key=$1 OR organization_id=$2) AS business_count,
            (SELECT COUNT(*)::int FROM organization_memberships WHERE organization_id=$2) AS organization_membership_count,
            (SELECT COUNT(*)::int FROM business_memberships WHERE organization_id=$2) AS business_membership_count,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('context_key', context_key, 'organization_id', organization_id, 'access_mode', access_mode, 'status', status) ORDER BY context_key), '[]'::jsonb)
               FROM businesses WHERE context_key=$1 OR organization_id=$2) AS businesses`,
        [contextKey, organizationId]
    );
    return sha256(result.rows[0] || {});
}

function cutoverReceiptHash(next, mapping, fingerprint, businessId, membershipCount) {
    return sha256({
        contextKey: next.contextKey,
        organizationId: next.organizationId,
        businessId: Number(businessId),
        sourceSnapshotSha256: next.sourceSnapshotSha256,
        mappingSha256: next.mappingSha256,
        sourceDeploymentSha: next.sourceDeploymentSha,
        approvalRef: mapping.approvalRef,
        sourceFingerprintSha256: fingerprint,
        membershipCount: Number(membershipCount)
    });
}

async function applyReservedCutover(db, actor, input) {
    const next = descriptor(input);
    const mapping = cleanApprovedMapping(input, next);
    const expectedFingerprint = input?.dbFingerprintSha256
        ? cleanHash(input.dbFingerprintSha256, 'dbFingerprintSha256')
        : null;
    return withCutoverTransaction(db, actor, next.organizationId, async (client, owner) => {
        const fingerprint = await currentCutoverFingerprint(client, next.contextKey, next.organizationId);
        if (expectedFingerprint && fingerprint !== expectedFingerprint) {
            throw failure(409, 'cutover_source_fingerprint_mismatch', 'Current DB fingerprint differs from reviewed preflight');
        }
        const existing = await client.query(
            'SELECT id, organization_id, access_mode FROM businesses WHERE context_key=$1 FOR UPDATE', [next.contextKey]
        );
        if (existing.rows[0] && Number(existing.rows[0].organization_id) !== next.organizationId) {
            throw failure(409, 'cutover_context_claimed', 'Reserved context belongs to another organization');
        }
        const journal = await client.query('SELECT * FROM business_cutover_journal WHERE context_key=$1 FOR UPDATE', [next.contextKey]);
        const current = journal.rows[0];
        if (current && (Number(current.organization_id) !== next.organizationId
            || current.source_snapshot_sha256 !== next.sourceSnapshotSha256
            || current.mapping_sha256 !== next.mappingSha256
            || current.source_deployment_sha !== next.sourceDeploymentSha)) {
            throw failure(409, 'cutover_journal_drift', 'Existing cutover journal does not match the reviewed source');
        }
        if (current?.state === 'applied') {
            return {
                contextKey: next.contextKey,
                organizationId: next.organizationId,
                businessId: Number(current.business_id),
                state: 'applied',
                replay: true,
                sourceFingerprintSha256: fingerprint,
                membershipCount: mapping.memberships.length,
                approvalRef: current.approval_ref || mapping.approvalRef,
                receiptSha256: current.receipt_sha256 || null
            };
        }
        let businessId = Number(existing.rows[0]?.id || 0) || null;
        if (!businessId) {
            const created = await client.query(
                `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, created_by_user_id)
                 VALUES ($1,$2,$3,$4,'membership',$5::jsonb,$6)
                 RETURNING id`,
                [next.organizationId, next.contextKey, mapping.business.label, mapping.business.shortLabel,
                    JSON.stringify(mapping.business.modules), owner.id]
            );
            businessId = Number(created.rows[0].id);
        } else {
            await client.query(
                `UPDATE businesses SET label=$1, short_label=$2, access_mode='membership', modules=$3::jsonb
                 WHERE id=$4 AND organization_id=$5`,
                [mapping.business.label, mapping.business.shortLabel, JSON.stringify(mapping.business.modules),
                    businessId, next.organizationId]
            );
        }
        let membershipWrites = 0;
        for (const member of mapping.memberships) {
            const account = await client.query('SELECT id, is_active FROM users WHERE id=$1 FOR SHARE', [member.userId]);
            if (!account.rows[0]?.is_active) throw failure(409, 'cutover_member_inactive', 'Approved mapping contains an inactive or missing user');
            await client.query(
                `INSERT INTO organization_memberships (organization_id, user_id, role, is_active, created_by_user_id)
                 VALUES ($1,$2,$3,true,$4)
                 ON CONFLICT (organization_id,user_id) DO UPDATE SET role=EXCLUDED.role, is_active=true`,
                [next.organizationId, member.userId, member.organizationRole, owner.id]
            );
            if (member.isDefault) {
                await client.query(
                    'UPDATE business_memberships SET is_default=false WHERE organization_id=$1 AND user_id=$2 AND business_id<>$3',
                    [next.organizationId, member.userId, businessId]
                );
            }
            await client.query(
                `INSERT INTO business_memberships
                    (business_id, organization_id, user_id, role, extra_roles, page_allowlist, page_denylist,
                     action_allowlist, action_denylist, is_default, is_active, created_by_user_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
                 ON CONFLICT (business_id,user_id) DO UPDATE SET
                    organization_id=EXCLUDED.organization_id,
                    role=EXCLUDED.role,
                    extra_roles=EXCLUDED.extra_roles,
                    page_allowlist=EXCLUDED.page_allowlist,
                    page_denylist=EXCLUDED.page_denylist,
                    action_allowlist=EXCLUDED.action_allowlist,
                    action_denylist=EXCLUDED.action_denylist,
                    is_default=EXCLUDED.is_default,
                    is_active=true`,
                [businessId, next.organizationId, member.userId, member.role, member.extraRoles,
                    member.pageAllowlist, member.pageDenylist, member.actionAllowlist, member.actionDenylist,
                    member.isDefault, owner.id]
            );
            membershipWrites += 1;
        }
        const receiptSha256 = cutoverReceiptHash(next, mapping, fingerprint, businessId, membershipWrites);

        if (!current) {
            await client.query(
                `INSERT INTO business_cutover_journal
                    (context_key, organization_id, business_id, state, source_snapshot_sha256, mapping_sha256,
                     source_deployment_sha, prepared_by_user_id, applied_by_user_id, applied_at,
                     approval_ref, source_fingerprint_sha256, receipt_sha256)
                 VALUES ($1,$2,$3,'applied',$4,$5,$6,$7,$7,clock_timestamp(),$8,$9,$10)`,
                [next.contextKey, next.organizationId, businessId, next.sourceSnapshotSha256,
                    next.mappingSha256, next.sourceDeploymentSha, owner.id, mapping.approvalRef, fingerprint, receiptSha256]
            );
        } else {
            await client.query(
                `UPDATE business_cutover_journal
                 SET business_id=$1, state='applied', applied_by_user_id=$2, applied_at=clock_timestamp(), updated_at=clock_timestamp(),
                     approval_ref=$4, source_fingerprint_sha256=$5, receipt_sha256=$6
                 WHERE context_key=$3`,
                [businessId, owner.id, next.contextKey, mapping.approvalRef, fingerprint, receiptSha256]
            );
        }
        return {
            contextKey: next.contextKey,
            organizationId: next.organizationId,
            businessId,
            state: 'applied',
            replay: false,
            sourceFingerprintSha256: fingerprint,
            membershipCount: membershipWrites,
            approvalRef: mapping.approvalRef,
            receiptSha256
        };
    });
}

function cleanTelemetry(input) {
    const businessContext = String(input?.businessContext || '').trim();
    const entryFamily = String(input?.entryFamily || '').trim();
    const authoritySource = String(input?.authoritySource || '').trim();
    const outcome = String(input?.outcome || '').trim();
    const deploymentSha = cleanSha(input?.deploymentSha, 'deploymentSha');
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(businessContext) || !ENTRY_FAMILIES.has(entryFamily)
        || !AUTHORITY_SOURCES.has(authoritySource) || !OUTCOMES.has(outcome)) return null;
    return { businessContext, entryFamily, authoritySource, outcome, deploymentSha };
}

async function recordCompatibilityTelemetry(db, input) {
    const event = cleanTelemetry(input);
    if (!event) return { recorded: false, reason: 'invalid_event' };
    await db.query(
        `INSERT INTO business_compatibility_telemetry_hourly
            (observed_hour, business_context, entry_family, authority_source, outcome, deployment_sha, decision_count)
         VALUES (date_trunc('hour', clock_timestamp()),$1,$2,$3,$4,$5,1)
         ON CONFLICT (observed_hour,business_context,entry_family,authority_source,outcome,deployment_sha)
         DO UPDATE SET decision_count=business_compatibility_telemetry_hourly.decision_count+1,
             last_observed_at=clock_timestamp()`,
        [event.businessContext, event.entryFamily, event.authoritySource, event.outcome, event.deploymentSha]
    );
    return { recorded: true };
}

function deploymentShaForTelemetry() {
    const metadata = getReleaseMetadata();
    return metadata?.deploymentMetadata?.complete === true && SHA_40.test(String(metadata.commitSha || ''))
        ? String(metadata.commitSha).toLowerCase() : null;
}

function recordCompatibilityTelemetrySafe(db, input, logger = null) {
    const deploymentSha = input?.deploymentSha || deploymentShaForTelemetry();
    if (!deploymentSha) return;
    recordCompatibilityTelemetry(db, { ...input, deploymentSha }).catch(error => {
        logger?.warn?.('Compatibility telemetry was not recorded', { code: error?.code || 'telemetry_unavailable' });
    });
}

module.exports = {
    RESERVED_CONTEXTS,
    applyReservedCutover,
    cleanTelemetry,
    descriptor,
    prepareReservedCutover,
    recordCompatibilityTelemetry,
    recordCompatibilityTelemetrySafe,
    sha256
};
