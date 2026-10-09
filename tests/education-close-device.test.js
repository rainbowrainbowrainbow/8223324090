'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DATABASES, assertLocalTarget, buildPlan } = require('../scripts/lib/education-ready-dataset');
const { safeEnvironment } = require('../scripts/start-education-ready-preview');
const { DB, OWNER, ROOT, APP_PORT, LAN_PORT, writePolicy } = require('../scripts/lib/education-close-device');
const { owned } = require('../scripts/start-education-close-device-preview');
const { createGateway } = require('../scripts/lib/education-device-gateway');
const { template, evaluate } = require('../scripts/lib/education-device-acceptance');
test('CLOSE05 target cannot resolve to retained/disposable/production database', () => {
    const env = { ...safeEnvironment(DB), EDU_CLOSE_DEVICE_CONFIRM: 'OWNED_CLOSE_DEVICE_PREVIEW_05' };
    assert.equal(assertLocalTarget('closeDevices', env).database, DB);
    for (const change of [{ PGDATABASE: DATABASES.demo }, { PGDATABASE: DATABASES.devices }, { PGDATABASE: DATABASES.fixed },
        { EDU_CLOSE_DEVICE_CONFIRM: '' }, { PGHOST: '192.168.1.2' }, { PGPORT: '5432' }, { DATABASE_URL: 'forbidden' }, { NODE_ENV: 'production' }]) {
        assert.throws(() => assertLocalTarget('closeDevices', { ...env, ...change }));
    }
    assert.equal(buildPlan('closeDevices', '2026-10-07').lessons.length, 38);
});
test('CLOSE05 process guard enforces loopback and refuses outbound integrations', () => {
    const env = { ...safeEnvironment(DB), EDU_CLOSE_DEVICE_CONFIRM: 'OWNED_CLOSE_DEVICE_PREVIEW_05' };
    const script = "const a=require('node:assert/strict');a.throws(()=>fetch('https://outside.invalid'),/blocked outbound HTTP/);a.throws(()=>require('node:net').connect({host:'8.8.8.8',port:443}),/blocked outbound TCP/);";
    assert.equal(spawnSync(process.execPath, ['-e', script], { env, windowsHide: true }).status, 0);
    assert.notEqual(spawnSync(process.execPath, ['-e', ''], { env: { ...env, EDU_CLOSE_DEVICE_CONFIRM: '' }, windowsHide: true, stdio: 'ignore' }).status, 0);
});
test('CLOSE05 registry rejects old device DB, different worktree and port', () => {
    const marker = { owner: OWNER, database: DB, worktree: ROOT, postgresPort: 55469 };
    assert.deepEqual(owned(marker), marker);
    for (const change of [{ database: DATABASES.devices }, { owner: 'EDU-READY-08C-v1' }, { worktree: 'C:/wrong' }, { postgresPort: 5432 }]) assert.throws(() => owned({ ...marker, ...change }));
});
test('CLOSE05 gateway supports teachers and new customer-child UI without providers or accounts', () => {
    for (const [method, url] of [['POST', '/api/education/groups/teachers'], ['POST', '/api/customers/'], ['PUT', '/api/education/attendance/1']]) assert.equal(writePolicy(method, url), true);
    for (const url of ['/api/users', '/api/staff', '/api/messages', '/api/customers/1', '/api/customers/export', '/api/payments', '/api/bookings/1/payment']) assert.equal(writePolicy('POST', url), false);
    assert.equal(APP_PORT, 3015); assert.equal(LAN_PORT, 3016);
    assert.throws(() => createGateway({ host: '0.0.0.0', appPort: APP_PORT, lanPort: LAN_PORT, writePolicy }));
});
test('42 old/emulated claims cannot become physical PASS; actual failure is nonzero', () => {
    const report = template({ anchorDate: '2026-10-07', sourceHashes: {} });
    for (const device of report.devices) for (const item of device.checks) item.status = 'PASS';
    assert.equal(evaluate(report, () => {}).exitCode, 2); assert.equal(evaluate(report, () => {}).counts.unverified, 42);
    const device = report.devices[0]; Object.assign(device, { physicalConfirmed: true, model: 'Validator fixture', osName: 'iOS', osVersion: 'fixture', browserName: 'Safari', browserVersion: 'fixture', operator: 'fixture', observedAt: new Date().toISOString() });
    device.checks[0].status = 'FAIL'; device.checks[0].actual = 'Validator-only observed failure'; assert.equal(evaluate(report, () => {}).exitCode, 1);
});
