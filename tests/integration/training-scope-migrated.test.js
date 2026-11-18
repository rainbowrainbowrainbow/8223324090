'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { runInventory } = require('../../scripts/audit-training-scope');

test('read-only Training inventory supports the fully migrated actual-app schema', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Client({ connectionString: target.url.toString() });
    await db.connect();
    try {
        const report = await runInventory(db);
        assert.equal(report.tables.length, 17);
        assert.equal(report.readOnly, true);
        assert.equal(report.inferredOwnership, false);
        assert.equal(report.identityNamespaceVerified, false);
        assert.ok(report.tables.find(table => table.table === 'training_courses').rows.some(row => row.profession_seed));
        const output = path.resolve(__dirname, '../../output/training-scope-disposable-migrated.json');
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    } finally { await db.end(); }
});
