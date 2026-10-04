'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const root = path.resolve('output/education-ready/06');
const checks = [];
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function check(name, action) { await action(); checks.push({ name, status: 'PASS' }); }
async function main() {
    const index = read('final-evidence.json');
    const visual = read(index.visual + '/verification.json');
    await check('All60 specified visual states ran against unchanged final product source', () => {
        const states = ['today','today-loading','today-error','group-english','group-keyboard-focus','group-archive-hover','group-arts','group-empty','group-archive','group-new','group-saving-disabled','group-error-draft','journal','journal-actions','reports','schedule-day','schedule-week','canonical-card','lesson-edit','lesson-edit-actions','series','lesson-create','education-settings','education-settings-actions','education-settings-page','education-settings-visual','education-settings-presets','education-settings-system','today-empty'];
        const expected = states.flatMap(name => ['dark', 'light'].map(theme => name + '-' + theme + '.png')).concat(['park-reference.png','groups-390-observation.png']);
        assert.equal(visual.status, 'PASS'); assert.equal(visual.phase, 'after');
        assert.deepEqual([...visual.screenshots].sort(), expected.sort());
        assert.equal(visual.audits.length,60); assert.equal(new Set(visual.audits.map(row=>row.label)).size,60);
        for (const file of expected) assert.ok(fs.statSync(path.join(root,index.visual,file)).size>1000);
        for (const [file, digest] of Object.entries(visual.sourceHashes)) assert.equal(hash(file),digest,'Stale visual evidence: '+file);
        assert.equal(Object.keys(visual.sourceHashes).length,10);
        assert.deepEqual(index.sourceHashes,visual.sourceHashes);
        assert.equal(index.harnessHash,hash('tests/browser/education-ready-visual-preview-readonly.js'),'Visual harness changed after proof');
    });
    await check('Computed contrast and action geometry pass; errors/drafts and Park remain explicit', () => {
        assert.deepEqual(visual.contrastFailures,[]); assert.deepEqual(visual.unstyledButtons,[]);
        let observations=0;
        for (const audit of visual.audits) {
            if (audit.label==='park-reference') {
                assert.equal(audit.contrast.length,0,'Education audit must be absent in Park');
                assert.equal(audit.legendVisible,true,'Park legend remains visible');
            } else assert.ok(audit.contrast.length>0,audit.label);
            for (const row of audit.contrast) { assert.equal(typeof row.placeholder,'boolean','Old limited selector audit'); assert.ok(Number.isFinite(row.ratio)&&row.ratio>=row.minimum,JSON.stringify(row)); observations++; }
            if (/^(today|group|journal|reports)/.test(audit.label)) assert.equal(audit.legendVisible||audit.minimapVisible,false);
            if (audit.label.startsWith('schedule')) assert.equal(audit.legendVisible,true);
        }
        assert.ok(observations>500);
        for (const theme of ['dark','light']) {
            const settings=visual.audits.find(row=>row.label==='education-settings-page-'+theme);
            assert.ok(settings.contrast.some(row=>row.selector==='timeline-settings-block-group-title'));
            assert.ok(settings.contrast.some(row=>row.selector==='#timelineSettingsSearch'&&row.placeholder));
        }
        assert.deepEqual(visual.pageErrors,[]); assert.deepEqual(visual.routeErrors,[]);
        assert.deepEqual(visual.failedReads.filter(row=>/^\/api\/(education|bookings)/.test(row.path)&&row.path!==visual.controlledReadFault),[]);
        assert.ok(visual.blockedWrites.some(row=>row.path.replace(/\/$/,'')==='/api/education/groups'));
        assert.deepEqual(visual.parkStyles,read('before-2026-10-03T21-21-06-160Z/verification.json').parkStyles);
        assert.match(visual.smallViewport,/deferred to07/);
    });
    await check('Personally reviewed historical, before and final screenshots retain their hashes', () => {
        const review=read('personal-review.json'); assert.equal(review.status,'REVIEWED');
        for (const [folder,count] of [['history-review',290],['before-review',41],['before-settings-review',11],[index.review,60]]) {
            assert.ok(review.manifests.includes(folder+'/manifest.json'));
            const manifest=read(folder+'/manifest.json'); assert.equal(manifest.count,count);
            for (const frame of manifest.screenshots) assert.equal(hash(frame.path),frame.sha256,'Changed screenshot: '+frame.path);
        }
        assert.match(review.reconstructedBefore,/base SHA/);
        const failed=read('after-2026-10-03T21-55-30-352Z/verification.json');
        assert.equal(failed.status,'FAIL'); assert.equal(failed.contrastFailures.length,2);
        assert.equal(index.previousVisualExitCode,1);
        const expanded=read('after-2026-10-03T22-09-07-279Z/verification.json'); assert.equal(expanded.status,'FAIL'); assert.equal(expanded.contrastFailures.length,14);
    });
    await check('Final group/lifecycle/async checks are executed; every completed reset preserves manual data', () => {
        const expectedIds={
            groups:['fixtures','F01-pending-selection','F02-teacher-retention-on-failure','teacher-source-and-isolation','failed-detail-retry-and-stale-response','teacher-retry-keeps-draft-and-explicit-none','create-double-submit-and-retry','search-enroll-capacity-end-membership-archive','capacity-edit-rejects-too-small-keeps-draft','business-switch-pending-write','late-search-member-and-archive-responses','lesson-teacher-source-failure-and-retry','inactive-assigned-teacher-and-omitted-field','successful-create-list-failure-retry-retains-identity','page-errors'],
            lifecycle:['fixtures','F05-title-only-duration','duration-30-45-60-90-and-invalid','edit-hydration-blocks-premature-input','single-field-edits-preserve-other-fields','full-ui-group-member-create-edit-cancel','catalog-lesson-keeps-edited-duration','canonical-today-day-week','date-api-contract-and-ui-reload','legacy-label-and-linked-roster-remain-distinct','non-education-api-duration-contract','page-errors'],
            async:['fixtures','F03-two-operators-refresh','F04-direct-report-reload','F06-today-date-race','journal-drafts-navigation-refresh','journal-status-clear-repeat-save-retry','reports-independent-periods-groups-navigation','reports-A-B-A-late-success','reports-A-B-A-late-error','report-error-validation-retry','today-filters-reset-business','journal-refresh-error-keeps-draft','today-A-B-A-late-success','today-A-B-A-late-error','today-current-error-retry-empty','draft-restores-only-edited-child','page-errors']
        };
        const expectedCounts={groups:15,lifecycle:12,async:17};
        for (const [suite,count] of Object.entries(expectedCounts)) {
            const result=read(index.regressions[suite]+'/verification.json');
            assert.equal(result.checks.length,count,suite); assert.ok(result.checks.every(row=>row.status==='PASS'),suite);
            assert.deepEqual(result.checks.map(row=>row.id).sort(),expectedIds[suite].sort());
            assert.equal(result.exitCode,0,suite); assert.ok(!result.fatal,suite);
            const runner=read(index.runners[suite]); assert.equal(runner.status,'PASS'); assert.equal(runner.exitCode,0);
            assert.equal(runner.manualDatasetPreserved.ownedBookingCount,39); assert.equal(runner.disposableTablesAfterCleanup,0);
            const latest=fs.readdirSync(path.join(root,'regressions')).filter(file=>file.startsWith('runner-'+suite+'-')).sort().at(-1);
            assert.equal(index.runners[suite],'regressions/'+latest,'Stale suite selection');
        }
        for (const file of fs.readdirSync(path.join(root,'regressions')).filter(file=>file.startsWith('runner-'))) {
            const result=read('regressions/'+file);
            assert.equal(result.manualDatasetPreserved.status,'PASS'); assert.equal(result.manualDatasetPreserved.ownedBookingCount,39);
            assert.equal(result.disposableTablesAfterCleanup,0);
        }
        const runner=read(index.visualRunner); assert.equal(runner.status,'PASS'); assert.equal(runner.exitCode,0);
    });
    await check('General and focused gates completed with zero failed/skipped tests on Node22/npm10', () => {
        assert.equal(index.gates.npmTest.exitCode,0); assert.equal(index.gates.focused.exitCode,0);
        const log=fs.readFileSync(path.resolve('output/education-ready',index.gates.npmTest.log),'utf8');
        assert.match(log,/Passed:\s*1327/); assert.match(log,/Failed:\s*0/); assert.ok(!log.includes('not ok '));
        assert.match(log,/# fail 0/); assert.match(log,/# skipped 0/);
        const focused=fs.readFileSync(path.resolve('output/education-ready',index.gates.focused.log),'utf8');
        assert.match(focused,/# tests 97\b/); assert.match(focused,/# pass 97\b/); assert.match(focused,/# skipped 0/);
        assert.match(log,/Runtime baseline check passed: Node 22\.23\.1 \/ npm 10\.9\.8/);
        const context=read('regressions/runner-context-2026-10-03T21-39-43-579Z.json'); assert.equal(context.status,'PASS'); assert.equal(context.exitCode,0);
        assert.match(fs.readFileSync(path.resolve('output/education-ready/06-context-first.log'),'utf8'),/Education actual-app A→B→A.*PASS/);
        assert.equal(index.gates.acceptance.exitCode,0);
        const acceptance=fs.readFileSync(path.resolve('output/education-ready',index.gates.acceptance.log),'utf8');
        assert.match(acceptance,/# tests 11\b/); assert.match(acceptance,/# pass 11\b/); assert.match(acceptance,/# skipped 0/);
        assert.match(acceptance,/ok \d+ - Park booking uses the canonical detail modal and Escape focus return/);
        const acceptanceRunner=read(index.acceptanceRunner); assert.equal(acceptanceRunner.status,'PASS'); assert.equal(acceptanceRunner.exitCode,0);
        assert.ok(execFileSync(process.execPath,['scripts/check-runtime.js'],{encoding:'utf8'}).includes('22'));
    });
    await check('Live reference is read-only; manual preview survives all disposable runs', async () => {
        const live=read('live-reference/verification.json'); assert.equal(live.status,'READONLY_REFERENCE_COMPLETE');
        assert.equal(live.beforeFingerprint,live.afterFingerprint); assert.ok(live.beforeFingerprint);
        assert.ok(live.blockedWrites.some(row=>row.path==='/api/wallet/daily-login'));
        assert.equal(visual.retainedDatasetUnchanged,true);
        const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});
        try {
            const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);
            const current=await preflight(pool,manifest); assert.deepEqual(current,index.manualPreflight);
            const {reused,...originalPreflight}=read('../02/demo-preflight.json');
            assert.equal(reused,true,'Original loader reuse metadata remains recorded');
            assert.deepEqual(current,originalPreflight,'Retained manual dataset changed since02');
        } finally { await pool.end(); }
        assert.equal((await fetch('http://127.0.0.1:3012/api/health')).status,200);
    });
    await check('Base, protected booking ownership and excluded boundaries are unchanged', () => {
        assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),index.baseSha);
        assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),index.branch);
        assert.ok(execFileSync(process.execPath,['scripts/check-timeline-protected-surface.js'],{encoding:'utf8'}).includes('passed'));
        for (const script of ['check-css-surface.js','check-theme-surface.js','check-static-surface.js']) execFileSync(process.execPath,['scripts/'+script],{encoding:'utf8'});
        assert.equal(execFileSync('git',['diff','--','package.json','package-lock.json','middleware','js/auth.js','db','config/timelineProtectedSurface.js','.github'],{encoding:'utf8'}),'');
        execFileSync('git',['diff','--check'],{encoding:'utf8'});
        for (const file of Object.keys(index.sourceHashes).filter(file=>file.endsWith('.js'))) execFileSync(process.execPath,['--check',file],{encoding:'utf8'});
    });
    return {status:'PASS',generatedAt:new Date().toISOString(),checks,visual:index.visual,sourceHashes:index.sourceHashes,
        levels:{visualFrames:60,groupsChecks:15,lifecycleChecks:12,asyncChecks:17,focusedMixedTests:97,mixedAcceptanceChecks:11},
        limits:['Not a full WCAG certification','Physical mobile/iPhone/tablet acceptance is task07','General checks are not education journeys','No commit/push/deploy; production only read-only']};
}
main().then(result=>{fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify(result,null,2));console.log('Design evidence consistency PASS: '+checks.length+' checks');})
    .catch(error=>{fs.writeFileSync(path.join(root,'verification-summary.json'),JSON.stringify({status:'FAIL',generatedAt:new Date().toISOString(),checks,error:error.message},null,2));console.error('Design evidence consistency FAIL: '+error.message);process.exitCode=1;});
