/**
 * Live account-access API smoke.
 * Run: npm run test:api:account-access
 * Env: TEST_URL, TEST_USER, TEST_PASS
 *
 * Requires a running PostgreSQL-backed app and a creator/director-capable TEST_USER.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BASE_URL, request, authRequest, getToken } = require('./helpers');

function uniqueName(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function login(username, password) {
    const res = await request('POST', '/api/auth/login', { username, password });
    assert.equal(res.status, 200, `login ${username}: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.accessToken || res.data.token);
    return res.data.accessToken || res.data.token;
}

async function createUser(payload) {
    const res = await authRequest('POST', '/api/users', payload);
    assert.equal(res.status, 200, `create user ${payload.username}: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.success);
    assert.ok(res.data.user?.id);
    return res.data.user;
}

async function cleanupUser(id) {
    if (!id) return;
    await authRequest('PATCH', `/api/users/${id}/active`, { isActive: false }).catch(() => null);
}

async function cleanupStaff(id) {
    if (!id) return;
    await authRequest('DELETE', `/api/staff/${id}`).catch(() => null);
}

test('live account access boundaries are enforced on direct API calls', async () => {
    const createdUserIds = [];
    let staffId = null;

    try {
        const unauthUsers = await request('GET', '/api/users');
        assert.equal(unauthUsers.status, 401, `unauth /api/users should be 401: ${JSON.stringify(unauthUsers.data)}`);

        const creatorUsers = await authRequest('GET', '/api/users');
        assert.equal(creatorUsers.status, 200, `creator /api/users should be 200: ${JSON.stringify(creatorUsers.data)}`);
        assert.ok(Array.isArray(creatorUsers.data));

        const suffix = uniqueName('account_access');
        const hrPassword = `${suffix}_HrPass789!`;
        const directorPassword = `${suffix}_DirectorPass789!`;

        const hrUser = await createUser({
            username: `${suffix}.hr`,
            password: hrPassword,
            name: 'Account Access HR Smoke',
            role: 'hr'
        });
        createdUserIds.push(hrUser.id);

        const directorUser = await createUser({
            username: `${suffix}.director`,
            password: directorPassword,
            name: 'Account Access Director Smoke',
            role: 'director'
        });
        createdUserIds.push(directorUser.id);

        const hrToken = await login(hrUser.username, hrPassword);
        const hrUsers = await request('GET', '/api/users', null, hrToken);
        assert.equal(hrUsers.status, 403, `HR must not access account center API: ${JSON.stringify(hrUsers.data)}`);

        const staff = await authRequest('POST', '/api/staff', {
            name: `Account Access Staff ${suffix}`,
            department: 'admin',
            position: 'Smoke Tester',
            role_type: 'admin'
        });
        assert.equal(staff.status, 200, `create staff: ${JSON.stringify(staff.data)}`);
        assert.ok(staff.data.success);
        staffId = staff.data.data.id;

        const hrStaffLink = await request('POST', `/api/staff/${staffId}/link`, { userId: directorUser.id }, hrToken);
        assert.equal(hrStaffLink.status, 403, `HR must not link staff accounts: ${JSON.stringify(hrStaffLink.data)}`);

        const hrEmployeeLink = await request('POST', '/api/employees', {
            user_id: directorUser.id,
            staff_id: staffId,
            full_name: `Account Access Employee ${suffix}`,
            role: 'admin',
            department: 'admin'
        }, hrToken);
        assert.equal(hrEmployeeLink.status, 403, `HR must not link employee profiles to accounts: ${JSON.stringify(hrEmployeeLink.data)}`);

        const directorToken = await login(directorUser.username, directorPassword);

        const managerCreate = await request('POST', '/api/users', {
            username: `${suffix}.manager`,
            password: `${suffix}_ManagerPass789!`,
            name: 'Account Access Manager Smoke',
            role: 'manager'
        }, directorToken);
        assert.equal(managerCreate.status, 200, `director should create lower account: ${JSON.stringify(managerCreate.data)}`);
        createdUserIds.push(managerCreate.data.user.id);

        const peerDirectorCreate = await request('POST', '/api/users', {
            username: `${suffix}.peer_director`,
            password: `${suffix}_PeerPass789!`,
            name: 'Account Access Peer Director Smoke',
            role: 'director'
        }, directorToken);
        assert.equal(peerDirectorCreate.status, 403, `director must not create director peer: ${JSON.stringify(peerDirectorCreate.data)}`);

        const protectedLink = await request('POST', `/api/staff/${staffId}/link`, { userId: directorUser.id }, directorToken);
        assert.equal(protectedLink.status, 403, `director must not link protected director account: ${JSON.stringify(protectedLink.data)}`);

        const checkin = await fetch(`${BASE_URL}/checkin.html`);
        assert.equal(checkin.status, 200);
        const html = await checkin.text();
        assert.match(html, /js\/auth\.js/, 'checkin page should load shared auth guard');
        assert.match(html, /apiVerifyToken|requireAuthorizedSession/, 'checkin page should verify session before use');

        await getToken();
    } finally {
        await cleanupStaff(staffId);
        for (const id of createdUserIds.reverse()) {
            await cleanupUser(id);
        }
    }
});
