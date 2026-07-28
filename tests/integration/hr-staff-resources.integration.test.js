/**
 * Isolated PostgreSQL coverage for HR resource lifecycle synchronization.
 *
 * Run only against a disposable migrated database:
 *   RUN_HR_RESOURCE_INTEGRATION=true
 *   REQUIRE_ISOLATED_TEST_TARGET=true
 *   ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER=true
 *   node --test tests/integration/hr-staff-resources.integration.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../db');
const {
    issueStaffResource,
    listStaffResources,
    transitionStaffResource
} = require('../../services/hrStaffResources');
const { DEFAULT_BUSINESS_CONTEXT } = require('../../services/businessContext');

const enabled = process.env.RUN_HR_RESOURCE_INTEGRATION === 'true';
let staffId = null;
let warehouseStockId = null;
let costumeId = null;

function requireIsolatedTarget() {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
}

async function stockSnapshot() {
    const result = await pool.query('SELECT quantity FROM warehouse_stock WHERE id = $1', [warehouseStockId]);
    return Number(result.rows[0]?.quantity);
}

async function movementSnapshot() {
    const result = await pool.query(
        `SELECT movement_type, quantity
         FROM warehouse_stock_movements
         WHERE warehouse_stock_id = $1
         ORDER BY id`,
        [warehouseStockId]
    );
    return result.rows.map(row => ({ movement_type: row.movement_type, quantity: Number(row.quantity) }));
}

describe('HR resource lifecycle PostgreSQL integration', { skip: !enabled }, () => {
    before(async () => {
        requireIsolatedTarget();
        const suffix = `${process.pid}-${Date.now()}`;
        const staff = await pool.query(
            `INSERT INTO staff (name, department, position, is_active)
             VALUES ($1, 'admin', 'HR resource integration', true)
             RETURNING id`,
            [`Disposable HR resource ${suffix}`]
        );
        staffId = Number(staff.rows[0].id);
        const stock = await pool.query(
            `INSERT INTO warehouse_stock (name, category, quantity, unit, is_active, owner, business_context)
             VALUES ($1, 'equipment', 5, 'шт', true, 'park', $2)
             RETURNING id`,
            [`Disposable HR stock ${suffix}`, DEFAULT_BUSINESS_CONTEXT]
        );
        warehouseStockId = Number(stock.rows[0].id);
        const costume = await pool.query(
            `INSERT INTO costumes (name, category, condition)
             VALUES ($1, 'qa', 'good')
             RETURNING id`,
            [`Disposable HR costume ${suffix}`]
        );
        costumeId = Number(costume.rows[0].id);
    });

    after(async () => {
        if (!enabled) return;
        await pool.query('DELETE FROM staff_resource_assignments WHERE staff_id = $1', [staffId]).catch(() => {});
        await pool.query('DELETE FROM warehouse_stock WHERE id = $1', [warehouseStockId]).catch(() => {});
        await pool.query('DELETE FROM costumes WHERE id = $1', [costumeId]).catch(() => {});
        await pool.query('DELETE FROM staff WHERE id = $1', [staffId]).catch(() => {});
        await pool.end();
    });

    it('keeps lost stock deducted and makes repeated loss idempotent', async () => {
        const issued = await issueStaffResource(staffId, {
            resource_kind: 'warehouse_stock',
            warehouse_stock_id: warehouseStockId,
            quantity: 2
        }, {
            actor: 'integration',
            businessContext: DEFAULT_BUSINESS_CONTEXT,
            today: '2099-07-10'
        });
        assert.equal(await stockSnapshot(), 3);
        assert.deepEqual(await movementSnapshot(), [{ movement_type: 'issue', quantity: 2 }]);

        const lost = await transitionStaffResource(staffId, issued.data.id, 'lost', {}, {
            actor: 'integration',
            today: '2099-07-11'
        });
        assert.equal(lost.data.status, 'lost');
        assert.equal(await stockSnapshot(), 3);
        assert.deepEqual(await movementSnapshot(), [{ movement_type: 'issue', quantity: 2 }]);

        const duplicate = await transitionStaffResource(staffId, issued.data.id, 'lost', {}, {
            actor: 'integration',
            today: '2099-07-11'
        });
        assert.equal(duplicate.idempotent, true);
        assert.equal(await stockSnapshot(), 3);
        assert.deepEqual(await movementSnapshot(), [{ movement_type: 'issue', quantity: 2 }]);
    });

    it('returns stock once and exposes terminal statuses through the history filter', async () => {
        const issued = await issueStaffResource(staffId, {
            resource_kind: 'warehouse_stock',
            warehouse_stock_id: warehouseStockId,
            quantity: 1
        }, {
            actor: 'integration',
            businessContext: DEFAULT_BUSINESS_CONTEXT,
            today: '2099-07-12'
        });
        assert.equal(await stockSnapshot(), 2);
        const returned = await transitionStaffResource(staffId, issued.data.id, 'returned', {}, {
            actor: 'integration',
            today: '2099-07-13'
        });
        assert.equal(returned.data.status, 'returned');
        assert.equal(await stockSnapshot(), 3);
        assert.deepEqual((await movementSnapshot()).map(row => row.movement_type), ['issue', 'issue', 'return']);

        const history = await listStaffResources(staffId, { view: 'history' });
        assert.deepEqual(new Set(history.map(row => row.status)), new Set(['lost', 'returned']));
        assert.equal(history.some(row => row.status === 'issued'), false);
    });

    it('retires a written-off costume and removes it from available options', async () => {
        const issued = await issueStaffResource(staffId, {
            resource_kind: 'costume',
            costume_id: costumeId,
            quantity: 1
        }, {
            actor: 'integration',
            businessContext: DEFAULT_BUSINESS_CONTEXT,
            today: '2099-07-14'
        });
        const assigned = await pool.query('SELECT assigned_to FROM costumes WHERE id = $1', [costumeId]);
        assert.equal(Number(assigned.rows[0].assigned_to), staffId);

        const writtenOff = await transitionStaffResource(staffId, issued.data.id, 'written_off', {}, {
            actor: 'integration',
            today: '2099-07-15'
        });
        assert.equal(writtenOff.data.status, 'written_off');
        const retired = await pool.query('SELECT condition, assigned_to FROM costumes WHERE id = $1', [costumeId]);
        assert.equal(retired.rows[0].condition, 'retired');
        assert.equal(retired.rows[0].assigned_to, null);

        const history = await listStaffResources(staffId, { view: 'history' });
        assert.ok(history.some(row => row.status === 'written_off'));
    });
});