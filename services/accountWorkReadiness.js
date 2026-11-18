'use strict';

const { resolveCapability, ROLE_HIERARCHY } = require('./accountAccessPolicy');
const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
const { userBusinessModuleState } = require('./businessModuleRegistry');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');

const REQUIRED_WORK_PAGES = Object.freeze(['/profile', '/tasks', '/chat', '/afisha', '/staff', '/training']);

// A successful bridge is deliberately distinct from membership and data access.
// No membership or exception is created by this read-only assessment.
function assessAccountWorkReadiness({ user, staff, profile, access, dataChecks = [] }) {
    const effective = applyMembershipAccess(user || {}, access || { invalid: true });
    const linked = Boolean(profile?.id && Number(profile.userId) === Number(user?.id)
        && Number(profile.staffId) === Number(staff?.id));
    const active = Boolean(user && staff && user.is_active !== false && staff.is_active !== false);
    const membership = Boolean(access?.membershipEnabled && !access.invalid && access.activeMembership);
    const role = membership ? effective.role : null;
    const pages = REQUIRED_WORK_PAGES.map(page => ({ page, ...resolveCapability(effective, page, { type: 'page' }) }));
    const context = access?.activeMembership?.businessContext;
    const modules = REQUIRED_WORK_PAGES.filter(page => page !== '/profile').map(page => {
        const module = page.slice(1);
        const state = module === 'staff' && hasCurrentParkScheduleMembership({ user: effective, query: { businessContext: context } })
            ? { available: true, code: null, message: null }
            : userBusinessModuleState(effective, context, module);
        return { page, module, ...state };
    });
    const authenticatedReadsVerified = REQUIRED_WORK_PAGES.every(page => dataChecks.some(check => check.page === page
        && check.passed === true && check.probe === 'authenticated_api'));
    const checks = {
        profile: { passed: linked, reason: linked ? 'linked' : 'staff_link_required',
            profileId: linked ? profile.id : null, staffId: linked ? profile.staffId : null },
        active: { passed: active, reason: active ? 'active' : 'inactive_account_or_staff' },
        membership: { passed: membership, reason: membership ? 'active' : 'active_business_membership_required' },
        role: { passed: ROLE_HIERARCHY.includes(role), effectiveRole: role },
        pages: { passed: pages.every(page => page.allowed), results: pages },
        modules: { passed: modules.every(module => module.available), results: modules },
        data: { passed: authenticatedReadsVerified,
            status: !dataChecks.length ? 'not_run' : authenticatedReadsVerified ? 'checked' : 'api_not_verified',
            results: dataChecks }
    };
    const ready = Object.values(checks).every(check => check.passed);
    const nextStep = !linked ? 'Прив’яжіть акаунт до активної картки працівника.'
        : !active ? 'Перевірте активність картки й акаунта.'
        : !membership ? 'Власник або адміністратор має явно надати членство у вибраному бізнесі.'
        : !checks.role.passed ? 'Уточніть роль у членстві бізнесу.'
        : !checks.pages.passed ? 'Перевірте персональні заборони робочих розділів; вони не скасовуються автоматично.'
        : !checks.modules.passed ? 'Перевірте доступність робочих модулів бізнесу: деякі ще не розмежовані або вимкнені. Роль і членство автоматично не змінюються.'
        : !checks.data.passed ? (dataChecks.some(check => check.probe === 'authenticated_api')
            ? 'Не всі робочі розділи вдалося перевірити. Повторіть перевірку; якщо проблема лишається, зверніться до адміністратора.'
            : 'Відкрийте власний профіль і натисніть «Перевірити робочий доступ».')
        : 'Робочий доступ підтверджено.';
    return { ready, businessContext: access?.activeMembership?.businessContext || null, checks, nextStep };
}

async function loadAccountWorkReadiness(db, { userId, staff, businessContext, authenticatedReadChecks }) {
    // Explicit access columns only: never load passwords, aliases or tokens.
    const result = await db.query(
        `SELECT id, role, is_active, extra_roles, page_allowlist, page_denylist,
                action_allowlist, action_denylist, business_contexts, default_business_context
         FROM users WHERE id = $1`, [userId]
    );
    const user = result.rows[0];
    const links = await db.query(
        `SELECT ep.id, ep.staff_id, s.is_active AS staff_active
         FROM employee_profiles ep JOIN staff s ON s.id = ep.staff_id
         WHERE ep.user_id = $1 AND COALESCE(ep.is_active, true) IS TRUE
         ORDER BY ep.id LIMIT 2`, [userId]
    );
    const link = links.rows.length === 1 ? links.rows[0] : null;
    const targetStaff = staff || (link ? { id: link.staff_id } : null);
    const verifiedProfile = link && Number(link.staff_id) === Number(targetStaff?.id)
        ? { id: link.id, userId, staffId: link.staff_id } : null;
    const access = await loadMembershipAccess(db, user, businessContext);
    const input = { user, staff: targetStaff ? { ...targetStaff, is_active: link?.staff_active } : null,
        profile: verifiedProfile, access };
    const policy = assessAccountWorkReadiness(input);
    // Only the internal self-check route supplies these outcomes, after actual
    // authenticated HTTP reads. Never accept them from a request body.
    if (authenticatedReadChecks !== undefined) {
        return assessAccountWorkReadiness({ ...input, dataChecks: authenticatedReadChecks });
    }
    const probes = {
        '/profile': ['SELECT 1 FROM users WHERE id = $1 LIMIT 1', [userId]],
        '/tasks': ['SELECT 1 FROM tasks WHERE owner_user_id = $1 AND business_context = $2 LIMIT 1', [userId, businessContext]],
        '/staff': ['SELECT 1 FROM staff_schedule WHERE staff_id = $1 LIMIT 1', [verifiedProfile?.staffId || 0]],
        '/afisha': ['SELECT 1 FROM afisha LIMIT 1', []]
    };
    const dataChecks = [];
    for (const page of REQUIRED_WORK_PAGES) {
        const pageDecision = policy.checks.pages.results.find(result => result.page === page);
        const moduleDecision = policy.checks.modules.results.find(result => result.page === page);
        const blocked = !policy.checks.active.passed || !policy.checks.profile.passed || !policy.checks.membership.passed
            || !pageDecision.allowed || (moduleDecision && !moduleDecision.available);
        if (blocked) {
            dataChecks.push({ page, passed: false, status: 'blocked', probe: 'not_run',
                code: moduleDecision?.code || pageDecision.reason || 'account_not_ready' });
            continue;
        }
        if (!probes[page]) {
            dataChecks.push({ page, passed: false, status: 'unavailable', probe: 'not_run', code: 'work_data_probe_unavailable' });
            continue;
        }
        try {
            // Empty work sections are valid. Return only success, never rows or
            // counts. This probes the data store; HTTP/login QA is independent.
            await db.query(...probes[page]);
            dataChecks.push({ page, passed: false, storeReadPassed: true,
                status: 'api_not_verified', probe: 'read_only_database', code: 'authenticated_work_read_required' });
        } catch {
            dataChecks.push({ page, passed: false, storeReadPassed: false,
                status: 'failed', probe: 'read_only_database', code: 'work_data_read_failed' });
        }
    }
    return assessAccountWorkReadiness({ ...input, dataChecks });
}

module.exports = { REQUIRED_WORK_PAGES, assessAccountWorkReadiness, loadAccountWorkReadiness };
