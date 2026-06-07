const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'personal-accounts-jwt-telegram-secret';

const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    REPORT_BOT_API_KEY: process.env.REPORT_BOT_API_KEY
};

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/personal-accounts'
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
        queries: [],
        user: {
            id: 1,
            username: 'personal.owner',
            role: 'accountant',
            extra_roles: [],
            page_allowlist: [],
            action_allowlist: [],
            action_denylist: [],
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            name: 'Personal Owner',
            telegram_chat_id: 777001,
            is_active: true,
            session_revoked_at: null
        },
        accounts: [{
            id: 501,
            name: 'Owner Card',
            emoji: 'card',
            type: 'personal',
            is_personal: true,
            is_active: true,
            owner_telegram_id: 777001,
            sort_order: 1
        }, {
            id: 502,
            name: 'Stale Token Card',
            emoji: 'card',
            type: 'personal',
            is_personal: true,
            is_active: true,
            owner_telegram_id: 999999,
            sort_order: 2
        }],
        grants: []
    };

    const pool = {
        state,
        query: async (sql, params = []) => {
            const text = normalizeSql(sql);
            state.queries.push({ text, params });

            if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(text)) {
                return {
                    rows: [{
                        is_active: state.user.is_active,
                        session_revoked_at: state.user.session_revoked_at
                    }]
                };
            }

            if (/SELECT id, username, role, extra_roles, page_allowlist, action_allowlist, action_denylist, business_contexts, default_business_context, name, telegram_chat_id, is_active FROM users WHERE id = \$1/i.test(text)) {
                return { rows: [state.user] };
            }

            if (/UPDATE employee_profiles SET last_activity_at = NOW\(\) WHERE user_id = \$1/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }

            if (/UPDATE users SET last_seen_at = NOW\(\) WHERE id = \$1/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }

            if (/SELECT a\.\*, 'owner' AS role FROM finance_accounts a/i.test(text)
                && /UNION ALL SELECT a\.\*, 'member' AS role/i.test(text)) {
                const tgId = Number(params[0]);
                return {
                    rows: state.accounts
                        .filter(account => account.is_active && account.is_personal && Number(account.owner_telegram_id) === tgId)
                        .map(account => ({ ...account, role: 'owner' }))
                };
            }

            if (/SELECT id, owner_telegram_id FROM finance_accounts WHERE id = \$1 AND is_personal = true/i.test(text)) {
                const account = state.accounts.find(item => Number(item.id) === Number(params[0])
                    && item.is_personal
                    && (!/is_active = true/i.test(text) || item.is_active));
                return {
                    rows: account ? [{ id: account.id, owner_telegram_id: account.owner_telegram_id }] : []
                };
            }

            if (/INSERT INTO finance_account_access/i.test(text)) {
                state.grants.push({
                    account_id: Number(params[0]),
                    telegram_id: Number(params[1]),
                    can_view: params[2] === true,
                    can_write: params[3] === true
                });
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected query: ${text}`);
        }
    };

    return pool;
}

function tokenFor(payload = {}) {
    return jwt.sign({
        id: 1,
        username: 'personal.owner',
        role: 'accountant',
        telegram_chat_id: 999999,
        ...payload
    }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function request(baseUrl, method, path, body, token = tokenFor()) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

test('personal account JWT access uses refreshed users.telegram_chat_id, not stale token or query telegram_id', async () => {
    clearModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.REPORT_BOT_API_KEY = 'personal-account-bot-key';

    const pool = createFakePool();
    installMock('../db', { pool });

    const app = express();
    app.use(express.json());
    app.use('/api/personal-accounts', require('../routes/personal-accounts'));

    const { server, baseUrl } = await listen(app);
    try {
        const list = await request(baseUrl, 'GET', '/api/personal-accounts/my?telegram_id=999999');

        assert.equal(list.status, 200, JSON.stringify(list.data));
        assert.deepEqual(list.data.accounts.map(account => account.id), [501]);

        const ownerQuery = pool.state.queries.find(query =>
            /SELECT a\.\*, 'owner' AS role FROM finance_accounts a/i.test(query.text)
        );
        assert.ok(ownerQuery, 'personal account owner lookup must run');
        assert.equal(ownerQuery.params[0], 777001);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalEnv.JWT_SECRET;
        process.env.REPORT_BOT_API_KEY = originalEnv.REPORT_BOT_API_KEY;
        clearModules();
    }
});

test('personal account owner grants access after JWT telegram id rehydration', async () => {
    clearModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.REPORT_BOT_API_KEY = 'personal-account-bot-key';

    const pool = createFakePool();
    installMock('../db', { pool });

    const app = express();
    app.use(express.json());
    app.use('/api/personal-accounts', require('../routes/personal-accounts'));

    const { server, baseUrl } = await listen(app);
    try {
        const grant = await request(baseUrl, 'POST', '/api/personal-accounts/501/grant', {
            telegram_id: 888002,
            can_view: true,
            can_write: false
        });

        assert.equal(grant.status, 200, JSON.stringify(grant.data));
        assert.deepEqual(pool.state.grants, [{
            account_id: 501,
            telegram_id: 888002,
            can_view: true,
            can_write: false
        }]);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalEnv.JWT_SECRET;
        process.env.REPORT_BOT_API_KEY = originalEnv.REPORT_BOT_API_KEY;
        clearModules();
    }
});
