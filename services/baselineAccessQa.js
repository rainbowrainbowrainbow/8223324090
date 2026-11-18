'use strict';

// CLI-only fixture lifecycle. This module grants no public endpoint or session.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { isQaLeaseCandidate } = require('./qaCreatorLease');
const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
const { hasCurrentParkMembership } = require('./parkLegacyModuleAccess');
const { resolveCapability } = require('./accountAccessPolicy');
const { SESSION_REVOCATION_CUTOFF_SQL } = require('./sessionRevocation');

const SOURCE = 'baseline_access_qa';
const TYPES = new Set(['baseline_staff', 'baseline_account', 'baseline_profile', 'baseline_membership']);
const ROLES = Object.freeze(['instructor', 'admin']);
const RUN_ID = /^baqa-[0-9a-f]{12}$/;
const MAX_ENTITIES = 8;
const registry = () => require('./trustedQaRuns');

function requireQa(condition, code = 'BASELINE_QA_INVALID') {
    if (!condition) throw new (registry().TrustedQaRunError)('Baseline QA validation failed', code, {}, 409);
}

function describeBaselineQaPlan(input) {
    const { runId, operatorId, businessId, releaseSha, ttlMinutes } = input || {};
    const plan = { runId, operatorId, businessId, releaseSha, ttlMinutes };
    if (input?.booking !== undefined) plan.booking = require('./baselineBookingQa').normalizeBaselineBooking(input.booking, runId);
    requireQa(input && Object.keys(input).length === Object.keys(plan).length && Object.keys(input).every(key => Object.hasOwn(plan, key))
        && RUN_ID.test(runId) && /^[a-f0-9]{40}$/.test(releaseSha)
        && [operatorId, businessId].every(id => Number.isSafeInteger(id) && id > 0)
        && Number.isInteger(ttlMinutes) && ttlMinutes >= 1 && ttlMinutes <= 30, 'BASELINE_QA_PLAN_INVALID');
    return { plan, planHash: registry().sha256(JSON.stringify(plan)) };
}

async function preflightBaselineQaPlan(db, input, { lock = false } = {}) {
    const description = describeBaselineQaPlan(input);
    const { plan } = description;
    const result = await db.query(`SELECT u.id,u.username,u.name,u.role,u.is_active,
        u.extra_roles,u.page_allowlist,u.page_denylist,u.action_allowlist,u.action_denylist,
        u.business_contexts,u.default_business_context,
        EXISTS(SELECT 1 FROM employee_profiles ep WHERE ep.user_id=u.id AND COALESCE(ep.is_active,true)) AS has_staff
        FROM users u WHERE u.id=$1 ${lock ? 'FOR SHARE OF u' : ''}`, [plan.operatorId]);
    const actor = result.rows[0];
    requireQa(actor?.is_active && !actor.has_staff && isQaLeaseCandidate(actor), 'BASELINE_QA_OPERATOR_NOT_ISOLATED');
    if (lock) {
        const current = await db.query(`SELECT b.id FROM business_memberships bm
            JOIN businesses b ON b.id=bm.business_id AND b.organization_id=bm.organization_id
            JOIN organizations o ON o.id=b.organization_id
            JOIN organization_memberships om ON om.organization_id=o.id AND om.user_id=bm.user_id
            WHERE bm.user_id=$1 AND b.id=$2 AND b.context_key='event_genix' AND bm.is_active AND om.is_active
              AND b.status='active' AND o.status='active' FOR SHARE OF bm,b,o,om`, [plan.operatorId, plan.businessId]);
        requireQa(current.rowCount === 1, 'BASELINE_QA_OPERATOR_SCOPE_DENIED');
    }
    const access = await loadMembershipAccess(db, actor, 'event_genix');
    const effective = applyMembershipAccess(actor, access);
    requireQa(hasCurrentParkMembership(effective, 'event_genix')
        && Number(access.activeMembership?.businessId) === plan.businessId
        && resolveCapability(effective, '/hr', { type: 'page' }).allowed
        && resolveCapability(effective, 'hr.staff.manage', { type: 'action' }).allowed,
    'BASELINE_QA_OPERATOR_SCOPE_DENIED');
    const open = await db.query(`SELECT 1 FROM trusted_qa_runs
        WHERE source=$1 AND (run_id=$2 OR state IN ('active','cleanup_pending','blocked')) LIMIT 1`, [SOURCE, plan.runId]);
    requireQa(!open.rowCount, 'BASELINE_QA_RUN_ALREADY_OPEN');
    const bookingReadiness = plan.booking ? await require('./baselineBookingQa').preflightBaselineBooking(db, plan.booking,
        { allowPendingClassification: !lock }) : null;
    return { ...description, organizationId: Number(access.activeMembership.organizationId), bookingReadiness };
}

async function createBaselineQaRun(db, input, approvedHash) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('baseline-access-qa-create',0))");
    const { plan, planHash, organizationId } = await preflightBaselineQaPlan(db, input, { lock: true });
    requireQa(approvedHash === planHash, 'BASELINE_QA_PLAN_HASH_MISMATCH');
    const { run } = await registry().createTrustedQaRun(db, { runId: plan.runId, source: SOURCE,
        businessContext: 'event_genix', maxEntityCount: MAX_ENTITIES, ttlMinutes: plan.ttlMinutes,
        operatorUserId: plan.operatorId, requiredOperatorUserId: plan.operatorId,
        testCustomerMarker: `${plan.runId}:baseline:${planHash}`, allowedEndpoints: ['PUT /api/hr/staff/:id'] });
    const qa = { trusted: true, run };
    const actors = [];
    for (const [index, role] of ROLES.entries()) {
        const username = `${plan.runId}-account-${index + 1}`;
        const name = `${plan.runId}-staff-${index + 1}`;
        const password = crypto.randomBytes(24).toString('base64url');
        const { rows: [staff] } = await db.query(`INSERT INTO staff(name,department,position,role_type)
            VALUES($1,'admin','Synthetic baseline QA',$2) RETURNING id`, [name, role === 'instructor' ? 'trampoline_instructor' : 'animator']);
        const { rows: [account] } = await db.query(`INSERT INTO users(username,name,password_hash,role,
            business_contexts,default_business_context,password_changed_at)
            VALUES($1,$1,$2,$3,ARRAY['event_genix']::text[],'event_genix',NOW()) RETURNING id`,
        [username, await bcrypt.hash(password, 10), role]);
        const { rows: [profile] } = await db.query(`INSERT INTO employee_profiles(user_id,staff_id,full_name)
            VALUES($1,$2,$3) RETURNING id`, [account.id, staff.id, name]);
        await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role)
            VALUES($1,$2,'member')`, [organizationId, account.id]);
        await db.query(`INSERT INTO business_memberships(organization_id,business_id,user_id,role,is_default)
            VALUES($1,$2,$3,$4,true)`, [organizationId, plan.businessId, account.id, role]);
        for (const [type, id, payload] of [
            ['baseline_staff', staff.id, { name, ...(plan.booking && role === 'admin'
                ? { shiftPreferenceActor: username, shiftPreferenceProfessions: ['animator', 'host', 'reception'] } : {}) }],
            ['baseline_account', account.id, { username, role, staffId: staff.id }],
            ['baseline_profile', profile.id, { userId: account.id, staffId: staff.id }],
            ['baseline_membership', account.id, { organizationId, businessId: plan.businessId, role }]
        ]) await registry().registerQaEntity(db, qa, type, id, payload);
        const actor = { id: account.id, staffId: staff.id, profileId: profile.id, username, role };
        // Accidental JSON logging cannot serialize the one-time credential.
        Object.defineProperty(actor, 'password', { value: password });
        actors.push(actor);
    }
    return { runId: run.id, marker: plan.runId, planHash, actors };
}

async function finishBaselineQaRun(db, input, approvedHash) {
    const { plan, planHash } = describeBaselineQaPlan(input);
    requireQa(planHash === approvedHash, 'BASELINE_QA_PLAN_HASH_MISMATCH');
    const result = await db.query(`SELECT id FROM trusted_qa_runs WHERE source=$1 AND run_id=$2
        AND business_context='event_genix' AND operator_user_id=$3 AND max_entity_count=$4
        AND test_customer_marker=$5 AND expires_at=created_at+($6::int*INTERVAL '1 minute') FOR UPDATE`,
    [SOURCE, plan.runId, plan.operatorId, MAX_ENTITIES, `${plan.runId}:baseline:${planHash}`, plan.ttlMinutes]);
    requireQa(result.rowCount === 1, 'BASELINE_QA_RUN_INVALID');
    return registry().cleanupTrustedQaRun(db, result.rows[0].id, { forUpdate: true });
}

async function cleanupBaselineQa(db, { run, entities }) {
    const guard = value => requireQa(value, 'BASELINE_QA_CLEANUP_DRIFT');
    const lifetime = new Date(run.expires_at).getTime() - new Date(run.created_at).getTime();
    guard(run.source === SOURCE && RUN_ID.test(run.run_id) && run.business_context === 'event_genix'
        && lifetime > 0 && lifetime <= 30 * 60 * 1000
        && Number(run.max_entity_count) === MAX_ENTITIES && entities.length === MAX_ENTITIES
        && new RegExp(`^${run.run_id}:baseline:[a-f0-9]{64}$`).test(run.test_customer_marker)
        && entities.every(row => TYPES.has(row.entity_type) && /^[1-9]\d*$/.test(String(row.entity_id))));
    const fixtures = type => new Map(entities.filter(row => row.entity_type === type)
        .map(row => [Number(row.entity_id), row.payload]));
    const staff = fixtures('baseline_staff');
    const accounts = fixtures('baseline_account');
    const profiles = fixtures('baseline_profile');
    const memberships = fixtures('baseline_membership');
    const ids = map => [...map.keys()];
    guard([staff, accounts, profiles, memberships].every(map => map.size === 2)
        && ids(accounts).every(id => id !== Number(run.operator_user_id)));
    // One transaction client, with a deterministic lock order.
    const staffRows = await db.query(`SELECT id,name,hourly_rate,company_structure_node_id,
        (NULLIF(BTRIM(phone),'') IS NULL AND NULLIF(BTRIM(telegram_username),'') IS NULL) AS no_contact
        FROM staff WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids(staff)]);
    const userRows = await db.query(`SELECT id,username,role,extra_roles,page_allowlist,page_denylist,action_allowlist,action_denylist
            FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids(accounts)]);
    const links = await db.query(`SELECT id,user_id,staff_id FROM employee_profiles
            WHERE user_id=ANY($1::int[]) OR staff_id=ANY($2::int[]) OR id=ANY($3::int[]) ORDER BY id FOR UPDATE`,
        [ids(accounts), ids(staff), ids(profiles)]);
    const businessRows = await db.query(`SELECT user_id,organization_id,business_id,role,extra_roles,page_allowlist,page_denylist,action_allowlist,action_denylist
            FROM business_memberships WHERE user_id=ANY($1::int[]) ORDER BY user_id FOR UPDATE`, [ids(accounts)]);
    const orgRows = await db.query('SELECT user_id,organization_id,role FROM organization_memberships WHERE user_id=ANY($1::int[]) ORDER BY user_id FOR UPDATE', [ids(accounts)]);
    const noOverrides = row => ['extra_roles','page_allowlist','page_denylist','action_allowlist','action_denylist']
        .every(key => !row[key]?.length);
    guard(staffRows.rowCount === 2 && userRows.rowCount === 2 && links.rowCount === 2
        && businessRows.rowCount === 2 && orgRows.rowCount === 2);
    guard(userRows.rows.every(row => {
        const slot = ROLES.indexOf(row.role) + 1;
        const owned = accounts.get(row.id);
        return slot > 0 && row.username === `${run.run_id}-account-${slot}`
            && row.username === owned?.username && row.role === owned?.role && noOverrides(row)
            && staff.get(Number(owned.staffId))?.name === `${run.run_id}-staff-${slot}`;
    }));
    guard(staffRows.rows.every(row => row.name === staff.get(row.id)?.name
        && Number(row.hourly_rate || 0) === 0 && row.company_structure_node_id === null && row.no_contact === true));
    guard(links.rows.every(row => profiles.get(row.id)?.staffId === row.staff_id
        && (run.state === 'cleaned' ? row.user_id === null : Number(profiles.get(row.id)?.userId) === Number(row.user_id))
        && staff.has(row.staff_id) && accounts.get(Number(profiles.get(row.id)?.userId))?.staffId === row.staff_id));
    guard(businessRows.rows.every(row => {
        const owned = memberships.get(row.user_id);
        return owned && Number(owned.businessId) === Number(row.business_id)
            && Number(owned.organizationId) === Number(row.organization_id) && row.role === owned.role
            && row.role === accounts.get(row.user_id)?.role && noOverrides(row);
    }));
    guard(orgRows.rows.every(row => row.role === 'member'
        && Number(row.organization_id) === Number(memberships.get(row.user_id)?.organizationId)));
    const park = await db.query(`SELECT id,organization_id FROM businesses WHERE context_key='event_genix'`);
    guard(park.rowCount === 1 && businessRows.rows.every(row => Number(row.business_id) === Number(park.rows[0].id)
        && Number(row.organization_id) === Number(park.rows[0].organization_id)));
    const residual = async () => {
        const result = await db.query(`SELECT EXISTS(SELECT 1 FROM users WHERE id=ANY($1::int[]) AND is_active)
            OR EXISTS(SELECT 1 FROM refresh_tokens WHERE user_id=ANY($1::int[]) AND revoked_at IS NULL)
            OR EXISTS(SELECT 1 FROM business_memberships WHERE user_id=ANY($1::int[]) AND is_active)
            OR EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=ANY($1::int[]) AND is_active)
            OR EXISTS(SELECT 1 FROM employee_profiles WHERE id=ANY($2::int[]) AND (is_active OR user_id IS NOT NULL))
            OR EXISTS(SELECT 1 FROM staff WHERE id=ANY($3::int[]) AND is_active)
            OR EXISTS(SELECT 1 FROM staff_shift_preferences WHERE staff_id=ANY($3::int[]))
            OR EXISTS(SELECT 1 FROM staff_role_assignments WHERE staff_id=ANY($3::int[]) AND status='active') AS found`,
        [ids(accounts), ids(profiles), ids(staff)]);
        return result.rows[0]?.found;
    };
    if (run.state === 'cleaned') {
        guard(entities.every(row => row.cleanup_state === 'cleaned') && await residual() === false);
        return { state: 'cleaned', status: 'cleaned', idempotent: true };
    }
    guard(['active','cleanup_pending'].includes(run.state)
        && entities.every(row => ['active','cleanup_pending'].includes(row.cleanup_state)));
    const unexpected = await db.query(`SELECT
        EXISTS(SELECT 1 FROM chat_channel_members WHERE user_id=ANY($1::int[]))
        OR EXISTS(SELECT 1 FROM hr_shifts WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM hr_time_records WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM staff_schedule WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM payroll_reports WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM staff_profession_rates WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM payroll_schemes WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM staff_role_assignments WHERE staff_id=ANY($2::int[])
            AND (COALESCE(hourly_rate,0)<>0 OR payroll_scheme_id IS NOT NULL))
        OR EXISTS(SELECT 1 FROM staff_documents WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM staff_resource_assignments WHERE staff_id=ANY($2::int[]))
        OR EXISTS(SELECT 1 FROM tasks WHERE owner_user_id=ANY($1::int[]) OR created_by_user_id=ANY($1::int[]))
        OR EXISTS(SELECT 1 FROM bookings WHERE created_by=ANY($3::text[]) AND COALESCE(status,'confirmed')<>'cancelled')
        OR EXISTS(SELECT 1 FROM trusted_qa_runs WHERE run_id=$4 AND state<>'cleaned') AS found`,
    [ids(accounts), ids(staff), userRows.rows.map(row => row.username), `${run.run_id}-booking`]);
    guard(unexpected.rows[0]?.found === false);
    // The work-section footer saves default times, never actual shifts. These
    // dependent rows are owned by the registered synthetic staff and actor.
    const preferences = await db.query(`SELECT id,staff_id,profession_key,day_type,created_by,updated_by
        FROM staff_shift_preferences WHERE staff_id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids(staff)]);
    guard(preferences.rowCount <= 6 && preferences.rows.every(row => {
        const scope = staff.get(row.staff_id);
        return scope?.shiftPreferenceActor === `${run.run_id}-account-2`
            && JSON.stringify(scope.shiftPreferenceProfessions) === JSON.stringify(['animator','host','reception'])
            && scope.shiftPreferenceProfessions.includes(row.profession_key)
            && ['weekday','weekend'].includes(row.day_type)
            && row.created_by === scope.shiftPreferenceActor && row.updated_by === scope.shiftPreferenceActor;
    }));
    if (preferences.rowCount) await db.query('DELETE FROM staff_shift_preferences WHERE id=ANY($1::bigint[])',
        [preferences.rows.map(row => row.id)]);
    for (const [userId, owned] of memberships) {
        await db.query('UPDATE business_memberships SET is_active=false,is_default=false WHERE user_id=$1 AND business_id=$2 AND organization_id=$3',
            [userId, owned.businessId, owned.organizationId]);
        await db.query('UPDATE organization_memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2', [userId, owned.organizationId]);
    }
    await db.query(`UPDATE users SET is_active=false,session_revoked_at=${SESSION_REVOCATION_CUTOFF_SQL} WHERE id=ANY($1::int[])`, [ids(accounts)]);
    for (const userId of ids(accounts)) await require('../middleware/auth').revokeAllUserTokens(userId, db);
    await db.query('UPDATE employee_profiles SET user_id=NULL,is_active=false WHERE id=ANY($1::int[])', [ids(profiles)]);
    await db.query("UPDATE staff_role_assignments SET status='inactive' WHERE staff_id=ANY($1::int[])", [ids(staff)]);
    await db.query("UPDATE staff SET is_active=false,hr_pool_status='reserve' WHERE id=ANY($1::int[])", [ids(staff)]);
    guard(await residual() === false);
    await db.query("UPDATE trusted_qa_run_entities SET cleanup_state='cleaned',updated_at=NOW() WHERE run_id=$1", [run.id]);
    await db.query("UPDATE trusted_qa_runs SET state='cleaned',cleaned_at=NOW(),cleanup_last_error=NULL,next_cleanup_at=NULL,updated_at=NOW() WHERE id=$1", [run.id]);
    return { status: 'cleaned', state: 'cleaned', entityCount: entities.length };
}

module.exports = { SOURCE, TYPES, describeBaselineQaPlan, preflightBaselineQaPlan,
    createBaselineQaRun, finishBaselineQaRun, cleanupBaselineQa };
