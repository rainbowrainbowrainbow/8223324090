'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

test('staff account operations enforce Park ownership and payroll/operation permissions', async t => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(database.isLocal, true);
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false });
    t.after(() => pool.end());
    const marker = 'qa-staff-' + randomUUID().slice(0, 8);
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    async function api(path, { actor, method = 'GET', body, headers = {}, context = actor?.context || 'event_genix' } = {}) {
        const response = await fetch(new URL(path, process.env.TEST_URL), {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Business-Context': context,
                ...headers,
                ...(actor ? { Authorization: 'Bearer ' + actor.token } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, data: await response.json() };
    }
    async function business(context, organizationId = null) {
        const { rows: [org] } = organizationId ? { rows: [{ id: organizationId }] } : await pool.query(
            "INSERT INTO organizations (slug, name, status) VALUES ($1, $1, 'active') RETURNING id", [marker + '-' + context]
        );
        const { rows: [row] } = await pool.query(
            `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
             VALUES ($1, $2, $2, $2, 'membership', '[]', 'active')
             ON CONFLICT (context_key) DO UPDATE SET organization_id = EXCLUDED.organization_id,
                 access_mode = 'membership', status = 'active' RETURNING id`, [org.id, context]
        );
        return { id: row.id, organizationId: org.id, context };
    }
    async function actor(suffix, role, business, deny = [], allow = []) {
        const username = marker + '-' + suffix;
        const { rows: [user] } = await pool.query(
            'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $1, $3) RETURNING id',
            [username, passwordHash, role]
        );
        await pool.query(
            "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, $3, true)",
            [business.organizationId, user.id, role === 'creator' ? 'owner' : 'member']
        );
        await pool.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, action_denylist, action_allowlist, is_default, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true, true)`, [business.id, business.organizationId, user.id, role, deny, allow]
        );
        const login = await api('/api/auth/login', { method: 'POST', context: business.context, body: { username, password } });
        assert.equal(login.status, 200);
        return { id: user.id, username, context: business.context, token: login.data.accessToken || login.data.token };
    }
    const park = await business('event_genix');
    const owner = await actor('owner', 'creator', park);
    const viewer = await actor('viewer', 'animator', park);
    const restricted = await actor('restricted', 'director', park, ['hr.payroll.view', 'hr.payroll.manage']);
    const denied = await actor('denied', 'director', park, ['hr.staff.create', 'hr.staff.profile.edit']);
    const otherOrg = await business('dar');
    const foreign = await actor('foreign', 'director', otherOrg);
    const foreignViewer = await actor('foreign-viewer', 'animator', otherOrg);
    const { rows: [staff] } = await pool.query(
        `INSERT INTO staff (name, department, position, role_type, phone, hourly_rate)
         VALUES ($1, 'animators', 'QA Animator', 'animator', 'original', 123) RETURNING id`, [marker]
    );
    const payload = (suffix, target = { mode: 'existing', id: staff.id }, extra = {}) => ({
        personal: { username: marker + '-' + suffix, name: marker, phone: 'changed' },
        staff: target,
        professions: [{ key: 'animator', isPrimary: true }],
        access: { role: 'animator', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' },
        ...extra
    });
    const onboard = (actor, body) => api('/api/users/onboarding', { actor, method: 'POST', body });
    const readStaff = async () => (await pool.query('SELECT phone, hourly_rate FROM staff WHERE id = $1', [staff.id])).rows[0];

    await t.test('foreign account management cannot reach Park staff or links', async () => {
        for (const path of ['/api/users/onboarding/options', '/api/users/staff-options', '/api/users/link-conflicts', '/api/employees']) {
            assert.equal((await api(path, { actor: foreign })).status, 403, path);
        }
        assert.equal((await onboard(foreign, payload('foreign-link'))).status, 403);
        assert.equal((await api('/api/users/' + viewer.id + '/profile', {
            actor: foreign, method: 'PATCH', body: { name: 'changed', staffId: staff.id }
        })).status, 403);
        assert.equal((await readStaff()).phone, 'original');
    });

    await t.test('explicit denies apply to onboarding create and existing setup', async () => {
        assert.equal((await onboard(denied, payload('denied-new', {
            mode: 'new', department: 'animators', position: 'QA Animator'
        }))).status, 403);
        assert.equal((await onboard(denied, payload('denied-edit'))).status, 403);
        assert.equal((await readStaff()).phone, 'original');
    });

    await t.test('Park admin onboards a worker using the role preset and activates only Park membership', async () => {
        const admin = await actor('park-admin', 'admin', park);
        const foreignAdmin = await actor('foreign-admin', 'admin', otherOrg);
        const deniedAdmin = await actor('denied-admin', 'admin', park, ['hr.staff.accounts.onboard']);
        for (const principal of [viewer, foreignAdmin, deniedAdmin]) {
            assert.equal((await api('/api/users/onboarding/options', { actor: principal })).status, 403);
        }
        const options = await api('/api/users/onboarding/options', { actor: admin });
        assert.equal(options.status, 200);
        assert.equal(options.data.parkWorkerOnboarding, true);
        assert.ok(options.data.allowedAccountRoles.includes('animator'));
        assert.ok(!options.data.allowedAccountRoles.includes('admin'));
        assert.equal(options.data.canManagePayrollRules, false);
        assert.equal(Object.hasOwn(options.data.staff.find(item => item.id === staff.id), 'hourly_rate'), false);
        assert.equal((await api('/api/users', { actor: admin })).status, 403);
        const target = { mode: 'new', department: 'animators', position: 'QA Animator' };
        const body = payload('park-worker', target, {
            personal: { name: marker + '-park-worker', username: marker + '-park-worker' }
        });
        for (const access of [{ role: 'admin' }, { role: 'animator', extraRoles: ['admin'] }, { role: 'animator', pageAllowlist: ['/hr'] }]) {
            assert.equal((await onboard(admin, { ...body, access })).status, 403);
        }
        assert.equal((await onboard(admin, { ...body, staff: { ...target, hourlyRate: 321 } })).status, 403);
        assert.equal((await pool.query('SELECT id FROM users WHERE username=$1', [body.personal.username])).rowCount, 0);
        const key = randomUUID();
        const submit = () => api('/api/users/onboarding', { actor: admin, method: 'POST', body, headers: { 'Idempotency-Key': key } });
        const created = await submit();
        assert.equal(created.status, 200, JSON.stringify(created.data.code));
        assert.equal(created.data.accessState, 'active');
        const userId = created.data.receipt.account.id;
        const staffId = created.data.receipt.staff.id;
        const replayed = await submit();
        assert.equal(replayed.status, 200);
        assert.equal(replayed.data.receipt.account.id, userId);
        assert.equal(replayed.data.receipt.staff.id, staffId);
        assert.equal(replayed.data.credential, null);
        const { rows } = await pool.query(`SELECT bm.business_id, bm.role, om.role AS organization_role, ep.staff_id
            FROM business_memberships bm JOIN organization_memberships om USING (organization_id,user_id)
            JOIN employee_profiles ep ON ep.user_id=bm.user_id AND ep.is_active
            WHERE bm.user_id=$1 AND bm.is_active AND om.is_active`, [userId]);
        assert.deepEqual(rows, [{ business_id: park.id, role: 'animator', organization_role: 'member', staff_id: staffId }]);
        assert.equal((await pool.query('SELECT 1 FROM chat_channel_members WHERE user_id=$1', [userId])).rowCount, 0);
    });

    await t.test('payroll-denied account manager gets no rates and cannot write aliases or nested rates', async () => {
        const options = await api('/api/users/onboarding/options', { actor: restricted });
        assert.equal(options.status, 200);
        const row = options.data.staff.find(item => item.id === staff.id);
        assert.ok(row);
        assert.equal(Object.hasOwn(row, 'hourly_rate'), false);
        assert.equal(Object.hasOwn(row, 'rate_unit'), false);
        assert.deepEqual(row.profession_conditions, []);
        for (const [index, fields] of [{ hourlyRate: 321 }, { hourly_rate: 321 }, { rateUnit: 'month' }, { rate_unit: 'month' }].entries()) {
            assert.equal((await onboard(restricted, payload('rate-' + index, { mode: 'existing', id: staff.id, ...fields }))).status, 403);
        }
        assert.equal((await onboard(restricted, payload('nested-rate', undefined, {
            conditions: [{ professionKey: 'animator', rate: { mode: 'explicit', amount: 321 }, shiftPreferences: [{ dayType: 'weekday' }, { dayType: 'weekend' }] }]
        }))).status, 403);
        assert.deepEqual(await readStaff(), { phone: 'original', hourly_rate: '123.00' });
    });

    await t.test('both creation paths reject invalid staff data without storing a record', async () => {
        const staffDraft = { name: marker + '-invalid', department: 'animators', position: 'QA Animator' };
        for (const fields of [{ name: '   ' }, { hireDate: '2026-02-30' }, { department: 'x'.repeat(51) }, { role_type: 'unknown_test_profession' }]) {
            assert.equal((await api('/api/staff', { actor: owner, method: 'POST', body: { ...staffDraft, ...fields } })).status, 400);
        }
        const badDate = { mode: 'new', department: staffDraft.department, position: staffDraft.position, hireDate: '2026-02-30' };
        assert.equal((await onboard(owner, payload('invalid-date', badDate))).status, 400);
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [staffDraft.name])).rowCount, 0);
    });

    await t.test('isolates each delegated action and preserves full manager fields with an extra narrow grant', async () => {
        const view = 'hr.staff.view';
        const create = 'hr.staff.create';
        const edit = 'hr.staff.profile.edit';
        const manage = 'hr.staff.manage';
        const viewOnly = await actor('view-only', 'animator', park, [manage], [view]);
        const createOnly = await actor('create-only', 'animator', park, [manage], [view, create]);
        const editOnly = await actor('edit-only', 'animator', park, [manage], [view, edit]);
        const fullWithExtra = await actor('manager-extra', 'creator', park, [], [edit]);
        const draft = { name: marker + '-narrow', department: 'animators', position: 'QA Animator', role_type: 'animator' };
        const newCard = (principal, name = draft.name) => api('/api/staff', {
            actor: principal, method: 'POST', body: { ...draft, name }
        });
        assert.equal((await newCard(viewOnly)).status, 403);
        assert.equal((await newCard(editOnly)).status, 403);
        const created = await newCard(createOnly);
        assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
        const path = '/api/hr/staff/' + created.data.data.id;
        const detail = await api(path, { actor: viewOnly });
        assert.equal(detail.status, 200);
        const headers = { 'X-Staff-Profile-Revision': detail.data.data.profile_revision };
        const update = (principal, body) => api(path, { actor: principal, method: 'PUT', headers, body });
        assert.equal((await update(viewOnly, { phone: '5550001' })).status, 403);
        assert.equal((await update(createOnly, { phone: '5550001' })).status, 403);
        for (const extra of [{ role_type: 'waiter' }, { is_active: false }, { hourly_rate: 500 }]) {
            assert.equal((await update(editOnly, { phone: '5550001', ...extra })).status, 400);
        }
        const read = async () => (await pool.query('SELECT phone, is_active, role_type, hourly_rate FROM staff WHERE id = $1', [created.data.data.id])).rows[0];
        assert.deepEqual(await read(), { phone: null, is_active: true, role_type: 'animator', hourly_rate: '0.00' });
        assert.equal((await update(editOnly, { phone: '5550002' })).status, 200);
        assert.equal((await read()).phone, '5550002');
        for (const principal of [owner, fullWithExtra]) {
            const full = await api(path, { actor: principal });
            assert.equal(full.status, 200);
            assert.equal(full.data.staffCardAccess.editableFields, null);
        }
    });

    await t.test('Park owner links the existing account to the exact card', async () => {
        const response = await api('/api/staff/' + staff.id + '/link', {
            actor: owner, method: 'POST', body: { userId: viewer.id }
        });
        assert.equal(response.status, 200);
        const { rows } = await pool.query('SELECT user_id FROM employee_profiles WHERE staff_id = $1 AND user_id IS NOT NULL', [staff.id]);
        assert.deepEqual(rows, [{ user_id: viewer.id }]);
        const newCard = await api('/api/staff', { actor: owner, method: 'POST', body: {
            name: marker + '-link-conflict', department: 'animators', position: 'QA Animator'
        } });
        const otherLink = '/api/staff/' + newCard.data.data.id + '/link';
        assert.equal((await api(otherLink, { actor: owner, method: 'POST', body: { userId: viewer.id } })).status, 409);
        assert.equal((await api(otherLink, { actor: owner, method: 'POST', body: { userId: foreignViewer.id } })).status, 403);
        const foreignUsers = await api('/api/users', { actor: foreign });
        assert.equal(foreignUsers.status, 200);
        assert.equal(foreignUsers.data.find(row => row.id === viewer.id).staff_id, null);
    });

    await t.test('staff creation is durable across ten concurrent repeats, and distinct actors see a duplicate candidate', async () => {
        const name = marker + '-retry';
        const draft = { name, department: 'animators', position: 'QA Animator', role_type: 'animator' };
        const key = randomUUID();
        const headers = { 'Idempotency-Key': key };
        const requests = await Promise.all(Array.from({ length: 10 }, () =>
            api('/api/staff', { actor: owner, method: 'POST', headers, body: draft })));
        assert.ok(requests.every(result => result.status === 200), JSON.stringify(requests.map(result => result.status)));
        const ids = new Set(requests.map(result => result.data.data.id));
        assert.equal(ids.size, 1);
        const [id] = ids;
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [name])).rowCount, 1);
        const lookup = '/api/staff/creation-operations/' + key;
        assert.equal((await api(lookup, { actor: owner })).data.data.id, id);
        assert.equal((await api(lookup, { actor: restricted })).status, 404);
        assert.equal((await api('/api/staff', { actor: owner, method: 'POST', headers, body: { ...draft, position: 'Changed' } })).status, 409);
        const duplicate = await api('/api/staff', { actor: restricted, method: 'POST', body: draft });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.data.code, 'STAFF_POSSIBLE_DUPLICATE');
        assert.deepEqual(duplicate.data.candidates.map(row => row.id), [id]);
        const distinct = await api('/api/staff', { actor: restricted, method: 'POST', body: { ...draft, distinctStaffIds: [id] } });
        assert.equal(distinct.status, 200);
        assert.notEqual(distinct.data.data.id, id);
    });

    await t.test('onboarding repeats retain the staff and account IDs without replaying credentials', async () => {
        const body = payload('onboarding-retry', { mode: 'new', department: 'animators', position: 'QA Animator' }, {
            personal: { name: marker + '-onboarding-retry', username: marker + '-onboarding-retry' }
        });
        const key = randomUUID();
        const headers = { 'Idempotency-Key': key };
        const results = await Promise.all(Array.from({ length: 10 }, () =>
            api('/api/users/onboarding', { actor: owner, method: 'POST', headers, body })));
        assert.ok(results.every(result => result.status === 200), JSON.stringify(results.map(result => result.status)));
        assert.equal(results.filter(result => result.data.credential?.password).length, 1);
        const [staffId] = new Set(results.map(result => result.data.receipt.staff.id));
        const [accountId] = new Set(results.map(result => result.data.receipt.account.id));
        assert.ok(results.every(result => result.data.receipt.staff.id === staffId && result.data.receipt.account.id === accountId));
        const recovered = await api('/api/users/onboarding/operations/' + key, { actor: owner });
        assert.equal(recovered.status, 200);
        assert.equal(recovered.data.credential, null);
        assert.equal(recovered.data.receipt.staff.id, staffId);
        assert.equal(recovered.data.receipt.account.id, accountId);
        assert.equal(recovered.data.accessState, 'pending_membership');
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [body.personal.name])).rowCount, 1);
        assert.equal((await pool.query('SELECT 1 FROM business_memberships WHERE user_id = $1', [accountId])).rowCount, 0);
        const activation = await api(`/api/organizations/${park.organizationId}/members/${accountId}`, {
            actor: owner, method: 'PUT', body: { businessId: park.id, role: 'animator', isDefault: true }
        });
        assert.equal(activation.status, 200);
        const activeReceipt = await api('/api/users/onboarding/operations/' + key, { actor: owner });
        assert.equal(activeReceipt.data.accessState, 'active');
        assert.equal(activeReceipt.data.receipt.staff.id, staffId);
        const credential = results.find(result => result.data.credential?.password).data.credential;
        const login = await api('/api/auth/login', { method: 'POST', body: { username: credential.username, password: credential.password } });
        assert.equal(login.status, 200);
        const newActor = { context: 'event_genix', token: login.data.accessToken || login.data.token };
        assert.equal((await api('/api/users/onboarding/options', { actor: newActor })).status, 403);
    });

    await t.test('stale profile saves conflict and an old tab cannot write without a revision', async () => {
        const path = '/api/hr/staff/' + staff.id;
        const detail = await api(path, { actor: owner });
        const revision = detail.data.data.profile_revision;
        assert.match(revision, /^\d+$/);
        assert.equal((await api(path, { actor: owner, method: 'PUT', body: { phone: 'stale' } })).status, 428);
        const headers = { 'X-Staff-Profile-Revision': revision };
        const updates = await Promise.all([
            api(path, { actor: owner, method: 'PUT', headers, body: { phone: 'operator A' } }),
            api(path, { actor: restricted, method: 'PUT', headers, body: { phone: 'operator B' } })
        ]);
        assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
        assert.equal(updates.find(result => result.status === 409).data.code, 'STAFF_PROFILE_CONFLICT');
        assert.equal((await readStaff()).phone, updates.find(result => result.status === 200).data.data.phone);
    });

    await t.test('aggregate scope and revoked membership cannot write or recover staff operations', async () => {
        const second = await business('crm', park.organizationId);
        await pool.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default, is_active)
             VALUES ($1, $2, $3, 'creator', false, true)`, [second.id, park.organizationId, owner.id]
        );
        const headers = { 'X-Business-Scope': 'all' };
        assert.equal((await api('/api/users/onboarding/options', { actor: owner, headers })).status, 403);
        await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = $2', [restricted.id, park.id]);
        assert.equal((await onboard(restricted, payload('revoked-member'))).status, 403);
        assert.equal((await api('/api/staff/' + staff.id + '/link', { actor: restricted, method: 'POST', body: { userId: viewer.id } })).status, 403);
    });
});
