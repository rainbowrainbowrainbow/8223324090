'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { execFileSync } = require('node:child_process');
const { DATABASES, FIXED_ANCHOR, OWNER, preflight, kyivDate } = require('../../scripts/lib/education-ready-dataset');
const root = path.resolve('output/education-ready/02');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
const checks = [];
async function verify(name, action) { await action(); checks.push({ name, status: 'PASS' }); }
async function main() {
    const demo = read('demo/verification.json'), fixed = read('fixed/verification.json');
    const manifest = read('demo-manifest.json'), fixedManifest = read('fixed/manifest.json');
    await verify('Both suites preserve product UI failures with nonzero exit and independent fixture PASS', () => {
        for (const run of [demo, fixed]) {
            assert.equal(run.checks.length, 14); assert.equal(run.exitCode, 1);
            const byId = Object.fromEntries(run.checks.map(item => [item.id, item.status]));
            for (const id of ['fixtures', 'idempotency', 'reports-api', 'report-fixed-clock-contract', 'journal-history',
                'isolation-api', 'series-api', 'groups-ui', 'journal-ui', 'report-button-ui', 'page-errors']) assert.equal(byId[id], 'PASS');
            assert.equal(byId['teacher-source-ui'], 'FAIL'); assert.equal(byId['report-direct-ui'], 'FAIL');
            assert.equal(run.teacherSource.status, 403); assert.equal(run.teacherSource.sqlActiveCount, 4);
        }
    });
    await verify('Manual anchor is Kyiv date at initial load; fixed anchor and primary counts agree', () => {
        assert.equal(manifest.anchorDate, kyivDate(new Date(manifest.seededAt)));
        assert.equal(fixedManifest.anchorDate, FIXED_ANCHOR);
        for (const run of [demo, fixed]) assert.deepEqual(run.preflight.primary,
            { teachers: 4, groups: 6, children: 24, representatives: 12, cabinets: 3, lessons: 36 });
        for (const data of [manifest, fixedManifest]) {
            assert.equal(data.owner, OWNER);
            for (const group of Object.values(data.ids).filter(value => Array.isArray(value)))
                assert.equal(new Set(group).size, group.length);
        }
    });
    await verify('Fixture specification, SQL totals and HTTP reports agree independently', () => {
        const expected = { held: 18, cancelled: 2, scheduled: 0, journalsNotStarted: 5, present: 38, absent: 13, excused: 9, unmarked: 18 };
        for (const run of [demo, fixed]) {
            assert.deepEqual(run.preflight.sqlHistoricalSummary, expected);
            assert.deepEqual(run.apiReports['dar:all'], expected);
            assert.equal(run.preflight.relationshipViolations, 0); assert.equal(run.preflight.reachableContacts, 0);
        }
    });
    await verify('Actual disposable cleanup retains complete manual dataset', async () => {
        const runner = read('fixed-runner-result.json');
        assert.equal(runner.exitCode, 1); assert.equal(runner.disposableTablesAfterCleanup, 0);
        assert.equal(runner.manualDatasetPreserved.status, 'PASS'); assert.equal(runner.manualDatasetPreserved.ownedBookingCount, 39);
        const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DATABASES.demo, ssl: false });
        try { assert.equal((await preflight(pool, manifest)).status, 'PASS'); }
        finally { await pool.end(); }
    });
    await verify('Preview is healthy and belongs to the exact retained environment', async () => {
        const preview = read('preview.json'); assert.equal(preview.owner, OWNER); assert.equal(preview.database, DATABASES.demo);
        assert.equal(preview.postgresPort, 55469); assert.equal(preview.outbound, 'BLOCKED');
        const response = await fetch('http://127.0.0.1:3012/api/health', { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200); assert.equal((await response.json()).database, 'connected');
    });
    await verify('Tracked product, dependency and protected files retain the EDU-READY-01 diff boundary', () => {
        const changed = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
        assert.deepEqual(changed.sort(), ['tests/browser/education-context-actual-app-browser-smoke.js',
            'tests/browser/education-group-submit-actual-app-browser-smoke.js', 'tests/browser/education-navigation-actual-app-browser-smoke.js'].sort());
    });
    await verify('Six synthetic screenshot types exist; metadata has no credential/token payloads', () => {
        for (const name of ['today.png', 'full-group.png', 'archive-group.png', 'journal-history.png', 'report-direct-failed.png', 'historical-report.png'])
            assert.ok(fs.existsSync(path.join(root, 'demo', name)));
        for (const name of ['demo/verification.json', 'fixed/verification.json', 'demo-manifest.json', 'fixed/manifest.json', 'preview.json']) {
            const text = fs.readFileSync(path.join(root, name), 'utf8');
            assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]+|postgres(?:ql)?:\/\//);
        }
    });
    const statuses = run => run.checks.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {});
    fs.writeFileSync(path.join(root, 'verification-summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks,
        demo: statuses(demo), fixed: statuses(fixed), note: 'Evidence consistency PASS is not product readiness PASS; original attempts are retained.',
        operatorObservedChecks: { runtime: 'Node22.23.1/npm10.9.8 PASS', targetedUnit: '30/30 PASS', syntaxFiles: 1410,
            protectedSurface: 'PASS', noCiCommitPushDeploy: true } }, null, 2));
    console.log(`Dataset evidence consistency: ${checks.length} PASS; demo ${JSON.stringify(statuses(demo))}; fixed ${JSON.stringify(statuses(fixed))}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
