'use strict';
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const out = path.resolve('output/education-ready/2026-10-03');
const evidence = { startedAt: new Date().toISOString(), status: 'NOT RUN' };

(async () => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    if (!database.isLocal) throw new Error('Education Ready requires loopback disposable PostgreSQL');
    const lock = await acquireIsolatedDatabaseLock(database);
    evidence.database = { hostname: database.hostname, port: database.url.port, name: database.databaseName, local: database.isLocal };
    try {
        await runSuite(database, 'tests/browser/education-ready-baseline.js', 'education-ready-baseline');
        evidence.status = 'PASS';
    } finally {
        try {
            const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
            try { evidence.publicTablesAfterCleanup = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n; }
            finally { await pool.end(); }
        } finally { await lock.release(); }
    }
})().catch(error => {
    evidence.status = 'FAIL_OR_BLOCKED'; evidence.errorType = error.name;
    console.error('Education Ready baseline failed or was blocked; see output/education-ready/2026-10-03/baseline.json');
    process.exitCode = 1;
}).finally(() => {
    fs.mkdirSync(out, { recursive: true });
    evidence.exitCode = process.exitCode || 0; evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'runner-result.json'), JSON.stringify(evidence, null, 2));
});
