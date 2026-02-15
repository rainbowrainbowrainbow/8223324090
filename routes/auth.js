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

// v10.4: Personal cabinet — comprehensive profile data
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const { username } = req.user;

        // User info (including telegram status)
        const userResult = await pool.query(
            'SELECT username, name, role, created_at, telegram_chat_id FROM users WHERE username = $1',
            [username]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];
        const isAdminRole = user.role === 'admin';

        // Run independent queries in parallel for performance
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const results = await Promise.allSettled([
            // 0: Points (current month)
            pool.query(
                'SELECT monthly_points, permanent_points FROM user_points WHERE username = $1 AND month = $2',
                [username, month]
            ),
            // 1: Permanent total
            pool.query(
                'SELECT COALESCE(SUM(permanent_points), 0) as total FROM user_points WHERE username = $1',
                [username]
            ),
            // 2: Tasks stats by status
            pool.query(
                `SELECT status, COUNT(*)::int as count FROM tasks
                 WHERE assigned_to = $1 OR owner = $1
                 GROUP BY status`,
                [username]
            ),
            // 3: Overdue tasks
            pool.query(
                `SELECT COUNT(*)::int as count FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1)
                 AND status != 'done' AND deadline IS NOT NULL AND deadline < NOW()`,
                [username]
            ),
            // 4: Upcoming deadline tasks (within 24h)
            pool.query(
                `SELECT id, title, deadline, priority, category, status FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1)
                 AND status != 'done' AND deadline IS NOT NULL
                 AND deadline > NOW() AND deadline < NOW() + INTERVAL '24 hours'
                 ORDER BY deadline ASC LIMIT 5`,
                [username]
            ),
            // 5: Tasks by category
            pool.query(
                `SELECT COALESCE(category, 'other') as category, COUNT(*)::int as count FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1) AND status != 'done'
                 GROUP BY category ORDER BY count DESC`,
                [username]
            ),
            // 6: Avg completion time (hours)
            pool.query(
                `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)::numeric, 1) as avg_hours
                 FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1) AND status = 'done' AND completed_at IS NOT NULL`,
                [username]
            ),
            // 7: Escalation count
            pool.query(
                `SELECT COUNT(*)::int as count FROM task_logs
                 WHERE action = 'escalated' AND actor = 'system'
                 AND task_id IN (SELECT id FROM tasks WHERE assigned_to = $1)`,
                [username]
            ),
            // 8: Bookings created + by status
            pool.query(
                `SELECT status, COUNT(*)::int as count, COALESCE(SUM(price), 0)::int as revenue FROM bookings
                 WHERE created_by = $1 GROUP BY status`,
                [username]
            ),
            // 9: Top 3 programs
            pool.query(
                `SELECT program_name, COUNT(*)::int as count FROM bookings
                 WHERE created_by = $1 AND status != 'cancelled'
                 GROUP BY program_name ORDER BY count DESC LIMIT 3`,
                [username]
            ),
            // 10: Certificates issued
            pool.query(
                `SELECT status, COUNT(*)::int as count FROM certificates
                 WHERE issued_by_name = $1 GROUP BY status`,
                [username]
            ),
            // 11: Recent activity (last 20)
            pool.query(
                'SELECT action, data, created_at FROM history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
                [username]
            ),
            // 12: Recent point transactions (last 5)
            pool.query(
                `SELECT points, type, reason, created_at FROM point_transactions
                 WHERE username = $1 ORDER BY created_at DESC LIMIT 5`,
                [username]
            ),
            // 13: Leaderboard rank
            pool.query(
                `SELECT username, COALESCE(SUM(permanent_points), 0)::int as total
                 FROM user_points GROUP BY username ORDER BY total DESC`
            ),
            // 14: My tasks list (active, last 10)
            pool.query(
                `SELECT id, title, status, priority, deadline, category FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1) AND status != 'done'
                 ORDER BY CASE WHEN deadline IS NOT NULL AND deadline < NOW() THEN 0 ELSE 1 END,
                 CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 deadline ASC NULLS LAST
                 LIMIT 10`,
                [username]
            )
        ]);

        // Helper: safely get result
        const get = (idx) => results[idx].status === 'fulfilled' ? results[idx].value : null;

        // Points
        let points = { monthly_points: 0, permanent_points: 0, permanent_total: 0 };
        const pointsR = get(0);
        if (pointsR && pointsR.rows.length > 0) {
            points.monthly_points = pointsR.rows[0].monthly_points;
            points.permanent_points = pointsR.rows[0].permanent_points;
        }
        const permR = get(1);
        if (permR && permR.rows.length > 0) {
            points.permanent_total = parseInt(permR.rows[0].total);
        }

        // Tasks stats
        let tasks = { assigned: 0, done: 0, in_progress: 0, total: 0 };
        const taskR = get(2);
        if (taskR) {
            taskR.rows.forEach(r => {
                if (r.status === 'done') tasks.done = r.count;
                else if (r.status === 'in_progress') tasks.in_progress = r.count;
                else if (r.status === 'todo') tasks.assigned += r.count;
            });
            tasks.total = tasks.assigned + tasks.in_progress + tasks.done;
        }

        // Overdue
        const overdueR = get(3);
        tasks.overdue = overdueR ? overdueR.rows[0].count : 0;

        // Upcoming deadlines
        const upcomingR = get(4);
        tasks.upcoming = upcomingR ? upcomingR.rows.map(r => ({
            id: r.id, title: r.title, deadline: r.deadline, priority: r.priority, category: r.category, status: r.status
        })) : [];

        // Tasks by category
        const catR = get(5);
        tasks.byCategory = catR ? catR.rows : [];

        // Avg completion time
        const avgR = get(6);
        tasks.avgCompletionHours = avgR && avgR.rows[0].avg_hours ? parseFloat(avgR.rows[0].avg_hours) : null;

        // Escalation count
        const escR = get(7);
        tasks.escalations = escR ? escR.rows[0].count : 0;

        // Bookings
        let bookings = { total: 0, byStatus: {}, revenue: 0, topPrograms: [] };
        const bkR = get(8);
        if (bkR) {
            bkR.rows.forEach(r => {
                bookings.byStatus[r.status] = r.count;
                if (r.status !== 'cancelled') {
                    bookings.total += r.count;
                    bookings.revenue += r.revenue;
                }
            });
        }
        const topR = get(9);
        bookings.topPrograms = topR ? topR.rows : [];

        // Certificates
        let certificates = { total: 0, byStatus: {} };
        const certR = get(10);
        if (certR) {
            certR.rows.forEach(r => {
                certificates.byStatus[r.status] = r.count;
                certificates.total += r.count;
            });
        }

        // Recent activity
        const histR = get(11);
        const recentActivity = histR ? histR.rows : [];

        // Point transactions
        const ptR = get(12);
        const pointTransactions = ptR ? ptR.rows : [];

        // Leaderboard rank
        let leaderboardRank = null;
        let leaderboardTotal = 0;
        const lbR = get(13);
        if (lbR) {
            leaderboardTotal = lbR.rows.length;
            const idx = lbR.rows.findIndex(r => r.username === username);
            leaderboardRank = idx >= 0 ? idx + 1 : null;
        }

        // My active tasks
        const myTasksR = get(14);
        const myTasks = myTasksR ? myTasksR.rows.map(t => ({
            id: t.id, title: t.title, status: t.status, priority: t.priority,
            deadline: t.deadline, category: t.category,
            isOverdue: t.deadline && new Date(t.deadline) < now
        })) : [];

        res.json({
            user: {
                username: user.username,
                name: user.name,
                role: user.role,
                createdAt: user.created_at,
                telegramConnected: !!user.telegram_chat_id
            },
            points: {
                monthly: points.monthly_points,
                permanentThisMonth: points.permanent_points,
                permanentTotal: points.permanent_total || 0,
                month
            },
            pointTransactions,
            leaderboard: { rank: leaderboardRank, total: leaderboardTotal },
            tasks,
            myTasks,
            bookings,
            certificates,
            recentActivity,
            // Revenue only for admin
            showRevenue: isAdminRole
        });
    } catch (err) {
        log.error('Profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.4: Change password
router.put('/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Введіть поточний і новий паролі' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Новий пароль має бути не менше 6 символів' });
        }

        const result = await pool.query(
            'SELECT password_hash FROM users WHERE username = $1',
            [req.user.username]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Невірний поточний пароль' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, req.user.username]);

        log.info(`User "${req.user.username}" changed password`);
        res.json({ success: true });
    } catch (err) {
        log.error('Password change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
