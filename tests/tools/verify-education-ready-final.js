'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {evaluate,PRODUCT_FILES}=require('../../scripts/lib/education-device-acceptance');
const root=path.resolve('output/education-ready/08');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function local(file){const target=path.resolve(root,file);assert.ok(target.startsWith(root+path.sep),'Evidence outside final08');return target;}
const read=file=>JSON.parse(fs.readFileSync(local(file),'utf8').replace(/^\uFEFF/,''));
const summary={startedAt:new Date().toISOString(),checks:[],status:'NOT RUN'};
function check(name,action){action();summary.checks.push({name,status:'PASS'});}
try {
    const index=read('final-evidence.json');
    const required=['npm','journey','journey-webkit','teachers','groups','lifecycle','date','async','attendance','series','acceptance','navigation','submit','context','mobile-chromium','mobile-webkit','visual','live'];
    check('Fresh command exit codes and current source/harness hashes',()=>{
        assert.deepEqual(Object.keys(index.commands).sort(),required.sort());
        for(const [suite,reference]of Object.entries(index.commands)){
            const record=read(reference.file)[reference.position];assert.equal(record.suite,suite);assert.equal(record.status,'PASS');assert.equal(record.exitCode,0);
            assert.ok(record.sourceUnchanged&&record.harnessUnchanged&&record.retainedUnchanged);
            for(const [file,digest]of Object.entries({...record.sourceHashes,...record.harnessHashes}))assert.equal(hash(file),digest,'Stale '+suite+' '+file);
            assert.equal(hash(local(record.log)),reference.logHash);
        }
    });
    check('Two real continuous journeys; F01-F06 and teacher/date regressions',()=>{
        for(const [suite,count]of [['journey',12],['journey-webkit',12],['teachers',16],['groups',15],['lifecycle',12],['date',13],['async',17]]){
            const proof=read(index.ui[suite]);assert.equal(proof.exitCode,0);assert.equal(proof.checks.length,count);assert.ok(proof.checks.every(row=>row.status==='PASS'));assert.deepEqual(proof.pageErrors,[]);
            if(suite.startsWith('journey')){assert.equal(proof.classification,'ONE_CONTINUOUS_VISIBLE_UI_JOURNEY');assert.equal(proof.engine,suite==='journey'?'chromium':'webkit');assert.deepEqual(proof.reportOracle,{held:1,cancelled:0,scheduled:0,journalsNotStarted:0,present:0,absent:1,excused:0,unmarked:0});}
        }
        for(const [suite,count]of [['attendance',3],['series',17],['acceptance',11]]){
            const reference=index.commands[suite],record=read(reference.file)[reference.position],log=fs.readFileSync(local(record.log),'utf8');
            assert.match(log,new RegExp('# tests '+count+'\\b'));assert.match(log,new RegExp('# pass '+count+'\\b'));assert.match(log,/# fail 0/);assert.match(log,/# skipped 0/);
        }
    });
    check('Fresh two-engine six-profile visual/accessibility matrix and measured contrast',()=>{
        for(const engine of ['chromium','webkit']){
            const proof=read(index.mobile[engine]);assert.equal(proof.status,'PASS');assert.equal(proof.exitCode,0);assert.equal(proof.completedProfiles.length,6);assert.equal(proof.profiles.length,6);assert.ok(proof.checks.length>675&&proof.checks.every(row=>row.status==='PASS'));assert.deepEqual(proof.pageErrors,[]);
            for(const profile of proof.profiles){assert.ok(proof.screens.some(screen=>screen.name?.includes(profile.name)&&screen.name?.includes('teacher-manager')));assert.ok(proof.checks.some(row=>row.name.includes(profile.name)&&row.name.includes('visible-date-hydrated')));}
        }
        const visual=read(index.visual);assert.equal(visual.status,'PASS');assert.equal(visual.screenshots.length,60);assert.deepEqual(visual.contrastFailures,[]);assert.deepEqual(visual.unstyledButtons,[]);assert.deepEqual(visual.pageErrors,[]);
    });
    check('Every final screenshot personally reviewed and original hashes preserved',()=>{
        const review=read('personal-review.json');assert.equal(review.personallyReviewed,true);const screenshots=new Set();
        for(const reference of review.manifests)for(const screen of read(reference).screenshots){assert.equal(hash(screen.path),screen.sha256);screenshots.add(path.resolve(screen.path));}
        for(const file of index.originalScreenshots)assert.ok(screenshots.has(local(file)),file);assert.equal(screenshots.size,index.originalScreenshots.length);
    });
    check('Production read-only observation is separated from candidate acceptance',()=>{
        const live=read(index.live);assert.equal(live.status,'READONLY_OBSERVATION_COMPLETE');assert.equal(live.profileAndCabinetUnchanged,true);assert.ok(live.blockedWrites.some(row=>row.path==='/api/wallet/daily-login'));assert.deepEqual(live.pageErrors,[]);
        const identity=read('identity.json');assert.equal(identity.head,identity.liveVersion.commitSha);assert.equal(identity.liveVersion.sourceBranch,'codex/eventgenix-production');assert.ok(identity.remoteProductionHead.startsWith(identity.head));
        const diagnostics=read('background-diagnostics.json');assert.ok(diagnostics.groups.length);assert.ok(diagnostics.groups.every(row=>row.cause&&row.impact&&row.classification&&row.role&&row.business));
    });
    check('Physical devices remain blocked; missing hardware cannot become PASS',()=>{
        const report=JSON.parse(fs.readFileSync('output/education-ready/08C/operator-results.json','utf8').replace(/^\uFEFF/,''));
        for(const file of PRODUCT_FILES)assert.equal(hash(file),report.sourceHashes[file],'Device source stale');
        const device=evaluate(report,()=>{throw new Error('Operator evidence requires the08C physical verifier');});
        assert.equal(device.status,'BLOCKED_DEVICE');assert.equal(device.counts.total,42);assert.equal(device.counts.passed,0);summary.physicalDevices=device;
        assert.equal(index.conclusion,'NO-GO');
    });
    summary.status='LOCAL_PASS_BLOCKED_DEVICE';summary.conclusion='NO-GO';summary.exitCode=2;
}catch(error){summary.status='FAIL_OR_BLOCKED_EVIDENCE';summary.error=error.message;summary.exitCode=1;}
summary.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify(summary,null,2));console.log(summary.status+' '+JSON.stringify({verifiedGates:summary.checks.length,conclusion:summary.conclusion,exitCode:summary.exitCode,error:summary.error}));process.exitCode=summary.exitCode;
