'use strict';

// Operator-only, counts-only evidence. No application startup, migration or owner inference.
const READONLY_ENV = 'MULTIBUSINESS_AUDIT_DATABASE_URL';
const TABLES = Object.freeze([
    'catalog_definitions', 'catalog_subcategories', 'catalog_items', 'catalog_settings',
    'catalog_pages', 'catalog_page_history', 'catalog_automations', 'trend_proposals',
    'catalog_image_blobs', 'booking_templates', 'recurring_templates', 'recurring_booking_skips',
    'bookings', 'products', 'timeline_resources', 'finance_transactions', 'staff', 'certificates',
    'payroll_reports', 'organizations', 'businesses'
]);
const OWNER_COLUMNS = ['organization_id', 'business_id', 'business_context', 'owner_business_context'];
const EDGES = [
    ['catalog_items_definition', 'catalog_items', 'catalog_id', 'catalog_definitions', 'id'],
    ['catalog_subcategories_definition', 'catalog_subcategories', 'catalog_id', 'catalog_definitions', 'id'],
    ['catalog_settings_definition', 'catalog_settings', 'catalog_id', 'catalog_definitions', 'id'],
    ['catalog_pages_definition', 'catalog_pages', 'catalog_id', 'catalog_definitions', 'id'],
    ['catalog_page_history_page', 'catalog_page_history', 'catalog_page_id', 'catalog_pages', 'id'],
    ['catalog_automations_definition', 'catalog_automations', 'catalog_id', 'catalog_definitions', 'id'],
    ['trend_proposals_definition', 'trend_proposals', 'catalog_id', 'catalog_definitions', 'id'],
    ['trend_proposals_item', 'trend_proposals', 'generated_item_id', 'catalog_items', 'id'],
    ['recurring_skips_template', 'recurring_booking_skips', 'template_id', 'recurring_templates', 'id'],
    ['finance_staff', 'finance_transactions', 'staff_id', 'staff', 'id'],
    ['finance_certificate', 'finance_transactions', 'certificate_id', 'certificates', 'id']
];

function auditError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

// Identifiers originate only from the constants above, never from CLI/DB values.
function table(name) {
    if (!TABLES.includes(name)) throw auditError('AUDIT_TABLE_NOT_ALLOWED');
    return `public."${name}"`;
}

function parseArgs(argv) {
    if (argv.length === 0) return { help: false };
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
    throw auditError('AUDIT_INVALID_ARGUMENTS');
}

function poolConfig(env) {
    const connectionString = env[READONLY_ENV];
    if (!connectionString) throw auditError('AUDIT_READONLY_CONNECTION_REQUIRED');
    let url;
    try { url = new URL(connectionString); } catch { throw auditError('AUDIT_INVALID_CONNECTION'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw auditError('AUDIT_INVALID_CONNECTION');
    }
    return { connectionString, max: 1, connectionTimeoutMillis: 5000,
        application_name: 'eventgenix-multibusiness-ownership-audit' };
}

function numericCounts(row) {
    if (!row) throw auditError('AUDIT_MISSING_COUNTS');
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
        if (!/^\d+$/.test(String(value))) throw auditError('AUDIT_INVALID_COUNT');
        const count = Number(value);
        if (!Number.isSafeInteger(count)) throw auditError('AUDIT_COUNT_OUT_OF_RANGE');
        return [key, count];
    }));
}

async function runOwnershipPreflight(pool) {
    const client = await pool.connect();
    let inTransaction = false;
    let releaseError;
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        inTransaction = true;
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
        const readonly = await client.query('SHOW transaction_read_only');
        const isolation = await client.query('SHOW transaction_isolation');
        if (readonly.rows[0]?.transaction_read_only !== 'on'
            || isolation.rows[0]?.transaction_isolation !== 'repeatable read') {
            throw auditError('AUDIT_READONLY_SNAPSHOT_REQUIRED');
        }
        const metadata = await client.query(`
            SELECT c.relname AS table_name, a.attname AS column_name, c.relrowsecurity AS row_security
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND a.attnum > 0 AND NOT a.attisdropped AND c.relname = ANY($1::text[])
        `, [TABLES]);
        const columns = new Map(TABLES.map(name => [name, new Set()]));
        const rowSecurityTables = new Set();
        for (const row of metadata.rows) {
            columns.get(row.table_name)?.add(row.column_name);
            if (columns.has(row.table_name) && row.row_security === true) rowSecurityTables.add(row.table_name);
        }
        const has = (name, ...required) => columns.get(name)?.size > 0
            && required.every(column => columns.get(name).has(column));
        const report = {
            schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'HOLD_OWNERSHIP_DECISIONS',
            readOnly: true, isolation: 'repeatable read', collectionStatus: 'COMPLETE', collectionIssues: [],
            safeToAutoBackfill: false, ownershipEstablished: false,
            scope: 'Legacy catalog, booking template, recurring and finance reference ownership evidence',
            tables: {}, relationships: {},
            limitations: [
                'Counts and existing owner columns are observations, not authorization or assignment proof.',
                'No creator username, product context, label or existing child chooses an owner.',
                'Missing schema is not checked; zero rows never authorizes a cutover.',
                'RLS-enabled tables and their dependent metrics are not checked, even for a role that could bypass RLS.',
                'Public links/assets, embedded catalog JSON references, external storage, jobs and API containment require source/consumer review.',
                'No staff/payroll allocation, formula, finance amount or production migration is evaluated.'
            ]
        };
        function incomplete(reason) {
            if (!report.collectionIssues.includes(reason)) report.collectionIssues.push(reason);
            report.collectionStatus = report.collectionIssues.includes('ROW_SECURITY') ? 'INCOMPLETE_VISIBILITY' : 'INCOMPLETE_SCHEMA';
        }
        async function observe(id, requirements, sql) {
            if (requirements.some(([name]) => rowSecurityTables.has(name))) {
                report.relationships[id] = { status: 'NOT_CHECKED_ROW_SECURITY', counts: null };
                incomplete('ROW_SECURITY');
                return;
            }
            if (!requirements.every(([name, ...required]) => has(name, ...required))) {
                report.relationships[id] = { status: 'NOT_CHECKED_MISSING_SCHEMA', counts: null };
                incomplete('MISSING_SCHEMA');
                return;
            }
            const result = await client.query(sql);
            report.relationships[id] = { status: 'OBSERVED', counts: numericCounts(result.rows[0]) };
        }
        // One pg client / one snapshot: deliberately sequential, with per-query timeouts.
        for (const name of TABLES) {
            if (!has(name)) {
                report.tables[name] = { status: 'NOT_CHECKED_MISSING_TABLE', totalRows: null,
                    ownershipColumns: [], missingOwnerRows: {} };
                incomplete('MISSING_SCHEMA');
                continue;
            }
            const ownerColumns = OWNER_COLUMNS.filter(column => has(name, column));
            if (rowSecurityTables.has(name)) {
                report.tables[name] = { status: 'NOT_CHECKED_ROW_SECURITY', totalRows: null,
                    ownershipColumns: ownerColumns, missingOwnerRows: {} };
                incomplete('ROW_SECURITY');
                continue;
            }
            const projection = ['COUNT(*) AS "totalRows"', ...ownerColumns.map(column =>
                `COUNT(*) FILTER (WHERE NULLIF(BTRIM("${column}"::text), '') IS NULL) AS "${column}"`)];
            const result = await client.query(`SELECT ${projection.join(', ')} FROM ${table(name)}`);
            const { totalRows, ...missingOwnerRows } = numericCounts(result.rows[0]);
            report.tables[name] = { status: 'OBSERVED', totalRows, ownershipColumns: ownerColumns, missingOwnerRows };
        }
        for (const [id, child, foreignKey, parent, primaryKey] of EDGES) {
            await observe(id, [[child, foreignKey], [parent, primaryKey]], `
                SELECT COUNT(*) FILTER (WHERE c."${foreignKey}" IS NOT NULL) AS "linkedRows",
                    COUNT(*) FILTER (WHERE c."${foreignKey}" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM ${table(parent)} p WHERE p."${primaryKey}" = c."${foreignKey}"
                    )) AS "orphanRows"
                FROM ${table(child)} c`);
        }
        for (const name of ['booking_templates', 'recurring_templates']) {
            const id = name === 'booking_templates' ? 'booking_template_products' : 'recurring_template_products';
            await observe(id, [[name, 'product_id'], ['products', 'id', 'business_context']], `
                SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.product_id), '') IS NULL) AS "missingProductRows",
                    COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.product_id), '') IS NOT NULL AND p.id IS NULL) AS "orphanProductRows",
                    COUNT(*) FILTER (WHERE p.id IS NOT NULL AND NULLIF(BTRIM(p.business_context), '') IS NULL) AS "productWithoutContextRows"
                FROM ${table(name)} t LEFT JOIN public.products p ON p.id = t.product_id`);
            await observe(`${name}_rooms`, [[name, 'id', 'room_resource_id'], ['timeline_resources', 'resource_id', 'business_context']], `
                WITH candidates AS (
                    SELECT t.id, t.room_resource_id, COUNT(r.resource_id) AS matches,
                        COUNT(DISTINCT NULLIF(BTRIM(r.business_context), '')) AS contexts,
                        BOOL_OR(r.resource_id IS NOT NULL AND NULLIF(BTRIM(r.business_context), '') IS NULL) AS unknown_context
                    FROM ${table(name)} t LEFT JOIN public.timeline_resources r ON r.resource_id = t.room_resource_id
                    GROUP BY t.id, t.room_resource_id
                )
                SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(room_resource_id), '') IS NULL) AS "missingRoomRows",
                    COUNT(*) FILTER (WHERE NULLIF(BTRIM(room_resource_id), '') IS NOT NULL AND matches = 0) AS "orphanRoomRows",
                    COUNT(*) FILTER (WHERE contexts > 1) AS "ambiguousContextRows",
                    COUNT(*) FILTER (WHERE unknown_context) AS "roomWithoutContextRows" FROM candidates`);
        }
        await observe('recurring_instances', [['bookings', 'recurring_template_id', 'business_context'], ['recurring_templates', 'id']], `
            WITH linked AS (
                SELECT recurring_template_id, NULLIF(BTRIM(business_context), '') AS context
                FROM public.bookings WHERE recurring_template_id IS NOT NULL
            ), series AS (
                SELECT recurring_template_id, COUNT(DISTINCT context) AS contexts,
                    BOOL_OR(context IS NULL) AS missing_context FROM linked GROUP BY recurring_template_id
            )
            SELECT (SELECT COUNT(*) FROM linked) AS "linkedRows",
                (SELECT COUNT(*) FROM linked b WHERE NOT EXISTS (
                    SELECT 1 FROM public.recurring_templates t WHERE t.id = b.recurring_template_id
                )) AS "orphanTemplateRows",
                (SELECT COUNT(*) FROM linked WHERE context IS NULL) AS "missingContextRows",
                (SELECT COUNT(*) FROM series WHERE contexts > 1) AS "mixedContextTemplates",
                (SELECT COUNT(*) FROM series WHERE missing_context) AS "templatesWithMissingContext"`);
        await observe('recurring_linked_children', [['bookings', 'id', 'linked_to', 'recurring_template_id', 'business_context']], `
            WITH links AS (
                SELECT p.id AS parent_id, NULLIF(BTRIM(c.business_context), '') AS child_context,
                    NULLIF(BTRIM(p.business_context), '') AS parent_context
                FROM public.bookings c LEFT JOIN public.bookings p ON p.id = c.linked_to
                WHERE NULLIF(BTRIM(c.linked_to), '') IS NOT NULL
                    AND (c.recurring_template_id IS NOT NULL OR p.recurring_template_id IS NOT NULL)
            )
            SELECT COUNT(*) AS "linkedRows",
                COUNT(*) FILTER (WHERE parent_id IS NULL) AS "orphanParentRows",
                COUNT(*) FILTER (WHERE parent_id IS NOT NULL AND child_context IS NOT NULL
                    AND parent_context IS NOT NULL AND child_context <> parent_context) AS "crossContextRows",
                COUNT(*) FILTER (WHERE child_context IS NULL OR parent_context IS NULL) AS "unknownContextRows" FROM links`);
        await observe('recurring_activity', [['recurring_templates', 'id', 'is_active'], ['bookings', 'recurring_template_id']], `
            SELECT COUNT(*) FILTER (WHERE t.is_active IS TRUE) AS "activeRows",
                COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.recurring_template_id = t.id)) AS "withoutInstanceRows"
            FROM public.recurring_templates t`);
        await observe('catalog_automation_flags', [['catalog_automations', 'is_active']], `
            SELECT COUNT(*) FILTER (WHERE is_active IS TRUE) AS "activeRows" FROM public.catalog_automations`);
        await observe('catalog_automatic_settings', [['catalog_settings', 'auto_enabled']], `
            SELECT COUNT(*) FILTER (WHERE auto_enabled IS TRUE) AS "autoEnabledRows" FROM public.catalog_settings`);
        for (const name of ['bookings', 'products', 'finance_transactions', 'timeline_resources']) {
            await observe(`${name}_registry_context`, [[name, 'business_context'], ['businesses', 'context_key']], `
                SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(r.business_context), '') IS NULL) AS "missingContextRows",
                    COUNT(*) FILTER (WHERE NULLIF(BTRIM(r.business_context), '') IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM public.businesses b WHERE b.context_key = r.business_context
                    )) AS "unregisteredContextRows"
                FROM ${table(name)} r`);
        }
        await observe('catalog_public_tokens', [['catalog_definitions', 'public_token']], `
            SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(public_token), '') IS NOT NULL) AS "rowsWithPublicToken"
            FROM public.catalog_definitions`);
        await client.query('ROLLBACK');
        inTransaction = false;
        return report;
    } catch (error) {
        if (inTransaction) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
        }
        throw error;
    } finally {
        client.release(releaseError);
    }
}

function safeFailure(error) {
    const known = new Set(['AUDIT_INVALID_ARGUMENTS', 'AUDIT_READONLY_CONNECTION_REQUIRED', 'AUDIT_INVALID_CONNECTION',
        'AUDIT_READONLY_SNAPSHOT_REQUIRED', 'AUDIT_COUNT_OUT_OF_RANGE', 'AUDIT_INVALID_COUNT', 'AUDIT_MISSING_COUNTS']);
    return { status: 'AUDIT_FAILED', code: known.has(error?.code) ? error.code : 'AUDIT_DATABASE_FAILED' };
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`Usage: node scripts/audit-multibusiness-ownership.js\n\nSet ${READONLY_ENV} process-locally to a read-only PostgreSQL connection.\nOutputs aggregate JSON only. No apply mode, no DATABASE_URL fallback, no automatic owner assignment.\nExit 0 means collection succeeded, not cutover approval; inspect status and collectionStatus.\n`);
        return;
    }
    const config = poolConfig(env);
    const { Pool } = require('pg');
    const pool = new Pool(config);
    try {
        const report = await runOwnershipPreflight(pool);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
        process.exitCode = 1;
    });
}

module.exports = { runOwnershipPreflight, parseArgs, poolConfig, safeFailure, main };
