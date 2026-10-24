#!/usr/bin/env node
'use strict';

// Render a private SQL review artifact. This tool never opens a database connection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TABLES, ORDER, preparePlan } = require('./prepare-park-hr-ownership-backfill.cjs');
const identifier = name => {
    if (!/^[a-z_]+$/.test(name)) throw new Error('INVALID_REVIEW_IDENTIFIER');
    return '"' + name + '"';
};
const literal = value => {
    const text = JSON.stringify(value);
    const tag = '$hr_review_' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) + '$';
    if (text.includes(tag)) throw new Error('REVIEW_LITERAL_COLLISION');
    return tag + text + tag + '::jsonb';
};

function renderReviewSql(input) {
    const plan = preparePlan({ atUtc: input.inventoryAtUtc, tables: input.tables }, input.owner);
    const target = plan.owner;
    const bodyTag = '$hr_block_' + crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16) + '$';
    if (JSON.stringify(plan).includes(bodyTag)) throw new Error('REVIEW_BLOCK_COLLISION');
    const safeColumns = new Set(['id', 'key', 'profession_id', 'profession_key', 'staff_id', 'checklist_item_id', 'template_id', 'structure_node_id', 'is_active']);
    for (const entry of Object.values(plan.tables)) {
        if (entry.columns.some(column => !safeColumns.has(column)) || new Set(entry.columns).size !== entry.columns.length) throw new Error('REVIEW_STRUCTURAL_COLUMNS_ONLY');
    }
    const lines = [
        '-- PRIVATE REVIEW ONLY: contains structural keys and registry identity; keep outside Git.',
        '-- Requires separately reviewed migration 387 and a real writer handoff.',
        '-- This rehearsal always ROLLBACKs. It is not a production apply or rollback command.',
        'BEGIN;',
        "SET LOCAL lock_timeout='5s';",
        "SET LOCAL statement_timeout='30s';",
        "SELECT pg_advisory_xact_lock(hashtext('park-hr-ownership-v1'));",
        'LOCK TABLE ' + TABLES.map(name => 'public.' + identifier(name)).join(', ') + ' IN SHARE ROW EXCLUSIVE MODE;',
        'DO ' + bodyTag + ' DECLARE expected_count bigint; actual_count bigint; BEGIN',
        'IF NOT EXISTS (SELECT 1 FROM public.businesses b JOIN public.organizations o ON o.id=b.organization_id',
        'WHERE b.id=' + target.businessId + ' AND b.organization_id=' + target.organizationId,
        "AND b.context_key='event_genix' AND b.status='active' AND o.status='active') THEN",
        "RAISE EXCEPTION 'HR_OWNER_REGISTRY_MISMATCH'; END IF;"
    ];
    for (const name of TABLES) {
        const entry = plan.tables[name];
        const table = 'public.' + identifier(name);
        const columns = entry.columns.map(identifier).join(', ');
        const expected = 'SELECT ' + columns + ' FROM jsonb_populate_recordset(NULL::' + table + ', ' + literal(entry.rows) + ')';
        const current = 'SELECT ' + columns + ' FROM ' + table;
        lines.push('IF EXISTS ((' + current + ') EXCEPT (' + expected + ')) OR EXISTS ((' + expected + ') EXCEPT (' + current + ')) THEN',
            "RAISE EXCEPTION 'HR_OWNER_INVENTORY_DRIFT'; END IF;",
            'IF EXISTS (SELECT 1 FROM ' + table + ' WHERE NOT ((business_id IS NULL AND organization_id IS NULL)',
            'OR (business_id IS NOT DISTINCT FROM ' + target.businessId + ' AND organization_id IS NOT DISTINCT FROM ' + target.organizationId + '))) THEN',
            "RAISE EXCEPTION 'HR_OWNER_FOREIGN_OR_AMBIGUOUS_ROW'; END IF;");
    }
    for (const name of ORDER) {
        const table = 'public.' + identifier(name);
        const ids = plan.tables[name].ids.map(id => id + '::bigint').join(', ') || 'NULL::bigint';
        lines.push('SELECT count(*) INTO expected_count FROM ' + table + ' WHERE business_id IS NULL AND organization_id IS NULL;',
            'UPDATE ' + table + ' SET business_id=' + target.businessId + ', organization_id=' + target.organizationId,
            'WHERE id IN (' + ids + ') AND business_id IS NULL AND organization_id IS NULL;',
            'GET DIAGNOSTICS actual_count = ROW_COUNT;',
            "IF actual_count <> expected_count THEN RAISE EXCEPTION 'HR_OWNER_UPDATE_COUNT_MISMATCH'; END IF;",
            'IF EXISTS (SELECT 1 FROM ' + table + ' WHERE business_id IS DISTINCT FROM ' + target.businessId + ' OR organization_id IS DISTINCT FROM ' + target.organizationId + ') THEN',
            "RAISE EXCEPTION 'HR_OWNER_POSTCHECK_FAILED'; END IF;");
    }
    lines.push('END; ' + bodyTag + ';', '-- No COMMIT and no persistent receipt: review rehearsal only.', 'ROLLBACK;', '');
    return lines.join('\n');
}

function main(args) {
    if (args.length !== 4 || args[0] !== '--plan' || args[2] !== '--out') throw new Error('EXPECTED_PRIVATE_PLAN_AND_OUTPUT');
    const requested = path.resolve(args[3]);
    const output = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
    const root = fs.realpathSync(path.resolve(__dirname, '..'));
    const relative = path.relative(root, output);
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('PRIVATE_REVIEW_MUST_STAY_OUTSIDE_GIT');
    const sql = renderReviewSql(JSON.parse(fs.readFileSync(args[1], 'utf8')));
    fs.writeFileSync(output, sql, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'PRIVATE_SQL_REVIEW_PREPARED_NOT_APPLIED', sha256: crypto.createHash('sha256').update(sql).digest('hex') }));
}
if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { renderReviewSql };