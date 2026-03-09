/**
 * routes/leads.js — Leads (hot prospects) API
 * v20.7.0: Lead tracking, follow-up alerts
 * v20.9.13: Full CRUD with booking_id, instagram, source, lost_reason
 *
 * Endpoints:
 *   GET    /api/leads           — list leads (with filters)
 *   GET    /api/leads/hot       — leads needing attention (24h+ without response)
 *   GET    /api/leads/stats     — funnel stats
 *   POST   /api/leads           — create lead
 *   PATCH  /api/leads/:id       — update lead status/fields
 *   DELETE /api/leads/:id       — delete lead
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Leads');

// GET /api/leads — list all leads with optional filters
router.get('/', async (req, res) => {
    try {
        const { status, assigned_to, source, limit: lim, search } = req.query;
        const conditions = [];
        const params = [];

        if (status) {
            params.push(status);
            conditions.push(`l.status = $${params.length}`);
        }
        if (assigned_to) {
            const assignedId = parseInt(assigned_to);
            if (isNaN(assignedId)) {
                return res.status(400).json({ success: false, error: 'assigned_to повинен бути числом' });
            }
            params.push(assignedId);
            conditions.push(`l.assigned_to = $${params.length}`);
        }
        if (source) {
            params.push(source);
            conditions.push(`l.source = $${params.length}`);
        }
        if (search) {
            const pattern = `%${search}%`;
            params.push(pattern);
            conditions.push(`(l.client_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.instagram ILIKE $${params.length})`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const limitVal = Math.min(parseInt(lim) || 50, 200);
        params.push(limitVal);

        const result = await pool.query(`
            SELECT l.*, u.name AS assigned_name, p.label AS program_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            ${where}
            ORDER BY l.created_at DESC
            LIMIT $${params.length}
        `, params);

        res.json({ success: true, leads: result.rows });
    } catch (err) {
        log.error('GET /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження лідів' });
    }
});

// GET /api/leads/hot — leads that need attention (24h+ since creation, still 'new')
router.get('/hot', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.*, u.name AS assigned_name, p.label AS program_name,
                   EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 3600 AS hours_waiting
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            WHERE l.status = 'new'
              AND l.created_at < NOW() - INTERVAL '24 hours'
            ORDER BY l.created_at ASC
            LIMIT 50
        `);
        res.json({ success: true, leads: result.rows });
    } catch (err) {
        log.error('GET /leads/hot error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// GET /api/leads/stats — funnel statistics
router.get('/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT status, COUNT(*) AS count
            FROM leads
            GROUP BY status
        `);
        const stats = {};
        for (const r of result.rows) stats[r.status] = parseInt(r.count);
        const total = Object.values(stats).reduce((s, v) => s + v, 0);
        res.json({ success: true, stats, total });
    } catch (err) {
        log.error('GET /leads/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/leads — create new lead
router.post('/', async (req, res) => {
    try {
        const { client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to } = req.body;
        if (!client_name) {
            return res.status(400).json({ success: false, error: "Ім'я клієнта обов'язкове" });
        }
        const result = await pool.query(`
            INSERT INTO leads (client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [client_name, phone || null, telegram_id || null, instagram || null, source || null,
            program_id || null, event_date || null,
            children_count || null, child_age || null, notes || null, assigned_to || null]);

        log.info(`Lead created: ${client_name} by ${req.user.username}`);
        res.json({ success: true, lead: result.rows[0] });
    } catch (err) {
        log.error('POST /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка створення ліду' });
    }
});

// PATCH /api/leads/:id — update lead
router.patch('/:id', async (req, res) => {
    try {
        const { status, notes, assigned_to, last_contact_at, booking_id, lost_reason, client_name, phone, instagram, source, event_date, children_count, child_age, program_id } = req.body;
        const updates = [];
        const params = [];

        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
            if (status === 'booked') updates.push(`booked_at = NOW()`);
        }
        if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
        if (assigned_to !== undefined) { params.push(assigned_to); updates.push(`assigned_to = $${params.length}`); }
        if (booking_id !== undefined) { params.push(booking_id); updates.push(`booking_id = $${params.length}`); }
        if (lost_reason !== undefined) { params.push(lost_reason); updates.push(`lost_reason = $${params.length}`); }
        if (client_name !== undefined) { params.push(client_name); updates.push(`client_name = $${params.length}`); }
        if (phone !== undefined) { params.push(phone); updates.push(`phone = $${params.length}`); }
        if (instagram !== undefined) { params.push(instagram); updates.push(`instagram = $${params.length}`); }
        if (source !== undefined) { params.push(source); updates.push(`source = $${params.length}`); }
        if (event_date !== undefined) { params.push(event_date || null); updates.push(`event_date = $${params.length}`); }
        if (children_count !== undefined) { params.push(children_count); updates.push(`children_count = $${params.length}`); }
        if (child_age !== undefined) { params.push(child_age); updates.push(`child_age = $${params.length}`); }
        if (program_id !== undefined) { params.push(program_id || null); updates.push(`program_id = $${params.length}`); }
        if (last_contact_at) {
            params.push(last_contact_at);
            updates.push(`last_contact_at = $${params.length}`);
        } else if (status === 'contact') {
            updates.push(`last_contact_at = COALESCE(last_contact_at, NOW())`);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Немає полів для оновлення' });
        }

        params.push(parseInt(req.params.id));
        const result = await pool.query(
            `UPDATE leads SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        res.json({ success: true, lead: result.rows[0] });
    } catch (err) {
        log.error('PATCH /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

module.exports = router;
