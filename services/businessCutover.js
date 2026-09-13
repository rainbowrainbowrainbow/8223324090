'use strict';

// Controlled registration for historical, reserved partitions. This service is
// deliberately separate from ordinary business creation: it never guesses an
// owner, reads a legacy user array as an approval, or persists the mapping body.

const crypto = require('node:crypto');
const { lockOrganizationOwnership } = require('./organizationOwnership');
const { getReleaseMetadata } = require('./release');

const RESERVED_CONTEXTS = new Set(['maysternya_doli', 'crm']);
const HASH_64 = /^[a-f0-9]{64}$/;
const SHA_40 = /^[a-f0-9]{40}$/;
const ENTRY_FAMILIES = new Set(['http', 'profile', 'service', 'websocket', 'provider', 'job', 'operator', 'public']);
const AUTHORITY_SOURCES = new Set(['membership', 'compatibility', 'machine_principal', 'missing_context', 'unknown']);
const OUTCOMES = new Set(['allowed', 'denied', 'unavailable']);

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
    cleanTelemetry,
    descriptor,
    prepareReservedCutover,
    recordCompatibilityTelemetry,
    recordCompatibilityTelemetrySafe,
    sha256
};
