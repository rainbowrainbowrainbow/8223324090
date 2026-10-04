'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.env.EDU_READY_RUN_ROOT||'output/education-ready/release-acceptance');
assert.ok(root.startsWith(path.resolve('output/education-ready')+path.sep));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const required=['npm','journey','journey-webkit','teachers','groups','lifecycle','date','async','attendance','series','acceptance','navigation','submit','context','mobile-chromium','mobile-webkit','visual','editor','live'];
const summary={startedAt:new Date().toISOString(),status:'NOT RUN',conclusion:'NO-GO',commands:{},physicalDevices:{status:'BLOCKED_DEVICE',passed:0,planned:42},checks:[]};
function check(name,action){action();summary.checks.push({name,status:'PASS'});}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}
try{
    const latest={};
    for(const file of fs.readdirSync(root).filter(f=>/^commands-.*\.json$/.test(f)).sort())for(const [position,record]of read(path.join(root,file)).entries()){
        if(!latest[record.suite]||record.startedAt>latest[record.suite].record.startedAt)latest[record.suite]={file,position,record};
    }
    check('All required fresh suites pass on current source/harness and preserve retained datasets',()=>{
        for(const suite of required){
            const reference=latest[suite];assert.ok(reference,'Missing suite '+suite);const record=reference.record;
            assert.equal(record.status,'PASS',suite);assert.equal(record.exitCode,0,suite);
            assert.ok(record.sourceUnchanged&&record.harnessUnchanged&&record.retainedUnchanged,suite);
            for(const [file,digest]of Object.entries({...record.sourceHashes,...record.harnessHashes}))assert.equal(hash(file),digest,'Stale '+suite+' '+file);
            summary.commands[suite]={file:reference.file,position:reference.position,log:record.log,logHash:hash(path.join(root,record.log))};
        }
    });
    const proofs=files(root).filter(file=>file.endsWith('verification.json')).map(file=>({file,proof:read(file)}));
    check('Both continuous visible UI journeys include real series create/cancel and independent SQL/API assertions',()=>{
        for(const engine of ['chromium','webkit']){
            const candidates=proofs.filter(({proof})=>proof.classification==='ONE_CONTINUOUS_VISIBLE_UI_JOURNEY'&&proof.engine===engine);
            const selected=candidates.sort((a,b)=>b.file.localeCompare(a.file))[0];assert.ok(selected);const proof=selected.proof;
            assert.equal(proof.exitCode,0);assert.equal(proof.checks.length,14);assert.ok(proof.checks.every(row=>row.status==='PASS'));
            assert.deepEqual(proof.pageErrors,[]);assert.equal(proof.createPostCount,1);assert.equal(proof.createActivation.samePressedNode,true);
            assert.deepEqual(proof.seriesBefore.map(r=>r.date),['2030-12-27','2031-01-03','2031-01-10']);
            assert.deepEqual(proof.seriesAfter,proof.seriesBefore.map(row=>({...row,status:'cancelled'})));
            summary[engine+'Journey']=path.relative(root,selected.file);
        }
    });
    check('Every final screenshot was personally reviewed without altering originals',()=>{
        const review=read(path.join(root,'personal-review.json'));assert.equal(review.personallyReviewed,true);
        const expected=files(root).filter(f=>f.endsWith('.png')&&!f.includes(path.sep+'review'+path.sep));
        assert.equal(review.screenshots.length,expected.length);const reviewed=new Set();
        for(const item of review.screenshots){assert.equal(hash(item.path),item.sha256);reviewed.add(path.resolve(item.path));}
        for(const file of expected)assert.ok(reviewed.has(path.resolve(file)),file);
        summary.reviewedScreenshots=expected.length;
    });
    check('Physical checks remain unperformed and may be deferred only by an explicit owner decision',()=>{
        const decision=read(path.join(root,'owner-release-decision.json'));assert.equal(decision.deferPhysicalDevices,true);
        assert.equal(decision.productionWrites,false);assert.ok(decision.userRequest&&decision.recordedAt);
        summary.physicalDevices.ownerDeferred=true;summary.physicalDevices.evidence='NOT RUN';
    });
    summary.status='SOFTWARE_PASS_OWNER_DEFERRED_DEVICE';summary.conclusion='GO_WITH_OWNER_DEVICE_DEFERRAL';summary.exitCode=0;
}catch(error){summary.status='FAIL_OR_BLOCKED_EVIDENCE';summary.error=error.message;summary.exitCode=1;}
summary.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'release-acceptance.json'),JSON.stringify(summary,null,2));
console.log(summary.status+' '+JSON.stringify({conclusion:summary.conclusion,exitCode:summary.exitCode,error:summary.error}));process.exitCode=summary.exitCode;
