'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');

const databaseName = 'eventgenix_perf_scheduler_test';
const loopback = host => ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(String(host).toLowerCase());

function installProbe() {
    assert.equal(process.env.PGDATABASE, databaseName);
    assert.equal(process.env.PGHOST, '127.0.0.1');
    assert.equal(process.env.NODE_ENV, 'test');
    assert.ok(!process.env.DATABASE_URL && !process.env.RAILWAY_PROJECT_ID && !process.env.BACKUP_OUTBOUND_HOLD);

    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (port, ...args) {
        assert.equal(String(port), process.env.PORT);
        return listen.call(this, Number(port), '127.0.0.1', ...args);
    };
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
        const options = Array.isArray(args[0]) ? args[0][0] : args[0];
        const host = typeof options === 'object' ? options.host : args[1];
        if (!options?.path && typeof host === 'string' && !loopback(host)) {
            throw new Error('Scheduler probe blocked external TCP');
        }
        return connect.apply(this, args);
    };
    function assertHttpTarget(input) {
        const host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname
            : input?.hostname || input?.host || 'localhost';
        assert.ok(loopback(host), 'Scheduler probe blocked external HTTP');
    }
    for (const transport of [http, https]) {
        for (const method of ['request', 'get']) {
            const original = transport[method];
            transport[method] = function (...args) {
                assertHttpTarget(args[0]);
                return original.apply(this, args);
            };
        }
    }
    const fetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
        assertHttpTarget(input instanceof Request ? input.url : input);
        return fetch(input, { ...options, redirect: 'error' });
    };

    const fromApp = createRequire(path.join(process.cwd(), 'server.js'));
    const { Client } = fromApp('pg');
    const scheduler = fromApp('./services/schedulerGuard');
    const scope = new AsyncLocalStorage();
    const jobs = new Map();
    const otherQueries = {};
    let sampled = false;
    const query = Client.prototype.query;
    Client.prototype.query = function (...args) {
        if (sampled) {
            const operation = scope.getStore();
            if (operation) operation.job[operation.phase]++;
            else {
                const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
                const category = /\bevent_outbox\b/i.test(sql) ? 'event outbox'
                    : /\bpayment_outbox/i.test(sql) ? 'payment outbox' : 'other background';
                otherQueries[category] = (otherQueries[category] || 0) + 1;
            }
        }
        return query.apply(this, args);
    };
    const guard = scheduler.guardScheduler;
    scheduler.guardScheduler = function (name, handler, options) {
        const job = { name, ticks: 0, executions: 0, guardQueries: 0, workQueries: 0, workMs: 0 };
        jobs.set(name, job);
        const guarded = guard(name, async function (...args) {
            const measure = sampled;
            const started = performance.now();
            if (measure) job.executions++;
            try {
                return await scope.run({ job, phase: 'workQueries' }, () => handler.apply(this, args));
            } finally {
                if (measure) job.workMs += performance.now() - started;
            }
        }, options);
        return function (...args) {
            if (sampled) job.ticks++;
            return scope.run({ job, phase: 'guardQueries' }, () => guarded.apply(this, args));
        };
    };
    let start, cpu;
    process.on('message', message => {
        if (message === 'start-scheduler-sample') {
            sampled = true;
            start = performance.now();
            cpu = process.cpuUsage();
        } else if (message === 'read-scheduler-sample' && sampled) {
            const { user, system } = process.cpuUsage(cpu);
            sampled = false;
            process.send({
                seconds: (performance.now() - start) / 1000, appCpuSeconds: (user + system) / 1e6,
                jobs: [...jobs.values()].filter(job => job.ticks > 0), otherQueries
            });
        }
    });
}

async function main() {
    const db = new URL(process.env.BENCHMARK_SCHEDULER_DATABASE_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
    assert.equal(db.hostname, '127.0.0.1');
    assert.equal(db.pathname, '/' + databaseName);
    assert.equal(db.password, '');
    assert.equal(db.search, '');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: db.href });
    try {
        const { rows: [fixture] } = await pool.query(`
            SELECT current_database() AS name, host(inet_server_addr()) AS host,
                (SELECT count(*)::int FROM customers WHERE name LIKE 'Bench Family %') AS fixtures,
                (SELECT count(*)::int FROM customers) AS customers,
                (SELECT count(*)::int FROM bookings WHERE id LIKE 'perf-%') AS fixture_bookings,
                (SELECT count(*)::int FROM bookings) AS bookings
        `);
        assert.deepEqual(fixture, {
            name: databaseName, host: '127.0.0.1', fixtures: 2500, customers: 2500,
            fixture_bookings: 30000, bookings: 30000
        });
    } finally { await pool.end(); }
    for (const file of ['.env', '.env.local']) assert.ok(!fs.existsSync(file));
    const seconds = Number(process.env.BENCHMARK_SCHEDULER_SECONDS || 600);
    assert.ok(Number.isInteger(seconds) && seconds >= 65 && seconds <= 900);
    const port = 55449;
    await new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(port, '127.0.0.1', () => listener.close(resolve));
    });
    const env = {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
            /^(PATH|SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP|TMPDIR|PATHEXT)$/i.test(name))),
        PGHOST: db.hostname, PGPORT: db.port || '5432', PGUSER: db.username || 'postgres',
        PGDATABASE: databaseName, NODE_ENV: 'test', PORT: String(port),
        JWT_SECRET: randomBytes(64).toString('hex'), PAYMENT_OUTBOX_WAKEUP_DISABLED: 'true',
        SKIP_TELEGRAM_BOT_STARTUP_CONFIG: 'true'
    };
    const server = spawn(process.execPath, ['--require', __filename, 'server.js'], {
        env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    const stopped = new Promise(resolve => {
        server.once('exit', resolve);
        server.once('error', resolve);
    });
    try {
        let ready = false;
        for (let i = 0; i < 100 && server.pid && server.exitCode === null; i++) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(1000) });
                if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
            } catch {}
            await delay(500);
        }
        assert.ok(ready, 'Owned scheduler fixture did not start');
        server.send('start-scheduler-sample');
        await Promise.race([
            delay(seconds * 1000, undefined, { ref: false }),
            stopped.then(() => { throw new Error('Scheduler process exited early'); })
        ]);
        const report = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Scheduler probe report timed out')), 3000);
            server.once('message', data => { clearTimeout(timeout); resolve(data); });
            server.send('read-scheduler-sample');
        });
        assert.ok(report.jobs.length > 0, 'Expected guarded jobs to tick');
        console.log(JSON.stringify(report));
    } finally {
        if (server.exitCode === null) server.kill();
        await stopped;
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
else installProbe();
