const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');

async function benchmark(context, origin, session, evidence) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    try {
        await pool.query(`
            WITH seed AS (
                INSERT INTO tasks (title, date, status, workflow_state, visibility, task_mode, owner_user_id, business_context,
                    task_kind, completed_at)
                SELECT 'QA benchmark ' || id, (CURRENT_DATE + (id % 7 - 3))::text,
                    CASE WHEN id % 3 = 0 THEN 'done' ELSE 'todo' END,
                    CASE WHEN id % 3 = 0 THEN 'done' ELSE 'todo' END,
                    'team', 'work', $1, 'event_genix', CASE WHEN id % 4 = 0 THEN 'checklist' ELSE 'action' END,
                    CASE WHEN id % 3 = 0 THEN NOW() - ((id % 20) * interval '1 day') END
                FROM generate_series(1, 600) AS id RETURNING id, task_kind
            )
            INSERT INTO task_subtasks (task_id, title, is_done, completed_at)
                SELECT id, 'QA historical step', true, NOW() FROM seed WHERE task_kind = 'checklist'
        `, [session.user.id]);
        await pool.query('ANALYZE tasks; ANALYZE task_subtasks');
    } finally {
        await pool.end();
    }

    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()).slice(0, 7);
    const endpoints = ['/api/tasks/my-cabinet?planningView=my-day', '/api/auth/profile', `/api/auth/profile/me/results?month=${month}`];
    const headers = { Authorization: `Bearer ${session.token}`, 'X-Business-Context': 'event_genix' };
    if (process.env.MY_DAY_CLEANUP_PLAN_ONLY === '1') {
        for (const endpoint of endpoints.slice(0, 2)) {
            const response = await context.request.get(origin + endpoint, { headers });
            assert.ok(response.ok(), `${endpoint}: ${response.status()}`);
            await response.dispose();
        }
        for (const key of ['profile-completion', 'my-day-open-count']) {
            assert.ok(fs.existsSync(path.join(evidence, `sql-plan-${key}.json`)), `Missing execution plan: ${key}`);
        }
        console.log('Wrote isolated execution plans.');
        return;
    }

    const warmup = 3;
    const sampled = [];
    for (let i = 0; i < warmup + 9; i++) {
        const page = await context.newPage();
        const requests = [];
        page.on('request', req => {
            const url = new URL(req.url());
            if (url.origin === origin) requests.push(url.pathname);
        });
        const started = performance.now();
        await page.goto(origin + '/profile?tab=myday', { waitUntil: 'domcontentloaded' });
        await page.locator('[data-park-period=today]').waitFor();
        if (i >= warmup) sampled.push({ readyMs: Math.round(performance.now() - started),
            requests: requests.length, apiRequests: requests.filter(item => item.startsWith('/api/')).length });
        await page.close();
    }
    const timings = Object.fromEntries(endpoints.map(endpoint => [endpoint, []]));
    for (let i = 0; i < warmup + 40; i++) {
        for (const endpoint of endpoints) {
            const started = performance.now();
            const result = await context.request.get(origin + endpoint, { headers });
            assert.ok(result.ok(), `${endpoint}: ${result.status()}`);
            await result.body();
            if (i >= warmup) timings[endpoint].push(Math.round((performance.now() - started) * 10) / 10);
            await result.dispose();
        }
    }
    const file = path.join(evidence, 'my-day-benchmark.json');
    fs.writeFileSync(file, JSON.stringify({ dataset: { tasks: 600, legacySubtasks: 150 }, ready: sampled, api: timings }, null, 2));
    console.log('Wrote isolated My Day benchmark samples.');
}

module.exports = { benchmark };
