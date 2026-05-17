/**
 * tests/task-taxonomy.test.js -- Tasks taxonomy and checklist pack helpers.
 * Run: node --test tests/task-taxonomy.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    CATEGORY_SUBCATEGORIES,
    ORDER_OPERATION_PRESETS,
    PACK_STATUSES,
    TASK_CATEGORY_TREE,
    TOP_LEVEL_ORDER,
    normalizeChecklistTemplateKey,
    normalizeOwnerRole,
    normalizePackStatus,
    normalizeSlaMinutes,
    normalizeSourceEntityId,
    normalizeSourceEntityType,
    normalizeTaskCategory,
    normalizeTaskSubcategory,
    normalizeUuid
} = require('../services/taskTaxonomy');

describe('task taxonomy helpers', () => {
    it('keeps orders and checklist as top-level categories with scoped children', () => {
        assert.ok(TOP_LEVEL_ORDER.includes('orders'));
        assert.ok(TOP_LEVEL_ORDER.includes('checklist'));
        assert.deepEqual(CATEGORY_SUBCATEGORIES.orders, ['kitchen', 'confectionery', 'cakes', 'cake_decor']);
        assert.deepEqual(CATEGORY_SUBCATEGORIES.checklist, ['hall_prep', 'kitchen', 'cakes', 'cake_decor', 'purchase']);
        assert.equal(TASK_CATEGORY_TREE.orders.children.cakes.parent, 'confectionery');
    });

    it('normalizes categories without turning submenus into flat chips', () => {
        assert.equal(normalizeTaskCategory('orders'), 'orders');
        assert.equal(normalizeTaskCategory('checklist'), 'checklist');
        assert.equal(normalizeTaskCategory('operational'), 'operational');
        assert.equal(normalizeTaskCategory('kitchen'), 'admin');
        assert.equal(normalizeTaskCategory('unknown', 'event'), 'event');
    });

    it('normalizes subcategories only inside supported parent categories', () => {
        assert.equal(normalizeTaskSubcategory('orders', 'kitchen'), 'kitchen');
        assert.equal(normalizeTaskSubcategory('orders', 'confectionery'), 'confectionery');
        assert.equal(normalizeTaskSubcategory('orders', 'cakes'), 'cakes');
        assert.equal(normalizeTaskSubcategory('checklist', 'hall_prep'), 'hall_prep');
        assert.equal(normalizeTaskSubcategory('checklist', 'purchase'), 'purchase');
        assert.equal(normalizeTaskSubcategory('orders', 'hall_prep'), null);
        assert.equal(normalizeTaskSubcategory('admin', 'kitchen'), null);
    });

    it('maps checklist template keys from explicit keys or checklist subcategories', () => {
        assert.equal(normalizeChecklistTemplateKey('cake_base'), 'cake_base');
        assert.equal(normalizeChecklistTemplateKey('', 'kitchen'), 'kitchen_base');
        assert.equal(normalizeChecklistTemplateKey('bad_key', 'cake_decor'), 'cake_decor_base');
        assert.equal(normalizeChecklistTemplateKey('bad_key', 'unknown'), null);
    });

    it('keeps operation presets as checklist bundles with dependencies where needed', () => {
        assert.equal(ORDER_OPERATION_PRESETS.kitchen_basic.bundle[0].templateKey, 'kitchen_base');
        assert.equal(ORDER_OPERATION_PRESETS.cake_with_decor.bundle.length, 2);
        assert.deepEqual(ORDER_OPERATION_PRESETS.cake_with_decor.dependencies, [
            { taskTemplateKey: 'cake_decor_base', dependsOnTemplateKey: 'cake_base' }
        ]);
    });

    it('normalizes operational pack metadata safely', () => {
        assert.ok(PACK_STATUSES.includes('in_production'));
        assert.equal(normalizePackStatus('ready'), 'ready');
        assert.equal(normalizePackStatus('bad', 'draft'), 'draft');
        assert.equal(normalizeSourceEntityType('booking'), 'booking');
        assert.equal(normalizeSourceEntityType('invoice'), null);
        assert.equal(normalizeSourceEntityId(1842), '1842');
        assert.equal(normalizeSourceEntityId(''), null);
        assert.equal(normalizeUuid('2e6f0d0e-1111-4222-8333-123456789abc'), '2e6f0d0e-1111-4222-8333-123456789abc');
        assert.equal(normalizeUuid('not-a-uuid'), null);
        assert.equal(normalizeOwnerRole('cake_decor:lead'), 'cake_decor:lead');
        assert.equal(normalizeOwnerRole('bad role'), null);
        assert.equal(normalizeSlaMinutes(60), 60);
        assert.equal(normalizeSlaMinutes(10081), null);
    });
});
