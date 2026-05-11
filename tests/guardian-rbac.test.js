const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'guardian-rbac-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;

let server;
let baseUrl;
let state;

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/guardian',
        '../services/guardian'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function resetState() {
    state = {
        mutes: [
            { id: 1, channel_id: 10, user_id: 1, username: 'owner', display_name: 'Owner', channel_name: 'Ops', reason: 'admin mute', muted_until: new Date(Date.now() + 60000).toISOString(), created_at: new Date().toISOString() },
            { id: 2, channel_id: 10, user_id: 2, username: 'animator', display_name: 'Animator', channel_name: 'Ops', reason: 'own mute', muted_until: new Date(Date.now() + 60000).toISOString(), created_at: new Date().toISOString() }
        ],
        writes: [],
        clearMuteCalls: [],
        reportGenerations: [],
        commandCalls: [],
        emergencyStop: false
    };
}

function tokenFor(role = 'creator', userId = 1) {
    return jwt.sign(
        { id: userId, userId, username: `${role}-${userId}`, name: `${role} ${userId}`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function auth(role = 'creator', userId = 1) {
    return { Authorization: `Bearer ${tokenFor(role, userId)}` };
}

async function request(method, pathname, body, role = 'creator', userId = 1) {
    const res = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            ...auth(role, userId),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function fakePool() {
    return {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (text.startsWith('UPDATE employee_profiles') || text.startsWith('UPDATE users SET last_seen_at')) {
                return { rows: [], rowCount: 0 };
            }

            if (text.includes('FROM chat_mutes cm')) {
                const rows = text.includes('cm.user_id = $1')
                    ? state.mutes.filter(m => String(m.user_id) === String(params[0]))
                    : state.mutes;
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith('SELECT channel_id, user_id FROM chat_mutes')) {
                const mute = state.mutes.find(m => String(m.id) === String(params[0]));
                return { rows: mute ? [mute] : [], rowCount: mute ? 1 : 0 };
            }
            if (text.startsWith('UPDATE chat_mutes SET muted_until')) {
                state.writes.push({ type: 'unmute', id: params[0] });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('UPDATE chat_channels SET')) {
                state.writes.push({ type: 'toggle', params });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO guardian_rules')) {
                state.writes.push({ type: 'rule-create', params });
                return { rows: [{ id: 1, rule_type: params[0], name: params[1], pattern: params[2], action: params[3], severity: params[4], is_active: true }], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO guardian_actions')) {
                state.writes.push({ type: 'guardian-action', params });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('SELECT action_type, COUNT')) {
                return { rows: [{ action_type: 'mute', cnt: '1' }], rowCount: 1 };
            }
            if (text.startsWith('SELECT COUNT(*) cnt FROM chat_mutes')) {
                return { rows: [{ cnt: String(state.mutes.length) }], rowCount: 1 };
            }
            if (text.startsWith('SELECT COUNT(*)')) {
                return { rows: [{ total_messages: '0', total_mutes: '0', total_masks: '0', total_conflicts: '0', active_channels: '0', health_avg: null, mood_avg: null }], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, level')) {
                return { rows: [{ id: 1, level: 1, name: 'Low', threshold: 1, action: 'watch', mute_duration_minutes: 1, notify_telegram: false, is_active: true }], rowCount: 1 };
            }

            return { rows: [], rowCount: 0 };
        }
    };
}

function fakeGuardianService() {
    return {
        generateDailyReport: async (channelId, date) => {
            state.reportGenerations.push({ channelId, date });
            return { id: 1 };
        },
        runDailyReports: async () => {
            state.reportGenerations.push({ all: true });
        },
        ensureGuardianMemberships: async () => {},
        getMood: () => ({ emoji: 'ok', label: 'OK' }),
        getGuardianState: () => ({ mood: 'ok', memory: {} }),
        clearMuteCache: (channelId, userId) => state.clearMuteCalls.push({ channelId, userId }),
        alertDirector: async () => {},
        setEmergencyStop: stop => { state.emergencyStop = !!stop; },
        getEmergencyStop: () => state.emergencyStop,
        getChannelSettings: async channelId => ({ guardian_enabled: true, contour2_enabled: false, channelId }),
        invalidateChannelSettingsCache: channelId => state.writes.push({ type: 'invalidate-settings', channelId }),
        alertDirectorTelegram: () => {},
        handleGuardianCommand: async (channelId, userId, username, commandText, isAdmin) => {
            state.commandCalls.push({ channelId, userId, username, commandText, isAdmin });
            return { handled: true, response: isAdmin ? 'admin-ok' : 'user-ok' };
        },
        calculateChannelHealth: async () => ({ score: 100, level: 'green', factors: {}, trend: 'stable' }),
        getChannelMoodSummary: async () => ({ avgScore: 0, distribution: {} }),
        getUserMoodProfile: async () => ({ avgScore: 0 }),
        generateWeeklyReport: async () => ({ id: 1 }),
        getActivityHeatmap: async () => [],
        getTrustScore: async () => ({ trustScore: 100, level: 'trusted' }),
        updateTrustScore: async () => ({}),
        checkEscalation: async () => null,
        loadDynamicWhitelist: async () => {}
    };
}

describe('Guardian route RBAC', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = fakePool();
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/guardian', fakeGuardianService());

        const app = express();
        app.use(express.json());
        app.use('/api/guardian', require('../routes/guardian'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        resetState();
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('blocks non-admin roles from Guardian admin/control endpoints before side effects', async () => {
        const cases = [
            ['POST', '/api/guardian/reports/generate', { channelId: 1 }],
            ['GET', '/api/guardian/actions'],
            ['GET', '/api/guardian/stats'],
            ['POST', '/api/guardian/rules', { name: 'rule', action: 'watch' }],
            ['POST', '/api/guardian/action', { action: 'watch', channelId: 1 }],
            ['GET', '/api/guardian/state'],
            ['GET', '/api/guardian/mood/team'],
            ['GET', '/api/guardian/analytics/overview'],
            ['GET', '/api/guardian/trust'],
            ['GET', '/api/guardian/escalation'],
            ['POST', '/api/guardian/weekly-reports/generate'],
            ['GET', '/api/guardian/whitelist']
        ];

        for (const [method, pathname, body] of cases) {
            const res = await request(method, pathname, body, 'manager', 20);
            assert.equal(res.status, 403, `${method} ${pathname}`);
        }
        assert.deepEqual(state.reportGenerations, []);
        assert.deepEqual(state.writes, []);
    });

    it('allows explicit Guardian admin roles without expanding manager-up legacy roles', async () => {
        const stats = await request('GET', '/api/guardian/stats', undefined, 'admin', 3);
        assert.equal(stats.status, 200);

        const rule = await request('POST', '/api/guardian/rules', { name: 'safe rule', action: 'watch' }, 'admin', 3);
        assert.equal(rule.status, 200);
        assert.equal(state.writes.some(w => w.type === 'rule-create'), true);

        const manager = await request('POST', '/api/guardian/rules', { name: 'manager rule', action: 'watch' }, 'manager', 20);
        assert.equal(manager.status, 403);
    });

    it('keeps owner-only controls narrower than general Guardian admin controls', async () => {
        let res = await request('POST', '/api/guardian/toggle', { channelId: 10, guardianEnabled: false }, 'admin', 3);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/toggle', { channelId: 10, guardianEnabled: false }, 'director', 2);
        assert.equal(res.status, 200);
        assert.equal(state.writes.some(w => w.type === 'toggle'), true);

        res = await request('POST', '/api/guardian/emergency-stop', { stop: true }, 'director', 2);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/emergency-stop', { stop: true }, 'creator', 1);
        assert.equal(res.status, 200);
        assert.equal(state.emergencyStop, true);
    });

    it('filters active mutes for regular users and allows only self-unmute outside admin roles', async () => {
        let res = await request('GET', '/api/guardian/mutes/active', undefined, 'animator', 2);
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.map(m => m.id), [2]);

        res = await request('DELETE', '/api/guardian/mutes/1', undefined, 'animator', 2);
        assert.equal(res.status, 403);
        assert.deepEqual(state.clearMuteCalls, []);

        res = await request('DELETE', '/api/guardian/mutes/2', undefined, 'animator', 2);
        assert.equal(res.status, 200);
        assert.deepEqual(state.clearMuteCalls, [{ channelId: 10, userId: 2 }]);

        res = await request('GET', '/api/guardian/mutes/active', undefined, 'admin', 3);
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.map(m => m.id), [1, 2]);
    });

    it('passes user identity and exact admin flag into Guardian command handling', async () => {
        let res = await request('POST', '/api/guardian/command', { channelId: 44, command: '/g status' }, 'animator', 2);
        assert.equal(res.status, 200);
        assert.equal(state.commandCalls.at(-1).userId, 2);
        assert.equal(state.commandCalls.at(-1).commandText, '/g status');
        assert.equal(state.commandCalls.at(-1).isAdmin, false);

        res = await request('POST', '/api/guardian/command', { channelId: 44, command: '/g top' }, 'admin', 3);
        assert.equal(res.status, 200);
        assert.equal(state.commandCalls.at(-1).userId, 3);
        assert.equal(state.commandCalls.at(-1).isAdmin, true);
    });
});
