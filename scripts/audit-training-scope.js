#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

// Fixed identifiers only. Never accept a table, column, SQL fragment or URL in
// command arguments. Actor IDs are references, not evidence of business ownership.
const TABLES = [
    ['training_courses', [['id', 'id'], ['instructor_id', 'id'], ['is_active', 'boolean'],
        ['profession_seed', 'boolean', "source = 'hr_profession_seed'"]], { instructor_id: 'users.id' }],
    ['training_course_lectures', [['id', 'id'], ['course_id', 'id'], ['article_id', 'id'],
        ['checklist_item_id', 'id'], ['is_published', 'boolean'],
        ['resource_shape_valid', 'boolean', "resource_urls IS NULL OR jsonb_typeof(resource_urls) = 'array'"],
        ['resource_reference_count', 'count', "CASE WHEN jsonb_typeof(resource_urls) = 'array' THEN jsonb_array_length(resource_urls) ELSE 0 END"]],
    { course_id: 'training_courses.id', article_id: 'knowledge_base.id', checklist_item_id: 'hr_profession_checklist_items.id' }],
    ['training_course_enrollment', [['id', 'id'], ['course_id', 'id'], ['staff_id', 'id']],
        { course_id: 'training_courses.id', staff_id: 'unverified_legacy_actor_reference' }],
    ['knowledge_base', [['id', 'id'], ['created_by', 'id'], ['is_active', 'boolean']], { created_by: 'staff.id' }],
    ['knowledge_base_progress', [['id', 'id'], ['article_id', 'id'], ['staff_id', 'id']],
        { article_id: 'knowledge_base.id', staff_id: 'unverified_legacy_actor_reference' }],
    ['training_tests', [['id', 'id'], ['article_id', 'id'], ['is_active', 'boolean']], { article_id: 'knowledge_base.id' }],
    ['training_test_results', [['id', 'id'], ['test_id', 'id'], ['staff_id', 'id']],
        { test_id: 'training_tests.id', staff_id: 'unverified_legacy_actor_reference' }],
    ['training_badges', [['id', 'id'], ['staff_id', 'id']], { staff_id: 'unverified_legacy_actor_reference' }],
    ['training_assignments', [['id', 'id'], ['assigned_by', 'id'], ['assigned_to', 'ids', 'assigned_to[1:1000]'],
        ['target_reference_count', 'count', 'COALESCE(cardinality(assigned_to), 0)'],
        ['target_references_truncated', 'boolean', 'COALESCE(cardinality(assigned_to) > 1000, false)'], ['is_active', 'boolean']],
        { assigned_by: 'users.id', assigned_to: 'unverified_legacy_actor_references_empty_array_is_broadcast' }],
    ['training_submissions', [['id', 'id'], ['assignment_id', 'id'], ['staff_id', 'id'], ['reviewed_by', 'id']],
        { assignment_id: 'training_assignments.id', staff_id: 'unverified_legacy_actor_reference', reviewed_by: 'users.id' }],
    ['staff_training_inputs', [['id', 'id'], ['staff_id', 'id']], { staff_id: 'staff.id' }],
    ['training_materials', [['id', 'id'], ['source_input_id', 'id'], ['source_staff_id', 'id'], ['is_active', 'boolean']],
        { source_input_id: 'staff_training_inputs.id', source_staff_id: 'staff.id' }],
    ['training_prompts_sent', [['id', 'id'], ['staff_id', 'id']], { staff_id: 'staff.id' }],
    ['hr_professions', [['id', 'id'], ['is_active', 'boolean']], {}],
    ['hr_profession_checklist_items', [['id', 'id'], ['profession_id', 'id'], ['is_active', 'boolean']],
        { profession_id: 'hr_professions.id' }],
    ['hr_staff_profession_checklist_progress', [['id', 'id'], ['staff_id', 'id'], ['checklist_item_id', 'id']],
        { staff_id: 'staff.id', checklist_item_id: 'hr_profession_checklist_items.id' }],
    ['hr_profession_checklist_migration_issues', [['id', 'id'], ['progress_id', 'id'], ['resolved', 'boolean', 'resolved_at IS NOT NULL']],
        { progress_id: 'hr_staff_profession_checklist_progress.id' }]
];
const OWNERSHIP_COLUMNS = ['business_id', 'business_context', 'organization_id'];

function integer(value, nullable = false) {
    if (nullable && value === null) return null;
    if (value === null || value === undefined || value === '') throw new Error('Invalid inventory number');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Unsafe inventory number');
    return number;
}

function projectRow(row, fields) {
    return Object.fromEntries(fields.map(([key, type]) => {
        const value = row[key];
        if (type === 'boolean') {
            if (value !== null && typeof value !== 'boolean') throw new Error('Invalid inventory flag');
            return [key, value];
        }
        if (type === 'ids') {
            if (value !== null && !Array.isArray(value)) throw new Error('Invalid inventory references');
            return [key, value === null ? null : value.map(id => integer(id))];
        }
        return [key, integer(value, type === 'id' && key !== 'id')];
    }));
}

async function collectTrainingScopeInventory(db, { limit = 1000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid inventory row limit');
    const metadata = await db.query(`SELECT table_name,
        array_agg(column_name) FILTER (WHERE column_name = ANY($2::text[])) AS ownership_columns
        FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[]) GROUP BY table_name`, [TABLES.map(([name]) => name), OWNERSHIP_COLUMNS]);
    const columnsByTable = new Map(metadata.rows.map(row => [row.table_name, row.ownership_columns || []]));
    if (TABLES.some(([name]) => !columnsByTable.has(name))) throw new Error('Training inventory schema incomplete');
    const tables = [];
    for (const [name, fields, references] of TABLES) {
        const count = await db.query(`SELECT COUNT(*) AS row_count FROM "${name}"`);
        const selected = fields.map(([key, , expression]) => expression ? `${expression} AS "${key}"` : `"${key}"`).join(', ');
        const result = await db.query(`SELECT ${selected} FROM "${name}" ORDER BY id LIMIT $1`, [limit + 1]);
        tables.push({ table: name, rowCount: integer(count.rows[0].row_count),
            ownershipColumns: OWNERSHIP_COLUMNS.filter(column => columnsByTable.get(name).includes(column)),
            referenceSemantics: references, truncated: result.rows.length > limit,
            rows: result.rows.slice(0, limit).map(row => projectRow(row, fields)) });
    }
    return { readOnly: true, inferredOwnership: false, needsOwnerClassification: true,
        identityNamespaceVerified: false, rowLimitPerTable: limit,
        rowEnumerationComplete: tables.every(table => !table.truncated), referenceLimitPerRow: 1000,
        referenceEnumerationComplete: tables.every(table => !table.truncated
            && table.rows.every(row => !row.target_references_truncated)), tables,
        limitations: ['Structure and references only; no content, names, answers, scores, notes or URLs are returned.',
            'Actor references are not resolved to identities or businesses. Historical staff_id values require a separate namespace audit.',
            'Resource counts are not an exact attachment inventory. Truncated tables require a separately bounded follow-up inventory.',
            'Neither a profession seed, broadcast target nor an empty table establishes business ownership.'] };
}

async function runInventory(db, options) {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        await db.query("SET LOCAL statement_timeout = '30s'");
        await db.query("SET LOCAL lock_timeout = '3s'");
        const mode = await db.query("SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation");
        if (mode.rows[0]?.read_only !== 'on' || mode.rows[0]?.isolation !== 'repeatable read') {
            throw new Error('Read-only snapshot required');
        }
        return await collectTrainingScopeInventory(db, options);
    } finally { await db.query('ROLLBACK'); }
}

async function main() {
    const connectionString = process.env.ACCESS_AUDIT_DATABASE_URL;
    if (!connectionString) throw new Error('Dedicated audit connection required');
    const db = new Client({ connectionString, connectionTimeoutMillis: 10000,
        application_name: 'eventgenix_training_scope_readonly_audit' });
    await db.connect();
    try { process.stdout.write(JSON.stringify(await runInventory(db), null, 2) + '\n'); }
    finally { await db.end(); }
}

if (require.main === module) main().catch(() => {
    console.error('Read-only training inventory failed. Check the dedicated local connection and schema; no changes were applied.');
    process.exitCode = 1;
});

module.exports = { collectTrainingScopeInventory, runInventory };
