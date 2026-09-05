'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
    DATABASES,
    assertExactDatabaseName,
    assertManualQaEnvironment,
    isLoopback,
    safeChildEnvironment
} = require('../scripts/start-catalog-sale-manual-ui');

const ROOT = path.join(__dirname, '..');

test('manual UI runner allows only exact disposable loopback databases', () => {
    assert.equal(isLoopback('127.0.0.1'), true);
    assert.equal(isLoopback('localhost'), true);
    assert.equal(isLoopback('db.example.test'), false);
    assert.equal(assertExactDatabaseName(DATABASES.event_genix), DATABASES.event_genix);
    assert.equal(assertExactDatabaseName(DATABASES.dar), DATABASES.dar);
    assert.throws(() => assertExactDatabaseName('eventgenix_checkbox_fullstack_test'), /exact manual-QA allowlist/);
    assert.deepEqual(assertManualQaEnvironment({ PGHOST: '127.0.0.1', PGPORT: '55443' }), {
        host: '127.0.0.1', port: 55443, user: 'postgres', password: ''
    });
    assert.throws(() => assertManualQaEnvironment({ PGHOST: 'railway.example', PGPORT: '5432' }), /loopback/);
    assert.throws(() => assertManualQaEnvironment({ PGHOST: '127.0.0.1', PGPORT: '5432', DATABASE_URL: 'postgresql://127.0.0.1/other_test' }), /DATABASE_URL must be unset/);
    assert.throws(() => assertManualQaEnvironment({ PGHOST: '127.0.0.1', PGPORT: '5432', RAILWAY_ENVIRONMENT: 'production' }), /Production and Railway/);
});

test('manual UI child environment scrubs inherited production and Checkbox settings', () => {
    const env = safeChildEnvironment({
        DATABASE_URL: 'forbidden',
        PRODUCTION_DATABASE_URL: 'forbidden',
        RAILWAY_PROJECT_ID: 'forbidden',
        CHECKBOX_REAL_LICENSE_KEY: 'forbidden',
        TELEGRAM_BOT_TOKEN: 'forbidden',
        OPENAI_API_KEY: 'forbidden',
        SAFE_VALUE: 'kept'
    }, { CHECKBOX_EXPECT_IS_TEST: 'true' });
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.PRODUCTION_DATABASE_URL, undefined);
    assert.equal(env.RAILWAY_PROJECT_ID, undefined);
    assert.equal(env.CHECKBOX_REAL_LICENSE_KEY, undefined);
    assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.SAFE_VALUE, 'kept');
    assert.equal(env.CHECKBOX_EXPECT_IS_TEST, 'true');
});

test('production catalog UI exposes safe route selection and no browser price/provider input', () => {
    const html = fs.readFileSync(path.join(ROOT, 'cashier-payments.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'js', 'cashier-payments-page.js'), 'utf8');
    assert.match(html, /LOCAL QA · MOCK CHECKBOX/);
    assert.match(html, /id="catalogSaleFields"/);
    assert.match(html, /id="paymentCashierBinding"/);
    assert.match(html, /id="paymentRegisterRoute"/);
    assert.match(html, /id="paymentBusinessContext"/);
    assert.doesNotMatch(html, /<select[^>]+(?:providerRegister|locationAlias|registerAlias|credential)/i);
    assert.doesNotMatch(html, /<input[^>]+(?:unitPrice|priceMinor|price_uah)/i);
    assert.match(script, /\/api\/payments\/catalog\/orders/);
    assert.match(script, /items: catalogLinesPayload\(\)/);
    assert.match(script, /routeOptionId: PILOT_SCOPE\.routeOptionId/);
    assert.doesNotMatch(script, /items:\s*catalogLinesPayload\(\)[\s\S]{0,120}(?:price|amount)/);
    assert.match(script, /local_qa_identity_not_confirmed/);
});
