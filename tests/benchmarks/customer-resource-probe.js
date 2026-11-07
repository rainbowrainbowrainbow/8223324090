'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');

const database = /^eventgenix_perf(?:_small)?_test$/;
assert.match(process.env.PGDATABASE || '', database);
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(!process.env.DATABASE_URL && !process.env.RAILWAY_PROJECT_ID);
const telemetryFile = process.env.BENCHMARK_TELEMETRY_FILE;
const run = promisify(execFile);

function instrumentApp() {
    const pg = createRequire(path.join(process.cwd(), 'server.js'))('pg');
    const connect = pg.Pool.prototype.connect;
    let acquisitions = 0, queued = 0, queuedMs = 0, maxQueueMs = 0;
    pg.Pool.prototype.connect = function observedConnect(callback) {
        const start = performance.now();
        const queuedAtStart = this.waitingCount > 0 || (this.idleCount === 0 && this.totalCount >= this.options.max);
        function record() {
            acquisitions++;
            if (queuedAtStart) {
                const elapsed = performance.now() - start;
                queued++;
                queuedMs += elapsed;
                maxQueueMs = Math.max(maxQueueMs, elapsed);
            }
        }
        if (typeof callback === 'function') {
            return connect.call(this, (...args) => { record(); callback(...args); });
        }
        return connect.call(this).finally(record);
    };
    if (process.send) {
        process.on('message', message => {
            if (message === 'benchmark-pool-snapshot') process.send({ acquisitions, queued, queuedMs });
        });
    }
    if (!telemetryFile) return;
    assert.ok(path.isAbsolute(telemetryFile));
    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    setInterval(() => {
        const { rss, heapUsed, external } = process.memoryUsage();
        const sample = { at: Date.now(), rss, heapUsed, external, acquisitions, queued, queuedMs, maxQueueMs,
            eventLoopP95Ms: loop.percentile(95) / 1e6, eventLoopMaxMs: loop.max / 1e6 };
        fs.appendFileSync(telemetryFile, JSON.stringify(sample) + '\n');
        loop.reset();
        maxQueueMs = 0;
    }, 5000).unref();
}

async function sampleProcesses(pool, appPid) {
    const { rows } = await pool.query(`SELECT pid FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND (datname = current_database() OR datname IS NULL)`);
    const ids = [appPid, ...rows.map(row => row.pid)];
    assert.ok(ids.every(Number.isSafeInteger));
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ProgressPreference='SilentlyContinue'; ConvertTo-Json -Compress -InputObject @(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64)`],
    { windowsHide: true });
    const processes = JSON.parse(stdout);
    const app = processes.find(row => row.Id === appPid);
    assert.ok(app, 'Missing application process in resource sample');
    return { at: Date.now(), app, postgres: processes.filter(row => row.Id !== appPid) };
}

async function snapshotStatements(pool) {
    const { rows } = await pool.query(`SELECT queryid::text, calls::float8, total_exec_time AS elapsed_ms,
        CASE
            WHEN query ILIKE '%FROM customers c%' THEN 'customers'
            WHEN query ILIKE '%payment_outbox%' THEN 'payment outbox'
            WHEN query ILIKE '%event_outbox%' THEN 'event outbox'
            WHEN query ILIKE '%scheduled_messages%' THEN 'scheduled messages'
            WHEN query ILIKE '%FROM scheduler%' OR query ILIKE '%INTO scheduler%' THEN 'scheduler guard'
            WHEN query ILIKE '%FROM bookings%' THEN 'bookings'
            WHEN query ILIKE '%FROM settings%' THEN 'settings'
            ELSE 'other'
        END AS area
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT ILIKE '%pg_stat_%'`);
    return rows;
}

function statementDeltas(before, after) {
    const first = new Map(before.map(row => [row.queryid, row]));
    const groups = new Map();
    for (const row of after) {
        const baseline = first.get(row.queryid);
        const delta = row.calls - (baseline?.calls || 0);
        if (delta <= 0) continue;
        const group = groups.get(row.area) || { area: row.area, calls: 0, elapsedMs: 0 };
        group.calls += delta;
        group.elapsedMs += row.elapsed_ms - (baseline?.elapsed_ms || 0);
        groups.set(row.area, group);
    }
    return [...groups.values()].sort((a, b) => b.calls - a.calls);
}

async function observeResources() {
    assert.equal(process.platform, 'win32', 'The process sampler uses Windows process counters');
    assert.ok(path.isAbsolute(telemetryFile || ''));
    const appPid = Number(process.env.BENCHMARK_SERVER_PID);
    const seconds = Number(process.env.BENCHMARK_RESOURCE_WINDOW_SECONDS);
    assert.ok(Number.isSafeInteger(appPid) && appPid > 0);
    assert.ok(Number.isInteger(seconds) && seconds >= 20 && seconds <= 900);
    const base = new URL(process.env.BENCHMARK_URL);
    assert.equal(base.protocol, 'http:');
    assert.equal(base.hostname, '127.0.0.1');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.BENCHMARK_DATABASE_URL });
    try {
        const fixtures = await pool.query("SELECT COUNT(*)::int AS count FROM customers WHERE name LIKE 'Bench Family %'");
        assert.equal(fixtures.rows[0].count, 2500, 'Fixed-rate resource probe expects the 2,500-customer fixture');
        const login = await fetch(new URL('/api/auth/login', base), {
            method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'bench_creator', password: process.env.BOOTSTRAP_CREATOR_PASSWORD }),
            signal: AbortSignal.timeout(10000)
        });
        assert.equal(login.status, 200);
        const { token } = await login.json();
        assert.ok(token);
        const endpoints = ['/api/customers?limit=50', '/api/customers/search?q=Bench%20Family%2002347',
            '/api/customers/search?q=Bench%20Family'];
        async function get(route) {
            const response = await fetch(new URL(route, base), {
                headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
                redirect: 'error', signal: AbortSignal.timeout(15000)
            });
            await response.arrayBuffer();
            return response.ok;
        }
        for (const route of endpoints) assert.ok(await get(route));

        const report = {};
        for (const phase of ['idle', 'load']) {
            const initialStatements = await snapshotStatements(pool);
            const samples = [await sampleProcesses(pool, appPid)];
            const start = Date.now();
            let errors = 0, dropped = 0, completed = 0;
            const active = new Set();
            const sampler = (async () => {
                for (let offset = 15; offset < seconds; offset += 15) {
                    await delay(Math.max(0, start + offset * 1000 - Date.now()));
                    samples.push(await sampleProcesses(pool, appPid));
                }
            })();
            if (phase === 'load') {
                for (let i = 0; i < seconds * 2; i++) {
                    await delay(Math.max(0, start + i * 500 - Date.now()));
                    if (active.size >= 5) { dropped++; continue; }
                    const request = get(endpoints[i % endpoints.length]).then(ok => { if (!ok) errors++; },
                        () => { errors++; }).finally(() => { completed++; active.delete(request); });
                    active.add(request);
                }
            }
            await delay(Math.max(0, start + seconds * 1000 - Date.now()));
            await Promise.all(active);
            await sampler;
            samples.push(await sampleProcesses(pool, appPid));
            const end = Date.now();
            const statements = statementDeltas(initialStatements, await snapshotStatements(pool));
            const app = fs.readFileSync(telemetryFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
                .filter(row => row.at >= start && row.at <= end);
            report[phase] = { start, end, completed, errors, dropped, statements, app, processes: samples };
        }
        console.log(JSON.stringify(report));
        assert.equal(report.load.errors + report.load.dropped, 0);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    observeResources().catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
    instrumentApp();
}
