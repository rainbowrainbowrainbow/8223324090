/**
 * routes/warehouse.js — Warehouse stock management API
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Warehouse');

const VALID_CATEGORIES = ['consumable', 'craft', 'props', 'food', 'decor', 'prizes', 'office', 'tech'];
const VALID_UNITS = ['шт', 'рул', 'уп', 'кг', 'л', 'м', 'компл', 'набір'];

// Map DB row to API response (snake_case -> camelCase)
function mapStockRow(row) {
    return {
        id: row.id,
        name: row.name,
        category: row.category,
        quantity: row.quantity,
        minQuantity: row.min_quantity,
        unit: row.unit,
        notes: row.notes,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
    };
}

function mapHistoryRow(row) {
    return {
        id: row.id,
        stockId: row.stock_id,
        change: row.change,
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: row.created_at,
        stockName: row.stock_name || null
    };
}

// Validate stock item fields
function validateStock(body) {
    const errors = [];
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 255) {
        errors.push('name is required (max 255 chars)');
    }
    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
        errors.push('invalid category');
    }
    if (body.quantity !== undefined && (typeof body.quantity !== 'number' || body.quantity < 0 || !Number.isInteger(body.quantity))) {
        errors.push('quantity must be a non-negative integer');
    }
    if (body.minQuantity !== undefined && (typeof body.minQuantity !== 'number' || body.minQuantity < 0 || !Number.isInteger(body.minQuantity))) {
        errors.push('minQuantity must be a non-negative integer');
    }
    if (body.unit && !VALID_UNITS.includes(body.unit)) {
        errors.push('invalid unit');
    }
    return errors;
}

// GET /api/warehouse — List all stock items
router.get('/', async (req, res) => {
    try {
        const conditions = ['is_active = true'];
        const params = [];
        let paramIdx = 1;

        if (req.query.category) {
            conditions.push(`category = $${paramIdx++}`);
            params.push(req.query.category);
        }
        if (req.query.search) {
            conditions.push(`name ILIKE $${paramIdx++}`);
            params.push(`%${req.query.search}%`);
        }
        if (req.query.low_stock === 'true') {
            conditions.push('quantity <= min_quantity');
        }
        if (req.query.all === 'true') {
            conditions.shift(); // remove is_active filter
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const result = await pool.query(
            `SELECT * FROM warehouse_stock ${where} ORDER BY category, name`,
            params
        );

        // Count low stock items
        const lowStockResult = await pool.query(
            'SELECT COUNT(*) FROM warehouse_stock WHERE is_active = true AND quantity <= min_quantity'
        );

        res.json({
            items: result.rows.map(mapStockRow),
            lowStockCount: parseInt(lowStockResult.rows[0].count)
        });
    } catch (err) {
        log.error('List warehouse stock error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/warehouse/history — Recent history across all items
router.get('/history', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const result = await pool.query(
            `SELECT h.*, s.name AS stock_name
             FROM warehouse_history h
             JOIN warehouse_stock s ON s.id = h.stock_id
             ORDER BY h.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        const countResult = await pool.query('SELECT COUNT(*) FROM warehouse_history');
        res.json({
            items: result.rows.map(mapHistoryRow),
            total: parseInt(countResult.rows[0].count)
        });
    } catch (err) {
        log.error('Get warehouse history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/warehouse/:id — Get single stock item with recent history
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM warehouse_stock WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Stock item not found' });
        }

        const history = await pool.query(
            `SELECT * FROM warehouse_history WHERE stock_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [id]
        );

        res.json({
            ...mapStockRow(result.rows[0]),
            history: history.rows.map(mapHistoryRow)
        });
    } catch (err) {
        log.error('Get warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/warehouse — Create new stock item (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const errors = validateStock(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            name, category = 'consumable', quantity = 0,
            minQuantity = 0, unit = 'шт', notes = null
        } = req.body;

        const result = await pool.query(
            `INSERT INTO warehouse_stock (name, category, quantity, min_quantity, unit, notes, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [name.trim(), category, quantity, minQuantity, unit, notes, req.user.username]
        );

        log.info(`Stock created: "${name}" by ${req.user.username}`);
        res.status(201).json({ success: true, item: mapStockRow(result.rows[0]) });
    } catch (err) {
        log.error('Create warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/warehouse/:id — Update stock item (admin/manager)
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT id FROM warehouse_stock WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Stock item not found' });
        }

        const errors = validateStock(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            name, category = 'consumable', minQuantity = 0,
            unit = 'шт', notes = null
        } = req.body;

        const result = await pool.query(
            `UPDATE warehouse_stock SET
                name = $1, category = $2, min_quantity = $3,
                unit = $4, notes = $5, updated_at = NOW(), updated_by = $6
             WHERE id = $7 RETURNING *`,
            [name.trim(), category, minQuantity, unit, notes, req.user.username, id]
        );

        log.info(`Stock updated: #${id} by ${req.user.username}`);
        res.json({ success: true, item: mapStockRow(result.rows[0]) });
    } catch (err) {
        log.error('Update warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/warehouse/:id — Soft-delete stock item (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE warehouse_stock SET is_active = false, updated_at = NOW(), updated_by = $1
             WHERE id = $2 RETURNING *`,
            [req.user.username, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Stock item not found' });
        }

        log.info(`Stock deactivated: #${id} by ${req.user.username}`);
        res.json({ success: true, item: mapStockRow(result.rows[0]) });
    } catch (err) {
        log.error('Delete warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/warehouse/:id/use — Deduct stock (use/consume)
router.post('/:id/use', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;

        if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
            return res.status(400).json({ error: 'amount must be a positive integer' });
        }

        await client.query('BEGIN');

        const stock = await client.query(
            'SELECT * FROM warehouse_stock WHERE id = $1 AND is_active = true FOR UPDATE',
            [id]
        );
        if (stock.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Stock item not found' });
        }

        if (stock.rows[0].quantity < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Недостатньо на складі (є ${stock.rows[0].quantity})` });
        }

        const updated = await client.query(
            `UPDATE warehouse_stock SET quantity = quantity - $1, updated_at = NOW(), updated_by = $2
             WHERE id = $3 RETURNING *`,
            [amount, req.user.username, id]
        );

        await client.query(
            `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
             VALUES ($1, $2, $3, $4)`,
            [id, -amount, reason || 'Списання', req.user.username]
        );

        await client.query('COMMIT');

        log.info(`Stock used: #${id} -${amount} by ${req.user.username}`);
        res.json({ success: true, item: mapStockRow(updated.rows[0]) });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Use warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/warehouse/:id/restock — Add stock (restock/replenish)
router.post('/:id/restock', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;

        if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
            return res.status(400).json({ error: 'amount must be a positive integer' });
        }

        await client.query('BEGIN');

        const stock = await client.query(
            'SELECT * FROM warehouse_stock WHERE id = $1 AND is_active = true FOR UPDATE',
            [id]
        );
        if (stock.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Stock item not found' });
        }

        const updated = await client.query(
            `UPDATE warehouse_stock SET quantity = quantity + $1, updated_at = NOW(), updated_by = $2
             WHERE id = $3 RETURNING *`,
            [amount, req.user.username, id]
        );

        await client.query(
            `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
             VALUES ($1, $2, $3, $4)`,
            [id, amount, reason || 'Поповнення', req.user.username]
        );

        await client.query('COMMIT');

        log.info(`Stock restocked: #${id} +${amount} by ${req.user.username}`);
        res.json({ success: true, item: mapStockRow(updated.rows[0]) });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Restock warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/warehouse/:id/history — Full history for a specific item
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        const result = await pool.query(
            `SELECT * FROM warehouse_history WHERE stock_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        );
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM warehouse_history WHERE stock_id = $1', [id]
        );

        res.json({
            items: result.rows.map(mapHistoryRow),
            total: parseInt(countResult.rows[0].count)
        });
    } catch (err) {
        log.error('Get item history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
