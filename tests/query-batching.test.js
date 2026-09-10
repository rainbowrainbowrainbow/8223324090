'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../db');
const { getKyivDateStr } = require('../services/booking');

function getRouteHandler(router, routePath, method = 'get') {
    const layer = router.stack.find(candidate => candidate.route?.path === routePath && candidate.route.methods?.[method]);
    assert.ok(layer, `${method.toUpperCase()} ${routePath} route must exist`);
    const handler = layer.route.stack.at(-1)?.handle;
    assert.equal(typeof handler, 'function', `${method.toUpperCase()} ${routePath} handler must exist`);
    return handler;
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function withPoolQuery(mockQuery, work) {
    const originalQuery = pool.query;
    pool.query = mockQuery;
    try {
        return await work();
    } finally {
        pool.query = originalQuery;
    }
}

function recurringFixture(size) {
    const templates = Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        pattern: 'weekly',
        days_of_week: [1],
        interval_weeks: 1,
        start_date: '2026-01-01',
        time_start: '10:00:00',
        time_end: '11:00:00',
        product_id: `program-${index + 1}`,
        product_name: `Program ${index + 1}`,
        status: 'confirmed',
        is_active: true,
        created_at: new Date(Date.UTC(2026, 0, size - index))
    }));
    const bookings = new Map();
    const skips = new Map();
    templates.forEach(template => {
        const rows = template.id === 1
            ? [
                { status: 'confirmed', date: '2099-01-10' },
                { status: 'cancelled', date: '2099-01-05' }
            ]
            : template.id === 2
                ? [
                    { status: 'confirmed', date: '2020-01-01' },
                    { status: 'cancelled', date: '2099-01-05' }
                ]
                : [
                    { status: 'confirmed', date: '2020-01-01' },
                    { status: 'confirmed', date: `2099-02-${String((template.id % 20) + 1).padStart(2, '0')}` },
                    { status: 'cancelled', date: '2099-01-05' }
                ];
        bookings.set(template.id, rows);
        skips.set(template.id, Array.from({ length: template.id % 3 }, (_, index) => ({ id: index + 1 })));
    });
    return { templates, bookings, skips };
}

function recurringStats(fixture, templateId, today) {
    const active = (fixture.bookings.get(Number(templateId)) || []).filter(row => row.status !== 'cancelled');
    const next = active.map(row => row.date).filter(date => date >= today).sort()[0] || null;
    return {
        template_id: Number(templateId),
        instance_count: String(active.length),
        skip_count: String((fixture.skips.get(Number(templateId)) || []).length),
        next_date: next
    };
}

function createRecurringQueryMock(fixture, calls, options = {}) {
    return async (sql, params = []) => {
        const text = String(sql);
        calls.push({ text, params });
        if (/SELECT \* FROM recurring_templates ORDER BY created_at DESC/.test(text)) {
            return { rows: fixture.templates };
        }
        if (options.failStats) throw new Error('relation "bookings" does not exist');
        if (/WITH\s+booking_stats/i.test(text)) {
            assert.match(text, /status\s*!=\s*'cancelled'/i);
            assert.match(text, /MIN\s*\(date\)/i);
            assert.match(text, /recurring_booking_skips/i);
            const ids = params[0];
            const today = params[1];
            return { rows: ids.map(id => recurringStats(fixture, id, today)) };
        }
        if (/SELECT COUNT\(\*\) FROM bookings/.test(text)) {
            const stats = recurringStats(fixture, params[0], '0000-01-01');
            return { rows: [{ count: stats.instance_count }] };
        }
        if (/SELECT COUNT\(\*\) FROM recurring_booking_skips/.test(text)) {
            const stats = recurringStats(fixture, params[0], '0000-01-01');
            return { rows: [{ count: stats.skip_count }] };
        }
        if (/SELECT date FROM bookings/.test(text)) {
            const stats = recurringStats(fixture, params[0], params[1]);
            return { rows: stats.next_date ? [{ date: stats.next_date }] : [] };
        }
        throw new Error(`Unexpected recurring query: ${text}`);
    };
}

function soundFixture(size) {
    const projects = Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        name: `Project ${index + 1}`,
        type: index % 2 ? 'show' : 'quest',
        created_at: new Date(Date.UTC(2026, 0, size - index))
    }));
    const tracks = new Map();
    projects.forEach(project => {
        const rows = project.id === 2 ? [] : [
            { sortOrder: 20, sound: { id: project.id * 100 + 2, name: `Sound ${project.id}.2`, filename: `${project.id}-2.mp3` } },
            { sortOrder: 10, sound: { id: project.id * 100 + 1, name: `Sound ${project.id}.1`, filename: `${project.id}-1.mp3` } }
        ];
        tracks.set(project.id, rows);
    });
    return { projects, tracks };
}

function createSoundQueryMock(fixture, calls) {
    return async (sql, params = []) => {
        const text = String(sql);
        calls.push({ text, params });
        if (/FROM sound_projects/.test(text)) return { rows: fixture.projects };
        if (/FROM sounds s/.test(text) && /sound_project_tracks/.test(text)) {
            const projectIds = Array.isArray(params[0]) ? params[0] : [params[0]];
            const batched = Array.isArray(params[0]);
            const rows = projectIds.flatMap(projectId => (fixture.tracks.get(Number(projectId)) || [])
                .slice()
                .sort((left, right) => left.sortOrder - right.sortOrder)
                .map(track => batched
                    ? { ...track.sound, __sound_project_id: Number(projectId) }
                    : { ...track.sound }));
            return { rows };
        }
        throw new Error(`Unexpected sound query: ${text}`);
    };
}

const recurringHandler = getRouteHandler(require('../routes/recurring'), '/');
const currentSoundHandler = getRouteHandler(require('../routes/music'), '/projects');
const legacySoundHandler = getRouteHandler(require('../routes/sound-library'), '/projects');

test('recurring template list keeps a constant query budget for N=1/10/100', async t => {
    for (const size of [1, 10, 100]) {
        await t.test(`N=${size}`, async () => {
            const fixture = recurringFixture(size);
            const calls = [];
            const res = responseRecorder();
            await withPoolQuery(createRecurringQueryMock(fixture, calls), () => recurringHandler({}, res));

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.length, size);
            assert.equal(calls.length, 2, `recurring N=${size} query budget`);
            assert.deepEqual(res.body.slice(0, 3).map(item => ({
                id: item.id,
                instanceCount: item.instanceCount,
                skipCount: item.skipCount,
                nextDate: item.nextDate
            })), fixture.templates.slice(0, 3).map(template => {
                const stats = recurringStats(fixture, template.id, getKyivDateStr());
                return {
                    id: template.id,
                    instanceCount: Number(stats.instance_count),
                    skipCount: Number(stats.skip_count),
                    nextDate: stats.next_date
                };
            }));
        });
    }
});

test('recurring list preserves empty and missing-table compatibility behavior', async () => {
    const emptyCalls = [];
    const emptyRes = responseRecorder();
    await withPoolQuery(createRecurringQueryMock(recurringFixture(0), emptyCalls), () => recurringHandler({}, emptyRes));
    assert.deepEqual(emptyRes.body, []);
    assert.equal(emptyCalls.length, 1);

    for (const failureMode of ['templates', 'stats']) {
        const fixture = recurringFixture(1);
        const res = responseRecorder();
        await withPoolQuery(async (sql, params) => {
            if (failureMode === 'templates') throw new Error('relation "recurring_templates" does not exist');
            return createRecurringQueryMock(fixture, [], { failStats: true })(sql, params);
        }, () => recurringHandler({}, res));
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, []);
    }
});

async function readSoundProjects(handler, size) {
    const fixture = soundFixture(size);
    const calls = [];
    const res = responseRecorder();
    await withPoolQuery(createSoundQueryMock(fixture, calls), () => handler({}, res));
    return { fixture, calls, res };
}

test('current and legacy sound project reads have constant query budgets for N=1/10/100', async t => {
    for (const [label, handler] of [['current', currentSoundHandler], ['legacy', legacySoundHandler]]) {
        for (const size of [1, 10, 100]) {
            await t.test(`${label} N=${size}`, async () => {
                const { calls, res } = await readSoundProjects(handler, size);
                assert.equal(res.statusCode, 200);
                assert.equal(res.body.projects.length, size);
                assert.equal(calls.length, 2, `${label} sound projects N=${size} query budget`);
            });
        }
    }
});

test('current and legacy sound project routes preserve response shape, caps, track order, and empty tracks', async () => {
    const current = await readSoundProjects(currentSoundHandler, 10);
    const legacy = await readSoundProjects(legacySoundHandler, 10);

    assert.deepEqual(current.res.body, legacy.res.body);
    assert.deepEqual(current.res.body.projects[0].tracks.map(track => track.id), [101, 102]);
    assert.deepEqual(current.res.body.projects[1].tracks, []);
    assert.match(current.calls[0].text, /ORDER BY created_at DESC LIMIT \$1/);
    assert.deepEqual(current.calls[0].params, [200]);
    assert.doesNotMatch(legacy.calls[0].text, /LIMIT/i);
    assert.deepEqual(legacy.calls[0].params, []);

    const emptyCurrent = await readSoundProjects(currentSoundHandler, 0);
    const emptyLegacy = await readSoundProjects(legacySoundHandler, 0);
    assert.deepEqual(emptyCurrent.res.body, { projects: [] });
    assert.deepEqual(emptyLegacy.res.body, { projects: [] });
    assert.equal(emptyCurrent.calls.length, 1);
    assert.equal(emptyLegacy.calls.length, 1);
});
