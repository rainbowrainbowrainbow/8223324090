'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createHermesAuthMiddleware } = require('../middleware/hermesAuth');
const { createHermesRouter } = require('../routes/hermes');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function request(baseUrl, route, headers = {}, options = {}) {
    const requestHeaders = { ...headers };
    const init = {
        method: options.method || 'GET',
        headers: requestHeaders
    };
    if (options.body !== undefined) {
        requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
        init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${route}`, init);
    return { status: response.status, data: await response.json() };
}

function actorRow(overrides = {}) {
    return {
        id: 42,
        username: 'hermes.schedule',
        role: 'employee',
        extra_roles: [],
        page_allowlist: [],
        action_allowlist: [],
        action_denylist: ['manage_staff'],
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        name: 'Hermes Schedule Reader',
        telegram_chat_id: null,
        is_active: true,
        ...overrides
    };
}

function staffRegistrationApprovalContext(overrides = {}) {
    const packetId = overrides.packetId || 'EG_STAFF_REG_PDF_FINISH_WAITER_20260819';
    return {
        sourceContext: 'staff_registration',
        packetId,
        chatId: '-1003979718101',
        messageId: '23',
        approvalType: 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE',
        approvalAction: 'APPROVE_CANDIDATE',
        crmWriteApproval: `APPROVE_EG_STAFF_REGISTRATION_CRM_ROSTER_CREATE_${packetId}_STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE`,
        ...overrides
    };
}

function staffCreateBody(overrides = {}) {
    return {
        name: 'Плющкіт',
        department: 'animators',
        position: 'Аніматор',
        roleType: 'animator',
        approvalContext: staffRegistrationApprovalContext(),
        ...overrides
    };
}

function staffCreateHeaders(apiKey, idempotencyKey) {
    return {
        'x-api-key': apiKey,
        'X-Integration-Id': 'hermes-event-genix-crm',
        'X-Hermes-User-Confirmed': 'true',
        'Idempotency-Key': idempotencyKey
    };
}

function assertBusinessWrites(body, staffWrites = 0) {
    assert.deepEqual({
        staffWrites: body.staffWrites,
        accountWrites: body.accountWrites,
        scheduleWrites: body.scheduleWrites,
        attendanceWrites: body.attendanceWrites,
        payrollWrites: body.payrollWrites
    }, {
        staffWrites,
        accountWrites: 0,
        scheduleWrites: 0,
        attendanceWrites: 0,
        payrollWrites: 0
    });
}

function createPool(options = {}) {
    const calls = [];
    const actor = options.actor || actorRow();
    const staffRows = options.staffRows || [{
        id: 746,
        name: 'Славицька Анна',
        display_name: 'Анна Славицька',
        department: 'admin',
        position: 'Адміністратор',
        role_type: 'administrator',
        secondary_professions: ['animator'],
        scheduleable: true,
        phone: '+380****0000',
        hourly_rate: 999
    }];
    const scheduleRows = options.scheduleRows || [{
        staff_id: 746,
        date: '2026-07-15',
        status: 'day_off',
        shift_start: null,
        shift_end: null,
        note: 'Test schedule note',
        profession_key: null
    }];
    const createdStaffRow = options.createdStaffRow || {
        id: 999,
        name: 'Плющкіт',
        display_name: 'Плющкіт',
        department: 'animators',
        position: 'Аніматор',
        role_type: 'animator',
        secondary_professions: [],
        scheduleable: true
    };
    const professionRows = options.professionRows === undefined
        ? [{ profession_key: 'waiter', title: 'Офіціант' }]
        : options.professionRows;
    const duplicateRows = [...(options.duplicateRows || [])];
    const idempotencyRecords = new Map();
    let nextIdempotencyId = 1;

    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) return { rows: [] };
        if (/FROM users[\s\S]*WHERE id = \$1/.test(sql)) return { rows: [actor] };
        if (/DELETE FROM integration_idempotency_keys/.test(sql)) return { rows: [] };
        if (/INSERT INTO integration_idempotency_keys/.test(sql)) {
            const recordKey = `${params[0]}:${params[1]}`;
            if (idempotencyRecords.has(recordKey)) return { rows: [] };
            const record = {
                id: nextIdempotencyId++,
                integration_id: params[0],
                idempotency_key: params[1],
                request_hash: params[2],
                response_status: null,
                response_body: null,
                created_at: new Date(),
                expires_at: new Date(Date.now() + 86400000)
            };
            idempotencyRecords.set(recordKey, record);
            return { rows: [record] };
        }
        if (/SELECT id, integration_id, idempotency_key[\s\S]*FROM integration_idempotency_keys/.test(sql)) {
            const record = idempotencyRecords.get(`${params[0]}:${params[1]}`);
            return { rows: record ? [record] : [] };
        }
        if (/UPDATE integration_idempotency_keys/.test(sql)) {
            const recordKey = `${params[0]}:${params[1]}`;
            const record = idempotencyRecords.get(recordKey);
            if (!record || record.request_hash !== params[2] || record.response_status !== null) return { rows: [] };
            record.response_status = params[3];
            record.response_body = JSON.parse(params[4]);
            return { rows: [record] };
        }
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (/FROM hr_professions/.test(sql)) return { rows: professionRows };
        if (/FROM staff s[\s\S]*LIMIT 5/.test(sql)) return { rows: duplicateRows };
        if (/WITH inserted AS \([\s\S]*INSERT INTO staff/.test(sql)) {
            duplicateRows.push({
                ...createdStaffRow,
                is_active: true,
                hr_pool_status: 'core',
                termination_date: null,
                is_freelance: false
            });
            return { rows: [createdStaffRow] };
        }
        if (/FROM staff s[\s\S]*ORDER BY s\.id ASC/.test(sql)) return { rows: staffRows };
        if (/FROM staff_schedule ss/.test(sql)) return { rows: scheduleRows };
        throw new Error(`Unexpected SQL: ${sql}`);
    };

    return {
        calls,
        query,
        async connect() {
            return {
                query,
                release() {}
            };
        }
    };
}

async function listenHermesTestApp(pool, env, options = {}) {
    const app = express();
    app.use(express.json());
    if (Array.isArray(options.auditReceipts)) {
        app.use('/api/hermes', (req, res, next) => {
            res.on('finish', () => options.auditReceipts.push(req.hermesMutation?.auditReceipt || null));
            next();
        });
    }
    app.use('/api/hermes', createHermesRouter({
        pool,
        env,
        rateLimit: false,
        authMiddleware: createHermesAuthMiddleware({ pool, env })
    }));
    return listen(app);
}

describe('Hermes staff and schedule read routes', () => {
    const env = {
        HERMES_API_KEY: 'unit-hermes-schedule-key',
        HERMES_ACTOR_USER_ID: '42'
    };
    let server;
    let baseUrl;
    let pool;

    before(async () => {
        pool = createPool();
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            pool,
            env,
            rateLimit: false,
            authMiddleware: createHermesAuthMiddleware({ pool, env })
        }));
        ({ server, baseUrl } = await listen(app));
    });

    after(async () => close(server));

    it('mounts the schedule subrouter only after Hermes auth', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'hermes.js'), 'utf8');
        const authIndex = source.indexOf('router.use(authMiddleware)');
        const scheduleIndex = source.indexOf("router.use('/', createHermesScheduleRouter");
        assert.ok(authIndex >= 0);
        assert.ok(scheduleIndex > authIndex);
    });

    it('rejects missing, invalid, JWT-like, and cookie-only credentials', async () => {
        const missing = await request(baseUrl, '/api/hermes/staff');
        assert.equal(missing.status, 401);
        assert.equal(missing.data.code, 'HERMES_AUTH_REQUIRED');

        const invalid = await request(baseUrl, '/api/hermes/staff', { 'x-api-key': 'wrong' });
        assert.equal(invalid.status, 401);
        assert.equal(invalid.data.code, 'HERMES_AUTH_INVALID');

        const jwtOnly = await request(baseUrl, '/api/hermes/staff', {
            Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature',
            Cookie: 'token=normal-crm-session'
        });
        assert.equal(jwtOnly.status, 401);
        assert.equal(jwtOnly.data.code, 'HERMES_AUTH_INVALID');

        const cookieOnly = await request(baseUrl, '/api/hermes/staff', { Cookie: 'token=normal-crm-session' });
        assert.equal(cookieOnly.status, 401);
        assert.equal(cookieOnly.data.code, 'HERMES_AUTH_REQUIRED');
    });

    it('returns only allowlisted staff fields with safe scheduleable defaults and bounded pagination', async () => {
        const response = await request(
            baseUrl,
            '/api/hermes/staff?limit=999&q=%20%D0%A1%D0%9B%D0%90%D0%92%D0%98%D0%A6%D0%AC%D0%9A%D0%90%20%20%D0%90%D0%9D%D0%9D%D0%90%20',
            { 'x-api-key': env.HERMES_API_KEY }
        );
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual(Object.keys(response.data.items[0]).sort(), [
            'department',
            'displayName',
            'name',
            'position',
            'professions',
            'roleType',
            'scheduleable',
            'staffId'
        ]);
        assert.equal(response.data.items[0].staffId, 746);
        assert.deepEqual(response.data.items[0].professions, ['administrator', 'animator']);
        assert.equal(response.data.pagination.limit, 50);
        assert.equal(response.data.meta.scheduleable, true);
        assert.equal(response.data.meta.includeFreelance, false);
        assert.equal(response.data.meta.qMatch, 'normalized_exact');
        assert.equal('phone' in response.data.items[0], false);
        assert.equal('hourly_rate' in response.data.items[0], false);

        const staffCall = pool.calls.find(call => /FROM staff s[\s\S]*ORDER BY s\.id ASC/.test(call.sql));
        assert.match(staffCall.sql, /COALESCE\(s\.hr_pool_status, 'core'\) = 'core'/);
        assert.match(staffCall.sql, /s\.termination_date IS NULL OR s\.termination_date::date > CURRENT_DATE::date/);
        assert.match(staffCall.sql, /COALESCE\(s\.is_freelance, false\) = false/);
        assert.match(staffCall.sql, /REGEXP_REPLACE/);
        assert.equal(staffCall.params.at(-1), 51);
    });

    it('returns normalized bounded schedule cells with deterministic state hashes', async () => {
        const response = await request(
            baseUrl,
            '/api/hermes/staff-schedule?dateFrom=2026-07-15&dateTo=2026-07-16&staffIds=746',
            { 'x-api-key': env.HERMES_API_KEY }
        );
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual(Object.keys(response.data.items[0]).sort(), [
            'date',
            'endTime',
            'note',
            'professionKey',
            'staffId',
            'startTime',
            'stateHash',
            'status'
        ]);
        assert.equal(response.data.items[0].status, 'dayoff');
        assert.match(response.data.items[0].stateHash, /^[a-f0-9]{64}$/);
        assert.equal(response.data.meta.days, 2);
        assert.deepEqual(response.data.meta.staffIds, [746]);

        const scheduleCall = pool.calls.find(call => /FROM staff_schedule ss/.test(call.sql));
        assert.match(scheduleCall.sql, /ss\.date >= \$1/);
        assert.match(scheduleCall.sql, /ss\.date <= \$2/);
        assert.doesNotMatch(scheduleCall.sql, /ss\.date >= \$1::date|ss\.date <= \$2::date/);
        assert.match(scheduleCall.sql, /ss\.staff_id = ANY\(\$3::int\[\]\)/);
        assert.match(scheduleCall.sql, /COALESCE\(s\.hr_pool_status, 'core'\) = 'core'/);
        assert.doesNotMatch(scheduleCall.sql, /phone|hourly_rate|payroll|document/i);
    });

    it('rejects ranges over 31 days and non-event_genix schedule reads', async () => {
        const tooLong = await request(
            baseUrl,
            '/api/hermes/staff-schedule?dateFrom=2026-07-01&dateTo=2026-08-01',
            { 'x-api-key': env.HERMES_API_KEY }
        );
        assert.equal(tooLong.status, 400);
        assert.equal(tooLong.data.code, 'HERMES_INVALID_DATE_RANGE');

        const wrongContext = await request(
            baseUrl,
            '/api/hermes/staff?businessContext=dar',
            { 'x-api-key': env.HERMES_API_KEY }
        );
        assert.equal(wrongContext.status, 403);
        assert.equal(wrongContext.data.code, 'HERMES_SCHEDULE_BUSINESS_CONTEXT_UNAVAILABLE');
    });

    it('advertises schedule read, preview, staff create, and granular capability requirements without granting manage_staff', async () => {
        const response = await request(baseUrl, '/api/hermes/capabilities', {
            'x-api-key': env.HERMES_API_KEY
        });
        assert.equal(response.status, 200);
        assert.ok(response.data.supportedActions.includes('staff.read'));
        assert.ok(response.data.supportedActions.includes('staff.create'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.read'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.preview'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.apply'));
        assert.ok(response.data.supportedActions.includes('attendance.preview'));
        assert.ok(response.data.supportedActions.includes('attendance.apply'));
        assert.equal(response.data.supportedActions.includes('manage_staff'), false);
        assert.equal(response.data.endpoints.staff.list, 'GET /api/hermes/staff');
        assert.equal(response.data.endpoints.staff.create, 'POST /api/hermes/staff');
        assert.equal(response.data.endpoints.staff.createRequiresConfirmation, true);
        assert.equal(response.data.endpoints.staff.createRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.staff.createRequiredCapability, 'hermes.staff.manage');
        assert.equal(response.data.endpoints.staff.createRequiresApprovalContext, true);
        assert.equal(response.data.endpoints.staff.createApprovalSourceContext, 'staff_registration');
        assert.equal(response.data.endpoints.staff.createApprovalType, 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE');
        assert.equal(response.data.endpoints.staff.createApprovalAction, 'APPROVE_CANDIDATE');
        assert.equal(
            response.data.endpoints.staff.createCrmWriteApprovalTemplate,
            'APPROVE_EG_STAFF_REGISTRATION_CRM_ROSTER_CREATE_<packetId>_STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE'
        );
        assert.equal(response.data.endpoints.staff.createAccountWrites, 0);
        assert.equal(response.data.endpoints.staff.createScheduleWrites, 0);
        assert.equal(response.data.endpoints.staff.createAttendanceWrites, 0);
        assert.equal(response.data.endpoints.staff.createPayrollWrites, 0);
        assert.equal(response.data.endpoints.staffSchedule.maxDateRangeDays, 31);
        assert.equal(response.data.endpoints.staffSchedule.preview, 'POST /api/hermes/staff-schedule/preview');
        assert.equal(response.data.endpoints.staffSchedule.previewScheduleWrites, 0);
        assert.equal(response.data.endpoints.staffSchedule.apply, 'POST /api/hermes/staff-schedule/apply');
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresConfirmation, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiredCapability, 'hermes.schedule.manage');
        assert.equal(response.data.endpoints.attendance.preview, 'POST /api/hermes/attendance/preview');
        assert.equal(response.data.endpoints.attendance.previewRequiredCapability, 'hermes.attendance.manage');
        assert.equal(response.data.endpoints.attendance.previewAttendanceWrites, 0);
        assert.equal(response.data.endpoints.attendance.previewScheduleWrites, 0);
        assert.equal(response.data.endpoints.attendance.scheduleWrites, 0);
        assert.equal(response.data.endpoints.attendance.apply, 'POST /api/hermes/attendance/apply');
        assert.equal(response.data.endpoints.attendance.applyRequiresConfirmation, true);
        assert.equal(response.data.endpoints.attendance.applyRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.attendance.applyRequiredCapability, 'hermes.attendance.manage');
        assert.equal(response.data.endpoints.attendance.applyScheduleWrites, 0);
    });

    it('creates a staff member through Hermes with clear no-schedule side effects', async () => {
        const createPoolWithManageStaff = createPool({
            actor: actorRow({
                role: 'manager',
                action_allowlist: ['hermes.staff.manage'],
                action_denylist: ['hermes.staff.manage', 'manage_staff']
            }),
            createdStaffRow: {
                id: 999,
                name: 'Плющкіт',
                display_name: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
                role_type: 'animator',
                secondary_professions: ['party_host'],
                scheduleable: true
            }
        });
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            pool: createPoolWithManageStaff,
            env,
            rateLimit: false,
            authMiddleware: createHermesAuthMiddleware({ pool: createPoolWithManageStaff, env })
        }));
        const { server: createServer, baseUrl: createBaseUrl } = await listen(app);
        try {
            const response = await request(
                createBaseUrl,
                '/api/hermes/staff',
                {
                    'x-api-key': env.HERMES_API_KEY,
                    'X-Integration-Id': 'hermes-event-genix-crm',
                    'X-Hermes-User-Confirmed': 'true',
                    'Idempotency-Key': 'staff-create-plushkit'
                },
                {
                    method: 'POST',
                    body: staffCreateBody({
                        name: '  Плющкіт  ',
                        secondaryProfessions: ['party_host'],
                        telegramUsername: '@plushkit_bot',
                        hireDate: '2026-07-15',
                        color: '#8B5CF6'
                    })
                }
            );

            assert.equal(response.status, 201, JSON.stringify(response.data));
            assert.equal(response.data.ok, true);
            assert.equal(response.data.outcome, 'CREATED_STAFF_ONLY');
            assert.equal(response.data.staffId, 999);
            assert.deepEqual({
                staffWrites: response.data.staffWrites,
                accountWrites: response.data.accountWrites,
                scheduleWrites: response.data.scheduleWrites,
                attendanceWrites: response.data.attendanceWrites,
                payrollWrites: response.data.payrollWrites
            }, {
                staffWrites: 1,
                accountWrites: 0,
                scheduleWrites: 0,
                attendanceWrites: 0,
                payrollWrites: 0
            });
            assert.deepEqual(response.data.data, {
                staffId: 999,
                name: 'Плющкіт',
                displayName: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
                roleType: 'animator',
                professions: ['animator', 'party_host'],
                scheduleable: true
            });
            assert.deepEqual(response.data.meta, {
                businessContext: 'event_genix',
                staffWrites: 1,
                scheduleWrites: 0,
                scheduleTouched: false,
                applyRequiresSeparateScheduleApproval: true,
                sanitized: true,
                approvalContext: {
                    sourceContext: 'staff_registration',
                    packetId: 'EG_STAFF_REG_PDF_FINISH_WAITER_20260819',
                    chatId: '-1003979718101',
                    messageId: '23',
                    approvalType: 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE',
                    approvalAction: 'APPROVE_CANDIDATE',
                    crmWriteApprovalPresent: true,
                    crmWriteApprovalMatchesPacket: true
                },
                userMessage: 'Плющкіт створено у списку персоналу. Графік не змінювався.'
            });
            assert.equal(
                JSON.stringify(response.data).includes(
                    'APPROVE_EG_STAFF_REGISTRATION_CRM_ROSTER_CREATE_EG_STAFF_REG_PDF_FINISH_WAITER_20260819_STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE'
                ),
                false
            );
            const insertCall = createPoolWithManageStaff.calls.find(call => /INSERT INTO staff/.test(call.sql));
            assert.ok(insertCall);
            assert.deepEqual(insertCall.params, [
                'Плющкіт',
                'animators',
                'Аніматор',
                null,
                '2026-07-15',
                '#8B5CF6',
                'plushkit_bot',
                'animator',
                null,
                '["party_host"]'
            ]);
            const lockIndex = createPoolWithManageStaff.calls.findIndex(call => /pg_advisory_xact_lock/.test(call.sql));
            const duplicateIndex = createPoolWithManageStaff.calls.findIndex(call => /FROM staff s[\s\S]*LIMIT 5/.test(call.sql));
            const insertIndex = createPoolWithManageStaff.calls.findIndex(call => /INSERT INTO staff/.test(call.sql));
            assert.ok(lockIndex >= 0 && duplicateIndex > lockIndex && insertIndex > duplicateIndex);
            assert.equal(createPoolWithManageStaff.calls.some(call => /staff_schedule|hr_shifts/i.test(call.sql)), false);
        } finally {
            await close(createServer);
        }
    });

    it('replays the same idempotency key without a second insert and still blocks a fresh-key duplicate', async () => {
        const idempotentPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] }),
            createdStaffRow: {
                id: 1001,
                name: 'Ідемпотентний Працівник',
                display_name: 'Ідемпотентний Працівник',
                department: 'animators',
                position: 'Аніматор',
                role_type: 'animator',
                secondary_professions: [],
                scheduleable: true
            }
        });
        const auditReceipts = [];
        const { server: idempotentServer, baseUrl: idempotentBaseUrl } = await listenHermesTestApp(
            idempotentPool,
            env,
            { auditReceipts }
        );
        const body = staffCreateBody({ name: 'Ідемпотентний Працівник' });
        try {
            const first = await request(
                idempotentBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-idempotent-repeat'),
                { method: 'POST', body }
            );
            const replay = await request(
                idempotentBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-idempotent-repeat'),
                { method: 'POST', body }
            );
            const freshKey = await request(
                idempotentBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-idempotent-fresh-key'),
                { method: 'POST', body }
            );

            assert.equal(first.status, 201, JSON.stringify(first.data));
            assert.deepEqual(replay, first);
            assert.equal(freshKey.status, 409, JSON.stringify(freshKey.data));
            assert.equal(freshKey.data.code, 'HERMES_STAFF_ALREADY_EXISTS');
            assert.equal(freshKey.data.outcome, 'ALREADY_EXISTS_NO_CREATE');
            assert.equal(freshKey.data.staffId, 1001);
            assertBusinessWrites(freshKey.data, 0);
            assert.equal(
                idempotentPool.calls.filter(call => /WITH inserted AS \([\s\S]*INSERT INTO staff/.test(call.sql)).length,
                1
            );
            assert.equal(auditReceipts.length, 3);
            assert.deepEqual(auditReceipts.map(receipt => ({
                outcome: receipt.outcome,
                staffId: receipt.staffId,
                idempotencyReplay: receipt.idempotencyReplay,
                staffWrites: receipt.businessWrites.staffWrites
            })), [
                {
                    outcome: 'CREATED_STAFF_ONLY',
                    staffId: 1001,
                    idempotencyReplay: false,
                    staffWrites: 1
                },
                {
                    outcome: 'CREATED_STAFF_ONLY',
                    staffId: 1001,
                    idempotencyReplay: true,
                    staffWrites: 0
                },
                {
                    outcome: 'ALREADY_EXISTS_NO_CREATE',
                    staffId: 1001,
                    idempotencyReplay: false,
                    staffWrites: 0
                }
            ]);
        } finally {
            await close(idempotentServer);
        }
    });

    it('requires Hermes integration id, confirmation, idempotency, and API-key auth for staff create', async () => {
        const guardedPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] })
        });
        const auditReceipts = [];
        const { server: guardedServer, baseUrl: guardedBaseUrl } = await listenHermesTestApp(
            guardedPool,
            env,
            { auditReceipts }
        );
        const body = staffCreateBody();
        try {
            const missingIntegration = await request(guardedBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-missing-integration'
            }, { method: 'POST', body });
            assert.equal(missingIntegration.status, 400);
            assert.equal(missingIntegration.data.code, 'HERMES_INTEGRATION_ID_REQUIRED');

            const missingConfirmation = await request(guardedBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'Idempotency-Key': 'staff-create-missing-confirmation'
            }, { method: 'POST', body });
            assert.equal(missingConfirmation.status, 400);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');

            const missingIdempotency = await request(guardedBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true'
            }, { method: 'POST', body });
            assert.equal(missingIdempotency.status, 400);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

            const crmSessionOnly = await request(guardedBaseUrl, '/api/hermes/staff', {
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature',
                Cookie: 'token=normal-crm-session',
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-crm-session-only'
            }, { method: 'POST', body });
            assert.equal(crmSessionOnly.status, 401);
            assert.equal(crmSessionOnly.data.code, 'HERMES_AUTH_INVALID');
            assert.equal(guardedPool.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
            assert.equal(auditReceipts.length, 4);
            for (const receipt of auditReceipts.slice(0, 3)) {
                assert.equal(receipt.outcome, 'NO_CREATE');
                assert.equal(receipt.approvalContext.packetId, 'EG_STAFF_REG_PDF_FINISH_WAITER_20260819');
                assert.equal(receipt.businessWrites.staffWrites, 0);
            }
            assert.equal(auditReceipts[3], null);
        } finally {
            await close(guardedServer);
        }
    });

    it('requires the exact packet-bound CRM write approval before any staff or idempotency write', async () => {
        const approvalPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] })
        });
        const auditReceipts = [];
        const { server: approvalServer, baseUrl: approvalBaseUrl } = await listenHermesTestApp(
            approvalPool,
            env,
            { auditReceipts }
        );
        try {
            const cases = [
                {
                    key: 'missing',
                    approvalContext: undefined
                },
                {
                    key: 'mismatch',
                    approvalContext: staffRegistrationApprovalContext({
                        crmWriteApproval: 'APPROVE_EG_STAFF_REGISTRATION_CRM_ROSTER_CREATE_WRONG_PACKET_STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE'
                    })
                },
                {
                    key: 'wrong-action',
                    approvalContext: staffRegistrationApprovalContext({ approvalAction: 'APPROVE_SCHEDULE' })
                },
                {
                    key: 'private-allowlisted-values',
                    approvalContext: {
                        sourceContext: 'Private Candidate Name',
                        packetId: 'private phone +380001112233',
                        chatId: 'raw-private-chat-text',
                        messageId: 'raw-private-message-text',
                        approvalType: 'raw-private-approval-type',
                        approvalAction: 'raw-private-approval-action',
                        crmWriteApproval: 'raw-private-crm-write-approval'
                    }
                }
            ];

            for (const scenario of cases) {
                const response = await request(
                    approvalBaseUrl,
                    '/api/hermes/staff',
                    staffCreateHeaders(env.HERMES_API_KEY, `staff-create-approval-${scenario.key}`),
                    {
                        method: 'POST',
                        body: staffCreateBody({ approvalContext: scenario.approvalContext })
                    }
                );
                assert.equal(response.status, 400, `${scenario.key}: ${JSON.stringify(response.data)}`);
                assert.equal(response.data.success, false);
                assert.equal(response.data.ok, false);
                assert.equal(
                    response.data.code,
                    'HERMES_STAFF_REGISTRATION_CRM_WRITE_APPROVAL_REQUIRED'
                );
                assert.equal(response.data.outcome, 'NO_CREATE');
                assertBusinessWrites(response.data, 0);
            }

            assert.equal(approvalPool.calls.some(call => /integration_idempotency_keys/.test(call.sql)), false);
            assert.equal(approvalPool.calls.some(call => /FROM staff|INSERT INTO staff/.test(call.sql)), false);
            assert.equal(auditReceipts.length, cases.length);
            const serializedReceipts = JSON.stringify(auditReceipts);
            for (const privateValue of [
                'Private Candidate Name',
                'private phone +380001112233',
                'raw-private-chat-text',
                'raw-private-message-text',
                'raw-private-approval-type',
                'raw-private-approval-action',
                'raw-private-crm-write-approval'
            ]) {
                assert.equal(serializedReceipts.includes(privateValue), false);
            }
            assert.deepEqual(auditReceipts.at(-1).approvalContext, {
                sourceContext: '',
                packetId: '',
                chatId: '',
                messageId: '',
                approvalType: '',
                approvalAction: '',
                crmWriteApprovalPresent: true,
                crmWriteApprovalMatchesPacket: false
            });
        } finally {
            await close(approvalServer);
        }
    });

    it('rejects a Hermes actor without hermes.staff.manage before staff queries', async () => {
        const deniedPool = createPool();
        const auditReceipts = [];
        const { server: deniedServer, baseUrl: deniedBaseUrl } = await listenHermesTestApp(
            deniedPool,
            env,
            { auditReceipts }
        );
        try {
            const response = await request(deniedBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-permission-denied'
            }, {
                method: 'POST',
                body: staffCreateBody()
            });
            assert.equal(response.status, 403);
            assert.equal(response.data.code, 'HERMES_CAPABILITY_REQUIRED');
            assert.equal(deniedPool.calls.some(call => /FROM staff|INSERT INTO staff/.test(call.sql)), false);
            assert.equal(auditReceipts.length, 1);
            assert.equal(auditReceipts[0].outcome, 'NO_CREATE');
            assert.equal(auditReceipts[0].approvalContext.crmWriteApprovalMatchesPacket, true);
            assertBusinessWrites(auditReceipts[0].businessWrites, 0);
        } finally {
            await close(deniedServer);
        }
    });

    it('rejects normalized duplicate staff names with a sanitized existing envelope', async () => {
        const duplicatePool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] }),
            duplicateRows: [{
                id: 321,
                name: 'Плющкіт',
                display_name: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
                role_type: 'animator',
                secondary_professions: [],
                scheduleable: true,
                phone: '+380000000000',
                hourly_rate: 999
            }]
        });
        const { server: duplicateServer, baseUrl: duplicateBaseUrl } = await listenHermesTestApp(duplicatePool, env);
        try {
            const response = await request(duplicateBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-normalized-duplicate'
            }, {
                method: 'POST',
                body: staffCreateBody({
                    name: '  ПЛЮЩКІТ  ',
                })
            });
            assert.equal(response.status, 409, JSON.stringify(response.data));
            assert.equal(response.data.code, 'HERMES_STAFF_ALREADY_EXISTS');
            assert.equal(response.data.ok, false);
            assert.equal(response.data.outcome, 'ALREADY_EXISTS_NO_CREATE');
            assert.equal(response.data.staffId, 321);
            assert.deepEqual({
                staffWrites: response.data.staffWrites,
                accountWrites: response.data.accountWrites,
                scheduleWrites: response.data.scheduleWrites,
                attendanceWrites: response.data.attendanceWrites,
                payrollWrites: response.data.payrollWrites
            }, {
                staffWrites: 0,
                accountWrites: 0,
                scheduleWrites: 0,
                attendanceWrites: 0,
                payrollWrites: 0
            });
            assert.deepEqual(response.data.meta.existing, [{
                staffId: 321,
                name: 'Плющкіт',
                displayName: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
                roleType: 'animator',
                professions: ['animator'],
                scheduleable: true
            }]);
            assert.equal(response.data.meta.userMessage, 'Плющкіт вже є в CRM (#321). Нічого не дублюю.');
            assert.equal(duplicatePool.calls.find(call => /FROM staff s[\s\S]*LIMIT 5/.test(call.sql))?.params[0], 'плющкіт');
            assert.equal(duplicatePool.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
        } finally {
            await close(duplicateServer);
        }
    });

    it('returns the approved waiter fixture as a safe terminal existing record without writes', async () => {
        const fixturePool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] }),
            duplicateRows: [{
                id: 937,
                name: 'Тарілкін Левко Підносович',
                display_name: 'Тарілкін Левко Підносович',
                department: 'cafe',
                position: 'Офіціант',
                role_type: 'waiter',
                secondary_professions: [],
                is_active: true,
                hr_pool_status: 'core',
                termination_date: null,
                is_freelance: false,
                scheduleable: true
            }]
        });
        const { server: fixtureServer, baseUrl: fixtureBaseUrl } = await listenHermesTestApp(fixturePool, env);
        try {
            const response = await request(
                fixtureBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-waiter-fixture-937'),
                {
                    method: 'POST',
                    body: staffCreateBody({
                        name: 'Тарілкін Левко Підносович',
                        department: 'cafe',
                        position: 'Офіціант',
                        roleType: 'waiter'
                    })
                }
            );

            assert.equal(response.status, 409, JSON.stringify(response.data));
            assert.equal(response.data.code, 'HERMES_STAFF_ALREADY_EXISTS');
            assert.equal(response.data.outcome, 'ALREADY_EXISTS_NO_CREATE');
            assert.equal(response.data.staffId, 937);
            assertBusinessWrites(response.data, 0);
            assert.deepEqual(response.data.meta.existing, [{
                staffId: 937,
                name: 'Тарілкін Левко Підносович',
                displayName: 'Тарілкін Левко Підносович',
                department: 'cafe',
                position: 'Офіціант',
                roleType: 'waiter',
                professions: ['waiter'],
                scheduleable: true
            }]);
            assert.equal(Object.hasOwn(response.data.meta.existing[0], 'is_active'), false);
            assert.equal(Object.hasOwn(response.data.meta.existing[0], 'hr_pool_status'), false);
            const professionCall = fixturePool.calls.find(call => /FROM hr_professions/.test(call.sql));
            assert.ok(professionCall);
            assert.match(professionCall.sql, /SELECT key AS profession_key, title/);
            assert.match(professionCall.sql, /WHERE key = \$1/);
            assert.equal(fixturePool.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
        } finally {
            await close(fixtureServer);
        }
    });

    it('fails closed for inactive or multiple normalized staff matches', async () => {
        const scenarios = [
            {
                key: 'inactive',
                duplicateRows: [{
                    id: 401,
                    name: 'Неоднозначний Працівник',
                    display_name: 'Неоднозначний Працівник',
                    department: 'animators',
                    position: 'Аніматор',
                    role_type: 'animator',
                    secondary_professions: [],
                    is_active: false,
                    hr_pool_status: 'core',
                    scheduleable: false
                }]
            },
            {
                key: 'multiple',
                duplicateRows: [401, 402].map(id => ({
                    id,
                    name: 'Неоднозначний Працівник',
                    display_name: 'Неоднозначний Працівник',
                    department: 'animators',
                    position: 'Аніматор',
                    role_type: 'animator',
                    secondary_professions: [],
                    is_active: true,
                    hr_pool_status: 'core',
                    scheduleable: true
                }))
            },
            {
                key: 'active-mapping-mismatch',
                duplicateRows: [{
                    id: 403,
                    name: 'Неоднозначний Працівник',
                    display_name: 'Неоднозначний Працівник',
                    department: 'cafe',
                    position: 'Офіціант',
                    role_type: 'waiter',
                    secondary_professions: [],
                    is_active: true,
                    hr_pool_status: 'core',
                    scheduleable: true
                }]
            }
        ];

        for (const scenario of scenarios) {
            const ambiguousPool = createPool({
                actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] }),
                duplicateRows: scenario.duplicateRows
            });
            const { server: ambiguousServer, baseUrl: ambiguousBaseUrl } = await listenHermesTestApp(ambiguousPool, env);
            try {
                const response = await request(
                    ambiguousBaseUrl,
                    '/api/hermes/staff',
                    staffCreateHeaders(env.HERMES_API_KEY, `staff-create-ambiguous-${scenario.key}`),
                    {
                        method: 'POST',
                        body: staffCreateBody({ name: 'Неоднозначний Працівник' })
                    }
                );
                assert.equal(response.status, 409, `${scenario.key}: ${JSON.stringify(response.data)}`);
                assert.equal(response.data.code, 'STAFF_DUPLICATE_AMBIGUOUS_REVIEW_REQUIRED');
                assert.equal(response.data.outcome, 'NO_CREATE_REVIEW_REQUIRED');
                assertBusinessWrites(response.data, 0);
                assert.deepEqual(response.data.matches, response.data.meta.matches);
                assert.equal(response.data.meta.matches.length, scenario.duplicateRows.length);
                assert.equal(Object.hasOwn(response.data.meta.matches[0], 'is_active'), false);
                assert.equal(Object.hasOwn(response.data.meta.matches[0], 'hr_pool_status'), false);
                assert.equal(ambiguousPool.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
            } finally {
                await close(ambiguousServer);
            }
        }
    });

    it('accepts snake_case profession aliases and strips @ from Telegram username', async () => {
        const aliasPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] }),
            createdStaffRow: {
                id: 1000,
                name: 'Плющкіт Alias',
                display_name: 'Плющкіт Alias',
                department: 'animators',
                position: 'Аніматор',
                role_type: 'animator',
                secondary_professions: ['party_host'],
                scheduleable: true
            }
        });
        const { server: aliasServer, baseUrl: aliasBaseUrl } = await listenHermesTestApp(aliasPool, env);
        try {
            const response = await request(aliasBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-snake-aliases'
            }, {
                method: 'POST',
                body: staffCreateBody({
                    name: 'Плющкіт Alias',
                    roleType: undefined,
                    role_type: 'animator',
                    secondary_professions: ['party_host'],
                    telegramUsername: '@plushkit_alias'
                })
            });
            assert.equal(response.status, 201, JSON.stringify(response.data));
            assert.deepEqual(response.data.data.professions, ['animator', 'party_host']);
            const insertCall = aliasPool.calls.find(call => /INSERT INTO staff/.test(call.sql));
            assert.equal(insertCall.params[6], 'plushkit_alias');
            assert.equal(insertCall.params[7], 'animator');
            assert.equal(insertCall.params[9], '["party_host"]');
        } finally {
            await close(aliasServer);
        }
    });

    it('rejects an inconsistent waiter department/position/role mapping without correction', async () => {
        const mappingPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] })
        });
        const { server: mappingServer, baseUrl: mappingBaseUrl } = await listenHermesTestApp(mappingPool, env);
        try {
            const response = await request(
                mappingBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-inconsistent-waiter'),
                {
                    method: 'POST',
                    body: staffCreateBody({
                        name: 'Некоректний Офіціант',
                        department: 'cafe',
                        position: 'Бариста',
                        roleType: 'waiter'
                    })
                }
            );

            assert.equal(response.status, 409, JSON.stringify(response.data));
            assert.equal(response.data.code, 'INCONSISTENT_STAFF_ROLE_MAPPING');
            assert.equal(response.data.outcome, 'NO_CREATE');
            assertBusinessWrites(response.data, 0);
            assert.deepEqual(response.data.meta.expected, {
                department: 'cafe',
                position: 'Офіціант',
                roleType: 'waiter'
            });
            assert.deepEqual(response.data.meta.received, {
                department: 'cafe',
                position: 'Бариста',
                roleType: 'waiter'
            });
            assert.equal(mappingPool.calls.some(call => /FROM staff s[\s\S]*LIMIT 5/.test(call.sql)), false);
            assert.equal(mappingPool.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
        } finally {
            await close(mappingServer);
        }
    });

    it('rejects account, credential, dry-run, payroll, attendance, and KPI fields without writes', async () => {
        const policyPool = createPool({
            actor: actorRow({ role: 'manager', action_allowlist: ['hermes.staff.manage'], action_denylist: [] })
        });
        const { server: policyServer, baseUrl: policyBaseUrl } = await listenHermesTestApp(policyPool, env);
        try {
            const forbiddenFields = [
                'account',
                'accountPayload',
                'accountSettings',
                'username',
                'login',
                'password',
                'passwordConfirmation',
                'dryRun',
                'dry_run',
                'payroll',
                'payrollPayload',
                'attendance',
                'attendanceData',
                'kpi',
                'kpiWrites',
                'unknownMetadata'
            ];
            for (const field of forbiddenFields) {
                const response = await request(
                    policyBaseUrl,
                    '/api/hermes/staff',
                    staffCreateHeaders(env.HERMES_API_KEY, `staff-create-cross-lane-${field}`),
                    {
                        method: 'POST',
                        body: staffCreateBody({ [field]: field === 'username' ? 'candidate.login' : {} })
                    }
                );
                assert.equal(response.status, 400, `${field}: ${JSON.stringify(response.data)}`);
                assert.equal(response.data.code, 'FORBIDDEN_FIELDS_FOR_STAFF_ONLY_CREATE');
                assert.equal(response.data.policyCode, 'FORBIDDEN_FIELDS_FOR_STAFF_ONLY_CREATE');
                assert.equal(response.data.outcome, 'NO_CREATE');
                assert.deepEqual(response.data.forbiddenFields, [field]);
                assertBusinessWrites(response.data, 0);
            }
            const missingRole = await request(
                policyBaseUrl,
                '/api/hermes/staff',
                staffCreateHeaders(env.HERMES_API_KEY, 'staff-create-missing-role-type'),
                {
                    method: 'POST',
                    body: staffCreateBody({
                        department: 'cafe',
                        position: 'Офіціант',
                        roleType: undefined
                    })
                }
            );
            assert.equal(missingRole.status, 400, JSON.stringify(missingRole.data));
            assert.equal(missingRole.data.code, 'HERMES_STAFF_CREATE_INVALID_PAYLOAD');
            assert.equal(missingRole.data.outcome, 'NO_CREATE');
            assertBusinessWrites(missingRole.data, 0);
            assert.equal(policyPool.calls.some(call => /integration_idempotency_keys/.test(call.sql)), false);
            assert.equal(policyPool.calls.some(call => /FROM staff|INSERT INTO staff/.test(call.sql)), false);
        } finally {
            await close(policyServer);
        }
    });

    it('keeps staff creation separate from schedule changes', async () => {
        const createPoolWithManageStaff = createPool({
            actor: actorRow({
                role: 'manager',
                action_allowlist: ['hermes.staff.manage'],
                action_denylist: []
            })
        });
        const { server: createServer, baseUrl: createBaseUrl } = await listenHermesTestApp(createPoolWithManageStaff, env);
        try {
            const forbiddenScheduleFields = [
                'date',
                'dateFrom',
                'dateTo',
                'startTime',
                'endTime',
                'shiftStart',
                'shiftEnd',
                'schedule',
                'schedulePayload',
                'scheduleRows',
                'staffSchedule',
                'status'
            ];
            for (const field of forbiddenScheduleFields) {
                const response = await request(createBaseUrl, '/api/hermes/staff', {
                    'x-api-key': env.HERMES_API_KEY,
                    'X-Integration-Id': 'hermes-event-genix-crm',
                    'X-Hermes-User-Confirmed': 'true',
                    'Idempotency-Key': `staff-create-schedule-field-${field}`
                }, {
                    method: 'POST',
                    body: staffCreateBody({
                        [field]: null
                    })
                });
                assert.equal(response.status, 400, `${field}: ${JSON.stringify(response.data)}`);
                assert.equal(response.data.code, 'HERMES_STAFF_CREATE_SCHEDULE_SEPARATE_APPROVAL_REQUIRED');
                assert.equal(response.data.policyCode, 'FORBIDDEN_FIELDS_FOR_STAFF_ONLY_CREATE');
                assert.equal(response.data.outcome, 'NO_CREATE');
                assert.deepEqual(response.data.forbiddenFields, [field]);
                assert.equal(response.data.staffWrites, 0);
                assert.equal(response.data.accountWrites, 0);
                assert.equal(response.data.scheduleWrites, 0);
                assert.equal(response.data.attendanceWrites, 0);
                assert.equal(response.data.payrollWrites, 0);
                assert.deepEqual(response.data.meta.fields, [field]);
            }
            assert.equal(createPoolWithManageStaff.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
            assert.equal(createPoolWithManageStaff.calls.some(call => /staff_schedule|hr_shifts/i.test(call.sql)), false);
        } finally {
            await close(createServer);
        }
    });
});
