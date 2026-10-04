'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const root = path.resolve('output/education-ready/03');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const checks = [];
async function check(name, action) { await action(); checks.push({ name, status: 'PASS' }); }
async function main() {
    const attempts = fs.readdirSync(root).filter(name => name.startsWith('attempt-')).sort();
    const baseline = read('attempt-2026-10-03T18-22-00-564Z/verification.json');
    const finalPath = attempts.at(-1), final = read(`${finalPath}/verification.json`);
    await check('Original UI/API/SQL defects remain preserved as FAIL', () => {
        assert.equal(baseline.phase, 'baseline'); assert.equal(baseline.exitCode, 1);
        for (const id of ['F01-pending-selection', 'F02-teacher-retention-on-failure']) assert.equal(baseline.checks.find(row => row.id === id).status, 'FAIL');
        assert.notDeepEqual(baseline.proofs.F01.before, baseline.proofs.F01.after);
        assert.notEqual(baseline.proofs.F02.before.teacher_id, null); assert.equal(baseline.proofs.F02.after.teacher_id, null);
    });
    await check('Complete groups acceptance includes 15 passed checks and no page errors', () => {
        assert.equal(final.phase, 'postfix'); assert.equal(final.exitCode, 0); assert.equal(final.checks.length, 15);
        assert.ok(final.checks.every(row => row.status === 'PASS')); assert.deepEqual(final.pageErrors, []);
        assert.deepEqual(final.proofs.F01.after, final.proofs.F01.before);
        assert.equal(final.proofs.F02.before.teacher_id, final.proofs.F02.after.teacher_id);
        assert.equal(final.proofs.F02.apiTeacher, final.proofs.F02.before.teacher_id);
        assert.ok(final.proofs.lateActions.selectedBUnchanged && final.proofs.lessonTeacher.assignedPreserved);
        assert.ok(final.proofs.inactiveTeacher.preservedUiRename && final.proofs.inactiveTeacher.omittedApiFieldPreserved);
        assert.equal(final.proofs.teacherSource.legacyStaffStatus, 403); assert.ok(final.proofs.teacherSource.foreignTeacherExcluded);
        assert.ok(final.proofs.teacherSource.forgedLessonReferenceExcluded);
        assert.equal(final.proofs.committedCreateRetry.count, 1); assert.ok(final.proofs.committedCreateRetry.identityPreserved);
    });
    await check('All executed disposable runners preserved the manual dataset and cleaned their own schema', () => {
        const runners = fs.readdirSync(root).filter(name => /^runner-(groups|acceptance|submit)-/.test(name)).map(read);
        for (const suite of ['groups', 'acceptance', 'submit']) {
            const run = runners.filter(row => row.suite === suite).at(-1); assert.ok(run, `Missing runner ${suite}`);
            assert.equal(run.status, 'PASS'); assert.equal(run.exitCode, 0);
            assert.equal(run.manualDatasetPreserved.status, 'PASS'); assert.equal(run.manualDatasetPreserved.ownedBookingCount, 39);
            assert.equal(run.disposableTablesAfterCleanup, 0);
        }
    });
    await check('Retained preview is unchanged and its visible teacher selection works', async () => {
        const preview = read('preview-readonly/verification.json'); assert.equal(preview.status, 'PASS');
        assert.equal(preview.teacherCount, 4); assert.equal(preview.retainedDatasetUnchanged, true);
        const pool = new Pool({ host: '127.0.0.1', port: 55469, database: DATABASES.demo, user: 'postgres', ssl: false });
        try {
            const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value);
            assert.deepEqual(await preflight(pool, manifest), preview.preflight);
        } finally { await pool.end(); }
        const response = await fetch('http://127.0.0.1:3012/api/health'); assert.equal(response.status, 200);
    });
    await check('Live evidence remains read-only and is not represented as deployed product success', () => {
        const live = read('live-readonly.json'); assert.equal(live.status, 'READONLY_OBSERVATION_COMPLETE');
        assert.equal(live.profileAndCabinetUnchanged, true); assert.deepEqual(live.pageErrors, []);
        assert.equal(live.identity.commitSha, '56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e');
        assert.equal(live.probes.find(row => row.path === '/api/staff').status, 403);
        assert.ok(live.blockedWrites.some(row => row.path === '/api/wallet/daily-login'));
    });
    await check('Tracked product diff is limited to five education UI/service files', () => {
        const changed = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/);
        assert.deepEqual(changed.filter(file => !file.startsWith('tests/')).sort(), ['index.html', 'js/booking.js', 'js/education-groups.js', 'routes/education-groups.js', 'services/educationGroups.js']);
        execFileSync('git', ['diff', '--check'], { stdio: 'pipe' });
    });
    await check('Reported contract/acceptance/submit counts have actual execution logs', () => {
        const log = name => fs.readFileSync(path.resolve('output/education-ready', name), 'utf8');
        assert.match(log('03-targeted-closure.log'), /# tests 33\r?\n# suites 0\r?\n# pass 33\r?\n# fail 0/);
        assert.match(log('03-acceptance.log'), /# tests 11\r?\n# suites 1\r?\n# pass 11\r?\n# fail 0/);
        assert.match(log('03-submit.log'), /double click, Enter, 403\/409\/500 and retry: PASS/);
        assert.match(log('03-doc-guard.log'), /# tests 5\r?\n# suites 1\r?\n# pass 5\r?\n# fail 0/);
    });
    await check('Final general gate completed with exit0, preserving the initial doc-guard FAIL log', () => {
        const gate = read('npm-test-result.json'); assert.equal(gate.command, 'npm test'); assert.equal(gate.exitCode, 0);
        const initial = fs.readFileSync(path.resolve('output/education-ready/03-npm-test.log'), 'utf8');
        assert.match(initial, /not ok 4 - keeps root markdown limited to current operating docs/);
        const log = fs.readFileSync(path.resolve('output/education-ready/03-npm-test-final.log'), 'utf8');
        assert.match(log, /test:sys-mb/); assert.match(log, /✅ Passed:\s*\d+\s*❌ Failed:\s*0/);
    });
    const summary = { status: 'PASS', generatedAt: new Date().toISOString(), finalPath, checks,
        groupsChecks: { pass: 15, fail: 0 }, targetedContracts: { pass: 33, fail: 0 }, acceptanceTests: { pass: 11, fail: 0 },
        limits: ['General tests are not education scenario counts', 'No commit/push/deploy', 'New unassigned staff/business membership is outside this projection'] };
    fs.writeFileSync(path.join(root, 'verification-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`Groups evidence consistency PASS: ${checks.length} checks`);
}
main().catch(error => { console.error(`Groups evidence consistency FAIL: ${error.message}`); process.exitCode = 1; });
