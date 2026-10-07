'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');
const stage = ['07', '08A', '08B', '08'].includes(process.env.EDU_READY_STAGE) ? process.env.EDU_READY_STAGE : '06';
const out = path.resolve(process.env.EDU_READY_RUN_ROOT || `output/education-ready/${stage}`, 'regressions');
assert.ok(out.startsWith(path.resolve('output/education-ready') + path.sep), 'Evidence must remain in education output');
const evidence = { startedAt: new Date().toISOString(), status: 'NOT RUN', stage,
    engine: process.env.EDU_MOBILE_ENGINE || 'chromium', phoneWrites: process.env.EDU_READY_PHONE === 'true' };
const suites = {
    editor: 'tests/browser/education-ready-editor-readonly.js',
    journey: 'tests/browser/education-ready-final-journey.js',
    date: 'tests/browser/education-ready-date-browser.js',
    teachers: 'tests/browser/education-ready-teachers-browser.js',
    mobile: 'tests/browser/education-ready-mobile-browser.js',
    visual: 'tests/browser/education-ready-visual-preview-readonly.js',
    async: 'tests/browser/education-ready-async-browser.js',
    groups: 'tests/browser/education-ready-groups-browser.js',
    lifecycle: 'tests/browser/education-ready-lifecycle-browser.js',
    attendance: 'tests/integration/education-ready-attendance.integration.test.js',
    navigation: 'tests/browser/education-navigation-actual-app-browser-smoke.js',
    series: 'tests/integration/education-series.integration.test.js',
    acceptance: 'tests/integration/education-series.integration-acceptance.test.js',
    submit: 'tests/browser/education-group-submit-actual-app-browser-smoke.js',
    context: 'tests/browser/education-context-actual-app-browser-smoke.js'
};
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
    const suite = process.env.EDU_READY_SUITE || 'async';
    assert.ok(Object.hasOwn(suites, suite), 'Unknown async suite'); evidence.suite = suite;
    if (suite === 'visual') process.env.EDU_VISUAL_PHASE ||= 'after';
    const lock = await acquireIsolatedDatabaseLock(database);
    Object.assign(process.env, { EDU_READY_MODE: 'fixed', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true', EDU_READY_OUTPUT: path.join(out, suite),
        PGHOST: '127.0.0.1', PGPORT: '55469', PGDATABASE: DATABASES.fixed, BACKUP_OUTBOUND_HOLD: 'true',
        EDU_NAVIGATION_OUTPUT: path.join(out, 'navigation'),
        EDU_ACCEPTANCE_OUTPUT: ['08B', '08'].includes(stage)
            ? path.join(out, 'acceptance', `attempt-${evidence.startedAt.replace(/[:.]/g, '-')}`)
            : path.join(out, 'acceptance'),
        EDU_READY_REPORT_NOW: '2026-10-03T09:00:00Z',
        NODE_OPTIONS: ['scripts/lib/education-ready-loopback.js','tests/helpers/education-ready-report-clock.js']
            .map(file => `--require="${path.resolve(file).replace(/\\/g, '/')}"`).join(' ') });
    try { await runSuite(database, suites[suite], `education-ready-${suite}`); evidence.status = 'PASS'; }
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
    console.error(`Education checks contain FAIL/BLOCKED; see output/education-ready/${stage}/**/verification.json`); process.exitCode = 1; })
    .finally(() => { fs.mkdirSync(out, { recursive: true }); evidence.exitCode = process.exitCode || 0;
        const text = JSON.stringify(evidence, null, 2);
        fs.writeFileSync(path.join(out, 'fixed-runner-result.json'), text);
        fs.writeFileSync(path.join(out, `runner-${evidence.suite || 'blocked'}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`), text); });


