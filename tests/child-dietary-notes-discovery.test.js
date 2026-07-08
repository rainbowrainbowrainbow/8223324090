'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDietaryNotesReport,
    classifyChildNote,
    redactNoteSample
} = require('../scripts/audit-child-dietary-notes');

describe('child dietary notes discovery helpers', () => {
    it('classifies allergy and dietary restriction notes as food-safety signals', () => {
        const allergy = classifyChildNote('Алергія на горіхи, без арахісу');
        assert.equal(allergy.foodSafety, true);
        assert.ok(allergy.categories.includes('allergy'));
        assert.ok(allergy.categories.includes('dietary_restriction'));

        const lactose = classifyChildNote('Без лактози і глютену');
        assert.equal(lactose.foodSafety, true);
        assert.deepEqual(lactose.categories, ['dietary_restriction']);
    });

    it('separates operational notes from unclear notes', () => {
        const operational = classifyChildNote('Посадити поруч з мамою, бо соромиться');
        assert.equal(operational.foodSafety, false);
        assert.deepEqual(operational.categories, ['behavior_or_ops']);

        const unclear = classifyChildNote('Попросили уточнити на місці');
        assert.equal(unclear.foodSafety, false);
        assert.deepEqual(unclear.categories, ['unclear']);
    });

    it('redacts obvious contact data from optional samples', () => {
        const sample = redactNoteSample('Мама +380671234567, email test@example.com, instagram @child_parent, дата 2026-07-08');
        assert.doesNotMatch(sample, /\+380671234567/);
        assert.doesNotMatch(sample, /test@example\.com/);
        assert.doesNotMatch(sample, /@child_parent/);
        assert.doesNotMatch(sample, /2026-07-08/);
        assert.match(sample, /\[phone\]/);
        assert.match(sample, /\[email\]/);
        assert.match(sample, /\[handle\]/);
        assert.match(sample, /\[date\]/);
    });

    it('builds aggregate reports without samples by default', () => {
        const report = buildDietaryNotesReport([
            { note: 'Алергія на горіхи, без арахісу' },
            { note: 'Посадити поруч з мамою' },
            { note: 'Любить шоколад' },
            { note: '' }
        ]);

        assert.equal(report.scannedNotes, 3);
        assert.equal(report.foodSafetyNotes, 1);
        assert.equal(report.byCategory.allergy, 1);
        assert.equal(report.byCategory.dietary_restriction, 1);
        assert.equal(report.byCategory.behavior_or_ops, 1);
        assert.equal(report.byCategory.preference, 1);
        assert.equal(report.samples, undefined);
    });
});
