'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const [before, after] = process.argv.slice(2);
assert.ok(before && after, 'Usage: node compare-customer-reads.js <before-app-dir> <after-app-dir>');
const roots = { before: path.resolve(before), after: path.resolve(after) };
assert.notEqual(roots.before, roots.after);
for (const root of Object.values(roots)) {
    assert.ok(fs.existsSync(path.join(root, 'server.js')), 'Expected an application source tree');
    for (const file of ['.env', '.env.local']) {
        assert.ok(!fs.existsSync(path.join(root, file)), 'Use a source tree without local environment files');
    }
}

const db = new URL(process.env.BENCHMARK_DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
assert.equal(db.hostname, '127.0.0.1');
assert.match(db.pathname, /^\/eventgenix_perf(?:_small)?_test$/);
assert.equal(db.search, '');
assert.equal(db.password, '', 'Use an isolated, passwordless loopback cluster for the synthetic fixtures');
const size = Number(process.env.BENCHMARK_CUSTOMER_COUNT || 2500);
const repeats = Number(process.env.BENCHMARK_REPEATS || 3);
const port = Number(process.env.BENCHMARK_APP_PORT || 55448);
const resourceSeconds = process.env.BENCHMARK_RESOURCE_WINDOW_SECONDS;
const resourceProbe = path.join(__dirname, 'customer-resource-probe.js');
const traceSeconds = process.env.BENCHMARK_TRACE_SECONDS;
const poolStats = process.env.BENCHMARK_POOL_STATS === '1';
const onlyVersion = process.env.BENCHMARK_ONLY_VERSION;
const outputFile = process.env.BENCHMARK_OUTPUT_FILE;
assert.ok([2500, 25000].includes(size));
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
assert.ok(!onlyVersion || Object.hasOwn(roots, onlyVersion));
assert.ok(!outputFile || path.isAbsolute(outputFile), 'Benchmark evidence path must be absolute');
assert.ok([resourceSeconds, traceSeconds, poolStats].filter(Boolean).length <= 1,
    'Resource, pool and browser measurements use separate runs');

const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP|TMPDIR|PATHEXT|BENCHMARK_WARMUP|BENCHMARK_SAMPLES|BENCHMARK_CONCURRENCY|BENCHMARK_SCENARIOS|BENCHMARK_PARITY)$/i.test(key))),
    PGHOST: '127.0.0.1', PGPORT: db.port || '5432', PGUSER: db.username || 'postgres',
    PGDATABASE: db.pathname.slice(1), PGSSLMODE: 'disable', PORT: String(port), NODE_ENV: 'test',
    BOOTSTRAP_CREATOR_USERNAME: 'bench_creator', BOOTSTRAP_CREATOR_PASSWORD: randomBytes(24).toString('hex'),
    JWT_SECRET: randomBytes(64).toString('hex'), RATE_LIMIT_MAX: '100000',
    BACKUP_OUTBOUND_HOLD: 'true', PAYMENT_OUTBOX_WAKEUP_DISABLED: 'true',
    SKIP_TELEGRAM_BOT_STARTUP_CONFIG: 'true',
    BENCHMARK_DATABASE_URL: db.href, BENCHMARK_URL: `http://127.0.0.1:${port}`,
    BENCHMARK_CUSTOMER_COUNT: String(size)
};

async function installFixtureLogin(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: [fixture] } = await client.query(`
            SELECT current_database() AS name, host(inet_server_addr()) AS address,
                (SELECT COUNT(*)::int FROM customers) AS customers,
                (SELECT COUNT(*)::int FROM bookings) AS bookings,
                EXISTS(SELECT 1 FROM customers WHERE name NOT LIKE 'Bench Family %') AS other_customer,
                EXISTS(SELECT 1 FROM bookings WHERE id NOT LIKE 'perf-%') AS other_booking
        `);
        assert.deepEqual(fixture, {
            name: env.PGDATABASE, address: '127.0.0.1', customers: size, bookings: size * 12,
            other_customer: false, other_booking: false
        });
        const { rows } = await client.query(
            "SELECT password_hash FROM users WHERE username = 'bench_creator' AND role = 'creator' FOR UPDATE");
        assert.equal(rows.length, 1, 'Expected the dedicated synthetic creator');
        const passwordHash = await bcrypt.hash(env.BOOTSTRAP_CREATOR_PASSWORD, 10);
        await client.query("UPDATE users SET password_hash = $1 WHERE username = 'bench_creator'", [passwordHash]);
        await client.query('COMMIT');
        return async () => {
            const result = await pool.query(
                "UPDATE users SET password_hash = $1 WHERE username = 'bench_creator' AND password_hash = $2",
                [rows[0].password_hash, passwordHash]);
            assert.equal(result.rowCount, 1, 'Synthetic login changed while the comparison was running');
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

function assertFreePort() {
    return new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(port, '127.0.0.1', () => listener.close(resolve));
    });
}

function readPoolSnapshot(server) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            server.off('message', receive);
            reject(new Error('Timed out reading application pool counters'));
        }, 3000);
        function receive(snapshot) {
            clearTimeout(timeout);
            resolve(snapshot);
        }
        server.once('message', receive);
        server.send('benchmark-pool-snapshot', error => {
            if (!error) return;
            clearTimeout(timeout);
            server.off('message', receive);
            reject(error);
        });
    });
}

async function run(version, repetition) {
    await assertFreePort();
    const telemetryDir = resourceSeconds ? fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-resource-')) : null;
    const runEnv = { ...env };
    if (resourceSeconds) {
        runEnv.BENCHMARK_RESOURCE_WINDOW_SECONDS = resourceSeconds;
        runEnv.BENCHMARK_TELEMETRY_FILE = path.join(telemetryDir, 'process.jsonl');
    }
    if (traceSeconds) {
        runEnv.BENCHMARK_TRACE_SECONDS = traceSeconds;
        runEnv.BENCHMARK_BROWSER_MODULE = process.env.BENCHMARK_BROWSER_MODULE;
        runEnv.BENCHMARK_BROWSER_EXECUTABLE = process.env.BENCHMARK_BROWSER_EXECUTABLE || '';
        runEnv.BENCHMARK_TRACE_SCREENSHOT_DIR = process.env.BENCHMARK_TRACE_SCREENSHOT_DIR || '';
        runEnv.BENCHMARK_TRACE_VERSION = version;
    }
    const options = { cwd: roots[version], env: runEnv, windowsHide: true };
    const args = resourceSeconds || poolStats ? ['--require', resourceProbe, 'server.js'] : ['server.js'];
    const stdio = poolStats ? ['ignore', 'ignore', 'ignore', 'ipc'] : 'ignore';
    const server = spawn(process.execPath, args, { ...options, stdio });
    const stopped = new Promise(resolve => {
        server.once('exit', resolve);
        server.once('error', resolve);
    });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 120 && server.pid && server.exitCode === null; attempt++) {
            try {
                const response = await fetch(env.BENCHMARK_URL + '/api/ready', { signal: AbortSignal.timeout(1000) });
                if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
            } catch {}
            await delay(500);
        }
        assert.ok(ready, 'Disposable application did not start');
        const poolBefore = poolStats ? await readPoolSnapshot(server) : null;
        const results = await new Promise((resolve, reject) => {
            const script = resourceSeconds ? resourceProbe
                : path.join(__dirname, traceSeconds ? 'customer-page-trace.js' : 'customer-reads.js');
            const child = spawn(process.execPath, [script], {
                ...options, env: { ...runEnv, BENCHMARK_SERVER_PID: String(server.pid) }
            });
            let output = '';
            let errors = '';
            child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
            child.stderr.setEncoding('utf8').on('data', chunk => { errors = (errors + chunk).slice(-4096); });
            child.once('error', reject);
            child.once('close', code => {
                try {
                    const parsed = JSON.parse(output);
                    if (code !== 0) process.exitCode = 1;
                    resolve(parsed);
                } catch {
                    const safeError = errors.replaceAll(env.BOOTSTRAP_CREATOR_PASSWORD, '[REDACTED]')
                        .replaceAll(env.JWT_SECRET, '[REDACTED]').trim();
                    reject(new Error(`Benchmark exited with code ${code} without a measurement: ${safeError}`));
                }
            });
        });
        if (poolBefore) {
            const poolAfter = await readPoolSnapshot(server);
            results.pool = Object.fromEntries(Object.entries(poolAfter).map(([key, value]) => [key, value - poolBefore[key]]));
        }
        const record = JSON.stringify({ version, repetition, size, results });
        if (outputFile) fs.appendFileSync(outputFile, record + '\n');
        else console.log(record);
    } finally {
        if (server.exitCode === null) server.kill();
        await stopped;
        if (telemetryDir) {
            fs.rmSync(runEnv.BENCHMARK_TELEMETRY_FILE, { force: true });
            fs.rmdirSync(telemetryDir);
        }
    }
}

async function main() {
    const pool = new Pool({ connectionString: db.href });
    let restore;
    try {
        await assertFreePort();
        restore = await installFixtureLogin(pool);
        for (let i = 1; i <= repeats; i++) {
            const versions = onlyVersion ? [onlyVersion] : i % 2 ? ['before', 'after'] : ['after', 'before'];
            for (const version of versions) await run(version, i);
        }
    } finally {
        try { await restore?.(); } finally { await pool.end(); }
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
