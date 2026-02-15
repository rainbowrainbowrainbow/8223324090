/**
 * routes/auth.js — Login & token verification
 *
 * LLM HINT: This handles user authentication with bcrypt password verification.
 * Users are stored in the `users` table (seeded in db/index.js).
 * Test user: admin / admin123 (role: admin).
 * Seeded users: Vitalina, Dasha, Natalia (admin), Sergey (admin), Animator (viewer).
 * JWT token expires in 24h. Role is embedded in token payload.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Auth');

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Введіть ім\'я та пароль' });
        }

        const result = await pool.query(
            'SELECT id, username, password_hash, role, name FROM users WHERE username = $1',
            [username.trim()]
        );

        if (result.rows.length === 0) {
            log.warn(`Login failed: unknown user "${username}"`);
            return res.status(401).json({ error: 'Невірний логін або пароль' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            log.warn(`Login failed: wrong password for "${username}"`);
            return res.status(401).json({ error: 'Невірний логін або пароль' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        log.info(`User "${username}" logged in (role: ${user.role})`);
        res.json({ token, user: { username: user.username, role: user.role, name: user.name } });
    } catch (err) {
        log.error('Login error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify', authenticateToken, (req, res) => {
    res.json({ user: { username: req.user.username, role: req.user.role, name: req.user.name } });
});

// v10.3: Personal cabinet — consolidated profile data
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const { username } = req.user;

        // User info
        const userResult = await pool.query(
            'SELECT username, name, role, created_at FROM users WHERE username = $1',
            [username]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];

        // Points (current month)
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let points = { monthly_points: 0, permanent_points: 0 };
        try {
            const pointsResult = await pool.query(
                'SELECT monthly_points, permanent_points FROM user_points WHERE username = $1 AND month = $2',
                [username, month]
            );
            if (pointsResult.rows.length > 0) points = pointsResult.rows[0];
            // Permanent total (sum across all months)
            const permResult = await pool.query(
                'SELECT COALESCE(SUM(permanent_points), 0) as total FROM user_points WHERE username = $1',
                [username]
            );
            points.permanent_total = parseInt(permResult.rows[0].total);
        } catch { /* points tables may not exist */ }

        // Tasks stats
        let tasks = { assigned: 0, done: 0, in_progress: 0 };
        try {
            const taskResult = await pool.query(
                `SELECT status, COUNT(*)::int as count FROM tasks
                 WHERE assigned_to = $1 OR owner = $1
                 GROUP BY status`,
                [username]
            );
            taskResult.rows.forEach(r => {
                if (r.status === 'done') tasks.done = r.count;
                else if (r.status === 'in_progress') tasks.in_progress = r.count;
                else if (r.status === 'todo') tasks.assigned += r.count;
            });
            tasks.total = tasks.assigned + tasks.in_progress + tasks.done;
        } catch { /* tasks table may not exist */ }

        // Bookings created count
        let bookingsCreated = 0;
        try {
            const bkResult = await pool.query(
                "SELECT COUNT(*)::int as count FROM bookings WHERE created_by = $1 AND status != 'cancelled'",
                [username]
            );
            bookingsCreated = bkResult.rows[0].count;
        } catch { /* ignore */ }

        // Recent activity (last 10 history items)
        let recentActivity = [];
        try {
            const histResult = await pool.query(
                'SELECT action, data, created_at FROM history WHERE username = $1 ORDER BY created_at DESC LIMIT 10',
                [username]
            );
            recentActivity = histResult.rows;
        } catch { /* ignore */ }

        res.json({
            user: {
                username: user.username,
                name: user.name,
                role: user.role,
                createdAt: user.created_at
            },
            points: {
                monthly: points.monthly_points,
                permanentThisMonth: points.permanent_points,
                permanentTotal: points.permanent_total || 0,
                month
            },
            tasks,
            bookingsCreated,
            recentActivity
        });
    } catch (err) {
        log.error('Profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
