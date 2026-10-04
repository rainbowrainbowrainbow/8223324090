'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const root = path.resolve('output/education-ready/04');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const checks = []; let finalPath;
async function check(name, action) { await action(); checks.push({ name, status: 'PASS' }); }
async function main() {
    const attempts = fs.readdirSync(root).filter(name => name.startsWith('attempt-')).sort();
    const baseline = attempts.map(name => ({ name, value: read(`${name}/verification.json`) })).find(row => row.value.phase === 'baseline' && row.value.exitCode === 1).value;
    await check('Original F05 FAIL is retained and independently shows45→30', () => {
        assert.equal(baseline.checks.find(row => row.id === 'F05-title-only-duration').status, 'FAIL');
        assert.equal(baseline.proofs.F05.before.duration, 45); assert.equal(baseline.proofs.F05.after.duration, 30);
    });
    finalPath = attempts.at(-1); const final = read(`${finalPath}/verification.json`);
    await check('Full actual-app lifecycle has12 PASS, no omissions, no page errors', () => {
        assert.equal(final.coverage.mode, 'FULL'); assert.equal(final.exitCode, 0); assert.equal(final.checks.length, 12);
        assert.ok(final.checks.every(row => row.status === 'PASS')); assert.deepEqual(final.pageErrors, []);
        assert.equal(final.proofs.F05.after.duration, 45); assert.equal(final.proofs.F05.durationVisible, true);
        assert.equal(final.proofs.lifecycle.after.status, 'cancelled'); assert.equal(final.proofs.lifecycle.after.duration, 45);
        assert.deepEqual(final.proofs.openers, ['today','day','week']); assert.equal(final.proofs.duration.invalidWrites, 0);
        assert.deepEqual(final.proofs.fieldEdits.map(row => row.changed), ['teacherId','groupId','room','time']);
        assert.equal(final.proofs.catalog.after.duration, 60); assert.equal(final.proofs.dateContract.after.duration, final.proofs.dateContract.before.duration);
        assert.ok(final.proofs.nonEducation.existingZeroDurationRejectionRetained);
        assert.ok(final.proofs.editReadiness.actualResponseHeld && final.proofs.editReadiness.busyAndInert);
        assert.equal(final.proofs.editReadiness.after.time, '12:00');
    });
    await check('Executed disposable runners preserve manual data and clean only their schema', () => {
        const runs = fs.readdirSync(root).filter(name => /^runner-/.test(name)).sort().map(read);
        for (const run of runs) { assert.equal(run.manualDatasetPreserved.status, 'PASS'); assert.equal(run.manualDatasetPreserved.ownedBookingCount, 39); assert.equal(run.disposableTablesAfterCleanup, 0); }
        for (const suite of ['groups','series','acceptance']) { const latest = runs.filter(row => row.suite === suite).at(-1); assert.ok(latest, suite); assert.equal(latest.status, 'PASS'); assert.equal(latest.exitCode, 0); }
    });
    await check('Backend calendar/DST/barrier/conflict suite is17/17 with no skips', () => {
        const log = fs.readFileSync(path.resolve('output/education-ready/04-series-fixture-confirmed.log'), 'utf8');
        assert.match(log, /# tests 17/); assert.match(log, /# pass 17/); assert.match(log, /# fail 0/); assert.match(log, /# skipped 0/);
        for (const name of ['fixed calendar series','controlled DB barriers','invalid education duration','same teacher in different businesses']) assert.ok(log.includes(`ok ${name}`) || log.includes(name));
    });
    await check('Targeted regressions and general gate have actual passing logs', () => {
        const log = fs.readFileSync(path.resolve('output/education-ready/04-targeted-final.log'), 'utf8'); assert.match(log, /# pass 162/); assert.match(log, /# fail 0/);
        const gate = read('npm-test-result.json'); assert.equal(gate.exitCode, 0);
        const generalPath = path.resolve('output/education-ready/04-npm-test-final.log');
        assert.ok(Date.parse(gate.completedAt) + 5000 >= fs.statSync(generalPath).mtimeMs, 'Gate result predates the current log');
        const general = fs.readFileSync(generalPath, 'utf8'); assert.match(general, /Passed:\s*1327/); assert.match(general, /Failed:\s*0/); assert.ok(!general.includes('not ok '));
    });
    await check('Retained real preview shows45 minutes and3 cabinets without writes', async () => {
        const proof = read('preview-readonly/verification.json'); assert.equal(proof.status, 'PASS'); assert.equal(proof.duration, 45); assert.equal(proof.cabinetOptions, 3); assert.ok(proof.retainedDatasetUnchanged);
        const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DATABASES.demo, ssl: false });
        try { const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value); assert.deepEqual(await preflight(pool, manifest), proof.preflight); }
        finally { await pool.end(); }
        assert.equal((await fetch('http://127.0.0.1:3012/api/health')).status, 200);
    });
    await check('Production evidence remains read-only and undeployed', () => {
        const live = read('live-readonly.json'); assert.equal(live.status, 'READONLY_OBSERVATION_COMPLETE'); assert.ok(live.profileAndCabinetUnchanged); assert.deepEqual(live.pageErrors, []);
        assert.ok(live.blockedWrites.some(row => row.path === '/api/wallet/daily-login'));
    });
    await check('Scope and protected contract remain bounded', () => {
        const changed = execFileSync('git', ['diff','--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/);
        const product = changed.filter(file => !file.startsWith('tests/'));
        assert.deepEqual(product.sort(), ['index.html','js/booking.js','js/education-groups.js','routes/bookings.js','routes/education-groups.js','services/educationGroups.js'].sort());
        const protectedCheck = execFileSync(process.execPath, ['scripts/check-timeline-protected-surface.js'], { encoding: 'utf8' }); assert.ok(protectedCheck.includes('passed'));
    });
    fs.writeFileSync(path.join(root, 'verification-summary.json'), JSON.stringify({ status: 'PASS', generatedAt: new Date().toISOString(), finalPath, checks,
        evidenceLevels: { fullBrowserSuiteChecks: 12, visibleUiScenarios: 8, apiWithUiReload: 1, nonEducationApi: 1, fixtureAndPageErrorChecks: 2, backendTests: 17, targetedMixedTests: 162 }, limits: ['Date edit is full-PUT API contract plus UI reload, not UI date editing','General test counts are not education journeys','No commit/push/deploy'] }, null, 2));
    console.log(`Lifecycle evidence consistency PASS: ${checks.length} checks`);
}
main().catch(error => { console.error(`Lifecycle evidence consistency FAIL: ${error.message}`); process.exitCode = 1; });
