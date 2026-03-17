/**
 * routes/booking-templates.js — CRUD for reusable booking templates
 * v30.3: Save/load booking presets
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('BookingTemplates');

function mapRow(r) {
    return {
        id: r.id,
        name: r.name,
        productId: r.product_id,
        productCode: r.product_code,
        productName: r.product_name,
        category: r.category,
        duration: r.duration,
        price: r.price ? parseFloat(r.price) : null,
        room: r.room,
        kidsCount: r.kids_count,
        hosts: r.hosts,
        secondAnimatorName: r.second_animator_name,
        pinataFiller: r.pinata_filler,
        costume: r.costume,
        notes: r.notes,
        isFavorite: r.is_favorite,
        usageCount: r.usage_count,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    };
}

// GET /api/booking-templates — list all templates
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM booking_templates ORDER BY is_favorite DESC, usage_count DESC, name ASC'
        );
        res.json(rows.map(mapRow));
    } catch (err) {
        log.error('List error:', err.message);
        res.status(500).json({ error: 'Помилка завантаження шаблонів' });
    }
});

// POST /api/booking-templates — create new template
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, productId, productCode, productName, category, duration,
                price, room, kidsCount, hosts, secondAnimatorName,
                pinataFiller, costume, notes } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Назва шаблону обов\'язкова' });
        }

        const { rows } = await pool.query(`
            INSERT INTO booking_templates
                (name, product_id, product_code, product_name, category, duration,
                 price, room, kids_count, hosts, second_animator_name,
                 pinata_filler, costume, notes, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *
        `, [name.trim(), productId || null, productCode || null, productName || null,
            category || null, duration || 60, price || null, room || null,
            kidsCount || null, hosts || 1, secondAnimatorName || null,
            pinataFiller || null, costume || null, notes || null,
            req.user?.username || 'system']);

        log.info(`Template created: "${name}" by ${req.user?.username}`);
        res.status(201).json(mapRow(rows[0]));
    } catch (err) {
        log.error('Create error:', err.message);
        res.status(500).json({ error: 'Помилка створення шаблону' });
    }
});

// PUT /api/booking-templates/:id — update template
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, productId, productCode, productName, category, duration,
                price, room, kidsCount, hosts, secondAnimatorName,
                pinataFiller, costume, notes, isFavorite } = req.body;

        const { rows } = await pool.query(`
            UPDATE booking_templates SET
                name = COALESCE($1, name),
                product_id = $2, product_code = $3, product_name = $4,
                category = $5, duration = COALESCE($6, duration),
                price = $7, room = $8, kids_count = $9, hosts = $10,
                second_animator_name = $11, pinata_filler = $12,
                costume = $13, notes = $14,
                is_favorite = COALESCE($15, is_favorite),
                updated_at = NOW()
            WHERE id = $16
            RETURNING *
        `, [name, productId || null, productCode || null, productName || null,
            category || null, duration, price || null, room || null,
            kidsCount || null, hosts || 1, secondAnimatorName || null,
            pinataFiller || null, costume || null, notes || null,
            isFavorite, req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }
        res.json(mapRow(rows[0]));
    } catch (err) {
        log.error('Update error:', err.message);
        res.status(500).json({ error: 'Помилка оновлення шаблону' });
    }
});

// POST /api/booking-templates/:id/use — increment usage counter
router.post('/:id/use', authenticateToken, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            UPDATE booking_templates SET usage_count = usage_count + 1, updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }
        res.json(mapRow(rows[0]));
    } catch (err) {
        log.error('Use error:', err.message);
        res.status(500).json({ error: 'Помилка' });
    }
});

// DELETE /api/booking-templates/:id — delete template
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM booking_templates WHERE id = $1', [req.params.id]
        );
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('Delete error:', err.message);
        res.status(500).json({ error: 'Помилка видалення шаблону' });
    }
});

module.exports = router;
