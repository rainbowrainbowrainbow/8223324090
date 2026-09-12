const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'dashboard-event-risk-secret';

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/bookingVisibility',
        '../services/websocket',
        '../routes/dashboard'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

function tokenFor(role = 'manager') {
    return jwt.sign({ id: 20, username: `${role}-user`, name: `${role} user`, role }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

function createFakePool(queries) {
    let preliminaryDayQueryCount = 0;
    return {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            if (/FROM bookings b/i.test(text) && /b\.status = 'preliminary'/i.test(text) && /BETWEEN 0 AND 120/i.test(text)) {
                return { rows: [{ count: 1 }] };
            }
            if (/FROM bookings b/i.test(text) && /b\.status = 'preliminary'/i.test(text)) {
                preliminaryDayQueryCount += 1;
                return { rows: [{ count: preliminaryDayQueryCount === 1 ? 3 : 5 }] };
            }
            if (/FROM tasks t JOIN bookings b ON t\.source_type = 'booking' AND t\.source_id = b\.id::text/i.test(text)) {
                return { rows: [{ count: 4 }] };
            }
            if (/FROM bookings b/i.test(text) && /b\.line_id IS NULL OR b\.line_id = 0/i.test(text)) {
                return { rows: [{ count: 2 }] };
            }
            throw new Error(`Unexpected dashboard-event-risk query: ${text}`);
        }
    };
}

test('dashboard event risk summary is visible-scope, explainable, and booking-linkage only', async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();

    const queries = [];
    const fakePool = createFakePool(queries);
    installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
    installMock('../services/websocket', { getOnlineUserIds: () => new Set() });

    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', require('../routes/dashboard'));
    const { server, baseUrl } = await listen(app);

    try {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/event_risk_summary`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.deepEqual(data.data.eventRiskSummary, {
            todayUnconfirmed: 3,
            tomorrowUnconfirmed: 5,
            latePreliminary: 1,
            bookingLinkedOverduePrep: 4,
            resourceWarnings: 2
        });
        assert.equal(data.data.meta.globalScore, false);
        assert.equal(data.data.meta.visibleScopeOnly, true);
        assert.equal(data.data.meta.bookingVisibilityBoundary, 'canonical object-level booking visibility scope');
        assert.match(data.data.meta.bookingVisibilityScopeSource, /booking-operational|full-role/);
        assert.match(data.data.meta.eventSoonSemantics, /timing review cue/);
        assert.ok(data.data.cards.some(card => card.key === 'booking_linked_overdue_prep' && /source_type=booking/.test(card.why)));

        const prepQuery = queries.find(query => /FROM tasks t JOIN bookings b/i.test(query.text));
        assert.ok(prepQuery, 'summary must derive prep readiness only from booking-linked tasks');
        assert.match(prepQuery.text, /t\.source_type = 'booking'/);
        assert.match(prepQuery.text, /t\.source_id = b\.id::text/);
        assert.doesNotMatch(prepQuery.text, /category\s*=\s*'event'/i);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
        clearModules();
    }
});

test('dashboard staff_today casts legacy staff_schedule date column before date comparison', async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();

    const queries = [];
    const fakePool = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            assert.doesNotMatch(text, /\bss\.date\s+IN\s+\(\$1::date,\s*\$2::date\)/i);
            assert.doesNotMatch(text, /\bss\.date\s*=\s*\$1::date\b/i);
            assert.doesNotMatch(text, /\bss\.date\s*=\s*\$2::date\b/i);

            if (/FROM staff_schedule ss/i.test(text) && /JOIN hr_shift_segments hss_now/i.test(text)) {
                assert.match(text, /\bss\.date::date\s+IN\s+\(\$1::date,\s*\$2::date\)/i);
                assert.match(text, /\bss\.date::date\s*=\s*\$1::date\b/i);
                assert.match(text, /\bss\.date::date\s*=\s*\$2::date\b/i);
                return { rows: [{ id: 1, name: 'QA Staff', department: 'Ops', position: 'Manager', shift_start: '09:00', shift_end: '18:00', status: 'working', segments: [] }] };
            }

            if (/FROM staff_schedule ss/i.test(text) && /ss\.status IN \('sick', 'vacation'\)/i.test(text)) {
                return { rows: [] };
            }

            throw new Error(`Unexpected staff_today query: ${text}`);
        }
    };
    installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
    installMock('../services/websocket', { getOnlineUserIds: () => new Set() });

    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', require('../routes/dashboard'));
    const { server, baseUrl } = await listen(app);

    try {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/staff_today`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.data.onShift.length, 1);
        assert.equal(data.data.onShift[0].name, 'QA Staff');
        assert.equal(queries.filter(query => /FROM staff_schedule ss/i.test(query.text)).length, 2);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
        clearModules();
    }
});

test('dashboard config PUT rejects stale two-tab revision without overwriting server config', async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();

    let updateCount = 0;
    const fakePool = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/SELECT layout, widgets, theme, updated_at/i.test(text) && /FROM dashboard_configs/i.test(text)) {
                return {
                    rows: [{
                        layout: { boardState: { items: [{ id: 'server-note', type: 'note', text: 'server' }] } },
                        widgets: ['tasks'],
                        theme: 'default',
                        server_revision: 'revision-current'
                    }]
                };
            }
            if (/UPDATE dashboard_configs/i.test(text)) {
                updateCount += 1;
                throw new Error(`stale config test must not update: ${text}`);
            }
            throw new Error(`Unexpected dashboard config query: ${text}`);
        }
    };
    installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
    installMock('../services/websocket', { getOnlineUserIds: () => new Set() });

    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', require('../routes/dashboard'));
    const { server, baseUrl } = await listen(app);

    try {
        const res = await fetch(`${baseUrl}/api/dashboard/config`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${tokenFor('manager')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                baseRevision: 'revision-old',
                widgets: ['tasks'],
                layout: {
                    boardState: {
                        items: [{ id: 'local-note', type: 'note', text: 'local tab edit' }]
                    }
                },
                theme: 'default'
            })
        });
        const data = await res.json();

        assert.equal(res.status, 409, JSON.stringify(data));
        assert.equal(data.success, false);
        assert.equal(data.conflict, true);
        assert.equal(data.conflictType, 'dashboard_config_revision');
        assert.equal(data.currentRevision, 'revision-current');
        assert.equal(data.currentConfig.serverRevision, 'revision-current');
        assert.equal(updateCount, 0);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
        clearModules();
    }
});

test('dashboard config PUT uses server revision for conditional update and returns next revision', async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();

    const queries = [];
    const fakePool = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (/SELECT layout, widgets, theme, updated_at/i.test(text) && /FROM dashboard_configs/i.test(text)) {
                return {
                    rows: [{
                        layout: { boardState: { items: [{ id: 'server-note', type: 'note', text: 'server' }] } },
                        widgets: ['tasks'],
                        theme: 'default',
                        server_revision: 'revision-current'
                    }]
                };
            }
            if (/UPDATE dashboard_configs/i.test(text)) {
                assert.match(text, /WHERE user_id = \$1 AND to_char\(updated_at AT TIME ZONE 'UTC'/);
                assert.equal(params[4], 'revision-current');
                return {
                    rows: [{
                        layout: JSON.parse(params[1]),
                        widgets: JSON.parse(params[2]),
                        theme: params[3],
                        server_revision: 'revision-next'
                    }]
                };
            }
            throw new Error(`Unexpected dashboard config query: ${text}`);
        }
    };
    installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
    installMock('../services/websocket', { getOnlineUserIds: () => new Set() });

    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', require('../routes/dashboard'));
    const { server, baseUrl } = await listen(app);

    try {
        const res = await fetch(`${baseUrl}/api/dashboard/config`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${tokenFor('manager')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                baseRevision: 'revision-current',
                widgets: ['tasks'],
                layout: {
                    boardState: {
                        items: [{ id: 'local-note', type: 'note', text: 'local tab edit' }]
                    }
                },
                theme: 'default'
            })
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.config.serverRevision, 'revision-next');
        assert.equal(data.config.boardState.items[0].text, 'local tab edit');
        assert.equal(queries.filter(query => /UPDATE dashboard_configs/i.test(query.text)).length, 1);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
        clearModules();
    }
});
