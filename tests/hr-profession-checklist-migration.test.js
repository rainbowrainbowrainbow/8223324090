'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function readMigration294() {
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(file => /^294_.*profession.*checklist.*\.sql$/i.test(file));
    assert.equal(files.length, 1, 'Expected exactly one migration 294 for profession checklists');
    return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf8');
}

function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');
}

function normalizedTitle(value) {
    return String(value || '').trim().toLocaleLowerCase('uk-UA');
}

function stableItemKey(professionKey, position, title) {
    const identity = `${professionKey}:${position}:${title}`;
    return `chk_${crypto.createHash('md5').update(identity).digest('hex').slice(0, 24)}`;
}

function buildTemplate(professionKey, titles) {
    return titles.map((title, index) => ({
        itemKey: stableItemKey(professionKey, index + 1, title),
        title,
        sortOrder: (index + 1) * 10,
        isActive: true
    }));
}

function reconcileLegacyProgress(items, progressRows) {
    const candidates = progressRows.map(row => {
        if (row.itemKey) return { row, matches: [] };
        const title = normalizedTitle(row.title);
        return {
            row,
            matches: items.filter(item => normalizedTitle(item.title) === title)
        };
    });
    const existingTargets = new Set(
        progressRows
            .filter(row => row.itemKey)
            .map(row => `${row.staffId}:${row.itemKey}`)
    );
    const targetCounts = new Map();
    candidates.forEach(candidate => {
        if (candidate.matches.length !== 1) return;
        const target = `${candidate.row.staffId}:${candidate.matches[0].itemKey}`;
        targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
    });

    return candidates.map(candidate => {
        const { row, matches } = candidate;
        if (row.itemKey) return { ...row, status: 'preserved' };
        if (matches.length === 0) return { ...row, status: 'unresolved', reason: 'title_mismatch' };
        if (matches.length > 1) return { ...row, status: 'unresolved', reason: 'duplicate_title' };

        const itemKey = matches[0].itemKey;
        const target = `${row.staffId}:${itemKey}`;
        if (existingTargets.has(target) || targetCounts.get(target) !== 1) {
            return { ...row, status: 'unresolved', reason: 'target_conflict' };
        }
        return { ...row, itemKey, status: 'mapped' };
    });
}

const migration = readMigration294();
const migrationSql = stripSqlComments(migration);
const templateBackfill = migration.match(
    /INSERT INTO hr_profession_checklist_items\s*\([\s\S]*?ON CONFLICT \(profession_id, item_key\) DO NOTHING;/i
)?.[0] || '';

test('migration 294 is governed and creates the normalized stable-key checklist model', () => {
    assert.match(migration, /-- MIGRATION_KIND:\s*mixed/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- OPERATOR_APPROVAL:/i);
    assert.match(migration, /-- DATA_SCOPE:/i);
    assert.match(migration, /-- ROLLBACK:/i);

    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_profession_checklist_items/);
    assert.match(migration, /id BIGSERIAL PRIMARY KEY/);
    assert.match(migration, /profession_id INTEGER NOT NULL REFERENCES hr_professions\(id\) ON DELETE RESTRICT/);
    assert.match(migration, /item_key VARCHAR\(128\) NOT NULL/);
    assert.match(migration, /title TEXT NOT NULL/);
    assert.match(migration, /sort_order INTEGER NOT NULL DEFAULT 100/);
    assert.match(migration, /is_active BOOLEAN NOT NULL DEFAULT true/);
    assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /UNIQUE \(profession_id, item_key\)/);
    assert.match(migration, /CHECK \(BTRIM\(item_key\) <> ''\)/);

    assert.match(templateBackfill, /jsonb_array_elements_text\s*\(/i);
    assert.match(templateBackfill, /WITH ORDINALITY AS item\(value, ordinality\)/i);
    assert.match(
        templateBackfill,
        /'chk_' \|\| SUBSTRING\(MD5\(profession\.key \|\| ':' \|\| item\.ordinality::text \|\| ':' \|\| item\.value\) FROM 1 FOR 24\)/i
    );
    assert.doesNotMatch(templateBackfill, /\bLIMIT\s+24\b/i);
    assert.doesNotMatch(templateBackfill, /ordinality\s*(?:<=|<)\s*2[45]\b/i);
    assert.doesNotMatch(templateBackfill, /'item_'\s*\|\|/i);
});

test('migration 294 links progress without deleting or rewriting completion history', () => {
    assert.match(
        migration,
        /ALTER TABLE hr_staff_profession_checklist_progress[\s\S]*ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT[\s\S]*ADD COLUMN IF NOT EXISTS legacy_checklist_key VARCHAR\(128\)/
    );
    assert.match(migration, /SET legacy_checklist_key = checklist_key/);
    assert.match(migration, /SET checklist_item_id = candidate\.item_id,[\s\S]*checklist_key = candidate\.item_key,[\s\S]*updated_at = progress\.updated_at/);
    assert.match(migration, /LOWER\(BTRIM\(item\.title\)\) = LOWER\(BTRIM\(progress\.title\)\)/);
    assert.match(migration, /COUNT\(\*\) OVER \(PARTITION BY progress\.id\) AS progress_match_count/);
    assert.match(migration, /COUNT\(\*\) OVER \(PARTITION BY candidate\.staff_id, candidate\.item_id\) AS target_match_count/);
    assert.match(migration, /existing\.staff_id = candidate\.staff_id[\s\S]*existing\.checklist_item_id = candidate\.item_id/);

    assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migrationSql, /\bcompleted_at\s*=/i);
    assert.doesNotMatch(migrationSql, /\bcompleted_by\s*=/i);
    assert.doesNotMatch(migrationSql, /\bnotes\s*=/i);
    assert.doesNotMatch(migrationSql, /DROP\s+COLUMN\s+(?:completed_at|completed_by|notes)/i);
});

test('migration 294 reports ambiguous legacy rows instead of guessing', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_profession_checklist_migration_issues/);
    assert.match(migration, /progress_id INTEGER NOT NULL REFERENCES hr_staff_profession_checklist_progress\(id\) ON DELETE CASCADE/);
    assert.match(migration, /legacy_checklist_key VARCHAR\(128\) NOT NULL/);
    assert.match(migration, /legacy_title TEXT/);
    assert.match(migration, /reason VARCHAR\(80\) NOT NULL/);
    assert.match(migration, /candidate_item_keys JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(migration, /UNIQUE \(progress_id\)/);
    assert.match(migration, /'legacy_key_not_unambiguously_reconciled'/);
    assert.match(migration, /WHERE progress\.checklist_item_id IS NULL[\s\S]*progress\.checklist_key ~ '\^item_\[1-9\]\[0-9\]\*\$'/);
    assert.match(migration, /ON CONFLICT \(progress_id\) DO NOTHING/);
});

test('migration 294 keeps training lectures linked to the same canonical checklist identity', () => {
    assert.match(
        migration,
        /ALTER TABLE training_course_lectures[\s\S]*ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT REFERENCES hr_profession_checklist_items\(id\) ON DELETE SET NULL/
    );
    assert.match(migration, /course\.source = 'hr_profession_seed'/);
    assert.match(migration, /SET checklist_item_id = candidate\.item_id,[\s\S]*checklist_key = candidate\.item_key/);
    assert.match(migration, /INSERT INTO training_course_lectures[\s\S]*checklist_item_id[\s\S]*item\.id/);
    assert.match(migration, /WHERE lecture\.checklist_item_id = item\.id/);

    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_staff_profession_progress_staff_item[\s\S]*\(staff_id, checklist_item_id\)[\s\S]*WHERE checklist_item_id IS NOT NULL/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_training_course_lectures_checklist_item[\s\S]*\(checklist_item_id\)[\s\S]*WHERE checklist_item_id IS NOT NULL/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_profession_checklist_migration_issue_progress|CONSTRAINT uq_hr_profession_checklist_migration_issue_progress UNIQUE \(progress_id\)/);
    assert.match(migration, /LEFT JOIN hr_profession_checklist_items item ON item\.profession_id = profession\.id/);
    assert.match(migration, /is_active = profession\.is_active AND item_counts\.active_count > 0/);
    assert.match(migration, /WHEN item_counts\.active_count > 0 THEN GREATEST\(1\.0, item_counts\.active_count \* 0\.5\)[\s\S]*ELSE 0/);
    assert.match(migration, /is_published = item\.is_active AND profession\.is_active/);
});

test('32-item regression keeps every template item and generates unique stable keys', () => {
    const titles = Array.from({ length: 32 }, (_, index) => `Пункт ${index + 1}`);
    const items = buildTemplate('animator', titles);

    assert.equal(items.length, 32);
    assert.equal(new Set(items.map(item => item.itemKey)).size, 32);
    assert.equal(items[0].sortOrder, 10);
    assert.equal(items[23].title, 'Пункт 24');
    assert.equal(items[24].title, 'Пункт 25');
    assert.equal(items[31].title, 'Пункт 32');
    assert.equal(items[31].sortOrder, 320);
});

test('title reconciliation maps only one safe target and leaves duplicates or mismatches unresolved', () => {
    const items = [
        { itemKey: 'chk_rules', title: 'Вивчити правила' },
        { itemKey: 'chk_safety_a', title: 'Безпека' },
        { itemKey: 'chk_safety_b', title: '  безпека  ' },
        { itemKey: 'chk_communication', title: 'Комунікація' }
    ];
    const result = reconcileLegacyProgress(items, [
        { id: 1, staffId: 10, legacyKey: 'item_1', title: '  ВИВЧИТИ ПРАВИЛА ' },
        { id: 2, staffId: 10, legacyKey: 'item_2', title: 'Безпека' },
        { id: 3, staffId: 10, legacyKey: 'item_3', title: 'Невідомий пункт' },
        { id: 4, staffId: 20, legacyKey: 'item_4', title: 'Комунікація' },
        { id: 5, staffId: 20, legacyKey: 'item_5', title: 'комунікація' },
        { id: 6, staffId: 30, legacyKey: 'item_6', title: 'Комунікація', itemKey: 'chk_communication' },
        { id: 7, staffId: 30, legacyKey: 'item_7', title: 'Комунікація' }
    ]);

    assert.deepEqual(
        result.map(row => [row.id, row.status, row.itemKey || null, row.reason || null]),
        [
            [1, 'mapped', 'chk_rules', null],
            [2, 'unresolved', null, 'duplicate_title'],
            [3, 'unresolved', null, 'title_mismatch'],
            [4, 'unresolved', null, 'target_conflict'],
            [5, 'unresolved', null, 'target_conflict'],
            [6, 'preserved', 'chk_communication', null],
            [7, 'unresolved', null, 'target_conflict']
        ]
    );
});

test('rename and reorder change presentation only, not checklist or progress identity', () => {
    const original = buildTemplate('barista', ['Перший', 'Другий', 'Третій']);
    const progress = new Map([
        [original[0].itemKey, { completedAt: '2026-07-01T09:00:00Z' }],
        [original[2].itemKey, { completedAt: '2026-07-02T09:00:00Z' }]
    ]);

    const renamed = original.map(item => (
        item.itemKey === original[0].itemKey ? { ...item, title: 'Оновлена назва' } : { ...item }
    ));
    const reorderedKeys = [original[2].itemKey, original[0].itemKey, original[1].itemKey];
    const reordered = reorderedKeys.map((itemKey, index) => ({
        ...renamed.find(item => item.itemKey === itemKey),
        sortOrder: (index + 1) * 10
    }));

    assert.deepEqual(new Set(reordered.map(item => item.itemKey)), new Set(original.map(item => item.itemKey)));
    assert.equal(reordered.find(item => item.itemKey === original[0].itemKey).title, 'Оновлена назва');
    assert.equal(reordered[0].itemKey, original[2].itemKey);
    assert.equal(progress.get(original[0].itemKey).completedAt, '2026-07-01T09:00:00Z');
    assert.equal(progress.get(original[2].itemKey).completedAt, '2026-07-02T09:00:00Z');
});
