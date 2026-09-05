const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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
        queryStatements: [],
        transactionStatements: [],
        beforeLoginRevalidation: null,
        databaseClockOffsetMs: 0
    };

    const databaseNow = () => new Date(Date.now() + Number(state.databaseClockOffsetMs || 0));

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
        state.queryStatements.push(text);

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

        if (/SELECT u\.id, u\.username, u\.password_hash/i.test(text)
            && /FROM users u/i.test(text)
            && /FOR UPDATE OF u/i.test(text)) {
            if (typeof state.beforeLoginRevalidation === 'function') {
                const revalidate = state.beforeLoginRevalidation;
                state.beforeLoginRevalidation = null;
                await revalidate();
            }
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
                telegram_chat_id: user.telegram_chat_id || null,
                is_active: user.is_active,
                login_aliases: user.login_aliases || [],
                avatar_emoji: user.avatar_emoji || null,
                avatar_color: user.avatar_color || null,
                avatar_url: user.avatar_url || null
            }] : [] };
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
                created_at: databaseNow(),
                expires_at: expiresAt,
                revoked_at: null,
                replaced_by: null
            };
            state.refreshTokens.push(row);
            return { rows: [row], rowCount: 1 };
        }

        if (/SELECT user_id FROM refresh_tokens WHERE token_hash = \$1/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0]);
            return { rows: row ? [{ user_id: row.user_id }] : [] };
        }

        if (/SELECT id, user_id, device_info, ip_address, revoked_at, replaced_by, expires_at, created_at,/i.test(text)
            && /rotation_age_ms FROM refresh_tokens WHERE token_hash = \$1 FOR UPDATE/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0]);
            return {
                rows: row ? [{
                    ...row,
                    rotation_age_ms: row.revoked_at
                        ? databaseNow().getTime() - new Date(row.revoked_at).getTime()
                        : null
                }] : []
            };
        }

        if (/SELECT id, user_id, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = \$1 FOR UPDATE/i.test(text)) {
            const row = state.refreshTokens.find(item => item.token_hash === params[0]);
            return { rows: row ? [{
                id: row.id,
                user_id: row.user_id,
                revoked_at: row.revoked_at,
                replaced_by: row.replaced_by
            }] : [] };
        }

        if (/SELECT id, user_id, revoked_at, replaced_by FROM refresh_tokens WHERE id = \$1 AND user_id = \$2 FOR UPDATE/i.test(text)) {
            const row = state.refreshTokens.find(item => Number(item.id) === Number(params[0])
                && Number(item.user_id) === Number(params[1]));
            return { rows: row ? [{
                id: row.id,
                user_id: row.user_id,
                revoked_at: row.revoked_at,
                replaced_by: row.replaced_by
            }] : [] };
        }

        if (/SELECT device_info, ip_address FROM refresh_tokens WHERE id = \$1 AND user_id = \$2/i.test(text)) {
            const row = state.refreshTokens.find(item => Number(item.id) === Number(params[0]) && Number(item.user_id) === Number(params[1]));
            return { rows: row ? [{ device_info: row.device_info, ip_address: row.ip_address }] : [] };
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

        if (/SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, name, telegram_chat_id FROM users WHERE id = \$1 FOR UPDATE/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            return { rows: row ? [{ ...publicUser(row) }] : [] };
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

        if (/UPDATE refresh_tokens SET revoked_at = (?:NOW|clock_timestamp)\(\), replaced_by =/i.test(text)) {
            const newRow = state.refreshTokens.find(item => item.token_hash === params[0])
                || state.refreshTokens.find(item => Number(item.id) === Number(params[0]));
            const oldRow = state.refreshTokens.find(item => Number(item.id) === Number(params[1]));
            if (oldRow) {
                oldRow.revoked_at = databaseNow();
                oldRow.replaced_by = newRow?.id || null;
            }
            return { rows: [], rowCount: oldRow ? 1 : 0 };
        }

        if (/UPDATE refresh_tokens SET replaced_by = \$1 WHERE id = \$2/i.test(text)) {
            const row = state.refreshTokens.find(item => Number(item.id) === Number(params[1]));
            if (row) row.replaced_by = Number(params[0]);
            return { rows: [], rowCount: row ? 1 : 0 };
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

        if (/UPDATE refresh_tokens SET revoked_at = clock_timestamp\(\) WHERE user_id = \$1/i.test(text)) {
            let count = 0;
            state.refreshTokens.forEach(item => {
                if (Number(item.user_id) === Number(params[0]) && !item.revoked_at) {
                    item.revoked_at = new Date();
                    count += 1;
                }
            });
            return { rows: [], rowCount: count };
        }

        if (/UPDATE refresh_tokens SET revoked_at = clock_timestamp\(\) WHERE id = ANY\(\$1::int\[\]\) AND revoked_at IS NULL(?: RETURNING id)?/i.test(text)) {
            const ids = new Set((params[0] || []).map(Number));
            const rows = [];
            state.refreshTokens.forEach(item => {
                if (ids.has(Number(item.id)) && !item.revoked_at) {
                    item.revoked_at = new Date();
                    rows.push({ id: item.id });
                }
            });
            return { rows, rowCount: rows.length };
        }

        if (/UPDATE refresh_tokens SET revoked_at = clock_timestamp\(\) WHERE id = ANY\(\$1::int\[\]\) AND id <> \$2 AND revoked_at IS NULL/i.test(text)) {
            const ids = new Set((params[0] || []).map(Number));
            const keepId = Number(params[1]);
            let count = 0;
            state.refreshTokens.forEach(item => {
                if (ids.has(Number(item.id)) && Number(item.id) !== keepId && !item.revoked_at) {
                    item.revoked_at = databaseNow();
                    count += 1;
                }
            });
            return { rows: [], rowCount: count };
        }

        if (/UPDATE users SET session_revoked_at = (?:NOW|clock_timestamp)\(\) WHERE id = \$1/i.test(text)) {
            const row = state.users.find(item => Number(item.id) === Number(params[0]));
            if (row) row.session_revoked_at = new Date();
            return { rows: [], rowCount: row ? 1 : 0 };
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

        if (/UPDATE users SET role = \$1,\s*extra_roles = COALESCE\(\$2::text\[\], extra_roles\),\s*page_allowlist = COALESCE\(\$3::text\[\], page_allowlist\),\s*page_denylist = COALESCE\(\$4::text\[\], page_denylist\),\s*action_allowlist = COALESCE\(\$5::text\[\], action_allowlist\),\s*action_denylist = COALESCE\(\$6::text\[\], action_denylist\),\s*business_contexts = COALESCE\(\$7::text\[\], business_contexts\),\s*default_business_context = COALESCE\(\$8::text, default_business_context\),\s*session_revoked_at = (?:NOW|clock_timestamp)\(\)\s*WHERE id = \$9\s*RETURNING id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context/i.test(text)) {
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
        if (/UPDATE users SET password_hash = \$1,\s*password_changed_at = NOW\(\),\s*session_revoked_at = (?:NOW|clock_timestamp)\(\),\s*is_active = CASE WHEN \$3::boolean THEN true ELSE is_active END\s*WHERE id = \$2\s*RETURNING id, username, is_active, password_changed_at, session_revoked_at/i.test(text)) {
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
        if (/UPDATE users SET is_active = \$1,\s*session_revoked_at = CASE WHEN \$1 = false THEN (?:NOW|clock_timestamp)\(\) ELSE session_revoked_at END\s*WHERE id = \$2/i.test(text)) {
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

async function request(baseUrl, method, path, body, token, extraHeaders = {}) {
    const headers = { ...extraHeaders };
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
    app.use(require('../middleware/apiVersioning').apiVersionRewrite);
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/users', require('../routes/users'));
    app.get('/api/protected-smoke', authenticateToken, (req, res) => {
        res.json({ success: true, user: req.user });
    });
    app.get('/api/demo/overview', authenticateToken, (req, res) => {
        res.json({ success: true, user: req.user });
    });
    app.post('/api/demo/sessions', authenticateToken, (req, res) => {
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

test('login revalidates the locked account before issuing tokens after a concurrent password reset', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const user = fakePool.state.users[0];
        user.username = 'race.operator';
        user.password_hash = await bcrypt.hash('old-password', 4);
        const replacementHash = await bcrypt.hash('new-password', 4);
        fakePool.state.beforeLoginRevalidation = async () => {
            user.password_hash = replacementHash;
            user.session_revoked_at = new Date();
        };

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: 'race.operator',
            password: 'old-password'
        });

        assert.equal(login.status, 401);
        assert.equal(login.data.error, 'Невірний логін або пароль');
        assert.equal(fakePool.state.refreshTokens.length, 0);
        assert.deepEqual(fakePool.state.transactionStatements.slice(-2), ['BEGIN', 'ROLLBACK']);
        assert.ok(fakePool.state.securityEvents.some(event => event.reason === 'password_changed'));
    });
});

test('signed demo tokens work only for the scoped demo playback API', async () => {
    await withAuthApp(async ({ baseUrl }) => {
        const demoToken = jwt.sign({
            id: -1,
            username: 'demo',
            role: 'viewer',
            name: 'Demo User',
            isDemo: true,
            tokenPurpose: 'demo',
            sessionIssuedAt: Date.now()
        }, TEST_JWT_SECRET, { expiresIn: '2h' });

        const overview = await request(baseUrl, 'GET', '/api/demo/overview', undefined, demoToken);
        const versionedOverview = await request(baseUrl, 'GET', '/api/v1/demo/overview', undefined, demoToken);
        const session = await request(baseUrl, 'POST', '/api/demo/sessions', {}, demoToken);
        const unrelated = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, demoToken);

        assert.equal(overview.status, 200);
        assert.equal(overview.data.user.isDemo, true);
        assert.equal(versionedOverview.status, 200);
        assert.equal(session.status, 200);
        assert.equal(unrelated.status, 403);
        assert.equal(unrelated.data.code, 'auth_demo_scope_denied');
    });
});

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

        const originalRefreshRow = fakePool.state.refreshTokens.find(token => !token.revoked_at);
        assert.equal(jwt.decode(login.data.accessToken).sessionIssuedAt, originalRefreshRow.created_at.getTime());
        assert.equal(jwt.decode(login.data.accessToken).sessionTokenId, originalRefreshRow.id);
        assert.equal(jwt.decode(login.data.token).sessionIssuedAt, originalRefreshRow.created_at.getTime());
        assert.equal(jwt.decode(login.data.token).sessionTokenId, originalRefreshRow.id);
        assert.equal(login.data.sessionTokenId, originalRefreshRow.id);
        originalRefreshRow.device_info = 'Android browser before network change';
        originalRefreshRow.ip_address = '203.0.113.10';

        const verify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, login.data.token);
        assert.equal(verify.status, 200);
        assert.equal(verify.data.user.username, 'new.operator');

        const protectedRoute = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, login.data.token);
        assert.equal(protectedRoute.status, 200);
        assert.equal(protectedRoute.data.user.username, 'new.operator');

        const blocked = await request(baseUrl, 'GET', '/api/protected-smoke');
        assert.equal(blocked.status, 401);

        const invalidToken = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, 'not-a-valid-jwt');
        assert.equal(invalidToken.status, 401);
        assert.equal(invalidToken.data.code, 'auth_token_invalid');

        const refresh = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: login.data.refreshToken });
        assert.equal(refresh.status, 200);
        assert.ok(refresh.data.accessToken);
        assert.ok(refresh.data.refreshToken);
        assert.equal(refresh.data.user.username, 'new.operator');

        const duplicateRefresh = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: login.data.refreshToken });
        assert.equal(duplicateRefresh.status, 409);
        assert.equal(duplicateRefresh.data.code, 'refresh_already_rotated');
        assert.equal(duplicateRefresh.data.retryable, undefined);
        assert.equal(duplicateRefresh.data.reloginRequired, true);
        const activeRotatedToken = fakePool.state.refreshTokens.find(token => token.token_hash !== fakePool.state.refreshTokens[0].token_hash);
        assert.ok(activeRotatedToken);
        assert.equal(refresh.data.sessionTokenId, activeRotatedToken.id);
        assert.equal(activeRotatedToken.revoked_at, null, 'duplicate same-client refresh must not revoke the rotated session');

        const refreshedVerify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, refresh.data.accessToken);
        assert.equal(refreshedVerify.status, 200);
        assert.equal(refreshedVerify.data.user.username, 'new.operator');

        const cutoffBeforeLogout = fakePool.state.users.find(user => user.username === 'new.operator').session_revoked_at;
        const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
            refreshToken: login.data.refreshToken
        });
        assert.equal(logout.status, 200);
        assert.equal(logout.data.success, true);
        assert.equal(
            fakePool.state.refreshTokens.every(token => token.revoked_at),
            true,
            'logging out with a rotated predecessor must revoke its current replacement chain'
        );

        const refreshAfterLogout = await request(baseUrl, 'POST', '/api/auth/refresh', { refreshToken: refresh.data.refreshToken });
        assert.equal(refreshAfterLogout.status, 401);
        assert.equal(refreshAfterLogout.data.code, 'refresh_token_revoked');
        assert.equal(
            fakePool.state.users.find(user => user.username === 'new.operator').session_revoked_at,
            cutoffBeforeLogout,
            'current-device logout and retry must not revoke every device through the account cutoff'
        );
    });
});

test('post-grace same-client refresh replay recovers a lost rotation response', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const firstLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        const otherDeviceLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        }, null, { 'User-Agent': 'unrelated-device' });
        assert.equal(firstLogin.status, 200);
        assert.equal(otherDeviceLogin.status, 200);

        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        });
        assert.equal(rotated.status, 200);

        const [oldRow, unrelatedRow, replacementRow] = fakePool.state.refreshTokens;
        assert.ok(oldRow.revoked_at);
        assert.equal(unrelatedRow.revoked_at, null);
        assert.equal(replacementRow.revoked_at, null);
        oldRow.revoked_at = new Date(Date.now() - 6000);
        const cutoffBeforeReplay = creator.session_revoked_at;

        const recovery = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        }, firstLogin.data.accessToken);

        assert.equal(recovery.status, 200);
        assert.ok(recovery.data.accessToken);
        assert.ok(recovery.data.refreshToken);
        assert.notEqual(recovery.data.refreshToken, rotated.data.refreshToken);
        assert.equal(recovery.data.user.username, creator.username);
        assert.equal(recovery.data.recovered, true);
        assert.ok(replacementRow.revoked_at, 'the unreachable lost-response replacement must be revoked');
        const recoveredRow = fakePool.state.refreshTokens.at(-1);
        assert.equal(recoveredRow.revoked_at, null, 'the recovered same-client session must remain active');
        assert.equal(recovery.data.sessionTokenId, recoveredRow.id);
        assert.equal(oldRow.replaced_by, replacementRow.id, 'the original predecessor must still point to its first replacement');
        assert.equal(replacementRow.replaced_by, recoveredRow.id, 'recovery must keep the replacement chain connected');
        assert.equal(unrelatedRow.revoked_at, null, 'an unrelated device session must remain active');
        assert.equal(creator.session_revoked_at, cutoffBeforeReplay, 'recovery must not move the account-wide cutoff');

        const recoveredVerify = await request(baseUrl, 'GET', '/api/auth/verify', undefined, recovery.data.accessToken);
        assert.equal(recoveredVerify.status, 200);
        assert.equal(recoveredVerify.data.user.username, creator.username);

        const logoutFirstReplacement = await request(baseUrl, 'POST', '/api/auth/logout', {
            refreshToken: rotated.data.refreshToken
        });
        assert.equal(logoutFirstReplacement.status, 200);
        const recoveredAfterLogout = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: recovery.data.refreshToken
        });
        assert.equal(recoveredAfterLogout.status, 401);
        assert.equal(recoveredAfterLogout.data.code, 'refresh_token_revoked');
        assert.ok(recoveredRow.revoked_at, 'logging out the first replacement must revoke the recovered tail');
    });
});


test('post-grace recovery rejects signed access proof from a different session of the same account', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const firstLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        }, null, { 'User-Agent': 'session-a' });
        const secondLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        }, null, { 'User-Agent': 'session-b' });
        assert.equal(firstLogin.status, 200);
        assert.equal(secondLogin.status, 200);
        assert.notEqual(firstLogin.data.sessionTokenId, secondLogin.data.sessionTokenId);

        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        }, firstLogin.data.accessToken, { 'User-Agent': 'session-a' });
        assert.equal(rotated.status, 200);

        const [oldRow, unrelatedRow, replacementRow] = fakePool.state.refreshTokens;
        oldRow.revoked_at = new Date(Date.now() - 6000);
        assert.equal(Number(jwt.decode(secondLogin.data.accessToken).sessionTokenId), Number(unrelatedRow.id));
        assert.notEqual(Number(jwt.decode(secondLogin.data.accessToken).sessionTokenId), Number(oldRow.id));

        const crossSessionRecovery = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        }, secondLogin.data.accessToken, { 'User-Agent': 'session-a' });

        assert.equal(crossSessionRecovery.status, 401);
        assert.equal(crossSessionRecovery.data.code, 'refresh_token_reuse');
        assert.ok(replacementRow.revoked_at, 'cross-session proof must not recover and must revoke the compromised chain');
        assert.equal(unrelatedRow.revoked_at, null, 'the proof session itself must remain active');
    });
});

test('post-grace predecessor replay cannot recover after current-device logout', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(login.status, 200);
        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        }, login.data.accessToken);
        assert.equal(rotated.status, 200);

        const [oldRow, replacementRow] = fakePool.state.refreshTokens;
        oldRow.revoked_at = new Date(Date.now() - 6000);
        const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
            refreshToken: rotated.data.refreshToken
        });
        assert.equal(logout.status, 200);
        assert.ok(replacementRow.revoked_at, 'current replacement must be terminally revoked by logout');

        const replayAfterLogout = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        }, login.data.accessToken);

        assert.equal(replayAfterLogout.status, 401);
        assert.equal(replayAfterLogout.data.code, 'refresh_token_reuse');
        assert.equal(
            fakePool.state.refreshTokens.filter(token => !token.revoked_at).length,
            0,
            'logout-then-predecessor replay must not create a new active session'
        );
    });
});

test('post-grace same-fingerprint replay without signed session proof stays hostile', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(login.status, 200);
        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        });
        assert.equal(rotated.status, 200);

        const [oldRow, replacementRow] = fakePool.state.refreshTokens;
        oldRow.revoked_at = new Date(Date.now() - 6000);

        const replay = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        });

        assert.equal(replay.status, 401);
        assert.equal(replay.data.code, 'refresh_token_reuse');
        assert.ok(replacementRow.revoked_at, 'same UA/IP without signed access proof must not recover');
    });
});

test('post-grace hostile refresh replay revokes only the rotated replacement chain', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const firstLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        const otherDeviceLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(firstLogin.status, 200);
        assert.equal(otherDeviceLogin.status, 200);

        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        });
        assert.equal(rotated.status, 200);

        const [oldRow, unrelatedRow, replacementRow] = fakePool.state.refreshTokens;
        assert.ok(oldRow.revoked_at);
        assert.equal(unrelatedRow.revoked_at, null);
        assert.equal(replacementRow.revoked_at, null);
        oldRow.revoked_at = new Date(Date.now() - 6000);
        const cutoffBeforeReplay = creator.session_revoked_at;

        const replay = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: firstLogin.data.refreshToken
        }, null, { 'User-Agent': 'hostile-replay-client' });

        assert.equal(replay.status, 401);
        assert.equal(replay.data.code, 'refresh_token_reuse');
        assert.ok(replacementRow.revoked_at, 'the compromised rotation chain must be revoked');
        assert.equal(unrelatedRow.revoked_at, null, 'an unrelated device session must remain active');
        assert.equal(creator.session_revoked_at, cutoffBeforeReplay, 'replay must not move the account-wide cutoff');
    });
});

test('refresh duplicate grace uses the PostgreSQL clock even when the app clock is behind', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);
        fakePool.state.databaseClockOffsetMs = 60000;

        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(login.status, 200);

        const rotated = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        });
        assert.equal(rotated.status, 200);

        const duplicate = await request(baseUrl, 'POST', '/api/auth/refresh', {
            refreshToken: login.data.refreshToken
        });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.data.code, 'refresh_already_rotated');
        assert.equal(fakePool.state.refreshTokens.at(-1).revoked_at, null);
        assert.ok(
            fakePool.state.queryStatements.some(sql => /EXTRACT\(EPOCH FROM \(clock_timestamp\(\) - revoked_at\)\) \* 1000 AS rotation_age_ms/i.test(sql)),
            'the grace age must be computed by PostgreSQL under the token row lock'
        );
        assert.ok(
            fakePool.state.queryStatements.some(sql => /UPDATE refresh_tokens SET revoked_at = clock_timestamp\(\), replaced_by =/i.test(sql)),
            'the rotated predecessor timestamp must use the same PostgreSQL clock'
        );
    });
});

test('current-device logout revokes a replacement chain longer than one hundred tokens', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const rawRootToken = 'long-refresh-chain-root';
        const replacementCount = 105;
        const chain = [];
        for (let index = 0; index <= replacementCount; index += 1) {
            const id = fakePool.state.nextRefreshId++;
            chain.push({
                id,
                user_id: 1,
                token_hash: index === 0
                    ? crypto.createHash('sha256').update(rawRootToken).digest('hex')
                    : `replacement-${index}`,
                device_info: 'long-chain-test',
                ip_address: '127.0.0.1',
                created_at: new Date(Date.now() - (replacementCount - index) * 1000),
                expires_at: new Date(Date.now() + 86400000),
                revoked_at: index < replacementCount ? new Date(Date.now() - 1000) : null,
                replaced_by: null
            });
        }
        for (let index = 0; index < chain.length - 1; index += 1) {
            chain[index].replaced_by = chain[index + 1].id;
        }
        const unrelated = {
            id: fakePool.state.nextRefreshId++,
            user_id: 1,
            token_hash: 'unrelated-device-token',
            device_info: 'unrelated-device',
            ip_address: '127.0.0.2',
            created_at: new Date(),
            expires_at: new Date(Date.now() + 86400000),
            revoked_at: null,
            replaced_by: null
        };
        fakePool.state.refreshTokens.push(...chain, unrelated);

        const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
            refreshToken: rawRootToken
        });

        assert.equal(logout.status, 200);
        assert.equal(logout.data.success, true);
        assert.ok(chain.at(-1).revoked_at, 'the active tail after 105 replacements must be revoked');
        assert.equal(chain.every(token => token.revoked_at), true);
        assert.equal(unrelated.revoked_at, null, 'an unrelated device session must remain active');
    });
});

test('logout-all rejects an access token already behind the session cutoff without touching a newer login', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);

        const oldLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(oldLogin.status, 200);

        const firstLogoutAll = await request(baseUrl, 'POST', '/api/auth/logout', {
            allDevices: true
        }, oldLogin.data.accessToken);
        assert.equal(firstLogoutAll.status, 200);
        const establishedCutoffMs = creator.session_revoked_at.getTime();

        await new Promise(resolve => setTimeout(resolve, 2));
        const newLogin = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(newLogin.status, 200);
        const newRefreshRow = fakePool.state.refreshTokens.at(-1);
        assert.equal(newRefreshRow.revoked_at, null);

        const staleLogoutAll = await request(baseUrl, 'POST', '/api/auth/logout', {
            allDevices: true
        }, oldLogin.data.accessToken);

        assert.equal(staleLogoutAll.status, 401);
        assert.equal(creator.session_revoked_at.getTime(), establishedCutoffMs);
        assert.equal(newRefreshRow.revoked_at, null, 'a stale access token must not revoke the newer session');
    });
});

test('personal security session revocation locks the account and revokes tokens in one transaction', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const creator = fakePool.state.users[0];
        creator.password_hash = await bcrypt.hash('CreatorPass789!', 4);
        const login = await request(baseUrl, 'POST', '/api/auth/login', {
            username: creator.username,
            password: 'CreatorPass789!'
        });
        assert.equal(login.status, 200);

        fakePool.state.queryStatements.length = 0;
        const revoke = await request(
            baseUrl,
            'POST',
            '/api/auth/security/revoke-sessions',
            {},
            login.data.accessToken
        );

        assert.equal(revoke.status, 200);
        assert.equal(revoke.data.reloginRequired, true);
        assert.ok(creator.session_revoked_at);
        assert.equal(fakePool.state.refreshTokens.every(token => token.revoked_at), true);
        const beginIndex = fakePool.state.queryStatements.lastIndexOf('BEGIN');
        const commitIndex = fakePool.state.queryStatements.indexOf('COMMIT', beginIndex);
        const transactionSql = fakePool.state.queryStatements.slice(beginIndex, commitIndex + 1);
        assert.equal(transactionSql[0], 'BEGIN');
        assert.match(transactionSql[1], /SELECT is_active, session_revoked_at FROM users WHERE id = \$1 FOR UPDATE/i);
        assert.equal(
            transactionSql.some(sql => /UPDATE users SET session_revoked_at = clock_timestamp\(\)/i.test(sql)),
            true
        );
        assert.equal(
            transactionSql.some(sql => /UPDATE refresh_tokens SET revoked_at = clock_timestamp\(\) WHERE user_id = \$1/i.test(sql)),
            true
        );
        assert.equal(transactionSql.at(-1), 'COMMIT');
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

        const wrongCurrentPassword = await request(baseUrl, 'PUT', '/api/auth/password', {
            currentPassword: 'WrongCurrentPassword789!',
            newPassword: 'AuditPass987!'
        }, accessLogin.data.accessToken);
        assert.equal(wrongCurrentPassword.status, 400);
        assert.equal(wrongCurrentPassword.data.code, 'current_password_invalid');

        const sessionAfterWrongPassword = await request(
            baseUrl,
            'GET',
            '/api/protected-smoke',
            undefined,
            accessLogin.data.accessToken
        );
        assert.equal(sessionAfterWrongPassword.status, 200);

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

test('temporary auth verification failure is retryable and does not masquerade as forbidden access', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const originalQuery = fakePool.query;
        fakePool.query = async () => {
            throw new Error('temporary database outage');
        };
        try {
            const unavailable = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, creatorToken());
            assert.equal(unavailable.status, 503);
            assert.equal(unavailable.data.code, 'auth_verification_unavailable');
            assert.equal(unavailable.data.retryable, true);
        } finally {
            fakePool.query = originalQuery;
        }
    });
});

test('session revocation rejects legacy same-second tokens while allowing a newer millisecond token', async () => {
    await withAuthApp(async ({ baseUrl, fakePool }) => {
        const legacyToken = creatorToken();
        const legacyIssuedSecond = jwt.decode(legacyToken).iat;
        const cutoffMs = legacyIssuedSecond * 1000 + 500;
        fakePool.state.users[0].session_revoked_at = new Date(cutoffMs);

        const revoked = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, legacyToken);
        assert.equal(revoked.status, 401);
        assert.equal(revoked.data.code, 'auth_session_revoked');

        const newerToken = jwt.sign({
            id: 1,
            username: 'creator',
            name: 'Creator',
            role: 'creator',
            sessionIssuedAt: cutoffMs + 1
        }, TEST_JWT_SECRET, { expiresIn: '1h' });
        const accepted = await request(baseUrl, 'GET', '/api/protected-smoke', undefined, newerToken);
        assert.equal(accepted.status, 200);
    });
});

test('auth limiters reserve concurrent login attempts and isolate accounts and refresh sessions on a shared IP', async () => {
    const rateLimitModulePath = require.resolve('../middleware/rateLimit');
    const originalLoginMax = process.env.LOGIN_RATE_LIMIT_MAX;
    const originalLoginIpMax = process.env.LOGIN_IP_RATE_LIMIT_MAX;
    process.env.LOGIN_RATE_LIMIT_MAX = '3';
    process.env.LOGIN_IP_RATE_LIMIT_MAX = '20';
    delete require.cache[rateLimitModulePath];

    const { loginRateLimiter, refreshSessionLimiter } = require('../middleware/rateLimit');
    const app = express();
    app.use(express.json());
    app.post('/login', loginRateLimiter, async (req, res) => {
        if (['canonical.operator', 'operator.alias.one', 'operator.alias.two', 'operator.alias.three'].includes(req.body?.username)) {
            if (!req.reserveCanonicalLoginAttempt({ id: 901, username: 'canonical.operator' })) return;
        }
        if (req.body?.username === 'burst.operator') {
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        if (req.body?.password === 'correct') return res.json({ success: true });
        return res.status(401).json({ error: 'Invalid credentials' });
    });
    app.post('/refresh', refreshSessionLimiter, (_req, res) => res.json({ success: true }));

    const { server, baseUrl } = await listen(app);
    try {
        for (let index = 0; index < 5; index += 1) {
            const successful = await request(baseUrl, 'POST', '/login', {
                username: 'successful.operator',
                password: 'correct'
            });
            assert.equal(successful.status, 200, 'successful logins must not consume the failure bucket');
        }

        for (let index = 0; index < 3; index += 1) {
            const failed = await request(baseUrl, 'POST', '/login', {
                username: 'locked.operator',
                password: 'wrong'
            });
            assert.equal(failed.status, 401);
        }

        const limitedResponse = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'locked.operator', password: 'correct' })
        });
        const limitedBody = await limitedResponse.json();
        assert.equal(limitedResponse.status, 429);
        assert.equal(limitedBody.code, 'login_rate_limited');
        assert.ok(Number(limitedResponse.headers.get('retry-after')) > 0);

        const neighboringAccount = await request(baseUrl, 'POST', '/login', {
            username: 'neighbor.operator',
            password: 'correct'
        });
        assert.equal(neighboringAccount.status, 200, 'one account must not exhaust the shared-IP account bucket');

        const burst = await Promise.all(Array.from({ length: 5 }, () => request(baseUrl, 'POST', '/login', {
            username: 'burst.operator',
            password: 'wrong'
        })));
        assert.deepEqual(
            burst.map(result => result.status).sort(),
            [401, 401, 401, 429, 429],
            'in-flight reservations must stop a parallel credential burst at the configured account max'
        );

        for (const username of ['canonical.operator', 'operator.alias.one', 'operator.alias.two']) {
            const failedAlias = await request(baseUrl, 'POST', '/login', {
                username,
                password: 'wrong'
            });
            assert.equal(failedAlias.status, 401);
        }
        const limitedAlias = await request(baseUrl, 'POST', '/login', {
            username: 'operator.alias.three',
            password: 'correct'
        });
        assert.equal(limitedAlias.status, 429, 'aliases for one account must share the canonical failure bucket');
        assert.equal(limitedAlias.data.code, 'login_rate_limited');

        for (let index = 0; index < 15; index += 1) {
            const independentSession = await request(baseUrl, 'POST', '/refresh', {
                refreshToken: `shared-ip-session-${index}`
            });
            assert.equal(independentSession.status, 200, 'independent refresh sessions must not share one IP bucket');
        }
        for (let index = 0; index < 10; index += 1) {
            const sameSession = await request(baseUrl, 'POST', '/refresh', {
                refreshToken: 'repeated-refresh-session'
            });
            assert.equal(sameSession.status, 200);
        }
        const limitedRefresh = await request(baseUrl, 'POST', '/refresh', {
            refreshToken: 'repeated-refresh-session'
        });
        assert.equal(limitedRefresh.status, 429);
        assert.equal(limitedRefresh.data.code, 'refresh_rate_limited');
        assert.equal(limitedRefresh.data.retryable, true);
    } finally {
        await close(server);
        delete require.cache[rateLimitModulePath];
        if (originalLoginMax === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX;
        else process.env.LOGIN_RATE_LIMIT_MAX = originalLoginMax;
        if (originalLoginIpMax === undefined) delete process.env.LOGIN_IP_RATE_LIMIT_MAX;
        else process.env.LOGIN_IP_RATE_LIMIT_MAX = originalLoginIpMax;
    }
});

test('global API rate limits cannot silently weaken the five-attempt login default', async () => {
    const rateLimitModulePath = require.resolve('../middleware/rateLimit');
    const originalRateMax = process.env.RATE_LIMIT_MAX;
    const originalLoginMax = process.env.LOGIN_RATE_LIMIT_MAX;
    const originalLoginIpMax = process.env.LOGIN_IP_RATE_LIMIT_MAX;
    process.env.RATE_LIMIT_MAX = '300';
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    process.env.LOGIN_IP_RATE_LIMIT_MAX = '100';
    delete require.cache[rateLimitModulePath];

    const { loginRateLimiter } = require('../middleware/rateLimit');
    const app = express();
    app.use(express.json());
    app.post('/login', loginRateLimiter, (_req, res) => res.status(401).json({ error: 'Invalid credentials' }));
    const { server, baseUrl } = await listen(app);

    try {
        for (let index = 0; index < 5; index += 1) {
            const failed = await request(baseUrl, 'POST', '/login', {
                username: 'default-limit.operator',
                password: 'wrong'
            });
            assert.equal(failed.status, 401);
        }
        const limited = await request(baseUrl, 'POST', '/login', {
            username: 'default-limit.operator',
            password: 'wrong'
        });
        assert.equal(limited.status, 429);
        assert.equal(limited.data.code, 'login_rate_limited');
    } finally {
        await close(server);
        delete require.cache[rateLimitModulePath];
        if (originalRateMax === undefined) delete process.env.RATE_LIMIT_MAX;
        else process.env.RATE_LIMIT_MAX = originalRateMax;
        if (originalLoginMax === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX;
        else process.env.LOGIN_RATE_LIMIT_MAX = originalLoginMax;
        if (originalLoginIpMax === undefined) delete process.env.LOGIN_IP_RATE_LIMIT_MAX;
        else process.env.LOGIN_IP_RATE_LIMIT_MAX = originalLoginIpMax;
    }
});

test('refresh limiter caps random-token floods per IP without relying on token reuse', async () => {
    const rateLimitModulePath = require.resolve('../middleware/rateLimit');
    const originalRefreshIpMax = process.env.REFRESH_IP_RATE_LIMIT_MAX;
    process.env.REFRESH_IP_RATE_LIMIT_MAX = '10';
    delete require.cache[rateLimitModulePath];

    const { refreshSessionLimiter } = require('../middleware/rateLimit');
    const app = express();
    app.use(express.json());
    app.post('/refresh', refreshSessionLimiter, (_req, res) => res.json({ success: true }));

    const { server, baseUrl } = await listen(app);
    try {
        for (let index = 0; index < 10; index += 1) {
            const response = await request(baseUrl, 'POST', '/refresh', {
                refreshToken: `random-invalid-token-${index}`
            });
            assert.equal(response.status, 200);
        }

        const limited = await request(baseUrl, 'POST', '/refresh', {
            refreshToken: 'random-invalid-token-10'
        });
        assert.equal(limited.status, 429);
        assert.equal(limited.data.code, 'refresh_rate_limited');
        assert.equal(limited.data.retryable, true);
    } finally {
        await close(server);
        delete require.cache[rateLimitModulePath];
        if (originalRefreshIpMax === undefined) delete process.env.REFRESH_IP_RATE_LIMIT_MAX;
        else process.env.REFRESH_IP_RATE_LIMIT_MAX = originalRefreshIpMax;
    }
});
