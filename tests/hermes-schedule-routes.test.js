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
    const idempotencyRecord = {
        id: 1,
        integration_id: 'hermes-event-genix-crm',
        idempotency_key: 'unit-key',
        request_hash: 'unit-hash',
        response_status: null,
        response_body: null,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400000)
    };

    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) return { rows: [] };
        if (/FROM users[\s\S]*WHERE id = \$1/.test(sql)) return { rows: [actor] };
        if (/DELETE FROM integration_idempotency_keys/.test(sql)) return { rows: [] };
        if (/INSERT INTO integration_idempotency_keys/.test(sql)) return { rows: [idempotencyRecord] };
        if (/UPDATE integration_idempotency_keys/.test(sql)) return { rows: [{ ...idempotencyRecord, response_status: params[3], response_body: params[4] }] };
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (/FROM staff s[\s\S]*LIMIT 5/.test(sql)) return { rows: options.duplicateRows || [] };
        if (/WITH inserted AS \([\s\S]*INSERT INTO staff/.test(sql)) return { rows: [createdStaffRow] };
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

async function listenHermesTestApp(pool, env) {
    const app = express();
    app.use(express.json());
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

    it('advertises schedule read, preview, staff create, and gated apply capabilities without granting manage_staff', async () => {
        const response = await request(baseUrl, '/api/hermes/capabilities', {
            'x-api-key': env.HERMES_API_KEY
        });
        assert.equal(response.status, 200);
        assert.ok(response.data.supportedActions.includes('staff.read'));
        assert.ok(response.data.supportedActions.includes('staff.create'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.read'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.preview'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.apply'));
        assert.equal(response.data.supportedActions.includes('manage_staff'), false);
        assert.equal(response.data.endpoints.staff.list, 'GET /api/hermes/staff');
        assert.equal(response.data.endpoints.staff.create, 'POST /api/hermes/staff');
        assert.equal(response.data.endpoints.staff.createRequiresConfirmation, true);
        assert.equal(response.data.endpoints.staff.createRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.staff.createRequiresManageStaff, true);
        assert.equal(response.data.endpoints.staff.createScheduleWrites, 0);
        assert.equal(response.data.endpoints.staffSchedule.maxDateRangeDays, 31);
        assert.equal(response.data.endpoints.staffSchedule.preview, 'POST /api/hermes/staff-schedule/preview');
        assert.equal(response.data.endpoints.staffSchedule.previewScheduleWrites, 0);
        assert.equal(response.data.endpoints.staffSchedule.apply, 'POST /api/hermes/staff-schedule/apply');
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresConfirmation, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresManageStaff, true);
    });

    it('creates a staff member through Hermes with clear no-schedule side effects', async () => {
        const createPoolWithManageStaff = createPool({
            actor: actorRow({
                action_allowlist: ['manage_staff'],
                action_denylist: []
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
                    body: {
                        name: '  Плющкіт  ',
                        department: 'animators',
                        position: 'Аніматор',
                        roleType: 'animator',
                        secondaryProfessions: ['party_host'],
                        telegramUsername: '@plushkit_bot',
                        hireDate: '2026-07-15',
                        color: '#8B5CF6'
                    }
                }
            );

            assert.equal(response.status, 201, JSON.stringify(response.data));
            assert.deepEqual(response.data.data, {
                staffId: 999,
                name: 'Плющкіт',
                displayName: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
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
                userMessage: 'Плющкіт створено у списку персоналу. Графік не змінювався.'
            });
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

    it('requires Hermes integration id, confirmation, idempotency, and API-key auth for staff create', async () => {
        const guardedPool = createPool({
            actor: actorRow({ action_allowlist: ['manage_staff'], action_denylist: [] })
        });
        const { server: guardedServer, baseUrl: guardedBaseUrl } = await listenHermesTestApp(guardedPool, env);
        const body = {
            name: 'Плющкіт',
            department: 'animators',
            position: 'Аніматор',
            roleType: 'animator'
        };
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
        } finally {
            await close(guardedServer);
        }
    });

    it('rejects a Hermes actor without manage_staff before staff queries', async () => {
        const deniedPool = createPool();
        const { server: deniedServer, baseUrl: deniedBaseUrl } = await listenHermesTestApp(deniedPool, env);
        try {
            const response = await request(deniedBaseUrl, '/api/hermes/staff', {
                'x-api-key': env.HERMES_API_KEY,
                'X-Integration-Id': 'hermes-event-genix-crm',
                'X-Hermes-User-Confirmed': 'true',
                'Idempotency-Key': 'staff-create-permission-denied'
            }, {
                method: 'POST',
                body: {
                    name: 'Плющкіт',
                    department: 'animators',
                    position: 'Аніматор',
                    roleType: 'animator'
                }
            });
            assert.equal(response.status, 403);
            assert.equal(response.data.code, 'HERMES_MANAGE_STAFF_REQUIRED');
            assert.equal(deniedPool.calls.some(call => /FROM staff|INSERT INTO staff/.test(call.sql)), false);
        } finally {
            await close(deniedServer);
        }
    });

    it('rejects normalized duplicate staff names with a sanitized existing envelope', async () => {
        const duplicatePool = createPool({
            actor: actorRow({ action_allowlist: ['manage_staff'], action_denylist: [] }),
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
                body: {
                    name: '  ПЛЮЩКІТ  ',
                    department: 'animators',
                    position: 'Аніматор',
                    roleType: 'animator'
                }
            });
            assert.equal(response.status, 409, JSON.stringify(response.data));
            assert.equal(response.data.code, 'HERMES_STAFF_ALREADY_EXISTS');
            assert.deepEqual(response.data.meta.existing, [{
                staffId: 321,
                name: 'Плющкіт',
                displayName: 'Плющкіт',
                department: 'animators',
                position: 'Аніматор',
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

    it('accepts snake_case profession aliases and strips @ from Telegram username', async () => {
        const aliasPool = createPool({
            actor: actorRow({ action_allowlist: ['manage_staff'], action_denylist: [] }),
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
                body: {
                    name: 'Плющкіт Alias',
                    department: 'animators',
                    position: 'Аніматор',
                    role_type: 'animator',
                    secondary_professions: ['party_host'],
                    telegramUsername: '@plushkit_alias'
                }
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

    it('keeps staff creation separate from schedule changes', async () => {
        const createPoolWithManageStaff = createPool({
            actor: actorRow({
                action_allowlist: ['manage_staff'],
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
                    body: {
                        name: 'Плющкіт',
                        department: 'animators',
                        position: 'Аніматор',
                        roleType: 'animator',
                        [field]: null
                    }
                });
                assert.equal(response.status, 400, `${field}: ${JSON.stringify(response.data)}`);
                assert.equal(response.data.code, 'HERMES_STAFF_CREATE_SCHEDULE_SEPARATE_APPROVAL_REQUIRED');
                assert.deepEqual(response.data.meta.fields, [field]);
            }
            assert.equal(createPoolWithManageStaff.calls.some(call => /INSERT INTO staff/.test(call.sql)), false);
            assert.equal(createPoolWithManageStaff.calls.some(call => /staff_schedule|hr_shifts/i.test(call.sql)), false);
        } finally {
            await close(createServer);
        }
    });
});
