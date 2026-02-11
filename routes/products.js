/**
 * routes/products.js — Product catalog API (v7.0: read-only)
 */
const router = require('express').Router();
const { pool } = require('../db');
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

module.exports = router;
