'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getPlan, runShard, verifyCase } = require('../scripts/run-education-ci-shard');
const { requiredMatrix } = require('./helpers/education-close-evidence');
function fixture(t) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-ci-shard-'));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const outputRoot = path.join(cwd, 'output/education-ready/attempt');
    return { cwd, outputRoot, read: () => JSON.parse(fs.readFileSync(path.join(outputRoot, 'shard.json'), 'utf8')) };
}
test('five shards retain all fifteen mandatory pairs and reject missing or duplicated coverage', () => {
    const plan = getPlan(); assert.equal(plan.length, 5);
    assert.deepEqual(plan.flatMap(item => item.pairs).sort(), [...requiredMatrix].sort());
    const invalid = Object.fromEntries(plan.map(item => [item.id, item.pairs]));
    invalid['webkit-flow'] = invalid['webkit-flow'].slice(1);
    assert.throws(() => getPlan(invalid), /mandatory matrix/);
    invalid['webkit-flow'].push('journey/webkit', 'hrLink/webkit');
    assert.throws(() => getPlan(invalid), /mandatory matrix/);
});
test('suites run serially in native processes with separate evidence and no shell', t => {
    const f = fixture(t), calls = [], verified = [];
    assert.equal(runShard('chromium-lifecycle', { ...f, env: { TEST_DATABASE_URL: 'synthetic-only' },
        spawnSyncImpl: (binary, args, options) => {
            assert.equal(binary, process.execPath); assert.equal(options.shell, false);
            assert.equal(options.env.TEST_DATABASE_URL, 'synthetic-only');
            assert.equal(verified.length, calls.length);
            calls.push({ args, directory: options.env.EDU_CLOSE_OUTPUT }); return { status: 0, signal: null };
        }, verifyCaseImpl: (directory, suite, engine) => { verified.push(suite); return suite + '/' + engine + '/record.json'; }
    }), 0);
    assert.deepEqual(calls.map(item => item.args.slice(1)), [['lifecycle', 'chromium'], ['date', 'chromium'], ['async', 'chromium'], ['journal', 'chromium']]);
    assert.equal(new Set(calls.map(item => item.directory)).size, 4);
    assert.equal(f.read().status, 'PASS');
});
for (const [name, failure] of [['exit', { status: 1, signal: null }], ['signal', { status: null, signal: 'SIGTERM' }],
    ['spawn', { status: null, error: new Error('synthetic spawn failure') }]]) {
    test(name + ' failure stops without retry or false later passes', t => {
        const f = fixture(t); let calls = 0;
        assert.equal(runShard('webkit-flow', { ...f, spawnSyncImpl: () => { calls++; return failure; },
            verifyCaseImpl: () => assert.fail('Failed execution cannot be verified') }), 1);
        assert.equal(calls, 1);
        assert.deepEqual(f.read().cases.map(item => item.status), ['FAIL_OR_BLOCKED', 'NOT_RUN']);
    });
}
test('exit zero without proof fails closed and stops the next suite', t => {
    const f = fixture(t); let calls = 0;
    assert.equal(runShard('webkit-flow', { ...f, spawnSyncImpl: () => { calls++; return { status: 0, signal: null }; } }), 1);
    assert.equal(calls, 1); assert.equal(f.read().status, 'FAIL_OR_BLOCKED');
});
test('prior output cannot repair or merge into a fresh attempt', t => {
    const f = fixture(t); fs.mkdirSync(f.outputRoot, { recursive: true });
    fs.writeFileSync(path.join(f.outputRoot, 'old-record.json'), '{}');
    assert.throws(() => runShard('webkit-flow', { ...f, spawnSyncImpl: () => assert.fail('Must not launch') }), /fresh output/);
});
test('unknown shards and evidence paths outside education output are rejected', t => {
    const f = fixture(t); assert.throws(() => runShard('unknown', f), /known education shard/);
    assert.throws(() => runShard('webkit-flow', { ...f, outputRoot: path.join(f.cwd, 'foreign') }), /stay in education output/);
});
test('proof for a different engine cannot pass', t => {
    const f = fixture(t), attempt = path.join(f.outputRoot, 'attempt-fake');
    fs.mkdirSync(attempt, { recursive: true });
    fs.writeFileSync(path.join(attempt, 'record.json'), JSON.stringify({ suite: 'journey', engine: 'chromium' }));
    assert.throws(() => verifyCase(f.outputRoot, 'journey', 'webkit', f.cwd));
});
test('CLI plan needs no database and invalid selection exits nonzero', () => {
    const cli = path.resolve(__dirname, '../scripts/run-education-ci-shard.js'), env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const plan = spawnSync(process.execPath, [cli, '--plan'], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(plan.status, 0, plan.stderr); assert.equal(JSON.parse(plan.stdout).length, 5);
    assert.equal(spawnSync(process.execPath, [cli, 'unknown'], { env, windowsHide: true }).status, 1);
});
for (const corrupt of [false, true]) {
    test('actual child protocol ' + (corrupt ? 'rejects corrupted proof' : 'validates all four synthetic attempts'), t => {
        const f = fixture(t), script = path.join(f.cwd, 'scripts/fixture.cjs');
        fs.mkdirSync(path.dirname(script), { recursive: true });
        // Synthetic protocol only; no browser/SQL execution is claimed here.
        fs.writeFileSync(script, `
            const fs=require('node:fs'),path=require('node:path');
            const {inventory,hash}=require(${JSON.stringify(path.resolve(__dirname, 'helpers/education-close-evidence.js'))});
            const contracts=require(${JSON.stringify(path.resolve(__dirname, 'helpers/education-close-contracts.json'))});
            const suite=process.argv[2],engine=process.argv[3],attemptId='attempt-synthetic-'+suite;
            const directory=path.join(process.env.EDU_CLOSE_OUTPUT,attemptId);fs.mkdirSync(directory,{recursive:true});
            const proof={suite,attemptId,exitCode:0,status:'PASS',pageErrors:[],completedProfiles:contracts[suite].profiles,
                checks:contracts[suite].requiredIds.map(id=>({id,status:'PASS'}))};
            const record={schema:'education-evidence-v2',suite,engine,attemptId,exitCode:0,status:'PASS',
                startedAt:'2026-11-02T00:00:00Z',finishedAt:'2026-11-02T00:00:01Z',...inventory(process.cwd()),proof:'verification.json',log:'run.log'};
            fs.writeFileSync(path.join(directory,record.proof),JSON.stringify(proof));record.proofHash=hash(path.join(directory,record.proof));
            fs.writeFileSync(path.join(directory,record.log),'EDUCATION_EVIDENCE_COMPLETE '+attemptId+' '+suite+' '+record.proofHash+'\\n');
            record.logHash=hash(path.join(directory,record.log));fs.writeFileSync(path.join(directory,'record.json'),JSON.stringify(record));
            if(${JSON.stringify(corrupt)})fs.appendFileSync(path.join(directory,record.proof),' ');
        `);
        let calls=0;const env={...process.env};delete env.NODE_TEST_CONTEXT;
        const status=runShard('chromium-lifecycle',{...f,env,spawnSyncImpl:(binary,args,options)=>{
            calls++;return spawnSync(binary,[script,...args.slice(1)],options);
        }});
        assert.equal(status,corrupt?1:0);assert.equal(calls,corrupt?1:4);
        assert.equal(f.read().status,corrupt?'FAIL_OR_BLOCKED':'PASS');
    });
}
