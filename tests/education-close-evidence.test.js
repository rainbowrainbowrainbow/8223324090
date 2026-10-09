'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inventory, hash, validateAttempt, validateMatrix, requiredMatrix, parseTap } = require('./helpers/education-close-evidence');
const { createResults, FixtureBlocked } = require('./helpers/education-ready-results');
const contract = { suite: 'journey', requiredIds: ['child-visible-ui', 'save-visible-ui'], classification: 'ONE_CONTINUOUS_VISIBLE_UI_JOURNEY' };
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'education-evidence-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'js')); fs.writeFileSync(path.join(root, 'js/app.js'), 'original source');
    fs.mkdirSync(path.join(root, 'tests')); fs.writeFileSync(path.join(root, 'tests/harness.js'), 'original harness');
    const attemptId = 'attempt-negative-contract', directory = path.join(root, 'output', attemptId); fs.mkdirSync(directory,{recursive:true});
    const proof = { suite: 'journey', attemptId, exitCode: 0, pageErrors: [], checks: contract.requiredIds.map(id => ({ id, status: 'PASS' })) };
    const record = { schema: 'education-evidence-v2', suite: 'journey', attemptId, startedAt: '2026-10-07T00:00:00Z', finishedAt: '2026-10-07T00:00:01Z', status: 'PASS', exitCode: 0, ...inventory(root), proof: 'verification.json', log: 'run.log' };
    function bind() {
        fs.writeFileSync(path.join(directory, record.proof), JSON.stringify(proof)); record.proofHash = hash(path.join(directory, record.proof));
        fs.writeFileSync(path.join(directory, record.log), `execution\nEDUCATION_EVIDENCE_COMPLETE ${attemptId} journey ${record.proofHash}\n`); record.logHash = hash(path.join(directory, record.log));
    }
    bind(); return { root, directory, proof, record, bind, verify: () => validateAttempt(record, directory, contract, root) };
}
test('exact complete attempt passes', t => assert.equal(fixture(t).verify().status, 'PASS'));
for (const [name, mutate, message] of [
    ['blocked suite with passing rows', f => { f.proof.status='BLOCKED_FIXTURE';f.bind(); }, /Blocked.NOT RUN/],
    ['NOT RUN suite with passing rows', f => { f.proof.status='NOT RUN';f.bind(); }, /Blocked.NOT RUN/],
    ['hidden suite skip', f => { f.proof.skips=['required'];f.bind(); }, /Skipped.blocked/],
    ['duplicate required ID', f => { f.proof.checks.push({...f.proof.checks[0]});f.bind(); }, /Duplicate/],
    ['empty exit0 suite', f => { f.proof.checks = []; f.bind(); }, /Empty suite/],
    ['missing required child UI', f => { f.proof.checks.pop(); f.bind(); }, /Missing required/],
    ['new source directory', f => {fs.mkdirSync(path.join(f.root,'new-feature'));fs.writeFileSync(path.join(f.root,'new-feature/app.js'),'new');}, /Stale source/],
    ['added source file', f => fs.writeFileSync(path.join(f.root, 'js/new.js'), 'new'), /Stale source/],
    ['added harness file', f => fs.writeFileSync(path.join(f.root, 'tests/new.js'), 'new'), /Stale harness/],
    ['changed harness', f => fs.writeFileSync(path.join(f.root, 'tests/harness.js'), 'changed'), /Stale harness/],
    ['stale log', f => fs.appendFileSync(path.join(f.directory, 'run.log'), 'other attempt'), /Stale log/],
    ['blocked fixture', f => { f.proof.checks[0].status = 'BLOCKED_FIXTURE'; f.bind(); }, /BLOCKED_FIXTURE/],
    ['NOT RUN', f => { f.proof.checks[0].status = 'NOT RUN'; f.bind(); }, /NOT RUN/],
    ['hidden skip', f => { f.proof.checks[0].skip = true; f.bind(); }, /Skipped/],
    ['wrong attempt', f => { f.proof.attemptId = 'attempt-other'; f.bind(); }, /another attempt/],
    ['stale proof', f => fs.appendFileSync(path.join(f.directory, 'verification.json'), ' '), /Stale proof/],
    ['exit0 log without execution marker', f => { fs.writeFileSync(path.join(f.directory, 'run.log'), 'exit0'); f.record.logHash = hash(path.join(f.directory, 'run.log')); }, /completion marker/]
]) test(name + ' fails closed', t => { const f = fixture(t); mutate(f); assert.throws(f.verify, message); });
test('failed UI followed by successful API cannot repair journey', async t => {
    const f = fixture(t), results = createResults();
    await results.check('child-visible-ui', 'UI create child', () => { throw new Error('UI failed'); });
    await results.check('api-write', 'Independent successful API write', () => ({ status: 201 }));
    await results.check('save-visible-ui', 'Remaining UI', () => {}, { dependsOn: ['child-visible-ui'] });
    f.proof.checks = results.results; f.proof.exitCode = results.exitCode(); f.bind();
    assert.equal(f.proof.exitCode, 1); assert.throws(f.verify, /Proof exit code/);
});
test('validator CLI missing/empty evidence returns exit1', t => {
    const f = fixture(t); fs.writeFileSync(path.join(f.directory, 'record.json'), JSON.stringify({ ...f.record, suite: 'unknown' }));
    const child = spawnSync(process.execPath, ['tests/tools/verify-education-close-attempt.js', f.directory], { encoding: 'utf8' });
    assert.equal(child.status, 1); assert.match(child.stderr, /Unknown required suite/);
});

test('empty or missing mandatory matrix cannot PASS',()=>{
    assert.throws(()=>validateMatrix({schema:'education-matrix-v2',attempts:{}},process.cwd(),{}),/Incomplete mandatory matrix/);
    const attempts=Object.fromEntries(requiredMatrix.slice(1).map(id=>[id,{}]));
    assert.throws(()=>validateMatrix({schema:'education-matrix-v2',attempts},process.cwd(),{}),/Incomplete mandatory matrix/);
});

test('TAP exit0 without executed required scenarios cannot PASS',()=>{
    const c={requiredIds:['required-api-scenario']};
    const good='ok 1 - required-api-scenario\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
    assert.equal(parseTap(good,c).tapCounts.tests,1);
    assert.throws(()=>parseTap('',c),/Empty TAP/);
    assert.throws(()=>parseTap(good.replace('required-api-scenario','other'),c),/Missing required TAP/);
    assert.throws(()=>parseTap(good.replace('# skipped 0','# skipped 1'),c),/Nonzero TAP skipped/);
    assert.throws(()=>parseTap(good.replace('# pass 1','# pass 0'),c),/Incomplete TAP/);
});

