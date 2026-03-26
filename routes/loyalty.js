/**
 * routes/loyalty.js — Loyalty tiers, discount codes, and proposals
 *
 * LLM HINT: Manages loyalty program tiers (auto-assigned by bookings/spent),
 * discount codes (with validation for bookings), and discount proposals.
 * Tables: loyalty_tiers, customers, discount_codes, discount_usage, discount_proposals.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('Loyalty');

// All loyalty routes require authentication
router.use(authenticateToken);

// ─── LOYALTY TIERS ───────────────────────────────────────────────────────────

// GET /api/loyalty/tiers — Get all loyalty tiers, ordered by sort_order
router.get('/tiers', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM loyalty_tiers ORDER BY sort_order ASC'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get tiers error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/loyalty/tiers/:id — Update a tier
router.put('/tiers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, min_bookings, min_spent, discount_percent, color } = req.body;

        const existing = await pool.query('SELECT id FROM loyalty_tiers WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Рівень лояльності не знайдено' });
        }

        const result = await pool.query(
            `UPDATE loyalty_tiers SET
                name = COALESCE($1, name),
                min_bookings = COALESCE($2, min_bookings),
                min_spent = COALESCE($3, min_spent),
                discount_percent = COALESCE($4, discount_percent),
                color = COALESCE($5, color)
             WHERE id = $6 RETURNING *`,
            [name, min_bookings, min_spent, discount_percent, color, id]
        );

        log.info(`Tier updated: ${id}`);
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Update tier error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/loyalty/tiers — Create a new tier
router.post('/tiers', async (req, res) => {
    try {
        const { name, min_bookings, min_spent, discount_percent, color, sort_order } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Назва рівня обов\'язкова' });
        }

        const result = await pool.query(
            `INSERT INTO loyalty_tiers (name, min_bookings, min_spent, discount_percent, color, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, min_bookings || 0, min_spent || 0, discount_percent || 0, color || '#888888', sort_order || 0]
        );

        log.info(`Tier created: ${result.rows[0].id} — ${name}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        log.error('Create tier error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/loyalty/tiers/:id — Delete a tier (only if no customers use it)
router.delete('/tiers/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if any customers reference this tier
        const usage = await pool.query(
            'SELECT COUNT(*)::int AS count FROM customers WHERE loyalty_tier_id = $1',
            [id]
        );
        if (usage.rows[0].count > 0) {
            return res.status(409).json({
                error: `Неможливо видалити: ${usage.rows[0].count} клієнтів мають цей рівень`
            });
        }

        const result = await pool.query(
            'DELETE FROM loyalty_tiers WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Рівень лояльності не знайдено' });
        }

        log.info(`Tier deleted: ${id}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete tier error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── CUSTOMERS WITH LOYALTY ─────────────────────────────────────────────────

// GET /api/loyalty/customers — Get customers with loyalty info, paginated + segment filter
router.get('/customers', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);
        const offset = (page - 1) * limit;
        const segment = req.query.segment; // new | loyal | vip | premium

        const conditions = [];
        const params = [];
        let idx = 1;

        if (segment) {
            conditions.push(`lt.name = $${idx++}`);
            params.push(segment);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM customers c
             LEFT JOIN loyalty_tiers lt ON c.loyalty_tier_id = lt.id
             ${where}`,
            params
        );
        const total = countResult.rows[0].total;

        const result = await pool.query(
            `SELECT c.*, lt.name AS tier_name, lt.discount_percent, lt.color AS tier_color
             FROM customers c
             LEFT JOIN loyalty_tiers lt ON c.loyalty_tier_id = lt.id
             ${where}
             ORDER BY c.total_spent DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, limit, offset]
        );

        res.json({
            items: result.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        log.error('Get loyalty customers error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── RECALCULATE ─────────────────────────────────────────────────────────────

// POST /api/loyalty/recalculate — Recalculate all customers' loyalty tiers
router.post('/recalculate', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get all tiers ordered by requirements descending (highest first)
        const tiersResult = await client.query(
            'SELECT * FROM loyalty_tiers ORDER BY min_bookings DESC, min_spent DESC'
        );
        const tiers = tiersResult.rows;

        // Get all customers
        const customersResult = await client.query(
            'SELECT id, total_bookings, total_spent FROM customers'
        );

        let updated = 0;
        for (const customer of customersResult.rows) {
            // Find the highest tier the customer qualifies for
            let matchedTierId = null;
            for (const tier of tiers) {
                if (customer.total_bookings >= tier.min_bookings && customer.total_spent >= tier.min_spent) {
                    matchedTierId = tier.id;
                    break; // First match is the highest tier (sorted desc)
                }
            }

            await client.query(
                'UPDATE customers SET loyalty_tier_id = $1, updated_at = NOW() WHERE id = $2',
                [matchedTierId, customer.id]
            );
            updated++;
        }

        await client.query('COMMIT');
        log.info(`Loyalty recalculated: ${updated} customers processed`);
        res.json({ success: true, updated });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Recalculate loyalty error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ─── DISCOUNT CODES ──────────────────────────────────────────────────────────

// GET /api/loyalty/discounts — Get all discount codes with usage stats
router.get('/discounts', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*,
                COALESCE(u.usage_count, 0)::int AS usage_count,
                COALESCE(u.total_discount_given, 0)::numeric AS total_discount_given
             FROM discount_codes d
             LEFT JOIN (
                SELECT discount_code_id,
                       COUNT(*)::int AS usage_count,
                       SUM(discount_amount) AS total_discount_given
                FROM discount_usage
                GROUP BY discount_code_id
             ) u ON d.id = u.discount_code_id
             ORDER BY d.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get discounts error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/loyalty/discounts — Create a new discount code
router.post('/discounts', async (req, res) => {
    try {
        const { code, name, type, value, min_order, max_uses, valid_from, valid_until, category } = req.body;

        if (!code || !name || !type || value === undefined) {
            return res.status(400).json({ error: 'Поля code, name, type, value обов\'язкові' });
        }

        if (!['percent', 'fixed'].includes(type)) {
            return res.status(400).json({ error: 'Тип знижки має бути percent або fixed' });
        }

        if (type === 'percent' && (value < 0 || value > 100)) {
            return res.status(400).json({ error: 'Відсоток знижки має бути від 0 до 100' });
        }

        // Check code uniqueness
        const existing = await pool.query(
            'SELECT id FROM discount_codes WHERE UPPER(code) = UPPER($1)',
            [code]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Промокод з таким кодом вже існує' });
        }

        const result = await pool.query(
            `INSERT INTO discount_codes (code, name, type, value, min_order, max_uses, valid_from, valid_until, category)
             VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [code, name, type, value, min_order || 0, max_uses || null, valid_from || null, valid_until || null, category || null]
        );

        log.info(`Discount code created: ${code.toUpperCase()}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        log.error('Create discount error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/loyalty/discounts/:id — Update a discount code
router.put('/discounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { code, name, type, value, min_order, max_uses, valid_from, valid_until, category, is_active } = req.body;

        const existing = await pool.query('SELECT id FROM discount_codes WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Промокод не знайдено' });
        }

        if (type && !['percent', 'fixed'].includes(type)) {
            return res.status(400).json({ error: 'Тип знижки має бути percent або fixed' });
        }

        if (type === 'percent' && value !== undefined && (value < 0 || value > 100)) {
            return res.status(400).json({ error: 'Відсоток знижки має бути від 0 до 100' });
        }

        const result = await pool.query(
            `UPDATE discount_codes SET
                code = COALESCE(UPPER($1), code),
                name = COALESCE($2, name),
                type = COALESCE($3, type),
                value = COALESCE($4, value),
                min_order = COALESCE($5, min_order),
                max_uses = $6,
                valid_from = $7,
                valid_until = $8,
                category = $9,
                is_active = COALESCE($10, is_active),
                updated_at = NOW()
             WHERE id = $11 RETURNING *`,
            [code, name, type, value, min_order, max_uses, valid_from, valid_until, category, is_active, id]
        );

        log.info(`Discount code updated: ${id}`);
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Update discount error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/loyalty/discounts/:id — Soft delete (set is_active=false)
router.delete('/discounts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `UPDATE discount_codes SET is_active = false, updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Промокод не знайдено' });
        }

        log.info(`Discount code deactivated: ${id}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete discount error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/loyalty/discounts/validate — Validate a discount code for a booking
router.post('/discounts/validate', async (req, res) => {
    try {
        const { code, price, category } = req.body;

        if (!code || price === undefined) {
            return res.status(400).json({ valid: false, message: 'Поля code та price обов\'язкові' });
        }

        // Find the discount code
        const codeResult = await pool.query(
            'SELECT * FROM discount_codes WHERE UPPER(code) = UPPER($1)',
            [code]
        );

        if (codeResult.rows.length === 0) {
            return res.json({ valid: false, discount_amount: 0, final_price: price, message: 'Промокод не знайдено' });
        }

        const discount = codeResult.rows[0];

        // Check if active
        if (!discount.is_active) {
            return res.json({ valid: false, discount_amount: 0, final_price: price, message: 'Промокод неактивний' });
        }

        // Check valid_from
        if (discount.valid_from && new Date() < new Date(discount.valid_from)) {
            return res.json({ valid: false, discount_amount: 0, final_price: price, message: 'Промокод ще не діє' });
        }

        // Check valid_until (expired)
        if (discount.valid_until && new Date() > new Date(discount.valid_until)) {
            return res.json({ valid: false, discount_amount: 0, final_price: price, message: 'Термін дії промокоду закінчився' });
        }

        // Check usage limit
        if (discount.max_uses) {
            const usageResult = await pool.query(
                'SELECT COUNT(*)::int AS count FROM discount_usage WHERE discount_code_id = $1',
                [discount.id]
            );
            if (usageResult.rows[0].count >= discount.max_uses) {
                return res.json({ valid: false, discount_amount: 0, final_price: price, message: 'Ліміт використань промокоду вичерпано' });
            }
        }

        // Check min order
        if (discount.min_order && price < discount.min_order) {
            return res.json({
                valid: false, discount_amount: 0, final_price: price,
                message: `Мінімальна сума замовлення: ${discount.min_order} ₴`
            });
        }

        // Check category match
        if (discount.category && category && discount.category !== category) {
            return res.json({
                valid: false, discount_amount: 0, final_price: price,
                message: `Промокод діє тільки для категорії: ${discount.category}`
            });
        }

        // Calculate discount
        let discount_amount = 0;
        if (discount.type === 'percent') {
            discount_amount = Math.round(price * discount.value / 100);
        } else {
            discount_amount = Math.min(discount.value, price);
        }

        const final_price = Math.max(0, price - discount_amount);

        res.json({
            valid: true,
            discount_amount,
            final_price,
            message: `Знижка ${discount.type === 'percent' ? discount.value + '%' : discount.value + ' ₴'} застосована`
        });
    } catch (err) {
        log.error('Validate discount error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DISCOUNT PROPOSALS ──────────────────────────────────────────────────────

// GET /api/loyalty/proposals — Get all discount proposals with linked discount code info
router.get('/proposals', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dp.*, dc.code AS discount_code, dc.type AS discount_type,
                    dc.value AS discount_value, dc.name AS discount_name
             FROM discount_proposals dp
             LEFT JOIN discount_codes dc ON dp.discount_code_id = dc.id
             ORDER BY dp.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get proposals error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/loyalty/proposals — Create a new proposal
router.post('/proposals', async (req, res) => {
    try {
        const { title, description, discount_code_id, target_segment, start_date, end_date, banner_color } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Назва пропозиції обов\'язкова' });
        }

        const result = await pool.query(
            `INSERT INTO discount_proposals (title, description, discount_code_id, target_segment, start_date, end_date, banner_color)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title, description || null, discount_code_id || null, target_segment || 'all', start_date || null, end_date || null, banner_color || '#10B981']
        );

        log.info(`Proposal created: ${result.rows[0].id} — ${title}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        log.error('Create proposal error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/loyalty/proposals/:id — Update a proposal
router.put('/proposals/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, discount_code_id, target_segment, start_date, end_date, is_active, banner_color } = req.body;

        const existing = await pool.query('SELECT id FROM discount_proposals WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Пропозицію не знайдено' });
        }

        const result = await pool.query(
            `UPDATE discount_proposals SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                discount_code_id = $3,
                target_segment = COALESCE($4, target_segment),
                start_date = $5,
                end_date = $6,
                is_active = COALESCE($7, is_active),
                banner_color = COALESCE($8, banner_color)
             WHERE id = $9 RETURNING *`,
            [title, description, discount_code_id, target_segment, start_date, end_date, is_active, banner_color, id]
        );

        log.info(`Proposal updated: ${id}`);
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Update proposal error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/loyalty/proposals/:id — Delete a proposal
router.delete('/proposals/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM discount_proposals WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пропозицію не знайдено' });
        }

        log.info(`Proposal deleted: ${id}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete proposal error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
