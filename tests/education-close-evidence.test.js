'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isCancelledWebkitLifecycleFetch } = require('./helpers/education-navigation-errors');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inventory, hash, validateAttempt, validateMatrix, requiredMatrix, parseTap } = require('./helpers/education-close-evidence');
const { createResults, FixtureBlocked } = require('./helpers/education-ready-results');
const { createProgressProof } = require('./helpers/education-progress-proof');
const contract = { suite: 'journey', requiredIds: ['child-visible-ui', 'save-visible-ui'], classification: 'ONE_CONTINUOUS_VISIBLE_UI_JOURNEY' };

test('progress journal preserves every check and the canonical final proof without rewriting it per pass', t => {
    const f = fixture(t);
    const evidence = { ...f.proof, checks: [], status: 'NOT_RUN', detail: { text: 'Український синтетичний графік' } };
    const writer = createProgressProof(f.directory, evidence);
    writer.checkpoint();
    const initial = fs.readFileSync(path.join(f.directory, 'verification.json'), 'utf8');
    for (const row of f.proof.checks) {
        evidence.checks.push(row); writer.recordCheck(row);
    }
    assert.equal(fs.readFileSync(path.join(f.directory, 'verification.json'), 'utf8'), initial);
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'checks.ndjson'), 'utf8').trim().split('\n').map(JSON.parse), f.proof.checks);
    evidence.status = 'PASS'; writer.checkpoint();
    assert.equal(fs.readFileSync(path.join(f.directory, 'verification.json'), 'utf8'), JSON.stringify(evidence, null, 2));
    assert.equal(writer.metrics().snapshots, 2);
    assert.equal(writer.metrics().journalRows, contract.requiredIds.length);
});

test('a failed check immediately checkpoints diagnostic state and remains a failed canonical proof', t => {
    const f = fixture(t), evidence = { ...f.proof, status: 'FAIL', checks: [{ id: 'child-visible-ui', status: 'FAIL', error: 'synthetic focus failure' }] };
    const writer = createProgressProof(f.directory, evidence);
    writer.recordCheck(evidence.checks[0]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory, 'verification.json'), 'utf8')), evidence);
    assert.equal(writer.metrics().snapshots, 1);
    assert.throws(() => createProgressProof(f.directory, evidence), { code: 'EEXIST' });
});

test('partial check journals cannot make an interrupted attempt satisfy the evidence validator', t => {
    const f = fixture(t), evidence = { ...f.proof, status: 'NOT_RUN', checks: [] };
    const writer = createProgressProof(f.directory, evidence);
    writer.checkpoint();
    for (const row of f.proof.checks) { evidence.checks.push(row); writer.recordCheck(row); }
    f.record.proofHash = hash(path.join(f.directory, f.record.proof));
    fs.writeFileSync(path.join(f.directory, f.record.log), `EDUCATION_EVIDENCE_COMPLETE ${f.record.attemptId} journey ${f.record.proofHash}\n`);
    f.record.logHash = hash(path.join(f.directory, f.record.log));
    assert.throws(() => validateAttempt(f.record, f.directory, contract, f.root));
});

test('journal and checkpoint write failures propagate instead of becoming a successful check', t => {
    const f = fixture(t), evidence = { ...f.proof, status: 'NOT_RUN' };
    const diskError = Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
    const writer = createProgressProof(f.directory, evidence, { ...fs, appendFileSync() { throw diskError; } });
    assert.throws(() => writer.recordCheck(evidence.checks[0]), { code: 'ENOSPC' });
    assert.equal(writer.metrics().journalRows, 0);
    const other = path.join(f.directory, 'checkpoint-failure'); fs.mkdirSync(other);
    let writes = 0;
    const broken = createProgressProof(other, evidence, { ...fs, writeFileSync(...args) { if (++writes > 1) throw diskError; return fs.writeFileSync(...args); } });
    assert.throws(() => broken.checkpoint(), { code: 'ENOSPC' });
    assert.equal(broken.metrics().snapshots, 0);
});
test('WebKit navigation or teardown abort requires a local fetch error and a cancelled request', () => {
    const input = {
        engine: 'webkit', base: 'http://127.0.0.1:45225', at: 10000,
        error: { name: 'Fetch API cannot load http', message: '/127.0.0.1:45225/api/lines/2026-10-23 due to access control checks.' },
        transitions: [9800], failures: [{ error: 'Load request cancelled', at: 10100 }]
    };
    assert.equal(isCancelledWebkitLifecycleFetch(input), true);
    assert.equal(isCancelledWebkitLifecycleFetch({ ...input, engine: 'chromium' }), false);
    assert.equal(isCancelledWebkitLifecycleFetch({ ...input, transitions: [] }), false);
    assert.equal(isCancelledWebkitLifecycleFetch({ ...input, failures: [] }), false);
    assert.equal(isCancelledWebkitLifecycleFetch({ ...input, error: { ...input.error, message: '/127.0.0.1:45225/api/lines/2026-10-23 returned 403' } }), false);
    assert.equal(isCancelledWebkitLifecycleFetch({ ...input, error: { ...input.error, message: '/example.com/api/lines due to access control checks.' } }), false);
});
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


const { LEGACY_STAFF_PROBE_QUERY, isExplicitLegacyStaffProbe, classifyLiveFailure } = require('./helpers/education-live-readonly-diagnostics');

function liveDiagnostic(kind, item, stage = 'dar-groups', text = '') {
    const result = { blockedWrites: [], failedChecks: [], diagnostics: [] };
    return { result, diagnostic: classifyLiveFailure(result, stage, kind, item, text) };
}

test('live observer does not whitelist an unmarked UI staff 403', () => {
    for (const kind of ['http', 'console']) {
        const { diagnostic } = liveDiagnostic(kind, { method: 'GET', path: '/api/staff', status: 403 });
        assert.equal(diagnostic.classification, 'UNCLASSIFIED_FAILURE');
    }
});

test('legacy access probe marker is bound to the exact origin and staff endpoint', () => {
    const origin = 'https://owned-preview.invalid';
    assert.equal(isExplicitLegacyStaffProbe(new URL(origin + '/api/staff?active=true&' + LEGACY_STAFF_PROBE_QUERY), origin), true);
    for (const route of [origin + '/api/staff?active=true', origin + '/api/staff?educationQaProbe=other',
        origin + '/api/education/teachers?' + LEGACY_STAFF_PROBE_QUERY, 'https://foreign.invalid/api/staff?' + LEGACY_STAFF_PROBE_QUERY]) {
        assert.equal(isExplicitLegacyStaffProbe(new URL(route), origin), false);
    }
    assert.equal(isExplicitLegacyStaffProbe(undefined, origin), false);
});

test('only the explicit GET probe denial in its intended stage is expected', () => {
    const marked = { method: 'GET', path: '/api/staff', status: 403, explicitLegacyStaffProbe: true };
    for (const kind of ['http', 'console']) assert.equal(liveDiagnostic(kind, marked).diagnostic.classification, 'EXPECTED_ACCESS_DENIAL');
    for (const [item, stage] of [[{ ...marked, method: 'POST' }, 'dar-groups'], [{ ...marked, status: 500 }, 'dar-groups'],
        [marked, 'park-schedule'], [{ ...marked, path: '/api/education/teachers' }, 'dar-groups']]) {
        assert.equal(liveDiagnostic('http', item, stage).diagnostic.classification, 'UNCLASSIFIED_FAILURE');
    }
});

test('mandatory rate-limited reads remain FAIL even if a probe marker is present', () => {
    const { result, diagnostic } = liveDiagnostic('http', { method: 'GET', path: '/api/staff', status: 429,
        retryAfterSeconds: 60, explicitLegacyStaffProbe: true });
    assert.equal(diagnostic.classification, 'SERVER_RATE_LIMIT_REJECTION');
    assert.equal(result.failedChecks.length, 1);
    assert.equal(result.failedChecks[0].status, 'FAIL');
    assert.equal(result.failedChecks[0].retryAfterSeconds, 60);
});

test('unexpected education HTTP errors remain unclassified failures', () => {
    for (const status of [401, 403, 500, 503]) assert.equal(liveDiagnostic('http', {
        method: 'GET', path: '/api/education/reports', status }).diagnostic.classification, 'UNCLASSIFIED_FAILURE');
});

test('outbound and socket holds are classified without a synchronization claim', () => {
    const outbound = liveDiagnostic('request', { path: '/provider', external: true }).diagnostic;
    assert.equal(outbound.classification, 'POLICY_OUTBOUND_HOLD');
    assert.match(outbound.impact, /Not production failure or sync proof/);
    const socket = liveDiagnostic('console', { path: '/socket' }, 'dar-groups', 'WebSocket reconnect disabled').diagnostic;
    assert.equal(socket.classification, 'POLICY_SOCKET_HOLD');
    assert.equal(socket.impact, 'No live synchronization claim');
});
