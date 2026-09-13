'use strict';
// Offline analysis only: exact deployed pure policy + the private read-only snapshot.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const CONTEXTS = ['event_genix', 'dar', 'maysternya_doli', 'crm'];

function sourcePolicy(commit) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('EXACT_COMMIT_REQUIRED');
    const cache = new Map(), hashes = {};
    const allowed = new Set(['services/businessContext.js', 'services/businessMembership.js',
        'services/accountAccessPolicy.js', 'config/permissionRegistry.js']);
    function read(file) {
        const text = execFileSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, encoding: 'utf8' });
        hashes[file] = hash(text); return text;
    }
    function load(file) {
        if (!allowed.has(file)) throw Error('UNREVIEWED_POLICY_DEPENDENCY');
        if (cache.has(file)) return cache.get(file).exports;
        const mod = new Module(path.join(ROOT, file), module);
        mod.filename = path.join(ROOT, file);
        mod.require = name => load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.js');
        cache.set(file, mod); mod._compile(read(file), mod.filename); return mod.exports;
    }
    const context = load('services/businessContext.js');
    const membership = load('services/businessMembership.js');
    const capabilities = load('services/accountAccessPolicy.js');
    const auth = read('middleware/auth.js');
    const start = auth.indexOf('function buildAuthUserPayload(user) {');
    const end = auth.indexOf('\nfunction authSessionError(', start);
    if (start < 0 || end < start) throw Error('AUTH_SOURCE_BOUNDARY_CHANGED');
    const deps = { ...context, ...capabilities };
    const payload = new Function(...Object.keys(deps), `${auth.slice(start,end)};return buildAuthUserPayload;`)(...Object.values(deps));
    return { context, membership, capabilities, payload, hashes };
}

function joinedMemberships(snapshot, userId) {
    const rows = [];
    for (const om of snapshot.organization_memberships.filter(row => row.user_id === userId && row.is_active)) {
        const o = snapshot.organizations.find(row => row.id === om.organization_id && row.status === 'active');
        if (!o) continue;
        for (const bm of snapshot.business_memberships.filter(row => row.user_id === userId && row.is_active)) {
            const b = snapshot.businesses.find(row => row.id === bm.business_id
                && row.organization_id === om.organization_id && row.status === 'active');
            if (!b) continue;
            rows.push({ ...bm, organization_id: om.organization_id, organization_slug: o.slug,
                organization_name: o.name, organization_role: om.role, context_key: b.context_key,
                business_label: b.label, business_short_label: b.short_label, business_modules: b.modules,
                access_mode: b.access_mode });
        }
    }
    return rows.sort((a,b) => Number(b.is_default)-Number(a.is_default) || Number(a.business_id)-Number(b.business_id));
}

function analyze(snapshot, policy) {
    const accounts = [...new Map([...snapshot.users, ...snapshot.draft.memberships.map(row=>row.before)].map(user=>[user.id,user])).values()];
    const accessMatrix = [];
    for (const user of accounts.filter(u => u.is_active)) {
        const joined = joinedMemberships(snapshot, user.id);
        for (const context of CONTEXTS) {
            const before = policy.payload(user);
            const access = policy.membership.buildMembershipAccess(before, joined, context);
            const principal = policy.membership.applyMembershipAccess(before, access);
            const mask = policy.capabilities.buildCapabilitySnapshot(principal);
            const admitted = policy.context.canAccessBusinessContext(principal, context);
            accessMatrix.push({ userId: user.id, businessContext: context, membershipEnabled: access.membershipEnabled,
                contextAdmitted: admitted, role: principal.role, roles: principal.roles,
                activeMembership: access.activeMembership, defaultContext: policy.context.resolveBusinessContextPolicy(principal).defaultContext,
                pages: mask.pages, actions: mask.actions,
                scope: 'PURE_LIVE_POLICY_FROM_REAL_DB_SNAPSHOT_NOT_HTTP_OR_DOMAIN_QA' });
        }
    }
    const park = snapshot.businesses.find(row => row.context_key === 'event_genix');
    const dar = snapshot.businesses.find(row => row.context_key === 'dar');
    const organizationId = park && dar && park.organization_id === dar.organization_id ? park.organization_id : null;
    const proposals = snapshot.draft.memberships.map(row => {
        const before = row.before;
        const owner = snapshot.organization_memberships.find(om => om.user_id === before.id
            && om.organization_id === organizationId && om.is_active && om.role === 'owner');
        return { userId: row.userId, displayName: row.displayName, before,
            existingOrganizationMembership: snapshot.organization_memberships.find(om=>om.user_id===before.id&&om.organization_id===organizationId) || null,
            proposals: ['maysternya_doli','crm'].map(context => {
                const observed = accessMatrix.find(m=>m.userId===before.id&&m.businessContext===context);
                const proposedRole = !observed.contextAdmitted ? null : before.role !== 'creator' ? before.role : owner ? 'director' : null;
                const afterUser = { ...before, role: proposedRole, roles: proposedRole ? [proposedRole] : [], extra_roles: [] };
                const after = proposedRole ? policy.capabilities.buildCapabilitySnapshot(afterUser) : null;
                const diff = kind => after ? { added: Object.keys(after[kind]).filter(k=>after[kind][k]&&!observed[kind][k]),
                    removed: Object.keys(observed[kind]).filter(k=>observed[kind][k]&&!after[kind][k]) } : null;
                return { businessContext: context, businessRef: { kind: 'RESERVED_CONTEXT_PENDING_CREATION', contextKey: context },
                    organizationId, before: observed, proposedRole, extraRoles: [],
                    overrides: Object.fromEntries(['page_allowlist','page_denylist','action_allowlist','action_denylist'].map(key=>[key,before[key]])),
                    defaultAction: 'KEEP_CURRENT_PARK_DEFAULT', capabilityDiff: { pages: diff('pages'), actions: diff('actions') },
                    action: !observed.contextAdmitted ? 'NO_MEMBERSHIP_NO_EXPANSION' : proposedRole ? 'PROPOSE_MEMBERSHIP_PENDING_APPROVAL' : 'ACCOUNT_PURPOSE_AND_ROLE_DECISION_REQUIRED',
                    approvalStatus: 'UNAPPROVED' };
            }) };
    });
    const missingOrg = snapshot.business_memberships.filter(bm=>!snapshot.organization_memberships.some(om=>om.organization_id===bm.organization_id&&om.user_id===bm.user_id));
    const orphanBusiness = snapshot.business_memberships.filter(bm=>!snapshot.businesses.some(b=>b.id===bm.business_id&&b.organization_id===bm.organization_id));
    return { status: 'DRAFT_REVIEW_READY_NOT_APPROVED_FOR_APPLY', generatedAt: new Date().toISOString(),
        sourceCommit: snapshot.sourceCommit, sourceHashes: policy.hashes, snapshotHash: hash(JSON.stringify(snapshot)),
        organizations: snapshot.organizations, businesses: snapshot.businesses,
        owners: snapshot.organization_memberships.filter(row=>row.role==='owner').map(row=>({...row,displayName:accounts.find(u=>u.id===row.user_id)?.name})),
        registryIntegrity: { missingOrganizationMembership: missingOrg.length, orphanOrForeignBusinessMembership: orphanBusiness.length },
        proposedOrganizationId: organizationId, accessMatrix, proposals,
        catalogs: snapshot.draft.catalogs, templates: snapshot.draft.templates, jobs: snapshot.draft.jobs,
        limits: ['No live HTTP/JWT checks, demo/impersonation/QA leases, staff-scoped domain rules or provider calls.',
            'Capability masks do not replace route-specific or business-module admission.',
            'Creator-to-director removed capabilities require business approval and scoped MD delegation; no automatic downgrade or grant.'] };
}

if (require.main === module) {
    try {
        const dir = process.env.SYS_MB_PRIVATE_DIRECTORY;
        if (!dir || process.env.SYS_MB_PRIVATE_ACL_VERIFIED !== '1') throw Error('PRIVATE_DIRECTORY_REQUIRED');
        const snapshot = JSON.parse(fs.readFileSync(path.join(dir,'registry-snapshot.json'),'utf8'));
        const report = analyze(snapshot,sourcePolicy(snapshot.sourceCommit));
        fs.writeFileSync(path.join(dir,'reviewed-draft-mapping.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
        console.log(JSON.stringify({status:report.status,sourceCommit:report.sourceCommit,accessRows:report.accessMatrix.length,
            ownerCount:report.owners.length,registryIntegrity:report.registryIntegrity,
            accessCounts:CONTEXTS.map(context=>({context,admitted:report.accessMatrix.filter(m=>m.businessContext===context&&m.contextAdmitted).length})),
            roleProposalDiffs:report.proposals.flatMap(p=>p.proposals).filter(p=>p.proposedRole).map(p=>({context:p.businessContext,role:p.proposedRole,diff:p.capabilityDiff}))}));
    } catch { console.error('OFFLINE_REVIEW_FAILED_NO_SENSITIVE_DETAILS'); process.exitCode=1; }
}
module.exports={sourcePolicy,joinedMemberships,analyze};
