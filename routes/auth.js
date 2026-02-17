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
            'SELECT id, username, password_hash, role, name FROM users WHERE LOWER(username) = LOWER($1)',
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

// v10.6: Personal cabinet — comprehensive profile data with shift, achievements, team, deltas
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const { username } = req.user;

        // User info (including telegram status)
        const userResult = await pool.query(
            'SELECT id, username, name, role, created_at, telegram_chat_id FROM users WHERE username = $1',
            [username]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];
        const isAdminRole = user.role === 'admin';

        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        // Previous week range for delta comparison
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

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
            // 3: Overdue tasks WITH DETAILS (not just count)
            pool.query(
                `SELECT id, title, deadline, priority, category FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1)
                 AND status != 'done' AND deadline IS NOT NULL AND deadline < NOW()
                 ORDER BY deadline ASC LIMIT 10`,
                [username]
            ),
            // 4: Upcoming deadline tasks (within 48h — extended from 24h)
            pool.query(
                `SELECT id, title, deadline, priority, category, status FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1)
                 AND status != 'done' AND deadline IS NOT NULL
                 AND deadline > NOW() AND deadline < NOW() + INTERVAL '48 hours'
                 ORDER BY deadline ASC LIMIT 10`,
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
            // 7: Escalation history (not just count — last 5)
            pool.query(
                `SELECT tl.task_id, tl.old_value, tl.new_value, tl.created_at, t.title
                 FROM task_logs tl JOIN tasks t ON tl.task_id = t.id
                 WHERE tl.action = 'escalated' AND t.assigned_to = $1
                 ORDER BY tl.created_at DESC LIMIT 5`,
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
            // 10: Certificates issued WITH details
            pool.query(
                `SELECT id, cert_code, display_value, status, valid_until, used_at FROM certificates
                 WHERE issued_by_name = $1
                 ORDER BY created_at DESC LIMIT 10`,
                [username]
            ),
            // 11: Recent activity (last 20)
            pool.query(
                'SELECT action, data, created_at FROM history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
                [username]
            ),
            // 12: Recent point transactions (last 5) WITH task link
            pool.query(
                `SELECT pt.points, pt.type, pt.reason, pt.task_id, pt.created_at, t.title as task_title
                 FROM point_transactions pt LEFT JOIN tasks t ON pt.task_id = t.id
                 WHERE pt.username = $1 ORDER BY pt.created_at DESC LIMIT 5`,
                [username]
            ),
            // 13: Leaderboard rank
            pool.query(
                `SELECT username, COALESCE(SUM(permanent_points), 0)::int as total
                 FROM user_points GROUP BY username ORDER BY total DESC`
            ),
            // 14: My tasks list (active, last 15)
            pool.query(
                `SELECT id, title, status, priority, deadline, category, dependency_ids FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1) AND status != 'done'
                 ORDER BY CASE WHEN deadline IS NOT NULL AND deadline < NOW() THEN 0 ELSE 1 END,
                 CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 deadline ASC NULLS LAST
                 LIMIT 15`,
                [username]
            ),
            // 15: Today's shift (match user to staff by name)
            pool.query(
                `SELECT ss.shift_start, ss.shift_end, ss.status, ss.note, s.name, s.department, s.position
                 FROM staff_schedule ss JOIN staff s ON ss.staff_id = s.id
                 WHERE s.name = $1 AND ss.date = $2`,
                [user.name, today]
            ),
            // 16: Achievements
            pool.query(
                'SELECT achievement_key, unlocked_at FROM user_achievements WHERE username = $1 ORDER BY unlocked_at DESC',
                [username]
            ),
            // 17: Streak
            pool.query(
                'SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE username = $1',
                [username]
            ),
            // 18: Delta — tasks done this week vs last week
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE completed_at >= $2) ::int as this_week,
                    COUNT(*) FILTER (WHERE completed_at >= $3 AND completed_at < $2) ::int as last_week
                 FROM tasks WHERE (assigned_to = $1 OR owner = $1) AND status = 'done' AND completed_at IS NOT NULL`,
                [username, weekAgo.toISOString(), twoWeeksAgo.toISOString()]
            ),
            // 19: Delta — bookings this week vs last week
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE created_at >= $2) ::int as this_week,
                    COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $2) ::int as last_week
                 FROM bookings WHERE created_by = $1`,
                [username, weekAgo.toISOString(), twoWeeksAgo.toISOString()]
            ),
            // 20: Team overview (admin only) — who's working today, their task counts
            isAdminRole ? pool.query(
                `SELECT u.username, u.name, u.role,
                    (SELECT COUNT(*)::int FROM tasks WHERE assigned_to = u.username AND status != 'done') as open_tasks,
                    (SELECT COUNT(*)::int FROM tasks WHERE assigned_to = u.username AND status != 'done' AND deadline IS NOT NULL AND deadline < NOW()) as overdue_tasks
                 FROM users u WHERE u.role != 'viewer'
                 ORDER BY u.name`
            ) : Promise.resolve({ rows: [] }),
            // 21: Today's bookings count (for day progress)
            pool.query(
                `SELECT COUNT(*)::int as count FROM bookings WHERE date = $1 AND status != 'cancelled'`,
                [today]
            ),
            // 22: Today's tasks done count vs total for this user
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'done' AND completed_at::date = CURRENT_DATE) ::int as done_today,
                    COUNT(*) FILTER (WHERE status != 'done') ::int as remaining
                 FROM tasks WHERE (assigned_to = $1 OR owner = $1)
                 AND (date = $2 OR (deadline IS NOT NULL AND deadline::date = CURRENT_DATE) OR date IS NULL)`,
                [username, today]
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

        // Overdue tasks with details
        const overdueR = get(3);
        tasks.overdueList = overdueR ? overdueR.rows.map(r => ({
            id: r.id, title: r.title, deadline: r.deadline, priority: r.priority, category: r.category
        })) : [];
        tasks.overdue = tasks.overdueList.length;

        // Upcoming deadlines (48h)
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

        // Escalation history (not just count)
        const escR = get(7);
        tasks.escalations = escR ? escR.rows.length : 0;
        tasks.escalationHistory = escR ? escR.rows.map(r => ({
            taskId: r.task_id, title: r.title, from: r.old_value, to: r.new_value, at: r.created_at
        })) : [];

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

        // Certificates with details
        let certificates = { total: 0, byStatus: {}, recentList: [] };
        const certR = get(10);
        if (certR) {
            certR.rows.forEach(r => {
                certificates.byStatus[r.status] = (certificates.byStatus[r.status] || 0) + 1;
                certificates.total += 1;
            });
            certificates.recentList = certR.rows.map(r => ({
                id: r.id, code: r.cert_code, name: r.display_value,
                status: r.status, validUntil: r.valid_until, usedAt: r.used_at
            }));
        }

        // Recent activity
        const histR = get(11);
        const recentActivity = histR ? histR.rows : [];

        // Point transactions with task link
        const ptR = get(12);
        const pointTransactions = ptR ? ptR.rows.map(r => ({
            points: r.points, type: r.type, reason: r.reason,
            taskId: r.task_id, taskTitle: r.task_title, created_at: r.created_at
        })) : [];

        // Leaderboard rank
        let leaderboardRank = null;
        let leaderboardTotal = 0;
        const lbR = get(13);
        if (lbR) {
            leaderboardTotal = lbR.rows.length;
            const idx = lbR.rows.findIndex(r => r.username === username);
            leaderboardRank = idx >= 0 ? idx + 1 : null;
        }

        // My active tasks (with dependency blocking info)
        const myTasksR = get(14);
        const allTaskIds = myTasksR ? myTasksR.rows.map(t => t.id) : [];
        const myTasks = myTasksR ? myTasksR.rows.map(t => {
            const deps = t.dependency_ids || [];
            const isBlocked = deps.length > 0 && deps.some(d => allTaskIds.includes(d));
            return {
                id: t.id, title: t.title, status: t.status, priority: t.priority,
                deadline: t.deadline, category: t.category,
                isOverdue: t.deadline && new Date(t.deadline) < now,
                isBlocked
            };
        }) : [];

        // Today's shift
        const shiftR = get(15);
        const todayShift = shiftR && shiftR.rows.length > 0 ? {
            start: shiftR.rows[0].shift_start,
            end: shiftR.rows[0].shift_end,
            status: shiftR.rows[0].status,
            note: shiftR.rows[0].note,
            department: shiftR.rows[0].department,
            position: shiftR.rows[0].position
        } : null;

        // Achievements
        const achR = get(16);
        const unlockedAchievements = achR ? achR.rows.map(r => ({
            key: r.achievement_key, at: r.unlocked_at
        })) : [];

        // Streak
        const streakR = get(17);
        const streak = streakR && streakR.rows.length > 0 ? {
            current: streakR.rows[0].current_streak,
            longest: streakR.rows[0].longest_streak,
            lastActiveDate: streakR.rows[0].last_active_date
        } : { current: 0, longest: 0, lastActiveDate: null };

        // Deltas
        const deltaTasksR = get(18);
        const deltaBkR = get(19);
        const deltas = {
            tasksDone: deltaTasksR ? { thisWeek: deltaTasksR.rows[0].this_week, lastWeek: deltaTasksR.rows[0].last_week } : null,
            bookings: deltaBkR ? { thisWeek: deltaBkR.rows[0].this_week, lastWeek: deltaBkR.rows[0].last_week } : null
        };

        // Team overview (admin)
        const teamR = get(20);
        const team = teamR ? teamR.rows.map(r => ({
            username: r.username, name: r.name, role: r.role,
            openTasks: r.open_tasks, overdueTasks: r.overdue_tasks
        })) : [];

        // Day progress
        const dayBkR = get(21);
        const dayTasksR = get(22);
        const dayProgress = {
            bookingsToday: dayBkR ? dayBkR.rows[0].count : 0,
            tasksDoneToday: dayTasksR ? dayTasksR.rows[0].done_today : 0,
            tasksRemaining: dayTasksR ? dayTasksR.rows[0].remaining : 0
        };

        // Auto-check achievements
        await _checkAndGrantAchievements(username, { tasks, bookings, streak, points });

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
            todayShift,
            achievements: unlockedAchievements,
            streak,
            deltas,
            team: isAdminRole ? team : [],
            dayProgress,
            showRevenue: isAdminRole
        });
    } catch (err) {
        log.error('Profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.6: Achievement definitions
const ACHIEVEMENTS = {
    first_task: { title: 'Перша задача', desc: 'Завершити першу задачу', icon: '🎯' },
    task_master_10: { title: 'Майстер задач', desc: 'Завершити 10 задач', icon: '🏆' },
    task_master_50: { title: 'Легенда задач', desc: 'Завершити 50 задач', icon: '👑' },
    speed_demon: { title: 'Швидкий як вітер', desc: 'Середній час виконання < 2 год', icon: '⚡' },
    booking_pro: { title: 'Бронювання Pro', desc: 'Створити 20+ бронювань', icon: '📅' },
    streak_3: { title: 'Стрік 3 дні', desc: 'Активність 3 дні поспіль', icon: '🔥' },
    streak_7: { title: 'Тижневий стрік', desc: 'Активність 7 днів поспіль', icon: '🔥🔥' },
    streak_30: { title: 'Місячний стрік', desc: 'Активність 30 днів поспіль', icon: '💎🔥' },
    zero_overdue: { title: 'Все вчасно', desc: 'Жодної простроченої задачі', icon: '✅' },
    point_collector: { title: 'Збирач балів', desc: 'Набрати 100+ постійних балів', icon: '💰' },
    no_escalation: { title: 'Без ескалацій', desc: 'Жодної ескалації за місяць', icon: '🛡️' },
    early_bird: { title: 'Рання пташка', desc: 'Завершити задачу до 09:00', icon: '🐦' }
};

// Auto-grant achievements based on current stats
async function _checkAndGrantAchievements(username, stats) {
    const checks = [];
    if (stats.tasks.done >= 1) checks.push('first_task');
    if (stats.tasks.done >= 10) checks.push('task_master_10');
    if (stats.tasks.done >= 50) checks.push('task_master_50');
    if (stats.tasks.avgCompletionHours !== null && stats.tasks.avgCompletionHours < 2) checks.push('speed_demon');
    if (stats.bookings.total >= 20) checks.push('booking_pro');
    if (stats.streak.current >= 3) checks.push('streak_3');
    if (stats.streak.current >= 7) checks.push('streak_7');
    if (stats.streak.current >= 30) checks.push('streak_30');
    if (stats.tasks.done > 0 && stats.tasks.overdue === 0) checks.push('zero_overdue');
    if (stats.points.permanent_total >= 100) checks.push('point_collector');
    if (stats.tasks.done > 0 && stats.tasks.escalations === 0) checks.push('no_escalation');

    for (const key of checks) {
        try {
            await pool.query(
                'INSERT INTO user_achievements (username, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [username, key]
            );
        } catch { /* ignore */ }
    }
}

// v10.6: Achievement definitions endpoint (for UI)
router.get('/achievements', authenticateToken, (req, res) => {
    res.json(ACHIEVEMENTS);
});

// v10.6: User action log — track UI clicks/navigations
router.post('/log-action', authenticateToken, async (req, res) => {
    try {
        const { action, target, meta } = req.body;
        if (!action) return res.status(400).json({ error: 'Action required' });
        await pool.query(
            'INSERT INTO user_action_log (username, action, target, meta) VALUES ($1, $2, $3, $4)',
            [req.user.username, action.substring(0, 50), (target || '').substring(0, 100), meta || null]
        );
        // Update streak
        const today = new Date().toISOString().split('T')[0];
        const streakResult = await pool.query(
            'SELECT current_streak, last_active_date FROM user_streaks WHERE username = $1',
            [req.user.username]
        );
        if (streakResult.rows.length === 0) {
            await pool.query(
                'INSERT INTO user_streaks (username, current_streak, longest_streak, last_active_date) VALUES ($1, 1, 1, $2)',
                [req.user.username, today]
            );
        } else {
            const s = streakResult.rows[0];
            if (s.last_active_date !== today) {
                const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                let newStreak = s.last_active_date === yesterdayStr ? s.current_streak + 1 : 1;
                await pool.query(
                    `UPDATE user_streaks SET current_streak = $1, longest_streak = GREATEST(longest_streak, $1),
                     last_active_date = $2, updated_at = NOW() WHERE username = $3`,
                    [newStreak, today, req.user.username]
                );
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Log action error', err);
        res.json({ ok: true }); // Don't fail the client for logging errors
    }
});

// v10.6: Quick task status change from profile
router.patch('/tasks/:id/quick-status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!['todo', 'in_progress', 'done'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const task = await pool.query('SELECT id, status, assigned_to, owner FROM tasks WHERE id = $1', [parseInt(id)]);
        if (task.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        const t = task.rows[0];
        // Only assigned user, owner, or admin can change status
        const canChange = t.assigned_to === req.user.username || t.owner === req.user.username || req.user.role === 'admin';
        if (!canChange) return res.status(403).json({ error: 'Недостатньо прав' });

        const oldStatus = t.status;
        const completedAt = status === 'done' ? 'NOW()' : 'NULL';
        await pool.query(
            `UPDATE tasks SET status = $1, completed_at = ${completedAt}, updated_at = NOW() WHERE id = $2`,
            [status, parseInt(id)]
        );
        // Log the change
        await pool.query(
            'INSERT INTO task_logs (task_id, action, old_value, new_value, actor) VALUES ($1, $2, $3, $4, $5)',
            [parseInt(id), 'status_change', oldStatus, status, req.user.username]
        );
        log.info(`Task #${id} status: ${oldStatus} → ${status} by ${req.user.username}`);
        res.json({ success: true, oldStatus, newStatus: status });
    } catch (err) {
        log.error('Quick task status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.6: User action log — recent actions
router.get('/action-log', authenticateToken, async (req, res) => {
    try {
        const isAdminRole = req.user.role === 'admin';
        const targetUser = isAdminRole && req.query.user ? req.query.user : req.user.username;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const result = await pool.query(
            `SELECT action, target, meta, created_at FROM user_action_log
             WHERE username = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [targetUser, limit, offset]
        );
        const countR = await pool.query(
            'SELECT COUNT(*)::int as total FROM user_action_log WHERE username = $1',
            [targetUser]
        );
        res.json({ items: result.rows, total: countR.rows[0].total });
    } catch (err) {
        log.error('Action log error', err);
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
