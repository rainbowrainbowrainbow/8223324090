'use strict';

// Operator-only export to an ACL-restricted local directory; never an apply input.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { Client } = require('pg');
const { inspect } = require('./sys-mb-audit-access.cjs');
const ROOT = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const CONTEXTS = ['maysternya_doli', 'crm'];
const ACCESS = ['id', 'name', 'role', 'extra_roles', 'page_allowlist', 'page_denylist',
    'action_allowlist', 'action_denylist', 'business_contexts', 'default_business_context', 'is_active'];

function livePolicy(commit) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('EXACT_SOURCE_REQUIRED');
    const source = execFileSync('git', ['show', `${commit}:services/businessContext.js`], { cwd: ROOT, encoding: 'utf8' });
    const mod = new Module(path.join(ROOT, 'services/businessContext.js'), module);
    mod.filename = path.join(ROOT, 'services/businessContext.js');
    mod.paths = module.paths;
    mod._compile(source, mod.filename);
    return { policy: mod.exports, hash: sha(source) };
}

function draftUsers(rows, policy) {
    return rows.filter(user => CONTEXTS.some(context => (user.business_contexts || []).includes(context)
        || policy.allowedBusinessContextsForUser(user).includes(context))).map(user => {
        const allowed = policy.allowedBusinessContextsForUser(user);
        return { userId: user.id, displayName: user.name, before: user,
            legacyPolicy: policy.resolveBusinessContextPolicy(user),
            currentMembershipAccess: 'NOT_COLLECTED',
            proposals: CONTEXTS.map(context => ({ businessContext: context,
                legacyPotentialAccess: allowed.includes(context),
                explicitlyAssigned: (user.business_contexts || []).includes(context),
                action: allowed.includes(context) ? 'PRESERVE_ONLY_AFTER_MEMBERSHIP_EQUIVALENCE' : 'DO_NOT_GRANT',
                organizationId: null, businessId: null, organizationRole: null,
                membershipRole: user.role === 'creator' ? null : user.role,
                roleDecision: user.role === 'creator' ? 'PLATFORM_CREATOR_MUST_NOT_BE_COPIED' : 'PRESERVE_PENDING_REVIEW',
                overrides: Object.fromEntries(ACCESS.filter(key => /list$|extra_roles/.test(key)).map(key => [key, user[key]])),
                defaultAction: 'PRESERVE_EXISTING_DEFAULT', approvalStatus: 'UNAPPROVED' })) };
    });
}

async function collect(client, policy, commit, policyHash) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SET LOCAL lock_timeout='1s'");
        const fields = ACCESS.map(key => `"${key}"`).join(',');
        const budget = (await client.query(`SELECT count(*)::int AS rows,
            coalesce(sum(octet_length(row(${fields})::text)),0)::int AS bytes
            FROM public.users WHERE is_active IS TRUE`)).rows[0];
        if (budget.rows > 10000 || budget.bytes > 8388608) throw Error('ACCESS_BUDGET_EXCEEDED');
        const users = (await client.query(`SELECT ${fields} FROM public.users WHERE is_active IS TRUE ORDER BY id LIMIT 10001`)).rows;
        const memberships = draftUsers(users, policy);
        // No token value, URL, job payload, customer content, price or finance amounts.
        const catalogs = (await client.query(`SELECT id,name,status,is_active,
            nullif(btrim(public_token),'') IS NOT NULL AS has_public_token,
            (SELECT count(*)::int FROM public.catalog_pages p WHERE p.catalog_id=d.id) AS pages
            FROM public.catalog_definitions d ORDER BY id LIMIT 1001`)).rows;
        if (catalogs.length > 1000) throw Error('CATALOG_BUDGET_EXCEEDED');
        const templates = {};
        for (const table of ['booking_templates', 'recurring_templates']) {
            const label = table === 'booking_templates' ? 'name' : 'product_name AS name';
            const rows = (await client.query(`SELECT id,${label},product_id,room_resource_id FROM public.${table} ORDER BY id LIMIT 1001`)).rows;
            if (rows.length > 1000) throw Error('TEMPLATE_BUDGET_EXCEEDED');
            templates[table] = rows.map(row => ({ ...row, proposedBusinessContext: null, ownershipStatus: 'UNRESOLVED' }));
        }
        const jobs = (await client.query(`SELECT business_context,job_type,status,count(*)::int AS rows
            FROM public.hermes_jobs GROUP BY business_context,job_type,status ORDER BY business_context,job_type,status LIMIT 1001`)).rows;
        if (jobs.length > 1000) throw Error('JOB_BUDGET_EXCEEDED');
        const ledger = (await client.query(`SELECT version,applied_at FROM public.schema_migrations
            WHERE version ~ '^(355|356|357|358|359|360|361|362|363|364)_' ORDER BY version`)).rows;
        const raw = { memberships, catalogs, templates, jobs, ledger };
        return { schemaVersion: 1, status: 'DRAFT_PARTIAL_UNAPPROVED_NOT_APPLICABLE', generatedAt: new Date().toISOString(),
            sourceCommit: commit, policyHash, sourceFingerprint: sha(JSON.stringify(raw)),
            registry: 'SELECT_PERMISSION_REQUIRED', businessOwner: null,
            ...raw, catalogs: catalogs.map(row => ({ ...row, proposedBusinessContext: null,
                ownershipStatus: 'UNRESOLVED', publicationProposal: row.has_public_token
                    ? 'KEEP_CURRENT_STATE_PENDING_OWNER_AND_CONSUMER_REVIEW' : 'PRIVATE_BY_DEFAULT_FOR_NEW_PUBLICATION' })) };
    } finally { await client.query('ROLLBACK'); }
}

async function main() {
    const destination = process.env.SYS_MB_PRIVATE_DIRECTORY;
    const base = path.resolve(process.env.USERPROFILE || '', '.eventgenix');
    if (!destination || !path.resolve(destination).startsWith(base + path.sep)
        || path.resolve(destination).startsWith(ROOT + path.sep)
        || fs.lstatSync(destination).isSymbolicLink()) throw Error('RESTRICTED_DIRECTORY_REQUIRED');
    // ACLs are prepared/verified by the local operator before invoking this tool.
    if (process.env.SYS_MB_PRIVATE_ACL_VERIFIED !== '1') throw Error('PRIVATE_ACL_REQUIRED');
    const source = process.env.MULTIBUSINESS_AUDIT_DATABASE_URL;
    if (!source) throw Error('VERIFIED_AUDIT_SOURCE_REQUIRED');
    const commit = process.env.SYS_MB_SOURCE_COMMIT;
    const { policy, hash } = livePolicy(commit);
    const client = new Client({ connectionString: source, connectionTimeoutMillis: 8000, query_timeout: 15000 });
    try {
        await client.connect();
        if (!(await inspect(client)).candidateForReview) throw Error('READ_ONLY_ROLE_REQUIRED');
        const draft = await collect(client, policy, commit, hash);
        const data = JSON.stringify(draft, null, 2) + '\n';
        fs.writeFileSync(path.join(destination, 'draft-mapping.json'), data, { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ status: draft.status, generatedAt: draft.generatedAt, sourceCommit: commit,
            policyHash: hash, mappingHash: sha(data), sourceFingerprint: draft.sourceFingerprint,
            accounts: draft.memberships.length, proposedMembershipRows: draft.memberships.length * CONTEXTS.length,
            catalogs: draft.catalogs.length, templates: Object.fromEntries(Object.entries(draft.templates).map(([k,v]) => [k,v.length])),
            jobs: draft.jobs, ledger: draft.ledger,
            accessMatrix: CONTEXTS.map(context => ({ context,
                potential: draft.memberships.filter(m => m.proposals.find(p => p.businessContext === context).legacyPotentialAccess).length,
                assignedButNotAllowed: draft.memberships.filter(m => { const p=m.proposals.find(p=>p.businessContext===context); return p.explicitlyAssigned&&!p.legacyPotentialAccess; }).length,
                creatorRoleRequiresDecision: draft.memberships.filter(m=>m.before.role==='creator').length })) }));
    } finally { await client.end().catch(() => {}); }
}
module.exports = { draftUsers, livePolicy, collect };
if (require.main === module) main().catch(() => { console.error('DRAFT_EXPORT_FAILED_NO_SENSITIVE_DETAILS'); process.exitCode = 1; });
