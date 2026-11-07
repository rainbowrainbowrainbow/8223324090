'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const digest = value => createHash('sha256').update(value).digest('hex');

const base = new URL(process.env.BENCHMARK_URL || 'http://127.0.0.1:55440');
const db = new URL(process.env.BENCHMARK_DATABASE_URL || 'postgres://postgres@127.0.0.1:55439/eventgenix_perf_test');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(db.hostname, '127.0.0.1');
assert.match(db.pathname, /^\/eventgenix_perf(?:_small)?_test$/);
assert.equal(db.search, '');

const warmup = Number(process.env.BENCHMARK_WARMUP || 8);
const count = Number(process.env.BENCHMARK_SAMPLES || 60);
const customerCount = Number(process.env.BENCHMARK_CUSTOMER_COUNT || 2500);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY || 1);
assert.ok(Number.isInteger(warmup) && warmup >= 0);
assert.ok(Number.isInteger(count) && count > 0);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10);
const scenarios = {
    customerList: '/api/customers?limit=50',
    customerSearch: '/api/customers/search?q=Bench%20Family%2002347',
    broadCustomerSearch: '/api/customers/search?q=Bench%20Family'
};
const selected = (process.env.BENCHMARK_SCENARIOS || Object.keys(scenarios).join(',')).split(',');
assert.equal(new Set(selected).size, selected.length);
assert.ok(selected.every(name => Object.hasOwn(scenarios, name)));

async function snapshot(pool) {
    const { rows: [row] } = await pool.query(`SELECT COALESCE(SUM(calls), 0)::int AS calls,
        COALESCE(SUM(total_exec_time), 0) AS ms,
        COALESCE(SUM(shared_blks_hit), 0)::text AS shared_hits,
        COALESCE(SUM(shared_blks_read), 0)::text AS shared_reads
        FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query LIKE '%FROM customers c%' AND query NOT LIKE '%pg_stat_statements%'`);
    return row;
}

async function main() {
    const password = process.env.BOOTSTRAP_CREATOR_PASSWORD;
    assert.ok(password, 'Set BOOTSTRAP_CREATOR_PASSWORD to the local synthetic login password');
    const pool = new Pool({ connectionString: db.href });
    try {
        const fixture = await pool.query("SELECT COUNT(*)::int AS count FROM customers WHERE name LIKE 'Bench Family %'");
        assert.equal(fixture.rows[0].count, customerCount);
        const login = await fetch(new URL('/api/auth/login', base), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'bench_creator', password }), redirect: 'error'
        });
        assert.equal(login.status, 200);
        const { token } = await login.json();
        assert.ok(token);
        const results = {};
        for (const name of selected) {
            const path = scenarios[name];
            const request = async () => {
                const response = await fetch(new URL(path, base), {
                    headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
                    redirect: 'error', signal: AbortSignal.timeout(90000)
                });
                return { status: response.status, body: await response.text() };
            };
            for (let i = 0; i < warmup; i++) assert.equal((await request()).status, 200);
            const before = await snapshot(pool);
            const samples = [];
            const failures = {};
            let pending = 0;
            let last;
            const batchStart = performance.now();
            await Promise.all(Array.from({ length: Math.min(concurrency, count) }, async () => {
                while (pending++ < count) {
                    const start = performance.now();
                    let failure;
                    try {
                        const response = await request();
                        if (response.status === 200) {
                            samples.push(performance.now() - start);
                            last = response.body;
                            continue;
                        }
                        failure = `http-${response.status}`;
                    } catch (error) {
                        failure = error.name === 'TimeoutError' ? 'timeout' : 'network';
                    }
                    failures[failure] = (failures[failure] || 0) + 1;
                }
            }));
            const batchMs = performance.now() - batchStart;
            const after = await snapshot(pool);
            samples.sort((a, b) => a - b);
            const hits = Number(after.shared_hits) - Number(before.shared_hits);
            const reads = Number(after.shared_reads) - Number(before.shared_reads);
            const ranked = name === 'broadCustomerSearch' && last
                ? JSON.parse(last).map(row => row.lastVisit) : null;
            if (ranked) {
                assert.ok(ranked.every(date => date === null || /^\d{4}-\d{2}-\d{2}$/.test(date)));
                assert.deepEqual(ranked, [...ranked].sort((a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b.localeCompare(a)));
            }
            results[name] = {
                count, concurrency, warmup, errors: count - samples.length, failures,
                requestsPerSecond: count * 1000 / batchMs,
                p50Ms: samples[Math.ceil(samples.length * 0.5) - 1],
                minMs: samples[0], maxMs: samples.at(-1),
                ...(samples.length < 20 ? {} : { p95Ms: samples[Math.ceil(samples.length * 0.95) - 1] }),
                sqlMsPerRequest: (after.ms - before.ms) / count,
                sqlCallsPerRequest: (after.calls - before.calls) / count,
                sharedBlocksPerRequest: (hits + reads) / count,
                sharedReadsPerRequest: reads / count,
                bytes: Buffer.byteLength(last || ''),
                ...(ranked ? { rows: ranked.length, rankDatesSha256: digest(JSON.stringify(ranked)) }
                    : { sha256: digest(last || '') })
            };
        }
        let parity;
        if (process.env.BENCHMARK_PARITY === '1') {
            const paths = [
                '/api/customers?limit=50&page=2',
                '/api/customers?limit=10&minVisits=5&maxVisits=12&sortBy=total_bookings',
                '/api/customers?limit=10&dateFrom=2026-09-01&dateTo=2026-10-01&sortBy=last_visit',
                '/api/customers?limit=10&sortBy=next_booking',
                '/api/customers?limit=10&businessContext=dar',
                '/api/customers/search?q=x',
                '/api/customers/search?q=Nonexistent%20Fixture',
                '/api/customers/search?q=Bench%20Child%202347',
                '/api/customers/search?q=%2B999%20000-02347'
            ];
            parity = {};
            for (const path of paths) {
                const response = await fetch(new URL(path, base), {
                    headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
                    redirect: 'error', signal: AbortSignal.timeout(90000)
                });
                assert.equal(response.status, 200, path);
                parity[path] = digest(await response.text());
            }
            const unauthorized = await fetch(new URL(scenarios.customerSearch, base));
            assert.equal(unauthorized.status, 401);
            await unauthorized.arrayBuffer();
            parity.unauthorized = unauthorized.status;
        }
        console.log(JSON.stringify(parity ? { ...results, parity } : results, null, 2));
        assert.ok(Object.values(results).every(result => result.errors === 0));
    } finally {
        await pool.end();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
