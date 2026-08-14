#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const APPLY_CONFIRMATION = 'BACKFILL_ROOM_RESOURCE_ID';
const LEGACY_ROOM_ALIASES = Object.freeze({
    'room-marvel': ['Marvel'],
    'room-ninja': ['Ninja'],
    'room-minecraft': ['Minecraft'],
    'room-monster-high': ['Monster High'],
    'room-elza': ['Elsa'],
    'room-rock': ['Rock'],
    'room-minion': ['Minion'],
    'room-pony': ['Pony'],
    'room-foodcourt': ['Food Court']
});
const SAFE_CATEGORIES = new Set([
    'exact_canonical_name',
    'short_name',
    'unique_alias',
    'takeaway',
    'inactive_unique_resource'
]);
const TABLES = Object.freeze([
    { name: 'bookings', context: true },
    { name: 'banquet_groups', context: true },
    { name: 'booking_templates', context: false },
    { name: 'recurring_templates', context: false }
]);

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
    const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
    const expectedSafeRaw = argValue(argv, '--expected-safe', null);
    return {
        apply: flags.has('--apply'),
        dryRun: flags.has('--dry-run') || !flags.has('--apply'),
        manifest: flags.has('--manifest'),
        json: flags.has('--json'),
        businessContext: String(argValue(argv, '--business-context', DEFAULT_BUSINESS_CONTEXT) || DEFAULT_BUSINESS_CONTEXT).trim(),
        confirmation: String(argValue(argv, '--confirm', '') || '').trim(),
        sourceCommit: String(argValue(argv, '--source-commit', '') || '').trim() || null,
        expectedSafe: expectedSafeRaw === null ? null : Number(expectedSafeRaw)
    };
}

function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
}

function metadataAliases(resource = {}) {
    let metadata = resource.metadata;
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    return Array.isArray(metadata?.aliases)
        ? metadata.aliases.map(value => String(value || '').trim()).filter(Boolean)
        : [];
}

function looksMojibake(value) {
    const text = String(value || '');
    return text.includes('\uFFFD') || /^\?+$/u.test(text.trim()) || /(?:Р.|С.){3,}/u.test(text);
}

function classifyRoomValue(room, resources = []) {
    const raw = String(room || '').trim();
    const value = normalized(raw);
    if (!value) return { category: 'empty', resourceId: null };
    if (['інше', 'other'].includes(value)) return { category: 'other_legacy', resourceId: null };
    if (['room-takeaway', 'takeaway', 'на виніс', 'на вынос'].includes(value)) {
        return { category: 'takeaway', resourceId: 'room-takeaway' };
    }

    const exact = resources.filter(resource => normalized(resource.name) === value);
    const short = resources.filter(resource => normalized(resource.short_name || resource.shortName) === value);
    const aliases = resources.filter(resource => metadataAliases(resource).some(alias => normalized(alias) === value));
    const choose = (matches, activeCategory, inactiveCategory = 'inactive_unique_resource') => {
        if (matches.length > 1) return { category: 'ambiguous_name_or_alias', resourceId: null };
        if (!matches.length) return null;
        const resource = matches[0];
        return {
            category: resource.is_active === false ? inactiveCategory : activeCategory,
            resourceId: String(resource.resource_id || resource.resourceId)
        };
    };

    return choose(exact, 'exact_canonical_name')
        || choose(short, 'short_name')
        || choose(aliases, 'unique_alias')
        || { category: looksMojibake(raw) ? 'mojibake' : 'unknown_or_custom', resourceId: null };
}

async function loadResources(db, businessContext) {
    const result = await db.query(
        `SELECT resource_id, name, short_name, metadata, is_active
           FROM timeline_resources
          WHERE business_context = $1
            AND type = 'room'
          ORDER BY resource_id`,
        [businessContext]
    );
    return (result.rows || []).map(resource => {
        const resourceId = String(resource.resource_id || resource.resourceId || '');
        const metadata = typeof resource.metadata === 'object' && resource.metadata
            ? resource.metadata
            : {};
        const currentAliases = metadataAliases(resource);
        const configuredAliases = LEGACY_ROOM_ALIASES[resourceId] || [];
        const aliasesToAdd = configuredAliases.filter(alias =>
            !currentAliases.some(current => normalized(current) === normalized(alias))
        );
        return {
            ...resource,
            aliasesToAdd,
            metadata: {
                ...metadata,
                aliases: Array.from(new Set([
                    ...currentAliases,
                    ...aliasesToAdd
                ]))
            }
        };
    });
}

async function loadTableRows(db, table, businessContext) {
    const contextSql = table.context
        ? `WHERE COALESCE(NULLIF(BTRIM(business_context), ''), $1) = $1`
        : '';
    const result = await db.query(
        `SELECT id, room, room_resource_id${table.context ? ', business_context' : ''}
           FROM ${table.name}
           ${contextSql}
          ORDER BY id`,
        table.context ? [businessContext] : []
    );
    return result.rows || [];
}

function summarizeItems(items = []) {
    const categories = {};
    for (const item of items) categories[item.category] = (categories[item.category] || 0) + 1;
    return {
        scanned: items.length,
        alreadyAssigned: items.filter(item => item.category === 'already_assigned').length,
        safeBackfill: items.filter(item => SAFE_CATEGORIES.has(item.category)).length,
        unresolved: items.filter(item => !SAFE_CATEGORIES.has(item.category) && item.category !== 'already_assigned').length,
        categories
    };
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function itemEvidence(category) {
    if (category === 'exact_canonical_name') return 'room text exactly matches canonical timeline_resources.name';
    if (category === 'short_name') return 'room text exactly matches unique timeline_resources.short_name';
    if (category === 'unique_alias') return 'room text exactly matches unique timeline_resources.metadata.aliases';
    if (category === 'takeaway') return 'room text is recognized virtual takeaway identity';
    if (category === 'inactive_unique_resource') return 'room text matches one inactive resource; operator review recommended before apply';
    if (category === 'already_assigned') return 'row already has room_resource_id';
    if (category === 'assigned_unknown_resource') return 'row has room_resource_id that is not present in current room catalog';
    if (category === 'ambiguous_name_or_alias') return 'room text matches multiple resources';
    if (category === 'mojibake') return 'room text is corrupt or placeholder characters';
    if (category === 'empty') return 'room text is empty';
    return 'room text has no deterministic catalog evidence';
}

function proposedActionForItem(item = {}) {
    if (item.category === 'already_assigned') return 'NO_OP';
    if (SAFE_CATEGORIES.has(item.category) && item.resourceId) return 'SET_ROOM_RESOURCE_ID';
    return 'BLOCK_OPERATOR_DECISION_REQUIRED';
}

function reportFingerprint(report = {}) {
    return sha256({
        businessContext: report.businessContext || DEFAULT_BUSINESS_CONTEXT,
        plannedCatalogAliases: report.plannedCatalogAliases || [],
        tables: Object.fromEntries(Object.entries(report.tables || {}).map(([table, payload]) => [
            table,
            (payload.items || []).map(item => ({
                table: item.table,
                id: item.id,
                currentRoom: item.currentRoom || null,
                currentRoomResourceId: item.currentRoomResourceId || null,
                category: item.category,
                proposedRoomResourceId: item.resourceId || null
            }))
        ])),
        banquetBookingMismatches: report.banquetBookingMismatches || [],
        unresolvedTechnicalIds: report.unresolvedTechnicalIds || []
    });
}

async function buildBackfillReport(db, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const resources = await loadResources(db, businessContext);
    const knownResourceIds = new Set(resources.map(resource => String(resource.resource_id || resource.resourceId)));
    knownResourceIds.add('room-takeaway');
    const tables = {};
    const allItems = [];
    for (const table of TABLES) {
        const rows = await loadTableRows(db, table, businessContext);
        const items = rows.map(row => {
            const existingId = String(row.room_resource_id || '').trim();
            const classification = existingId
                ? {
                    category: knownResourceIds.has(existingId) ? 'already_assigned' : 'assigned_unknown_resource',
                    resourceId: existingId
                }
                : classifyRoomValue(row.room, resources);
            return {
                table: table.name,
                id: String(row.id),
                currentRoom: String(row.room || '').trim() || null,
                currentRoomResourceId: existingId || null,
                category: classification.category,
                resourceId: classification.resourceId,
                proposedRoomResourceId: classification.resourceId || null,
                evidenceSource: itemEvidence(classification.category),
                proposedAction: proposedActionForItem({
                    category: classification.category,
                    resourceId: classification.resourceId
                }),
                blocker: SAFE_CATEGORIES.has(classification.category) || classification.category === 'already_assigned'
                    ? null
                    : classification.category
            };
        });
        tables[table.name] = { summary: summarizeItems(items), items };
        allItems.push(...items);
    }
    const mismatchResult = await db.query(
        `SELECT bg.id AS banquet_group_id,
                bg.primary_booking_id
           FROM banquet_groups bg
           JOIN bookings b
             ON b.id = bg.primary_booking_id
            AND COALESCE(NULLIF(BTRIM(b.business_context), ''), $1) = $1
          WHERE COALESCE(NULLIF(BTRIM(bg.business_context), ''), $1) = $1
            AND (
                NULLIF(BTRIM(bg.room_resource_id), '') IS DISTINCT FROM NULLIF(BTRIM(b.room_resource_id), '')
                OR (
                    bg.room_resource_id IS NULL
                    AND b.room_resource_id IS NULL
                    AND NULLIF(BTRIM(bg.room), '') IS DISTINCT FROM NULLIF(BTRIM(b.room), '')
                )
            )
          ORDER BY bg.id`,
        [businessContext]
    );
    return {
        mode: 'dry-run',
        readOnly: true,
        piiIncluded: false,
        businessContext,
        resourceCount: resources.length,
        plannedCatalogAliases: resources
            .filter(resource => resource.aliasesToAdd.length)
            .map(resource => ({
                resourceId: String(resource.resource_id || resource.resourceId),
                aliasesToAdd: resource.aliasesToAdd,
                aliases: metadataAliases(resource)
            })),
        summary: summarizeItems(allItems),
        tables,
        banquetBookingMismatches: (mismatchResult.rows || []).map(row => ({
            banquetGroupId: String(row.banquet_group_id),
            primaryBookingId: String(row.primary_booking_id)
        })),
        unresolvedTechnicalIds: allItems
            .filter(item => !SAFE_CATEGORIES.has(item.category) && item.category !== 'already_assigned')
            .map(({ table, id, category }) => ({ table, id, category }))
    };
}

async function buildBackfillManifest(db, businessContext = DEFAULT_BUSINESS_CONTEXT, options = {}) {
    const first = await buildBackfillReport(db, businessContext);
    const second = await buildBackfillReport(db, businessContext);
    const beforeFingerprint = reportFingerprint(first);
    const afterFingerprint = reportFingerprint(second);
    const mutationItems = Object.values(second.tables || {})
        .flatMap(table => table.items || [])
        .map(item => ({
            table: item.table,
            id: item.id,
            currentRoom: item.currentRoom,
            currentRoomResourceId: item.currentRoomResourceId,
            proposedRoomResourceId: item.proposedRoomResourceId,
            category: item.category,
            evidenceSource: item.evidenceSource,
            proposedAction: item.proposedAction,
            blocker: item.blocker
        }));
    const manifest = {
        schemaVersion: 1,
        kind: 'room_identity_backfill_quarantine_manifest',
        mode: 'dry-run',
        readOnly: true,
        piiIncluded: false,
        generatedAt: options.generatedAt || new Date().toISOString(),
        sourceCommit: options.sourceCommit || null,
        businessContext,
        policy: {
            doNotInventRoomIds: true,
            constraintsRemainNotValid: true,
            productionApplyRequiresExactOwnerApproval: true
        },
        zeroMutationProof: {
            beforeFingerprint,
            afterFingerprint,
            unchanged: beforeFingerprint === afterFingerprint
        },
        summary: second.summary,
        plannedCatalogAliases: second.plannedCatalogAliases || [],
        proposedMutations: mutationItems.filter(item => item.proposedAction !== 'NO_OP'),
        alreadyAssigned: mutationItems.filter(item => item.proposedAction === 'NO_OP').map(({ table, id, currentRoomResourceId }) => ({
            table,
            id,
            currentRoomResourceId
        })),
        banquetBookingMismatches: second.banquetBookingMismatches || [],
        blockers: [
            ...mutationItems
                .filter(item => item.proposedAction === 'BLOCK_OPERATOR_DECISION_REQUIRED')
                .map(({ table, id, category, evidenceSource }) => ({ table, id, category, evidenceSource })),
            ...((second.banquetBookingMismatches || []).map(item => ({
                table: 'banquet_groups',
                id: item.banquetGroupId,
                category: 'group_primary_room_mismatch',
                evidenceSource: `primary booking ${item.primaryBookingId} does not match group room identity`
            })))
        ]
    };
    return {
        ...manifest,
        manifestHash: sha256(manifest)
    };
}

async function applyBackfill(db, report, options = {}) {
    if (options.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
    }
    const safeItems = Object.values(report.tables)
        .flatMap(table => table.items)
        .filter(item => SAFE_CATEGORIES.has(item.category) && item.resourceId);
    if (!Number.isInteger(options.expectedSafe) || options.expectedSafe !== safeItems.length) {
        throw new Error(`Apply requires --expected-safe=${safeItems.length} from the immediately preceding dry-run`);
    }

    const reuseClient = options.reuseClient === true
        || Boolean(db && typeof db.query === 'function' && typeof db.release === 'function');
    const client = !reuseClient && typeof db.connect === 'function' ? await db.connect() : db;
    const updated = {};
    try {
        if (!reuseClient) await client.query('BEGIN');
        for (const resource of report.plannedCatalogAliases || []) {
            await client.query(
                `UPDATE timeline_resources
                    SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{aliases}',
                        $3::jsonb,
                        TRUE
                    ),
                        updated_at = NOW()
                  WHERE business_context = $1
                    AND type = 'room'
                    AND resource_id = $2`,
                [report.businessContext, resource.resourceId, JSON.stringify(resource.aliases)]
            );
        }
        for (const table of TABLES) {
            const items = safeItems.filter(item => item.table === table.name);
            updated[table.name] = 0;
            for (const item of items) {
                const contextClause = table.context
                    ? ` AND COALESCE(NULLIF(BTRIM(business_context), ''), $3) = $3`
                    : '';
                const params = table.context
                    ? [item.resourceId, item.id, report.businessContext]
                    : [item.resourceId, item.id];
                const result = await client.query(
                    `UPDATE ${table.name}
                        SET room_resource_id = $1
                      WHERE id = $2
                        AND room_resource_id IS NULL${contextClause}`,
                    params
                );
                updated[table.name] += result.rowCount || 0;
            }
        }
        if (!reuseClient) await client.query('COMMIT');
        return {
            mode: 'apply',
            piiIncluded: false,
            expectedSafe: safeItems.length,
            catalogAliasesUpdated: (report.plannedCatalogAliases || []).length,
            updated,
            updatedTotal: Object.values(updated).reduce((sum, count) => sum + count, 0)
        };
    } catch (error) {
        if (!reuseClient) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        throw error;
    } finally {
        if (!reuseClient && client !== db && typeof client.release === 'function') client.release();
    }
}

function printReport(report) {
    console.log(`Room resource ID ${report.mode} (PII: no)`);
    console.log(`Business context: ${report.businessContext || DEFAULT_BUSINESS_CONTEXT}`);
    console.log(`Resources: ${report.resourceCount ?? '-'}`);
    console.log(`Catalog alias resources: ${(report.plannedCatalogAliases || []).length}`);
    console.log(`Scanned: ${report.summary?.scanned ?? '-'}`);
    console.log(`Already assigned: ${report.summary?.alreadyAssigned ?? '-'}`);
    console.log(`Safe backfill: ${report.summary?.safeBackfill ?? '-'}`);
    console.log(`Unresolved: ${report.summary?.unresolved ?? '-'}`);
    for (const [table, payload] of Object.entries(report.tables || {})) {
        console.log(`${table}: ${JSON.stringify(payload.summary)}`);
    }
    console.log(`Banquet/booking mismatches: ${(report.banquetBookingMismatches || []).length}`);
    for (const item of report.unresolvedTechnicalIds || []) {
        console.log(`unresolved table=${item.table} id=${item.id} category=${item.category}`);
    }
}

async function main(argv = process.argv.slice(2)) {
    loadEnvFile();
    if (
        process.env.DATABASE_PUBLIC_URL
        && (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('.railway.internal'))
    ) {
        process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
    }
    const options = parseArgs(argv);
    const { pool } = require('../db');
    try {
        const report = await buildBackfillReport(pool, options.businessContext);
        if (options.manifest && !options.apply) {
            const manifest = await buildBackfillManifest(pool, options.businessContext, {
                sourceCommit: options.sourceCommit
            });
            console.log(JSON.stringify(manifest, null, 2));
        } else if (options.apply) {
            const result = await applyBackfill(pool, report, options);
            if (options.json) console.log(JSON.stringify({ dryRun: report, apply: result }, null, 2));
            else {
                printReport(report);
                console.log(`Applied: ${JSON.stringify(result)}`);
            }
        } else if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            printReport(report);
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Room resource ID backfill failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    APPLY_CONFIRMATION,
    LEGACY_ROOM_ALIASES,
    SAFE_CATEGORIES,
    TABLES,
    parseArgs,
    classifyRoomValue,
    summarizeItems,
    buildBackfillReport,
    buildBackfillManifest,
    reportFingerprint,
    applyBackfill
};
