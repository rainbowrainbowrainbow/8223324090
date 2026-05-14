const express = require('express');
const router = express.Router();
const { authenticateToken, PAGE_ACCESS } = require('../middleware/auth');
router.use(authenticateToken);
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { buildTaskVisibilityScope } = require('../services/taskPolicy');
const log = createLogger('Search');

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function canAccessPage(user, path) {
    const access = PAGE_ACCESS[path];
    return Array.isArray(access) && access.includes(user?.role);
}

// GET /api/search?q=text&limit=20
router.get('/', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ results: [] });

        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
        const pattern = `%${q}%`;

        const bookingParams = [pattern];
        const bookingScope = getVisibleBookingScope(req.user, bookingParams, 'b');
        const bookingLimitRef = pushParam(bookingParams, limit);

        const taskParams = [pattern];
        const taskScope = buildTaskVisibilityScope(req.user, taskParams, 't');
        const taskLimitRef = pushParam(taskParams, limit);

        const canSearchCustomers = canAccessPage(req.user, '/customers');
        const canSearchPrograms = canAccessPage(req.user, '/programs');
        const canSearchStaff = canAccessPage(req.user, '/staff');

        // Search across visible bookings/tasks and page-authorized CRM surfaces.
        const [bookings, customers, tasks, products, staff] = await Promise.all([
            pool.query(`
                SELECT b.id, b.date, b.time, b.label, b.program_name, b.status, b.line_id, b.group_name, b.price
                FROM bookings b
                WHERE (b.id ILIKE $1 OR b.label ILIKE $1 OR b.program_name ILIKE $1 OR b.group_name ILIKE $1 OR b.notes ILIKE $1)
                  AND b.status != 'cancelled'
                  ${bookingScope.sql}
                ORDER BY b.date DESC, b.time ASC
                LIMIT ${bookingLimitRef}
            `, bookingParams),

            canSearchCustomers ? pool.query(`
                SELECT c.id, c.name, c.phone, c.instagram, c.child_name, c.child_birthday,
                       c.total_bookings, c.total_spent, c.last_visit
                FROM customers c
                WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.instagram ILIKE $1 OR c.child_name ILIKE $1
                ORDER BY c.total_bookings DESC NULLS LAST, c.name ASC
                LIMIT $2
            `, [pattern, limit]) : Promise.resolve({ rows: [] }),

            pool.query(`
                SELECT t.id, t.title, t.date, t.status, t.priority, t.assigned_to, t.category
                FROM tasks t
                WHERE (t.title ILIKE $1 OR t.description ILIKE $1)
                  AND t.status != 'done'
                  ${taskScope}
                ORDER BY t.date DESC NULLS LAST
                LIMIT ${taskLimitRef}
            `, taskParams),

            canSearchPrograms ? pool.query(`
                SELECT id, code, label, name, category, duration, price, is_active
                FROM products
                WHERE (name ILIKE $1 OR label ILIKE $1 OR code ILIKE $1 OR description ILIKE $1)
                  AND is_active = true
                ORDER BY sort_order ASC, name ASC
                LIMIT $2
            `, [pattern, limit]) : Promise.resolve({ rows: [] }),

            canSearchStaff ? pool.query(`
                SELECT id, name, department, position, phone, role_type
                FROM staff
                WHERE is_active = true
                  AND (is_freelance = false OR is_freelance IS NULL)
                  AND (name ILIKE $1 OR phone ILIKE $1 OR position ILIKE $1)
                ORDER BY name
                LIMIT $2
            `, [pattern, limit]) : Promise.resolve({ rows: [] })
        ]);

        res.json({
            results: {
                bookings: bookings.rows.map(r => ({
                    type: 'booking',
                    id: r.id,
                    title: `${r.label || r.program_name} - ${r.id}`,
                    subtitle: `${r.date} ${r.time} | ${r.status === 'confirmed' ? 'Підтв.' : 'Попер.'} | ${r.price || 0} грн`,
                    date: r.date,
                    status: r.status,
                    href: `/?date=${encodeURIComponent(String(r.date || '').slice(0, 10))}&highlight=${encodeURIComponent(r.id)}`,
                    meta: {
                        lineId: r.line_id,
                        groupName: r.group_name,
                        visibilityScope: bookingScope.scopeSource
                    }
                })),
                customers: customers.rows.map(r => ({
                    type: 'customer',
                    id: r.id,
                    title: r.name || 'Без імені',
                    subtitle: [
                        r.phone,
                        r.child_name ? `Дитина: ${r.child_name}` : null,
                        r.total_bookings ? `${r.total_bookings} бронювань` : null
                    ].filter(Boolean).join(' | '),
                    href: `/customers?open=${encodeURIComponent(r.id)}`,
                    meta: { phone: r.phone, instagram: r.instagram, totalSpent: r.total_spent, lastVisit: r.last_visit }
                })),
                tasks: tasks.rows.map(r => ({
                    type: 'task',
                    id: r.id,
                    title: r.title,
                    subtitle: [r.date || 'Без дати', r.assigned_to || '', r.category || ''].filter(Boolean).join(' | '),
                    status: r.status,
                    href: `/tasks?open=${encodeURIComponent(r.id)}`,
                    meta: { priority: r.priority, category: r.category }
                })),
                programs: products.rows.map(r => ({
                    type: 'program',
                    id: r.id,
                    title: `${r.label} - ${r.name}`,
                    subtitle: `${r.duration} хв | ${r.price} грн | ${r.category}`,
                    href: `/programs?highlight=${encodeURIComponent(r.code || r.id)}`,
                    meta: { code: r.code, category: r.category }
                })),
                staff: staff.rows.map(r => ({
                    type: 'staff',
                    id: r.id,
                    title: r.name,
                    subtitle: [r.position, r.department, r.phone].filter(Boolean).join(' | '),
                    href: `/staff?highlight=${encodeURIComponent(r.id)}`,
                    meta: { department: r.department, roleType: r.role_type }
                }))
            },
            query: q,
            meta: {
                bookingVisibility: {
                    visibleScopeOnly: true,
                    scopeSource: bookingScope.scopeSource,
                    classification: bookingScope.classification
                },
                linkedRouteParity: 'exact-visible-result-or-no-result'
            },
            total: bookings.rows.length + customers.rows.length + tasks.rows.length + products.rows.length + staff.rows.length
        });
    } catch (err) {
        log.error('Search error:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
