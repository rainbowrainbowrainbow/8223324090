'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const {DATABASES,OWNER_KEY,preflight}=require('../../scripts/lib/education-ready-dataset');
const root=path.resolve('output/education-ready/08A');
const results=[];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function local(file){const p=path.resolve(root,file);assert.ok(p.startsWith(root+path.sep));return p;}
const read=file=>JSON.parse(fs.readFileSync(local(file),'utf8').replace(/^\uFEFF/,''));
async function check(name,action){await action();results.push({name,status:'PASS'});}
(async()=>{
    const index=read('final-evidence.json');
    await check('First-assignment baseline remains FAIL; final actual-app16 checks match current sources',()=>{
        const baseline=read(index.baseline+'/verification.json');assert.equal(baseline.exitCode,1);
        assert.equal(baseline.checks.filter(c=>c.status==='FAIL').length,2);
        assert.ok(baseline.checks.some(c=>/canonical lesson editor/.test(c.error||'')));
        const final=read(index.teachers+'/verification.json');assert.equal(final.exitCode,0);assert.equal(final.phase,'postfix');
        assert.equal(final.checks.length,16);assert.ok(final.checks.every(c=>c.status==='PASS'));
        assert.deepEqual(final.pageErrors,[]);assert.equal(final.harnessHash,hash('tests/browser/education-ready-teachers-browser.js'));
        for(const [file,digest]of Object.entries(final.sourceHashes))assert.equal(hash(file),digest,'Stale proof: '+file);
        assert.ok(final.proofs.firstMembership.created_by);assert.equal(final.proofs.emptyMigrationTable,true);
        assert.ok(Object.values(final.proofs.foreignRejected).every(Boolean));assert.ok(Object.values(final.proofs.inactive).every(Boolean));
        assert.deepEqual(final.proofs.deactivationRace,{heldActualSQLLock:true,assignment404:true,partialGroupCount:0});
    });
    await check('Series/legacy conflicts and groups/lifecycle/Park acceptance completed without skips',()=>{
        const counts={groups:15,lifecycle:12};
        for(const [suite,count]of Object.entries(counts)){
            const evidence=read(index.regressions[suite]+'/verification.json');assert.equal(evidence.checks.length,count);assert.ok(evidence.checks.every(c=>c.status==='PASS'));assert.deepEqual(evidence.pageErrors,[]);
        }
        for(const [suite,count]of [['series',17],['acceptance',11]]){
            const log=fs.readFileSync(local(index.logs[suite]),'utf8');assert.match(log,new RegExp('# tests '+count+'\\b'));assert.match(log,new RegExp('# pass '+count+'\\b'));assert.match(log,/# fail 0/);assert.match(log,/# skipped 0/);
        }
        const commands=read(index.commands);assert.deepEqual(commands.map(c=>c.suite),['teachers','series','groups','lifecycle','acceptance']);assert.ok(commands.every(c=>c.exitCode===0));
    });
    await check('Screenshots were personally reviewed and have retained hashes',()=>{
        const review=read('personal-review.json');assert.equal(review.personallyReviewed,true);
        const reviewed=new Set();
        for(const manifestFile of review.manifests){const manifest=read(manifestFile);for(const screen of manifest.screenshots){assert.equal(hash(screen.path),screen.sha256);reviewed.add(path.resolve(screen.path));}}
        for(const folder of [index.teachers,...Object.values(index.regressions)])for(const file of fs.readdirSync(local(folder)).filter(f=>f.endsWith('.png')))assert.ok(reviewed.has(local(folder+'/'+file)),'Unreviewed screenshot');
    });
    await check('Manual39 bookings are unchanged; every selected runner cleaned only the owned disposable DB',async()=>{
        for(const file of index.runners){const data=read(file);assert.equal(data.status,'PASS');assert.equal(data.exitCode,0);assert.equal(data.manualDatasetPreserved.status,'PASS');assert.equal(data.manualDatasetPreserved.ownedBookingCount,39);assert.equal(data.disposableTablesAfterCleanup,0);}
        const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});
        try{const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);assert.deepEqual(await preflight(pool,manifest),index.manualPreflight);}finally{await pool.end();}
    });
    await check('Final npm/runtime and protected/config boundaries are proven',()=>{
        for(const [file,digest]of Object.entries(index.logHashes))assert.equal(hash(local(file)),digest);
        const result=read('npm-command-result.json');assert.equal(result.exitCode,0);
        const log=fs.readFileSync(local(index.logs.npm),'utf8');assert.match(log,/Node 22\.23\.1 \/ npm 10\.9\.8/);assert.match(log,/Failed: 0/);assert.match(log,/Passed: 1327/);
        const changed=execFileSync('git',['diff','--name-only','--','package.json','package-lock.json','middleware','js/auth.js','.github','config/timelineProtectedSurface.js','db/index.js'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(changed,'');
        assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8',windowsHide:true}).trim(),'codex/education-ready-pack-20261003');
        execFileSync(process.execPath,['scripts/check-timeline-protected-surface.js'],{windowsHide:true});execFileSync(process.execPath,['scripts/check-migrations.js'],{windowsHide:true});execFileSync('git',['diff','--check'],{windowsHide:true});
    });
})().catch(error=>{results.push({name:'Missing/incomplete/stale evidence',status:'FAIL',error:error.message});process.exitCode=1;})
 .finally(()=>{fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify({checks:results,exitCode:process.exitCode||0},null,2));console.log(results.map(r=>`${r.status} ${r.name}${r.error?' '+r.error:''}`).join('\n'));});
