'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { assertSafeTestDatabaseUrl } = require('../scripts/test-db-safety');
const { runInventory, collectTrainingScopeInventory } = require('../scripts/audit-training-scope');

test('training inventory requires a verified read-only snapshot and always rolls it back', async () => {
    for (const readOnly of ['off', 'on']) {
        const calls = [];
        await assert.rejects(runInventory({ async query(sql) {
            calls.push(sql);
            if (sql.includes('current_setting')) return { rows: [{ read_only: readOnly, isolation: 'repeatable read' }] };
            if (sql.includes('information_schema')) throw new Error('Synthetic schema failure');
            return { rows: [] };
        } }), readOnly === 'on' ? /Synthetic schema failure/ : /Read-only snapshot required/);
        assert.match(calls[0], /REPEATABLE READ READ ONLY$/);
        assert.equal(calls.at(-1), 'ROLLBACK');
    }
    await assert.rejects(collectTrainingScopeInventory({}, { limit: 0 }), /row limit/);
    await assert.rejects(collectTrainingScopeInventory({}, { limit: '1; DELETE' }), /row limit/);
});

test('training CLI fails without credentials and prints no connection details', () => {
    const env = { ...process.env };
    delete env.ACCESS_AUDIT_DATABASE_URL;
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/audit-training-scope.js')], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Read-only training inventory failed\./);
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:|password|token|\bat\s.*\.js:/);
});

test('training scope inventory reads only structural IDs in actual disposable PostgreSQL', {
    skip: !process.env.TRAINING_SCOPE_INVENTORY_TEST_DATABASE_URL
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TRAINING_SCOPE_INVENTORY_TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Client({ connectionString: target.url.toString() });
    const schema = 'training_scope_test_' + crypto.randomUUID().replaceAll('-', '');
    await db.connect();
    try {
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`SET search_path TO "${schema}"`);
        // No names, content, questions, answers, scores, notes or credentials.
        // Orphan IDs and ambiguous actor IDs are retained as evidence, not fixed.
        await db.query(`CREATE TABLE training_courses (id INT, instructor_id INT, is_active BOOLEAN, source TEXT);
            CREATE TABLE training_course_lectures (id INT, course_id INT, article_id INT, checklist_item_id BIGINT, is_published BOOLEAN, resource_urls JSONB);
            CREATE TABLE training_course_enrollment (id INT, course_id INT, staff_id INT);
            CREATE TABLE knowledge_base (id INT, created_by INT, is_active BOOLEAN);
            CREATE TABLE knowledge_base_progress (id INT, article_id INT, staff_id INT);
            CREATE TABLE training_tests (id INT, article_id INT, is_active BOOLEAN);
            CREATE TABLE training_test_results (id INT, test_id INT, staff_id INT);
            CREATE TABLE training_badges (id INT, staff_id INT);
            CREATE TABLE training_assignments (id INT, assigned_by INT, assigned_to INT[], is_active BOOLEAN);
            CREATE TABLE training_submissions (id INT, assignment_id INT, staff_id INT, reviewed_by INT);
            CREATE TABLE staff_training_inputs (id INT, staff_id INT);
            CREATE TABLE training_materials (id INT, source_input_id INT, source_staff_id INT, is_active BOOLEAN);
            CREATE TABLE training_prompts_sent (id INT, staff_id INT);
            CREATE TABLE hr_professions (id INT, is_active BOOLEAN);
            CREATE TABLE hr_profession_checklist_items (id BIGINT, profession_id INT, is_active BOOLEAN);
            CREATE TABLE hr_staff_profession_checklist_progress (id INT, staff_id INT, checklist_item_id BIGINT);
            CREATE TABLE hr_profession_checklist_migration_issues (id INT, progress_id INT, resolved_at TIMESTAMPTZ);
            INSERT INTO training_courses VALUES (1, NULL, true, 'hr_profession_seed'), (2, 71, false, 'PRIVATE_SOURCE'), (3, 72, NULL, 'manual');
            INSERT INTO training_course_lectures VALUES (11, 1, 21, 51, true, '[{"url":"PRIVATE_URL"}]'), (12, 999, NULL, NULL, false, '{}');
            INSERT INTO training_course_enrollment VALUES (31, 2, 71);
            INSERT INTO knowledge_base VALUES (21, 71, true);
            INSERT INTO knowledge_base_progress VALUES (32, 21, 71);
            INSERT INTO training_tests VALUES (41, 21, true);
            INSERT INTO training_test_results VALUES (42, 41, 71);
            INSERT INTO training_badges VALUES (43, 71);
            INSERT INTO training_assignments VALUES (61, 71, '{}', true), (62, 72, ARRAY(SELECT generate_series(1,1001)), false);
            INSERT INTO training_submissions VALUES (63, 61, 71, 72);
            INSERT INTO staff_training_inputs VALUES (64, NULL);
            INSERT INTO training_materials VALUES (65, 64, NULL, true);
            INSERT INTO training_prompts_sent VALUES (66, 71);
            INSERT INTO hr_professions VALUES (50, true);
            INSERT INTO hr_profession_checklist_items VALUES (51, 50, true);
            INSERT INTO hr_staff_profession_checklist_progress VALUES (52, 71, 51);
            INSERT INTO hr_profession_checklist_migration_issues VALUES (53, 52, NULL);`);
        let readOnlyVerified = false;
        await assert.rejects(runInventory({ async query(sql, params) {
            if (sql.includes('information_schema')) {
                const mode = await db.query("SHOW transaction_read_only");
                assert.equal(mode.rows[0].transaction_read_only, 'on');
                await assert.rejects(db.query('INSERT INTO training_courses (id) VALUES (999)'), { code: '25006' });
                // Deliberately end this enforcement probe; the inventory must
                // roll it back before normal collection can succeed.
                readOnlyVerified = true;
                throw new Error('Verified real read-only enforcement');
            }
            return db.query(sql, params);
        } }), /Verified real read-only enforcement/);
        assert.equal(readOnlyVerified, true);
        const inventory = await runInventory(db);
        assert.equal(inventory.tables.length, 17);
        assert.equal(inventory.inferredOwnership, false);
        assert.equal(inventory.identityNamespaceVerified, false);
        assert.equal(inventory.needsOwnerClassification, true);
        assert.equal(inventory.rowEnumerationComplete, true);
        assert.equal(inventory.referenceEnumerationComplete, false);
        const table = name => inventory.tables.find(item => item.table === name);
        assert.deepEqual(table('training_courses').rows[0], { id: 1, instructor_id: null, is_active: true, profession_seed: true });
        assert.equal(table('training_courses').rows[2].is_active, null);
        assert.equal(table('training_course_lectures').rows[0].resource_reference_count, 1);
        assert.equal(table('training_course_lectures').rows[1].resource_shape_valid, false);
        assert.equal(table('training_course_lectures').rows[1].course_id, 999);
        assert.deepEqual(table('training_assignments').rows[0].assigned_to, []);
        assert.equal(table('training_assignments').rows[1].assigned_to.length, 1000);
        assert.equal(table('training_assignments').rows[1].target_reference_count, 1001);
        assert.equal(table('training_assignments').rows[1].target_references_truncated, true);
        assert.equal(table('knowledge_base_progress').referenceSemantics.staff_id, 'unverified_legacy_actor_reference');
        assert.doesNotMatch(JSON.stringify(inventory), /PRIVATE_SOURCE|PRIVATE_URL/);
        const limited = await runInventory(db, { limit: 1 });
        assert.equal(limited.rowEnumerationComplete, false);
        assert.equal(limited.tables.find(item => item.table === 'training_courses').rowCount, 3);
        assert.equal(limited.tables.find(item => item.table === 'training_courses').rows.length, 1);
        await db.query('ALTER TABLE training_courses ADD COLUMN business_id INT');
        const withOwnership = await runInventory(db);
        assert.deepEqual(withOwnership.tables[0].ownershipColumns, ['business_id']);
        assert.equal(withOwnership.inferredOwnership, false);
        await db.query('DROP TABLE training_badges');
        await assert.rejects(runInventory(db), /schema incomplete/);
        assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM training_courses')).rows[0].count, 3);
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.query('SET search_path TO public');
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.end();
    }
});
