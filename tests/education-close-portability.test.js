'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { assertLocalTarget, DATABASES } = require('../scripts/lib/education-ready-dataset');
const env = { NODE_ENV: 'test', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION', PGHOST: '127.0.0.1',
    PGPORT: '5432', PGDATABASE: DATABASES.fixed, ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
    EDU_CLOSE_PORTABLE: 'OWNED_DISPOSABLE_EDUCATION_CI', TEST_DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/'+DATABASES.fixed,
    TEST_DATABASE_RESET_CONFIRM: 'RESET_DISPOSABLE_TEST_DATABASE' };
test('portable fixed fixture accepts exact verified loopback CI target',()=>assert.equal(assertLocalTarget('fixed',env).port,5432));
for(const [name,changes] of [
    ['mismatched port',{PGPORT:'55469'}],['remote target',{TEST_DATABASE_URL:'postgres://postgres@example.com:5432/'+DATABASES.fixed}],
    ['missing reset confirmation',{TEST_DATABASE_RESET_CONFIRM:''}],['missing runner ownership',{ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER:''}],
    ['production',{NODE_ENV:'production'}],['Railway',{RAILWAY_PROJECT_ID:'blocked'}],['retained database',{PGDATABASE:DATABASES.demo}]
]) test('portable fixture rejects '+name,()=>assert.throws(()=>assertLocalTarget('fixed',{...env,...changes})));
test('portable switch cannot loosen manual dataset port boundary',()=>assert.throws(()=>assertLocalTarget('demo',{...env,PGDATABASE:DATABASES.demo}),/55469/));
