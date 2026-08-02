/**
 * routes/procurement.js — Procurement planning API (v17.0)
 *
 * Shopping lists by department (animators, cleaning, cafe, tech, admin).
 * Integrated with warehouse stock for auto-suggestions and auto-restock.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const { canUseAction, requireAction, requireRole } = require('../middleware/auth');
const { installRevenueResponseShaper } = require('../services/revenueAccessPolicy');
const log = createLogger('Procurement');

// RBAC: Procurement — management + admin only
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'));
const requireProcurementRevenue = requireAction('view_revenue');
router.use((req, res, next) => installRevenueResponseShaper(
    req,
    res,
    next,
    canUseAction(req.user, 'view_revenue')
));

function requireProcurementRevenueFieldWrite(req, res, next) {
    if (canUseAction(req.user, 'view_revenue')) return next();
    const protectedFields = ['estimatedPrice', 'actualPrice', 'finalPrice'];
    const hasProtectedField = protectedFields.some(field => Object.prototype.hasOwnProperty.call(req.body || {}, field));
    if (!hasProtectedField) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
}

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

function toOptionalInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function toMoney(value) {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

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
        purchasedCount: row.purchased_count !== undefined ? parseInt(row.purchased_count) : undefined,
        targetLocationId: row.target_location_id || null,
        targetLocationName: row.target_location_name || null,
        contractorId: row.contractor_id || null,
        contractorName: row.contractor_name || null,
        contractorPhone: row.contractor_phone || null,
        contractorTelegramUsername: row.contractor_telegram_username || null,
        source: row.source || 'manual'
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
        note: row.note || row.notes || null,
        warehouseStockId: row.warehouse_stock_id || row.stock_id || null,
        contractorId: row.contractor_id || null,
        contractorName: row.contractor_name || null,
        contractorPhone: row.contractor_phone || null,
        contractorTelegramUsername: row.contractor_telegram_username || null,
        triggerSource: row.trigger_source || 'manual',
        receivedQuantity: row.received_quantity !== undefined ? Number(row.received_quantity || 0) : 0,
        finalPrice: row.final_price !== undefined ? Number(row.final_price || 0) : 0,
        receivedAt: row.received_at || null,
        targetLocationId: row.target_location_id || null,
        targetLocationName: row.target_location_name || null,
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
// POST /api/procurement/from-stock-item/:stockItemId - create low-stock procurement draft
router.post('/from-stock-item/:stockItemId', requireProcurementRevenue, async (req, res) => {
    const client = await pool.connect();
    try {
        const { stockItemId } = req.params;
        const stock = await client.query(`
            SELECT ws.*, wl.name AS location_name
            FROM warehouse_stock ws
            LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
            WHERE ws.id = $1 AND ws.is_active = true
        `, [stockItemId]);
        if (!stock.rowCount) return res.status(404).json({ success: false, error: 'Stock item not found' });

        const item = stock.rows[0];
        const CATEGORY_DEPT = {
            craft: 'animators', props: 'animators', prizes: 'animators', decor: 'animators', pinata: 'animators',
            consumable: 'cleaning', office: 'admin', food: 'cafe', tech: 'tech'
        };
        const deficit = Math.max(Number(item.min_quantity || 0) - Number(item.quantity || 0), 1);
        const quantity = Number(req.body.quantity || deficit);
        const targetLocationId = toOptionalInt(req.body.targetLocationId) || item.location_id || null;
        const contractorId = toOptionalInt(req.body.contractorId) || item.preferred_contractor_id || null;
        const source = req.body.source === 'kitchen_tech_card' ? 'kitchen_tech_card' : 'low_stock';
        const sourceNote = source === 'kitchen_tech_card'
            ? `Kitchen tech-card demand: ${item.quantity}/${item.min_quantity}`
            : `Low stock draft: ${item.quantity}/${item.min_quantity}`;
        const today = new Date().toISOString().slice(0, 10);

        await client.query('BEGIN');
        const list = await client.query(`
            INSERT INTO procurement_lists (
                title, department, planned_date, notes, created_by,
                target_location_id, contractor_id, source
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
        `, [
            source === 'kitchen_tech_card' ? `Кухонний попит: ${item.name}` : `Поповнення: ${item.name}`,
            CATEGORY_DEPT[item.category] || 'admin',
            today,
            sourceNote,
            req.user.username,
            targetLocationId,
            contractorId,
            source
        ]);

        const procItem = await client.query(`
            INSERT INTO procurement_items (
                list_id, stock_id, warehouse_stock_id, contractor_id, name,
                quantity, unit, estimated_price, notes, note, trigger_source
            )
            VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$8,$9)
            RETURNING *
        `, [
            list.rows[0].id,
            item.id,
            contractorId,
            item.name,
            quantity,
            item.unit,
            item.purchase_unit_price || 0,
            (req.body.notes || `Потрібно поповнити склад ${item.location_name || ''}`).trim(),
            source
        ]);

        await client.query('COMMIT');
        await recalcTotals(list.rows[0].id);
        res.status(201).json({
            success: true,
            list: mapListRow(list.rows[0]),
            item: mapItemRow(procItem.rows[0])
        });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /from-stock-item error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

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
                wl.name AS target_location_name,
                c.name AS contractor_name,
                c.phone AS contractor_phone,
                c.telegram_username AS contractor_telegram_username,
                COUNT(pi.id)::int AS item_count,
                COUNT(pi.id) FILTER (WHERE pi.is_purchased = true)::int AS purchased_count
            FROM procurement_lists pl
            LEFT JOIN staff s ON pl.assigned_to = s.id
            LEFT JOIN warehouse_locations wl ON wl.id = pl.target_location_id
            LEFT JOIN contractors c ON c.id = pl.contractor_id
            LEFT JOIN procurement_items pi ON pi.list_id = pl.id
            ${where}
            GROUP BY pl.id, s.name, wl.name, c.name, c.phone, c.telegram_username
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

router.get('/export-xlsx', requireAction('export_data'), requireAction('view_revenue'), exportProcurementXlsx);

// GET /api/procurement/:id — get single list with items
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const listResult = await pool.query(`
            SELECT pl.*, s.name AS assigned_name,
                   wl.name AS target_location_name,
                   c.name AS contractor_name,
                   c.phone AS contractor_phone,
                   c.telegram_username AS contractor_telegram_username
            FROM procurement_lists pl
            LEFT JOIN staff s ON pl.assigned_to = s.id
            LEFT JOIN warehouse_locations wl ON wl.id = pl.target_location_id
            LEFT JOIN contractors c ON c.id = pl.contractor_id
            WHERE pl.id = $1
        `, [id]);

        if (listResult.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        const itemsResult = await pool.query(`
            SELECT pi.*, ws.name AS stock_name, ws.quantity AS stock_quantity,
                   ws.min_quantity AS stock_min_quantity,
                   COALESCE(pi.warehouse_stock_id, pi.stock_id) AS warehouse_stock_id,
                   c.name AS contractor_name,
                   c.phone AS contractor_phone,
                   c.telegram_username AS contractor_telegram_username,
                   COALESCE(pl.target_location_id, ws.location_id) AS target_location_id,
                   wl.name AS target_location_name
            FROM procurement_items pi
            JOIN procurement_lists pl ON pl.id = pi.list_id
            LEFT JOIN warehouse_stock ws ON COALESCE(pi.warehouse_stock_id, pi.stock_id) = ws.id
            LEFT JOIN contractors c ON c.id = COALESCE(pi.contractor_id, pl.contractor_id)
            LEFT JOIN warehouse_locations wl ON wl.id = COALESCE(pl.target_location_id, ws.location_id)
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
        const { title, department, plannedDate, assignedTo, notes, targetLocationId, contractorId, source } = req.body;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: 'title is required' });
        }
        if (department && !VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ error: 'invalid department' });
        }

        const result = await pool.query(`
            INSERT INTO procurement_lists (
                title, department, planned_date, assigned_to, notes, created_by,
                target_location_id, contractor_id, source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            title.trim(), department || 'admin', plannedDate || null, assignedTo || null, notes || null, req.user.username,
            toOptionalInt(targetLocationId), toOptionalInt(contractorId), source || 'manual'
        ]);

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
        const { title, department, status, plannedDate, assignedTo, notes, targetLocationId, contractorId, source } = req.body;

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
                target_location_id = $7, contractor_id = $8, source = $9,
                updated_at = NOW()
            WHERE id = $10 RETURNING *
        `, [
            (title || cur.title).trim(),
            department || cur.department,
            status || cur.status,
            plannedDate !== undefined ? plannedDate : cur.planned_date,
            assignedTo !== undefined ? assignedTo : cur.assigned_to,
            notes !== undefined ? notes : cur.notes,
            targetLocationId !== undefined ? toOptionalInt(targetLocationId) : cur.target_location_id,
            contractorId !== undefined ? toOptionalInt(contractorId) : cur.contractor_id,
            source || cur.source || 'manual',
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
router.post('/:id/items', requireProcurementRevenueFieldWrite, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, stockId, warehouseStockId, contractorId, quantity, unit,
            estimatedPrice, notes, note, triggerSource
        } = req.body;

        // Check list exists
        const list = await pool.query('SELECT id, status FROM procurement_lists WHERE id = $1', [id]);
        if (list.rows.length === 0) {
            return res.status(404).json({ error: 'Procurement list not found' });
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'name is required' });
        }

        const result = await pool.query(`
            INSERT INTO procurement_items (
                list_id, stock_id, warehouse_stock_id, contractor_id, name, quantity,
                unit, estimated_price, notes, note, trigger_source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            id,
            toOptionalInt(stockId || warehouseStockId),
            toOptionalInt(warehouseStockId || stockId),
            toOptionalInt(contractorId),
            name.trim(),
            quantity || 1,
            unit || 'шт',
            estimatedPrice || 0,
            notes || null,
            note || notes || null,
            triggerSource || 'manual'
        ]);

        // Recalculate total estimated
        await recalcTotals(id);

        res.status(201).json({ success: true, item: mapItemRow(result.rows[0]) });
    } catch (err) {
        log.error('POST /:id/items error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/procurement/:id/items/:itemId — update item
router.put('/:id/items/:itemId', requireProcurementRevenue, async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const {
            name, quantity, unit, estimatedPrice, actualPrice, isPurchased,
            notes, note, contractorId, warehouseStockId, stockId
        } = req.body;

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
                is_purchased = $6, notes = $7, note = $8,
                contractor_id = $9, warehouse_stock_id = $10, stock_id = $11
            WHERE id = $12 RETURNING *
        `, [
            (name || cur.name).trim(),
            quantity !== undefined ? quantity : cur.quantity,
            unit || cur.unit,
            estimatedPrice !== undefined ? estimatedPrice : cur.estimated_price,
            actualPrice !== undefined ? actualPrice : cur.actual_price,
            isPurchased !== undefined ? isPurchased : cur.is_purchased,
            notes !== undefined ? notes : cur.notes,
            note !== undefined ? note : cur.note,
            contractorId !== undefined ? toOptionalInt(contractorId) : cur.contractor_id,
            (warehouseStockId !== undefined || stockId !== undefined) ? toOptionalInt(warehouseStockId || stockId) : cur.warehouse_stock_id,
            (stockId !== undefined || warehouseStockId !== undefined) ? toOptionalInt(stockId || warehouseStockId) : cur.stock_id,
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
router.delete('/:id/items/:itemId', requireProcurementRevenue, async (req, res) => {
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
// POST /api/procurement/:id/items/:itemId/receive - receive item into a concrete warehouse location
router.post('/:id/items/:itemId/receive', requireProcurementRevenue, requireProcurementRevenueFieldWrite, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await receiveProcurementItem(client, req.params.id, req.params.itemId, req.body, req.user.username);
        await client.query('COMMIT');
        await recalcTotals(req.params.id);
        res.json({ success: true, ...result });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /:id/items/:itemId/receive error', err);
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, error: status === 500 ? 'Internal server error' : err.message });
    } finally {
        client.release();
    }
});

router.post('/:id/complete', requireProcurementRevenue, async (req, res) => {
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

        // Receive each open item into its target warehouse location.
        let restockedCount = 0;
        for (const item of items.rows) {
            if (!item.is_purchased) {
                await receiveProcurementItem(client, id, item.id, {}, req.user.username);
                restockedCount++;
            }
        }

        // Update list status
        await client.query(
            `UPDATE procurement_lists SET status = 'delivered', updated_at = NOW() WHERE id = $1`,
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
            SELECT ws.id, ws.name, ws.category, ws.quantity, ws.min_quantity, ws.unit,
                   ws.location_id, wl.name AS location_name,
                   ws.preferred_contractor_id, c.name AS preferred_contractor_name,
                   ws.purchase_unit_price,
                   COALESCE(kitchen.linked_menu_count, 0) AS linked_menu_count,
                   kitchen.linked_menu_items,
                   COALESCE(kitchen.base_menu_usage, 0) AS base_menu_usage
            FROM warehouse_stock ws
            LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
            LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(DISTINCT p.id)::int AS linked_menu_count,
                    STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS linked_menu_items,
                    COALESCE(SUM(psr.quantity), 0)::int AS base_menu_usage
                FROM product_stock_requirements psr
                JOIN products p ON p.id = psr.product_id
                WHERE psr.stock_id = ws.id
                  AND COALESCE(p.domain, 'program') = 'kitchen'
                  AND p.kitchen_type = 'menu'
                  AND COALESCE(p.tech_card_mode, 'simple') = 'detailed'
                  AND COALESCE(p.is_active, true) = true
            ) kitchen ON true
            WHERE ws.is_active = true AND ws.quantity <= ws.min_quantity
            ORDER BY (ws.min_quantity - ws.quantity) DESC, ws.category, ws.name
        `);

        // Map warehouse categories to departments
        const CATEGORY_DEPT = {
            craft: 'animators', props: 'animators', prizes: 'animators', decor: 'animators', pinata: 'animators',
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
                suggestedDepartment: CATEGORY_DEPT[r.category] || 'admin',
                targetLocationId: r.location_id || null,
                targetLocationName: r.location_name || null,
                contractorId: r.preferred_contractor_id || null,
                contractorName: r.preferred_contractor_name || null,
                estimatedPrice: r.purchase_unit_price || 0,
                source: Number(r.linked_menu_count || 0) > 0 ? 'kitchen_tech_card' : 'low_stock',
                linkedMenuCount: Number(r.linked_menu_count || 0),
                linkedMenuItems: r.linked_menu_items || null,
                baseMenuUsage: Number(r.base_menu_usage || 0)
            }))
        });
    } catch (err) {
        log.error('GET /suggestions/low-stock error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/procurement/suggestions/kitchen-demand — warehouse-linked menu ingredient pressure
router.get('/suggestions/kitchen-demand', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ws.id, ws.name, ws.category, ws.quantity, ws.min_quantity, ws.unit,
                   ws.location_id, wl.name AS location_name,
                   ws.preferred_contractor_id, c.name AS preferred_contractor_name,
                   ws.purchase_unit_price,
                   kitchen.linked_menu_count,
                   kitchen.linked_menu_items,
                   kitchen.base_menu_usage
            FROM warehouse_stock ws
            LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
            LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
            JOIN LATERAL (
                SELECT
                    COUNT(DISTINCT p.id)::int AS linked_menu_count,
                    STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS linked_menu_items,
                    COALESCE(SUM(psr.quantity), 0)::int AS base_menu_usage
                FROM product_stock_requirements psr
                JOIN products p ON p.id = psr.product_id
                WHERE psr.stock_id = ws.id
                  AND COALESCE(p.domain, 'program') = 'kitchen'
                  AND p.kitchen_type = 'menu'
                  AND COALESCE(p.tech_card_mode, 'simple') = 'detailed'
                  AND COALESCE(p.is_active, true) = true
            ) kitchen ON kitchen.linked_menu_count > 0
            WHERE ws.is_active = true
            ORDER BY
                CASE WHEN ws.quantity <= ws.min_quantity THEN 0 ELSE 1 END,
                (ws.quantity - ws.min_quantity),
                kitchen.linked_menu_count DESC,
                ws.name
            LIMIT 30
        `);

        res.json({
            suggestions: result.rows.map(r => ({
                stockId: r.id,
                name: r.name,
                category: r.category,
                currentQuantity: r.quantity,
                minQuantity: r.min_quantity,
                deficit: Math.max(Number(r.min_quantity || 0) - Number(r.quantity || 0), 0),
                unit: r.unit,
                suggestedDepartment: r.category === 'food' ? 'cafe' : 'admin',
                targetLocationId: r.location_id || null,
                targetLocationName: r.location_name || null,
                contractorId: r.preferred_contractor_id || null,
                contractorName: r.preferred_contractor_name || null,
                estimatedPrice: r.purchase_unit_price || 0,
                source: 'kitchen_tech_card',
                linkedMenuCount: Number(r.linked_menu_count || 0),
                linkedMenuItems: r.linked_menu_items || null,
                baseMenuUsage: Number(r.base_menu_usage || 0),
                isLowStock: Number(r.quantity || 0) <= Number(r.min_quantity || 0)
            }))
        });
    } catch (err) {
        log.error('GET /suggestions/kitchen-demand error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// EXCEL EXPORT
// ==========================================

async function exportProcurementXlsx(req, res) {
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
        workbook.creator = 'Event Genix';
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
}

// ==========================================
// HELPERS
// ==========================================

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

async function resolveDefaultLocationId(client) {
    const result = await client.query(
        `SELECT id FROM warehouse_locations
         WHERE slug = 'office' AND is_active = true
         LIMIT 1`
    );
    return result.rows[0]?.id || null;
}

async function ensureReceiptStock(client, item, locationId, username) {
    let stockId = toOptionalInt(item.warehouse_stock_id || item.stock_id);
    if (!stockId) {
        const created = await client.query(
            `INSERT INTO warehouse_stock (
                name, category, quantity, min_quantity, unit, notes, is_active,
                updated_by, location_id, preferred_contractor_id, purchase_unit_price,
                is_procured_externally
             )
             VALUES ($1, 'consumable', 0, 0, $2, $3, true, $4, $5, $6, $7, true)
             RETURNING *`,
            [
                item.name,
                item.unit || 'шт',
                item.note || item.notes || null,
                username,
                locationId,
                item.contractor_id || item.list_contractor_id || null,
                item.estimated_price || 0
            ]
        );
        return created.rows[0];
    }

    const stock = await client.query('SELECT * FROM warehouse_stock WHERE id = $1 FOR UPDATE', [stockId]);
    if (!stock.rowCount) throw httpError(404, 'Linked stock item not found');
    const row = stock.rows[0];

    if (!row.location_id && locationId) {
        const updated = await client.query(
            `UPDATE warehouse_stock SET location_id = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 RETURNING *`,
            [locationId, username, row.id]
        );
        return updated.rows[0];
    }

    if (locationId && row.location_id && String(row.location_id) !== String(locationId)) {
        const sibling = await client.query(
            `SELECT * FROM warehouse_stock
             WHERE is_active = true
               AND location_id = $1
               AND name = $2
               AND category = $3
               AND unit = $4
               AND COALESCE(owner, 'park') = COALESCE($5, 'park')
             LIMIT 1 FOR UPDATE`,
            [locationId, row.name, row.category, row.unit, row.owner || 'park']
        );
        if (sibling.rowCount) return sibling.rows[0];

        const cloned = await client.query(
            `INSERT INTO warehouse_stock (
                name, category, quantity, min_quantity, unit, notes, is_active,
                updated_by, owner, location_id, preferred_contractor_id,
                purchase_unit_price, sku, is_procured_externally
             )
             VALUES ($1,$2,0,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [
                row.name, row.category, row.min_quantity, row.unit, row.notes,
                username, row.owner || 'park', locationId, row.preferred_contractor_id || null,
                row.purchase_unit_price || 0, row.sku || null, row.is_procured_externally === true
            ]
        );
        return cloned.rows[0];
    }

    return row;
}

async function receiveProcurementItem(client, listId, itemId, body = {}, username = 'system') {
    const itemResult = await client.query(`
        SELECT pi.*, pl.title AS list_title, pl.target_location_id, pl.contractor_id AS list_contractor_id
        FROM procurement_items pi
        JOIN procurement_lists pl ON pl.id = pi.list_id
        WHERE pi.id = $1 AND pi.list_id = $2
        FOR UPDATE OF pi
    `, [itemId, listId]);
    if (!itemResult.rowCount) throw httpError(404, 'Procurement item not found');

    const item = itemResult.rows[0];
    const receivedQty = Number(body.receivedQty || body.receivedQuantity || item.quantity || 1);
    if (!Number.isFinite(receivedQty) || receivedQty <= 0) throw httpError(400, 'receivedQty must be positive');

    const requestedLocationId = toOptionalInt(body.locationId) || item.target_location_id || null;
    const locationId = requestedLocationId || await resolveDefaultLocationId(client);
    const stock = await ensureReceiptStock(client, {
        ...item,
        warehouse_stock_id: body.warehouseStockId || item.warehouse_stock_id,
        stock_id: body.stockId || item.stock_id
    }, locationId, username);

    const finalPrice = body.finalPrice !== undefined
        ? toMoney(body.finalPrice)
        : toMoney(item.actual_price || item.final_price || item.estimated_price);
    const contractorId = toOptionalInt(body.contractorId) || item.contractor_id || item.list_contractor_id || null;

    const updatedStock = await client.query(
        `UPDATE warehouse_stock
         SET quantity = quantity + $1,
             purchase_unit_price = CASE WHEN $2 > 0 THEN $2 ELSE purchase_unit_price END,
             preferred_contractor_id = COALESCE(preferred_contractor_id, $3),
             updated_at = NOW(),
             updated_by = $4
         WHERE id = $5
         RETURNING *`,
        [receivedQty, finalPrice, contractorId, username, stock.id]
    );

    await client.query(
        `INSERT INTO warehouse_stock_movements (
            warehouse_stock_id, movement_type, from_location_id, to_location_id,
            quantity, reason, related_procurement_item_id, created_by
         )
         VALUES ($1, 'receipt', NULL, $2, $3, $4, $5, $6)`,
        [stock.id, locationId, receivedQty, `Закупка #${listId}: ${item.list_title}`, item.id, username]
    );

    await client.query(
        `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
         VALUES ($1, $2, $3, $4)`,
        [stock.id, receivedQty, `Закупка #${listId}: ${item.list_title}`, username]
    );

    const updatedItem = await client.query(
        `UPDATE procurement_items
         SET stock_id = $1,
             warehouse_stock_id = $1,
             contractor_id = COALESCE(contractor_id, $2),
             is_purchased = true,
             received_quantity = COALESCE(received_quantity, 0) + $3,
             final_price = $4::numeric,
             actual_price = ROUND($4::numeric)::int,
             received_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [stock.id, contractorId, receivedQty, finalPrice, item.id]
    );

    if (contractorId) {
        await client.query(
            `INSERT INTO contractor_stock_links (
                contractor_id, warehouse_stock_id, last_price, is_primary, notes, updated_at
             )
             VALUES ($1, $2, $3, true, $4, NOW())
             ON CONFLICT (contractor_id, warehouse_stock_id) DO UPDATE SET
                last_price = EXCLUDED.last_price,
                is_primary = true,
                notes = COALESCE(contractor_stock_links.notes, EXCLUDED.notes),
                updated_at = NOW()`,
            [contractorId, stock.id, finalPrice, `Остання закупка #${listId}`]
        );
        await client.query(
            `UPDATE contractors
             SET last_ordered_at = NOW(),
                 last_order_price = $1,
                 last_order_item_summary = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [finalPrice, item.name, contractorId]
        );
    }

    const remaining = await client.query(
        `SELECT COUNT(*)::int AS open_count
         FROM procurement_items
         WHERE list_id = $1 AND COALESCE(is_purchased, false) = false`,
        [listId]
    );
    if (Number(remaining.rows[0].open_count || 0) === 0) {
        await client.query(
            `UPDATE procurement_lists SET status = 'delivered', updated_at = NOW() WHERE id = $1`,
            [listId]
        );
    }

    return {
        item: mapItemRow(updatedItem.rows[0]),
        stock: updatedStock.rows[0],
        receivedQuantity: receivedQty,
        targetLocationId: locationId
    };
}

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
