'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    accountSystemStatus,
    isProtectedSystemAccount,
    professionToAccountRole,
    assertLastActiveCreatorInvariant,
    resolveAccountBusinessAccess,
    normalizeAccountOnboardingPayload,
    mergeExistingProfessionAssignments,
    legacySecondaryProfessionKeys,
    createAccountOnboarding
} = require('../services/accountOnboarding');

function normalizeSql(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim();
}

function onboardingPayload(username = 'test.onboarding') {
    return {
        personal: { name: 'Test Onboarding', username, phone: '+380000000000' },
        staff: { mode: 'new', department: 'QA', position: 'Animator' },
        professions: [{ key: 'animator', isPrimary: true }],
        access: {
            role: 'animator',
            businessContexts: ['event_genix'],
            defaultBusinessContext: 'event_genix'
        },
        issueOneTime: true
    };
}

function createOnboardingHarness(options = {}) {
    const calls = [];
    const auditParams = [];
    let postCommitQueries = 0;
    let passwordHash = null;
    const user = {
        id: 91,
        username: options.username || 'test.onboarding',
        name: 'Test Onboarding',
        role: 'animator',
        extra_roles: [],
        page_allowlist: [],
        action_allowlist: [],
        action_denylist: [],
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        is_active: true,
        password_changed_at: new Date()
    };
    const staff = {
        id: 77,
        name: 'Test Onboarding',
        department: 'QA',
        position: 'Animator',
        phone: '+380000000000',
        hire_date: null,
        role_type: 'animator',
        secondary_professions: [],
        company_structure_node_id: null,
        hourly_rate: 0,
        rate_unit: 'hour',
        is_active: true,
        telegram_username: null,
        telegram_id: null,
        is_freelance: false,
        unique_person_key: null
    };

    const client = {
        async query(sql, params = []) {
            const text = normalizeSql(sql);
            calls.push({ text, params });
            if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [], rowCount: 0 };
            if (/SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)/i.test(text)) return { rows: [{}] };
            if (/SELECT id, username FROM users WHERE LOWER\(username\) = \$1/i.test(text)) return { rows: [] };
            if (/SELECT id, key, title, is_active FROM hr_professions/i.test(text)) {
                return { rows: [{ id: 1, key: 'animator', title: 'Animator', is_active: true }] };
            }
            if (/INSERT INTO staff \(name, department, position, phone, hire_date/i.test(text)) return { rows: [staff], rowCount: 1 };
            if (/SELECT profession_key, status, admission_status, internship_status, hourly_rate, payroll_scheme_id, notes FROM staff_role_assignments/i.test(text)) return { rows: [] };
            if (/UPDATE staff_role_assignments SET is_primary = false/i.test(text)) return { rows: [], rowCount: 0 };
            if (/DELETE FROM staff_role_assignments/i.test(text)) return { rows: [], rowCount: 0 };
            if (/INSERT INTO staff_role_assignments/i.test(text)) {
                return {
                    rows: [{
                        id: 501,
                        profession_key: params[1],
                        is_primary: params[2],
                        status: params[3],
                        admission_status: params[4],
                        internship_status: params[5]
                    }],
                    rowCount: 1
                };
            }
            if (/INSERT INTO users \(username, password_hash, name, role/i.test(text)) {
                if (options.failUserInsert) throw new Error('forced_user_insert_failure');
                passwordHash = params[1];
                user.username = params[0];
                return { rows: [user], rowCount: 1 };
            }
            if (/SELECT u\.id, u\.username, u\.password_hash, u\.is_active FROM users u/i.test(text)) {
                return { rows: [{ id: user.id, username: user.username, password_hash: passwordHash, is_active: true }] };
            }
            if (/SELECT id, username, name, role, is_active FROM users WHERE id = \$1 FOR UPDATE/i.test(text)) return { rows: [user] };
            if (/SELECT id, name, department, position, role_type, phone, telegram_username, telegram_id, is_active, is_freelance, unique_person_key FROM staff/i.test(text)) return { rows: [staff] };
            if (/SELECT ep\.id, ep\.user_id, u\.username, s\.name AS staff_name, ep\.staff_id FROM employee_profiles/i.test(text)) return { rows: [] };
            if (/UPDATE employee_profiles SET user_id = NULL WHERE user_id = \$1/i.test(text)) return { rows: [], rowCount: 0 };
            if (/SELECT id FROM employee_profiles WHERE staff_id = \$1/i.test(text)) return { rows: [] };
            if (/INSERT INTO employee_profiles/i.test(text)) return { rows: [{ id: 801 }], rowCount: 1 };
            if (/UPDATE employee_profiles SET user_id = NULL, is_active = false WHERE staff_id = \$1/i.test(text)) return { rows: [], rowCount: 0 };
            if (/INSERT INTO account_security_events/i.test(text)) {
                auditParams.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO hr_audit_log/i.test(text)) {
                auditParams.push(params);
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected onboarding SQL: ${text}`);
        },
        release() {}
    };
    const dbPool = {
        async connect() { return client; },
        async query(sql, params = []) {
            postCommitQueries += 1;
            const text = normalizeSql(sql);
            calls.push({ text, params });
            assert.ok(calls.some(call => call.text === 'COMMIT'), 'pool work must run after COMMIT');
            if (/FROM users u LEFT JOIN businesses b ON b\.context_key = \$2/i.test(text)) {
                if (options.failBusinessAccessLookup) throw new Error('forced_business_access_lookup_failure');
                return { rows: [options.businessAccessRow || {
                    user_is_active: true,
                    user_role: 'animator',
                    context_key: 'event_genix',
                    business_id: 44,
                    organization_id: 7,
                    business_status: 'active',
                    access_mode: 'membership',
                    organization_status: 'active',
                    membership_organization_id: null,
                    business_membership_is_active: null,
                    organization_membership_is_active: null
                }] };
            }
            if (/SELECT id FROM chat_channels WHERE is_default = true/i.test(text)) {
                if (options.failPostCommit) throw new Error('forced_chat_failure');
                return { rows: [] };
            }
            throw new Error(`Unexpected post-commit SQL: ${text}`);
        }
    };
    return {
        calls,
        auditParams,
        dbPool,
        get postCommitQueries() { return postCommitQueries; }
    };
}

test('account onboarding policies use one canonical mapping and protect system identities', () => {
    assert.equal(professionToAccountRole('trampoline_instructor'), 'animator');
    assert.equal(professionToAccountRole('technician'), 'maintenance');
    assert.equal(professionToAccountRole('unknown_profession'), null);
    assert.equal(accountSystemStatus({ username: 'Guardian' }), 'guardian');
    assert.equal(accountSystemStatus({ username: 'openclaw.worker' }), 'openclaw');
    assert.equal(accountSystemStatus({ username: 'openclawbot' }), 'openclaw');
    assert.equal(accountSystemStatus({ username: 'open_claw.worker' }), 'openclaw');
    assert.equal(accountSystemStatus({ username: 'open-claw-worker' }), 'openclaw');
    assert.equal(accountSystemStatus({ username: 'agent.worker', name: 'Open Claw Agent' }), 'openclaw');
    assert.equal(isProtectedSystemAccount({ username: 'system' }), true);
    assert.equal(isProtectedSystemAccount({ username: 'regular.user' }), false);
});

test('existing staff onboarding preserves professions omitted from the account wizard', () => {
    const staff = { role_type: 'animator', secondary_professions: ['instructor'] };
    const existingRows = [
        { profession_key: 'barista', status: 'active' },
        { profession_key: 'archived_helper', status: 'inactive' }
    ];
    const merged = mergeExistingProfessionAssignments(
        staff,
        [{ key: 'manager', isPrimary: true, status: 'active' }],
        existingRows
    );
    assert.deepEqual(new Set(merged.map(item => item.key)), new Set(['manager', 'animator', 'instructor', 'barista', 'archived_helper']));
    assert.deepEqual(merged.filter(item => item.isPrimary).map(item => item.key), ['manager']);
    assert.deepEqual(
        new Set(legacySecondaryProfessionKeys(staff, merged, existingRows)),
        new Set(['animator', 'instructor', 'barista'])
    );
});

test('account onboarding supports time-only condition changes without changing the rate', () => {
    const payload = onboardingPayload('time.only.operator');
    payload.conditions = {
        professionKey: 'animator',
        rateMode: 'unchanged',
        shiftPreferences: [
            { dayType: 'weekday', startTime: '09:00', endTime: '18:00' },
            { dayType: 'weekend', startTime: '10:00', endTime: '16:00' }
        ]
    };

    const normalized = normalizeAccountOnboardingPayload(payload);
    assert.equal(normalized.conditions[0].rateMode, 'unchanged');
    assert.equal(normalized.conditions[0].hourlyRate, null);
    assert.deepEqual(normalized.conditions[0].shiftPreferences, [
        { dayType: 'weekday', startTime: '09:00', endTime: '18:00' },
        { dayType: 'weekend', startTime: '10:00', endTime: '16:00' }
    ]);
});

test('last active creator cannot be demoted or deactivated', async () => {
    const calls = [];
    const client = {
        async query(sql) {
            calls.push(normalizeSql(sql));
            if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{}] };
            return { rows: [] };
        }
    };
    await assert.rejects(
        assertLastActiveCreatorInvariant(client, { id: 1, role: 'creator', is_active: true }, { role: 'director', isActive: true }),
        error => error.code === 'LAST_ACTIVE_CREATOR' && error.statusCode === 409
    );
    assert.equal(calls.length, 2);
    assert.match(calls[1], /NOT \('manage_accounts' = ANY/);
});

test('last creator cannot lose the real manage_accounts capability through deny overrides', async () => {
    const client = {
        async query(sql) {
            if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{}] };
            return { rows: [] };
        }
    };
    await assert.rejects(
        assertLastActiveCreatorInvariant(
            client,
            { id: 1, role: 'creator', is_active: true, action_denylist: [] },
            { role: 'creator', isActive: true, actionDenylist: ['manage_accounts'] }
        ),
        error => error.code === 'LAST_ACTIVE_CREATOR' && error.statusCode === 409
    );
});

test('transaction failure rolls back every onboarding write and skips post-commit work', async () => {
    const harness = createOnboardingHarness({ failUserInsert: true });
    await assert.rejects(
        createAccountOnboarding({
            payload: onboardingPayload(),
            actor: { id: 1, username: 'creator', role: 'creator', action_denylist: [] },
            dbPool: harness.dbPool
        }),
        /forced_user_insert_failure/
    );
    const statements = harness.calls.map(call => call.text);
    assert.ok(statements.includes('BEGIN'));
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.includes('COMMIT'), false);
    assert.equal(harness.postCommitQueries, 0);
});

test('post-commit chat failure returns a warning without exposing credentials to audit', async () => {
    const harness = createOnboardingHarness({ failPostCommit: true });
    const result = await createAccountOnboarding({
        payload: onboardingPayload(),
        actor: { id: 1, username: 'creator', role: 'creator', action_denylist: [] },
        dbPool: harness.dbPool
    });
    assert.equal(result.loginReady, true);
    assert.equal(result.receipt.warnings[0]?.code, 'DEFAULT_CHAT_SETUP_FAILED');
    assert.equal(result.businessAccessReady, false);
    assert.equal(result.accessState, 'pending_membership');
    assert.equal(result.receipt.access.businessAccessReady, result.businessAccessReady);
    assert.equal(result.receipt.access.accessState, result.accessState);
    assert.match(result.credential.password, /^[A-Z][A-Za-z]+-[A-Z][A-Za-z]+-\d{2}$/);
    assert.ok(harness.calls.some(call => call.text === 'COMMIT'));
    const auditText = JSON.stringify(harness.auditParams);
    assert.doesNotMatch(auditText, new RegExp(result.credential.password));
    assert.doesNotMatch(auditText, /password/i);
});

test('account business access is active only for matching active registry and memberships', async () => {
    const row = {
        user_is_active: true,
        user_role: 'animator',
        membership_role: 'animator',
        context_key: 'event_genix',
        business_id: 44,
        organization_id: 7,
        business_status: 'active',
        access_mode: 'membership',
        organization_status: 'active',
        membership_organization_id: 7,
        business_membership_is_active: true,
        organization_membership_is_active: true
    };
    const result = await resolveAccountBusinessAccess({
        async query(sql, params) {
            assert.match(normalizeSql(sql), /FROM users u LEFT JOIN businesses b/);
            assert.deepEqual(params, [91, 'event_genix']);
            return { rows: [row] };
        }
    }, 91, 'event_genix');
    assert.deepEqual(result, { businessAccessReady: true, accessState: 'active' });
});

test('business creator readiness requires the freshly read platform creator role', async () => {
    const row = {
        user_is_active: true, user_role: 'creator', membership_role: 'creator',
        business_id: 44, context_key: 'event_genix', organization_id: 7,
        business_status: 'active', access_mode: 'membership', organization_status: 'active',
        membership_organization_id: 7, business_membership_is_active: true,
        organization_membership_is_active: true
    };
    const db = { async query() { return { rows: [row] }; } };
    assert.deepEqual(await resolveAccountBusinessAccess(db, 91, 'event_genix'), {
        businessAccessReady: true, accessState: 'active'
    });
    row.user_role = 'animator';
    assert.deepEqual(await resolveAccountBusinessAccess(db, 91, 'event_genix'), {
        businessAccessReady: false, accessState: 'unknown'
    });
});

test('account business access is pending for missing, revoked, or organization-revoked membership', async t => {
    const registry = {
        user_is_active: true,
        business_id: 44,
        organization_id: 7,
        business_status: 'active',
        access_mode: 'membership',
        organization_status: 'active'
    };
    const cases = [
        ['missing business membership', { ...registry, membership_organization_id: null }],
        ['revoked business membership', { ...registry, membership_organization_id: 7, business_membership_is_active: false, organization_membership_is_active: true }],
        ['revoked organization membership', { ...registry, membership_organization_id: 7, business_membership_is_active: true, organization_membership_is_active: false }]
    ];
    for (const [name, row] of cases) {
        await t.test(name, async () => {
            const result = await resolveAccountBusinessAccess({ async query() { return { rows: [row] }; } }, 91, 'event_genix');
            assert.deepEqual(result, { businessAccessReady: false, accessState: 'pending_membership' });
        });
    }
});

test('account business access is unknown for unresolved, inactive, compatibility, or foreign registry state', async t => {
    const active = {
        user_is_active: true,
        user_role: 'animator',
        membership_role: 'animator',
        context_key: 'event_genix',
        business_id: 44,
        organization_id: 7,
        business_status: 'active',
        access_mode: 'membership',
        organization_status: 'active',
        membership_organization_id: 7,
        business_membership_is_active: true,
        organization_membership_is_active: true
    };
    const cases = [
        ['missing registry', null],
        ['inactive user', { ...active, user_is_active: false }],
        ['inactive business', { ...active, business_status: 'inactive' }],
        ['inactive organization', { ...active, organization_status: 'inactive' }],
        ['compatibility business', { ...active, access_mode: 'compatibility' }],
        ['foreign membership organization', { ...active, membership_organization_id: 8 }],
        ['business creator without platform creator', { ...active, membership_role: 'creator' }]
    ];
    for (const [name, row] of cases) {
        await t.test(name, async () => {
            const result = await resolveAccountBusinessAccess({ async query() { return { rows: row ? [row] : [] }; } }, 91, 'event_genix');
            assert.deepEqual(result, { businessAccessReady: false, accessState: 'unknown' });
        });
    }
});

test('membership lookup failure after commit preserves loginReady and the one-time credential', async () => {
    const harness = createOnboardingHarness({ failBusinessAccessLookup: true });
    const result = await createAccountOnboarding({
        payload: onboardingPayload('membership.lookup.failure'),
        actor: { id: 1, username: 'creator', role: 'creator', action_denylist: [] },
        dbPool: harness.dbPool
    });
    assert.equal(result.loginReady, true);
    assert.equal(result.businessAccessReady, false);
    assert.equal(result.accessState, 'unknown');
    assert.ok(result.credential.password);
    assert.ok(result.receipt.warnings.some(item => item.code === 'BUSINESS_ACCESS_STATUS_UNKNOWN'));
    assert.equal(result.receipt.access.businessAccessReady, false);
    assert.equal(result.receipt.access.accessState, 'unknown');
    assert.ok(harness.calls.some(call => call.text === 'COMMIT'));
    assert.equal(harness.calls.some(call => /(?:INSERT INTO|UPDATE|DELETE FROM) (organization_memberships|business_memberships)/i.test(call.text)), false);
    assert.equal(JSON.stringify(harness.auditParams).includes(result.credential.password), false);
});

test('an unverifiable registry warns after commit without losing the account credential', async () => {
    const harness = createOnboardingHarness({ businessAccessRow: { user_is_active: true, business_id: null } });
    const result = await createAccountOnboarding({
        payload: onboardingPayload(),
        actor: { id: 1, username: 'creator', role: 'creator', action_denylist: [] },
        dbPool: harness.dbPool
    });
    assert.equal(result.loginReady, true);
    assert.equal(result.businessAccessReady, false);
    assert.equal(result.accessState, 'unknown');
    assert.ok(result.credential.password);
    assert.deepEqual(result.receipt.warnings.map(item => item.code), ['BUSINESS_ACCESS_STATUS_UNKNOWN']);
    assert.ok(harness.calls.some(call => call.text === 'COMMIT'));
    assert.equal(harness.calls.some(call => call.text === 'ROLLBACK'), false);
});

test('onboarding rejects role-fenced Finance explicit allows', () => {
    const pagePayload = onboardingPayload('finance.page.allow');
    pagePayload.access.pageAllowlist = ['/finance'];
    assert.throws(
        () => normalizeAccountOnboardingPayload(pagePayload),
        error => error.code === 'ACCOUNT_ONBOARDING_EXPLICIT_ALLOW_DISABLED'
    );

    const actionPayload = onboardingPayload('finance.action.allow');
    actionPayload.access.actionAllowlist = ['finance.manage'];
    assert.throws(
        () => normalizeAccountOnboardingPayload(actionPayload),
        error => error.code === 'ACCOUNT_ONBOARDING_EXPLICIT_ALLOW_DISABLED'
    );
});
