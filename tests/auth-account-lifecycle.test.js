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
        '../services/accountOnboarding',
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
            page_denylist: [],
            action_allowlist: [],
            action_denylist: [],
            business_contexts: ['event_genix', 'dar', 'maysternya_doli', 'crm'],
            default_business_context: 'event_genix',
            name: 'Creator',
            is_active: true,
            login_aliases: [],
            session_revoked_at: null,
            password_changed_at: null,
            telegram_chat_id: 123456001,
            avatar_emoji: null,
            avatar_color: null,
            avatar_url: null
        }],
        refreshTokens: [],
        securityEvents: [],
        transactionStatements: []
    };

    function publicUser(row) {
        return row ? {
            id: row.id,
            username: row.username,
            name: row.name,
            role: row.role,
            extra_roles: row.extra_roles || [],
            page_allowlist: row.page_allowlist || [],
            page_denylist: row.page_denylist || [],
            action_allowlist: row.action_allowlist || [],
            action_denylist: row.action_denylist || [],
            business_contexts: row.business_contexts || ['event_genix'],
            default_business_context: row.default_business_context || 'event_genix',
            is_active: row.is_active !== false,
            password_changed_at: row.password_changed_at || null,
            session_revoked_at: row.session_revoked_at || null,
            telegram_chat_id: row.telegram_chat_id || null
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

        if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) {
            state.transactionStatements.push(text.split(/\s+/)[0].toUpperCase());
            return { rows: [], rowCount: 0 };
        }
        if (/SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)/i.test(text)) return { rows: [{}], rowCount: 1 };

        if (/SELECT id, username FROM users WHERE LOWER\(username\) = \$1/i.test(text)) {
            const user = findUserByLogin(params[0]);
            return { rows: user ? [{ id: user.id, username: user.username }] : [] };
        }

        if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(text)) {
            const user = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: user ? [{ is_active: user.is_active, session_revoked_at: user.session_revoked_at }] : [] };
        }

        if (/SELECT qa_creator_lease_id::text AS qa_creator_lease_id, qa_creator_lease_expires_at FROM users/i.test(text)) {
            const user = state.users.find(item => Number(item.id) === Number(params[0]));
            const expectedLeaseId = params[1] || null;
            const leaseIsActive = user
                && user.qa_creator_lease_id
                && user.qa_creator_lease_expires_at
                && new Date(user.qa_creator_lease_expires_at) > new Date()
                && (!expectedLeaseId || user.qa_creator_lease_id === expectedLeaseId);
            return {
                rows: leaseIsActive ? [{
                    qa_creator_lease_id: user.qa_creator_lease_id,
                    qa_creator_lease_expires_at: user.qa_creator_lease_expires_at
                }] : []
            };
        }

        if (/SELECT id, username, role, is_active FROM users WHERE id = \$1 FOR UPDATE/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{ id: row.id, username: row.username, role: row.role, is_active: row.is_active !== false }] : [] };
        }

        if (/SELECT u\.id, u\.username, u\.name, u\.role, u\.extra_roles, u\.is_active,/i.test(text)
            && /qa_creator_lease_id::text AS qa_creator_lease_id/i.test(text)
            && /FROM users u/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                extra_roles: row.extra_roles || [],
                is_active: row.is_active !== false,
                qa_creator_lease_id: row.qa_creator_lease_id || null,
                qa_creator_lease_expires_at: row.qa_creator_lease_expires_at || null,
                has_active_staff_profile: false
            }] : [] };
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
                page_denylist: user.page_denylist || [],
                action_allowlist: user.action_allowlist || [],
                action_denylist: user.action_denylist || [],
                business_contexts: user.business_contexts || ['event_genix'],
                default_business_context: user.default_business_context || 'event_genix',
                name: user.name,
                is_active: user.is_active,
                login_aliases: user.login_aliases || [],
                avatar_emoji: null,
                avatar_color: null,
                avatar_url: null
            }] : [] };
        }

        if (/INSERT INTO users \(username, password_hash, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, password_changed_at\)/i.test(text)) {
            const [username, passwordHash, name, role, extraRoles, pageAllowlist, pageDenylist, actionAllowlist, actionDenylist, businessContexts, defaultBusinessContext] = params;
            const row = {
                id: state.nextUserId++,
                username,
                password_hash: passwordHash,
                name,
                role,
                extra_roles: Array.isArray(extraRoles) ? extraRoles : [],
                page_allowlist: Array.isArray(pageAllowlist) ? pageAllowlist : [],
                page_denylist: Array.isArray(pageDenylist) ? pageDenylist : [],
                action_allowlist: Array.isArray(actionAllowlist) ? actionAllowlist : [],
                action_denylist: Array.isArray(actionDenylist) ? actionDenylist : [],
                business_contexts: Array.isArray(businessContexts) ? businessContexts : ['event_genix'],
                default_business_context: defaultBusinessContext || 'event_genix',
                is_active: true,
                login_aliases: [],
                password_changed_at: new Date(),
                telegram_chat_id: null,
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
                created_at: new Date(),
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

        if (/SELECT id, device_info, ip_address, created_at, expires_at FROM refresh_tokens WHERE user_id = \$1/i.test(text)) {
            const rows = state.refreshTokens
                .filter(item => Number(item.user_id) === Number(params[0]) && !item.revoked_at && new Date(item.expires_at) > new Date())
                .map(item => ({
                    id: item.id,
                    device_info: item.device_info,
                    ip_address: item.ip_address,
                    created_at: item.created_at || new Date(),
                    expires_at: item.expires_at
                }));
            return { rows };
        }

        if (/SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, name(?:, telegram_chat_id)?, is_active(?:, session_revoked_at)? FROM users WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{ ...publicUser(row), session_revoked_at: row.session_revoked_at || null }] : [] };
        }

        if (/SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context FROM users WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                role: row.role,
                extra_roles: row.extra_roles || [],
                page_allowlist: row.page_allowlist || [],
                page_denylist: row.page_denylist || [],
                action_allowlist: row.action_allowlist || [],
                action_denylist: row.action_denylist || [],
                business_contexts: row.business_contexts || ['event_genix'],
                default_business_context: row.default_business_context || 'event_genix'
            }] : [] };
        }

        if (/SELECT id, username, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, is_active FROM users WHERE id = \$1 FOR UPDATE/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                extra_roles: row.extra_roles || [],
                page_allowlist: row.page_allowlist || [],
                page_denylist: row.page_denylist || [],
                action_allowlist: row.action_allowlist || [],
                action_denylist: row.action_denylist || [],
                business_contexts: row.business_contexts || ['event_genix'],
                default_business_context: row.default_business_context || 'event_genix',
                is_active: row.is_active !== false
            }] : [] };
        }

        if (/SELECT pg_advisory_xact_lock\(hashtext\('eventgenix:last-active-creator'\)\)/i.test(text)) {
            return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
        }

        if (/SELECT id FROM users WHERE role = 'creator' AND COALESCE\(is_active, true\) = true AND id <> \$1 LIMIT 1/i.test(text)) {
            const row = state.users.find(item => item.role === 'creator' && item.is_active !== false && Number(item.id) !== Number(params[0]));
            return { rows: row ? [{ id: row.id }] : [] };
        }

        if (/SELECT id, username, role, extra_roles FROM users WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                role: row.role,
                extra_roles: row.extra_roles || []
            }] : [] };
        }

        if (/SELECT id, username, name, role, extra_roles, is_active, login_aliases FROM users WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                extra_roles: row.extra_roles || [],
                is_active: row.is_active,
                login_aliases: row.login_aliases || []
            }] : [] };
        }

        if (/SELECT id, username, name, role, extra_roles, action_denylist, is_active FROM users WHERE id = \$1 FOR UPDATE/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                extra_roles: row.extra_roles || [],
                action_denylist: row.action_denylist || [],
                is_active: row.is_active !== false
            }] : [] };
        }

        if (/SELECT id, username, name, role, created_at, last_seen_at, password_changed_at, session_revoked_at FROM users WHERE id = \$1 AND is_active = true/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]) && item.is_active !== false);
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                created_at: row.created_at || new Date(),
                last_seen_at: row.last_seen_at || null,
                password_changed_at: row.password_changed_at || null,
                session_revoked_at: row.session_revoked_at || null
            }] : [] };
        }

        if (/UPDATE refresh_tokens rt SET revoked_at = NOW\(\) FROM users u/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0] && !item.revoked_at);
            if (!row) return { rows: [], rowCount: 0 };
            row.revoked_at = new Date();
            const user = state.users.find(item => Number(item.id) === Number(row.user_id));
            return {
                rows: user ? [{
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    extra_roles: user.extra_roles || [],
                    page_allowlist: user.page_allowlist || [],
                    action_allowlist: user.action_allowlist || [],
                    action_denylist: user.action_denylist || [],
                    business_contexts: user.business_contexts || ['event_genix'],
                    default_business_context: user.default_business_context || 'event_genix',
                    name: user.name
                }] : [],
                rowCount: user ? 1 : 0
            };
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

        if (/SELECT u\.id, u\.username, u\.role, u\.extra_roles, u\.page_allowlist, u\.page_denylist, u\.action_allowlist, u\.action_denylist, u\.business_contexts, u\.default_business_context, u\.name/i.test(text)
            && /WHERE u\.username = \$1 AND u\.is_active = true/i.test(text)) {
            const row = state.users.find(item => item.username === params[0] && item.is_active !== false);
            return { rows: row ? [{ ...publicUser(row), avatar_emoji: null, avatar_color: null, avatar_url: null }] : [] };
        }

        if (/SELECT id FROM chat_channels WHERE is_default = true/i.test(text)) return { rows: [] };
        if (/INSERT INTO chat_channel_members/i.test(text)) return { rows: [], rowCount: 1 };
        if (/INSERT INTO admin_audit_log/i.test(text)) return { rows: [], rowCount: 1 };
        if (/SELECT password_hash FROM users WHERE username = \$1/i.test(text)) {
            const row = state.users.find(item => item.username === params[0]);
            return { rows: row ? [{ password_hash: row.password_hash }] : [] };
        }
        if (/UPDATE users SET password_hash = \$1,\s*password_changed_at = NOW\(\)\s*WHERE username = \$2\s*RETURNING id, username/i.test(text)) {
            const row = state.users.find(item => item.username === params[1]);
            if (row) {
                row.password_hash = params[0];
                row.password_changed_at = new Date();
            }
            return { rows: row ? [{ id: row.id, username: row.username }] : [], rowCount: row ? 1 : 0 };
        }
        if (/UPDATE users\s+SET qa_creator_lease_id = \$1::uuid,\s*qa_creator_lease_expires_at = NOW\(\) \+ \(\$2 \* INTERVAL '1 second'\),\s*qa_creator_lease_granted_by_user_id = \$3/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[3]));
            if (row) {
                row.qa_creator_lease_id = params[0];
                row.qa_creator_lease_expires_at = new Date(Date.now() + Number(params[1]) * 1000);
                row.qa_creator_lease_granted_by_user_id = Number(params[2]);
            }
            return { rows: row ? [{ qa_creator_lease_id: row.qa_creator_lease_id, qa_creator_lease_expires_at: row.qa_creator_lease_expires_at }] : [], rowCount: row ? 1 : 0 };
        }

        if (/UPDATE users\s+SET qa_creator_lease_id = NULL,\s*qa_creator_lease_expires_at = NULL,\s*qa_creator_lease_granted_by_user_id = NULL\s*WHERE id = \$1 AND qa_creator_lease_id = \$2::uuid/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]) && item.qa_creator_lease_id === params[1]);
            if (row) {
                row.qa_creator_lease_id = null;
                row.qa_creator_lease_expires_at = null;
                row.qa_creator_lease_granted_by_user_id = null;
            }
            return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }

        if (/UPDATE users SET role = \$1,\s*extra_roles = COALESCE\(\$2::text\[\], extra_roles\),\s*page_allowlist = COALESCE\(\$3::text\[\], page_allowlist\),\s*page_denylist = COALESCE\(\$4::text\[\], page_denylist\),\s*action_allowlist = COALESCE\(\$5::text\[\], action_allowlist\),\s*action_denylist = COALESCE\(\$6::text\[\], action_denylist\),\s*business_contexts = COALESCE\(\$7::text\[\], business_contexts\),\s*default_business_context = COALESCE\(\$8::text, default_business_context\),\s*session_revoked_at = NOW\(\)\s*WHERE id = \$9\s*RETURNING id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[8]));
            if (row) {
                row.role = params[0];
                if (Array.isArray(params[1])) row.extra_roles = params[1];
                if (Array.isArray(params[2])) row.page_allowlist = params[2];
                if (Array.isArray(params[3])) row.page_denylist = params[3];
                if (Array.isArray(params[4])) row.action_allowlist = params[4];
                if (Array.isArray(params[5])) row.action_denylist = params[5];
                if (Array.isArray(params[6])) row.business_contexts = params[6];
                if (params[7]) row.default_business_context = params[7];
                row.session_revoked_at = new Date();
            }
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                role: row.role,
                extra_roles: row.extra_roles || [],
                page_allowlist: row.page_allowlist || [],
                page_denylist: row.page_denylist || [],
                action_allowlist: row.action_allowlist || [],
                action_denylist: row.action_denylist || [],
                business_contexts: row.business_contexts || ['event_genix'],
                default_business_context: row.default_business_context || 'event_genix'
            }] : [], rowCount: row ? 1 : 0 };
        }
        if (/UPDATE users SET password_hash = \$1,\s*password_changed_at = NOW\(\),\s*session_revoked_at = NOW\(\),\s*is_active = CASE WHEN \$3::boolean THEN true ELSE is_active END\s*WHERE id = \$2\s*RETURNING id, username, is_active, password_changed_at, session_revoked_at/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[1]));
            if (row) {
                row.password_hash = params[0];
                row.password_changed_at = new Date();
                row.session_revoked_at = new Date();
                if (params[2]) row.is_active = true;
            }
            return { rows: row ? [{
                id: row.id,
                username: row.username,
                is_active: row.is_active,
                password_changed_at: row.password_changed_at,
                session_revoked_at: row.session_revoked_at
            }] : [], rowCount: row ? 1 : 0 };
        }
        if (/UPDATE users SET is_active = \$1,\s*session_revoked_at = CASE WHEN \$1 = false THEN NOW\(\) ELSE session_revoked_at END\s*WHERE id = \$2/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[1]));
            if (row) {
                row.is_active = !!params[0];
                if (!params[0]) row.session_revoked_at = new Date();
            }
            return { rows: [], rowCount: row ? 1 : 0 };
        }
        if (/UPDATE employee_profiles SET is_active = (false|true)/i.test(text)) return { rows: [], rowCount: 0 };
        if (/SELECT id, actor_username, target_username, event_type, reason, details, ip_address, created_at FROM account_security_events/i.test(text)) {
            const userId = Number(params[0]);
            const limit = Number(params[1]) || 12;
            const rows = state.securityEvents
                .filter(event => Number(event.target_user_id) === userId || Number(event.actor_user_id) === userId)
                .slice()
                .sort((a, b) => b.id - a.id)
                .slice(0, limit)
                .map(event => ({
                    id: event.id,
                    actor_username: event.actor_username,
                    target_username: event.target_username,
                    event_type: event.event_type,
                    reason: event.reason,
                    details: event.details,
                    ip_address: event.ip_address,
                    created_at: event.created_at
                }));
            return { rows };
        }
        if (/INSERT INTO account_security_events/i.test(text)) {
            const [actorUserId, actorUsername, targetUserId, targetUsername, eventType, reason, details, ipAddress, userAgent] = params;
            state.securityEvents.push({
                id: state.securityEvents.length + 1,
                actor_user_id: actorUserId,
                actor_username: actorUsername,
                target_user_id: targetUserId,
                target_username: targetUsername,
                event_type: eventType,
                reason,
                details: typeof details === 'string' ? JSON.parse(details) : (details || {}),
                ip_address: ipAddress,
                user_agent: userAgent,
                created_at: new Date()
            });
            return { rows: [], rowCount: 1 };
        }
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

    const { authenticateToken, requireAction } = require('../middleware/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/users', require('../routes/users'));
    app.get('/api/protected-smoke', authenticateToken, (req, res) => {
        res.json({ success: true, user: req.user });
    });
    app.delete('/api/delete-booking-smoke', authenticateToken, requireAction('delete_booking'), (_req, res) => {
        res.json({ success: true });
    });
    app.get('/api/manage-accounts-smoke', authenticateToken, requireAction('manage_accounts'), (_req, res) => {
        res.json({ success: true });
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

test('protected system accounts cannot be impersonated', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const guardian = {
            id: fakePool.state.nextUserId++,
            username: 'guardian',
            name: 'Guardian',
            role: 'bot',
            extra_roles: [],
            page_allowlist: [],
            page_denylist: [],
            action_allowlist: [],
            action_denylist: [],
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            is_active: true,
            login_aliases: []
        };
        fakePool.state.users.push(guardian);

        const impersonate = await request(baseUrl, 'POST', '/api/auth/impersonate', { userId: guardian.id }, creatorToken());
        assert.equal(impersonate.status, 403);
        assert.equal(impersonate.data.code, 'PROTECTED_SYSTEM_ACCOUNT');
        assert.equal(fakePool.state.securityEvents.some(event => event.event_type === 'account_impersonation_started' && event.target_user_id === guardian.id), false);
    });
});

test('impersonation honors manage_accounts denylist, blocks self, and preserves target access overrides', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.action_denylist = ['manage_accounts'];
        const deniedToken = creatorToken();

        const deniedImpersonation = await request(baseUrl, 'POST', '/api/auth/impersonate', { userId: 2 }, deniedToken);
        const deniedList = await request(baseUrl, 'GET', '/api/auth/users-list', undefined, deniedToken);
        assert.equal(deniedImpersonation.status, 403);
        assert.equal(deniedList.status, 403);

        creator.action_denylist = [];
        const self = await request(baseUrl, 'POST', '/api/auth/impersonate', { userId: creator.id }, creatorToken());
        assert.equal(self.status, 409);
        assert.equal(self.data.code, 'SELF_IMPERSONATION_FORBIDDEN');

        const target = {
            id: fakePool.state.nextUserId++,
            username: 'restricted.operator',
            name: 'Restricted Operator',
            role: 'animator',
            extra_roles: [],
            page_allowlist: ['/hr.html'],
            action_allowlist: ['delete_booking'],
            action_denylist: ['manage_staff'],
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            is_active: true,
            login_aliases: []
        };
        fakePool.state.users.push(target);

        const impersonate = await request(baseUrl, 'POST', '/api/auth/impersonate', { userId: target.id }, creatorToken());
        assert.equal(impersonate.status, 200);
        const payload = jwt.verify(impersonate.data.token, TEST_JWT_SECRET);
        assert.deepEqual(payload.actionAllowlist, ['delete_booking']);
        assert.deepEqual(payload.actionDenylist, ['manage_staff']);
        assert.deepEqual(payload.pageAllowlist, ['/hr']);
    });
});

test('account onboarding requires hr.staff.manage in addition to manage_accounts before any transaction', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.action_denylist = ['hr.staff.manage'];

        const options = await request(baseUrl, 'GET', '/api/users/onboarding/options', undefined, creatorToken());
        const create = await request(baseUrl, 'POST', '/api/users/onboarding', {}, creatorToken());

        assert.equal(options.status, 403);
        assert.equal(create.status, 403);
        assert.deepEqual(fakePool.state.transactionStatements, []);
        assert.equal(fakePool.state.users.length, 1);
    });
});

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

test('account security journal records semantic account, password, role, login, and logout events', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const create = await request(baseUrl, 'POST', '/api/users', {
            username: 'audit.operator',
            password: 'AuditPass789!',
            name: 'Audit Operator',
            role: 'animator',
            extraRoles: ['instructor'],
            pageAllowlist: ['/tasks'],
            businessContexts: ['event_genix', 'dar'],
            defaultBusinessContext: 'dar'
        }, creatorToken());
        assert.equal(create.status, 200);
        assert.deepEqual(create.data.user.business_contexts, ['event_genix']);
        assert.equal(create.data.user.default_business_context, 'event_genix');
        const userId = create.data.user.id;

        const wrongPassword = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'audit.operator',
            password: 'WrongAuditPass789!'
        });
        assert.equal(wrongPassword.status, 401);

        const missingUser = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'missing.audit.operator',
            password: 'WrongAuditPass789!'
        });
        assert.equal(missingUser.status, 401);

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'audit.operator',
            password: 'AuditPass789!'
        });
        assert.equal(login.status, 200);

        const accessUpdate = await request(baseUrl, 'PATCH', `/api/users/${userId}/access`, {
            role: 'reception',
            extraRoles: ['manager'],
            pageAllowlist: ['/reports', '/tasks'],
            actionAllowlist: ['delete_booking'],
            actionDenylist: [],
            businessContexts: ['dar', 'crm'],
            defaultBusinessContext: 'crm'
        }, creatorToken());
        assert.equal(accessUpdate.status, 200);
        assert.deepEqual(accessUpdate.data.extraRoles, ['manager']);
        assert.deepEqual(accessUpdate.data.pageAllowlist, ['/reports', '/tasks']);
        assert.deepEqual(accessUpdate.data.actionAllowlist, ['delete_booking']);
        assert.deepEqual(accessUpdate.data.actionDenylist, []);
        assert.deepEqual(accessUpdate.data.businessContexts, ['event_genix']);
        assert.equal(accessUpdate.data.defaultBusinessContext, 'event_genix');

        const revokedRefresh = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: login.data.refreshToken });
        assert.equal(revokedRefresh.status, 401);

        const accessLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'audit.operator',
            password: 'AuditPass789!'
        });
        assert.equal(accessLogin.status, 200);

        const updatedAccessProtected = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, accessLogin.data.accessToken);
        assert.equal(updatedAccessProtected.status, 200);
        assert.deepEqual(updatedAccessProtected.data.user.businessContexts, ['event_genix']);
        assert.equal(updatedAccessProtected.data.user.defaultBusinessContext, 'event_genix');
        assert.deepEqual(updatedAccessProtected.data.user.extraRoles, ['manager']);

        const impersonate = await request(baseUrl, 'POST', '/api/auth/impersonate', {
            userId
        }, creatorToken());
        assert.equal(impersonate.status, 200);
        assert.ok(impersonate.data.token);

        const passwordChange = await request(baseUrl, 'PUT', '/api/auth/password', {
            currentPassword: 'AuditPass789!',
            newPassword: 'AuditPass987!'
        }, accessLogin.data.accessToken);
        assert.equal(passwordChange.status, 200);

        const passwordLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'audit.operator',
            password: 'AuditPass987!'
        });
        assert.equal(passwordLogin.status, 200);

        const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
            refreshToken: passwordLogin.data.refreshToken
        });
        assert.equal(logout.status, 200);

        const security = await request(baseUrl, 'GET', '/api/auth/security?limit=50', undefined, passwordLogin.data.accessToken);
        assert.equal(security.status, 200);
        assert.ok(security.data.events.some(event => event.event_type === 'account_access_updated'));

        const reset = await request(baseUrl, 'POST', `/api/users/${userId}/reset-password`, {
            newPassword: 'AuditReset789!'
        }, creatorToken());
        assert.equal(reset.status, 200);

        const deactivate = await request(baseUrl, 'PATCH', `/api/users/${userId}/active`, {
            isActive: false
        }, creatorToken());
        assert.equal(deactivate.status, 200);

        const inactiveLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'audit.operator',
            password: 'AuditReset789!'
        });
        assert.equal(inactiveLogin.status, 401);

        const activate = await request(baseUrl, 'PATCH', `/api/users/${userId}/active`, {
            isActive: true
        }, creatorToken());
        assert.equal(activate.status, 200);

        const eventTypes = fakePool.state.securityEvents.map(event => event.event_type);
        [
            'account_created',
            'login_failed',
            'login_success',
            'account_access_updated',
            'account_impersonation_started',
            'password_changed',
            'session_logout',
            'password_reset_by_admin',
            'account_deactivated',
            'account_activated'
        ].forEach(type => assert.ok(eventTypes.includes(type), `missing account security event ${type}`));

        const roleEvent = fakePool.state.securityEvents.find(event => event.event_type === 'account_access_updated');
        assert.equal(roleEvent.target_username, 'audit.operator');
        assert.equal(roleEvent.actor_username, 'creator');
        assert.equal(roleEvent.details.oldRole, 'animator');
        assert.equal(roleEvent.details.newRole, 'reception');
        assert.deepEqual(roleEvent.details.oldExtraRoles, ['instructor']);
        assert.deepEqual(roleEvent.details.newExtraRoles, ['manager']);
        assert.deepEqual(roleEvent.details.oldPageAllowlist, ['/tasks']);
        assert.deepEqual(roleEvent.details.newPageAllowlist, ['/reports', '/tasks']);
        assert.deepEqual(roleEvent.details.oldActionAllowlist, []);
        assert.deepEqual(roleEvent.details.newActionAllowlist, ['delete_booking']);
        assert.deepEqual(roleEvent.details.oldActionDenylist, []);
        assert.deepEqual(roleEvent.details.newActionDenylist, []);
        assert.deepEqual(roleEvent.details.oldBusinessContexts, ['event_genix']);
        assert.deepEqual(roleEvent.details.newBusinessContexts, ['event_genix']);
        assert.equal(roleEvent.details.oldDefaultBusinessContext, 'event_genix');
        assert.equal(roleEvent.details.newDefaultBusinessContext, 'event_genix');
        assert.equal(roleEvent.details.changed.pageAllowlist, true);
        assert.equal(roleEvent.details.changed.actionAllowlist, true);
        assert.equal(roleEvent.details.changed.businessContexts, false);
        assert.equal(roleEvent.details.changed.defaultBusinessContext, false);

        const missingLoginEvent = fakePool.state.securityEvents.find(event => event.event_type === 'login_failed' && event.reason === 'user_not_found');
        assert.ok(missingLoginEvent, 'nonexistent login attempt must be recorded without a subject account');
        assert.equal(missingLoginEvent.target_username, null);
        assert.equal(typeof missingLoginEvent.details.identifierHash, 'string');

        const inactiveLoginEvent = fakePool.state.securityEvents.find(event => event.event_type === 'login_failed' && event.reason === 'inactive_account');
        assert.equal(inactiveLoginEvent.target_username, 'audit.operator');
    });
});

test('account action overrides drive final permissions and protect against self-lockout', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const createAnimator = await request(baseUrl, 'POST', '/api/users', {
            username: 'action.operator',
            password: 'ActionPass789!',
            name: 'Action Operator',
            role: 'animator',
            actionAllowlist: ['delete_booking']
        }, creatorToken());
        assert.equal(createAnimator.status, 200);

        const animatorLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'action.operator',
            password: 'ActionPass789!'
        });
        assert.equal(animatorLogin.status, 200);

        const allowedDelete = await request(baseUrl, 'DELETE', '/api/delete-booking-smoke', undefined, animatorLogin.data.accessToken);
        assert.equal(allowedDelete.status, 200);

        const allowedPermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, animatorLogin.data.accessToken);
        assert.equal(allowedPermissions.status, 200);
        assert.equal(allowedPermissions.data.actions.delete_booking, true);
        assert.equal(allowedPermissions.data.actionSources.delete_booking, 'explicit_allow');

        const conflictingUpdate = await request(baseUrl, 'PATCH', `/api/users/${createAnimator.data.user.id}/access`, {
            role: 'animator',
            actionAllowlist: ['delete_booking'],
            actionDenylist: ['delete_booking']
        }, creatorToken());
        assert.equal(conflictingUpdate.status, 400);
        assert.equal(conflictingUpdate.data.code, 'CAPABILITY_ALLOW_DENY_CONFLICT');
        assert.deepEqual(conflictingUpdate.data.details.conflicts, ['delete_booking']);

        const unknownActionUpdate = await request(baseUrl, 'PATCH', `/api/users/${createAnimator.data.user.id}/access`, {
            role: 'animator',
            actionAllowlist: ['unknown_permission']
        }, creatorToken());
        assert.equal(unknownActionUpdate.status, 400);
        assert.equal(unknownActionUpdate.data.code, 'UNKNOWN_CAPABILITY_KEYS');
        assert.deepEqual(unknownActionUpdate.data.details.unknownKeys, ['unknown_permission']);
        assert.match(unknownActionUpdate.data.error, /unknown_permission/);

        const unknownPageUpdate = await request(baseUrl, 'PATCH', `/api/users/${createAnimator.data.user.id}/access`, {
            role: 'animator',
            pageAllowlist: ['/unknown-permission-page']
        }, creatorToken());
        assert.equal(unknownPageUpdate.status, 400);
        assert.equal(unknownPageUpdate.data.code, 'UNKNOWN_CAPABILITY_KEYS');
        assert.deepEqual(unknownPageUpdate.data.details.unknownKeys, ['/unknown-permission-page']);
        assert.match(unknownPageUpdate.data.error, /unknown-permission-page/);

        const denyUpdate = await request(baseUrl, 'PATCH', `/api/users/${createAnimator.data.user.id}/access`, {
            role: 'animator',
            pageAllowlist: [],
            actionAllowlist: [],
            actionDenylist: ['delete_booking']
        }, creatorToken());
        assert.equal(denyUpdate.status, 200);
        assert.deepEqual(denyUpdate.data.pageAllowlist, []);

        const deniedLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'action.operator',
            password: 'ActionPass789!'
        });
        assert.equal(deniedLogin.status, 200);

        const deniedDelete = await request(baseUrl, 'DELETE', '/api/delete-booking-smoke', undefined, deniedLogin.data.accessToken);
        assert.equal(deniedDelete.status, 403);

        const deniedPermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, deniedLogin.data.accessToken);
        assert.equal(deniedPermissions.status, 200);
        assert.equal(deniedPermissions.data.actions.delete_booking, false);
        assert.equal(deniedPermissions.data.actionSources.delete_booking, 'explicit_deny');

        const createPageManager = await request(baseUrl, 'POST', '/api/users', {
            username: 'page.manager',
            password: 'PagePass789!',
            name: 'Page Manager',
            role: 'senior_manager'
        }, creatorToken());
        assert.equal(createPageManager.status, 200);

        const newExplicitAllowDisabledPage = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageAllowlist: ['/finance']
        }, creatorToken());
        assert.equal(newExplicitAllowDisabledPage.status, 400);
        assert.equal(newExplicitAllowDisabledPage.data.code, 'EXPLICIT_ALLOW_DISABLED_CAPABILITY');
        assert.deepEqual(newExplicitAllowDisabledPage.data.details.explicitAllowDisabledKeys, ['/finance']);

        const legacyPageManager = fakePool.state.users.find(user => user.id === createPageManager.data.user.id);
        legacyPageManager.page_allowlist = ['/finance', '/maysternya-doli'];
        const preserveLegacyExplicitAllowDisabledPages = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageAllowlist: ['/finance', '/maysternya-doli', '/reports']
        }, creatorToken());
        assert.equal(preserveLegacyExplicitAllowDisabledPages.status, 200);
        assert.deepEqual(preserveLegacyExplicitAllowDisabledPages.data.pageAllowlist, ['/finance', '/maysternya-doli', '/reports']);

        const removeLegacyExplicitAllowDisabledPages = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageAllowlist: []
        }, creatorToken());
        assert.equal(removeLegacyExplicitAllowDisabledPages.status, 200);
        assert.deepEqual(removeLegacyExplicitAllowDisabledPages.data.pageAllowlist, []);

        const reAddRemovedExplicitAllowDisabledPage = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageAllowlist: ['/finance']
        }, creatorToken());
        assert.equal(reAddRemovedExplicitAllowDisabledPage.status, 400);
        assert.equal(reAddRemovedExplicitAllowDisabledPage.data.code, 'EXPLICIT_ALLOW_DISABLED_CAPABILITY');

        const inheritedPageLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'page.manager',
            password: 'PagePass789!'
        });
        assert.equal(inheritedPageLogin.status, 200);
        const inheritedPagePermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, inheritedPageLogin.data.accessToken);
        assert.equal(inheritedPagePermissions.status, 200);
        assert.equal(inheritedPagePermissions.data.pages['/reports'], true);
        assert.equal(inheritedPagePermissions.data.pageSources['/reports'], 'role_preset');
        assert.deepEqual(inheritedPagePermissions.data.pageDenylist, []);

        const pageAliasConflict = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageAllowlist: ['/chat'],
            pageDenylist: ['/kleshnya']
        }, creatorToken());
        assert.equal(pageAliasConflict.status, 400);
        assert.equal(pageAliasConflict.data.code, 'CAPABILITY_ALLOW_DENY_CONFLICT');
        assert.deepEqual(pageAliasConflict.data.details.conflicts, ['/chat']);

        const unknownPageDeny = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageDenylist: ['/unknown-page-deny']
        }, creatorToken());
        assert.equal(unknownPageDeny.status, 400);
        assert.equal(unknownPageDeny.data.code, 'UNKNOWN_CAPABILITY_KEYS');
        assert.deepEqual(unknownPageDeny.data.details.unknownKeys, ['/unknown-page-deny']);

        const pageDenyUpdate = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageDenylist: ['/reports']
        }, creatorToken());
        assert.equal(pageDenyUpdate.status, 200);
        assert.deepEqual(pageDenyUpdate.data.pageDenylist, ['/reports']);

        const compatibilityUpdate = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            actionAllowlist: [],
            actionDenylist: []
        }, creatorToken());
        assert.equal(compatibilityUpdate.status, 200);
        assert.deepEqual(compatibilityUpdate.data.pageDenylist, ['/reports'], 'legacy PATCH omission must not erase an existing deny');

        const deniedPageLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'page.manager',
            password: 'PagePass789!'
        });
        assert.equal(deniedPageLogin.status, 200);
        assert.deepEqual(deniedPageLogin.data.user.pageDenylist, ['/reports']);
        const deniedPagePermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, deniedPageLogin.data.accessToken);
        assert.equal(deniedPagePermissions.data.pages['/reports'], false);
        assert.equal(deniedPagePermissions.data.pageSources['/reports'], 'explicit_deny');

        const pageReset = await request(baseUrl, 'PATCH', `/api/users/${createPageManager.data.user.id}/access`, {
            role: 'senior_manager',
            pageDenylist: []
        }, creatorToken());
        assert.equal(pageReset.status, 200);
        assert.deepEqual(pageReset.data.pageDenylist, []);
        const resetPageLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'page.manager',
            password: 'PagePass789!'
        });
        const resetPagePermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, resetPageLogin.data.accessToken);
        assert.equal(resetPagePermissions.data.pages['/reports'], true);
        assert.equal(resetPagePermissions.data.pageSources['/reports'], 'role_preset');

        const createHr = await request(baseUrl, 'POST', '/api/users', {
            username: 'hr.operator',
            password: 'HrPass789!',
            name: 'HR Operator',
            role: 'hr'
        }, creatorToken());
        assert.equal(createHr.status, 200);

        const hrLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'hr.operator',
            password: 'HrPass789!'
        });
        assert.equal(hrLogin.status, 200);
        const hrManageAccounts = await request(baseUrl, 'GET', '/api/manage-accounts-smoke', undefined, hrLogin.data.accessToken);
        assert.equal(hrManageAccounts.status, 403);
        const hrRolesMatrix = await request(baseUrl, 'GET', '/api/users/roles', undefined, hrLogin.data.accessToken);
        assert.equal(hrRolesMatrix.status, 403);

        const creatorRolesMatrix = await request(baseUrl, 'GET', '/api/users/roles', undefined, creatorToken());
        assert.equal(creatorRolesMatrix.status, 200);
        assert.deepEqual(creatorRolesMatrix.data.nonDelegableActions.sort(), ['fiscal.configure', 'manage_accounts', 'manage_settings'].sort());
        assert.equal(creatorRolesMatrix.data.actions.find(action => action.key === 'manage_accounts').delegable, false);

        const createArtDirector = await request(baseUrl, 'POST', '/api/users', {
            username: 'art.director',
            password: 'ArtPass789!',
            name: 'Art Director',
            role: 'art_director'
        }, creatorToken());
        assert.equal(createArtDirector.status, 200);

        const artLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'art.director',
            password: 'ArtPass789!'
        });
        assert.equal(artLogin.status, 200);
        const artManageAccounts = await request(baseUrl, 'GET', '/api/manage-accounts-smoke', undefined, artLogin.data.accessToken);
        assert.equal(artManageAccounts.status, 403);

        const createSecurityOverride = await request(baseUrl, 'POST', '/api/users', {
            username: 'security.override',
            password: 'SecurityPass789!',
            name: 'Security Override',
            role: 'animator',
            actionAllowlist: ['manage_accounts']
        }, creatorToken());
        assert.equal(createSecurityOverride.status, 200);
        assert.deepEqual(createSecurityOverride.data.user.action_allowlist, []);

        const securityLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'security.override',
            password: 'SecurityPass789!'
        });
        assert.equal(securityLogin.status, 200);
        const securityManageAccounts = await request(baseUrl, 'GET', '/api/manage-accounts-smoke', undefined, securityLogin.data.accessToken);
        assert.equal(securityManageAccounts.status, 403);
        const securityPermissions = await request(baseUrl, 'GET', '/api/auth/permissions', undefined, securityLogin.data.accessToken);
        assert.equal(securityPermissions.status, 200);
        assert.equal(securityPermissions.data.actions.manage_accounts, false);
        assert.equal(securityPermissions.data.actionSources.manage_accounts, 'default_deny');
        assert.equal(securityPermissions.data.capabilities['action:manage_accounts'].reason, 'no_matching_grant');

        const selfLockout = await request(baseUrl, 'PATCH', '/api/users/1/access', {
            role: 'creator',
            actionDenylist: ['manage_accounts']
        }, creatorToken());
        assert.equal(selfLockout.status, 400);
        assert.match(selfLockout.data.error, /акаунт/i);
    });
});

test('director account management is capped below director level', async () => {
    await withAuthApp(async ({ baseUrl }) => {
        const createDirector = await request(baseUrl, 'POST', '/api/users', {
            username: 'director.operator',
            password: 'DirectorPass789!',
            name: 'Director Operator',
            role: 'director',
            businessContexts: ['event_genix', 'dar'],
            defaultBusinessContext: 'dar'
        }, creatorToken());
        assert.equal(createDirector.status, 200);
        assert.deepEqual(createDirector.data.user.business_contexts, ['event_genix', 'dar']);
        assert.equal(createDirector.data.user.default_business_context, 'dar');

        const directorLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'director.operator',
            password: 'DirectorPass789!'
        });
        assert.equal(directorLogin.status, 200);
        const directorToken = directorLogin.data.accessToken;
        const directorVerify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, directorToken);
        assert.equal(directorVerify.status, 200);
        assert.equal(directorVerify.data.user.businessContextPolicy.canSwitch, true);
        assert.deepEqual(directorVerify.data.user.businessContextPolicy.allowed, ['event_genix', 'dar']);
        assert.equal(directorVerify.data.user.defaultBusinessContext, 'dar');

        const createManager = await request(baseUrl, 'POST', '/api/users', {
            username: 'manager.by.director',
            password: 'ManagerPass789!',
            name: 'Manager By Director',
            role: 'manager',
            actionAllowlist: ['delete_booking', 'hr.staff.manage', 'manage_accounts']
        }, directorToken);
        assert.equal(createManager.status, 200, JSON.stringify(createManager.data));
        assert.deepEqual(createManager.data.user.action_allowlist, ['delete_booking', 'hr.staff.manage']);

        const createPeerDirector = await request(baseUrl, 'POST', '/api/users', {
            username: 'peer.director',
            password: 'PeerPass789!',
            name: 'Peer Director',
            role: 'director'
        }, directorToken);
        assert.equal(createPeerDirector.status, 403);

        const updateCreator = await request(baseUrl, 'PATCH', '/api/users/1/access', {
            role: 'creator'
        }, directorToken);
        assert.equal(updateCreator.status, 403);

        const promoteManager = await request(baseUrl, 'PATCH', `/api/users/${createManager.data.user.id}/access`, {
            role: 'director'
        }, directorToken);
        assert.equal(promoteManager.status, 403);

        const updateManager = await request(baseUrl, 'PATCH', `/api/users/${createManager.data.user.id}/access`, {
            role: 'admin',
            extraRoles: ['manager'],
            actionAllowlist: ['edit_booking']
        }, directorToken);
        assert.equal(updateManager.status, 200, JSON.stringify(updateManager.data));
        assert.equal(updateManager.data.newRole, 'admin');

        const creatorUpdatesDirector = await request(baseUrl, 'PATCH', `/api/users/${createDirector.data.user.id}/access`, {
            role: 'manager'
        }, creatorToken());
        assert.equal(creatorUpdatesDirector.status, 200, JSON.stringify(creatorUpdatesDirector.data));
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

test('isolated QA creator lease expires fail-closed and never changes the stored role', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const created = await request(baseUrl, 'POST', '/api/users', {
            username: 'dedicated.qa',
            password: 'DedicatedQaPass789!',
            name: 'Dedicated QA',
            role: 'senior_manager'
        }, creatorToken());
        assert.equal(created.status, 200, JSON.stringify(created.data));
        const qaUser = fakePool.state.users.find(user => user.username === 'dedicated.qa');
        assert.equal(qaUser.role, 'senior_manager');

        const started = await request(baseUrl, 'POST', `/api/users/${qaUser.id}/qa-creator-lease`, {
            durationSeconds: 15 * 60
        }, creatorToken());
        assert.equal(started.status, 200, JSON.stringify(started.data));
        assert.equal(started.data.role, 'creator');
        assert.ok(started.data.leaseId);
        assert.equal(qaUser.role, 'senior_manager', 'lease must not write users.role');

        const qaLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'dedicated.qa',
            password: 'DedicatedQaPass789!'
        });
        assert.equal(qaLogin.status, 200, JSON.stringify(qaLogin.data));
        assert.equal(qaLogin.data.user.role, 'creator');
        assert.equal(qaLogin.data.user.qaCreatorLeaseId, started.data.leaseId);

        const temporaryActorCannotLease = await request(baseUrl, 'POST', `/api/users/${qaUser.id}/qa-creator-lease`, {
            durationSeconds: 15 * 60
        }, qaLogin.data.token);
        assert.equal(temporaryActorCannotLease.status, 403);
        assert.equal(temporaryActorCannotLease.data.code, 'QA_CREATOR_LEASE_ACTOR_FORBIDDEN');

        qaUser.qa_creator_lease_expires_at = new Date(Date.now() - 1_000);
        const expiredAccess = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, qaLogin.data.token);
        assert.equal(expiredAccess.status, 200);
        assert.equal(expiredAccess.data.user.role, 'senior_manager', 'expired lease must fall back to the stored role');

        const revoked = await request(baseUrl, 'DELETE', `/api/users/${qaUser.id}/qa-creator-lease`, {
            leaseId: started.data.leaseId
        }, creatorToken());
        assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
        assert.equal(qaUser.qa_creator_lease_id, null);
        assert.equal(qaUser.qa_creator_lease_expires_at, null);
        assert.equal(qaUser.role, 'senior_manager');
    });
});
