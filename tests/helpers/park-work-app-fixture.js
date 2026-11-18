'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { getToken, request, BASE_URL } = require('../helpers');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

async function createParkWorkFixture(roles = ['waiter', 'instructor', 'hr']) {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(BASE_URL);
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        const suffix = crypto.randomBytes(6).toString('hex');
        const token = await getToken();
        const verified = await request('GET', '/api/auth/verify', null, token);
        assert.equal(verified.status, 200);
        const root = { id: Number(verified.data.user.id), token, user: verified.data.user, role: 'creator' };
        const { rows: [org] } = await db.query("INSERT INTO organizations (slug, name) VALUES ($1, 'Synthetic Park work QA') RETURNING id", ['work-' + suffix]);
        const modules = ['chat', 'training', 'timeline', 'hr', 'tasks', 'dashboard', 'warehouse', 'afisha'];
        const { rows: [park] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'event_genix', 'Synthetic Park work', 'Park', 'membership', $2::jsonb) RETURNING id`, [org.id, JSON.stringify(modules)]);
        const { rows: [dar] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'dar', 'Synthetic foreign work', 'Foreign', 'membership', '["chat","training","timeline"]') RETURNING id`, [org.id]);
        await db.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [org.id, root.id]);
        await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true)`, [org.id, park.id, root.id]);
        const actors = [];
        for (const role of roles) {
            const username = `work.${role}.${suffix}`;
            const password = crypto.randomBytes(24).toString('base64url');
            const created = await request('POST', '/api/users', { username, password, name: `Synthetic work ${role}`, role,
                businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix', activateMembership: true }, token);
            assert.equal(created.status, 200, `create synthetic ${role}`);
            const id = Number(created.data.user.id);
            const { rows: [staff] } = await db.query(`INSERT INTO staff (id, name, department, position, role_type)
                VALUES ($1, $2, 'admin', 'Synthetic QA', $3) RETURNING id`,
            [1000000 + id, `Synthetic work ${role}`, role === 'instructor' ? 'trampoline_instructor' : role]);
            await db.query(`INSERT INTO employee_profiles (user_id, staff_id, full_name)
                VALUES ($1, $2, $3) ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET staff_id = EXCLUDED.staff_id`,
            [id, staff.id, `Synthetic work ${role}`]);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200, `login synthetic ${role}`);
            actors.push({ id, staffId: staff.id, username, token: login.data.token, user: login.data.user, role });
        }
        const headers = (actor, context = 'event_genix') => ({ authorization: 'Bearer ' + actor.token, 'x-business-context': context });
        const api = async (actor, method, path, body, context = 'event_genix') => {
            const response = await fetch(BASE_URL + path, { method, headers: { ...headers(actor, context), 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: await response.json().catch(() => null) };
        };
        return { db, root, actors, org, park, dar, api, headers, origin: BASE_URL, suffix };
    } catch (error) { await db.end(); throw error; }
}

module.exports = { createParkWorkFixture };
