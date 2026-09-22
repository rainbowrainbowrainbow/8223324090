'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    EXPECTED_CATALOG_NAMES,
    PUBLIC_CATALOG_NAMES,
    applyCatalogOwnershipCutover,
    cleanMapping,
    prepareCatalogOwnershipCutover
} = require('../services/catalogOwnershipCutover');
const { sha256 } = require('../services/businessCutover');

const catalogs = EXPECTED_CATALOG_NAMES.map((name, index) => ({ id: `catalog-${index + 1}`, name }));
const mapping = { businessContext: 'event_genix', decisionRef: 'SYS-MB-CLOSE-01:user-approved:2026-09-22',
    catalogs, publicCatalogNames: [...PUBLIC_CATALOG_NAMES] };

function rows() {
    return catalogs.map((catalog, index) => ({ ...catalog, is_active: index >= 4, status: index === 5 ? 'ready' : 'draft',
        business_context: null, ownership_status: 'legacy_unassigned', publication_visibility: 'legacy',
        has_public_token: PUBLIC_CATALOG_NAMES.includes(catalog.name), page_count: index, item_count: index * 2 }));
}

function fakeDb(options = {}) {
    const calls = [];
    const client = {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/FROM organization_memberships om/.test(sql)) return { rows: [{ organization_id: 1 }] };
            if (/FROM catalog_definitions d/.test(sql)) return { rows: rows() };
            if (/COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 2, unassigned: 2,
                assigned_target: 0, conflicts: options.childConflict && /FROM catalog_items/.test(sql) ? 1 : 0 }] };
            if (/SELECT \* FROM catalog_ownership_cutover_journal/.test(sql)) return { rows: options.journal ? [options.journal] : [] };
            return { rows: [], rowCount: 9 };
        },
        release() {}
    };
    return { client, db: { async connect() { return client; } } };
}

function payload(extra = {}) {
    return { approvedMapping: mapping, mappingSha256: sha256(mapping), decisionRef: mapping.decisionRef, ...extra };
}

test('catalog mapping requires the exact reviewed nine roots and three existing public links', () => {
    assert.equal(cleanMapping(payload()).catalogs.length, 9);
    assert.throws(() => cleanMapping(payload({ approvedMapping: { ...mapping, catalogs: catalogs.slice(1) },
        mappingSha256: sha256({ ...mapping, catalogs: catalogs.slice(1) }) })), { code: 'catalog_cutover_set_mismatch' });
    const rotated = { ...mapping, publicCatalogNames: ['Торти'] };
    assert.throws(() => cleanMapping(payload({ approvedMapping: rotated, mappingSha256: sha256(rotated) })),
        { code: 'catalog_cutover_public_set_mismatch' });
});

test('catalog mapping accepts reviewed printable Unicode IDs and rejects control characters', () => {
    const unicodeCatalogs = catalogs.map((catalog, index) => index === catalogs.length - 1
        ? { ...catalog, id: 'Торти з грибів' }
        : catalog);
    const unicodeMapping = { ...mapping, catalogs: unicodeCatalogs };
    assert.equal(cleanMapping(payload({ approvedMapping: unicodeMapping,
        mappingSha256: sha256(unicodeMapping) })).catalogs.at(-1).id, 'Торти з грибів');

    const controlCatalogs = catalogs.map((catalog, index) => index === catalogs.length - 1
        ? { ...catalog, id: 'catalog\n9' }
        : catalog);
    const controlMapping = { ...mapping, catalogs: controlCatalogs };
    assert.throws(() => cleanMapping(payload({ approvedMapping: controlMapping,
        mappingSha256: sha256(controlMapping) })), { code: 'catalog_cutover_invalid' });
});

test('catalog ownership preparation is read-only apart from hash-bound journal evidence', async () => {
    const { db, client } = fakeDb();
    const result = await prepareCatalogOwnershipCutover(db, { id: 10 }, payload());
    assert.equal(result.state, 'prepared');
    assert.equal(result.catalogCount, 9);
    assert.equal(result.publicLinkCount, 3);
    assert.match(result.sourceFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.equal(client.calls.some(call => /UPDATE catalog_definitions/.test(call.sql)), false);
    assert.equal(client.calls.some(call => /INSERT INTO catalog_ownership_cutover_journal/.test(call.sql)), true);
});

test('catalog ownership apply scopes roots and every child table but keeps shared blobs unassigned', async () => {
    const prepared = fakeDb();
    const preview = await prepareCatalogOwnershipCutover(prepared.db, { id: 10 }, payload());
    const journal = { state: 'prepared', mapping_sha256: sha256(mapping), source_fingerprint_sha256: preview.sourceFingerprintSha256 };
    const { db, client } = fakeDb({ journal });
    const result = await applyCatalogOwnershipCutover(db, { id: 10 }, payload({ sourceFingerprintSha256: preview.sourceFingerprintSha256 }));
    assert.equal(result.state, 'applied');
    assert.equal(result.catalogCount, 9);
    assert.equal(result.assets, 'shared_unassigned_pending_consumer_audit');
    const rootUpdate = client.calls.find(call => /UPDATE catalog_definitions/.test(call.sql));
    assert.ok(rootUpdate);
    assert.match(rootUpdate.sql, /ownership_status='approved'/);
    for (const table of ['catalog_subcategories', 'catalog_items', 'catalog_settings', 'catalog_pages',
        'catalog_automations', 'catalog_page_history', 'trend_proposals']) {
        assert.equal(client.calls.some(call => call.sql.includes(`UPDATE ${table}`)), true, table);
    }
    assert.equal(client.calls.some(call => /UPDATE catalog_image_blobs/.test(call.sql)), false);
});

test('catalog ownership preparation rejects a child already owned by another business', async () => {
    const { db, client } = fakeDb({ childConflict: true });
    await assert.rejects(prepareCatalogOwnershipCutover(db, { id: 10 }, payload()),
        { code: 'catalog_cutover_child_owner_conflict' });
    assert.equal(client.calls.some(call => /UPDATE catalog_definitions/.test(call.sql)), false);
});

test('catalog ownership apply rejects token drift without rotating or republishing', async () => {
    const { db, client } = fakeDb();
    const original = client.query;
    client.query = async (sql, params) => {
        if (/FROM catalog_definitions d/.test(sql)) {
            const drifted = rows();
            drifted.find(row => row.name === '122112').has_public_token = false;
            return { rows: drifted };
        }
        return original.call(client, sql, params);
    };
    await assert.rejects(prepareCatalogOwnershipCutover(db, { id: 10 }, payload()),
        { code: 'catalog_cutover_public_link_drift' });
    assert.equal(client.calls.some(call => /UPDATE catalog_definitions/.test(call.sql)), false);
});

test('catalog create and public readers use the same approved ownership state as the schema', () => {
    const root = path.join(__dirname, '..');
    const routes = fs.readFileSync(path.join(root, 'routes/catalogs.js'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(routes, /'event_genix','approved','private'/);
    assert.match(server, /ownership_status='approved'/);
    assert.doesNotMatch(server, /ownership_status='assigned'/);
});
