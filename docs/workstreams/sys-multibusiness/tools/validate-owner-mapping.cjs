'use strict';

// Offline review-input validation only. No SQL, application imports, writes,
// network access, environment credentials, or migration/apply mode.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../OWNER_MAPPING.schema.json'), 'utf8'));
const DECISION_IDS = Array.from({ length: 8 }, (_, i) => `OWN-0${i + 1}`);
const SERIAL_TABLES = new Set(['catalog_subcategories', 'catalog_items', 'catalog_pages', 'catalog_page_history',
    'catalog_automations', 'trend_proposals', 'booking_templates', 'recurring_templates', 'recurring_booking_skips']);
// field: [target tables, nullable, repeated]. Observed relations are evidence,
// not invented foreign keys or authorization inferred from a referenced record.
const RELATIONS = {
    catalog_definitions: {},
    catalog_subcategories: { catalog_id: [['catalog_definitions'], false] },
    catalog_items: { catalog_id: [['catalog_definitions'], false] },
    catalog_settings: { catalog_id: [['catalog_definitions'], false] },
    catalog_pages: { catalog_id: [['catalog_definitions'], false], embedded_item_reference: [['catalog_items'], true, true] },
    catalog_page_history: { catalog_page_id: [['catalog_pages'], true] },
    catalog_automations: { catalog_id: [['catalog_definitions'], true] },
    trend_proposals: { catalog_id: [['catalog_definitions'], false], generated_item_id: [['catalog_items'], true] },
    catalog_image_blobs: { observed_asset_use: [['catalog_definitions', 'catalog_items', 'catalog_pages', 'catalog_page_history', 'products'], true, true] },
    booking_templates: { product_id: [['products'], true], room_resource_id: [['timeline_resources'], true] },
    recurring_templates: { product_id: [['products'], true], room_resource_id: [['timeline_resources'], true],
        observed_recurring_instance: [['bookings'], true, true] },
    recurring_booking_skips: { template_id: [['recurring_templates'], false] }
};

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

function attestationBinding(document, kind, record) {
    const { attestation, ...reviewedRecord } = record;
    const linkedEvidence = [...record.evidenceRefs].sort().map(ref => document.evidence.find(row => row.ref === ref) || { ref, missing: true });
    const linkedTargets = kind === 'entity' ? record.relations.filter(row => row.state === 'LINKED')
        .map(relation => {
            const target = [...document.entities, ...document.referenceRecords].find(row => row.ref === relation.targetRef);
            return { field: relation.field, targetRef: relation.targetRef, identity: target ? {
                table: target.table, key: target.key, rowSha256: target.rowSha256, owner: target.owner,
                status: target.status || null, evidenceRefs: target.evidenceRefs
            } : null };
        }).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right))) : null;
    const linkedDecisions = kind === 'entity' ? [...record.decisionRefs].sort().map(id => {
        const decision = document.decisions.find(row => row.id === id);
        return decision ? { id, revision: decision.revision, status: decision.status,
            evidenceRefs: [...decision.evidenceRefs].sort(), bindingSha256: decision.attestation?.bindingSha256 || null }
            : { id, missing: true };
    }) : null;
    return sha256({ schemaVersion: document.schemaVersion, dataKind: document.dataKind,
        source: document.source, registry: document.registry,
        evidenceDefinitions: [...document.evidence].sort((left, right) => compareText(left.ref, right.ref)),
        kind, reviewedRecord, linkedEvidence, ...(kind === 'entity' ? { linkedDecisions, linkedTargets } : {}) });
}

function structural(value, rule, at, errors) {
    if (rule.$ref) return structural(value, schema.$defs[rule.$ref.split('/').at(-1)], at, errors);
    if (rule.anyOf) {
        if (!rule.anyOf.some(branch => { const trial = []; structural(value, branch, at, trial); return trial.length === 0; })) {
            errors.push({ code: 'INVALID_SHAPE', at });
        }
        return;
    }
    if (Object.hasOwn(rule, 'const') && value !== rule.const) errors.push({ code: 'INVALID_CONSTANT', at });
    if (rule.enum && !rule.enum.includes(value)) errors.push({ code: 'INVALID_ENUM', at });
    if (!rule.type) return;
    const matches = rule.type === 'null' ? value === null
        : rule.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : rule.type === 'array' ? Array.isArray(value)
                : rule.type === 'integer' ? Number.isSafeInteger(value) : typeof value === rule.type;
    if (!matches) { errors.push({ code: 'INVALID_TYPE', at }); return; }
    if (rule.type === 'object') {
        for (const key of rule.required || []) if (!Object.hasOwn(value, key)) errors.push({ code: 'REQUIRED_FIELD', at: `${at}.${key}` });
        for (const key of Object.keys(value)) {
            if (Object.hasOwn(rule.properties || {}, key)) structural(value[key], rule.properties[key], `${at}.${key}`, errors);
            else if (rule.additionalProperties === false) errors.push({ code: 'UNKNOWN_PROPERTY', at });
        }
    } else if (rule.type === 'array') {
        if (rule.minItems !== undefined && value.length < rule.minItems) errors.push({ code: 'ARRAY_TOO_SHORT', at });
        if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push({ code: 'ARRAY_TOO_LONG', at });
        if (rule.uniqueItems && new Set(value.map(canonicalJson)).size !== value.length) errors.push({ code: 'DUPLICATE_ITEM', at });
        if (value.length <= (rule.maxItems || 100000)) value.forEach((item, index) => structural(item, rule.items, `${at}[${index}]`, errors));
    } else if (rule.type === 'string') {
        if (rule.minLength !== undefined && Array.from(value).length < rule.minLength) errors.push({ code: 'STRING_TOO_SHORT', at });
        if (rule.maxLength !== undefined && Array.from(value).length > rule.maxLength) errors.push({ code: 'STRING_TOO_LONG', at });
        if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push({ code: 'INVALID_PATTERN', at });
        if (rule.format === 'date-time') {
            const parsed = Date.parse(value);
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
                || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
                errors.push({ code: 'INVALID_TIMESTAMP', at });
            }
        }
    } else if (rule.type === 'integer' && rule.minimum !== undefined && value < rule.minimum) {
        errors.push({ code: 'NUMBER_TOO_SMALL', at });
    }
}

function validate(document) {
    const errors = [];
    structural(document, schema, '$', errors);
    const result = { formatValid: false, classification: 'RESTRICTED', dataKind: null,
        recordCollection: 'UNKNOWN', migrationReadiness: 'INVALID_FORMAT', authorizationVerified: false,
        sourceSnapshotVerified: false, safeToApply: false, errors };
    if (errors.length) return result;
    result.dataKind = document.dataKind;
    const fail = (code, at) => errors.push({ code, at });
    const unique = (records, field, at) => {
        const map = new Map();
        records.forEach((record, index) => {
            if (map.has(record[field])) fail('DUPLICATE_ID', `${at}[${index}]`);
            map.set(record[field], record);
        });
        return map;
    };
    const evidence = unique(document.evidence, 'ref', '$.evidence');
    const decisions = unique(document.decisions, 'id', '$.decisions');
    const organizations = unique(document.registry.organizations, 'ref', '$.registry.organizations');
    const businesses = unique(document.registry.businesses, 'ref', '$.registry.businesses');
    unique(document.registry.organizations, 'registryId', '$.registry.organizations');
    unique(document.registry.businesses, 'registryId', '$.registry.businesses');
    unique(document.registry.businesses, 'contextKey', '$.registry.businesses');
    const entities = unique(document.entities, 'ref', '$.entities');
    const references = unique(document.referenceRecords, 'ref', '$.referenceRecords');
    const records = new Map([...entities, ...references]);
    for (const id of entities.keys()) if (references.has(id)) fail('AMBIGUOUS_RECORD_REF', '$.referenceRecords');
    for (const id of DECISION_IDS) if (!decisions.has(id)) fail('MISSING_DECISION', '$.decisions');
    const checkEvidence = (refs, at, { required = true, kind } = {}) => {
        if (required && !refs.length) fail('MISSING_EVIDENCE', at);
        for (const ref of refs) {
            if (!evidence.has(ref)) fail('UNKNOWN_EVIDENCE', at);
            else if (kind && evidence.get(ref).kind !== kind) fail('WRONG_EVIDENCE_KIND', at);
        }
    };
    const checkOwner = (owner, at) => {
        if (!owner) return;
        if (!organizations.has(owner.organizationRef) || !businesses.has(owner.businessRef)) fail('UNKNOWN_OWNER_REGISTRY', at);
        else if (businesses.get(owner.businessRef).organizationRef !== owner.organizationRef) fail('CROSS_ORGANIZATION_OWNER', at);
    };
    const checkAttestation = (record, kind, at) => {
        if (record.status !== 'APPROVED') {
            if (record.attestation !== null) fail('PENDING_WITH_APPROVAL_ATTESTATION', at);
            return;
        }
        if (!record.attestation) { fail('APPROVAL_ATTESTATION_REQUIRED', at); return; }
        checkEvidence([record.attestation.evidenceRef], `${at}.attestation`, { kind: 'review_attestation' });
        if (record.attestation.bindingSha256 !== attestationBinding(document, kind, record)) fail('STALE_ATTESTATION_BINDING', at);
        if (document.source && Date.parse(record.attestation.reviewedAt) < Date.parse(document.source.capturedAt)) {
            fail('ATTESTATION_PREDATES_SOURCE', at);
        }
    };
    document.evidence.forEach((item, i) => {
        if (document.dataKind === 'synthetic' && item.origin !== 'SYNTHETIC') fail('SYNTHETIC_EVIDENCE_ORIGIN_REQUIRED', `$.evidence[${i}]`);
        if (document.dataKind === 'restricted_snapshot' && item.origin === 'SYNTHETIC') fail('SYNTHETIC_EVIDENCE_IN_RESTRICTED_MAPPING', `$.evidence[${i}]`);
    });
    document.registry.organizations.forEach((row, i) => checkEvidence(row.evidenceRefs, `$.registry.organizations[${i}]`, { kind: 'registry_snapshot' }));
    document.registry.businesses.forEach((row, i) => {
        if (!organizations.has(row.organizationRef)) fail('UNKNOWN_ORGANIZATION', `$.registry.businesses[${i}]`);
        checkEvidence(row.evidenceRefs, `$.registry.businesses[${i}]`, { kind: 'registry_snapshot' });
    });
    document.decisions.forEach((decision, i) => {
        checkEvidence(decision.evidenceRefs, `$.decisions[${i}]`, { required: decision.status === 'APPROVED' });
        if (decision.status === 'APPROVED' && !decision.evidenceRefs.some(ref => evidence.get(ref)?.kind === 'owner_decision')) {
            fail('OWNER_DECISION_EVIDENCE_REQUIRED', `$.decisions[${i}]`);
        }
        checkAttestation(decision, 'decision', `$.decisions[${i}]`);
    });
    const rowKeys = new Set();
    const checkRecord = (record, at) => {
        const expectedKeys = record.table === 'catalog_settings' ? ['catalog_id']
            : record.table === 'catalog_image_blobs' ? ['filename']
                : record.table === 'timeline_resources' ? ['business_context', 'resource_id'] : ['id'];
        if (canonicalJson(Object.keys(record.key).sort()) !== canonicalJson(expectedKeys.sort())) fail('INVALID_TABLE_KEY', at);
        if (SERIAL_TABLES.has(record.table) && (!/^[1-9][0-9]*$/.test(record.key.id || '') || BigInt(record.key.id) > 2147483647n)) fail('INVALID_SERIAL_ID', at);
        if (['catalog_definitions', 'products', 'bookings'].includes(record.table) && Array.from(record.key.id || '').length > 50) fail('ID_EXCEEDS_COLUMN_LENGTH', at);
        if (record.table === 'catalog_image_blobs' && record.key.filename !== record.key.filename?.trim()) fail('FILENAME_NOT_TRIMMED', at);
        const key = `${record.table}:${canonicalJson(record.key)}`;
        if (rowKeys.has(key)) fail('DUPLICATE_SOURCE_RECORD', at);
        rowKeys.add(key);
        checkOwner(record.owner, `${at}.owner`);
        checkEvidence(record.evidenceRefs, `${at}.evidenceRefs`);
        if (!record.evidenceRefs.some(ref => evidence.get(ref)?.kind === 'record_snapshot')) fail('ROW_SNAPSHOT_EVIDENCE_REQUIRED', at);
        if (record.table === 'timeline_resources' && record.owner && businesses.get(record.owner.businessRef)?.contextKey !== record.key.business_context) fail('RESOURCE_CONTEXT_OWNER_MISMATCH', at);
    };
    document.referenceRecords.forEach((record, i) => checkRecord(record, `$.referenceRecords[${i}]`));
    document.entities.forEach((entry, i) => {
        const at = `$.entities[${i}]`;
        checkRecord(entry, at);
        checkAttestation(entry, 'entity', at);
        const requiredDecisions = ['OWN-01', 'OWN-03', 'OWN-08'];
        if (['catalog_definitions', 'booking_templates', 'recurring_templates'].includes(entry.table)) requiredDecisions.push('OWN-02');
        if (entry.table === 'catalog_definitions') requiredDecisions.push('OWN-04');
        if (entry.table === 'catalog_image_blobs') requiredDecisions.push('OWN-05');
        if (['catalog_automations', 'recurring_templates'].includes(entry.table)) requiredDecisions.push('OWN-06');
        for (const id of requiredDecisions) if (!entry.decisionRefs.includes(id)) fail('REQUIRED_DECISION_NOT_LINKED', at);
        for (const id of entry.decisionRefs) {
            if (!decisions.has(id)) fail('UNKNOWN_DECISION', at);
            else if (entry.status === 'APPROVED' && decisions.get(id).status !== 'APPROVED') fail('UNAPPROVED_DECISION', at);
        }
        if (entry.status === 'PENDING' && (entry.owner !== null || entry.disposition !== 'QUARANTINE')) fail('PENDING_MUST_BE_UNASSIGNED_QUARANTINE', at);
        if (entry.classification !== 'BUSINESS_OWNED' && (entry.owner !== null || entry.disposition !== 'QUARANTINE' || entry.status !== 'PENDING')) fail('UNRESOLVED_CLASSIFICATION_MUST_BE_QUARANTINED', at);
        if (entry.disposition === 'ASSIGN' && (entry.status !== 'APPROVED' || entry.classification !== 'BUSINESS_OWNED' || !entry.owner
            || entry.reasonCode !== 'REVIEWED_SINGLE_OWNER' || entry.relationCoverage !== 'COMPLETE')) fail('ASSIGNMENT_NOT_REVIEWED', at);
        if (entry.status === 'APPROVED' && entry.disposition !== 'ASSIGN') fail('APPROVAL_REQUIRES_SINGLE_OWNER_ASSIGNMENT', at);
        const relationRules = RELATIONS[entry.table];
        const seen = new Set();
        const relationIdentities = new Set();
        const relationGroups = new Map();
        for (const [index, relation] of entry.relations.entries()) {
            const here = `${at}.relations[${index}]`;
            const relationRule = relationRules[relation.field];
            if (!relationRule) { fail('UNSUPPORTED_TABLE_RELATION', here); continue; }
            if (seen.has(relation.field) && !relationRule[2]) fail('DUPLICATE_SINGLE_RELATION', here);
            seen.add(relation.field);
            const relationIdentity = canonicalJson([relation.field, relation.state, relation.targetRef]);
            if (relationIdentities.has(relationIdentity)) fail('DUPLICATE_RELATION_TARGET', here);
            relationIdentities.add(relationIdentity);
            const group = relationGroups.get(relation.field) || [];
            group.push(relation.state);
            relationGroups.set(relation.field, group);
            checkEvidence(relation.evidenceRefs, here, { required: relation.state !== 'NOT_COLLECTED' });
            if (entry.relationCoverage === 'COMPLETE' && relation.state === 'NOT_COLLECTED') fail('INCOMPLETE_RELATION_COVERAGE', here);
            if (relation.state !== 'LINKED') {
                if (relation.targetRef !== null) fail('UNRESOLVED_RELATION_HAS_TARGET', here);
                if (relation.state === 'NULL' && !relationRule[1]) fail('NONNULL_RELATION_REPORTED_NULL', here);
                if (entry.disposition === 'ASSIGN' && relation.state !== 'NULL') fail('ASSIGNED_WITH_UNRESOLVED_RELATION', here);
                continue;
            }
            const target = records.get(relation.targetRef);
            if (!target || !relationRule[0].includes(target.table)) { fail('INVALID_RELATION_TARGET', here); continue; }
            if (entry.table === 'catalog_settings' && entry.key.catalog_id !== target.key.id) fail('SETTINGS_PARENT_KEY_MISMATCH', here);
            if (entry.disposition === 'ASSIGN') {
                if (!target.owner || canonicalJson(target.owner) !== canonicalJson(entry.owner)) fail('RELATED_OWNER_MISMATCH', here);
                if (entities.has(target.ref) && target.status !== 'APPROVED') fail('PARENT_NOT_APPROVED', here);
            }
        }
        for (const [field, rule] of Object.entries(relationRules)) {
            if ((!rule[2] || entry.relationCoverage === 'COMPLETE') && !seen.has(field)) fail('RELATION_NOT_ACCOUNTED_FOR', at);
            const states = relationGroups.get(field) || [];
            if (states.length > 1 && states.some(state => state !== 'LINKED')) fail('CONTRADICTORY_RELATION_STATE', at);
        }
        if (entry.table === 'catalog_image_blobs' && entry.disposition === 'ASSIGN' && !entry.relations.some(row => row.state === 'LINKED')) fail('ASSET_USE_NOT_ESTABLISHED', at);
    });
    if (document.dataKind === 'unpopulated') {
        if (document.source !== null || document.entities.length || document.referenceRecords.length || document.evidence.length
            || document.registry.organizations.length || document.registry.businesses.length
            || document.decisions.some(row => row.status !== 'PENDING' || row.evidenceRefs.length || row.attestation !== null)) fail('UNPOPULATED_HAS_DATA_OR_APPROVAL', '$');
    } else if (document.source === null) fail('SOURCE_FINGERPRINT_REQUIRED', '$.source');
    result.formatValid = errors.length === 0;
    if (!result.formatValid) return result;
    result.recordCollection = document.dataKind === 'unpopulated' ? 'NOT_COLLECTED' : `CLAIMED_${document.source.coverage}_UNVERIFIED`;
    result.counts = { mappingEntries: document.entities.length, contextualReferences: document.referenceRecords.length,
        pendingEntries: document.entities.filter(row => row.status === 'PENDING').length,
        quarantinedEntries: document.entities.filter(row => row.disposition === 'QUARANTINE').length,
        pendingDecisions: document.decisions.filter(row => row.status === 'PENDING').length };
    result.migrationReadiness = document.dataKind === 'unpopulated' ? 'NOT_COLLECTED'
        : document.dataKind === 'synthetic' ? 'SYNTHETIC_NOT_APPLICABLE'
            : document.source.coverage !== 'COMPLETE' || result.counts.pendingEntries || result.counts.pendingDecisions
                ? 'BLOCKED_UNRESOLVED_REVIEW' : 'REQUIRES_INDEPENDENT_SOURCE_AND_APPROVAL_VERIFICATION';
    return result;
}

function main(args) {
    if (args.length === 1 && args[0] === '--help') {
        process.stdout.write('Usage: node validate-owner-mapping.cjs <mapping.json>\nOffline, read-only. Exit 0 means format-valid; it never authorizes migration. No apply mode.\n');
        return 0;
    }
    if (args.length !== 1 || args[0].startsWith('-')) {
        process.stdout.write(JSON.stringify({ formatValid: false, safeToApply: false, errors: [{ code: 'USAGE_ERROR' }] }) + '\n');
        return 2;
    }
    try {
        if (fs.statSync(args[0]).size > 20 * 1024 * 1024) throw new Error('Input exceeds format limit');
        const result = validate(JSON.parse(fs.readFileSync(args[0], 'utf8')));
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return result.formatValid ? 0 : 1;
    } catch {
        // Never echo input paths, IDs, values, parser excerpts, or exception text.
        process.stdout.write(JSON.stringify({ formatValid: false, safeToApply: false, errors: [{ code: 'INPUT_NOT_READABLE_JSON' }] }) + '\n');
        return 2;
    }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { validate, canonicalJson, attestationBinding, main };
