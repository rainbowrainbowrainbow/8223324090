'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { validate, canonicalJson, attestationBinding } = require('./validate-owner-mapping.cjs');
const fixturePath = path.join(__dirname, '../OWNER_MAPPING.synthetic.json');
const cliPath = path.join(__dirname, 'validate-owner-mapping.cjs');
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

function seal(document, record, kind) {
    record.attestation = { reviewerRef: 'REVIEWER-SYNTHETIC', evidenceRef: 'EV-REVIEW',
        reviewedAt: '2026-09-12T01:00:00Z', bindingSha256: attestationBinding(document, kind, record) };
}

// An in-memory fictional claim exercises attestation validation. It is never
// persisted as a real approved mapping or accepted as proof of authorization.
function reviewedClaim() {
    const document = fixture();
    document.dataKind = 'restricted_snapshot';
    document.source.coverage = 'COMPLETE';
    document.referenceRecords = [];
    document.entities = document.entities.filter(row => ['MAP-CATALOG', 'MAP-ITEM', 'MAP-SETTINGS'].includes(row.ref));
    document.evidence.forEach(row => { row.origin = 'DATABASE_SNAPSHOT'; });
    for (const [ref, kind] of [['EV-OWNER', 'owner_decision'], ['EV-REVIEW', 'review_attestation']]) {
        document.evidence.push({ ref, kind, origin: 'OWNER_REVIEW', artifactRef: `TEST-${ref}`,
            sha256: '8'.repeat(64), capturedAt: '2026-09-12T01:00:00Z' });
    }
    for (const decision of document.decisions) {
        decision.status = 'APPROVED';
        decision.evidenceRefs = ['EV-OWNER'];
        seal(document, decision, 'decision');
    }
    for (const entry of document.entities) {
        entry.status = 'APPROVED';
        entry.classification = 'BUSINESS_OWNED';
        entry.disposition = 'ASSIGN';
        entry.owner = { organizationRef: 'ORG-SYNTHETIC-A', businessRef: 'BUS-SYNTHETIC-A' };
        entry.reasonCode = 'REVIEWED_SINGLE_OWNER';
        entry.relationCoverage = 'COMPLETE';
        seal(document, entry, 'entity');
    }
    return document;
}

function rejected(document, code) {
    const result = validate(document);
    assert.equal(result.formatValid, false);
    assert.equal(result.safeToApply, false);
    assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result));
}

test('committed example is format-valid synthetic quarantine, never migration ready', () => {
    const result = validate(fixture());
    assert.equal(result.formatValid, true, JSON.stringify(result));
    assert.equal(result.migrationReadiness, 'SYNTHETIC_NOT_APPLICABLE');
    assert.equal(result.counts.quarantinedEntries, 12);
    assert.equal(result.counts.pendingDecisions, 8);
    assert.equal(result.safeToApply, false);
});

test('unpopulated input reports NOT_COLLECTED rather than a verified zero-record source', () => {
    const document = fixture();
    Object.assign(document, { dataKind: 'unpopulated', source: null, evidence: [], entities: [], referenceRecords: [],
        registry: { organizations: [], businesses: [] } });
    const result = validate(document);
    assert.equal(result.formatValid, true, JSON.stringify(result));
    assert.equal(result.recordCollection, 'NOT_COLLECTED');
    assert.equal(result.migrationReadiness, 'NOT_COLLECTED');
    document.entities = fixture().entities;
    rejected(document, 'UNPOPULATED_HAS_DATA_OR_APPROVAL');
});

test('even a fully classified self-asserted review cannot prove snapshot, reviewer identity or migration permission', () => {
    const result = validate(reviewedClaim());
    assert.equal(result.formatValid, true, JSON.stringify(result));
    assert.equal(result.migrationReadiness, 'REQUIRES_INDEPENDENT_SOURCE_AND_APPROVAL_VERIFICATION');
    assert.equal(result.authorizationVerified, false);
    assert.equal(result.sourceSnapshotVerified, false);
    assert.equal(result.safeToApply, false);
});

for (const field of ['apply', 'force', 'migrationReady', 'approvedByCreator', 'ownerName', 'public_token', 'url']) {
    test(`unknown ${field} field is rejected without echoing its value`, () => {
        const document = fixture();
        document.entities[0][field] = 'PRIVATE-SENTINEL-DO-NOT-ECHO';
        const result = validate(document);
        assert.equal(result.formatValid, false);
        assert.ok(result.errors.some(error => error.code === 'UNKNOWN_PROPERTY'));
        assert.equal(JSON.stringify(result).includes('PRIVATE-SENTINEL'), false);
    });
}

test('Unicode catalog, product and filename identities survive byte-for-byte without normalization', () => {
    const document = fixture();
    document.entities.find(row => row.ref === 'MAP-CATALOG').key.id = 'синтетичний Каталог ✨';
    document.entities.find(row => row.ref === 'MAP-SETTINGS').key.catalog_id = 'синтетичний Каталог ✨';
    document.entities.find(row => row.ref === 'MAP-BLOB').key.filename = 'синтетичне зображення ✨.png';
    document.referenceRecords[0].key.id = 'синтетичний продукт:42';
    const before = canonicalJson(document);
    assert.equal(validate(document).formatValid, true);
    assert.equal(canonicalJson(document), before);
});

test('blob filenames retain the SQL trim/no-slash rules and cannot contain a URL', () => {
    for (const filename of [' leading.png', 'trailing.png ', 'path/file.png', 'path\\file.png', 'https://private.invalid/token']) {
        const document = fixture();
        document.entities.find(row => row.ref === 'MAP-BLOB').key.filename = filename;
        assert.equal(validate(document).formatValid, false);
    }
});

test('serial IDs, per-table keys and catalog VARCHAR length follow actual identities', () => {
    const badSerial = fixture(); badSerial.entities[1].key.id = '2147483648'; rejected(badSerial, 'INVALID_SERIAL_ID');
    const badKey = fixture(); badKey.entities[1].key = { filename: 'wrong.png' }; rejected(badKey, 'INVALID_TABLE_KEY');
    const longId = fixture(); longId.entities[0].key.id = 'я'.repeat(51); rejected(longId, 'ID_EXCEEDS_COLUMN_LENGTH');
});

test('unresolved entities cannot quietly receive an owner', () => {
    const document = fixture();
    document.entities[0].owner = { organizationRef: 'ORG-SYNTHETIC-A', businessRef: 'BUS-SYNTHETIC-A' };
    rejected(document, 'PENDING_MUST_BE_UNASSIGNED_QUARANTINE');
});

test('APPROVED requires owner-decision evidence and a matching attestation', () => {
    const document = fixture();
    document.entities[0].status = 'APPROVED';
    rejected(document, 'APPROVAL_ATTESTATION_REQUIRED');
    const claim = reviewedClaim();
    claim.decisions[0].evidenceRefs = ['EV-ROWS']; seal(claim, claim.decisions[0], 'decision');
    rejected(claim, 'OWNER_DECISION_EVIDENCE_REQUIRED');
});

test('an approved policy revision invalidates the previous row attestation', () => {
    const document = reviewedClaim();
    document.decisions[0].revision += 1;
    seal(document, document.decisions[0], 'decision');
    rejected(document, 'STALE_ATTESTATION_BINDING');
});

test('changed row, owner-decision evidence or source fingerprints invalidate previous review bindings', () => {
    for (const change of [
        document => { document.entities[0].rowSha256 = 'a'.repeat(64); },
        document => { document.evidence.find(row => row.ref === 'EV-OWNER').sha256 = 'a'.repeat(64); },
        document => { document.source.snapshotSha256 = 'a'.repeat(64); }
    ]) { const document = reviewedClaim(); change(document); rejected(document, 'STALE_ATTESTATION_BINDING'); }
});

test('stable references cannot hide changed registry, evidence or related target identities', () => {
    for (const change of [
        document => { document.registry.businesses[0].registryId = '900002'; },
        document => { document.registry.businesses[0].contextKey = 'synthetic_retargeted'; },
        document => { document.evidence.find(row => row.ref === 'EV-REGISTRY').artifactRef = 'TEST-REPLACED-EVIDENCE'; },
        document => { document.evidence.find(row => row.ref === 'EV-REVIEW').sha256 = 'b'.repeat(64); },
        document => { document.entities[0].key.id = 'synthetic-retargeted-catalog'; },
        document => { document.entities[0].rowSha256 = 'c'.repeat(64); }
    ]) { const document = reviewedClaim(); change(document); rejected(document, 'STALE_ATTESTATION_BINDING'); }
});

test('impossible or imprecisely parsed UTC dates are rejected', () => {
    for (const capturedAt of ['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-09-12T24:00:00Z', '2026-09-12T00:00:00.00001Z']) {
        const document = fixture(); document.evidence[0].capturedAt = capturedAt;
        rejected(document, 'INVALID_TIMESTAMP');
    }
});

test('organization/business mismatch and duplicate source row assignments are rejected', () => {
    const owner = reviewedClaim();
    owner.registry.organizations.push({ ref: 'ORG-SYNTHETIC-B', registryId: '900002', evidenceRefs: ['EV-REGISTRY'] });
    owner.entities[0].owner.organizationRef = 'ORG-SYNTHETIC-B';
    seal(owner, owner.entities[0], 'entity'); rejected(owner, 'CROSS_ORGANIZATION_OWNER');
    const duplicate = fixture(); duplicate.entities.push({ ...clone(duplicate.entities[0]), ref: 'MAP-DUPLICATE' });
    rejected(duplicate, 'DUPLICATE_SOURCE_RECORD');
});

test('an approved child cannot point to a different approved business or an unreviewed parent', () => {
    const document = reviewedClaim();
    document.registry.businesses.push({ ref: 'BUS-SYNTHETIC-B', registryId: '900002', organizationRef: 'ORG-SYNTHETIC-A',
        contextKey: 'synthetic_b', evidenceRefs: ['EV-REGISTRY'] });
    const child = document.entities.find(row => row.ref === 'MAP-ITEM');
    child.owner.businessRef = 'BUS-SYNTHETIC-B'; seal(document, child, 'entity');
    rejected(document, 'RELATED_OWNER_MISMATCH');
    const pendingParent = reviewedClaim();
    Object.assign(pendingParent.entities[0], { status: 'PENDING', disposition: 'QUARANTINE', owner: null, attestation: null });
    rejected(pendingParent, 'PARENT_NOT_APPROVED');
});

test('missing and false relations cannot establish ownership; NULL is allowed only for nullable source fields', () => {
    const missing = fixture(); missing.entities[1].relations = []; rejected(missing, 'RELATION_NOT_ACCOUNTED_FOR');
    const nullable = fixture(); nullable.entities[1].relations[0] = { field: 'catalog_id', state: 'NULL', targetRef: null, evidenceRefs: ['EV-RELATIONS'] };
    rejected(nullable, 'NONNULL_RELATION_REPORTED_NULL');
    const falseTarget = fixture(); falseTarget.entities[1].relations[0].targetRef = 'REF-SYNTHETIC-PRODUCT'; rejected(falseTarget, 'INVALID_RELATION_TARGET');
});

test('COMPLETE relation coverage explicitly accounts for repeated observations including reviewed empty sets', () => {
    const document = fixture();
    const series = document.entities.find(row => row.ref === 'MAP-RECURRING');
    series.relationCoverage = 'COMPLETE';
    rejected(document, 'RELATION_NOT_ACCOUNTED_FOR');
    rejected(document, 'INCOMPLETE_RELATION_COVERAGE');
    series.relations.forEach(row => { row.state = 'NULL'; row.evidenceRefs = ['EV-RELATIONS']; });
    series.relations.push({ field: 'observed_recurring_instance', state: 'NULL', targetRef: null, evidenceRefs: ['EV-RELATIONS'] });
    assert.equal(validate(document).formatValid, true);
    const page = document.entities.find(row => row.ref === 'MAP-PAGE');
    page.relationCoverage = 'COMPLETE';
    page.relations = page.relations.filter(row => row.field !== 'embedded_item_reference');
    rejected(document, 'RELATION_NOT_ACCOUNTED_FOR');
});

test('repeated relation targets and NULL plus LINKED contradictions are rejected', () => {
    const duplicate = fixture();
    const blob = duplicate.entities.find(row => row.ref === 'MAP-BLOB');
    blob.relations.push(clone(blob.relations[0]));
    rejected(duplicate, 'DUPLICATE_RELATION_TARGET');
    const mixed = fixture();
    mixed.entities.find(row => row.ref === 'MAP-BLOB').relations.push({ field: 'observed_asset_use', state: 'NULL', targetRef: null, evidenceRefs: ['EV-RELATIONS'] });
    rejected(mixed, 'CONTRADICTORY_RELATION_STATE');
});

test('invented provider-job tables and proposed organization library assignment are not accepted', () => {
    const document = fixture(); document.entities[0].table = 'catalog_generation_jobs'; rejected(document, 'INVALID_ENUM');
    const shared = reviewedClaim(); shared.entities[0].classification = 'SHARED_CANDIDATE'; seal(shared, shared.entities[0], 'entity');
    rejected(shared, 'UNRESOLVED_CLASSIFICATION_MUST_BE_QUARANTINED');
});

test('mixed product/menu asset uses cannot acquire a single owner without resolving the graph', () => {
    const document = reviewedClaim();
    const sample = fixture();
    document.referenceRecords = sample.referenceRecords;
    document.referenceRecords[0].owner = null;
    const blob = sample.entities.find(row => row.ref === 'MAP-BLOB');
    Object.assign(blob, { status: 'APPROVED', classification: 'BUSINESS_OWNED', disposition: 'ASSIGN',
        owner: clone(document.entities[0].owner), reasonCode: 'REVIEWED_SINGLE_OWNER', relationCoverage: 'COMPLETE' });
    document.entities.push(blob); seal(document, blob, 'entity');
    rejected(document, 'RELATED_OWNER_MISMATCH');
});

test('CLI is read-only, redacts parser input, and rejects apply flags', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-owner-mapping-test-'));
    try {
        const input = path.join(directory, 'mapping.json');
        fs.writeFileSync(input, fs.readFileSync(fixturePath));
        const before = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
        const success = spawnSync(process.execPath, [cliPath, input], { encoding: 'utf8' });
        assert.equal(success.status, 0, success.stderr);
        assert.equal(JSON.parse(success.stdout).safeToApply, false);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'), before);
        assert.equal(spawnSync(process.execPath, [cliPath, '--apply', input], { encoding: 'utf8' }).status, 2);
        fs.writeFileSync(input, '{"PRIVATE-SENTINEL": broken-json}');
        const invalid = spawnSync(process.execPath, [cliPath, input], { encoding: 'utf8' });
        assert.equal(invalid.status, 2);
        assert.equal((invalid.stdout + invalid.stderr).includes('PRIVATE-SENTINEL'), false);
        assert.deepEqual(fs.readdirSync(directory), ['mapping.json']);
    } finally {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.match(path.basename(resolved), /^eventgenix-owner-mapping-test-[A-Za-z0-9]+$/);
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
