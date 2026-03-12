/**
 * routes/employees.js — Employee Mapping API (v19.0)
 * Unified identity: user ↔ staff ↔ telegram ↔ role ↔ access
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const { requireRole } = require('../middleware/auth');
const log = createLogger('Employees');

// RBAC: Employee management — management + HR only
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'hr'));

// GET /api/employees — list all employee profiles
router.get('/', async (req, res) => {
    try {
        const { department, active } = req.query;
        let query = `SELECT ep.*,
            u.username, u.role as user_role,
            s.position, s.hire_date, s.color as staff_color
         FROM employee_profiles ep
         LEFT JOIN users u ON ep.user_id = u.id
         LEFT JOIN staff s ON ep.staff_id = s.id`;
        const conditions = [];
        const params = [];
        if (department) { params.push(department); conditions.push(`ep.department = $${params.length}`); }
        if (active !== undefined) { params.push(active === 'true'); conditions.push(`ep.is_active = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY ep.full_name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List employees error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees — create profile (link user + staff + telegram)
router.post('/', async (req, res) => {
    try {
        const { user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions } = req.body;
        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ error: 'Повне ім\'я обов\'язкове' });
        }

        const result = await pool.query(
            `INSERT INTO employee_profiles (user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [user_id || null, staff_id || null, telegram_chat_id || null,
             telegram_username || null, full_name.trim(), email || null, phone || null,
             role || 'employee', department || null,
             JSON.stringify(access_modules || []), JSON.stringify(permissions || {})]
        );

        log.info(`Employee profile created: ${full_name} (id: ${result.rows[0].id})`);
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        log.error('Create employee error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/employees/:id — update profile
router.put('/:id', async (req, res) => {
    try {
        const { user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions, is_active } = req.body;

        const result = await pool.query(
            `UPDATE employee_profiles SET
                user_id=$1, staff_id=$2, telegram_chat_id=$3, telegram_username=$4,
                full_name=$5, email=$6, phone=$7, role=$8, department=$9,
                access_modules=$10, permissions=$11, is_active=$12
             WHERE id=$13 RETURNING *`,
            [user_id || null, staff_id || null, telegram_chat_id || null,
             telegram_username || null, full_name, email || null, phone || null,
             role || 'employee', department || null,
             JSON.stringify(access_modules || []), JSON.stringify(permissions || {}),
             is_active !== false, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Профіль не знайдено' });
        }
        log.info(`Employee profile updated: ${full_name} (id: ${req.params.id})`);
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        log.error('Update employee error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/employees/overview — mapping stats (MUST be before /:id)
router.get('/overview', async (req, res) => {
    try {
        const [profiles, unlinked] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_active) as active,
                COUNT(*) FILTER (WHERE user_id IS NOT NULL) as linked_users,
                COUNT(*) FILTER (WHERE staff_id IS NOT NULL) as linked_staff,
                COUNT(*) FILTER (WHERE telegram_chat_id IS NOT NULL) as linked_telegram
             FROM employee_profiles`),
            pool.query(`SELECT
                (SELECT COUNT(*) FROM users u WHERE u.id NOT IN (SELECT user_id FROM employee_profiles WHERE user_id IS NOT NULL)) as unlinked_users,
                (SELECT COUNT(*) FROM staff s WHERE s.is_active AND s.id NOT IN (SELECT staff_id FROM employee_profiles WHERE staff_id IS NOT NULL)) as unlinked_staff`)
        ]);
        res.json({ profiles: profiles.rows[0], unlinked: unlinked.rows[0] });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/employees/:id — single profile
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ep.*,
                u.username, u.role as user_role,
                s.position, s.hire_date, s.color as staff_color, s.department as staff_department
             FROM employee_profiles ep
             LEFT JOIN users u ON ep.user_id = u.id
             LEFT JOIN staff s ON ep.staff_id = s.id
             WHERE ep.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Профіль не знайдено' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Get employee error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees/auto-link — auto-create profiles from existing users/staff
router.post('/auto-link', async (req, res) => {
    try {
        // Find staff without profiles
        const unlinkedStaff = await pool.query(
            `SELECT s.* FROM staff s
             LEFT JOIN employee_profiles ep ON ep.staff_id = s.id
             WHERE ep.id IS NULL AND s.is_active = true`
        );

        let created = 0;
        for (const staff of unlinkedStaff.rows) {
            // Try to find matching user by name
            const matchingUser = await pool.query(
                `SELECT id FROM users WHERE name ILIKE $1 AND id NOT IN (SELECT user_id FROM employee_profiles WHERE user_id IS NOT NULL)`,
                [staff.name]
            );

            await pool.query(
                `INSERT INTO employee_profiles (staff_id, user_id, full_name, phone, department, telegram_username, role)
                 VALUES ($1, $2, $3, $4, $5, $6, 'employee')
                 ON CONFLICT DO NOTHING`,
                [staff.id, matchingUser.rows[0]?.id || null, staff.name, staff.phone || null,
                 staff.department || null, staff.telegram_username || null]
            );
            created++;
        }

        log.info(`Auto-link: ${created} profiles created from ${unlinkedStaff.rows.length} unlinked staff`);
        res.json({ success: true, created, total_unlinked: unlinkedStaff.rows.length });
    } catch (err) {
        log.error('Auto-link error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
