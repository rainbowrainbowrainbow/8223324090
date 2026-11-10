'use strict';

const { getReleaseMetadata } = require('./release');
const { isQaLeaseCandidate } = require('./qaCreatorLease');
const { canCreateParkStaff, hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { parkHrStaffCardEditCapability } = require('./parkHrStaffCardRead');
const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
const { resolveBusinessScope } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { SESSION_REVOCATION_CUTOFF_SQL } = require('./sessionRevocation');

const SOURCE = 'hr_fixture_qa';
const CONTEXT = 'event_genix';
const RUN_ID = /^hrqa-[0-9a-f]{12}$/;
const RESERVED_MARKER = /^hrqa-[0-9a-f]{12}-(?:staff|account)-[12]$/;
const TYPES = new Set(['hr_staff', 'hr_account', 'hr_profile', 'hr_membership']);
const ENDPOINTS = Object.freeze({
    create: 'POST /api/staff',
    edit: 'PUT /api/hr/staff/:id',
    onboard: 'POST /api/users/onboarding',
    link: 'POST /api/staff/:id/link',
    membership: 'PUT /api/organizations/:organizationId/members/:userId',
    revoke: 'DELETE /api/organizations/:organizationId/members/:userId/:businessId'
});
const MAX_ENTITIES = 7; // Two staff, two accounts, two profiles and one pair of memberships.
const registry = () => require('./trustedQaRuns');

function requireQa(condition, code, message, status = 403) {
    if (!condition) throw new (registry().TrustedQaRunError)(message, code, {}, status);
}

function activeReleaseSha() {
    const release = getReleaseMetadata();
    return release.deploymentMetadata.complete || process.env.NODE_ENV === 'test' ? release.commitSha : null;
}

function exactMarker(run, name, kind) {
    return [1, 2].some(slot => name === `${run.run_id}-${kind}-${slot}`);
}

async function loadOperator(client, userId, lock = true) {
    const result = await client.query(
        `SELECT u.id, u.name, u.username, u.is_active, u.role,
                EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.user_id=u.id AND ep.is_active) AS has_staff_profile
           FROM users u WHERE u.id=$1 ${lock ? 'FOR SHARE OF u' : ''}`, [userId]
    );
    const user = result.rows[0];
    requireQa(user?.is_active && !user.has_staff_profile && isQaLeaseCandidate(user),
        'HR_QA_OPERATOR_NOT_ISOLATED', 'An active isolated QA operator is required');
    return user;
}

function describeHrFixtureQaPlan(plan) {
    const { runId, ownerId, delegateId, releaseSha, ttlMinutes } = plan || {};
    const exactPlan = { runId, ownerId, delegateId, releaseSha, ttlMinutes };
    requireQa(plan && Object.keys(plan).every(key => Object.hasOwn(exactPlan, key))
        && typeof runId === 'string' && RUN_ID.test(runId) && [ownerId, delegateId].every(id => Number.isSafeInteger(id) && id > 0)
        && ownerId !== delegateId && /^[a-f0-9]{40}$/.test(releaseSha)
        && Number.isInteger(ttlMinutes) && ttlMinutes >= 1 && ttlMinutes <= 30,
    'HR_QA_PLAN_INVALID', 'The HR QA plan must contain exact operators, release and expiry', 400);
    return { plan: exactPlan, planHash: registry().sha256(JSON.stringify(exactPlan)) };
}

async function preflightHrFixtureQaPlan(client, rawPlan, { lock = false } = {}) {
    const description = describeHrFixtureQaPlan(rawPlan);
    const { runId, ownerId, delegateId } = description.plan;
    const checkOperator = async userId => {
        const user = await loadOperator(client, userId, lock);
        const access = await loadMembershipAccess(client, user, CONTEXT);
        return { user: applyMembershipAccess(user, access), headers: { 'x-business-context': CONTEXT }, path: '/staff/1' };
    };
    const owner = await checkOperator(ownerId);
    const delegate = await checkOperator(delegateId);
    const canViewHr = req => resolveCapability(req.user, '/hr', { type: 'page' }).allowed;
    requireQa(owner.user.organizationRole === 'owner'
        && owner.user.organizationId === delegate.user.organizationId
        && canViewHr(owner) && canViewHr(delegate)
        && canCreateParkStaff(owner) && parkHrStaffCardEditCapability(owner) === 'hr.staff.manage'
        && resolveCapability(owner.user, 'manage_accounts', { type: 'action' }).allowed
        && canCreateParkStaff(delegate) && parkHrStaffCardEditCapability(delegate) === 'hr.staff.profile.edit'
        && !resolveCapability(delegate.user, 'manage_accounts', { type: 'action' }).allowed
        && !resolveCapability(delegate.user, 'hr.payroll.view', { type: 'action' }).allowed,
    'HR_QA_OPERATOR_SCOPE_DENIED', 'The test operators must already have the scoped Park owner and delegate rights');
    const open = await client.query(
        `SELECT 1 FROM trusted_qa_runs WHERE source=$1 AND (run_id=$2 OR state IN ('active','cleanup_pending','blocked')) LIMIT 1`,
        [SOURCE, runId]
    );
    requireQa(!open.rowCount, 'HR_QA_RUN_ALREADY_OPEN', 'A prior HR QA run requires cleanup or this ID was already used', 409);
    return description;
}

async function createHrFixtureQaRun(client, plan, approvedHash) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('hr-fixture-qa-create',0))");
    const { planHash } = await preflightHrFixtureQaPlan(client, plan, { lock: true });
    requireQa(planHash === approvedHash,
        'HR_QA_PLAN_HASH_MISMATCH', 'Exact reviewed HR QA plan hash is required');
    const { runId, ownerId, delegateId, releaseSha, ttlMinutes } = plan;
    return registry().createTrustedQaRun(client, {
        runId, source: SOURCE, businessContext: CONTEXT, maxEntityCount: MAX_ENTITIES, ttlMinutes,
        operatorUserId: ownerId, requiredOperatorUserId: ownerId, requiredUserId: delegateId,
        testCustomerMarker: `${runId}:hr:${releaseSha}`, allowedEndpoints: Object.values(ENDPOINTS)
    });
}

async function finishHrFixtureQaRun(client, plan, approvedHash) {
    requireQa(describeHrFixtureQaPlan(plan).planHash === approvedHash,
        'HR_QA_PLAN_HASH_MISMATCH', 'Exact reviewed HR QA plan hash is required');
    const rows = await client.query(
        `SELECT id FROM trusted_qa_runs WHERE run_id=$1 AND source=$2 AND business_context=$3
          AND test_customer_marker=$4 AND operator_user_id=$5 AND required_user_id=$6 AND max_entity_count=$7
          AND expires_at=created_at+($8::int*INTERVAL '1 minute') FOR UPDATE`,
        [plan.runId, SOURCE, CONTEXT, `${plan.runId}:hr:${plan.releaseSha}`, plan.ownerId, plan.delegateId, MAX_ENTITIES, plan.ttlMinutes]
    );
    requireQa(rows.rowCount === 1, 'HR_QA_RUN_INVALID', 'This exact reviewed HR QA run was not found');
    return registry().cleanupTrustedQaRun(client, rows.rows[0].id, { forUpdate: true });
}

async function prepareHrFixtureQa(client, req, action, marker) {
    const token = registry().requestQaToken(req);
    if (!token && !RESERVED_MARKER.test(marker)) return null;
    const endpoint = ENDPOINTS[action];
    const run = token && token.length <= 512 && await registry().loadTrustedQaRun(client, token, CONTEXT);
    const sha = activeReleaseSha();
    requireQa(run?.source === SOURCE && RUN_ID.test(run.run_id) && Number(run.max_entity_count) === MAX_ENTITIES
        && sha && run.test_customer_marker === `${run.run_id}:hr:${sha}`,
    'HR_QA_RUN_INVALID', 'The HR QA token or release is invalid');
    requireQa(endpoint && registry().requestEndpointKey(req) === endpoint
        && registry().normalizeAllowedEndpoints(run.allowed_endpoints).includes(endpoint)
        && hasCurrentParkScheduleMembership(req) && resolveBusinessScope(req).canWrite === true,
    'HR_QA_SCOPE_DENIED', 'This action is outside the Park QA scope');
    const userId = Number(req.user?.id);
    const delegateAction = action === 'create' || action === 'edit';
    requireQa(userId === Number(run.operator_user_id) || (delegateAction && userId === Number(run.required_user_id)),
        'HR_QA_OPERATOR_MISMATCH', 'This operator is outside the HR QA run');
    await loadOperator(client, userId);
    const locked = await client.query(
        `SELECT state = 'active' AND expires_at > clock_timestamp()
                    AND expires_at <= created_at + INTERVAL '30 minutes' AS valid
           FROM trusted_qa_runs WHERE id=$1 FOR UPDATE`, [run.id]
    );
    requireQa(locked.rows[0]?.valid, 'HR_QA_RUN_INVALID', 'The HR QA run is closed or expired');
    return { trusted: true, run, endpoint, membership: req.user.activeBusinessMembership };
}

async function claimHrFixtureQa(client, qa, req) {
    if (qa) await registry().consumeTrustedQaToken(client, qa.run, req, qa.endpoint);
}

function assertHrFixtureCreate(qa, operation, name, kind) {
    if (!qa) return;
    requireQa(operation && exactMarker(qa.run, name, kind), 'HR_QA_MARKER_REQUIRED',
        'A reserved fixture marker and idempotency key are required');
}

async function requireHrQaEntity(client, qa, type, id) {
    if (!qa) return null;
    const found = await client.query(
        `SELECT payload FROM trusted_qa_run_entities
          WHERE run_id=$1 AND entity_type=$2 AND entity_id=$3 AND cleanup_state='active'`, [qa.run.id, type, String(id)]
    );
    const payload = found.rows[0]?.payload;
    requireQa(payload, 'HR_QA_ENTITY_NOT_OWNED', 'This fixture is not registered to the HR QA run');
    return payload;
}

async function registerHrQaEntity(client, qa, type, id, payload) {
    if (qa) await registry().registerQaEntity(client, qa, type, id, payload);
}

function assertHrQaOnboarding(qa, operation, normalized) {
    if (!qa) return;
    const { personal, access, staff, conditions, structureNodeId } = normalized;
    assertHrFixtureCreate(qa, operation, personal.username, 'account');
    assertHrFixtureCreate(qa, operation, personal.name, 'staff');
    requireQa(access.role === 'animator' && access.businessContexts.length === 1 && access.defaultBusinessContext === CONTEXT
        && [access.extraRoles, access.pageAllowlist, access.actionAllowlist, access.actionDenylist, conditions].every(list => !list.length)
        && normalized.professions.length === 1 && normalized.primaryProfessionKey === 'animator'
        && !staff.fallbackRateProvided && !staff.rateUnitProvided && !structureNodeId && !staff.distinctStaffIds.length,
    'HR_QA_ONBOARDING_SCOPE_DENIED', 'QA onboarding must use a basic Park test account');
}

async function prepareHrQaMembership(client, req, organizationId, businessId, userId, input) {
    const qa = await prepareHrFixtureQa(client, req, 'membership');
    if (!qa) return null;
    const account = await requireHrQaEntity(client, qa, 'hr_account', userId);
    requireQa(Number(qa.membership.organizationId) === organizationId && Number(qa.membership.businessId) === businessId
        && input.role === 'animator' && (!input.organizationRole || input.organizationRole === 'member')
        && ['extraRoles', 'pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist'].every(key => !input[key]?.length),
    'HR_QA_MEMBERSHIP_SCOPE_DENIED', 'QA membership is limited to a basic Park test account');
    const prior = await client.query(
        `SELECT 1 FROM trusted_qa_run_entities WHERE run_id=$1 AND entity_type='hr_membership'`, [qa.run.id]
    );
    const existing = await client.query(
        `SELECT 1 FROM business_memberships WHERE user_id=$1 UNION ALL
         SELECT 1 FROM organization_memberships WHERE user_id=$1`, [userId]
    );
    requireQa(!prior.rowCount && !existing.rowCount && account.username,
        'HR_QA_MEMBERSHIP_LIMIT', 'The HR QA run allows one new membership', 409);
    await claimHrFixtureQa(client, qa, req);
    return qa;
}

async function prepareHrQaRevocation(client, req, organizationId, businessId, userId) {
    const qa = await prepareHrFixtureQa(client, req, 'revoke');
    if (!qa) return;
    const owned = await requireHrQaEntity(client, qa, 'hr_membership', userId);
    requireQa(Number(owned.organizationId) === organizationId && Number(owned.businessId) === businessId
        && Number(qa.membership.businessId) === businessId && Number(qa.membership.organizationId) === organizationId,
    'HR_QA_MEMBERSHIP_SCOPE_DENIED', 'This membership is outside the Park QA run');
    await claimHrFixtureQa(client, qa, req);
}

function cleanupGuard(condition) {
    requireQa(condition, 'HR_QA_CLEANUP_DRIFT', 'HR QA cleanup stopped because fixture ownership or dependencies changed', 409);
}

async function cleanupHrFixtureQa(client, inventory) {
    const { run, entities } = inventory;
    cleanupGuard(run.source === SOURCE && RUN_ID.test(run.run_id) && run.business_context === CONTEXT
        && run.test_customer_marker?.startsWith(`${run.run_id}:hr:`)
        && /^[a-f0-9]{40}$/.test(run.test_customer_marker.slice(run.run_id.length + 4))
        && Number(run.max_entity_count) === MAX_ENTITIES && entities.length <= MAX_ENTITIES
        && entities.every(row => TYPES.has(row.entity_type) && /^[1-9]\d*$/.test(String(row.entity_id))));
    if (run.state === 'cleaned') {
        cleanupGuard(entities.every(row => row.cleanup_state === 'cleaned'));
        return { status: 'cleaned', state: 'cleaned', idempotent: true };
    }
    cleanupGuard(['active', 'cleanup_pending'].includes(run.state)
        && entities.every(row => ['active', 'cleanup_pending'].includes(row.cleanup_state)));
    const fixtures = type => new Map(entities.filter(row => row.entity_type === type)
        .map(row => [Number(row.entity_id), row.payload]));
    const staff = fixtures('hr_staff');
    const accounts = fixtures('hr_account');
    const profiles = fixtures('hr_profile');
    const memberships = fixtures('hr_membership');
    const ids = map => [...map.keys()];
    cleanupGuard(staff.size <= 2 && accounts.size <= 2 && profiles.size === accounts.size && memberships.size <= 1
        && [...accounts.keys()].every(id => ![Number(run.operator_user_id), Number(run.required_user_id)].includes(id)));

    const staffRows = await client.query('SELECT id, name FROM staff WHERE id=ANY($1::int[]) FOR UPDATE', [ids(staff)]);
    const userRows = await client.query('SELECT id, username, role FROM users WHERE id=ANY($1::int[]) FOR UPDATE', [ids(accounts)]);
    cleanupGuard(staffRows.rowCount === staff.size && staffRows.rows.every(row =>
        exactMarker(run, row.name, 'staff') && staff.get(row.id)?.name === row.name));
    cleanupGuard(userRows.rowCount === accounts.size && userRows.rows.every(row => row.role === 'animator'
        && exactMarker(run, row.username, 'account') && accounts.get(row.id)?.username === row.username));
    const links = await client.query(
        `SELECT id, staff_id, user_id FROM employee_profiles
          WHERE staff_id=ANY($1::int[]) OR user_id=ANY($2::int[]) OR id=ANY($3::int[]) FOR UPDATE`,
        [ids(staff), ids(accounts), ids(profiles)]
    );
    cleanupGuard(links.rowCount === profiles.size && links.rows.every(row => staff.has(row.staff_id) && accounts.has(row.user_id)
        && Number(profiles.get(row.id)?.staffId) === row.staff_id && Number(profiles.get(row.id)?.userId) === row.user_id));
    const businessRows = await client.query(
        'SELECT user_id, business_id, organization_id, role FROM business_memberships WHERE user_id=ANY($1::int[]) FOR UPDATE', [ids(accounts)]
    );
    const orgRows = await client.query(
        'SELECT user_id, organization_id, role FROM organization_memberships WHERE user_id=ANY($1::int[]) FOR UPDATE', [ids(accounts)]
    );
    cleanupGuard(businessRows.rowCount === memberships.size && businessRows.rows.every(row => row.role === 'animator'
        && accounts.has(row.user_id) && Number(row.business_id) === Number(memberships.get(row.user_id)?.businessId)
        && Number(row.organization_id) === Number(memberships.get(row.user_id)?.organizationId)));
    cleanupGuard(orgRows.rowCount === memberships.size && orgRows.rows.every(row => row.role === 'member'
        && Number(row.organization_id) === Number(memberships.get(row.user_id)?.organizationId)));
    const unexpected = await client.query(
        `SELECT EXISTS(SELECT 1 FROM chat_channel_members WHERE user_id=ANY($1::int[]))
             OR EXISTS(SELECT 1 FROM hr_shifts WHERE staff_id=ANY($2::int[]))
             OR EXISTS(SELECT 1 FROM hr_time_records WHERE staff_id=ANY($2::int[]))
             OR EXISTS(SELECT 1 FROM staff_schedule WHERE staff_id=ANY($2::int[]))
             OR EXISTS(SELECT 1 FROM payroll_reports WHERE staff_id=ANY($2::int[]))
             OR EXISTS(SELECT 1 FROM staff_documents WHERE staff_id=ANY($2::int[]))
             OR EXISTS(SELECT 1 FROM staff_resource_assignments WHERE staff_id=ANY($2::int[])) AS found`,
        [ids(accounts), ids(staff)]
    );
    cleanupGuard(unexpected.rows[0]?.found === false);

    for (const [userId, owned] of memberships) {
        await client.query(`UPDATE business_memberships SET is_active=false,is_default=false
            WHERE user_id=$1 AND organization_id=$2 AND business_id=$3`, [userId, owned.organizationId, owned.businessId]);
        await client.query('UPDATE organization_memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2',
            [userId, owned.organizationId]);
    }
    await client.query(`UPDATE users SET is_active=false, session_revoked_at=${SESSION_REVOCATION_CUTOFF_SQL}
        WHERE id=ANY($1::int[])`, [ids(accounts)]);
    for (const userId of ids(accounts)) await require('../middleware/auth').revokeAllUserTokens(userId, client);
    await client.query('UPDATE employee_profiles SET user_id=NULL,is_active=false WHERE id=ANY($1::int[])', [ids(profiles)]);
    await client.query("UPDATE staff_role_assignments SET status='inactive' WHERE staff_id=ANY($1::int[])", [ids(staff)]);
    await client.query("UPDATE staff SET is_active=false,hr_pool_status='reserve' WHERE id=ANY($1::int[])", [ids(staff)]);
    const residual = await client.query(
        `SELECT EXISTS(SELECT 1 FROM users WHERE id=ANY($1::int[]) AND is_active)
             OR EXISTS(SELECT 1 FROM refresh_tokens WHERE user_id=ANY($1::int[]) AND revoked_at IS NULL)
             OR EXISTS(SELECT 1 FROM business_memberships WHERE user_id=ANY($1::int[]) AND is_active)
             OR EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=ANY($1::int[]) AND is_active)
             OR EXISTS(SELECT 1 FROM employee_profiles WHERE id=ANY($2::int[]) AND (is_active OR user_id IS NOT NULL))
             OR EXISTS(SELECT 1 FROM staff WHERE id=ANY($3::int[]) AND is_active)
             OR EXISTS(SELECT 1 FROM staff_role_assignments WHERE staff_id=ANY($3::int[]) AND status='active') AS found`,
        [ids(accounts), ids(profiles), ids(staff)]
    );
    cleanupGuard(residual.rows[0]?.found === false);
    await client.query("UPDATE trusted_qa_run_entities SET cleanup_state='cleaned',updated_at=NOW() WHERE run_id=$1", [run.id]);
    await client.query(`UPDATE trusted_qa_runs SET state='cleaned',cleaned_at=NOW(),
        cleanup_last_error=NULL,next_cleanup_at=NULL,updated_at=NOW() WHERE id=$1`, [run.id]);
    return { status: 'cleaned', state: 'cleaned', entityCount: entities.length };
}

module.exports = {
    SOURCE, TYPES, ENDPOINTS, describeHrFixtureQaPlan, preflightHrFixtureQaPlan, createHrFixtureQaRun, finishHrFixtureQaRun,
    prepareHrFixtureQa, claimHrFixtureQa, assertHrFixtureCreate,
    assertHrQaOnboarding, requireHrQaEntity, registerHrQaEntity, prepareHrQaMembership, prepareHrQaRevocation, cleanupHrFixtureQa
};
