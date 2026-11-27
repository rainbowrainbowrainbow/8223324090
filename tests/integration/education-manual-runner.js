'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');

const browser = name => `tests/browser/${name}.js`;
const integration = name => `tests/integration/${name}.js`;
const attendance = integration('education-ready-attendance.integration.test');
const series = integration('education-series.integration.test');
const acceptance = integration('education-series.integration-acceptance.test');
const asyncBrowser = browser('education-ready-async-browser');
const readySuites = {
    acceptance,
    submit: browser('education-group-submit-actual-app-browser-smoke'),
    context: browser('education-context-actual-app-browser-smoke')
};
const attendanceSuites = {
    closeAttendance: browser('education-close-attendance-browser'),
    attendance, async: asyncBrowser, series, acceptance,
    journey: browser('education-ready-final-journey')
};
const closeSuites = {
    ...attendanceSuites,
    mobile: browser('education-ready-mobile-browser'),
    ux: browser('education-close-ux-browser'),
    date: browser('education-ready-date-browser'),
    editor: browser('education-ready-editor-readonly')
};
const profiles = {
    'ready-dataset': { stage: '02', defaultSuite: 'dataset',
        suites: { dataset: browser('education-ready-dataset-browser') } },
    'ready-groups': { stage: '03', defaultSuite: 'groups',
        suites: { ...readySuites, groups: browser('education-ready-groups-browser') } },
    'ready-lifecycle': { stage: '04', defaultSuite: 'groups',
        suites: { ...readySuites, groups: browser('education-ready-lifecycle-browser'), series } },
    'ready-async': { stage: '05', defaultSuite: 'async',
        suites: { ...readySuites, async: asyncBrowser, attendance, navigation: browser('education-navigation-actual-app-browser-smoke'), series } },
    'ready-design': { stage: '06', defaultSuite: 'async',
        suites: { ...readySuites, async: asyncBrowser, attendance, navigation: browser('education-navigation-actual-app-browser-smoke'), series,
            groups: browser('education-ready-groups-browser'), lifecycle: browser('education-ready-lifecycle-browser'),
            teachers: browser('education-ready-teachers-browser'), mobile: closeSuites.mobile, date: closeSuites.date,
            editor: closeSuites.editor, journey: attendanceSuites.journey, visual: browser('education-ready-visual-preview-readonly') } },
    'close-teachers': { stage: 'CLOSE01', defaultSuite: 'closeTeachers',
        suites: { closeTeachers: browser('education-close-teachers-browser') } },
    'close-attendance': { stage: 'CLOSE02', defaultSuite: 'closeAttendance', suites: attendanceSuites },
    'close-ux': { stage: 'CLOSE03', defaultSuite: 'closeAttendance',
        suites: { ...closeSuites, visual: browser('education-ready-visual-preview-readonly') } },
    'close-visual': { stage: 'CLOSE03', defaultSuite: 'closeAttendance',
        suites: { ...closeSuites, visual: browser('education-close-visual-browser') } }
};
const testDb = database => new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database, ssl: false });

async function manualProof() {
    const pool = testDb(DATABASES.demo);
    try {
        const marker = (await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value;
        const manifest = JSON.parse(marker);
        const ownedBookingCount = (await pool.query('SELECT count(*)::int n FROM bookings WHERE id=ANY($1::text[])',
            [[...Object.values(manifest.ids.bookings), manifest.ids.controlBooking]])).rows[0].n;
        return { owner: manifest.owner, hash: manifest.hash, anchorDate: manifest.anchorDate, ownedBookingCount, marker,
            preflight: await preflight(pool, manifest) };
    } finally {
        await pool.end();
    }
}

function runEducationManualSuite(runnerFile, profile) {
    const { stage: defaultStage, defaultSuite, suites } = profiles[profile];
    const close = defaultStage.startsWith('CLOSE');
    const design = profile === 'ready-design';
    const dataset = profile === 'ready-dataset';
    const stagedRun = close || design;
    const stage = design && ['07', '08A', '08B', '08'].includes(process.env.EDU_READY_STAGE)
        ? process.env.EDU_READY_STAGE : defaultStage;
    const output = 'output/education-ready/' + (close ? stage.toLowerCase() : stage);
    const out = stagedRun ? path.resolve(process.env.EDU_READY_RUN_ROOT || output, 'regressions') : path.resolve(output);
    if (stagedRun) assert.ok(out.startsWith(path.resolve('output/education-ready') + path.sep), 'Evidence must remain in education output');
    const evidence = { startedAt: new Date().toISOString(), status: 'NOT RUN' };
    if (stagedRun) Object.assign(evidence, { stage, engine: process.env.EDU_MOBILE_ENGINE || 'chromium',
        phoneWrites: process.env.EDU_READY_PHONE === 'true' });
    const hasReportClock = stagedRun || stage === '05';
    const tracksHashes = close && stage !== 'CLOSE01';
    const failureMessage = stagedRun ? `Education checks contain FAIL/BLOCKED; see ${output}/**/verification.json`
        : dataset ? `Dataset checks contain FAIL/BLOCKED; see ${output}/fixed/verification.json`
            : `${hasReportClock ? 'Async' : 'Groups'} checks contain FAIL/BLOCKED; see ${output}/attempt-*/verification.json`;
    return (async () => {
        const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(database.databaseName, DATABASES.fixed);
        assert.equal(database.hostname, '127.0.0.1');
        assert.equal(database.url.port, '55469');
        const before = await manualProof();
        const fixedSuite = dataset || stage === 'CLOSE01';
        const suite = (fixedSuite ? undefined : process.env[close ? 'EDU_CLOSE_SUITE' : 'EDU_READY_SUITE']) || defaultSuite;
        assert.ok(Object.hasOwn(suites, suite), hasReportClock ? 'Unknown async suite' : 'Unknown groups suite');
        if (!dataset) evidence.suite = suite;
        if (stagedRun && suite === 'visual') process.env.EDU_VISUAL_PHASE ||= 'after';
        const files = ['services/educationAttendance.js', 'routes/education-attendance.js', 'js/education-attendance.js',
            'routes/bookings.js', 'js/booking.js', 'scripts/lib/education-ready-dataset.js',
            'tests/helpers/education-ready-report-clock.js', runnerFile, __filename, suites[suite]];
        if (stage === 'CLOSE03') files.push('css/education-schedule.css', 'index.html', 'js/timeline-settings-page.js', 'js/education-schedule.js');
        if (profile === 'close-visual' && suite === 'visual') files.push('tests/browser/education-ready-visual-preview-readonly.js');
        const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
        if (tracksHashes) evidence.sourceHashes = hashes();
        const lock = await acquireIsolatedDatabaseLock(database);
        const preloads = ['scripts/lib/education-ready-loopback.js'];
        if (hasReportClock) preloads.push('tests/helpers/education-ready-report-clock.js');
        Object.assign(process.env, { EDU_READY_MODE: 'fixed', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION',
            PGHOST: '127.0.0.1', PGPORT: '55469', PGDATABASE: DATABASES.fixed, BACKUP_OUTBOUND_HOLD: 'true',
            NODE_OPTIONS: preloads.map(file => `--require="${path.resolve(file).replace(/\\/g, '/')}"`).join(' ') });
        if (hasReportClock) Object.assign(process.env, { ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
            EDU_NAVIGATION_OUTPUT: path.join(out, 'navigation'),
            EDU_ACCEPTANCE_OUTPUT: ['08B', '08'].includes(stage) ? path.join(out, 'acceptance', `attempt-${evidence.startedAt.replace(/[:.]/g, '-')}`)
                : path.join(out, 'acceptance'),
            EDU_READY_REPORT_NOW: '2026-10-03T09:00:00Z' });
        if (stagedRun) process.env.EDU_READY_OUTPUT = path.join(out, suite);
        try {
            await runSuite(database, suites[suite], `education-ready-${suite}`);
            evidence.status = 'PASS';
        } finally {
            try {
                const after = await manualProof();
                assert.deepEqual(after, before, 'Disposable cleanup changed retained manual dataset');
                if (tracksHashes) {
                    assert.deepEqual(hashes(), evidence.sourceHashes, 'Source/harness changed during verification');
                    evidence.sourceStable = true;
                }
                evidence.manualDatasetPreserved = { status: 'PASS', hash: after.hash, ownedBookingCount: after.ownedBookingCount };
                const pool = testDb(DATABASES.fixed);
                try {
                    evidence.disposableTablesAfterCleanup = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
                    assert.equal(evidence.disposableTablesAfterCleanup, 0);
                } finally {
                    await pool.end();
                }
            } finally {
                await lock.release();
            }
        }
    })().catch(error => {
        evidence.status = 'FAIL_OR_BLOCKED';
        evidence.errorType = error.name;
        console.error(failureMessage);
        process.exitCode = 1;
    }).finally(() => {
        fs.mkdirSync(out, { recursive: true });
        evidence.exitCode = process.exitCode || 0;
        const text = JSON.stringify(evidence, null, 2);
        fs.writeFileSync(path.join(out, 'fixed-runner-result.json'), text);
        if (!dataset) fs.writeFileSync(path.join(out, `runner-${evidence.suite || 'blocked'}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`), text);
    });
}

module.exports = { runEducationManualSuite };
