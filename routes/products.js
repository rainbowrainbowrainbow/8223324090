/**
 * routes/products.js — Product catalog API (v7.1: full CRUD)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Products');

// Map DB row to API response (snake_case -> camelCase)
function mapProductRow(row) {
    return {
        id: row.id,
        code: row.code,
        label: row.label,
        name: row.name,
        icon: row.icon,
        category: row.category,
        duration: row.duration,
        price: row.price,
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
router.get('/', async (req, res) => {
    try {
        const activeOnly = req.query.active === 'true';
        const query = activeOnly
            ? 'SELECT * FROM products WHERE is_active = true ORDER BY category, sort_order'
            : 'SELECT * FROM products ORDER BY category, sort_order';
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
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(mapProductRow(result.rows[0]));
    } catch (err) {
        log.error('Get product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products — Create new product (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
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

        const result = await pool.query(
            `INSERT INTO products (id, code, label, name, icon, category, duration, price, hosts, age_range, kids_capacity, description, is_per_child, has_filler, is_custom, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [id, code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, isPerChild, hasFiller, isCustom, sortOrder, req.user.username]
        );

        log.info(`Product created: ${id} by ${req.user.username}`);
        res.status(201).json(mapProductRow(result.rows[0]));
    } catch (err) {
        log.error('Create product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/products/:id — Update product (admin/manager)
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        // Check product exists
        const existing = await pool.query('SELECT id FROM products WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const errors = validateProduct(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            code, label, name, icon, category, duration,
            price = 0, hosts = 1, ageRange, kidsCapacity,
            description, isPerChild = false, hasFiller = false,
            isCustom = false, isActive = true, sortOrder = 0
        } = req.body;

        const result = await pool.query(
            `UPDATE products SET
                code=$1, label=$2, name=$3, icon=$4, category=$5, duration=$6,
                price=$7, hosts=$8, age_range=$9, kids_capacity=$10, description=$11,
                is_per_child=$12, has_filler=$13, is_custom=$14, is_active=$15,
                sort_order=$16, updated_at=NOW(), updated_by=$17
             WHERE id=$18 RETURNING *`,
            [code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, isPerChild, hasFiller, isCustom, isActive, sortOrder, req.user.username, id]
        );

        log.info(`Product updated: ${id} by ${req.user.username}`);
        res.json(mapProductRow(result.rows[0]));
    } catch (err) {
        log.error('Update product error', err);
        res.status(500).json({ error: 'Internal server error' });
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

module.exports = router;
