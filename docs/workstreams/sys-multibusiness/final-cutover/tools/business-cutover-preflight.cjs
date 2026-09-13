'use strict';

// Operator evidence only. No app startup, migration, owner inference or apply mode.
const { allowedBusinessContextsForUser, resolveBusinessContextPolicy, normalizeBusinessContext,
    businessModulesForContext } = require('../../../../../services/businessContext');
const { businessModuleCatalog } = require('../../../../../services/businessModuleRegistry');
const { poolConfig: ownershipPoolConfig } = require('../../../../../scripts/audit-multibusiness-ownership');

const CONTEXTS = Object.freeze(['maysternya_doli', 'crm']);
const LIMITS = Object.freeze({ users: 10000, accessRowBytes: 16384, accessTotalBytes: 8388608,
    totalMs: 60000, statementMs: 10000, lockMs: 1000 });
const DOMAINS = Object.freeze([
    'bookings', 'customers', 'leads', 'lead_customer_links', 'tasks', 'products', 'timeline_resources',
    'finance_transactions', 'finance_accounts', 'finance_categories', 'warehouse_stock', 'warehouse_locations',
    'warehouse_history', 'warehouse_stock_movements', 'graduation_settings', 'graduation_services',
    'graduation_packages', 'graduation_package_items', 'graduation_quotes', 'graduation_child_packs',
    'graduation_children', 'graduation_diploma_templates', 'graduation_diploma_exports', 'graduation_automation_state'
]);
// Historically global roots are counted only for mapping review. A count never
// assigns a business owner from a label, token, filename, role or row order.
const LEGACY_ROOTS = Object.freeze([
    'catalog_definitions', 'catalog_subcategories', 'catalog_items', 'catalog_pages', 'catalog_automations',
    'catalog_page_history', 'booking_templates', 'recurring_templates', 'recurring_booking_skips',
    'catalog_image_blobs', 'hermes_jobs'
]);
const ACCESS_FIELDS = Object.freeze(['id', 'role', 'extra_roles', 'page_allowlist', 'page_denylist',
    'action_allowlist', 'action_denylist', 'business_contexts', 'default_business_context', 'is_active']);
const TABLES = Object.freeze([...DOMAINS, ...LEGACY_ROOTS, 'users', 'organizations', 'businesses',
    'business_memberships', 'organization_memberships', 'schema_migrations', 'settings']);
const EDGES = Object.freeze([
    ['booking_product', 'bookings', 'program_id', 'products', 'id'],
    ['lead_product', 'leads', 'program_id', 'products', 'id'],
    ['booking_customer', 'bookings', 'customer_id', 'customers', 'id'],
    ['customer_lead', 'customers', 'lead_id', 'leads', 'id'],
    ['lead_booking', 'leads', 'booking_id', 'bookings', 'id'],
    ['lead_link_lead', 'lead_customer_links', 'lead_id', 'leads', 'id'],
    ['lead_link_customer', 'lead_customer_links', 'customer_id', 'customers', 'id']
]);

function auditError(code) { return Object.assign(new Error(code), { code }); }
function numericCounts(row) {
    if (!row) throw auditError('AUDIT_MISSING_COUNTS');
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
        const count = Number(value);
        if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(count)) throw auditError('AUDIT_INVALID_COUNT');
        return [key, count];
    }));
}
function validateContext(context) {
    if (!CONTEXTS.includes(context)) throw auditError('AUDIT_SINGLE_CONTEXT_REQUIRED');
    return context;
}
function parseArgs(argv) {
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
    if (argv.length !== 2 || argv[0] !== '--context') throw auditError('AUDIT_SINGLE_CONTEXT_REQUIRED');
    return { context: validateContext(argv[1]) };
}
function poolConfig(env) {
    return { ...ownershipPoolConfig(env), application_name: 'eventgenix-business-cutover-readonly-preflight',
        statement_timeout: LIMITS.statementMs, query_timeout: LIMITS.statementMs + 1000 };
}
function table(name) {
    if (!TABLES.includes(name)) throw auditError('AUDIT_TABLE_NOT_ALLOWED');
    return `public."${name}"`;
}
function cohortCounts(users, context) {
    validateContext(context);
    const counts = { activeUsersExamined: users.length, legacyPotentialCohortUsers: 0,
        explicitAssignmentUsers: 0, unassignedRoleFallbackUsers: 0, legacyDefaultSelectsBusinessUsers: 0,
        globalExplicitDefaultOutsideLegacyAllowedUsers: 0, aliasAssignmentUsers: 0, aliasDefaultUsers: 0,
        cohortWithExtraRolesUsers: 0, cohortWithAccessOverridesUsers: 0 };
    for (const user of users) {
        const assigned = Array.isArray(user.business_contexts) ? user.business_contexts : [];
        const normalized = assigned.map(normalizeBusinessContext);
        const allowed = allowedBusinessContextsForUser(user);
        const cohort = allowed.includes(context);
        counts.legacyPotentialCohortUsers += Number(cohort);
        counts.explicitAssignmentUsers += Number(normalized.includes(context));
        counts.unassignedRoleFallbackUsers += Number(cohort && assigned.length === 0);
        counts.legacyDefaultSelectsBusinessUsers += Number(resolveBusinessContextPolicy(user).defaultContext === context);
        counts.globalExplicitDefaultOutsideLegacyAllowedUsers += Number(Boolean(user.default_business_context)
            && !allowed.includes(normalizeBusinessContext(user.default_business_context)));
        counts.aliasAssignmentUsers += Number(assigned.some(key => key !== context && normalizeBusinessContext(key) === context));
        counts.aliasDefaultUsers += Number(Boolean(user.default_business_context) && user.default_business_context !== context
            && normalizeBusinessContext(user.default_business_context) === context);
        counts.cohortWithExtraRolesUsers += Number(cohort && (user.extra_roles || []).length > 0);
        counts.cohortWithAccessOverridesUsers += Number(cohort && ['page_allowlist', 'page_denylist', 'action_allowlist', 'action_denylist']
            .some(key => (user[key] || []).length > 0));
    }
    return counts;
}

async function runPreflight(pool, context) {
    validateContext(context);
    const started = Date.now();
    const client = await pool.connect();
    let inTransaction = false;
    let releaseError;
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), context,
        source: 'OPERATOR_SELECTED_DATABASE_NOT_INDEPENDENTLY_ATTESTED', status: 'HOLD_REVIEW_REQUIRED',
        readOnly: false, isolation: 'repeatable read', safeToApply: false, authorizationVerified: false,
        ownershipEstablished: false, collectionStatus: 'COMPLETE_FOR_DECLARED_SCOPE', collectionIssues: [], limits: LIMITS,
        registry: null, modules: null, memberships: null, defaults: null, legacyCohort: null, schema: null,
        cabinet: null, domains: {}, legacyRoots: {}, relationships: {},
        notCovered: ['complete_page_action_permission_equivalence', 'all_foreign_edges_and_embedded_json',
            'complete_dangling_owner_and_membership_inventory', 'source_deployment_attestation',
            'HR_payroll_certificates_Art_ownership', 'provider_and_public_token_bindings', 'job_retry_replay_ingress',
            'durable_compatibility_usage_telemetry', 'reviewed_entity_or_membership_mapping', 'live_access_denial_QA'],
        limitations: ['Legacy cohort uses the current pure global-role helper without membership overlay; it is potential legacy access, not a grant or current successful request count.',
            'NULL/empty owner counts are global unattributed observations; they are never assigned to the requested business.',
            'Missing MD product references can be intentional compatibility external codes; no product or owner is inferred.',
            'Module catalog status is a source declaration, not proof of route or integration containment.',
            'COMPLETE_FOR_DECLARED_SCOPE is collection completeness only. This tool cannot establish cutover readiness or zero compatibility usage.'] };
    function missing(reason) {
        report.collectionStatus = 'INCOMPLETE';
        if (!report.collectionIssues.includes(reason)) report.collectionIssues.push(reason);
        return { status: 'NOT_COLLECTED', reason, counts: null };
    }
    async function query(sql, params) {
        const remaining = LIMITS.totalMs - (Date.now() - started);
        if (remaining < 1) throw auditError('AUDIT_TOTAL_BUDGET_EXCEEDED');
        await client.query(`SET LOCAL statement_timeout = '${Math.min(LIMITS.statementMs, remaining)}ms'`);
        return client.query(sql, params);
    }
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        inTransaction = true;
        await client.query(`SET LOCAL statement_timeout = '${LIMITS.statementMs}ms'`);
        await client.query(`SET LOCAL lock_timeout = '${LIMITS.lockMs}ms'`);
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
        const readonly = await client.query('SHOW transaction_read_only');
        const isolation = await client.query('SHOW transaction_isolation');
        if (readonly.rows[0]?.transaction_read_only !== 'on' || isolation.rows[0]?.transaction_isolation !== 'repeatable read') {
            throw auditError('AUDIT_READONLY_SNAPSHOT_REQUIRED');
        }
        report.readOnly = true;
        const metadata = await query(`SELECT c.relname AS table_name, a.attname AS column_name, c.relrowsecurity AS rls,
            has_table_privilege(c.oid, 'SELECT') AND has_schema_privilege(n.oid, 'USAGE') AS can_select
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
            WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
              AND c.relname=ANY($1::text[])`, [TABLES]);
        const columns = new Map(TABLES.map(name => [name, new Set()]));
        const hidden = new Map();
        for (const row of metadata.rows) {
            columns.get(row.table_name)?.add(row.column_name);
            if (row.rls) hidden.set(row.table_name, 'ROW_LEVEL_SECURITY');
            else if (!row.can_select) hidden.set(row.table_name, 'SELECT_PERMISSION_REQUIRED');
        }
        let sequence = 0;
        async function observe(requirements, sql, params = [], convert = rows => numericCounts(rows[0])) {
            const blocked = requirements.find(([name]) => hidden.has(name));
            if (blocked) return missing(hidden.get(blocked[0]));
            if (!requirements.every(([name, ...fields]) => columns.get(name)?.size && fields.every(field => columns.get(name).has(field)))) {
                return missing('MISSING_SCHEMA');
            }
            if (Date.now() - started >= LIMITS.totalMs) return missing('TOTAL_BUDGET_EXCEEDED');
            const savepoint = `cutover_preflight_${++sequence}`;
            await client.query(`SAVEPOINT ${savepoint}`);
            try {
                const result = await query(sql, params);
                const counts = convert(result.rows);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                return { status: 'OBSERVED', counts };
            } catch (error) {
                await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                const reason = ({ '42501': 'SELECT_PERMISSION_REQUIRED', '42703': 'MISSING_SCHEMA', '42P01': 'MISSING_SCHEMA',
                    '57014': 'QUERY_TIMEOUT', '55P03': 'LOCK_TIMEOUT', AUDIT_TOTAL_BUDGET_EXCEEDED: 'TOTAL_BUDGET_EXCEEDED',
                    AUDIT_ACCESS_BUDGET_EXCEEDED: 'ACCESS_BUDGET_EXCEEDED', AUDIT_MODULE_BUDGET_EXCEEDED: 'MODULE_BUDGET_EXCEEDED',
                    AUDIT_DUPLICATE_REGISTRY: 'AMBIGUOUS_REGISTRY' })[error.code];
                if (!reason) throw error;
                return missing(reason);
            }
        }
        const registryReq = [['businesses', 'id', 'organization_id', 'context_key', 'status', 'access_mode'], ['organizations', 'id', 'status']];
        report.registry = await observe(registryReq, `SELECT COUNT(*) AS "businessRows",
            COUNT(*) FILTER (WHERE b.status='active') AS "activeBusinessRows",
            COUNT(*) FILTER (WHERE b.access_mode='compatibility') AS "compatibilityRows",
            COUNT(*) FILTER (WHERE b.access_mode='membership') AS "membershipRows",
            COUNT(*) FILTER (WHERE b.access_mode IS NULL OR b.access_mode NOT IN ('membership','compatibility')) AS "unknownModeRows",
            COUNT(*) FILTER (WHERE o.id IS NULL) AS "missingOrganizationRows",
            COUNT(*) FILTER (WHERE o.status='active') AS "activeOrganizationRows"
            FROM public.businesses b LEFT JOIN public.organizations o ON o.id=b.organization_id WHERE b.context_key=$1`, [context]);
        const catalog = businessModuleCatalog(context);
        report.modules = await observe([['businesses', 'context_key', 'modules']], `SELECT
            CASE WHEN octet_length(modules::text)<=$2 THEN modules ELSE NULL END AS modules,
            octet_length(modules::text)>$2 AS oversized FROM public.businesses
            WHERE context_key=$1 LIMIT 2`, [context, LIMITS.accessRowBytes], rows => {
            if (rows.length > 1) throw auditError('AUDIT_DUPLICATE_REGISTRY');
            if (rows.some(row => row.oversized)) throw auditError('AUDIT_MODULE_BUDGET_EXCEEDED');
            const known = new Set(catalog.map(module => module.key));
            const configured = rows.flatMap(row => Array.isArray(row.modules) ? row.modules : []);
            return { registryRowsObserved: rows.length, duplicateRegistryRows: Number(rows.length > 1),
                invalidModuleArrays: rows.filter(row => !Array.isArray(row.modules)).length,
                unknownConfiguredEntries: configured.filter(key => !known.has(key)).length,
                catalog: catalog.map(module => ({ key: module.key, declaredStatus: module.status,
                    canEnable: module.canEnable, configuredOccurrences: configured.filter(key => key === module.key).length,
                    legacyDefaultEnabled: businessModulesForContext(context).includes(module.key) })) };
        });
        const membershipReq = [...registryReq, ['users', 'id', 'is_active'],
            ['business_memberships', 'business_id', 'organization_id', 'user_id', 'is_active', 'is_default'],
            ['organization_memberships', 'organization_id', 'user_id', 'is_active', 'role']];
        report.memberships = await observe(membershipReq, `SELECT COUNT(*) AS "membershipRows",
            COUNT(*) FILTER (WHERE bm.is_active IS TRUE) AS "activeMembershipRows",
            COUNT(*) FILTER (WHERE u.id IS NULL OR u.is_active IS NOT TRUE) AS "missingOrInactiveUserRows",
            COUNT(*) FILTER (WHERE bm.organization_id IS DISTINCT FROM b.organization_id) AS "organizationMismatchRows",
            COUNT(*) FILTER (WHERE bm.is_active AND NOT EXISTS (SELECT 1 FROM public.organization_memberships om
                WHERE om.organization_id=b.organization_id AND om.user_id=bm.user_id AND om.is_active)) AS "activeWithoutOrganizationMembershipRows",
            COUNT(*) FILTER (WHERE bm.is_active AND (b.status IS DISTINCT FROM 'active' OR o.status IS DISTINCT FROM 'active')) AS "activeWithInactiveOwnerRows",
            COUNT(*) FILTER (WHERE bm.is_active AND bm.is_default) AS "activeDefaultRows"
            FROM public.business_memberships bm JOIN public.businesses b ON b.id=bm.business_id
            LEFT JOIN public.organizations o ON o.id=b.organization_id LEFT JOIN public.users u ON u.id=bm.user_id
            WHERE b.context_key=$1`, [context]);
        report.defaults = await observe(membershipReq, `WITH owners AS (SELECT organization_id FROM public.businesses WHERE context_key=$1),
            duplicates AS (SELECT bm.user_id,bm.organization_id FROM public.business_memberships bm
                WHERE bm.is_active AND bm.is_default AND bm.organization_id IN (SELECT organization_id FROM owners)
                GROUP BY bm.user_id,bm.organization_id HAVING COUNT(*)>1),
            missing_defaults AS (SELECT bm.user_id,bm.organization_id FROM public.business_memberships bm
                WHERE bm.is_active AND bm.organization_id IN (SELECT organization_id FROM owners)
                GROUP BY bm.user_id,bm.organization_id HAVING COUNT(*) FILTER (WHERE bm.is_default)=0)
            SELECT (SELECT COUNT(*) FROM duplicates) AS "duplicateDefaultUserOrganizations",
                (SELECT COUNT(*) FROM missing_defaults) AS "withoutDefaultUserOrganizations",
                (SELECT COUNT(*) FROM public.organization_memberships om JOIN public.organizations o ON o.id=om.organization_id
                  JOIN public.users u ON u.id=om.user_id WHERE om.organization_id IN (SELECT organization_id FROM owners)
                  AND om.is_active AND om.role='owner' AND u.is_active AND o.status='active') AS "activeOrganizationOwners"`, [context]);
        const fields = ACCESS_FIELDS.map(field => `"${field}"`).join(',');
        const budget = await observe([['users', ...ACCESS_FIELDS]], `SELECT COUNT(*) AS "activeUsers",
            COALESCE(SUM(octet_length(ROW(${fields})::text)),0) AS "accessTotalBytes",
            COALESCE(MAX(octet_length(ROW(${fields})::text)),0) AS "accessMaxRowBytes"
            FROM public.users WHERE is_active IS TRUE`);
        if (budget.status !== 'OBSERVED') report.legacyCohort = budget;
        else if (budget.counts.activeUsers > LIMITS.users || budget.counts.accessTotalBytes > LIMITS.accessTotalBytes
            || budget.counts.accessMaxRowBytes > LIMITS.accessRowBytes) report.legacyCohort = missing('ACCESS_BUDGET_EXCEEDED');
        else report.legacyCohort = await observe([['users', ...ACCESS_FIELDS]], `SELECT ${fields} FROM public.users
            WHERE is_active IS TRUE ORDER BY id LIMIT ${LIMITS.users + 1}`, [], users => {
            if (users.length > LIMITS.users) throw auditError('AUDIT_ACCESS_BUDGET_EXCEEDED');
            return cohortCounts(users, context);
        });
        report.schema = await observe([['schema_migrations', 'version']], `SELECT
            COUNT(*) FILTER (WHERE version='357_organizations_business_memberships') AS "membershipSchemaApplied",
            COUNT(*) FILTER (WHERE version='363_multibusiness_cutover_journal_telemetry') AS "cutoverJournalSchemaApplied"
            FROM public.schema_migrations`);
        report.cabinet = await observe([['settings', 'key', 'value']], `SELECT
            COUNT(*) FILTER (WHERE key=$1) AS "businessCabinetRows",
            COUNT(*) FILTER (WHERE key=$2) AS "timelineDisplayRows",
            COUNT(*) FILTER (WHERE key=$3) AS "timelineResourcesRows"
            FROM public.settings`, [`business_cabinet:${context}`, `timeline_display:${context}`, `timeline_resources:${context}`]);
        for (const name of DOMAINS) {
            report.domains[name] = await observe([[name, 'business_context']], `SELECT
                COUNT(*) FILTER (WHERE business_context=$1) AS "requestedBusinessRows",
                COUNT(*) FILTER (WHERE NULLIF(BTRIM(business_context),'') IS NULL) AS "globalUnattributedRows",
                COUNT(*) FILTER (WHERE business_context IS NOT NULL AND BTRIM(business_context)<>'' AND business_context<>$1) AS "otherContextRows"
                FROM ${table(name)}`, [context]);
        }
        for (const name of LEGACY_ROOTS) {
            report.legacyRoots[name] = await observe([[name]], `SELECT COUNT(*) AS "rows" FROM ${table(name)}`);
        }
        for (const [id, child, foreignKey, parent, primaryKey] of EDGES) {
            report.relationships[id] = await observe([[child, foreignKey, 'business_context'], [parent, primaryKey, 'business_context']], `SELECT
                COUNT(*) AS "linkedRows",
                COUNT(*) FILTER (WHERE p."${primaryKey}" IS NULL) AS "missingParentRows",
                COUNT(*) FILTER (WHERE p."${primaryKey}" IS NOT NULL AND NULLIF(BTRIM(p.business_context),'') IS NULL) AS "unattributedParentRows",
                COUNT(*) FILTER (WHERE NULLIF(BTRIM(p.business_context),'') IS NOT NULL AND p.business_context<>$1) AS "foreignContextParentRows"
                FROM ${table(child)} c LEFT JOIN ${table(parent)} p ON p."${primaryKey}"::text=c."${foreignKey}"::text
                WHERE c.business_context=$1 AND NULLIF(BTRIM(c."${foreignKey}"::text),'') IS NOT NULL`, [context]);
        }
        await client.query('ROLLBACK');
        inTransaction = false;
        report.rollbackVerified = true;
        const observations = [report.registry, report.modules, report.memberships, report.defaults, report.legacyCohort,
            report.schema, report.cabinet, ...Object.values(report.domains), ...Object.values(report.legacyRoots),
            ...Object.values(report.relationships)];
        report.coverage = { declaredObservations: observations.length,
            observed: observations.filter(value => value.status === 'OBSERVED').length,
            notCollected: observations.filter(value => value.status === 'NOT_COLLECTED').length,
            ownedTables: DOMAINS.length, legacyOwnershipRoots: LEGACY_ROOTS.length,
            foreignEdges: EDGES.length, fullCutoverInventoryCovered: false };
        return report;
    } catch (error) {
        if (inTransaction) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
        }
        throw error;
    } finally { client.release(releaseError); }
}

function safeFailure(error) {
    const known = new Set(['AUDIT_SINGLE_CONTEXT_REQUIRED', 'AUDIT_READONLY_CONNECTION_REQUIRED', 'AUDIT_INVALID_CONNECTION',
        'AUDIT_READONLY_SNAPSHOT_REQUIRED', 'AUDIT_TOTAL_BUDGET_EXCEEDED']);
    return { status: 'AUDIT_FAILED', code: known.has(error?.code) ? error.code : 'AUDIT_DATABASE_FAILED', safeToApply: false };
}
async function main(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write('Usage: node business-cutover-preflight.cjs --context maysternya_doli|crm\nSet MULTIBUSINESS_AUDIT_DATABASE_URL process-locally to an operator read-only connection. No DATABASE_URL fallback.\nJSON counts only; exit 0 means collection completed, never cutover approval. Inspect collectionStatus and notCovered.\n');
        return;
    }
    const config = poolConfig(env);
    const { Pool } = require('pg');
    const pool = new Pool(config);
    try { process.stdout.write(JSON.stringify(await runPreflight(pool, options.context), null, 2) + '\n'); }
    finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(JSON.stringify(safeFailure(error)) + '\n'); process.exitCode = 1; });
module.exports = { runPreflight, cohortCounts, parseArgs, poolConfig, safeFailure, table, CONTEXTS, TABLES, DOMAINS,
    LEGACY_ROOTS, EDGES, ACCESS_FIELDS, LIMITS };
