'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    approveStaffAccountOnboardingRequest,
    buildCanonicalPayload,
    createPendingStaffAccountOnboardingRequest,
    previewStaffAccountOnboarding,
    rejectStaffAccountOnboardingRequest
} = require('../services/hermesStaffAccountOnboarding');
const { generateOneTimePassword } = require('../services/accountLinking');

const ACTOR = {
    id: 4,
    username: 'sergiy',
    role: 'creator',
    business_contexts: ['event_genix'],
    defaultBusinessContext: 'event_genix'
};

function createPreviewPool({ userRows = [], staffRows = [], onInsert = () => {} } = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/FROM users/i.test(sql)) return { rows: userRows, rowCount: userRows.length };
            if (/FROM staff s/i.test(sql)) return { rows: staffRows, rowCount: staffRows.length };
            if (/INSERT INTO staff_account_onboarding_approvals/i.test(sql)) {
                onInsert(sql, params);
                const row = {
                    id: 12,
                    request_uuid: params[0],
                    flow_version: params[1],
                    request_type: params[2],
                    status: params[3],
                    requested_by_user_id: params[4],
                    primary_approver_user_id: params[5],
                    fallback_approver_user_id: params[6],
                    fallback_after_hours: params[7],
                    request_payload: params[8],
                    preview_payload: params[9],
                    result_receipt: null,
                    credential_issued: false,
                    created_at: '2026-07-31T10:00:00.000Z',
                    updated_at: '2026-07-31T10:00:00.000Z'
                };
                return { rows: [row], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in preview pool: ${sql}`);
        }
    };
}

function canonicalPayload(overrides = {}) {
    return {
        personal: {
            name: 'Олександр Тестовий',
            username: 'oleksandr.testovyy',
            password: 'NeverStorePassword',
            ...overrides.personal
        },
        staff: {
            mode: 'new',
            department: 'animators',
            position: 'Аніматор',
            ...overrides.staff
        },
        professions: [{ key: 'animator', isPrimary: true }],
        access: {
            role: 'animator',
            businessContexts: ['event_genix'],
            defaultBusinessContext: 'event_genix',
            ...overrides.access
        },
        token: 'NeverStoreToken',
        ...overrides.root
    };
}

test('bot-native onboarding parses a natural staff+account command into canonical payload', () => {
    const payload = buildCanonicalPayload({
        text: 'створи нового аніматора Олександр Тестовий з акаунтом'
    });

    assert.equal(payload.flowVersion, 'EG_STAFF_ACCOUNT_ONBOARDING_APPROVAL_FLOW_V1');
    assert.equal(payload.businessContext, 'event_genix');
    assert.equal(payload.personal.name, 'Олександр Тестовий');
    assert.equal(payload.personal.username, 'oleksandr.testovyy');
    assert.equal(payload.staff.mode, 'new');
    assert.equal(payload.staff.department, 'animators');
    assert.equal(payload.access.role, 'animator');
    assert.equal(payload.oneTimeLoginPolicy, 'readable_temp_v1');
    assert.doesNotMatch(JSON.stringify(payload), /password|credential|secret|token|api[_-]?key|cookie|session/i);
});

test('bot-native onboarding preview is read-only and ready when username/staff are clean', async () => {
    const pool = createPreviewPool();
    const result = await previewStaffAccountOnboarding({
        pool,
        actor: ACTOR,
        payload: { text: 'додай аніматора Марія Дар з акаунтом' }
    });

    assert.equal(result.status, 'READY_FOR_APPROVAL');
    assert.equal(result.readyForApproval, true);
    assert.equal(result.sideEffects.staffWrites, 0);
    assert.equal(result.sideEffects.accountWrites, 0);
    assert.equal(result.sideEffects.scheduleWrites, 0);
    assert.equal(result.oneTimeLoginMaterialPresent, false);
    assert.equal(pool.calls.filter(call => /FROM users|FROM staff s/i.test(call.sql)).length, 2);
    assert.doesNotMatch(JSON.stringify(result.payload), /password|credential|secret|token|api[_-]?key|cookie|session/i);
    assert.doesNotMatch(JSON.stringify(result), /NeverStore/);
});

test('bot-native onboarding preview blocks occupied login identities before approval', async () => {
    const pool = createPreviewPool({
        userRows: [{ id: 49, username: 'maria.dar', name: 'Марія Дар', role: 'animator', is_active: true }]
    });

    const result = await previewStaffAccountOnboarding({
        pool,
        actor: ACTOR,
        payload: {
            name: 'Марія Дар',
            username: 'maria.dar',
            role: 'animator'
        }
    });

    assert.equal(result.status, 'BLOCKED_DUPLICATE_OR_STALE');
    assert.equal(result.readyForApproval, false);
    assert.equal(result.duplicateCheck.username.exists, true);
    assert.deepEqual(result.duplicateCheck.blockers, ['USERNAME_OCCUPIED']);
});

test('bot-native onboarding request stores sanitized pending approval with zero staff/account writes', async () => {
    let storedRequestPayload = null;
    let storedPreviewPayload = null;
    const pool = createPreviewPool({
        onInsert(sql, params) {
            assert.match(sql, /INSERT INTO staff_account_onboarding_approvals/);
            storedRequestPayload = JSON.parse(params[8]);
            storedPreviewPayload = JSON.parse(params[9]);
        }
    });

    const result = await createPendingStaffAccountOnboardingRequest({
        pool,
        actor: ACTOR,
        payload: canonicalPayload(),
        approval: {
            primaryApproverUserId: 4,
            fallbackApproverUserId: 4,
            fallbackAfterHours: 2
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.request.status, 'pending_approval');
    assert.equal(result.meta.staffWrites, 0);
    assert.equal(result.meta.accountWrites, 0);
    assert.equal(result.meta.credentialIssued, false);
    assert.equal(storedRequestPayload.personal.username, 'oleksandr.testovyy');
    assert.equal(storedRequestPayload.personal.password, undefined);
    assert.equal(storedRequestPayload.token, undefined);
    assert.equal(storedPreviewPayload.sideEffects.staffWrites, 0);
    assert.doesNotMatch(JSON.stringify(storedRequestPayload), /NeverStore|password|credential|secret|token|api[_-]?key|cookie|session/i);
    assert.doesNotMatch(JSON.stringify(storedPreviewPayload), /NeverStore|password|credential|secret|token|api[_-]?key|cookie|session/i);
});

test('bot-native onboarding rejection aborts with no staff/account creation', async () => {
    const row = {
        id: 12,
        request_uuid: '11111111-1111-4111-8111-111111111111',
        flow_version: 'EG_STAFF_ACCOUNT_ONBOARDING_APPROVAL_FLOW_V1',
        request_type: 'new_staff_with_account',
        status: 'pending_approval',
        requested_by_user_id: 7,
        primary_approver_user_id: 4,
        fallback_approver_user_id: 4,
        fallback_after_hours: 2,
        request_payload: canonicalPayload(),
        preview_payload: {},
        result_receipt: null,
        credential_issued: false
    };
    const calls = [];
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/^BEGIN$/i.test(sql) || /^COMMIT$/i.test(sql) || /^ROLLBACK$/i.test(sql)) return { rows: [], rowCount: 0 };
            if (/SELECT \*/i.test(sql) && /FOR UPDATE/i.test(sql)) return { rows: [row], rowCount: 1 };
            if (/UPDATE staff_account_onboarding_approvals/i.test(sql) && /rejected_by_user_id/i.test(sql)) {
                return { rows: [{ ...row, status: 'rejected', rejected_by_user_id: params[2], rejection_reason: params[3] }], rowCount: 1 };
            }
            throw new Error(`Unexpected reject SQL: ${sql}`);
        },
        release() {}
    };
    const pool = { connect: async () => client };

    const result = await rejectStaffAccountOnboardingRequest({
        pool,
        requestId: row.request_uuid,
        actor: ACTOR,
        reason: 'дубль'
    });

    assert.equal(result.success, true);
    assert.equal(result.request.status, 'rejected');
    assert.equal(result.meta.staffWrites, 0);
    assert.equal(result.meta.accountWrites, 0);
    assert.equal(result.meta.credentialIssued, false);
    assert.equal(calls.some(call => /account/i.test(call.sql) && /INSERT INTO users/i.test(call.sql)), false);
});

test('bot-native onboarding approval executes atomic core once and stores only redacted receipt', async () => {
    const requestPayload = buildCanonicalPayload({ text: 'створи нового аніматора Олександр Тестовий з акаунтом' });
    const row = {
        id: 12,
        request_uuid: '22222222-2222-4222-8222-222222222222',
        flow_version: 'EG_STAFF_ACCOUNT_ONBOARDING_APPROVAL_FLOW_V1',
        request_type: 'new_staff_with_account',
        status: 'pending_approval',
        requested_by_user_id: 7,
        primary_approver_user_id: 4,
        fallback_approver_user_id: 4,
        fallback_after_hours: 2,
        request_payload: requestPayload,
        preview_payload: {},
        result_receipt: null,
        credential_issued: false
    };
    let storedReceipt = null;
    const client = {
        async query(sql) {
            if (/^BEGIN$/i.test(sql) || /^COMMIT$/i.test(sql) || /^ROLLBACK$/i.test(sql)) return { rows: [], rowCount: 0 };
            if (/SELECT \*/i.test(sql) && /FOR UPDATE/i.test(sql)) return { rows: [row], rowCount: 1 };
            if (/UPDATE staff_account_onboarding_approvals/i.test(sql) && /approved_by_user_id/i.test(sql)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected approve client SQL: ${sql}`);
        },
        release() {}
    };
    const pool = {
        connect: async () => client,
        async query(sql, params = []) {
            if (/UPDATE staff_account_onboarding_approvals/i.test(sql) && /result_receipt/i.test(sql)) {
                storedReceipt = JSON.parse(params[2]);
                return {
                    rows: [{
                        ...row,
                        status: 'executed',
                        result_receipt: params[2],
                        credential_issued: true,
                        executed_at: '2026-07-31T10:05:00.000Z'
                    }],
                    rowCount: 1
                };
            }
            throw new Error(`Unexpected approve pool SQL: ${sql}`);
        }
    };
    let coreCalls = 0;

    const result = await approveStaffAccountOnboardingRequest({
        pool,
        requestId: row.request_uuid,
        actor: ACTOR,
        createAccountOnboardingImpl: async ({ payload, actor }) => {
            coreCalls += 1;
            assert.equal(payload.personal.username, 'oleksandr.testovyy');
            assert.equal(actor.id, 4);
            return {
                receipt: {
                    staffId: 932,
                    accountId: 49,
                    linked: true,
                    loginReady: true
                },
                staff: {
                    id: 932,
                    name: 'Олександр Тестовий',
                    department: 'animators',
                    position: 'Аніматор'
                },
                user: {
                    id: 49,
                    username: 'oleksandr.testovyy',
                    name: 'Олександр Тестовий',
                    role: 'animator',
                    is_active: true
                },
                credential: {
                    username: 'oleksandr.testovyy',
                    password: 'UNIT_TEST_ONE_TIME_VALUE',
                    source: 'generated'
                },
                loginReady: true,
                loginReadyReason: 'ready'
            };
        }
    });

    assert.equal(coreCalls, 1);
    assert.equal(result.success, true);
    assert.equal(result.request.status, 'executed');
    assert.equal(result.credential.password, 'UNIT_TEST_ONE_TIME_VALUE');
    assert.equal(storedReceipt.credential.password, '[REDACTED]');
    assert.equal(storedReceipt.credentialIssued, true);
    assert.doesNotMatch(JSON.stringify(result.request), /UNIT_TEST_ONE_TIME_VALUE/);
    assert.doesNotMatch(JSON.stringify(storedReceipt), /UNIT_TEST_ONE_TIME_VALUE/);
});

test('default one-time passwords are human-readable temporary passwords', () => {
    for (let i = 0; i < 50; i += 1) {
        const password = generateOneTimePassword();
        assert.match(password, /^[A-Z][A-Za-z]+-[A-Z][A-Za-z]+-\d{2}$/);
        assert.equal(password.split('-').length, 3);
    }
});
