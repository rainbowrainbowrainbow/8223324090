'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    classificationFingerprint,
    classificationImpactIds,
    loadTaskClassifications,
    normalizeImpactIds,
    normalizeName,
    replaceTaskClassification,
    serializeClassification,
    updateTaxonomy
} = require('../services/myDayTaxonomy');

test('My Day taxonomy validates names, duplicate impacts, and the five-impact limit', () => {
    assert.throws(() => normalizeName('   '), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.deepEqual(normalizeImpactIds([1, '2', 3]), [1, 2, 3]);
    assert.throws(() => normalizeImpactIds([1, 1]), { code: 'MY_DAY_VALIDATION_ERROR' });
    assert.deepEqual(normalizeImpactIds([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
    assert.throws(() => normalizeImpactIds([1, 2, 3, 4, 5, 6]), { code: 'MY_DAY_IMPACT_LIMIT_EXCEEDED' });
    assert.deepEqual(classificationImpactIds({ impacts: [{ id: 3 }, { id: '1' }, { id: 3 }] }), [1, 3]);
    assert.equal(
        classificationFingerprint({ impacts: [{ id: 3 }, { id: 1 }] }, 'task-v1'),
        classificationFingerprint({ impacts: [{ id: 1 }, { id: 3 }] }, 'task-v1')
    );
    assert.notEqual(
        classificationFingerprint({ impacts: [{ id: 1 }] }, 'task-v1'),
        classificationFingerprint({ impacts: [{ id: 1 }] }, 'task-v2')
    );
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

test('classification replacement writes impacts only and preserves legacy direction', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('FROM my_day_impacts') && sql.includes('FOR KEY SHARE')) return { rows: [{ id: 11, is_active: true }, { id: 12, is_active: true }] };
            if (sql.includes('json_agg') && sql.includes('my_day_task_metadata')) {
                return { rows: [{ direction_id: 7, direction_name: 'Project', direction_color: '#6366F1', direction_icon: 'P', direction_is_active: true, impacts: [{ id: 11, name: 'Health', color: '#0EA5E9', icon: 'H', isActive: true }, { id: 12, name: 'Rest', color: '#0EA5E9', icon: 'R', isActive: true }] }] };
            }
            return { rows: [] };
        }
    };
    const result = await replaceTaskClassification(queryable, { userId: 42, taskId: 99, directionId: 7, impactIds: [11, 12], tags: [] });
    assert.equal(result.direction.name, 'Project');
    assert.equal(result.impacts.length, 2);
    assert.equal(Object.hasOwn(result, 'tags'), false);
    assert.equal(calls.length, 5);
    assert.equal(calls.some(call => /FROM my_day_directions/.test(call.sql)), false);
    assert.match(calls[1].sql, /INSERT INTO my_day_task_metadata \(user_id, task_id\)/);
    assert.doesNotMatch(calls[1].sql, /tags|direction_id = EXCLUDED\.direction_id/);
    assert.deepEqual(calls[1].params, [42, 99]);
    assert.match(calls[2].sql, /DELETE FROM my_day_task_impacts/);
    assert.match(calls[3].sql, /INSERT INTO my_day_task_impacts/);
    assert.deepEqual(calls[3].params, [42, 99, [11, 12]]);
});

test('non-empty legacy task tags fail instead of being silently ignored', async () => {
    await assert.rejects(
        () => replaceTaskClassification({ query: async () => ({ rows: [] }) }, { userId: 42, taskId: 99, impactIds: [], tags: ['CRM'] }),
        { code: 'MY_DAY_TAGS_DEPRECATED' }
    );
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

test('classification replacement can restore archived impacts only from a verified undo snapshot', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('FROM my_day_impacts') && sql.includes('FOR KEY SHARE')) return { rows: [{ id: 88, is_active: false }] };
            if (sql.includes('json_agg') && sql.includes('my_day_task_metadata')) {
                return { rows: [{ direction_id: 7, impacts: [{ id: 88, name: 'Legacy', color: '#64748b', icon: 'L', isActive: false }] }] };
            }
            return { rows: [] };
        }
    };
    await assert.rejects(
        () => replaceTaskClassification(queryable, { userId: 42, taskId: 99, impactIds: [88] }),
        { code: 'MY_DAY_TAXONOMY_ARCHIVED' }
    );
    const restored = await replaceTaskClassification(queryable, {
        userId: 42,
        taskId: 99,
        impactIds: [88],
        allowArchivedImpactIds: [88]
    });
    assert.deepEqual(restored.impacts.map(impact => impact.id), [88]);
    assert.equal(restored.impacts[0].isActive, false);
});

test('archived links retain their label and unclassified tasks remain empty', async () => {
    const archived = serializeClassification({
        direction_id: 7,
        direction_name: 'Project',
        direction_color: '#6366F1',
        direction_icon: 'P',
        direction_is_active: false,
        impacts: [{ id: 11, name: 'Health', color: '#0EA5E9', icon: 'H', isActive: false }]
    });
    assert.equal(archived.direction.name, 'Project');
    assert.equal(archived.direction.isActive, false);
    assert.equal(archived.impacts[0].isActive, false);
    assert.equal(Object.hasOwn(archived, 'tags'), false);
    assert.deepEqual(serializeClassification({}), { direction: null, impacts: [] });

    const classificationMap = await loadTaskClassifications({
        async query(_sql, params) {
            assert.deepEqual(params, [42, [99]]);
            return { rows: [{ task_id: 99, direction_id: null, impacts: [] }] };
        }
    }, 42, [99, 99]);
    assert.deepEqual(classificationMap.get(99), { direction: null, impacts: [] });
});

test('route, projection, migration, and profile UI retain the impacts-only active contract', () => {
    const root = path.resolve(__dirname, '..');
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'services', 'taskCabinetProjection.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'services', 'myDayTaxonomy.js'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '312_my_day_task_classification.sql'), 'utf8');
    const tagsMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '320_my_day_task_metadata_tags.sql'), 'utf8');
    assert.match(route, /taxonomyRoutes\('directions'\)/);
    assert.match(route, /router\.get\('\/impacts'/);
    assert.match(route, /taxonomyRoutes\('impacts', \{ get: false \}\)/);
    assert.match(route, /router\.put\('\/tasks\/:taskId\/classification'/);
    assert.match(route, /ensureWritableTaskBusinessScope/);
    assert.match(route, /BEGIN/);
    assert.match(route, /COMMIT/);
    assert.match(route, /tags: req\.body\?\.tags/);
    assert.match(service, /MY_DAY_TAGS_DEPRECATED/);
    assert.match(service, /classificationFingerprint/);
    assert.match(service, /allowArchivedImpactIds/);
    assert.doesNotMatch(service, /INSERT INTO my_day_task_metadata \(user_id, task_id, tags\)|DO UPDATE SET tags/);
    assert.match(projection, /loadTaskClassifications/);
    assert.doesNotMatch(projection, /tags: \[\]/);
    assert.match(profile, /data-cabinet-task-action': 'classification'/);
    assert.match(profile, /renderTaskBadges/);
    assert.doesNotMatch(profile, /classification\.tags|myDayClassification\?\.tags/);
    for (const table of ['my_day_directions', 'my_day_impacts', 'my_day_task_metadata', 'my_day_task_impacts']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, /PRIMARY KEY \(user_id, task_id\)/);
    assert.match(tagsMigration, /ADD COLUMN IF NOT EXISTS tags TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    assert.match(tagsMigration, /tag_values/);
    assert.match(tagsMigration, /char_length\(value\) > 32/);
    assert.match(tagsMigration, /btrim\(value\) = ''/);
});
