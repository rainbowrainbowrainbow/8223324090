'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const root = path.resolve('output/education-ready/07');
const results = [];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function local(file) { const target = path.resolve(root, file); assert.ok(target.startsWith(root + path.sep), 'Evidence outside07'); return target; }
const read = file => JSON.parse(fs.readFileSync(local(file), 'utf8').replace(/^\uFEFF/, ''));
async function check(name, action) { await action(); results.push({ name, status: 'PASS' }); }
(async () => {
    const index = read('final-evidence.json');
    const profiles = ['phone-320','iphone-390','phone-landscape','tablet-768','tablet-landscape','reflow-200'];
    const states = ['today','groups','enroll','journal','journal-save','reports','schedule','week','card','edit','edit-save','series','settings-modal','settings-page','settings-visual','settings-presets','settings-system'];
    const expected = profiles.flatMap(profile => states.map(state => `${profile}-${['iphone-390','tablet-landscape'].includes(profile) ? 'dark' : 'light'}-${state}`))
        .concat(['iphone-390-dark-save-error','iphone-390-dark-empty','iphone-390-dark-error']).sort();
    await check('Two real engines completed all6 profiles/105 screens/675 assertions with current sources', () => {
        for (const engine of ['chromium','webkit']) {
            const evidence = read(index.engines[engine] + '/verification.json');
            assert.equal(evidence.engine, engine); assert.equal(evidence.status, 'PASS'); assert.equal(evidence.exitCode, 0);
            assert.deepEqual(evidence.profiles.map(p => p.name), profiles); assert.deepEqual(evidence.completedProfiles, profiles);
            assert.deepEqual(evidence.screens.map(s => s.name).sort(), expected); assert.equal(evidence.checks.length, 675);
            assert.ok(evidence.checks.every(c => c.status === 'PASS')); assert.equal(evidence.harnessHash, hash('tests/browser/education-ready-mobile-browser.js'));
            for (const [file, digest] of Object.entries(evidence.sourceHashes)) assert.equal(hash(file), digest, 'Stale product proof: ' + file);
            for (const screen of evidence.screens) {
                assert.ok(fs.statSync(local(index.engines[engine] + '/' + screen.file)).size > 1000);
                const audit = screen.audit;
                assert.ok(audit.documentWidth <= audit.width + 1); assert.deepEqual(audit.overflow, []); assert.deepEqual(audit.missingNames, []); assert.deepEqual(audit.tinyTextInputs, []); assert.deepEqual(audit.unexpectedFonts, []);
                assert.ok(audit.controls.every(c => c.width >= 44 && c.height >= 44)); assert.ok(audit.inputBoundaries.every(c => Number.isFinite(c.ratio) && c.ratio >= 3));
                assert.ok(audit.viewportMeta && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i.test(audit.viewportMeta));
            }
            assert.deepEqual(evidence.pageErrors, []);
            assert.ok(evidence.failedReads.every(r => r.path === '/api/bookings/2030-01-30' && r.status === 503));
            assert.ok(evidence.blockedWrites.some(r => r.method === 'POST' && /^\/api\/education\/groups\/?$/.test(r.path)));
            assert.equal(evidence.datasetUnchanged, true);
        }
    });
    await check('Mobile writes have independent API/SQL regressions; Park/mixed acceptance stays separately counted', () => {
        const counts = { groups: 15, lifecycle: 12, async: 17 };
        for (const [suite, count] of Object.entries(counts)) {
            const data = read(index.regressions[suite] + '/verification.json');
            assert.equal(data.checks.length, count); assert.ok(data.checks.every(c => c.status === 'PASS'));
            assert.deepEqual(data.viewport, { width: 390, height: 844 }); assert.deepEqual(data.pageErrors, []);
        }
        const acceptance = fs.readFileSync(local(index.acceptanceLog), 'utf8');
        assert.match(acceptance, /# tests 11/); assert.match(acceptance, /# pass 11/); assert.match(acceptance, /# fail 0/); assert.match(acceptance, /# skipped 0/);
        const commands = read('suite-command-results.json');
        assert.deepEqual(commands.map(r => r.suite), ['groups','lifecycle','async','acceptance','visual']); assert.ok(commands.every(r => r.exitCode === 0));
        const matrix = read('font-final-command-results.json');
        assert.deepEqual(matrix.map(r => r.engine), ['webkit','chromium']); assert.ok(matrix.every(r => r.exitCode === 0));
    });
    await check('Fresh computed text contrast and Park visual reference remain green', () => {
        assert.equal(index.visualHarnessHash, hash('tests/browser/education-ready-visual-preview-readonly.js'));
        const visual = read(index.visual + '/verification.json'); assert.equal(visual.status, 'PASS'); assert.equal(visual.screenshots.length, 60);
        assert.deepEqual(visual.contrastFailures, []); assert.deepEqual(visual.unstyledButtons, []); assert.deepEqual(visual.pageErrors, []); assert.deepEqual(visual.routeErrors, []);
        for (const [file, digest] of Object.entries(visual.sourceHashes)) assert.equal(hash(file), digest, 'Stale contrast proof');
        const parkBaseline = JSON.parse(fs.readFileSync(path.resolve(root, '../06/before-2026-10-03T21-21-06-160Z/verification.json'), 'utf8'));
        assert.deepEqual(visual.parkStyles, parkBaseline.parkStyles);
    });
    await check('Personal screenshot review is hash-bound; initial failures remain failures', () => {
        const review = read('personal-review.json'); assert.equal(review.personallyReviewed, true);
        const reviewed = new Set();
        for (const folder of review.manifests) {
            const manifest = read(folder); assert.ok(manifest.count > 0);
            for (const item of manifest.screenshots) {
                assert.equal(hash(item.path), item.sha256, 'Screenshot changed after review');
                reviewed.add(path.resolve(item.path));
            }
        }
        for (const folder of [...Object.values(index.engines), index.visual, ...Object.values(index.regressions)]) {
            for (const file of fs.readdirSync(local(folder)).filter(file => file.endsWith('.png'))) {
                assert.ok(reviewed.has(local(folder + '/' + file)), 'Final screenshot was not personally reviewed: ' + file);
            }
        }
        const baseline = read('baseline-chromium-2026-10-03T23-04-46-493Z/verification.json');
        assert.equal(baseline.exitCode, 1); assert.equal(baseline.status, 'FAIL'); assert.ok(baseline.checks.some(c => c.status === 'FAIL'));
        assert.equal(read('after-chromium-2026-10-03T23-18-56-613Z/verification.json').exitCode, 1, 'Measured boundary RED must remain RED');
    });
    await check('Every selected disposable run retained39 manual bookings and cleaned only its owned DB', async () => {
        for (const file of index.runners) {
            const runner = read(file); assert.equal(runner.status, 'PASS'); assert.equal(runner.exitCode, 0);
            assert.equal(runner.manualDatasetPreserved.status, 'PASS'); assert.equal(runner.manualDatasetPreserved.ownedBookingCount, 39); assert.equal(runner.disposableTablesAfterCleanup, 0);
        }
        const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DATABASES.demo, ssl: false });
        try {
            const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value);
            assert.deepEqual(await preflight(pool, manifest), index.manualPreflight);
        } finally { await pool.end(); }
    });
    await check('Runtime/general gates completed without protected/config/dependency drift', () => {
        for (const [file, digest] of Object.entries(index.logHashes)) assert.equal(hash(local(file)), digest, 'Final log changed');
        assert.ok(read('final-guards-command-results.json').every(row => row.exitCode === 0));
        const log = fs.readFileSync(local(index.npmLog), 'utf8'); assert.equal(index.npmExitCode, 0);
        assert.match(log, /Node 22\.23\.1 \/ npm 10\.9\.8/); assert.match(log, /# tests 3484/); assert.match(log, /# pass 3484/); assert.match(log, /Passed: 1327/); assert.match(log, /Failed: 0/);
        assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(), '56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e');
        assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8',windowsHide:true}).trim(), 'codex/education-ready-pack-20261003');
        assert.equal(execFileSync('git',['diff','--name-only','--','package.json','package-lock.json','middleware','db','js/auth.js','.github','config/timelineProtectedSurface.js'],{encoding:'utf8',windowsHide:true}).trim(), '');
        execFileSync(process.execPath, ['scripts/check-timeline-protected-surface.js'], { windowsHide: true });
        execFileSync('git', ['diff','--check'], { windowsHide: true });
    });
})().catch(error => { results.push({ name: 'Missing/incomplete/stale evidence', status: 'FAIL', error: error.message }); process.exitCode = 1; })
    .finally(() => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root,'verification-summary.json'), JSON.stringify({ checks: results, exitCode: process.exitCode || 0 }, null, 2)); console.log(results.map(r => `${r.status} ${r.name}`).join('\n')); });
