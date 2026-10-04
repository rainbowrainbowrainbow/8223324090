'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FixtureBlocked, createResults } = require('./helpers/education-ready-results');

test('failed UI step cannot become a lifecycle PASS via a later independent fixture', async () => {
    const report = createResults();
    await report.check('create-ui', 'UI create', () => { throw new Error('Teacher is unavailable'); });
    await report.check('api-fixture', 'Independent fixture', () => ({ id: 7 }));
    let ran = false;
    await report.check('lifecycle', 'Lifecycle continuation', () => { ran = true; }, { dependsOn: ['create-ui'] });
    assert.equal(ran, false);
    assert.deepEqual(report.results.map(row => row.status), ['FAIL', 'PASS', 'BLOCKED_DEPENDENCY']);
    assert.equal(report.exitCode(), 1);
});

test('missing fixture is explicitly blocked and cannot produce successful process exit', async () => {
    const report = createResults();
    await report.check('report', 'Report', () => { throw new FixtureBlocked('Expected roster is missing'); });
    assert.equal(report.results[0].status, 'BLOCKED_FIXTURE');
    assert.equal(report.exitCode(), 1);
});

test('unexecuted or unknown prerequisite blocks downstream checks', async () => {
    const report = createResults();
    assert.equal(report.exitCode(), 1);
    await report.check('edit', 'Edit', () => assert.fail('Must not execute'), { dependsOn: ['create'] });
    assert.equal(report.results[0].status, 'BLOCKED_DEPENDENCY');
});

test('only completed assertions can produce successful exit and retain independent proof', async () => {
    const report = createResults();
    await report.check('create', 'Create', () => { assert.equal(45, 45); return { duration: 45 }; });
    await report.check('edit', 'Edit', () => { assert.equal(45, 45); }, { dependsOn: ['create'] });
    assert.equal(report.exitCode(), 0);
    assert.equal(report.results[0].detail.duration, 45);
});
