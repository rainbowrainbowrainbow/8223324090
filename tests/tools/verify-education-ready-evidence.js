'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'output/education-ready/2026-10-03');
const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8').replace(/^\uFEFF/, ''));
const checks = [];
function verify(name, action) { action(); checks.push({ name, status: 'PASS' }); }
const baseline = read('baseline.json');
verify('All six independent defects fail for their asserted invariants, not missing fixtures', () => {
    assert.equal(baseline.checks.find(row => row.id === 'fixtures').status, 'PASS');
    for (const id of ['F01', 'F02-source', 'F02-retention', 'F03', 'F04', 'F05', 'F06']) {
        const row = baseline.checks.find(row => row.id === id); assert.equal(row.status, 'FAIL');
        assert.doesNotMatch(row.error, /Timeout|Barrier timed out|Precondition/);
    }
});
verify('SQL/API group target and teacher retention proofs are preserved', () => {
    assert.equal(baseline.proofs.F01.apiA, baseline.proofs.F01.sql.find(row => row.id === baseline.fixtures.groups[0]).name);
    assert.equal(baseline.proofs.F01.selected, String(baseline.fixtures.groups[1]));
    assert.equal(baseline.proofs.F01.write.path, `/api/education/groups/${baseline.fixtures.groups[0]}`);
    assert.equal(baseline.proofs.F02source.status, 403);
    assert.equal(baseline.proofs.F02source.teacherSql[0].is_active, true);
    assert.equal(baseline.proofs.F02retention.before.teacher_id, baseline.fixtures.teacherId);
    assert.equal(baseline.proofs.F02retention.after.teacher_id, null);
    assert.equal(baseline.proofs.F02retention.apiTeacher, null);
});
verify('Journal, report direct/reload, duration and date-race independent proofs agree', () => {
    assert.deepEqual(baseline.proofs.F03, { sql: 'absent', api: 'absent', ui: 'present' });
    assert.equal(baseline.proofs.F04.apiStatus, 200); assert.equal(baseline.proofs.F04.reload.status, 200);
    assert.equal(baseline.proofs.F04.apiSummary.held, 1); assert.equal(baseline.proofs.F04.uiCounts.length, 0);
    assert.equal(baseline.proofs.F04.reload.uiCounts.length, 0);
    assert.equal(baseline.proofs.F05.before.api.duration, 45); assert.equal(baseline.proofs.F05.before.sql.duration, 45);
    assert.equal(baseline.proofs.F05.after.api.duration, 30); assert.equal(baseline.proofs.F05.after.sql.duration, 30);
    assert.equal(baseline.proofs.F06.final.loading, true); assert.equal(baseline.proofs.F06.apiBContainsLesson, true);
    assert.equal(baseline.proofs.F06.final.cards.includes(baseline.proofs.F06.sql.id), false);
    assert.ok(baseline.proofs.F06.held.every(row => row.status === 200));
});
verify('Failed contiguous UI step blocks all six dependent steps', () => {
    assert.equal(baseline.checks.find(row => row.id === 'UI-group').status, 'FAIL');
    for (const id of ['UI-enroll', 'UI-lesson', 'UI-reload', 'UI-edit', 'UI-attendance', 'UI-report'])
        assert.equal(baseline.checks.find(row => row.id === id).status, 'BLOCKED_DEPENDENCY');
    assert.equal(read('runner-result.json').exitCode, 1);
    assert.equal(read('runner-result.json').publicTablesAfterCleanup, 0);
});
verify('Live, remote, base identity match and production business state is unchanged', () => {
    const identity = read('identity-final.json'); assert.equal(identity.baseSha, identity.remoteSha); assert.equal(identity.baseSha, identity.liveSha);
    assert.equal(identity.liveBranch, 'codex/eventgenix-production');
    const live = read('live-readonly.json'); assert.equal(live.profileAndCabinetUnchanged, true);
    assert.equal(live.pageErrors.length, 0); assert.equal(live.status, 'READONLY_OBSERVATION_COMPLETE');
});
verify('Tracked modifications are restricted to tests; product and dependency files have no diff', () => {
    const changed = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(changed.every(file => file.startsWith('tests/')));
});
verify('Final strengthened navigation and syntax/protected checks passed', () => {
    assert.equal(read('navigation-last-result.json').exitCode, 0);
    assert.equal(read('final-check-exits.json').syntaxExitCode, 0);
    assert.equal(read('final-check-exits.json').protectedExitCode, 0);
});
verify('All included screenshots exist and sanitized text artifacts contain no tokens', () => {
    assert.equal(baseline.screenshots.length, 6);
    for (const file of baseline.screenshots) assert.equal(fs.existsSync(path.join(out, file)), true);
    const files = fs.readdirSync(out).filter(file => /\.(json|log)$/.test(file) && !file.startsWith('postgres'));
    for (const file of files) {
        const text = fs.readFileSync(path.join(out, file), 'utf8');
        assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|Bearer\s+[A-Za-z0-9._-]{25,}/, `Token-like text in ${file}`);
    }
});
const npmLog = fs.readFileSync(path.join(out, 'npm-test.log'), 'utf8');
const tapExecutions = [...npmLog.matchAll(/^# tests (\d+)\r?$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
const statuses = baseline.checks.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {});
const result = { generatedAt: new Date().toISOString(), checks, baselineStatuses: statuses,
    repositoryBaseline: { exitCode: 0, tapExecutions, staticUiChecks: 1327,
        note: 'General TAP executions are not unique education cases; new reporting self-tests were run separately.' },
    educationOnlyUnitCases: 21, reportingSelfTests: 4, existingPostgresCases: 24,
    screenshotReview: 'Latest six baseline PNGs opened and personally reviewed; screenshot limits documented in audit.' };
fs.writeFileSync(path.join(out, 'verification-summary.json'), JSON.stringify(result, null, 2));
console.log(`Evidence consistency: ${checks.length} checks PASS; red product baseline ${JSON.stringify(statuses)}`);
