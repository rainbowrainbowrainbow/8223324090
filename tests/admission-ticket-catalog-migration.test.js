'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
    ROOT,
    'db',
    'migrations',
    '300_admission_ticket_catalog.sql'
);
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

test('migration 300 is governed, context-scoped, and leaves legacy price_rules untouched', () => {
    assert.match(migration, /-- MIGRATION_KIND:\s*mixed/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);
    assert.match(migration, /-- DATA_SCOPE:/i);
    assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+price_rules\b/i);
    assert.match(migration, /Legacy price_rules remain unchanged/i);
});

test('migration 300 creates six immutable context-scoped system ticket types', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS admission_ticket_types/);
    assert.match(migration, /UNIQUE \(business_context, code\)/);
    assert.match(migration, /CHECK \(code ~ '\^\[a-z0-9_\]\+\$'\)/);
    assert.match(migration, /audience IN \('child', 'adult'\)/);
    assert.match(migration, /allocation_strategy IN \('manual', 'remainder'\)/);
    assert.match(migration, /code NOT IN \('regular_child', 'adult_companion'\)[\s\S]*is_active = true/);

    for (const code of [
        'regular_child',
        'under_3_child',
        'discounted_child',
        'birthday_child',
        'adult_companion',
        'adult_game'
    ]) {
        assert.match(migration, new RegExp(`'${code}'`));
    }
    assert.match(migration, /regular_child'[\s\S]*'remainder'/);
    assert.match(migration, /adult_companion'[\s\S]*'remainder'/);
    assert.match(migration, /under_3_child'[\s\S]*'manual'/);
    assert.match(migration, /admission_ticket_type_guard_v300/);
    assert.match(migration, /cannot be physically deleted/);
    assert.match(migration, /code,[\s\S]*business context,[\s\S]*audience,[\s\S]*allocation strategy are immutable/i);
});

test('migration 300 creates append-only tariff versions with strict availability amount shape', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS admission_ticket_tariff_versions/);
    assert.match(migration, /admission_context IN \('standard', 'reserved_table_room'\)/);
    assert.match(migration, /day_type IN \('weekday', 'weekend'\)/);
    assert.match(migration, /availability IN \('available', 'unavailable'\)/);
    assert.match(
        migration,
        /availability = 'available'[\s\S]*amount_uah IS NOT NULL[\s\S]*amount_uah >= 0[\s\S]*availability = 'unavailable'[\s\S]*amount_uah IS NULL/
    );
    assert.match(migration, /UNIQUE \(ticket_type_id, admission_context, day_type, revision\)/);
    assert.match(migration, /admission_ticket_tariff_append_only_v300/);
    assert.match(migration, /BEFORE UPDATE OR DELETE ON admission_ticket_tariff_versions/);
});

test('migration 300 seeds the complete approved 24-cell tariff matrix from 2026-07-14', () => {
    const seedRows = [...migration.matchAll(
        /\('([a-z0-9_]+)',\s*'(standard|reserved_table_room)',\s*'(weekday|weekend)',\s*'(available|unavailable)',\s*(NULL|\d+\.\d+)::numeric\)/g
    )].map(match => ({
        code: match[1],
        context: match[2],
        day: match[3],
        availability: match[4],
        amount: match[5] === 'NULL' ? null : Number(match[5])
    }));
    assert.equal(seedRows.length, 24);
    assert.equal(
        new Set(seedRows.map(row => `${row.code}:${row.context}:${row.day}`)).size,
        24
    );
    assert.match(migration, /DATE '2026-07-14'/);

    const byKey = new Map(seedRows.map(row => [
        `${row.code}:${row.context}:${row.day}`,
        row
    ]));
    const amount = (code, context, day) => byKey.get(`${code}:${context}:${day}`)?.amount;
    assert.equal(amount('regular_child', 'standard', 'weekday'), 350);
    assert.equal(amount('regular_child', 'standard', 'weekend'), 400);
    assert.equal(amount('regular_child', 'reserved_table_room', 'weekday'), 310);
    assert.equal(amount('regular_child', 'reserved_table_room', 'weekend'), 350);

    for (const context of ['standard', 'reserved_table_room']) {
        assert.equal(amount('under_3_child', context, 'weekday'), 175);
        assert.equal(byKey.get(`under_3_child:${context}:weekend`).availability, 'unavailable');
        assert.equal(amount('under_3_child', context, 'weekend'), null);
        assert.equal(amount('discounted_child', context, 'weekday'), 175);
        assert.equal(amount('discounted_child', context, 'weekend'), 200);
        assert.equal(amount('birthday_child', context, 'weekday'), 10);
        assert.equal(amount('birthday_child', context, 'weekend'), 10);
        assert.equal(amount('adult_companion', context, 'weekday'), 10);
        assert.equal(amount('adult_companion', context, 'weekend'), 10);
        assert.equal(amount('adult_game', context, 'weekday'), 75);
        assert.equal(amount('adult_game', context, 'weekend'), 75);
    }
});

test('migration 300 records seed and future tariff audit without touching booking prices', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS admission_ticket_tariff_audit/);
    for (const column of [
        'old_tariff_version_id',
        'new_tariff_version_id',
        'old_amount_uah',
        'new_amount_uah',
        'effective_from',
        'actor',
        'change_note'
    ]) {
        assert.match(migration, new RegExp(`\\b${column}\\b`));
    }
    assert.doesNotMatch(migration, /\bUPDATE\s+bookings\b/i);
    assert.doesNotMatch(migration, /\bUPDATE\s+banquet_groups\b/i);
});
