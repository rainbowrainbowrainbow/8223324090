const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'auth-account-lifecycle-secret';

const originalJwtSecret = process.env.JWT_SECRET;

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/auth',
        '../routes/users',
        '../routes/streaks',
        '../services/accountLinking',
        '../services/accountSecurity'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function normalizeSql(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim();
}

function createFakePool() {
    const state = {
        nextUserId: 2,
        nextRefreshId: 1,
        users: [{
            id: 1,
            username: 'creator',
            password_hash: '$2b$04$placeholder',
            role: 'creator',
            extra_roles: [],
            page_allowlist: [],
            name: 'Creator',
            is_active: true,
            login_aliases: [],
            session_revoked_at: null,
            password_changed_at: null,
            avatar_emoji: null,
            avatar_color: null,
            avatar_url: null
        }],
        refreshTokens: []
    };

    function publicUser(row) {
        return row ? {
            id: row.id,
            username: row.username,
            name: row.name,
            role: row.role,
            extra_roles: row.extra_roles || [],
            page_allowlist: row.page_allowlist || [],
            is_active: row.is_active !== false,
            password_changed_at: row.password_changed_at || null,
            session_revoked_at: row.session_revoked_at || null
        } : null;
    }

    function findUserByLogin(login) {
        const key = String(login || '').trim().toLowerCase();
        return state.users
            .slice()
            .sort((a, b) => {
                const exactA = a.username.toLowerCase() === key ? 0 : 1;
                const exactB = b.username.toLowerCase() === key ? 0 : 1;
                return exactA - exactB || a.id - b.id;
            })
            .find(user => user.username.toLowerCase() === key
                || (user.login_aliases || []).some(alias => String(alias).trim().toLowerCase() === key)) || null;
    }

    async function query(sql, params = []) {
        const text = normalizeSql(sql);

        if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) return { rows: [], rowCount: 0 };

        if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(text)) {
            const user = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: user ? [{ is_active: user.is_active, session_revoked_at: user.session_revoked_at }] : [] };
        }

        if (/SELECT id FROM users WHERE LOWER\(username\) = LOWER\(\$1\)/i.test(text)) {
            const excludeId = params.length > 1 ? Number(params[1]) : null;
            const user = state.users.find(item => item.username.toLowerCase() === String(params[0] || '').toLowerCase()
                && (!excludeId || Number(item.id) !== excludeId));
            return { rows: user ? [{ id: user.id }] : [] };
        }

        if (/SELECT u\.id, u\.username, u\.password_hash/i.test(text) && /FROM users u/i.test(text)) {
            const user = findUserByLogin(params[0]);
            return { rows: user ? [{
                id: user.id,
                username: user.username,
                password_hash: user.password_hash,
                role: user.role,
                extra_roles: user.extra_roles || [],
                page_allowlist: user.page_allowlist || [],
                name: user.name,
                is_active: user.is_active,
                login_aliases: user.login_aliases || [],
                avatar_emoji: null,
                avatar_color: null,
                avatar_url: null
            }] : [] };
        }

        if (/INSERT INTO users \(username, password_hash, name, role, extra_roles, page_allowlist, password_changed_at\)/i.test(text)) {
            const [username, passwordHash, name, role, extraRoles, pageAllowlist] = params;
            const row = {
                id: state.nextUserId++,
                username,
                password_hash: passwordHash,
                name,
                role,
                extra_roles: Array.isArray(extraRoles) ? extraRoles : [],
                page_allowlist: Array.isArray(pageAllowlist) ? pageAllowlist : [],
                is_active: true,
                login_aliases: [],
                password_changed_at: new Date(),
                session_revoked_at: null
            };
            state.users.push(row);
            return { rows: [publicUser(row)], rowCount: 1 };
        }

        if (/INSERT INTO refresh_tokens/i.test(text)) {
            const [userId, tokenHash, deviceInfo, ipAddress, expiresAt] = params;
            const row = {
                id: state.nextRefreshId++,
                user_id: Number(userId),
                token_hash: tokenHash,
                device_info: deviceInfo,
                ip_address: ipAddress,
                expires_at: expiresAt,
                revoked_at: null,
                replaced_by: null
            };
            state.refreshTokens.push(row);
            return { rows: [row], rowCount: 1 };
        }

        if (/SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = \$1/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0]);
            return { rows: row ? [row] : [] };
        }

        if (/SELECT id, username, role, extra_roles, page_allowlist, name, is_active FROM users WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [publicUser(row)] : [] };
        }

        if (/UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE token_hash = \$1/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0]);
            if (row) row.revoked_at = new Date();
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        if (/UPDATE refresh_tokens SET revoked_at = NOW\(\), replaced_by =/i.test(text)) {
            const newRow = state.refreshTokens.find(item => item.token_hash === params[0]);
            const oldRow = state.refreshTokens.find(item => Number(item.id) === Number(params[1]));
            if (oldRow) {
                oldRow.revoked_at = new Date();
                oldRow.replaced_by = newRow?.id || null;
            }
            return { rows: [], rowCount: oldRow ? 1 : 0 };
        }

        if (/UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE user_id = \$1/i.test(text)) {
            let count = 0;
            state.refreshTokens.forEach(item => {
                if (Number(item.user_id) === Number(params[0]) && !item.revoked_at) {
                    item.revoked_at = new Date();
                    count += 1;
                }
            });
            return { rows: [], rowCount: count };
        }

        if (/SELECT u\.id, u\.username, u\.role, u\.extra_roles, u\.page_allowlist, u\.name/i.test(text)
            && /WHERE u\.username = \$1 AND u\.is_active = true/i.test(text)) {
            const row = state.users.find(item => item.username === params[0] && item.is_active !== false);
            return { rows: row ? [{ ...publicUser(row), avatar_emoji: null, avatar_color: null, avatar_url: null }] : [] };
        }

        if (/SELECT id FROM chat_channels WHERE is_default = true/i.test(text)) return { rows: [] };
        if (/INSERT INTO chat_channel_members/i.test(text)) return { rows: [], rowCount: 1 };
        if (/INSERT INTO account_security_events/i.test(text)) return { rows: [], rowCount: 1 };
        if (/UPDATE employee_profiles SET last_activity_at/i.test(text)) return { rows: [], rowCount: 0 };
        if (/UPDATE users SET last_seen_at/i.test(text)) return { rows: [], rowCount: 1 };

        throw new Error(`Unexpected SQL in auth lifecycle test: ${text}`);
    }

    return {
        state,
        query,
        async connect() {
            return {
                query,
                release() {}
            };
        }
    };
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function close(server) {
    return new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

async function request(baseUrl, method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

async function withAuthApp(run) {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();
    const fakePool = createFakePool();
    installMock('../db', { pool: fakePool });
    installMock('../routes/streaks', { updateStreak: async () => {} });

    const { authenticateToken } = require('../middleware/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/users', require('../routes/users'));
    app.get('/api/protected-smoke', authenticateToken, (req, res) => {
        res.json({ success: true, user: req.user });
    });

    const { server, baseUrl } = await listen(app);
    try {
        await run({ baseUrl, fakePool });
    } finally {
        await close(server);
        clearModules();
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
    }
}

function creatorToken() {
    return jwt.sign({ id: 1, username: 'creator', name: 'Creator', role: 'creator' }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

test('created manual account can log in, verify, access protected API, reject wrong password, and logout', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const create = await request(baseUrl, 'POST', '/api/users', {
            username: 'new.operator',
            password: 'ManualPass789!',
            name: 'New Operator',
            role: 'animator'
        }, creatorToken());

        assert.equal(create.status, 200);
        assert.equal(create.data.success, true);
        assert.equal(create.data.loginReady, true);
        assert.equal(create.data.credential, null);
        assert.equal(create.data.user.username, 'new.operator');
        assert.equal(create.data.user.password_hash, undefined, 'password hash must not be returned');

        const duplicate = await request(baseUrl, 'POST', '/api/users', {
            username: 'NEW.OPERATOR',
            password: 'AnotherPass789!',
            name: 'Duplicate Operator',
            role: 'animator'
        }, creatorToken());
        assert.equal(duplicate.status, 409);
        assert.match(duplicate.data.error, /username/i);

        const wrongPassword = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'new.operator',
            password: 'WrongPass789!'
        });
        assert.equal(wrongPassword.status, 401);
        assert.ok(wrongPassword.data.error);

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: ' New.Operator ',
            password: 'ManualPass789!'
        });
        assert.equal(login.status, 200);
        assert.ok(login.data.token);
        assert.ok(login.data.accessToken);
        assert.ok(login.data.refreshToken);
        assert.equal(login.data.user.username, 'new.operator');
        assert.equal(login.data.user.password_hash, undefined, 'login response must not expose password hash');

        const verify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, login.data.token);
        assert.equal(verify.status, 200);
        assert.equal(verify.data.user.username, 'new.operator');

        const protectedRoute = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, login.data.token);
        assert.equal(protectedRoute.status, 200);
        assert.equal(protectedRoute.data.user.username, 'new.operator');

        const blocked = await request(baseUrl, 'GET', '/api/protected-smoke');
        assert.equal(blocked.status, 401);

        const refresh = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: login.data.refreshToken });
        assert.equal(refresh.status, 200);
        assert.ok(refresh.data.accessToken);
        assert.ok(refresh.data.refreshToken);
        assert.equal(refresh.data.user.username, 'new.operator');

        const refreshedVerify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, refresh.data.accessToken);
        assert.equal(refreshedVerify.status, 200);
        assert.equal(refreshedVerify.data.user.username, 'new.operator');

        const logout = await request(baseUrl, 'POST', '/api/auth/logout', { refreshToken: refresh.data.refreshToken });
        assert.equal(logout.status, 200);
        assert.equal(logout.data.success, true);
        assert.equal(fakePool.state.refreshTokens.every(token => token.revoked_at), true);

        const refreshAfterLogout = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: refresh.data.refreshToken });
        assert.equal(refreshAfterLogout.status, 401);
    });
});

test('created one-time account returns a visible credential that logs in through the same auth contract', async () => {
    await withAuthApp(async ({ baseUrl }) => {
        const create = await request(baseUrl, 'POST', '/api/users', {
            username: 'one.time.operator',
            name: 'One Time Operator',
            role: 'reception',
            issueOneTime: true
        }, creatorToken());

        assert.equal(create.status, 200);
        assert.equal(create.data.success, true);
        assert.equal(create.data.loginReady, true);
        assert.equal(create.data.credential.username, 'one.time.operator');
        assert.ok(create.data.credential.password);

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: create.data.credential.username,
            password: create.data.credential.password
        });
        assert.equal(login.status, 200);
        assert.equal(login.data.user.username, 'one.time.operator');
    });
});
