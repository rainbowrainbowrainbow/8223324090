const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
router.use(authenticateToken);
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const log = createLogger('Search');

// GET /api/search?q=text&limit=20
router.get('/', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ results: [] });

        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const pattern = `%${q}%`;

        // Search across bookings, customers, tasks, products, staff in parallel
        const [bookings, customers, tasks, products, staff] = await Promise.all([
            // Bookings: search by ID, label, program_name, group_name, notes
            pool.query(`
                SELECT id, date, time, label, program_name, status, line_id, group_name, price
                FROM bookings
                WHERE (id ILIKE $1 OR label ILIKE $1 OR program_name ILIKE $1 OR group_name ILIKE $1 OR notes ILIKE $1)
                AND status != 'cancelled'
                ORDER BY date DESC, time ASC
                LIMIT $2
            `, [pattern, limit]),

            // Customers: search by name, phone, instagram, child_name
            pool.query(`
                SELECT id, name, phone, instagram, child_name, child_birthday, total_bookings, total_spent, last_visit
                FROM customers
                WHERE name ILIKE $1 OR phone ILIKE $1 OR instagram ILIKE $1 OR child_name ILIKE $1
                ORDER BY total_bookings DESC NULLS LAST, name ASC
                LIMIT $2
            `, [pattern, limit]),

            // Tasks: search by title, description
            pool.query(`
                SELECT id, title, date, status, priority, assigned_to, category
                FROM tasks
                WHERE (title ILIKE $1 OR description ILIKE $1)
                AND status != 'done'
                ORDER BY date DESC NULLS LAST
                LIMIT $2
            `, [pattern, limit]),

            // Products/Programs: search by name, label, code, description
            pool.query(`
                SELECT id, code, label, name, category, duration, price, is_active
                FROM products
                WHERE (name ILIKE $1 OR label ILIKE $1 OR code ILIKE $1 OR description ILIKE $1)
                AND is_active = true
                ORDER BY sort_order ASC, name ASC
                LIMIT $2
            `, [pattern, limit]),

            // v40.2: Staff search by name, phone, position
            pool.query(`
                SELECT id, name, department, position, phone, role_type
                FROM staff
                WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL)
                AND (name ILIKE $1 OR phone ILIKE $1 OR position ILIKE $1)
                ORDER BY name
                LIMIT $2
            `, [pattern, limit])
        ]);

        res.json({
            results: {
                bookings: bookings.rows.map(r => ({
                    type: 'booking',
                    id: r.id,
                    title: `${r.label || r.program_name} — ${r.id}`,
                    subtitle: `${r.date} ${r.time} | ${r.status === 'confirmed' ? 'Підтв.' : 'Попер.'} | ${r.price || 0} ₴`,
                    date: r.date,
                    status: r.status,
                    meta: { lineId: r.line_id, groupName: r.group_name }
                })),
                customers: customers.rows.map(r => ({
                    type: 'customer',
                    id: r.id,
                    title: r.name || 'Без імені',
                    subtitle: [r.phone, r.child_name ? `Дитина: ${r.child_name}` : null, r.total_bookings ? `${r.total_bookings} бронювань` : null].filter(Boolean).join(' | '),
                    meta: { phone: r.phone, instagram: r.instagram, totalSpent: r.total_spent, lastVisit: r.last_visit }
                })),
                tasks: tasks.rows.map(r => ({
                    type: 'task',
                    id: r.id,
                    title: r.title,
                    subtitle: [r.date || 'Без дати', r.assigned_to || '', r.category || ''].filter(Boolean).join(' | '),
                    status: r.status,
                    meta: { priority: r.priority, category: r.category }
                })),
                programs: products.rows.map(r => ({
                    type: 'program',
                    id: r.id,
                    title: `${r.label} — ${r.name}`,
                    subtitle: `${r.duration} хв | ${r.price} ₴ | ${r.category}`,
                    meta: { code: r.code, category: r.category }
                }))
            },
            staff: staff.rows.map(r => ({
                type: 'staff',
                id: r.id,
                title: r.name,
                subtitle: [r.position, r.department, r.phone].filter(Boolean).join(' | '),
                meta: { department: r.department, roleType: r.role_type }
            })),
            query: q,
            total: bookings.rows.length + customers.rows.length + tasks.rows.length + products.rows.length + staff.rows.length
        });
    } catch (err) {
        log.error('Search error:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
