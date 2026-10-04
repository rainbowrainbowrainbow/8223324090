'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const {DATABASES,OWNER_KEY,preflight}=require('../../scripts/lib/education-ready-dataset');
const root=path.resolve('output/education-ready/08B');
const results=[];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function local(file){const value=path.resolve(root,file);assert.ok(value.startsWith(root+path.sep));return value;}
const read=file=>JSON.parse(fs.readFileSync(local(file),'utf8').replace(/^\uFEFF/,''));
async function check(name,action){await action();results.push({name,status:'PASS'});}
(async()=>{
    const index=read('final-evidence.json');
    await check('Missing visible-date baseline remains FAIL; final13 actual-app checks match current code',()=>{
        const baseline=read(index.baseline+'/verification.json');assert.equal(baseline.phase,'baseline');assert.equal(baseline.exitCode,1);assert.equal(baseline.checks.length,3);assert.equal(baseline.checks.filter(c=>c.status==='FAIL').length,1);assert.ok(baseline.checks.some(c=>/no visible date-edit control/.test(c.error||'')));
        const final=read(index.date+'/verification.json');assert.equal(final.exitCode,0);assert.equal(final.checks.length,13);assert.ok(final.checks.every(c=>c.status==='PASS'));assert.deepEqual(final.pageErrors,[]);
        assert.equal(final.harnessHash,hash('tests/browser/education-ready-date-browser.js'));for(const [file,digest]of Object.entries(final.sourceHashes))assert.equal(hash(file),digest,'Stale source '+file);
        assert.equal(final.proofs.dateOnly.timelineStayedOnOldDate,true);assert.deepEqual(final.proofs.projections,{oldAbsent:true,newPresent:true,views:['today','day','week']});
        assert.equal(final.proofs.allColumns.allColumnsAndJSONUnchanged,true);assert.deepEqual(final.proofs.allColumns.after,{...final.proofs.allColumns.before,date:'2030-02-01'});assert.deepEqual(final.proofs.allColumns.excludedAuditColumns,['updated_at']);
        assert.equal(final.proofs.conflict.response409,true);assert.equal(final.proofs.conflict.partialChanges,false);assert.equal(final.proofs.conflict.adjacentAccepted,true);assert.equal(final.proofs.invalid.writes,0);assert.equal(final.proofs.slowSave.requests,1);assert.equal(final.proofs.slowSave.realResponseHeld,true);assert.equal(final.proofs.slowSave.previewUsedNewDate,true);assert.equal(final.proofs.retry.draftRetained,true);assert.equal(final.proofs.retry.retrySaved,true);assert.equal(final.proofs.series.siblingsUnchanged,2);assert.equal(final.proofs.series.selectedMemberOnly,true);assert.ok(final.proofs.mobile.targetHeight>=44);assert.equal(final.proofs.create.savedDate,'2030-01-11');assert.equal(final.proofs.calendar.dates.length,5);
    });
    await check('Teacher/lifecycle/series/Park regression commands completed without skips',()=>{
        for(const [suite,count]of [['teachers',16],['lifecycle',12]]){const data=read(index.regressions[suite]+'/verification.json');assert.equal(data.exitCode,0);assert.equal(data.checks.length,count);assert.ok(data.checks.every(c=>c.status==='PASS'));assert.deepEqual(data.pageErrors,[]);}
        for(const [suite,count]of [['series',17],['acceptance',11]]){const log=fs.readFileSync(local(index.logs[suite]),'utf8');assert.match(log,new RegExp('# tests '+count+'\\b'));assert.match(log,new RegExp('# pass '+count+'\\b'));assert.match(log,/# fail 0/);assert.match(log,/# skipped 0/);}
        const commands=read(index.commands);assert.deepEqual(commands.map(c=>c.suite),['date','series','teachers','lifecycle','acceptance']);assert.ok(commands.every(c=>c.exitCode===0));
    });
    await check('Personal screenshot review retains every attempted08B frame and its hash',()=>{
        const review=read('personal-review.json');assert.equal(review.personallyReviewed,true);const reviewed=new Set();
        for(const file of review.manifests)for(const screen of read(file).screenshots){assert.equal(hash(screen.path),screen.sha256);reviewed.add(path.resolve(screen.path));}
        function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.png'))assert.ok(reviewed.has(file),'Unreviewed '+file);}}
        walk(local('regressions'));assert.equal(reviewed.size,review.originalScreenshotCount);
    });
    await check('Manual39 bookings/preflight stay unchanged; accepted runners cleaned only disposable',async()=>{
        for(const file of index.runners){const data=read(file);assert.equal(data.status,'PASS');assert.equal(data.exitCode,0);assert.equal(data.manualDatasetPreserved.status,'PASS');assert.equal(data.manualDatasetPreserved.ownedBookingCount,39);assert.equal(data.disposableTablesAfterCleanup,0);}
        const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});
        try{const marker=(await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value;assert.equal(hash('output/education-ready/02/demo-manifest.json'),index.manualManifestHash);assert.deepEqual(await preflight(pool,JSON.parse(marker)),index.manualPreflight);}finally{await pool.end();}
    });
    await check('Runtime/npm/focused gates and unchanged API/schema/auth/protected boundaries are proven',()=>{
        for(const [file,digest]of Object.entries(index.logHashes))assert.equal(hash(local(file)),digest);
        assert.equal(read(index.npmCommand).exitCode,0);const log=fs.readFileSync(local(index.logs.npm),'utf8');assert.match(log,/Node 22\.23\.1 \/ npm 10\.9\.8/);assert.match(log,/Failed: 0/);assert.match(log,/Passed: 1327/);
        const focused=fs.readFileSync(local(index.logs.focused),'utf8');assert.match(focused,/# tests 142/);assert.match(focused,/# pass 142/);assert.match(focused,/# fail 0/);assert.match(focused,/# skipped 0/);
        const old=JSON.parse(fs.readFileSync('output/education-ready/08A/regressions/teachers/attempt-2026-10-04T08-03-10-721Z/verification.json','utf8'));for(const [file,digest]of Object.entries(old.sourceHashes))if(!['index.html','js/booking.js'].includes(file))assert.equal(hash(file),digest,'Out-of-scope08B change '+file);
        const forbidden=execFileSync('git',['diff','--name-only','--','package.json','package-lock.json','middleware','js/auth.js','.github','db/index.js','config/timelineProtectedSurface.js'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(forbidden,'');
        execFileSync(process.execPath,['scripts/check-timeline-protected-surface.js'],{windowsHide:true});execFileSync('git',['diff','--check'],{windowsHide:true});
    });
})().catch(error=>{results.push({name:'Missing/incomplete/stale evidence',status:'FAIL',error:error.message});process.exitCode=1;}).finally(()=>{fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify({checks:results,exitCode:process.exitCode||0},null,2));console.log(results.map(r=>`${r.status} ${r.name}${r.error?' '+r.error:''}`).join('\n'));});
