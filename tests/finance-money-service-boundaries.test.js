'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { createFinanceMoneyService, isLocalManualMoneyEnabled,
    assertLegacyAccountWritable, assertLegacyBookingWritable } = require('../services/financeMoneyMovements');

function withLocalEnvironment(run) {
    const keys = [...new Set(['NODE_ENV', 'ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER', 'RAILWAY_PROJECT_ID',
        ...Object.keys(process.env).filter(key => key.startsWith('RAILWAY_'))])];
    const saved = new Map(keys.map(key => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    process.env.NODE_ENV = 'test';
    process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER = 'true';
    return Promise.resolve().then(run).finally(() => {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

const LOCAL_OPTIONS = { host: '127.0.0.1', database: 'eventgenix_disposable_money', user: 'synthetic_no_connect' };

test('manual money gate inspects effective pg configuration and requires every local boundary', async t => {
    await withLocalEnvironment(async () => {
        assert.equal(isLocalManualMoneyEnabled({ options: LOCAL_OPTIONS }), true);
        assert.equal(isLocalManualMoneyEnabled(new Client(LOCAL_OPTIONS)), true, 'transaction clients use the same gate');
        for (const database of ['eventgenix', 'eventgenix_production_test', 'prod_test', 'live_test', 'railway_test', 'test_primary-db']) {
            assert.equal(isLocalManualMoneyEnabled({ options: { ...LOCAL_OPTIONS, database } }), false, database);
        }
        for (const host of ['db.example.invalid', '10.0.0.1', 'primary-db', '/tmp']) {
            assert.equal(isLocalManualMoneyEnabled({ options: { ...LOCAL_OPTIONS, host } }), false, host);
        }
        assert.equal(isLocalManualMoneyEnabled({ options: { ...LOCAL_OPTIONS,
            connectionString: 'postgresql://synthetic:synthetic@db.example.invalid:5432/eventgenix_ci' } }), false,
        'connectionString overrides safe-looking discrete settings');
        assert.equal(isLocalManualMoneyEnabled({ options: {
            connectionString: 'postgresql://synthetic:synthetic@127.0.0.1:5432/eventgenix_testing' } }), true);
        assert.equal(isLocalManualMoneyEnabled({}), false);
        process.env.RAILWAY_PROJECT_ID = 'synthetic-denial-marker';
        assert.equal(isLocalManualMoneyEnabled({ options: LOCAL_OPTIONS }), false);
        delete process.env.RAILWAY_PROJECT_ID;
        process.env.NODE_ENV = 'production';
        assert.equal(isLocalManualMoneyEnabled({ options: LOCAL_OPTIONS }), false);
        process.env.NODE_ENV = 'test';
        delete process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER;
        assert.equal(isLocalManualMoneyEnabled({ options: LOCAL_OPTIONS }), false);
    });
    await t.test('disabled reads, writes and compatibility helpers never reach a database', async () => {
        await withLocalEnvironment(async () => {
            process.env.NODE_ENV = 'production';
            const pool = { options: LOCAL_OPTIONS,
                connect() { assert.fail('disabled manual service must not connect'); },
                query() { assert.fail('disabled legacy helper must not query new tables'); } };
            const service = createFinanceMoneyService(pool);
            const denied = error => error.status === 403 && error.code === 'MANUAL_MONEY_UNAVAILABLE';
            await assert.rejects(service.getWorkspace({ businessContext: 'event_genix' }), denied);
            await assert.rejects(service.getBookingSummary({ businessContext: 'event_genix', bookingId: 'synthetic' }), denied);
            await assert.rejects(service.execute({ businessContext: 'event_genix', actor: { id: 1 } }, {}), denied);
            await assertLegacyAccountWritable(pool, 'event_genix', 1);
            await assertLegacyBookingWritable(pool, 'event_genix', 'synthetic');
        });
    });
});

test('manual command validation rejects ambiguous amounts, dates and fields before acquiring a client', async () => {
    await withLocalEnvironment(async () => {
        let connectCalls = 0;
        const pool = { options: LOCAL_OPTIONS, async connect() {
            connectCalls++;
            throw new Error('VALIDATED_REQUEST_CONNECT_BOUNDARY');
        } };
        const service = createFinanceMoneyService(pool);
        const context = { businessContext: 'event_genix', actor: { id: 1 } };
        const base = { command: 'income', idempotencyKey: 'synthetic-validation', accountId: 1, categoryId: 2, amountMinor: '100' };
        for (const amountMinor of [100, 100n, '1.01', '-1', '+1', ' 100', '1e2', '', '0', '9223372036854775808']) {
            await assert.rejects(service.execute(context, { ...base, amountMinor }), error => error.status === 400 && error.code === 'AMOUNT_INVALID');
        }
        for (const effectiveAt of ['2026-10-07', '2026-10-07T10:00:00', '2026-02-30T10:00:00Z', '2026-10-07T24:00:00Z']) {
            await assert.rejects(service.execute(context, { ...base, effectiveAt }), error => error.status === 400 && error.code === 'EFFECTIVE_TIME_INVALID');
        }
        await assert.rejects(service.execute(context, { ...base, force: true }), error => error.code === 'COMMAND_FIELDS_INVALID');
        await assert.rejects(service.execute(context, { ...base, command: 'delete' }), error => error.code === 'COMMAND_INVALID');
        await assert.rejects(service.execute(context, { ...base, idempotencyKey: ' ' }), error => error.status === 400);
        await assert.rejects(service.execute(context, { ...base, accountId: 2147483648 }), error => error.code === 'ID_INVALID');
        await assert.rejects(service.execute(context, { command: 'transfer', idempotencyKey: 'same', accountId: 1,
            toAccountId: 1, amountMinor: '100', reason: 'Synthetic' }), error => error.code === 'SAME_ACCOUNT_TRANSFER');
        assert.equal(connectCalls, 0);
        await assert.rejects(service.execute(context, { ...base, amountMinor: '9223372036854775807',
            effectiveAt: '2026-10-07T10:00:00+03:00' }), /VALIDATED_REQUEST_CONNECT_BOUNDARY/);
        await assert.rejects(service.execute(context, { command: 'enroll', idempotencyKey: 'zero', accountId: 1,
            openingMinor: '0', reason: 'Explicit counted zero' }), /VALIDATED_REQUEST_CONNECT_BOUNDARY/);
        assert.equal(connectCalls, 2);
    });
});
