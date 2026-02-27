/**
 * routes/procurement.js — Procurement planning API (v17.0)
 *
 * Shopping lists by department (animators, cleaning, cafe, tech, admin).
 * Integrated with warehouse stock for auto-suggestions and auto-restock.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Procurement');

const VALID_DEPARTMENTS = ['animators', 'admin', 'cafe', 'tech', 'cleaning', 'security'];
const VALID_STATUSES = ['draft', 'approved', 'in_progress', 'purchased', 'delivered', 'cancelled'];

// Department → Ukrainian labels
const DEPT_UK = {
    animators: 'Аніматорська',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Техніка',
    cleaning: 'Хозка',
    security: 'Охорона'
};

const STATUS_UK = {
    draft: 'Чернетка',
    approved: 'Затверджено',
    in_progress: 'В процесі',
    purchased: 'Закуплено',
    delivered: 'Доставлено',
    cancelled: 'Скасовано'
};

function mapListRow(row) {
    return {
        id: row.id,
        title: row.title,
        department: row.department,
        departmentLabel: DEPT_UK[row.department] || row.department,
        status: row.status,
        statusLabel: STATUS_UK[row.status] || row.status,
        plannedDate: row.planned_date,
        totalEstimated: row.total_estimated,
        totalActual: row.total_actual,
        assignedTo: row.assigned_to,
        assignedName: row.assigned_name || null,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        itemCount: row.item_count !== undefined ? parseInt(row.item_count) : undefined,
        purchasedCount: row.purchased_count !== undefined ? parseInt(row.purchased_count) : undefined
    };
}

function mapItemRow(row) {
    return {
        id: row.id,
        listId: row.list_id,
        stockId: row.stock_id,
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        estimatedPrice: row.estimated_price,
        actualPrice: row.actual_price,
        isPurchased: row.is_purchased,
        notes: row.notes,
        createdAt: row.created_at,
        stockName: row.stock_name || null,
        stockQuantity: row.stock_quantity !== undefined ? row.stock_quantity : null,
        stockMinQuantity: row.stock_min_quantity !== undefined ? row.stock_min_quantity : null
    };
}

// ==========================================
// LISTS CRUD
// ==========================================

// GET /api/procurement — list all procurement lists
router.get('/', async (req, res) => {
    try {
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (req.query.department && VALID_DEPARTMENTS.includes(req.query.department)) {
            conditions.push(`pl.department = $${paramIdx++}`);
            params.push(req.query.department);
        }
        if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
            conditions.push(`pl.status = $${paramIdx++}`);
            params.push(req.query.status);
        }
        // Exclude cancelled by default
        if (!req.query.all) {
            conditions.push(`pl.status != 'cancelled'`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const result = await pool.query(`
            SELECT pl.*, s.name AS assigned_name,
                COUNT(pi.id)::int AS item_count,
                COUNT(pi.id) FILTER (WHERE pi.is_purchased = true)::int AS purchased_count
            FROM procurement_lists pl
            LEFT JOIN staff s ON pl.assigned_to = s.id
            LEFT JOIN procurement_items pi ON pi.list_id = pl.id
            ${where}
            GROUP BY pl.id, s.name
            ORDER BY
                CASE pl.status
                    WHEN 'in_progress' THEN 1
                    WHEN 'approved' THEN 2
                    WHEN 'draft' THEN 3
                    WHEN 'purchased' THEN 4
                    WHEN 'delivered' THEN 5
                    ELSE 6
                END,
                pl.updated_at DESC
        `, params);

        res.json({ lists: result.rows.map(mapListRow) });
    } catch (err) {
        log.error('GET / error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/procurement/:id — get single list with items
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const listResult = await pool.query(`
            SELECT pl.*, s.name AS assigned_name
            FROM procurement_lists pl
            LEFT JOIN staff s ON pl.assigned_to = s.id
            WHERE pl.id = $1
        `, [id]);

        if (listResult.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        const itemsResult = await pool.query(`
            SELECT pi.*, ws.name AS stock_name, ws.quantity AS stock_quantity,
                   ws.min_quantity AS stock_min_quantity
            FROM procurement_items pi
            LEFT JOIN warehouse_stock ws ON pi.stock_id = ws.id
            WHERE pi.list_id = $1
            ORDER BY pi.is_purchased, pi.id
        `, [id]);

        res.json({
            ...mapListRow(listResult.rows[0]),
            items: itemsResult.rows.map(mapItemRow)
        });
    } catch (err) {
        log.error('GET /:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/procurement — create a new procurement list
router.post('/', async (req, res) => {
    try {
        const { title, department, plannedDate, assignedTo, notes } = req.body;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: 'title is required' });
        }
        if (department && !VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ error: 'invalid department' });
        }

        const result = await pool.query(`
            INSERT INTO procurement_lists (title, department, planned_date, assigned_to, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [title.trim(), department || 'admin', plannedDate || null, assignedTo || null, notes || null, req.user.username]);

        log.info(`Procurement list created: "${title}" by ${req.user.username}`);
        res.status(201).json({ success: true, list: mapListRow(result.rows[0]) });
    } catch (err) {
        log.error('POST / error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/procurement/:id — update a procurement list
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, department, status, plannedDate, assignedTo, notes } = req.body;

        const existing = await pool.query('SELECT * FROM procurement_lists WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        if (department && !VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ error: 'invalid department' });
        }
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'invalid status' });
        }

        const cur = existing.rows[0];
        const result = await pool.query(`
            UPDATE procurement_lists SET
                title = $1, department = $2, status = $3,
                planned_date = $4, assigned_to = $5, notes = $6,
                updated_at = NOW()
            WHERE id = $7 RETURNING *
        `, [
            (title || cur.title).trim(),
            department || cur.department,
            status || cur.status,
            plannedDate !== undefined ? plannedDate : cur.planned_date,
            assignedTo !== undefined ? assignedTo : cur.assigned_to,
            notes !== undefined ? notes : cur.notes,
            id
        ]);

        log.info(`Procurement list updated: #${id} by ${req.user.username}`);
        res.json({ success: true, list: mapListRow(result.rows[0]) });
    } catch (err) {
        log.error('PUT /:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/procurement/:id — cancel (soft-delete) a procurement list
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE procurement_lists SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }
        log.info(`Procurement list cancelled: #${id} by ${req.user.username}`);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// ITEMS CRUD
// ==========================================

// POST /api/procurement/:id/items — add item to list
router.post('/:id/items', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, stockId, quantity, unit, estimatedPrice, notes } = req.body;

        // Check list exists
        const list = await pool.query('SELECT id, status FROM procurement_lists WHERE id = $1', [id]);
        if (list.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'name is required' });
        }

        const result = await pool.query(`
            INSERT INTO procurement_items (list_id, stock_id, name, quantity, unit, estimated_price, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [id, stockId || null, name.trim(), quantity || 1, unit || 'шт', estimatedPrice || 0, notes || null]);

        // Recalculate total estimated
        await recalcTotals(id);

        res.status(201).json({ success: true, item: mapItemRow(result.rows[0]) });
    } catch (err) {
        log.error('POST /:id/items error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/procurement/:id/items/:itemId — update item
router.put('/:id/items/:itemId', async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { name, quantity, unit, estimatedPrice, actualPrice, isPurchased, notes } = req.body;

        const existing = await pool.query(
            'SELECT * FROM procurement_items WHERE id = $1 AND list_id = $2', [itemId, id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const cur = existing.rows[0];
        const result = await pool.query(`
            UPDATE procurement_items SET
                name = $1, quantity = $2, unit = $3,
                estimated_price = $4, actual_price = $5,
                is_purchased = $6, notes = $7
            WHERE id = $8 RETURNING *
        `, [
            (name || cur.name).trim(),
            quantity !== undefined ? quantity : cur.quantity,
            unit || cur.unit,
            estimatedPrice !== undefined ? estimatedPrice : cur.estimated_price,
            actualPrice !== undefined ? actualPrice : cur.actual_price,
            isPurchased !== undefined ? isPurchased : cur.is_purchased,
            notes !== undefined ? notes : cur.notes,
            itemId
        ]);

        await recalcTotals(id);

        res.json({ success: true, item: mapItemRow(result.rows[0]) });
    } catch (err) {
        log.error('PUT /:id/items/:itemId error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/procurement/:id/items/:itemId — remove item
router.delete('/:id/items/:itemId', async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const result = await pool.query(
            'DELETE FROM procurement_items WHERE id = $1 AND list_id = $2 RETURNING id', [itemId, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }
        await recalcTotals(id);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /:id/items/:itemId error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// STATUS ACTIONS
// ==========================================

// POST /api/procurement/:id/complete — mark as purchased + auto-restock warehouse
router.post('/:id/complete', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        await client.query('BEGIN');

        const list = await client.query('SELECT * FROM procurement_lists WHERE id = $1 FOR UPDATE', [id]);
        if (list.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        // Get all items
        const items = await client.query('SELECT * FROM procurement_items WHERE list_id = $1', [id]);

        // Auto-restock linked warehouse items
        let restockedCount = 0;
        for (const item of items.rows) {
            if (item.stock_id && !item.is_purchased) {
                // Restock warehouse
                await client.query(
                    `UPDATE warehouse_stock SET quantity = quantity + $1, updated_at = NOW(), updated_by = $2
                     WHERE id = $3 AND is_active = true`,
                    [item.quantity, req.user.username, item.stock_id]
                );
                await client.query(
                    `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
                     VALUES ($1, $2, $3, $4)`,
                    [item.stock_id, item.quantity, `Закупка #${id}: ${list.rows[0].title}`, req.user.username]
                );
                restockedCount++;
            }
            // Mark item as purchased
            await client.query(
                'UPDATE procurement_items SET is_purchased = true WHERE id = $1',
                [item.id]
            );
        }

        // Update list status
        await client.query(
            `UPDATE procurement_lists SET status = 'purchased', updated_at = NOW() WHERE id = $1`,
            [id]
        );

        await client.query('COMMIT');

        log.info(`Procurement #${id} completed: ${restockedCount} items restocked by ${req.user.username}`);
        res.json({ success: true, restockedCount });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /:id/complete error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ==========================================
// SUGGESTIONS
// ==========================================

// GET /api/procurement/suggestions — suggest items from warehouse with low stock
router.get('/suggestions/low-stock', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, category, quantity, min_quantity, unit
            FROM warehouse_stock
            WHERE is_active = true AND quantity <= min_quantity
            ORDER BY (min_quantity - quantity) DESC, category, name
        `);

        // Map warehouse categories to departments
        const CATEGORY_DEPT = {
            craft: 'animators', props: 'animators', prizes: 'animators', decor: 'animators',
            consumable: 'cleaning', office: 'admin',
            food: 'cafe', tech: 'tech'
        };

        res.json({
            suggestions: result.rows.map(r => ({
                stockId: r.id,
                name: r.name,
                category: r.category,
                currentQuantity: r.quantity,
                minQuantity: r.min_quantity,
                deficit: r.min_quantity - r.quantity,
                unit: r.unit,
                suggestedDepartment: CATEGORY_DEPT[r.category] || 'admin'
            }))
        });
    } catch (err) {
        log.error('GET /suggestions/low-stock error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// EXCEL EXPORT
// ==========================================

router.get('/export-xlsx', async (req, res) => {
    try {
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (req.query.department && VALID_DEPARTMENTS.includes(req.query.department)) {
            conditions.push(`pl.department = $${paramIdx++}`);
            params.push(req.query.department);
        }
        if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
            conditions.push(`pl.status = $${paramIdx++}`);
            params.push(req.query.status);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const result = await pool.query(`
            SELECT pl.title, pl.department, pl.status, pl.planned_date,
                   pi.name AS item_name, pi.quantity, pi.unit,
                   pi.estimated_price, pi.actual_price, pi.is_purchased,
                   s.name AS assigned_name
            FROM procurement_lists pl
            JOIN procurement_items pi ON pi.list_id = pl.id
            LEFT JOIN staff s ON pl.assigned_to = s.id
            ${where}
            ORDER BY pl.id, pi.id
        `, params);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Genix';
        const sheet = workbook.addWorksheet('Закупки');

        sheet.columns = [
            { header: 'Список', key: 'list', width: 25 },
            { header: 'Відділ', key: 'dept', width: 16 },
            { header: 'Статус', key: 'status', width: 14 },
            { header: 'Дата', key: 'date', width: 14 },
            { header: 'Позиція', key: 'item', width: 25 },
            { header: 'К-сть', key: 'qty', width: 8 },
            { header: 'Од.', key: 'unit', width: 8 },
            { header: 'Оцінка (₴)', key: 'estimated', width: 14 },
            { header: 'Факт (₴)', key: 'actual', width: 14 },
            { header: 'Куплено', key: 'purchased', width: 10 },
            { header: 'Відповідальний', key: 'assigned', width: 18 }
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

        for (const r of result.rows) {
            sheet.addRow({
                list: r.title,
                dept: DEPT_UK[r.department] || r.department,
                status: STATUS_UK[r.status] || r.status,
                date: r.planned_date || '',
                item: r.item_name,
                qty: r.quantity,
                unit: r.unit,
                estimated: r.estimated_price,
                actual: r.actual_price || '',
                purchased: r.is_purchased ? 'Так' : 'Ні',
                assigned: r.assigned_name || ''
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="procurement.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        log.error('GET /export-xlsx error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// HELPERS
// ==========================================

async function recalcTotals(listId) {
    await pool.query(`
        UPDATE procurement_lists SET
            total_estimated = COALESCE((
                SELECT SUM(quantity * estimated_price) FROM procurement_items WHERE list_id = $1
            ), 0),
            total_actual = COALESCE((
                SELECT SUM(quantity * COALESCE(actual_price, estimated_price))
                FROM procurement_items WHERE list_id = $1 AND is_purchased = true
            ), 0),
            updated_at = NOW()
        WHERE id = $1
    `, [listId]);
}

module.exports = router;
