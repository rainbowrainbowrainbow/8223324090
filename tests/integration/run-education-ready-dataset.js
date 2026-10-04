'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');
const out = path.resolve('output/education-ready/02');
const evidence = { startedAt: new Date().toISOString(), status: 'NOT RUN' };
async function manualProof() {
    const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DATABASES.demo, ssl: false });
    try {
        const marker = (await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value;
        const manifest = JSON.parse(marker);
        const ownedBookingCount = (await pool.query('SELECT count(*)::int n FROM bookings WHERE id=ANY($1::text[])',
            [[...Object.values(manifest.ids.bookings), manifest.ids.controlBooking]])).rows[0].n;
        return { owner: manifest.owner, hash: manifest.hash, anchorDate: manifest.anchorDate, ownedBookingCount, marker,
            preflight: await preflight(pool, manifest) };
    } finally { await pool.end(); }
}
(async () => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(database.databaseName, DATABASES.fixed); assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.url.port, '55469');
    const before = await manualProof();
    const lock = await acquireIsolatedDatabaseLock(database);
    Object.assign(process.env, { EDU_READY_MODE: 'fixed', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION',
        PGHOST: '127.0.0.1', PGPORT: '55469', PGDATABASE: DATABASES.fixed, BACKUP_OUTBOUND_HOLD: 'true',
        NODE_OPTIONS: `--require="${path.resolve('scripts/lib/education-ready-loopback.js').replace(/\\/g, '/')}"` });
    try { await runSuite(database, 'tests/browser/education-ready-dataset-browser.js', 'education-ready-dataset'); evidence.status = 'PASS'; }
    finally {
        try {
            const after = await manualProof(); assert.deepEqual(after, before, 'Disposable cleanup changed retained manual dataset');
            evidence.manualDatasetPreserved = { status: 'PASS', hash: after.hash, ownedBookingCount: after.ownedBookingCount };
            const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DATABASES.fixed, ssl: false });
            try { evidence.disposableTablesAfterCleanup = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
                assert.equal(evidence.disposableTablesAfterCleanup, 0); }
            finally { await pool.end(); }
        } finally { await lock.release(); }
    }
})().catch(error => { evidence.status = 'FAIL_OR_BLOCKED'; evidence.errorType = error.name;
    console.error('Dataset checks contain FAIL/BLOCKED; see output/education-ready/02/fixed/verification.json'); process.exitCode = 1; })
    .finally(() => { fs.mkdirSync(out, { recursive: true }); evidence.exitCode = process.exitCode || 0;
        fs.writeFileSync(path.join(out, 'fixed-runner-result.json'), JSON.stringify(evidence, null, 2)); });
