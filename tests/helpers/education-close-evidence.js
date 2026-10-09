'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync}=require('node:child_process');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(root, directory) {
    if (!fs.existsSync(path.join(root, directory))) return [];
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(item => {
        const file = path.posix.join(directory, item.name);
        return item.isDirectory() ? walk(root, file) : item.isFile() ? [file] : [];
    });
}
function inventory(root = process.cwd()) {
    // Git supplies tracked and newly added nonignored files; no fixed source-folder allowlist.
    // Runtime-generated uploads/output and local secrets are not source evidence.
    const ignored=new Set(['.git','node_modules','output','uploads','.claude','.dev-intelligence','.agents','.codex']);
    function localFiles(directory='') {
        return fs.readdirSync(path.join(root,directory),{withFileTypes:true}).flatMap(item=>{
            const file=path.posix.join(directory,item.name);
            if(!directory&&ignored.has(item.name))return [];
            return item.isDirectory()?localFiles(file):item.isFile()?[file]:[];
        });
    }
    const files=fs.existsSync(path.join(root,'.git'))
        ? execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean)
        : localFiles();
    const harness=files.filter(file=>/^(tests|scripts)\//.test(file)||file.startsWith('.github/workflows/'));
    const source=files.filter(file=>!ignored.has(file.split('/')[0])&&!/^(tests|scripts|docs|\.github)\//.test(file)
        && (/\.(js|mjs|cjs|css|html|json|sql|svg|png|jpe?g|webp|woff2?|ttf|mp3|wav|ogg|txt)$/.test(file)
            || file.startsWith('prompts/')||['.nvmrc','.node-version'].includes(file)));
    const hashes=files=>Object.fromEntries([...new Set(files)].sort().map(file=>[file,hash(path.join(root,file))]));
    return {sourceHashes:hashes(source),harnessHashes:hashes(harness)};
}

function assertInventory(record, root = process.cwd()) {
    const current = inventory(root);
    assert.deepEqual(record.sourceHashes, current.sourceHashes, 'Stale source inventory (including added/deleted files)');
    assert.deepEqual(record.harnessHashes, current.harnessHashes, 'Stale harness inventory (including added/deleted files)');
}
function assertChecks(proof, contract) {
    assert.ok(Array.isArray(contract.requiredIds)&&contract.requiredIds.length>0,'Empty mandatory scenario inventory');
    if(proof.status!==undefined)assert.equal(proof.status,'PASS','Blocked/NOT RUN suite status');
    assert.ok(!proof.fatal,'Fatal suite failure');
    assert.ok(!proof.skipped&&!(proof.skips?.length)&&!(proof.blockedFixtures?.length),'Skipped/blocked suite prerequisites');
    assert.equal(proof.exitCode, 0, 'Proof exit code');
    assert.ok(Array.isArray(proof.checks) && proof.checks.length > 0, 'Empty suite is not execution');
    const ids = proof.checks.map(row => row.id || row.name);
    assert.equal(new Set(ids).size, ids.length, 'Duplicate scenario IDs');
    assert.ok(ids.every(id => typeof id === 'string' && id.length), 'Unnamed scenario');
    for (const id of contract.requiredIds) assert.ok(ids.includes(id), 'Missing required scenario: ' + id);
    for (const row of proof.checks) {
        assert.equal(row.status, 'PASS', 'Mandatory scenario ' + (row.id || row.name) + ': ' + row.status);
        assert.ok(!row.skipped && !row.skip && !row.apiRepair, 'Skipped/repaired UI is not PASS');
    }
    assert.deepEqual(proof.pageErrors || [], [], 'Uncaught browser errors');
    if (contract.profiles) assert.deepEqual(proof.completedProfiles.map(p => typeof p === 'string' ? p : p.name).sort(), [...contract.profiles].sort(), 'Missing emulation profiles');
}
function evidenceFile(directory, file) {
    assert.ok(typeof file === 'string' && !path.isAbsolute(file), 'Evidence reference must be relative');
    const resolved = path.resolve(directory, file);
    assert.ok(resolved.startsWith(path.resolve(directory) + path.sep), 'Evidence outside attempt');
    return resolved;
}
function validateAttempt(record, directory, contract, root = process.cwd()) {
    assert.equal(record.schema, 'education-evidence-v2');
    assert.equal(record.suite, contract.suite);
    assert.match(record.attemptId, /^attempt-[\w-]+$/);
    assert.equal(path.basename(path.resolve(directory)), record.attemptId, 'Wrong attempt directory');
    assert.equal(record.exitCode, 0); assert.equal(record.status, 'PASS');
    assert.ok(record.startedAt && record.finishedAt && record.finishedAt >= record.startedAt);
    assertInventory(record, root);
    const log = evidenceFile(directory, record.log), proofFile = evidenceFile(directory, record.proof);
    assert.equal(hash(log), record.logHash, 'Stale log');
    assert.equal(hash(proofFile), record.proofHash, 'Stale proof');
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(proof.attemptId, record.attemptId, 'Proof from another attempt');
    assert.equal(proof.suite, record.suite, 'Proof from another suite');
    assertChecks(proof, contract);
    const marker = `EDUCATION_EVIDENCE_COMPLETE ${record.attemptId} ${record.suite} ${record.proofHash}`;
    assert.ok(fs.readFileSync(log, 'utf8').trimEnd().endsWith(marker), 'Missing exact completion marker');
    return { status: 'PASS', suite: record.suite, executedChecks: proof.checks.length, classification: contract.classification };
}
function parseTap(text, contract) {
    const count=name=>Number(text.match(new RegExp('# '+name+' (\\d+)\\b'))?.[1]??NaN);
    const total=count('tests');assert.ok(total>0,'Empty TAP suite');assert.equal(count('pass'),total,'Incomplete TAP execution');
    for(const name of ['fail','skipped','cancelled','todo'])assert.equal(count(name),0,'Nonzero TAP '+name);
    assert.doesNotMatch(text,/^\s*(?:not ok|ok .*# (?:SKIP|TODO))/mi);
    const names=[...text.matchAll(/^\s*ok \d+ - (.+)$/gm)].map(m=>m[1].trim());
    for(const id of contract.requiredIds)assert.ok(names.includes(id),'Missing required TAP scenario: '+id);
    return {checks:contract.requiredIds.map(id=>({id,status:'PASS'})),tapCounts:{tests:total,pass:count('pass'),skipped:0}};
}
const requiredMatrix = ['teachers/chromium','hrLink/chromium','hrLink/webkit','groups/chromium','lifecycle/chromium','date/chromium','async/chromium','journal/chromium','attendance/chromium','series/chromium','acceptance/chromium','journey/chromium','journey/webkit','responsive/chromium','responsive/webkit'];
function validateMatrix(manifest, directory, contracts, root = process.cwd()) {
    assert.equal(manifest.schema,'education-matrix-v2');
    assert.deepEqual(Object.keys(manifest.attempts).sort(),[...requiredMatrix].sort(),'Incomplete mandatory matrix');
    const results=[];
    for(const key of requiredMatrix){
        const reference=manifest.attempts[key],file=evidenceFile(directory,reference.record);
        assert.equal(hash(file),reference.recordHash,'Stale record '+key);
        const record=JSON.parse(fs.readFileSync(file,'utf8'));
        const [suite,engine]=key.split('/');assert.equal(record.suite,suite);assert.equal(record.engine,engine);
        results.push(validateAttempt(record,path.dirname(file),contracts[suite],root));
    }
    return {status:'SOFTWARE_MATRIX_PASS',conclusion:'NO-GO_PENDING_FINAL_ACCEPTANCE',results};
}
module.exports = { hash, inventory, assertInventory, assertChecks, validateAttempt, validateMatrix, requiredMatrix, parseTap };
