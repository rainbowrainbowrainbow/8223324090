/**
 * routes/customers.js — CRM Customer CRUD + search
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Customers');

// Autocomplete search (for booking form dropdown)
router.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json([]);

        const pattern = `%${q}%`;
        const result = await pool.query(
            `SELECT id, name, phone, instagram, child_name, total_bookings
             FROM customers
             WHERE name ILIKE $1 OR phone ILIKE $1 OR instagram ILIKE $1
             ORDER BY last_visit DESC NULLS LAST
             LIMIT 10`,
            [pattern]
        );
        res.json(result.rows.map(mapCustomerRow));
    } catch (err) {
        log.error('Customer search error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List customers (with pagination and search)
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();

        let where = '';
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            where = `WHERE name ILIKE $1 OR phone ILIKE $1 OR instagram ILIKE $1 OR child_name ILIKE $1`;
        }

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM customers ${where}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        const dataParams = [...params, limit, offset];
        const result = await pool.query(
            `SELECT * FROM customers ${where}
             ORDER BY updated_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        res.json({
            customers: result.rows.map(mapCustomerRow),
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        log.error('Customer list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get customer by ID (with booking history)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM customers WHERE id = $1', [parseInt(id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клієнта не знайдено' });
        }

        const customer = mapCustomerRow(result.rows[0]);

        // Get booking history
        const bookings = await pool.query(
            `SELECT id, date, time, program_name, program_code, label, price, status, room, duration
             FROM bookings
             WHERE customer_id = $1 AND linked_to IS NULL
             ORDER BY date DESC
             LIMIT 50`,
            [parseInt(id)]
        );

        customer.bookings = bookings.rows.map(b => ({
            id: b.id,
            date: b.date,
            time: b.time,
            programName: b.program_name,
            programCode: b.program_code,
            label: b.label,
            price: b.price,
            status: b.status,
            room: b.room,
            duration: b.duration
        }));

        res.json(customer);
    } catch (err) {
        log.error('Customer get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create customer
router.post('/', async (req, res) => {
    try {
        const { name, phone, instagram, childName, childBirthday, source, notes } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }

        const result = await pool.query(
            `INSERT INTO customers (name, phone, instagram, child_name, child_birthday, source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [name.trim(), phone || null, instagram || null, childName || null, childBirthday || null, source || null, notes || null]
        );

        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        log.error('Customer create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update customer
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, instagram, childName, childBirthday, source, notes } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }

        const result = await pool.query(
            `UPDATE customers SET
                name = $1, phone = $2, instagram = $3, child_name = $4,
                child_birthday = $5, source = $6, notes = $7, updated_at = NOW()
             WHERE id = $8
             RETURNING *`,
            [name.trim(), phone || null, instagram || null, childName || null, childBirthday || null, source || null, notes || null, parseInt(id)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клієнта не знайдено' });
        }

        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        log.error('Customer update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete customer
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Unlink bookings first
        await pool.query('UPDATE bookings SET customer_id = NULL WHERE customer_id = $1', [parseInt(id)]);

        const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [parseInt(id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клієнта не знайдено' });
        }

        res.json({ success: true });
    } catch (err) {
        log.error('Customer delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Row mapper (snake_case → camelCase)
function mapCustomerRow(row) {
    return {
        id: row.id,
        name: row.name,
        phone: row.phone || null,
        instagram: row.instagram || null,
        childName: row.child_name || null,
        childBirthday: row.child_birthday || null,
        source: row.source || null,
        notes: row.notes || null,
        totalBookings: row.total_bookings || 0,
        totalSpent: row.total_spent || 0,
        firstVisit: row.first_visit || null,
        lastVisit: row.last_visit || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

module.exports = router;
