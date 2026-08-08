'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    loadTaskClassifications,
    normalizeImpactIds,
    normalizeTags,
    normalizeName,
    replaceTaskClassification,
    serializeClassification,
    updateTaxonomy
} = require('../services/myDayTaxonomy');

test('My Day taxonomy validates names, duplicate impacts, and the three-impact limit', () => {
    assert.throws(() => normalizeName('   '), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.deepEqual(normalizeImpactIds([1, '2', 3]), [1, 2, 3]);
    assert.throws(() => normalizeImpactIds([1, 1]), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.throws(() => normalizeImpactIds([1, 2, 3, 4]), { code: 'MY_DAY_IMPACT_LIMIT_EXCEEDED' });
    assert.deepEqual(normalizeTags(['  CRM  ', 'crm', 'Парк  зміна']), ['CRM', 'Парк зміна']);
    assert.throws(() => normalizeTags(['']), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.throws(() => normalizeTags(['a'.repeat(33)]), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.throws(() => normalizeTags(['one', 'two', 'three', 'four', 'five', 'six']), { code: 'MY_DAY_TAG_LIMIT_EXCEEDED' });
});

test('My Day taxonomy reads and writes only the current user catalogue', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.startsWith('SELECT id, name') && sql.includes('created_at')) return { rows: [] };
            if (sql.startsWith('SELECT id, name, color')) {
                return { rows: [{ id: 8, name: 'Health', color: '#0EA5E9', icon: 'H', sort_order: 0, is_active: true }] };
            }
            return { rows: [{ id: 8, name: 'Health', color: '#0EA5E9', icon: 'H', sort_order: 0, is_active: false, archived_at: '2026-08-03T10:00:00Z' }] };
        }
    };
    const { listTaxonomy } = require('../services/myDayTaxonomy');
    await listTaxonomy(queryable, 42, 'directions');
    await updateTaxonomy(queryable, 42, 'impacts', 8, { isActive: false });
    assert.equal(calls[0].params[0], 42);
    assert.match(calls[0].sql, /WHERE user_id = \$1/);
    assert.deepEqual(calls[1].params, [8, 42]);
    assert.equal(calls[2].params[1], 42);
    assert.equal(calls[2].params[6], false);
});

test('classification replacement validates user-owned active impacts and preserves legacy direction', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('FROM my_day_impacts') && sql.includes('FOR KEY SHARE')) return { rows: [{ id: 11, is_active: true }, { id: 12, is_active: true }] };
            if (sql.includes('FROM my_day_task_metadata m')) {
                return { rows: [{ direction_id: 7, direction_name: 'Project', direction_color: '#6366F1', direction_icon: 'P', direction_is_active: true, tags: ['CRM', 'Парк зміна'], impacts: [{ id: 11, name: 'Health', color: '#0EA5E9', icon: 'H', isActive: true }, { id: 12, name: 'Rest', color: '#0EA5E9', icon: 'R', isActive: true }] }] };
            }
            return { rows: [] };
        }
    };
    const result = await replaceTaskClassification(queryable, { userId: 42, taskId: 99, directionId: 7, impactIds: [11, 12], tags: [' CRM ', 'crm', 'Парк  зміна'] });
    assert.equal(result.direction.name, 'Project');
    assert.equal(result.impacts.length, 2);
    assert.deepEqual(result.tags, ['CRM', 'Парк зміна']);
    assert.equal(calls.length, 5);
    assert.equal(calls.some(call => /FROM my_day_directions/.test(call.sql)), false);
    assert.match(calls[1].sql, /INSERT INTO my_day_task_metadata/);
    assert.match(calls[1].sql, /tags/);
    assert.doesNotMatch(calls[1].sql, /direction_id = EXCLUDED\.direction_id/);
    assert.deepEqual(calls[1].params, [42, 99, ['CRM', 'Парк зміна']]);
    assert.match(calls[2].sql, /DELETE FROM my_day_task_impacts/);
    assert.match(calls[3].sql, /INSERT INTO my_day_task_impacts/);
    assert.deepEqual(calls[3].params, [42, 99, [11, 12]]);
});


test('foreign or inactive taxonomy IDs fail before task links are mutated', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('my_day_impacts')) return { rows: [] };
            throw new Error('Task links must not be written after failed validation');
        }
    };
    await assert.rejects(
        () => replaceTaskClassification(queryable, { userId: 42, taskId: 99, directionId: 7, impactIds: [88] }),
        { code: 'MY_DAY_TAXONOMY_NOT_FOUND' }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls.some(call => /my_day_task_metadata|my_day_task_impacts/.test(call.sql)), false);
});


test('archived links retain their label and unclassified tasks remain empty', async () => {
    const archived = serializeClassification({

        direction_id: 7,
        direction_name: 'Project',
        direction_color: '#6366F1',
        direction_icon: 'P',
        direction_is_active: false,
        tags: ['ops'],
        impacts: [{ id: 11, name: 'Health', color: '#0EA5E9', icon: 'H', isActive: false }]
    });
    assert.equal(archived.direction.name, 'Project');
    assert.equal(archived.direction.isActive, false);
    assert.equal(archived.impacts[0].isActive, false);
    assert.deepEqual(archived.tags, ['ops']);
    assert.deepEqual(serializeClassification({}), { direction: null, impacts: [], tags: [] });

    const classificationMap = await loadTaskClassifications({
        async query(_sql, params) {
            assert.deepEqual(params, [42, [99]]);
            return { rows: [{ task_id: 99, direction_id: null, tags: ['reload'], impacts: [] }] };
        }
    }, 42, [99, 99]);
    assert.deepEqual(classificationMap.get(99), { direction: null, impacts: [], tags: ['reload'] });
});

test('route, projection, migration, and profile UI retain the canonical My Day contract', () => {
    const root = path.resolve(__dirname, '..');
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'services', 'taskCabinetProjection.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '312_my_day_task_classification.sql'), 'utf8');
    const tagsMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '320_my_day_task_metadata_tags.sql'), 'utf8');
    assert.match(route, /taxonomyRoutes\('directions'\)/);
    assert.match(route, /taxonomyRoutes\('impacts'\)/);
    assert.match(route, /router\.put\('\/tasks\/:taskId\/classification'/);
    assert.match(route, /ensureWritableTaskBusinessScope/);
    assert.match(route, /BEGIN/);
    assert.match(route, /COMMIT/);
    assert.match(projection, /loadTaskClassifications/);
    assert.match(profile, /data-cabinet-task-action': 'classification'/);
    assert.match(profile, /renderTaskBadges/);
    for (const table of ['my_day_directions', 'my_day_impacts', 'my_day_task_metadata', 'my_day_task_impacts']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, /PRIMARY KEY \(user_id, task_id\)/);
    assert.match(tagsMigration, /ADD COLUMN IF NOT EXISTS tags TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    assert.match(tagsMigration, /cardinality\(values\) <= 5/);
    assert.match(tagsMigration, /char_length\(tag\) > 32/);
    assert.match(tagsMigration, /btrim\(tag\) = ''/);
});
