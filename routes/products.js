/**
 * routes/products.js — Product catalog API (v7.1: full CRUD)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth'); 
const { createLogger } = require('../utils/logger');

const log = createLogger('Products');

const PRODUCT_PRICE_JOIN = `
    SELECT p.*,
           pr.code AS price_rule_code,
           pr.name AS price_rule_name,
           pr.value AS price_rule_value,
           pr.unit AS price_rule_unit,
           pr.category AS price_rule_category,
           pr.updated_at AS price_rule_updated_at,
           pr.updated_by AS price_rule_updated_by
    FROM products p
    LEFT JOIN LATERAL (
        SELECT code, name, value, unit, category, updated_at, updated_by
        FROM price_rules pr
        WHERE pr.product_id = p.id
        ORDER BY pr.updated_at DESC NULLS LAST, pr.id DESC
        LIMIT 1
    ) pr ON true
`;

function buildProductPriceRuleCode(productId) {
    const rawId = String(productId || 'product');
    const slug = rawId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    const hash = crypto.createHash('sha1').update(rawId).digest('hex').slice(0, 8);
    return `prod_${slug.slice(0, 36)}_${hash}`;
}

function getProductPriceUnit(product) {
    return product.is_per_child ? 'грн/дитина' : 'грн';
}

async function getProductWithPriceRule(client, id) {
    const result = await client.query(`${PRODUCT_PRICE_JOIN} WHERE p.id = $1`, [id]);
    return result.rows[0] || null;
}

async function upsertProductPriceRule(client, product, username) {
    const value = Number.parseInt(product.price, 10);
    const priceValue = Number.isFinite(value) && value >= 0 ? value : 0;
    const existing = await client.query(
        'SELECT code FROM price_rules WHERE product_id = $1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1',
        [product.id]
    );
    const code = existing.rows[0]?.code || buildProductPriceRuleCode(product.id);
    const description = `Центральна ціна для ${product.label || product.name || product.id}`;

    if (existing.rowCount > 0) {
        await client.query(
            `UPDATE price_rules
             SET name = $1,
                 value = $2,
                 unit = $3,
                 category = $4,
                 description = COALESCE(NULLIF(description, ''), $5),
                 updated_at = NOW(),
                 updated_by = $6
             WHERE code = $7`,
            [product.name, priceValue, getProductPriceUnit(product), product.category || 'product', description, username, code]
        );
        return code;
    }

    await client.query(
        `INSERT INTO price_rules (code, name, value, unit, category, description, product_id, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             value = EXCLUDED.value,
             unit = EXCLUDED.unit,
             category = EXCLUDED.category,
             description = COALESCE(NULLIF(price_rules.description, ''), EXCLUDED.description),
             product_id = COALESCE(price_rules.product_id, EXCLUDED.product_id),
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by
         WHERE price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id`,
        [code, product.name, priceValue, getProductPriceUnit(product), product.category || 'product', description, product.id, username]
    );
    return code;
}

// Map DB row to API response (snake_case -> camelCase)
function mapProductRow(row) {
    const hasCenterPrice = row.price_rule_code && row.price_rule_value !== null && row.price_rule_value !== undefined;
    const legacyPrice = row.price === null || row.price === undefined ? null : Number(row.price);
    const centerPrice = hasCenterPrice ? Number(row.price_rule_value) : null;
    return {
        id: row.id,
        code: row.code,
        label: row.label,
        name: row.name,
        icon: row.icon,
        category: row.category,
        duration: row.duration,
        price: hasCenterPrice ? centerPrice : legacyPrice,
        legacyPrice,
        priceSource: hasCenterPrice ? 'price_rules' : 'products',
        priceCode: row.price_rule_code || null,
        priceName: row.price_rule_name || null,
        priceUnit: row.price_rule_unit || null,
        priceCategory: row.price_rule_category || null,
        priceUpdatedAt: row.price_rule_updated_at || row.updated_at,
        priceUpdatedBy: row.price_rule_updated_by || row.updated_by,
        hosts: row.hosts,
        ageRange: row.age_range,
        kidsCapacity: row.kids_capacity,
        description: row.description,
        isPerChild: row.is_per_child,
        hasFiller: row.has_filler,
        isCustom: row.is_custom,
        isActive: row.is_active,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
    };
}

// Validate product fields
function validateProduct(body) {
    const errors = [];
    if (!body.code || typeof body.code !== 'string' || body.code.length > 20) {
        errors.push('code is required (max 20 chars)');
    }
    if (!body.label || typeof body.label !== 'string' || body.label.length > 100) {
        errors.push('label is required (max 100 chars)');
    }
    if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
        errors.push('name is required (max 200 chars)');
    }
    if (!body.category || typeof body.category !== 'string') {
        errors.push('category is required');
    }
    if (body.duration === undefined || body.duration === null || typeof body.duration !== 'number' || body.duration < 0) {
        errors.push('duration is required (non-negative number)');
    }
    if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
        errors.push('price must be a non-negative number');
    }
    if (body.hosts !== undefined && (typeof body.hosts !== 'number' || body.hosts < 0)) {
        errors.push('hosts must be a non-negative number');
    }
    return errors;
}

// GET /api/products — List all products (optional ?active=true filter)
// v39.8: Security — require authentication
router.use(authenticateToken);
router.get('/', async (req, res) => {
    try {
        const activeOnly = req.query.active === 'true';
        const query = activeOnly
            ? `${PRODUCT_PRICE_JOIN} WHERE p.is_active = true ORDER BY p.category, p.sort_order LIMIT 1000`
            : `${PRODUCT_PRICE_JOIN} ORDER BY p.category, p.sort_order LIMIT 1000`;
        const result = await pool.query(query);
        res.json(result.rows.map(mapProductRow));
    } catch (err) {
        log.error('List products error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/:id — Get single product
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        const product = await getProductWithPriceRule(pool, id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(mapProductRow(product));
    } catch (err) {
        log.error('Get product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products — Create new product (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const errors = validateProduct(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            code, label, name, icon, category, duration,
            price = 0, hosts = 1, ageRange, kidsCapacity,
            description, isPerChild = false, hasFiller = false,
            isCustom = false, sortOrder = 0
        } = req.body;

        // Generate ID from code + timestamp
        const id = code.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '') + '_' + Date.now();

        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO products (id, code, label, name, icon, category, duration, price, hosts, age_range, kids_capacity, description, is_per_child, has_filler, is_custom, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [id, code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, isPerChild, hasFiller, isCustom, sortOrder, req.user.username]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id);
        await client.query('COMMIT');

        log.info(`Product created: ${id} by ${req.user.username}`);
        res.status(201).json(mapProductRow(product));
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Create product error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/products/:id — Update product (admin/manager)
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        await client.query('BEGIN');
        // Check product exists
        const existing = await client.query('SELECT id FROM products WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }

        const errors = validateProduct(req.body);
        if (errors.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            code, label, name, icon, category, duration,
            price = 0, hosts = 1, ageRange, kidsCapacity,
            description, isPerChild = false, hasFiller = false,
            isCustom = false, isActive = true, sortOrder = 0
        } = req.body;

        const result = await client.query(
            `UPDATE products SET
                code=$1, label=$2, name=$3, icon=$4, category=$5, duration=$6,
                price=$7, hosts=$8, age_range=$9, kids_capacity=$10, description=$11,
                is_per_child=$12, has_filler=$13, is_custom=$14, is_active=$15,
                sort_order=$16, updated_at=NOW(), updated_by=$17
             WHERE id=$18 RETURNING *`,
            [code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, isPerChild, hasFiller, isCustom, isActive, sortOrder, req.user.username, id]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id);
        await client.query('COMMIT');

        log.info(`Product updated: ${id} by ${req.user.username}`);
        res.json(mapProductRow(product));
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Update product error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/products/:id — Soft-delete (deactivate) product (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        const result = await pool.query(
            `UPDATE products SET is_active = false, updated_at = NOW(), updated_by = $1 WHERE id = $2 RETURNING *`,
            [req.user.username, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        log.info(`Product deactivated: ${id} by ${req.user.username}`);
        res.json({ success: true, product: mapProductRow(result.rows[0]) });
    } catch (err) {
        log.error('Delete product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v33.8.0: Product stock requirements (Integration 1)
// ==========================================

// GET /api/products/:id/stock-requirements
router.get('/:id/stock-requirements', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT psr.*, ws.name AS stock_name, ws.quantity AS current_qty, ws.unit
             FROM product_stock_requirements psr
             JOIN warehouse_stock ws ON ws.id = psr.stock_id
             WHERE psr.product_id = $1`,
            [req.params.id]
        );
        res.json({ success: true, requirements: r.rows });
    } catch (err) {
        log.error('Get stock requirements error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/products/:id/stock-requirements
router.post('/:id/stock-requirements', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { stockId, quantity } = req.body;
        if (!stockId || !quantity || quantity < 1)
            return res.status(400).json({ error: 'stockId і quantity (>0) required' });
        const r = await pool.query(
            `INSERT INTO product_stock_requirements (product_id, stock_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id, stock_id) DO UPDATE SET quantity = $3
             RETURNING *`,
            [req.params.id, stockId, quantity]
        );
        res.json({ success: true, requirement: r.rows[0] });
    } catch (err) {
        log.error('Create stock requirement error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/products/:id/stock-requirements/:stockId
router.delete('/:id/stock-requirements/:stockId', requireRole('admin', 'manager'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM product_stock_requirements WHERE product_id = $1 AND stock_id = $2',
            [req.params.id, parseInt(req.params.stockId)]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Delete stock requirement error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
