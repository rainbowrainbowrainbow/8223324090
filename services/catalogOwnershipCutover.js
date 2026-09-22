'use strict';

const { lockOrganizationOwnership } = require('./organizationOwnership');
const { sha256 } = require('./businessCutover');

const BUSINESS_CONTEXT = 'event_genix';
const EXPECTED_CATALOG_NAMES = Object.freeze([
    '122112', '21312', '4214', 'Торти', 'Костюми', 'Випускний', 'Меню', 'Піньяти', 'Торти з грибів'
]);
const PUBLIC_CATALOG_NAMES = Object.freeze(['122112', 'Торти', 'Випускний']);
const DIRECT_CHILD_TABLES = Object.freeze([
    'catalog_subcategories', 'catalog_items', 'catalog_settings', 'catalog_pages',
    'catalog_automations', 'trend_proposals'
]);
const HASH_64 = /^[a-f0-9]{64}$/;

function failure(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function cleanHash(value, field) {
    const hash = String(value || '').trim().toLowerCase();
    if (!HASH_64.test(hash)) throw failure(400, 'catalog_cutover_invalid', `${field} must be a SHA-256 hash`);
    return hash;
}

function cleanDecisionRef(value) {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9:_./@ -]{11,199}$/.test(text)) {
        throw failure(400, 'catalog_cutover_invalid', 'A concrete decision reference is required');
    }
    return text;
}

function cleanMapping(input) {
    const mapping = input?.approvedMapping;
    const mappingSha256 = cleanHash(input?.mappingSha256, 'mappingSha256');
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || sha256(mapping) !== mappingSha256) {
        throw failure(409, 'catalog_cutover_mapping_hash_mismatch', 'Approved catalog mapping does not match mappingSha256');
    }
    if (mapping.businessContext !== BUSINESS_CONTEXT) {
        throw failure(400, 'catalog_cutover_invalid', 'Catalog ownership is restricted to event_genix');
    }
    const catalogs = Array.isArray(mapping.catalogs) ? mapping.catalogs.map(row => ({
        id: String(row?.id || '').trim(), name: String(row?.name || '').trim()
    })) : [];
    if (catalogs.some(row => !/^[A-Za-z0-9_-]{1,50}$/.test(row.id) || !row.name)) {
        throw failure(400, 'catalog_cutover_invalid', 'Every approved catalog requires a stable ID and name');
    }
    const names = catalogs.map(row => row.name).sort((a, b) => a.localeCompare(b, 'uk'));
    const expected = [...EXPECTED_CATALOG_NAMES].sort((a, b) => a.localeCompare(b, 'uk'));
    if (catalogs.length !== 9 || new Set(catalogs.map(row => row.id)).size !== 9
        || JSON.stringify(names) !== JSON.stringify(expected)) {
        throw failure(409, 'catalog_cutover_set_mismatch', 'Approved mapping must contain the exact nine reviewed catalogs');
    }
    const publicNames = [...new Set((mapping.publicCatalogNames || []).map(value => String(value).trim()))]
        .sort((a, b) => a.localeCompare(b, 'uk'));
    const expectedPublic = [...PUBLIC_CATALOG_NAMES].sort((a, b) => a.localeCompare(b, 'uk'));
    if (JSON.stringify(publicNames) !== JSON.stringify(expectedPublic)) {
        throw failure(409, 'catalog_cutover_public_set_mismatch', 'Approved mapping must preserve only the three reviewed public links');
    }
    return { mapping, mappingSha256, catalogs, decisionRef: cleanDecisionRef(input.decisionRef || mapping.decisionRef) };
}

async function authorize(client, actor) {
    const userId = Number(actor?.id);
    if (!Number.isSafeInteger(userId) || userId < 1) throw failure(403, 'catalog_cutover_denied', 'Active organization owner access is required');
    const result = await client.query(
        `SELECT om.organization_id
           FROM organization_memberships om
           JOIN organizations o ON o.id=om.organization_id AND o.status='active'
           JOIN businesses b ON b.organization_id=o.id AND b.context_key=$2 AND b.status='active'
           JOIN users u ON u.id=om.user_id AND u.is_active IS TRUE
          WHERE om.user_id=$1 AND om.role='owner' AND om.is_active IS TRUE
          LIMIT 1`, [userId, BUSINESS_CONTEXT]
    );
    if (!result.rows[0]) throw failure(403, 'catalog_cutover_denied', 'Active organization owner access is required');
    return { userId, organizationId: Number(result.rows[0].organization_id) };
}

async function currentState(client, catalogs) {
    const ids = catalogs.map(row => row.id);
    const result = await client.query(
        `SELECT d.id, d.name, d.is_active, d.status, d.business_context, d.ownership_status,
                d.publication_visibility, (d.public_token IS NOT NULL) AS has_public_token,
                (SELECT COUNT(*)::int FROM catalog_pages p WHERE p.catalog_id=d.id) AS page_count,
                (SELECT COUNT(*)::int FROM catalog_items i WHERE i.catalog_id=d.id) AS item_count
           FROM catalog_definitions d
          WHERE d.id=ANY($1::text[])
          ORDER BY d.id
          FOR UPDATE`, [ids]
    );
    if (result.rows.length !== catalogs.length) throw failure(409, 'catalog_cutover_catalog_missing', 'A reviewed catalog is missing');
    const expectedById = new Map(catalogs.map(row => [row.id, row.name]));
    for (const row of result.rows) {
        if (expectedById.get(row.id) !== row.name) throw failure(409, 'catalog_cutover_catalog_drift', 'A reviewed catalog identity changed');
        const shouldBePublic = PUBLIC_CATALOG_NAMES.includes(row.name);
        if (Boolean(row.has_public_token) !== shouldBePublic) {
            throw failure(409, 'catalog_cutover_public_link_drift', 'Reviewed public-link state changed');
        }
        if (row.business_context && row.business_context !== BUSINESS_CONTEXT) {
            throw failure(409, 'catalog_cutover_owner_conflict', 'A reviewed catalog belongs to another business');
        }
    }
    const direct = [];
    for (const table of DIRECT_CHILD_TABLES) {
        const children = await client.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE business_context IS NULL)::int AS unassigned,
                    COUNT(*) FILTER (WHERE business_context=$2)::int AS assigned_target,
                    COUNT(*) FILTER (WHERE business_context IS NOT NULL AND business_context<>$2)::int AS conflicts
               FROM ${table} WHERE catalog_id=ANY($1::text[])`, [ids, BUSINESS_CONTEXT]
        );
        direct.push({ table, ...children.rows[0] });
    }
    const history = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE h.business_context IS NULL)::int AS unassigned,
                COUNT(*) FILTER (WHERE h.business_context=$2)::int AS assigned_target,
                COUNT(*) FILTER (WHERE h.business_context IS NOT NULL AND h.business_context<>$2)::int AS conflicts
           FROM catalog_page_history h
           JOIN catalog_pages p ON p.id=h.catalog_page_id
          WHERE p.catalog_id=ANY($1::text[])`, [ids, BUSINESS_CONTEXT]
    );
    const children = [...direct, { table: 'catalog_page_history', ...history.rows[0] }]
        .map(row => ({ table: row.table, total: Number(row.total || 0), unassigned: Number(row.unassigned || 0),
            assignedTarget: Number(row.assigned_target || 0), conflicts: Number(row.conflicts || 0) }));
    if (children.some(row => row.conflicts > 0)) {
        throw failure(409, 'catalog_cutover_child_owner_conflict', 'A reviewed catalog child belongs to another business');
    }
    return { roots: result.rows, children };
}

function fingerprint(state) {
    return sha256({ roots: state.roots.map(row => ({
        id: row.id, name: row.name, active: row.is_active === true, status: row.status || null,
        businessContext: row.business_context || null, ownershipStatus: row.ownership_status,
        publicationVisibility: row.publication_visibility, hasPublicToken: row.has_public_token === true,
        pageCount: Number(row.page_count || 0), itemCount: Number(row.item_count || 0)
    })), children: state.children });
}

async function transaction(db, actor, operation) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await lockOrganizationOwnership(client);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:catalog-ownership-cutover'))");
        const owner = await authorize(client, actor);
        const result = await operation(client, owner);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

async function prepareCatalogOwnershipCutover(db, actor, input) {
    const approved = cleanMapping(input);
    return transaction(db, actor, async (client, owner) => {
        const state = await currentState(client, approved.catalogs);
        const sourceFingerprintSha256 = fingerprint(state);
        const expected = input.sourceFingerprintSha256 ? cleanHash(input.sourceFingerprintSha256, 'sourceFingerprintSha256') : null;
        if (expected && expected !== sourceFingerprintSha256) throw failure(409, 'catalog_cutover_fingerprint_mismatch', 'Catalog source fingerprint changed');
        const journal = await client.query('SELECT * FROM catalog_ownership_cutover_journal WHERE business_context=$1 FOR UPDATE', [BUSINESS_CONTEXT]);
        const current = journal.rows[0];
        if (current && (current.mapping_sha256 !== approved.mappingSha256
            || current.source_fingerprint_sha256 !== sourceFingerprintSha256)) {
            throw failure(409, 'catalog_cutover_journal_drift', 'Existing catalog cutover evidence belongs to another review');
        }
        if (!current) await client.query(
            `INSERT INTO catalog_ownership_cutover_journal
                (business_context,state,mapping_sha256,source_fingerprint_sha256,decision_ref,catalog_count,public_link_count,prepared_by_user_id)
             VALUES ($1,'prepared',$2,$3,$4,9,3,$5)`,
            [BUSINESS_CONTEXT, approved.mappingSha256, sourceFingerprintSha256, approved.decisionRef, owner.userId]
        );
        return { state: current?.state || 'prepared', replay: Boolean(current), sourceFingerprintSha256,
            catalogCount: state.roots.length, publicLinkCount: state.roots.filter(row => row.has_public_token).length,
            childCounts: Object.fromEntries(state.children.map(row => [row.table, row.total])) };
    });
}

async function applyCatalogOwnershipCutover(db, actor, input) {
    const approved = cleanMapping(input);
    const expected = cleanHash(input.sourceFingerprintSha256, 'sourceFingerprintSha256');
    return transaction(db, actor, async (client, owner) => {
        const state = await currentState(client, approved.catalogs);
        const journal = await client.query('SELECT * FROM catalog_ownership_cutover_journal WHERE business_context=$1 FOR UPDATE', [BUSINESS_CONTEXT]);
        const current = journal.rows[0];
        if (!current || current.mapping_sha256 !== approved.mappingSha256 || current.source_fingerprint_sha256 !== expected) {
            throw failure(409, 'catalog_cutover_not_prepared', 'Exact catalog ownership mapping is not prepared');
        }
        if (current.state === 'applied') {
            const rootsApplied = state.roots.every(row => row.business_context === BUSINESS_CONTEXT
                && row.ownership_status === 'approved'
                && row.publication_visibility === (PUBLIC_CATALOG_NAMES.includes(row.name) ? 'public_existing_token' : 'private'));
            const childrenApplied = state.children.every(row => row.total === row.assignedTarget);
            if (!rootsApplied || !childrenApplied) {
                throw failure(409, 'catalog_cutover_applied_state_drift', 'Applied catalog ownership no longer matches its receipt');
            }
            return { state: 'applied', replay: true, receiptSha256: current.receipt_sha256,
                catalogCount: state.roots.length, publicLinkCount: 3, assets: 'shared_unassigned_pending_consumer_audit' };
        }
        if (fingerprint(state) !== expected) throw failure(409, 'catalog_cutover_fingerprint_mismatch', 'Catalog source fingerprint changed');
        const ids = approved.catalogs.map(row => row.id);
        await client.query(
            `UPDATE catalog_definitions
                SET business_context=$1,
                    ownership_status='approved',
                    publication_visibility=CASE WHEN name=ANY($2::text[]) THEN 'public_existing_token' ELSE 'private' END,
                    ownership_decision_ref=$3,
                    ownership_updated_at=clock_timestamp()
              WHERE id=ANY($4::text[])`,
            [BUSINESS_CONTEXT, PUBLIC_CATALOG_NAMES, approved.decisionRef, ids]
        );
        for (const table of DIRECT_CHILD_TABLES) {
            await client.query(
                `UPDATE ${table} SET business_context=$1, ownership_decision_ref=$2, ownership_updated_at=clock_timestamp()
                  WHERE catalog_id=ANY($3::text[]) AND (business_context IS NULL OR business_context=$1)`,
                [BUSINESS_CONTEXT, approved.decisionRef, ids]
            );
        }
        await client.query(
            `UPDATE catalog_page_history h
                SET business_context=$1, ownership_decision_ref=$2, ownership_updated_at=clock_timestamp()
               FROM catalog_pages p
              WHERE h.catalog_page_id=p.id AND p.catalog_id=ANY($3::text[])
                AND (h.business_context IS NULL OR h.business_context=$1)`,
            [BUSINESS_CONTEXT, approved.decisionRef, ids]
        );
        const receiptSha256 = sha256({ mappingSha256: approved.mappingSha256, sourceFingerprintSha256: expected,
            businessContext: BUSINESS_CONTEXT, catalogIds: [...ids].sort(), publicCatalogNames: [...PUBLIC_CATALOG_NAMES].sort() });
        await client.query(
            `UPDATE catalog_ownership_cutover_journal
                SET state='applied',receipt_sha256=$2,applied_by_user_id=$3,applied_at=clock_timestamp(),updated_at=clock_timestamp()
              WHERE business_context=$1`, [BUSINESS_CONTEXT, receiptSha256, owner.userId]
        );
        return { state: 'applied', replay: false, receiptSha256, catalogCount: ids.length, publicLinkCount: 3,
            assets: 'shared_unassigned_pending_consumer_audit' };
    });
}

module.exports = { BUSINESS_CONTEXT, EXPECTED_CATALOG_NAMES, PUBLIC_CATALOG_NAMES, cleanMapping,
    prepareCatalogOwnershipCutover, applyCatalogOwnershipCutover };
