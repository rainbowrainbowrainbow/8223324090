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

async function request(baseUrl, route, headers = {}) {
    const response = await fetch(`${baseUrl}${route}`, { headers });
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
        phone: '+380000000000',
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

    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/FROM users[\s\S]*WHERE id = \$1/.test(sql)) return { rows: [actor] };
            if (/FROM staff s[\s\S]*ORDER BY s\.id ASC/.test(sql)) return { rows: staffRows };
            if (/FROM staff_schedule ss/.test(sql)) return { rows: scheduleRows };
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
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

    it('advertises schedule read, preview, and gated apply capabilities without granting manage_staff', async () => {
        const response = await request(baseUrl, '/api/hermes/capabilities', {
            'x-api-key': env.HERMES_API_KEY
        });
        assert.equal(response.status, 200);
        assert.ok(response.data.supportedActions.includes('staff.read'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.read'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.preview'));
        assert.ok(response.data.supportedActions.includes('staff_schedule.apply'));
        assert.equal(response.data.supportedActions.includes('manage_staff'), false);
        assert.equal(response.data.endpoints.staff.list, 'GET /api/hermes/staff');
        assert.equal(response.data.endpoints.staffSchedule.maxDateRangeDays, 31);
        assert.equal(response.data.endpoints.staffSchedule.preview, 'POST /api/hermes/staff-schedule/preview');
        assert.equal(response.data.endpoints.staffSchedule.previewScheduleWrites, 0);
        assert.equal(response.data.endpoints.staffSchedule.apply, 'POST /api/hermes/staff-schedule/apply');
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresConfirmation, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresIdempotencyKey, true);
        assert.equal(response.data.endpoints.staffSchedule.applyRequiresManageStaff, true);
    });
});
