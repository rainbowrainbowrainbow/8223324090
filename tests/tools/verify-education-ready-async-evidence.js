'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const crypto=require('node:crypto');const {Pool}=require('pg');
const {DATABASES,OWNER_KEY,preflight}=require('../../scripts/lib/education-ready-dataset');
const root=path.resolve('output/education-ready/05'),checks=[];let finalPath;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
async function check(name,action){await action();checks.push({name,status:'PASS'});}
async function main(){
    const directories=fs.readdirSync(root).filter(name=>name.startsWith('attempt-')).sort();finalPath=directories.at(-1)+'/verification.json';
    const final=read(finalPath),baseline=read('attempt-2026-10-03T20-13-47-449Z/verification.json');
    await check('All17 final checks are executed and terminal; the original three failures remain red',()=>{
        assert.equal(final.phase,'postfix');assert.equal(final.coverage,'FULL');assert.equal(final.exitCode,0);assert.ok(!final.fatal);
        const expected=['fixtures','F03-two-operators-refresh','F04-direct-report-reload','F06-today-date-race','journal-drafts-navigation-refresh','journal-status-clear-repeat-save-retry','reports-independent-periods-groups-navigation','reports-A-B-A-late-success','reports-A-B-A-late-error','report-error-validation-retry','today-filters-reset-business','journal-refresh-error-keeps-draft','today-A-B-A-late-success','today-A-B-A-late-error','today-current-error-retry-empty','draft-restores-only-edited-child','page-errors'];
        assert.deepEqual(final.checks.map(row=>row.id).sort(),expected.sort());assert.ok(final.checks.every(row=>row.status==='PASS'));assert.deepEqual(final.pageErrors,[]);
        assert.equal(baseline.exitCode,1);for(const id of ['F03-two-operators-refresh','F04-direct-report-reload','F06-today-date-race'])assert.equal(baseline.checks.find(row=>row.id===id).status,'FAIL');
        assert.equal(baseline.proofs.F03.durable.status,'absent');assert.equal(baseline.proofs.F03.ui,'present');assert.deepEqual(baseline.proofs.F04.direct,[]);assert.equal(baseline.proofs.F06.final.loading,true);
    });
    await check('Fresh journal/history, draft protection, report/SQL/specification and real date barriers are proved',()=>{
        assert.equal(final.proofs.F03.ui,'absent');assert.equal(final.proofs.F03.history.at(-1).new_status,'absent');assert.equal(final.proofs.F03.history.at(-1).changed_by,'edu_ready_operator_two');assert.ok(final.proofs.F03.history.at(-1).changed_at);
        assert.deepEqual(final.proofs.F04.expected,final.proofs.F04.api);assert.deepEqual(final.proofs.F04.direct,Object.values(final.proofs.F04.expected).map(String));assert.deepEqual(final.proofs.F04.reload,final.proofs.F04.direct);
        assert.equal(final.proofs.F06.final.loading,false);assert.deepEqual(final.proofs.F06.final.cards.slice().sort(),final.proofs.F06.sql.slice().sort());
        assert.ok(Object.values(final.proofs.draft).every(Boolean));assert.equal(final.proofs.statuses.repeatChanges,0);assert.equal(final.proofs.statuses.retryPuts,1);
        assert.deepEqual(final.proofs.draftMerge,{unsavedEditedChild:'excused',durableEditedChild:'absent',freshOtherChild:'absent'});
        assert.equal(final.proofs.reportMatrix.length,7);const all=final.proofs.reportMatrix.find(row=>row.from==='2026-07-01');assert.equal(all.expected.held+all.expected.cancelled+all.expected.scheduled,36);
        const archive=final.proofs.reportMatrix.find(row=>row.group==='archive');assert.equal(archive.expected.held,3);assert.equal(archive.expected.cancelled,1);
        for(const name of ['todayABASuccess','todayABAError']){assert.ok(final.proofs[name].heldOld>0&&final.proofs[name].heldCurrent>0);assert.deepEqual(final.proofs[name].actual,final.proofs[name].expected);}
        assert.equal(final.reportClock,'2026-10-03T09:00:00Z');
    });
    await check('Every executed runner preserves39 manual bookings; latest UI/backend/navigation runners pass',()=>{
        const runs=fs.readdirSync(root).filter(name=>name.startsWith('runner-')).sort().map(read);
        for(const run of runs){if(!run.suite)continue;assert.equal(run.manualDatasetPreserved.status,'PASS');assert.equal(run.manualDatasetPreserved.ownedBookingCount,39);assert.equal(run.disposableTablesAfterCleanup,0);}
        for(const suite of ['async','attendance','navigation']){const latest=runs.filter(run=>run.suite===suite).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).at(-1);assert.equal(latest.status,'PASS',suite);assert.equal(latest.exitCode,0,suite);}
    });
    await check('Backend contracts, mixed navigation and focused tests have passing logs with no skipped Node cases',()=>{
        for(const [file,count] of [['05-attendance-first.log',3],['05-targeted-directory-final.log',67]]){const log=fs.readFileSync(path.resolve('output/education-ready',file),'utf8');assert.match(log,new RegExp(`# tests ${count}\\b`));assert.match(log,new RegExp(`# pass ${count}\\b`));assert.match(log,/# fail 0/);assert.match(log,/# skipped 0/);}
        const log=fs.readFileSync(path.resolve('output/education-ready/05-navigation.log'),'utf8');assert.match(log,/Education navigation actual-app.*PASS/);
    });
    await check('Current general gate is complete and not a stale previous PASS',()=>{
        const gate=read('npm-test-result.json');assert.equal(gate.log,'05-npm-test-current-final.log');assert.equal(gate.exitCode,0);
        for(const file of ['js/api.js','js/education-schedule.js','js/education-attendance.js','js/education-groups.js'])assert.equal(gate.sourceHashes[file],crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),'Gate source changed: '+file);
        const logPath=path.resolve('output/education-ready',gate.log);assert.ok(Date.parse(gate.completedAt)+5000>=fs.statSync(logPath).mtimeMs,'General gate result predates the current log');
        const log=fs.readFileSync(logPath,'utf8');assert.match(log,/Passed:\s*1327/);assert.match(log,/Failed:\s*0/);assert.ok(!log.includes('not ok '));
    });
    await check('Retained preview is real, reachable and unchanged; production observation is read-only',async()=>{
        const preview=read('preview-readonly/verification.json');assert.equal(preview.status,'PASS');assert.equal(preview.todayCards,4);assert.equal(preview.journalMembers,6);assert.ok(preview.retainedDatasetUnchanged);assert.deepEqual(preview.pageErrors,[]);
        const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});
        try{const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);assert.deepEqual(await preflight(pool,manifest),preview.preflight);}finally{await pool.end();}
        assert.equal((await fetch('http://127.0.0.1:3012/api/health')).status,200);
        const live=read('live-readonly.json');assert.equal(live.status,'READONLY_OBSERVATION_COMPLETE');assert.ok(live.profileAndCabinetUnchanged);assert.deepEqual(live.pageErrors,[]);assert.ok(live.blockedWrites.some(row=>row.path==='/api/wallet/daily-login'));
    });
    await check('Held directory was red, now shows loading, terminates within25 seconds and reloads its filter',()=>{
        const before=read('directory-baseline.json'),after=read('directory-postfix.json');assert.equal(before.status,'FAIL');assert.equal(before.pending.loading,false);assert.equal(before.pending.status,'');
        assert.equal(after.status,'PASS');assert.equal(after.pending.loading,true);assert.match(after.pending.status,/Завантажуємо/);assert.ok(after.boundedErrorMs<25000);assert.ok(after.retainedDatasetUnchanged);assert.deepEqual(after.pageErrors,[]);
    });
    await check('Product scope, protected source, dependency/schema/access boundaries remain unchanged',()=>{
        const product=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(file=>!file.startsWith('tests/'));
        assert.deepEqual(product.sort(),['index.html','js/api.js','js/booking.js','js/education-attendance.js','js/education-groups.js','js/education-schedule.js','routes/bookings.js','routes/education-groups.js','services/educationGroups.js'].sort());
        assert.ok(execFileSync(process.execPath,['scripts/check-timeline-protected-surface.js'],{encoding:'utf8'}).includes('passed'));
        assert.equal(execFileSync('git',['diff','--','package.json','package-lock.json','middleware/auth.js','js/auth.js','db','config/timelineProtectedSurface.js'],{encoding:'utf8'}),'');
    });
    return {status:'PASS',generatedAt:new Date().toISOString(),finalPath,checks,evidenceLevels:{visibleUiChecks:15,fixtureAndPageErrorChecks:2,backendContracts:3,mixedNavigationSuites:1,targetedMixedTests:67},
        sourceHashes:Object.fromEntries(['js/api.js','js/education-schedule.js','js/education-attendance.js','js/education-groups.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),limits:['Production fixes are not deployed','Mobile frames are observations, not responsive/iPhone acceptance','General test counts are not education scenarios']};
}
main().then(result=>{fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify(result,null,2));console.log(`Async evidence consistency PASS: ${checks.length} checks`);})
    .catch(error=>{fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify({status:'FAIL',generatedAt:new Date().toISOString(),finalPath,checks,error:error.message},null,2));console.error(`Async evidence consistency FAIL: ${error.message}`);process.exitCode=1;});
