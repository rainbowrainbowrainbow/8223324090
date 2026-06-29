const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'auth-quick-status-test-secret';

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/auth',
        '../services/taskActionHistory'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function listen(app) {
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

async function request(baseUrl, method, path, body, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

function tokenFor(user = {}) {
    return jwt.sign({
        id: user.id || 1,
        username: user.username || 'route-smoke',
        name: user.name || 'Route Smoke',
        role: user.role || 'creator'
    }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

describe('auth quick task status route', () => {
    afterEach(() => {
        clearModules();
        delete process.env.JWT_SECRET;
    });

    it('keeps done -> todo successful when legacy task_logs insert fails', async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        clearModules();

        const calls = [];
        const taskBefore = {
            id: 42,
            title: 'Undo task',
            status: 'done',
            workflow_state: 'done',
            schedule_status: 'completed',
            scheduled_start_at: '2099-01-01T09:00:00.000Z',
            completed_at: '2099-01-01T10:00:00.000Z',
            assigned_to: 'route-smoke',
            owner: 'route-smoke',
            owner_user_id: 1,
            visibility: 'team',
            business_context: 'event_genix',
            version: 3
        };
        const taskAfter = {
            ...taskBefore,
            status: 'todo',
            workflow_state: 'todo',
            schedule_status: 'scheduled',
            completed_at: null,
            version: 4
        };

        const fakePool = {
            query: async (text, params = []) => {
                const sql = String(text).replace(/\s+/g, ' ').trim();
                calls.push({ text: sql, params });

                if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(sql)) {
                    return { rows: [{ is_active: true, session_revoked_at: null }] };
                }
                if (/SELECT id, username, role, extra_roles/i.test(sql)) {
                    return {
                        rows: [{
                            id: 1,
                            username: 'route-smoke',
                            name: 'Route Smoke',
                            role: 'creator',
                            business_contexts: ['event_genix'],
                            default_business_context: 'event_genix',
                            is_active: true
                        }]
                    };
                }
                if (/UPDATE employee_profiles SET last_activity_at/i.test(sql)
                    || /UPDATE users SET last_seen_at/i.test(sql)) {
                    return { rows: [], rowCount: 1 };
                }
                if (/SELECT \* FROM tasks WHERE id = \$1/i.test(sql)) {
                    return { rows: [taskBefore] };
                }
                if (/^UPDATE tasks SET status = \$1,/i.test(sql)) {
                    assert.equal(params[0], 'todo');
                    assert.equal(params[1], 42);
                    return { rows: [taskAfter], rowCount: 1 };
                }
                if (/^INSERT INTO task_logs/i.test(sql)) {
                    throw new Error('task_logs insert failed');
                }
                if (/^INSERT INTO task_action_history/i.test(sql)) {
                    return {
                        rows: [{
                            id: 7,
                            task_id: params[0],
                            action_type: params[1],
                            actor_user_id: params[2],
                            actor_name_snapshot: params[3],
                            source_surface: params[4],
                            old_value_json: JSON.parse(params[5]),
                            new_value_json: JSON.parse(params[6]),
                            meta_json: JSON.parse(params[7]),
                            summary: params[8],
                            created_at: '2099-01-01T10:01:00.000Z'
                        }]
                    };
                }

                throw new Error(`Unexpected query: ${sql}`);
            }
        };

        installMock('../db', {
            pool: fakePool,
            query: fakePool.query.bind(fakePool)
        });

        const app = express();
        app.use(express.json());
        app.use('/api/auth', require('../routes/auth'));
        const { server, baseUrl } = await listen(app);
        try {
            const res = await request(baseUrl, 'PATCH', '/api/auth/tasks/42/quick-status', { status: 'todo' }, {
                Authorization: `Bearer ${tokenFor()}`,
                'X-Business-Context': 'event_genix'
            });

            assert.equal(res.status, 200);
            assert.equal(res.data.success, true);
            assert.equal(res.data.oldStatus, 'done');
            assert.equal(res.data.newStatus, 'todo');
            assert.equal(res.data.task.status, 'todo');
            assert.equal(res.data.task.completed_at, null);
            assert.notEqual(res.data.task.workflow_state, 'done');
            assert.equal(res.data.task.schedule_status, 'scheduled');
            assert.equal(res.data.historyEvent.actionType, 'task_status_changed');
            assert.equal(res.data.meta.canonicalField, 'tasks.status');
            assert.equal(res.data.meta.legacyRoute, true);
            assert.ok(calls.some(call => /^INSERT INTO task_logs/i.test(call.text)), 'legacy task_logs insert should be attempted');
        } finally {
            await close(server);
        }
    });
});
