'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const m = require('../services/releaseMaintenance');
const helper = require('../scripts/railway-release-up');
const { captureMaintenanceIdentity } = require('../scripts/park-hr-maintenance-proof.cjs');
const BASE = 'a'.repeat(40), RELEASE = 'b'.repeat(40), NOW = Date.parse('2026-10-25T04:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
function platform(stopped = true) {
    const instance = { environmentId: 'd9f9b984-d54d-4620-a8bf-c48882ad5158', serviceName: '8223324090', serviceId: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee', source: { repo: null, image: null }, cronSchedule: null, activeDeployments: stopped ? [] : [{ id: 'baseline-deployment' }], latestDeployment: { id: 'baseline-deployment', status: stopped ? 'REMOVED' : 'SUCCESS', deploymentStopped: stopped, meta: { imageDigest: 'sha256:' + 'd'.repeat(64) } } };
    return { id: m.TARGET.project, name: 'fortunate-appreciation', environments: { edges: [{ node: { id: instance.environmentId, name: 'production', serviceInstances: { edges: [{ node: instance }] } } }] } };
}
const instance = snapshot => snapshot.environments.edges[0].node.serviceInstances.edges[0].node;
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-maintenance-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const proofs = { approvalRef: 'LOCAL_TEST_ONLY', createdAtUtc: new Date(NOW).toISOString(), expiresAtUtc: new Date(NOW + 20 * 60000).toISOString() };
    proofs.auditObservedAtUtc = proofs.inventoryObservedAtUtc = proofs.createdAtUtc;
    for (const key of ['migrationHash', 'auditProofHash', 'planHash', 'databaseFingerprint', 'foundationFingerprint']) proofs[key] = 'c'.repeat(64);
    function artifact(sha, version, name) {
        const sourceDir = path.join(dir, name); fs.mkdirSync(sourceDir);
        fs.writeFileSync(path.join(sourceDir, 'package.json'), JSON.stringify({ version }));
        fs.writeFileSync(path.join(sourceDir, 'eventgenix-release-deployment.json'), JSON.stringify({ sha, branch: m.TARGET.branch }));
        return { sha, version, sourceDir, artifactHash: m.artifactHash(sourceDir) };
    }
    const live = { version: '1.0.1', commitSha: BASE, sourceBranch: m.TARGET.branch, deploymentMetadata: { complete: true, status: 'manifest' } };
    const manifest = { uploadMarkers: { forward: path.join(dir,'forward-upload'), rollback: path.join(dir,'rollback-upload') }, format: 'eventgenix.park-hr-maintenance', schemaVersion: 1, approvalRef: proofs.approvalRef, createdAtUtc: proofs.createdAtUtc, expiresAtUtc: proofs.expiresAtUtc, target: m.TARGET, proofs, source: instance(platform()).source,
        identity: captureMaintenanceIdentity(platform(false), live, BASE), baseline: { ...artifact(BASE, '1.0.1', 'base'), live }, release: artifact(RELEASE, '1.0.2', 'forward') };
    const options = { ...m.TARGET, maintenanceMode: 'forward', maintenanceApproval: proofs.approvalRef, maintenanceManifest: path.join(dir, 'manifest.json'), maintenanceReceipt: path.join(dir, 'receipt.json'), maintenanceAttempt: path.join(dir, 'attempt.json'), dryRun: false };
    let time = NOW, remote = RELEASE, state = platform(), offline = true;
    const calls = []; let ciHook, statusHook, uploadHook;
    const receipt = { state: 'COMMITTED', operation: 'APPLY', ...Object.fromEntries(Object.keys(proofs).filter(k => !k.endsWith('Utc')).map(k => [k, proofs[k]])), liveSha: BASE, releaseSha: RELEASE, committedAtUtc: new Date(NOW).toISOString(), writerProof: { mode: 'SERVICE_STOPPED', evidenceHash: 'e'.repeat(64) } };
    function seal() {
        fs.writeFileSync(options.maintenanceManifest, JSON.stringify(manifest)); options.maintenanceManifestSha256 = hash(fs.readFileSync(options.maintenanceManifest));
        const body=JSON.stringify(receipt);fs.writeFileSync(options.maintenanceReceipt, JSON.stringify({body,sha256:hash(body)}));options.maintenanceReceiptSha256=hash(fs.readFileSync(options.maintenanceReceipt));
    }
    const io = {
        assertForwardSafety: async (live, head, remoteSha) => helper.assertPreDeployLiveSafety({live,head,remoteSha,localVersion:'1.0.2',branch:m.TARGET.branch}),
        now: () => time, head: async () => RELEASE, remote: async () => remote, ancestor: async (base, release) => { assert.equal(base, BASE); assert.equal(release, RELEASE); },
        ci: async sha => { calls.push('CI:' + sha); if(ciHook) await ciHook(sha); return { sha, jobs: 23 }; },
        status: async () => statusHook ? statusHook() : state,
        liveIsUnavailable: async () => offline,
        validateArtifact: async artifact => { calls.push('VALIDATE:' + artifact.sha); assert.equal(JSON.parse(fs.readFileSync(path.join(artifact.sourceDir, 'package.json'))).version, artifact.version); },
        upload: async (artifact, message) => { calls.push('UPLOAD:' + artifact.sha); if(uploadHook) await uploadHook(artifact, message); const i=instance(state);i.latestDeployment={id:'new-deployment',status:'SUCCESS',deploymentStopped:false,meta:{cliMessage:message,imageDigest:'sha256:'+'e'.repeat(64)}};i.activeDeployments=[{id:'new-deployment'}]; },
        smoke: async artifact => { calls.push('SMOKE:' + artifact.sha); }
    };
    seal();
    return { dir, options, manifest, receipt, io, calls, seal, setTime: value => {time=value;}, setRemote:value=>{remote=value;}, setState:value=>{state=value;}, setOffline:value=>{offline=value;}, setCi:hook=>{ciHook=hook;}, setStatus:hook=>{statusHook=hook;}, setUpload:hook=>{uploadHook=hook;} };
}
test('maintenance parser is explicit and keeps normal release defaults unchanged', () => {
    const normal=helper.parseArgs([]);assert.equal(normal.maintenanceMode,'');
    const parsed=helper.parseArgs(['--maintenance-mode','forward','--maintenance-manifest','private.json','--maintenance-manifest-sha256','a'.repeat(64),'--maintenance-approval','LOCAL_TEST_ONLY']);
    assert.equal(parsed.maintenanceMode,'forward');assert.equal(parsed.maintenanceManifest,'private.json');
    for(const change of [{liveUrl:'https://foreign.test'},{skipRemoteCheck:true},{recoverMissingLiveMetadataCommit:BASE},{migrateLiveSourceBranchFrom:'foreign'},{exportRoot:os.tmpdir()},{branch:'foreign'},{service:'foreign'},{maintenanceMode:''}])assert.throws(()=>m.assertOptions({...normal,...m.TARGET,maintenanceApproval:'LOCAL_TEST_ONLY',maintenanceMode:'forward',...change}));
});
test('valid stopped-service path rechecks gates, uploads only captured artifact and runs exact smoke', async t => {
    const f=fixture(t);const result=await m.execute(f.options,f.io);
    assert.equal(result.state,'DEPLOYED_SMOKE_VERIFIED');assert.equal(result.sha,RELEASE);
    assert.deepEqual(f.calls,['CI:'+RELEASE,'VALIDATE:'+RELEASE,'CI:'+RELEASE,'VALIDATE:'+RELEASE,'UPLOAD:'+RELEASE,'CI:'+RELEASE,'SMOKE:'+RELEASE]);
    const attempt=JSON.parse(fs.readFileSync(f.options.maintenanceAttempt+'.result'));assert.equal(attempt.deployment.id,'new-deployment');assert.equal(attempt.artifactSha,RELEASE);
    await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.filter(x=>x.startsWith('UPLOAD')).length,1);
});
test('maintenance rejects missing or altered manifest, stale approval and wrong SHA before upload', async t => {
    for(const mutate of [f=>{f.options.maintenanceManifestSha256='0'.repeat(64);},f=>{f.options.maintenanceManifest='';},f=>{f.options.maintenanceApproval='FOREIGN_APPROVAL';},f=>{f.setTime(NOW+31*60000);},f=>{f.manifest.release.sha=BASE;f.seal();},f=>{f.manifest.target={...m.TARGET,service:'foreign'};f.seal();},f=>{f.setRemote(BASE);},f=>{f.options.commit=BASE;}]){
        const f=fixture(t);mutate(f);await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
    }
});
test('offline mode never accepts active, replacement or foreign deployment/image or healthy endpoint', async t => {
    for(const mutate of [f=>f.setState(platform(false)),f=>{const s=platform();instance(s).latestDeployment.id='replacement';f.setState(s);},f=>{const s=platform();s.id='foreign';f.setState(s);},f=>{const s=platform();instance(s).latestDeployment.meta.imageDigest='sha256:'+'f'.repeat(64);f.setState(s);},f=>f.setOffline(false),f=>{f.io.status=async()=>{throw Error('UNKNOWN_PLATFORM_STATUS');};}]){
        const f=fixture(t);mutate(f);await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
    }
});
test('ownership receipt must be reviewed, committed, fresh and bound to the entire manifest', async t => {
    for(const mutate of [f=>{f.receipt.state='COMMIT_PENDING';},f=>{f.receipt.operation='ROLLBACK';},f=>{f.receipt.planHash='f'.repeat(64);},f=>{f.receipt.releaseSha=BASE;},f=>{f.receipt.committedAtUtc=new Date(NOW-6*60000).toISOString();},f=>{f.receipt.writerProof.mode='ASSUMED';}]){
        const f=fixture(t);mutate(f);f.seal();await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
    }
    const f=fixture(t);fs.appendFileSync(f.options.maintenanceReceipt,' ');await assert.rejects(m.execute(f.options,f.io),/PRIVATE_HASH_MISMATCH/);
});
test('artifact tampering and private files inside Git are refused', async t => {
    const f=fixture(t);fs.writeFileSync(path.join(f.manifest.release.sourceDir,'unexpected.js'),'changed');await assert.rejects(m.execute(f.options,f.io),/ARTIFACT_CHANGED/);
    assert.throws(()=>m.writePrivate(path.join(__dirname,'must-not-write.json'),{}),/PRIVATE_FILE_IN_GIT/);
    assert.throws(()=>m.artifactHash(path.join(__dirname,'..')),/ARTIFACT_OUTSIDE_TEMP/);
});
test('expiry, CI, remote and deployment drift between validation and upload fail closed', async t => {
    for(const failure of ['expiry','ci','remote','deployment']){
        const f=fixture(t);let checks=0;f.setCi(async()=>{if(++checks===2){if(failure==='expiry')f.setTime(NOW+31*60000);if(failure==='ci')throw Error('CI_FAILED');if(failure==='remote')f.setRemote(BASE);if(failure==='deployment')f.setState(platform(false));}});
        // Remote is checked at each gate; an extra mutation at CI completion must also be caught.
        if(failure==='remote'){const original=f.io.validateArtifact;f.io.validateArtifact=async a=>{await original(a);f.setRemote(BASE);};}
        await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
        if(fs.existsSync(f.options.maintenanceAttempt+'.result'))assert.equal(JSON.parse(fs.readFileSync(f.options.maintenanceAttempt+'.result')).state,'VALIDATION_FAILED_NO_UPLOAD');
    }
});
test('rollback restores only the captured baseline without rewinding production ref or requiring failed candidate CI', async t => {
    const f=fixture(t);await m.execute(f.options,f.io);
    const forward=JSON.parse(fs.readFileSync(f.options.maintenanceAttempt+'.result'));
    const stopped=platform();const i=instance(stopped);i.latestDeployment={id:forward.deployment.id,status:'REMOVED',deploymentStopped:true,meta:{cliMessage:forward.message,imageDigest:forward.deployment.imageDigest}};f.setState(stopped);
    f.options.maintenanceMode='rollback';f.options.maintenanceForwardAttempt=f.options.maintenanceAttempt+'.result';f.options.maintenanceForwardAttemptSha256=hash(fs.readFileSync(f.options.maintenanceForwardAttempt));f.options.maintenanceAttempt=path.join(f.dir,'rollback-attempt.json');
    f.receipt.operation='ROLLBACK';f.seal();f.calls.length=0;f.setCi(async sha=>{assert.equal(sha,BASE);});
    const result=await m.execute(f.options,f.io);assert.equal(result.sha,BASE);assert.ok(f.calls.includes('UPLOAD:'+BASE));assert.ok(f.calls.includes('SMOKE:'+BASE));
});
test('rollback refuses a foreign attempt, image or missing image rather than guessing a failed upload', async t => {
    for(const change of ['manifest','image','unknown']){
        const f=fixture(t);const forward={mode:'forward',manifestHash:f.options.maintenanceManifestSha256,artifactSha:RELEASE,message:'known-message',deployment:{id:'new',imageDigest:'sha256:'+'e'.repeat(64)}};
        const state=platform();instance(state).latestDeployment={id:'new',status:'REMOVED',deploymentStopped:true,meta:{cliMessage:forward.message,imageDigest:forward.deployment.imageDigest}};
        if(change==='manifest')forward.manifestHash='0'.repeat(64);if(change==='image')forward.deployment.imageDigest='sha256:'+'f'.repeat(64);if(change==='unknown')forward.deployment.imageDigest=null;
        assert.throws(()=>m.assertRollbackStopped(state,{...f.manifest,reviewHash:f.options.maintenanceManifestSha256},forward));
    }
});
test('maintenance dry run validates real gates but cannot upload or create an attempt', async t => {
    const f=fixture(t);f.options.dryRun=true;assert.equal((await m.execute(f.options,f.io)).state,'VALIDATED_NO_UPLOAD');assert.equal(fs.existsSync(f.options.maintenanceAttempt),false);assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
});
test('upload acknowledgement failure preserves platform identity and never reruns the upload', async t => {
    const f=fixture(t);f.setUpload(async (artifact,message)=>{const state=platform();instance(state).latestDeployment={id:'known-failed',status:'FAILED',deploymentStopped:false,meta:{cliMessage:message,imageDigest:'sha256:'+'e'.repeat(64)}};f.setState(state);throw Error('ACK_LOST');});
    await assert.rejects(m.execute(f.options,f.io),/ACK_LOST/);const saved=JSON.parse(fs.readFileSync(f.options.maintenanceAttempt+'.result'));assert.equal(saved.state,'UPLOAD_ERROR');assert.equal(saved.deployment.id,'known-failed');assert.equal(f.calls.filter(c=>c.startsWith('UPLOAD')).length,1);assert.equal(f.calls.some(c=>c.startsWith('SMOKE')),false);
});
function ciRun(overrides={}){return{id:100,run_attempt:1,path:'.github/workflows/ci.yml',event:'push',head_branch:m.TARGET.branch,head_sha:RELEASE,status:'completed',conclusion:'success',html_url:'https://example.test/ci',...overrides};}
function ciJobs(){return ['Fast baseline','Omni browser regression','HR Team browser smoke','HR and payroll PostgreSQL integration','Additional required job'].map(name=>({name,status:'completed',conclusion:'success'}));}
test('maintenance requires every workflow job green for the exact SHA and canonical push branch',()=>{
    assert.equal(m.assertWorkflowCi(ciRun(),ciJobs(),RELEASE,m.TARGET.branch).jobs,5);
    for(const change of [{head_sha:BASE},{head_branch:'foreign'},{event:'pull_request'},{path:'foreign.yml'},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>m.assertWorkflowCi(ciRun(change),ciJobs(),RELEASE,m.TARGET.branch));
    for(const conclusion of ['failure','skipped',null]){const jobs=ciJobs();jobs[4].conclusion=conclusion;assert.throws(()=>m.assertWorkflowCi(ciRun(),jobs,RELEASE,m.TARGET.branch));}
    assert.throws(()=>m.assertWorkflowCi(ciRun(),ciJobs().slice(1),RELEASE,m.TARGET.branch));
});
test('GitHub maintenance lookup rejects incomplete lists and latest rerun failure',async()=>{
    let calls=0;const fetchImpl=async url=>{calls++;assert.match(url,/https:\/\/api.github.com\/repos\/rainbowrainbowrainbow\/8223324090\//);return{ok:true,json:async()=>url.includes('/jobs?')?{total_count:5,jobs:ciJobs()}:{total_count:1,workflow_runs:[ciRun()]}};};
    assert.equal((await helper.fetchMaintenanceCi('https://github.com/'+m.TARGET.repository+'.git',RELEASE,m.TARGET.branch,{fetchImpl})).jobs,5);assert.equal(calls,2);
    await assert.rejects(helper.fetchMaintenanceCi('https://github.com/'+m.TARGET.repository+'.git',RELEASE,m.TARGET.branch,{fetchImpl:async()=>({ok:true,json:async()=>({total_count:101,workflow_runs:[ciRun()]})})}),/INCOMPLETE/);
    await assert.rejects(helper.fetchMaintenanceCi('https://github.com/foreign/repo.git',RELEASE,m.TARGET.branch,{fetchImpl}),/REPOSITORY_MISMATCH/);
    await assert.rejects(helper.fetchMaintenanceCi('https://github.com/'+m.TARGET.repository+'.git',RELEASE,m.TARGET.branch,{fetchImpl:async url=>({ok:true,json:async()=>url.includes('/jobs?')?{total_count:5,jobs:ciJobs()}:{total_count:2,workflow_runs:[ciRun(),ciRun({id:101,conclusion:'failure'})]}})}),/CI_NOT_GREEN/);
});

test('healthy pre-stop preparation seals both captured artifacts and proceeds only after exact stop', async t => {
    const f=fixture(t);f.options.maintenanceMode='prepare';f.options.maintenanceManifest=path.join(f.dir,'prepared.json');
    f.options.maintenanceProofs=path.join(f.dir,'proofs.json');fs.writeFileSync(f.options.maintenanceProofs,JSON.stringify(f.manifest.proofs));f.options.maintenanceProofsSha256=hash(fs.readFileSync(f.options.maintenanceProofs));
    f.setState(platform(false));let requests=0,exports=0;
    f.io.live=async()=>({...f.manifest.baseline.live,uptime:requests++});
    f.io.assertForwardSafety=async(live,head,remoteSha)=>helper.assertPreDeployLiveSafety({live,head,remoteSha,localVersion:'1.0.2',branch:m.TARGET.branch});
    f.io.localVersion=()=> '1.0.2';f.io.packageAt=async sha=>({version:sha===BASE?'1.0.1':'1.0.2'});
    f.io.exportArtifact=async(sha,version)=>{const sourceDir=path.join(f.dir,'export-'+(++exports));fs.mkdirSync(sourceDir);fs.writeFileSync(path.join(sourceDir,'package.json'),JSON.stringify({version}));return{sourceDir};};
    f.io.cleanupArtifact=async artifact=>fs.rmSync(artifact.sourceDir,{recursive:true,force:true});
    const result=await m.prepare(f.options,f.io);assert.equal(result.state,'PREPARED_NO_PRODUCTION_CHANGE');assert.equal(result.rollbackSha,BASE);assert.equal(exports,2);assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
    f.options.maintenanceManifestSha256=result.manifestHash;f.options.maintenanceMode='forward';f.setState(platform());
    assert.equal((await m.execute(f.options,f.io)).sha,RELEASE);
});
test('preparation rejects arbitrary or changing baseline and removes only its own exports on failure',async t=>{
    for(const change of ['live','expiry','remote']){
        const f=fixture(t);f.options.maintenanceMode='prepare';f.options.maintenanceManifest=path.join(f.dir,'never-written.json');
        f.options.maintenanceProofs=path.join(f.dir,'proofs.json');fs.writeFileSync(f.options.maintenanceProofs,JSON.stringify(f.manifest.proofs));f.options.maintenanceProofsSha256=hash(fs.readFileSync(f.options.maintenanceProofs));f.setState(platform(false));let reads=0;const owned=[];
        f.io.live=async()=>({...f.manifest.baseline.live,commitSha:++reads>1&&change==='live'?'f'.repeat(40):BASE});
        f.io.assertForwardSafety=async(live,head,remoteSha)=>helper.assertPreDeployLiveSafety({live,head,remoteSha,localVersion:'1.0.2',branch:m.TARGET.branch});f.io.localVersion=()=> '1.0.2';f.io.packageAt=async sha=>({version:sha===BASE?'1.0.1':'1.0.2'});
        f.io.exportArtifact=async()=>{const sourceDir=path.join(f.dir,'owned-'+owned.length);fs.mkdirSync(sourceDir);fs.writeFileSync(path.join(sourceDir,'synthetic'),'safe');owned.push(sourceDir);if(change==='expiry')f.setTime(NOW+31*60000);if(change==='remote')f.setRemote(BASE);return{sourceDir};};
        f.io.cleanupArtifact=async artifact=>fs.rmSync(artifact.sourceDir,{recursive:true,force:true});
        await assert.rejects(m.prepare(f.options,f.io));assert.equal(fs.existsSync(f.options.maintenanceManifest),false);assert.ok(owned.every(file=>!fs.existsSync(file)));assert.ok(fs.existsSync(f.manifest.baseline.sourceDir));
    }
});
test('second CI lookup changing remote before upload cannot slip past the final ref recheck',async t=>{
    const f=fixture(t);let n=0;f.setCi(async()=>{if(++n===2)f.setRemote(BASE);});await assert.rejects(m.execute(f.options,f.io),/REMOTE_DRIFT/);assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
});
test('rollback can restore baseline after a proved pre-upload validation failure',async t=>{
    const f=fixture(t);let n=0;f.setCi(async()=>{if(++n===2)throw Error('CI_RERUN_FAILED');});await assert.rejects(m.execute(f.options,f.io),/CI_RERUN_FAILED/);
    f.options.maintenanceMode='rollback';f.options.maintenanceForwardAttempt=f.options.maintenanceAttempt+'.result';f.options.maintenanceForwardAttemptSha256=hash(fs.readFileSync(f.options.maintenanceForwardAttempt));f.options.maintenanceAttempt=path.join(f.dir,'rollback.json');f.receipt.operation='ROLLBACK';f.seal();f.setCi(async sha=>assert.equal(sha,BASE));
    const result=await m.execute(f.options,f.io);assert.equal(result.sha,BASE);assert.ok(f.calls.includes('SMOKE:'+BASE));
});
test('CLI parse-only maintenance invocation cannot reach network, DB or upload',()=>{
    const executable=path.join(__dirname,'../scripts/railway-release-up.js');const result=spawnSync(process.execPath,[executable,'--parse-only','--maintenance-mode','rollback','--maintenance-manifest','private-path','--maintenance-approval','LOCAL_TEST_ONLY'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).maintenanceMode,'rollback');
});

test('real git archive rollback export and canonical version smoke use the captured older package',async t=>{
    const http=require('node:http');const {execFile}=require('node:child_process');const {promisify}=require('node:util');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'eg-maintenance-git-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const repo=path.join(directory,'repo');fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,'scripts'));
    fs.copyFileSync(path.join(__dirname,'../scripts/live-version-smoke.js'),path.join(repo,'scripts/live-version-smoke.js'));
    const git=args=>{const r=spawnSync(process.platform==='win32'?'git.exe':'git',args,{cwd:repo,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    git(['init']);git(['config','user.name','Disposable Test']);git(['config','user.email','disposable@example.test']);
    fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({version:'1.0.1'}));fs.writeFileSync(path.join(repo,'index.html'),'<p>v1.0.1</p>');git(['add','.']);git(['commit','-m','Synthetic baseline']);const base=git(['rev-parse','HEAD']);
    fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({version:'1.0.2'}));fs.writeFileSync(path.join(repo,'index.html'),'<p>v1.0.2</p>');git(['add','.']);git(['commit','-m','Synthetic release']);
    const server=http.createServer((req,res)=>{if(req.url==='/api/version'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:'1.0.1',commitSha:base,sourceBranch:m.TARGET.branch,deploymentMetadata:{status:'manifest',complete:true,commitShaSource:'manifest',sourceBranchSource:'manifest',invalidSources:[],warnings:[]}}));}else res.end('<p>v1.0.1</p>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const child=path.join(directory,'export-smoke.cjs');fs.writeFileSync(child,`const helper=require(process.argv[2]);const out=helper.createCleanExport(process.argv[3],'codex/eventgenix-production',{expectedVersion:'1.0.1',exportRoot:process.argv[5]});helper.runPostDeploySmoke(process.argv[4],process.argv[3],'codex/eventgenix-production',out.sourceDir);`);
    const exportRoot=path.join(directory,'export');const result=await promisify(execFile)(process.execPath,[child,path.join(__dirname,'../scripts/railway-release-up.js'),base,'http://127.0.0.1:'+server.address().port,exportRoot],{cwd:repo,timeout:20000,windowsHide:true});
    assert.match(result.stdout,/Version smoke OK:.*v1\.0\.1/);assert.equal(JSON.parse(fs.readFileSync(path.join(exportRoot,'source/package.json'))).version,'1.0.1');assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'package.json'))).version,'1.0.2');
    const manifest=JSON.parse(fs.readFileSync(path.join(exportRoot,'source/eventgenix-release-deployment.json')));assert.equal(manifest.commitSha,base);assert.equal(manifest.applicationVersion,'1.0.1');
});

test('offline path retains canonical complete-metadata and forward-version guards',async t=>{
    for(const mutate of [f=>{f.manifest.baseline.version='1.0.2';f.manifest.baseline.live.version='1.0.2';},f=>{f.manifest.baseline.live.deploymentMetadata.complete=false;},f=>{f.manifest.identity.liveSha='f'.repeat(40);},f=>{f.manifest.proofs.auditObservedAtUtc=new Date(NOW-31*60000).toISOString();},f=>{f.manifest.proofs.inventoryObservedAtUtc=new Date(NOW+1000).toISOString();}]){
        const f=fixture(t);mutate(f);f.seal();await assert.rejects(m.execute(f.options,f.io));assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);
    }
});
test('a remote change during upload preserves the receipt and stops further release actions',async t=>{
    const f=fixture(t);f.setUpload(async()=>{f.setRemote(BASE);});await assert.rejects(m.execute(f.options,f.io),/REMOTE_DRIFT_AFTER_UPLOAD/);assert.equal(JSON.parse(fs.readFileSync(f.options.maintenanceAttempt+'.result')).state,'UPLOADED');assert.equal(f.calls.some(c=>c.startsWith('SMOKE')),false);
});

test('private maintenance files cannot be placed in another Git checkout',t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'eg-maintenance-private-path-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(directory,'.git'));assert.throws(()=>m.writePrivate(path.join(directory,'receipt.json'),{}),/PRIVATE_FILE_IN_GIT/);assert.equal(fs.existsSync(path.join(directory,'receipt.json')),false);
});

test('read-only NOT_COMMITTED proof restores baseline only before any forward upload request',async t=>{
    for(const hasUpload of [false,true]){
        const f=fixture(t);f.options.maintenanceMode='rollback';f.receipt.operation='READ_ONLY_RECOVERY';f.receipt.state='VERIFIED_NOT_COMMITTED';f.receipt.verifiedAtUtc=new Date(NOW).toISOString();f.seal();f.setCi(async sha=>assert.equal(sha,BASE));
        if(hasUpload){fs.writeFileSync(f.manifest.uploadMarkers.forward,'{}');await assert.rejects(m.execute(f.options,f.io),/UPLOAD_ALREADY_REQUESTED/);assert.equal(f.calls.some(c=>c.startsWith('UPLOAD')),false);}
        else{assert.equal((await m.execute(f.options,f.io)).sha,BASE);assert.ok(fs.existsSync(f.manifest.uploadMarkers.rollback));assert.equal(fs.existsSync(f.manifest.uploadMarkers.forward),false);}
    }
});
test('NOT_COMMITTED evidence must be fresh and its generator requires the real audit role in a read-only snapshot',async t=>{
    const f=fixture(t);f.options.maintenanceMode='rollback';f.receipt.operation='READ_ONLY_RECOVERY';f.receipt.state='VERIFIED_NOT_COMMITTED';f.receipt.verifiedAtUtc=new Date(NOW-61000).toISOString();f.seal();await assert.rejects(m.execute(f.options,f.io),/RECEIPT_STALE/);
    for(const mode of [{role:'eventgenix_audit_ro',session_role:'admin',readonly:'on',isolation:'repeatable read'},{role:'admin',readonly:'on',isolation:'repeatable read'},{role:'eventgenix_audit_ro',readonly:'off',isolation:'repeatable read'},{role:'eventgenix_audit_ro',readonly:'on',isolation:'read committed'}]){
        let queries=0;await assert.rejects(m.createNoApplyRecoveryProof({query:async()=>{queries++;return{rows:[mode]};}},null,null,null),/RECOVERY_AUDIT_ROLE_REQUIRED/);assert.equal(queries,1);
    }
});
