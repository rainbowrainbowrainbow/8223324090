/**
 * routes/warehouse.js — Warehouse stock management API
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const warehousePhotoIntake = require('../services/warehousePhotoIntake');

const log = createLogger('Warehouse');

// v39.8: Security — require authentication for all warehouse endpoints
const { authenticateToken } = require('../middleware/auth');
router.use(authenticateToken);
// v40: Validate :id param is numeric
router.param('id', (req, res, next, val) => { if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' }); next(); });

const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'];
const VALID_CATEGORIES = ['consumable', 'craft', 'props', 'food', 'decor', 'prizes', 'office', 'tech', 'pinata'];
const VALID_UNITS = ['шт', 'рул', 'уп', 'кг', 'л', 'м', 'компл', 'набір'];
const VALID_OWNERS = ['park', 'dar', 'shared'];

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
        updatedBy: row.updated_by,
        owner: row.owner || 'park',
        locationId: row.location_id || null,
        locationName: row.location_name || null,
        locationSlug: row.location_slug || null,
        preferredContractorId: row.preferred_contractor_id || null,
        preferredContractorName: row.preferred_contractor_name || null,
        purchaseUnitPrice: row.purchase_unit_price !== undefined ? Number(row.purchase_unit_price || 0) : 0,
        sku: row.sku || null,
        isProcuredExternally: row.is_procured_externally === true,
        lastOrderPrice: row.last_order_price !== undefined ? Number(row.last_order_price || 0) : 0,
        lastOrderedAt: row.last_ordered_at || null
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
    if (body.owner && !VALID_OWNERS.includes(body.owner)) {
        errors.push('invalid owner');
    }
    return errors;
}

function toOptionalInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function toOptionalMoney(value) {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

function cleanLocationText(value, maxLength = 120) {
    if (value === undefined || value === null) return '';
    return String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function cleanLocationDescription(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim().replace(/\s+/g, ' ').slice(0, 800);
}

function toLocationSortOrder(value) {
    if (value === undefined || value === null || value === '') return 100;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null;
}

function makeLocationSlug(name) {
    const base = cleanLocationText(name, 80)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    return base || `warehouse_${Date.now().toString(36)}`;
}

async function uniqueLocationSlug(client, name) {
    const base = makeLocationSlug(name);
    for (let i = 0; i < 50; i++) {
        const candidate = i === 0 ? base : `${base}_${i}`.slice(0, 80);
        const exists = await client.query('SELECT id FROM warehouse_locations WHERE slug = $1 LIMIT 1', [candidate]);
        if (!exists.rowCount) return candidate;
    }
    return `${base.slice(0, 63)}_${Date.now().toString(36)}`.slice(0, 80);
}

function validateLocationPayload(body = {}) {
    const errors = [];
    const name = cleanLocationText(body.name, 120);
    const description = cleanLocationDescription(body.description);
    const sortOrder = toLocationSortOrder(body.sortOrder ?? body.sort_order);

    if (!name) errors.push('name is required');
    if (sortOrder === null) errors.push('sortOrder must be an integer from 0 to 9999');

    return { errors, location: { name, description, sortOrder: sortOrder ?? 100 } };
}

function mapLocationRow(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        sortOrder: row.sort_order,
        isActive: row.is_active !== false,
        itemsCount: Number(row.items_count || 0),
        lowStockCount: Number(row.low_stock_count || 0),
        totalUnits: Number(row.total_units || 0),
        lastMovementAt: row.last_movement_at || null,
        updatedAt: row.updated_at || null
    };
}

function locationSummaryQuery(whereClause = 'l.is_active = true') {
    return `
        SELECT
            l.id,
            l.slug,
            l.name,
            l.description,
            l.sort_order,
            l.is_active,
            l.updated_at,
            COUNT(DISTINCT ws.id) FILTER (WHERE ws.is_active = true)::int AS items_count,
            COUNT(DISTINCT ws.id) FILTER (WHERE ws.is_active = true AND ws.quantity <= ws.min_quantity)::int AS low_stock_count,
            COALESCE(SUM(ws.quantity) FILTER (WHERE ws.is_active = true), 0)::numeric AS total_units,
            (
                SELECT MAX(m.created_at)
                FROM warehouse_stock_movements m
                WHERE m.to_location_id = l.id OR m.from_location_id = l.id
            ) AS last_movement_at
        FROM warehouse_locations l
        LEFT JOIN warehouse_stock ws ON ws.location_id = l.id
        WHERE ${whereClause}
        GROUP BY l.id
        ORDER BY l.sort_order, l.name
    `;
}

async function getLocationSummaryById(locationId) {
    const result = await pool.query(locationSummaryQuery('l.id = $1'), [locationId]);
    return result.rows[0] ? mapLocationRow(result.rows[0]) : null;
}

// v32.1: Alias /items → / for frontend compatibility
router.get('/items', (req, res, next) => {
    req.url = '/';
    next();
});

// GET /api/warehouse/locations - active physical warehouse locations
router.get('/locations', async (req, res) => {
    try {
        const includeInactive = req.query.all === 'true';
        const result = await pool.query(locationSummaryQuery(includeInactive ? 'true' : 'l.is_active = true'));
        res.json({ success: true, locations: result.rows.map(mapLocationRow) });
    } catch (err) {
        log.error('Locations list error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/warehouse/locations - create a physical warehouse location
router.post('/locations', requireRole(...MANAGE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const { errors, location } = validateLocationPayload(req.body || {});
        if (errors.length) return res.status(400).json({ success: false, error: errors.join('; ') });

        const slug = await uniqueLocationSlug(client, location.name);
        const result = await client.query(
            `INSERT INTO warehouse_locations (slug, name, description, sort_order, is_active, updated_at)
             VALUES ($1, $2, $3, $4, true, NOW())
             RETURNING *`,
            [slug, location.name, location.description || null, location.sortOrder]
        );
        log.info(`Warehouse location created: "${location.name}" by ${req.user.username}`);
        res.status(201).json({ success: true, location: mapLocationRow(result.rows[0]) });
    } catch (err) {
        log.error('Create warehouse location error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/warehouse/locations/:id - update location name/description/order
router.put('/locations/:id', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const { errors, location } = validateLocationPayload(req.body || {});
        if (errors.length) return res.status(400).json({ success: false, error: errors.join('; ') });

        const result = await pool.query(
            `UPDATE warehouse_locations
             SET name = $1, description = $2, sort_order = $3, updated_at = NOW()
             WHERE id = $4 AND is_active = true
             RETURNING id`,
            [location.name, location.description || null, location.sortOrder, req.params.id]
        );
        if (!result.rowCount) return res.status(404).json({ success: false, error: 'Location not found' });

        const updated = await getLocationSummaryById(req.params.id);
        log.info(`Warehouse location updated: #${req.params.id} by ${req.user.username}`);
        res.json({ success: true, location: updated });
    } catch (err) {
        log.error('Update warehouse location error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/warehouse/locations/:id - archive an empty location safely
router.delete('/locations/:id', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const activeStock = await pool.query(
            `SELECT COUNT(*)::int AS active_stock_count
             FROM warehouse_stock
             WHERE location_id = $1 AND is_active = true`,
            [req.params.id]
        );
        const activeStockCount = Number(activeStock.rows[0]?.active_stock_count || 0);
        if (activeStockCount > 0) {
            return res.status(409).json({
                success: false,
                error: 'Location has active stock. Move or archive stock items before archiving this location.',
                activeStockCount
            });
        }

        const result = await pool.query(
            `UPDATE warehouse_locations
             SET is_active = false, updated_at = NOW()
             WHERE id = $1 AND is_active = true
             RETURNING *`,
            [req.params.id]
        );
        if (!result.rowCount) return res.status(404).json({ success: false, error: 'Location not found' });

        log.info(`Warehouse location archived: #${req.params.id} by ${req.user.username}`);
        res.json({ success: true, location: mapLocationRow(result.rows[0]) });
    } catch (err) {
        log.error('Archive warehouse location error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/warehouse/locations-summary - physical warehouse cards
router.get('/locations-summary', async (req, res) => {
    try {
        const result = await pool.query(locationSummaryQuery('l.is_active = true'));
        res.json({ success: true, locations: result.rows.map(mapLocationRow) });
    } catch (err) {
        log.error('Locations summary error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/warehouse — List all stock items
router.get('/', async (req, res) => {
    try {
        const conditions = ['ws.is_active = true'];
        const params = [];
        let paramIdx = 1;

        if (req.query.category) {
            conditions.push(`ws.category = $${paramIdx++}`);
            params.push(req.query.category);
        }
        const search = req.query.search || req.query.q;
        if (search) {
            conditions.push(`(ws.name ILIKE $${paramIdx} OR COALESCE(ws.notes, '') ILIKE $${paramIdx} OR COALESCE(ws.sku, '') ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (req.query.low_stock === 'true') {
            conditions.push('ws.quantity <= ws.min_quantity');
        }
        if (req.query.owner) {
            if (!VALID_OWNERS.includes(req.query.owner)) {
                return res.status(400).json({ success: false, error: 'invalid owner' });
            }
            conditions.push(`COALESCE(ws.owner, 'park') = $${paramIdx++}`);
            params.push(req.query.owner);
        }
        if (req.query.locationId) {
            conditions.push(`ws.location_id = $${paramIdx++}`);
            params.push(req.query.locationId);
        }
        if (req.query.all === 'true') {
            conditions.shift(); // remove is_active filter
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // v32.1: Ensure table exists before querying
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_stock (
                id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'consumable',
                quantity INTEGER NOT NULL DEFAULT 0, min_quantity INTEGER NOT NULL DEFAULT 0,
                unit VARCHAR(30) NOT NULL DEFAULT 'шт', notes TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
                updated_by VARCHAR(100)
            )`);
        } catch (e) { /* table already exists */ }

        const result = await pool.query(
            `SELECT
                ws.*,
                wl.name AS location_name,
                wl.slug AS location_slug,
                c.name AS preferred_contractor_name,
                c.last_order_price,
                c.last_ordered_at
             FROM warehouse_stock ws
             LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
             LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
             ${where}
             ORDER BY wl.sort_order NULLS LAST, ws.category, ws.sort_order NULLS LAST, ws.name`,
            params
        );

        // Count low stock items
        const lowStockResult = await pool.query(
            `SELECT COUNT(*) FROM warehouse_stock ws ${where ? where + ' AND' : 'WHERE'} ws.quantity <= ws.min_quantity`,
            params
        );

        res.json({
            success: true,
            items: result.rows.map(mapStockRow),
            lowStockCount: parseInt(lowStockResult.rows[0].count),
            warehouseMode: {
                source: 'warehouse_stock.location_id',
                dimensions: 'warehouse_locations',
                transferSemantics: 'warehouse_stock_movements'
            }
        });
    } catch (err) {
        log.error('List warehouse stock error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
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

// ─── Pinata Status & Designs (v33.5) ─────────────────────────
// GET /api/warehouse/pinata-status
router.get('/pinata-status', async (req, res) => {
    try {
        const [stock, upcoming, designs] = await Promise.all([
            pool.query(
                `SELECT ws.id, ws.name, ws.quantity, ws.min_quantity, ws.unit,
                        ws.location_id, wl.name AS location_name
                 FROM warehouse_stock ws
                 LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
                 WHERE ws.linked_product_type = 'pinata_filler'
                   AND ws.is_active = true
                   AND (
                        ws.location_id = (SELECT id FROM warehouse_locations WHERE slug = 'animators_room' LIMIT 1)
                        OR ws.location_id IS NULL
                   )
                 ORDER BY ws.name`
            ),
            pool.query(
                `SELECT id, date, time, pinata_filler, pinata_number, pinata_filler_number, group_name
                 FROM bookings
                 WHERE pinata_filler IS NOT NULL
                   AND pinata_filler != ''
                   AND COALESCE(pinata_mode, 'park') = 'park'
                   AND date::date >= CURRENT_DATE
                   AND date::date <= CURRENT_DATE + INTERVAL '14 days'
                   AND status != 'cancelled'
                 ORDER BY date, time`
            ),
            pool.query('SELECT * FROM pinata_designs WHERE is_active = true ORDER BY name')
        ]);
        const needed   = upcoming.rowCount;
        const minStock = stock.rows.length
            ? Math.min(...stock.rows.map(s => s.quantity))
            : 0;
        const hasEnough = minStock >= needed;
        res.json({
            success: true,
            stock: stock.rows,
            upcomingCount: needed,
            upcomingList: upcoming.rows,
            designs: designs.rows,
            hasEnough,
            alert: !hasEnough || stock.rows.some(s => s.quantity <= s.min_quantity)
        });
    } catch (err) {
        log.error('GET /pinata-status', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/warehouse/pinata-designs
router.get('/pinata-designs', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM pinata_designs WHERE is_active = true ORDER BY name');
        res.json({ success: true, designs: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/warehouse/pinata-designs
router.post('/pinata-designs', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { name, printsQty, imageUrl } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'name required' });
        const r = await pool.query(
            `INSERT INTO pinata_designs (name, prints_qty, image_url) VALUES ($1, $2, $3) RETURNING *`,
            [name.trim(), printsQty || 0, imageUrl || null]
        );
        res.json({ success: true, design: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// PATCH /api/warehouse/pinata-designs/:id
router.patch('/pinata-designs/:id', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { printsQty, name, imageUrl, isActive } = req.body;
        const sets = ['updated_at = NOW()'], vals = [];
        let idx = 1;
        if (name !== undefined)      { sets.push(`name = $${idx++}`);       vals.push(name); }
        if (printsQty !== undefined) { sets.push(`prints_qty = $${idx++}`); vals.push(printsQty); }
        if (imageUrl !== undefined)  { sets.push(`image_url = $${idx++}`);  vals.push(imageUrl); }
        if (isActive !== undefined)  { sets.push(`is_active = $${idx++}`);  vals.push(isActive === true || isActive === 'true'); }
        vals.push(req.params.id);
        const r = await pool.query(
            `UPDATE pinata_designs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, design: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/warehouse/categories — List unique categories
// GET /api/warehouse/photo-intake/status - Telegram photo intake readiness
router.get('/photo-intake/status', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const status = await warehousePhotoIntake.getIntakeStatus();
        res.json({ success: true, status });
    } catch (err) {
        log.error('Warehouse photo intake status error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/warehouse/photo-intake - recent Telegram photo intake queue
router.get('/photo-intake', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const items = await warehousePhotoIntake.listIntakes({
            status: req.query.status || 'all',
            limit: req.query.limit || 30
        });
        res.json({ success: true, items });
    } catch (err) {
        log.error('Warehouse photo intake list error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/warehouse/photo-intake/:id - single Telegram photo intake detail
router.get('/photo-intake/:id', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const item = await warehousePhotoIntake.getIntake(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'intake_not_found' });
        res.json({ success: true, item });
    } catch (err) {
        log.error('Warehouse photo intake detail error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/warehouse/photo-intake/:id/confirm - write reviewed draft into warehouse truth
router.post('/photo-intake/:id/confirm', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const result = await warehousePhotoIntake.confirmIntake(req.params.id, {
            actor: req.user?.username || req.user?.name || 'crm',
            draft: req.body?.draft || req.body || {},
            warehouseStockId: req.body?.warehouseStockId || req.body?.stockId || null
        });
        if (!result.success) return res.status(result.status || 400).json(result);
        res.json(result);
    } catch (err) {
        log.error('Warehouse photo intake confirm error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/warehouse/photo-intake/:id/cancel - cancel a Telegram photo intake draft
router.post('/photo-intake/:id/cancel', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const result = await warehousePhotoIntake.cancelIntake(req.params.id, {
            actor: req.user?.username || req.user?.name || 'crm',
            notes: req.body?.notes || null
        });
        if (!result.success) return res.status(result.status || 400).json(result);
        res.json(result);
    } catch (err) {
        log.error('Warehouse photo intake cancel error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/categories', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT category FROM warehouse_stock WHERE category IS NOT NULL ORDER BY category`
        );
        res.json(result.rows.map(r => r.category));
    } catch (err) {
        log.error('[Warehouse] Get categories error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/warehouse/:id — Get single stock item with recent history
// POST /api/warehouse/stock/:id/transfer - move quantity between physical locations
router.post('/stock/:id/transfer', requireRole(...MANAGE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { toLocationId, quantity, reason } = req.body;
        const amount = Number(quantity);
        const targetLocationId = toOptionalInt(toLocationId);

        if (!targetLocationId) return res.status(400).json({ success: false, error: 'toLocationId is required' });
        if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'quantity must be a positive integer' });

        await client.query('BEGIN');

        const source = await client.query(
            'SELECT * FROM warehouse_stock WHERE id = $1 AND is_active = true FOR UPDATE',
            [id]
        );
        if (!source.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Stock item not found' });
        }

        const item = source.rows[0];
        if (Number(item.quantity) < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: `Not enough stock (${item.quantity})` });
        }
        if (String(item.location_id || '') === String(targetLocationId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Target location must differ from source' });
        }

        const location = await client.query('SELECT id FROM warehouse_locations WHERE id = $1 AND is_active = true', [targetLocationId]);
        if (!location.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Target location not found' });
        }

        await client.query(
            `UPDATE warehouse_stock SET quantity = quantity - $1, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
            [amount, req.user.username, id]
        );

        const target = await client.query(
            `SELECT * FROM warehouse_stock
             WHERE is_active = true
               AND location_id = $1
               AND name = $2
               AND category = $3
               AND unit = $4
               AND COALESCE(owner, 'park') = COALESCE($5, 'park')
             LIMIT 1 FOR UPDATE`,
            [targetLocationId, item.name, item.category, item.unit, item.owner || 'park']
        );

        let targetStockId;
        if (target.rowCount) {
            targetStockId = target.rows[0].id;
            await client.query(
                `UPDATE warehouse_stock SET quantity = quantity + $1, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
                [amount, req.user.username, targetStockId]
            );
        } else {
            const created = await client.query(
                `INSERT INTO warehouse_stock (
                    name, category, quantity, min_quantity, unit, notes, is_active, updated_by, owner,
                    location_id, preferred_contractor_id, purchase_unit_price, sku, is_procured_externally
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13)
                 RETURNING id`,
                [
                    item.name, item.category, amount, item.min_quantity, item.unit, item.notes,
                    req.user.username, item.owner || 'park', targetLocationId, item.preferred_contractor_id || null,
                    item.purchase_unit_price || 0, item.sku || null, item.is_procured_externally === true
                ]
            );
            targetStockId = created.rows[0].id;
        }

        await client.query(
            `INSERT INTO warehouse_stock_movements (
                warehouse_stock_id, movement_type, from_location_id, to_location_id,
                quantity, reason, created_by
             )
             VALUES ($1, 'transfer', $2, $3, $4, $5, $6)`,
            [id, item.location_id || null, targetLocationId, amount, reason || 'Переміщення між складами', req.user.username]
        );

        await client.query(
            `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
             VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)`,
            [
                id, -amount, reason || 'Переміщення зі складу',
                req.user.username, targetStockId, amount, reason || 'Переміщення на склад'
            ]
        );

        await client.query('COMMIT');
        res.json({ success: true, sourceStockId: Number(id), targetStockId, quantity: amount });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Transfer warehouse item error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/warehouse/stock/:id/movements - movement timeline for item
router.get('/stock/:id/movements', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, fl.name AS from_location_name, tl.name AS to_location_name
            FROM warehouse_stock_movements m
            LEFT JOIN warehouse_locations fl ON fl.id = m.from_location_id
            LEFT JOIN warehouse_locations tl ON tl.id = m.to_location_id
            WHERE m.warehouse_stock_id = $1
            ORDER BY m.created_at DESC
            LIMIT 80
        `, [req.params.id]);
        res.json({ success: true, movements: result.rows });
    } catch (err) {
        log.error('Get movement timeline error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT ws.*, wl.name AS location_name, wl.slug AS location_slug,
                   c.name AS preferred_contractor_name, c.last_order_price, c.last_ordered_at
            FROM warehouse_stock ws
            LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
            LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
            WHERE ws.id = $1
        `, [id]);
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
router.post('/', requireRole(...MANAGE_ROLES), async (req, res) => {
    try {
        const errors = validateStock(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            name, category = 'consumable', quantity = 0,
            minQuantity = 0, unit = 'шт', notes = null, owner = 'park',
            locationId = null, preferredContractorId = null, sku = null,
            purchaseUnitPrice = 0, isProcuredExternally = false
        } = req.body;

        const result = await pool.query(
            `INSERT INTO warehouse_stock (
                name, category, quantity, min_quantity, unit, notes, updated_by, owner,
                location_id, preferred_contractor_id, sku, purchase_unit_price, is_procured_externally
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
                name.trim(), category, quantity, minQuantity, unit, notes, req.user.username, owner,
                toOptionalInt(locationId), toOptionalInt(preferredContractorId), sku || null,
                toOptionalMoney(purchaseUnitPrice), isProcuredExternally === true
            ]
        );

        log.info(`Stock created: "${name}" by ${req.user.username}`);
        res.status(201).json({ success: true, item: mapStockRow(result.rows[0]) });
    } catch (err) {
        log.error('Create warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/warehouse/:id — Update stock item (admin/manager)
router.put('/:id', requireRole(...MANAGE_ROLES), async (req, res) => {
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
            unit = 'шт', notes = null, owner = 'park',
            locationId = null, preferredContractorId = null, sku = null,
            purchaseUnitPrice = 0, isProcuredExternally = false
        } = req.body;

        const result = await pool.query(
            `UPDATE warehouse_stock SET
                name = $1, category = $2, min_quantity = $3,
                unit = $4, notes = $5, updated_at = NOW(), updated_by = $6, owner = $7,
                location_id = $8, preferred_contractor_id = $9, sku = $10,
                purchase_unit_price = $11, is_procured_externally = $12
             WHERE id = $13 RETURNING *`,
            [
                name.trim(), category, minQuantity, unit, notes, req.user.username, owner,
                toOptionalInt(locationId), toOptionalInt(preferredContractorId), sku || null,
                toOptionalMoney(purchaseUnitPrice), isProcuredExternally === true, id
            ]
        );

        log.info(`Stock updated: #${id} by ${req.user.username}`);
        res.json({ success: true, item: mapStockRow(result.rows[0]) });
    } catch (err) {
        log.error('Update warehouse item error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/warehouse/:id — Soft-delete stock item (admin only)
router.delete('/:id', requireRole(...MANAGE_ROLES), async (req, res) => {
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

        await client.query(
            `INSERT INTO warehouse_stock_movements (
                warehouse_stock_id, movement_type, from_location_id, to_location_id,
                quantity, reason, created_by
             )
             VALUES ($1, 'issue', $2, NULL, $3, $4, $5)`,
            [id, stock.rows[0].location_id || null, amount, reason || 'Списання', req.user.username]
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

        await client.query(
            `INSERT INTO warehouse_stock_movements (
                warehouse_stock_id, movement_type, from_location_id, to_location_id,
                quantity, reason, created_by
             )
             VALUES ($1, 'manual_adjustment', NULL, $2, $3, $4, $5)`,
            [id, stock.rows[0].location_id || null, amount, reason || 'Поповнення', req.user.username]
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
