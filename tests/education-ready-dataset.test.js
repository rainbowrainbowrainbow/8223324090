'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DATABASES, FIXED_ANCHOR, assertLocalTarget, buildPlan, kyivDate, roster, expectedReport, addDays } = require('../scripts/lib/education-ready-dataset');
const env = { NODE_ENV: 'test', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION', PGHOST: '127.0.0.1', PGPORT: '55469', PGDATABASE: DATABASES.demo };
test('seed refuses remote, wrong port, unknown DB and production aliases', () => {
    assertLocalTarget('demo', env);
    for (const override of [{ PGHOST: 'example.com' }, { PGPORT: '5432' }, { PGDATABASE: 'production' },
        { DATABASE_URL: 'configured' }, { NODE_ENV: 'production' }, { RAILWAY_PROJECT_ID: 'configured' }])
        assert.throws(() => assertLocalTarget('demo', { ...env, ...override }));
    assert.throws(() => assertLocalTarget('fixed', { ...env, PGDATABASE: DATABASES.fixed }));
});
test('fixed fixture remains identical and Kyiv date handles midnight and DST boundaries', () => {
    assert.deepEqual(buildPlan('fixed'), buildPlan('fixed'));
    assert.equal(buildPlan('fixed').anchorDate, FIXED_ANCHOR);
    assert.equal(kyivDate(new Date('2026-10-03T21:30:00Z')), '2026-10-04');
    assert.equal(kyivDate(new Date('2026-01-03T21:30:00Z')), '2026-01-03');
    assert.throws(() => addDays('2026-02-30', 0));
});
test('fixture covers full/empty/archive, membership replacement and independent historical totals', () => {
    const plan = buildPlan('fixed');
    assert.equal(plan.lessons.filter(row => row.context === 'dar').length, 36);
    assert.equal(plan.children.filter(row => row.context === 'dar').length, 24);
    assert.deepEqual([...new Set(plan.lessons.map(row => row.duration))].sort((a, b) => a - b), [30, 45, 60, 90]);
    assert.equal(roster(plan, 'empty', plan.anchorDate).length, 0);
    assert.equal(roster(plan, 'english', plan.anchorDate).length, 6);
    assert.equal(roster(plan, 'archive', plan.anchorDate).length, 0);
    assert.ok(roster(plan, 'english', addDays(plan.anchorDate, -21)).includes('child-0'));
    assert.ok(!roster(plan, 'english', addDays(plan.anchorDate, -7)).includes('child-0'));
    const result = expectedReport(plan, 'dar', addDays(plan.anchorDate, -60), addDays(plan.anchorDate, -1));
    assert.deepEqual(result.summary, { held: 18, cancelled: 2, scheduled: 0, journalsNotStarted: 5, present: 38, absent: 13, excused: 9, unmarked: 18 });
});
test('retained manual name is rejected by the existing disposable reset guard', () => {
    const { assertSafeTestDatabaseUrl } = require('../scripts/test-db-safety');
    assert.throws(() => assertSafeTestDatabaseUrl(`postgres://localhost:55469/${DATABASES.demo}`, {
        TEST_DATABASE_RESET_CONFIRM: 'RESET_DISPOSABLE_TEST_DATABASE' }), /name must contain/);
});
test('preview subprocess blocks outbound HTTP, fetch and TCP while its environment excludes providers', () => {
    const { spawnSync } = require('node:child_process');
    const { safeEnvironment } = require('../scripts/start-education-ready-preview');
    const childEnv = safeEnvironment(DATABASES.demo);
    assert.equal(childEnv.BACKUP_OUTBOUND_HOLD, 'true');
    assert.equal(childEnv.OPENAI_API_KEY, undefined); assert.equal(childEnv.DATABASE_URL, undefined);
    const code = `const assert=require('node:assert/strict');
        assert.throws(()=>fetch('https://example.invalid'),/blocked outbound HTTP/);
        assert.throws(()=>require('node:https').get('https://example.invalid'),/blocked outbound HTTP/);
        assert.throws(()=>require('node:net').connect({host:'8.8.8.8',port:443}),/blocked outbound TCP/);
        console.log('Outbound guards PASS');`;
    const result = spawnSync(process.execPath, ['-e', code], { env: childEnv, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    assert.match(result.stdout, /Outbound guards PASS/);
});
