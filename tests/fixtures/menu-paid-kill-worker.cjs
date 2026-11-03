'use strict';

const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { executeMenuImagePaid } = require('../../services/menuImagePaidExecutor');
const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
const schema = String(process.env.MENU_PAID_FIXTURE_SCHEMA || '');
if (!target.isLocal || !/^menu_paid_test_[a-f0-9]{16}$/.test(schema) || !process.send) throw new Error('Unsafe test target');
const pool = new Pool({ connectionString: target.url.toString(), ssl: false, options: `-c search_path=${schema}` });
executeMenuImagePaid({ pool, businessContext: 'fixture', productId: 'interrupted', provider: 'openai', actor: 'fixture',
    start: async () => {
        process.send({ state: 'provider-started' });
        return new Promise(() => {});
    }, saveDraft: async () => true
}).catch(() => { process.exitCode = 1; pool.end(); });
