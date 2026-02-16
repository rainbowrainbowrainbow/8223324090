/**
 * routes/external.js — External API for Claw (Club Bot) integration
 *
 * Protected by X-API-Key authentication (middleware/apiKey.js).
 * Provides read/write access to Park Booking data for AI-powered CRM.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('External');

const VALID_TASK_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_TASK_PRIORITIES = ['low', 'normal', 'high'];
const VALID_TASK_CATEGORIES = ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement'];

/**
 * GET /api/external/context
 *
 * Returns general system state for AI context:
 * - Total bookings count (all-time)
 * - Total revenue (all-time)
 * - Pending tasks count
 * - Overdue tasks count
 * - Current streak (days with at least 1 confirmed booking)
 * - Today's bookings count
 * - Today's revenue
 */
router.get('/context', async (req, res) => {
    try {
        const [
            bookingsCount,
            totalRevenue,
            pendingTasks,
            overdueTasks,
            todayBookings,
            todayRevenue
        ] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'"),
            pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE status != 'cancelled'"),
            pool.query("SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'in_progress')"),
            pool.query("SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'in_progress') AND date < CURRENT_DATE"),
            pool.query("SELECT COUNT(*) FROM bookings WHERE date = CURRENT_DATE AND status = 'confirmed'"),
            pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = CURRENT_DATE AND status = 'confirmed'")
        ]);

        // Calculate streak (simplified: days with at least 1 confirmed booking in last 30 days)
        const streakResult = await pool.query(`
            SELECT date FROM bookings
            WHERE status = 'confirmed' AND date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY date
            ORDER BY date DESC
        `);

        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        let checkDate = new Date(today);

        for (const row of streakResult.rows) {
            const expectedDate = checkDate.toISOString().split('T')[0];
            if (row.date === expectedDate) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        res.json({
            bookingsCount: parseInt(bookingsCount.rows[0].count),
            totalRevenue: parseInt(totalRevenue.rows[0].total),
            pendingTasks: parseInt(pendingTasks.rows[0].count),
            overdueTasks: parseInt(overdueTasks.rows[0].count),
            streak,
            today: {
                bookings: parseInt(todayBookings.rows[0].count),
                revenue: parseInt(todayRevenue.rows[0].total)
            }
        });
    } catch (err) {
        log.error('Context error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/external/tasks
 *
 * Returns tasks list with optional filters:
 * - status: todo | in_progress | done
 * - assigned_to: username
 * - date: YYYY-MM-DD
 * - category: event | purchase | admin | trampoline | personal | improvement
 */
router.get('/tasks', async (req, res) => {
    try {
        const { status, assigned_to, date, category } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status && VALID_TASK_STATUSES.includes(status)) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        if (assigned_to) {
            conditions.push(`assigned_to = $${idx++}`);
            params.push(assigned_to);
        }
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            conditions.push(`date = $${idx++}`);
            params.push(date);
        }
        if (category && VALID_TASK_CATEGORIES.includes(category)) {
            conditions.push(`category = $${idx++}`);
            params.push(category);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT id, title, description, date, status, priority, assigned_to, created_by, created_at, updated_at, completed_at, category, type
             FROM tasks ${where}
             ORDER BY
                CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 END,
                created_at DESC`,
            params
        );

        res.json({ tasks: result.rows });
    } catch (err) {
        log.error('Tasks list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/external/tasks
 *
 * Creates a new task.
 *
 * Body: { title, description?, date?, priority?, assigned_to?, category?, created_by }
 */
router.post('/tasks', async (req, res) => {
    try {
        const { title, description, date, priority, assigned_to, category, created_by } = req.body;

        if (!title || !created_by) {
            return res.status(400).json({ error: 'Missing required fields: title, created_by' });
        }

        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
        }

        if (priority && !VALID_TASK_PRIORITIES.includes(priority)) {
            return res.status(400).json({ error: `Invalid priority. Valid: ${VALID_TASK_PRIORITIES.join(', ')}` });
        }

        if (category && !VALID_TASK_CATEGORIES.includes(category)) {
            return res.status(400).json({ error: `Invalid category. Valid: ${VALID_TASK_CATEGORIES.join(', ')}` });
        }

        const result = await pool.query(
            `INSERT INTO tasks (title, description, date, priority, assigned_to, category, created_by, type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'external')
             RETURNING *`,
            [title, description || null, date || null, priority || 'normal', assigned_to || null, category || 'admin', created_by]
        );

        // Log event for webhook polling
        await pool.query(
            `INSERT INTO events_log (event_type, payload)
             VALUES ('task.created', $1)`,
            [JSON.stringify({ taskId: result.rows[0].id, title, assignedTo: assigned_to, date })]
        );

        log.info(`Task created via external API: ${result.rows[0].id} by ${created_by}`);
        res.status(201).json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Task creation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PATCH /api/external/tasks/:id
 *
 * Updates task fields (partial update).
 *
 * Body: { status?, priority?, assigned_to?, description?, date? }
 */
router.patch('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, priority, assigned_to, description, date } = req.body;

        // Validate task exists
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const updates = [];
        const params = [];
        let idx = 1;

        if (status !== undefined) {
            if (!VALID_TASK_STATUSES.includes(status)) {
                return res.status(400).json({ error: `Invalid status. Valid: ${VALID_TASK_STATUSES.join(', ')}` });
            }
            updates.push(`status = $${idx++}`);
            params.push(status);

            // If status changed to 'done', set completed_at
            if (status === 'done') {
                updates.push(`completed_at = NOW()`);
            }
        }

        if (priority !== undefined) {
            if (!VALID_TASK_PRIORITIES.includes(priority)) {
                return res.status(400).json({ error: `Invalid priority. Valid: ${VALID_TASK_PRIORITIES.join(', ')}` });
            }
            updates.push(`priority = $${idx++}`);
            params.push(priority);
        }

        if (assigned_to !== undefined) {
            updates.push(`assigned_to = $${idx++}`);
            params.push(assigned_to);
        }

        if (description !== undefined) {
            updates.push(`description = $${idx++}`);
            params.push(description);
        }

        if (date !== undefined) {
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
            }
            updates.push(`date = $${idx++}`);
            params.push(date);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = NOW()`);
        params.push(id);

        const result = await pool.query(
            `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );

        // Log event for webhook polling
        await pool.query(
            `INSERT INTO events_log (event_type, payload)
             VALUES ('task.updated', $1)`,
            [JSON.stringify({ taskId: id, status, priority })]
        );

        log.info(`Task updated via external API: ${id}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Task update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/external/bookings
 *
 * Returns bookings for a specific date.
 *
 * Query: ?date=YYYY-MM-DD
 */
router.get('/bookings', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Missing or invalid date parameter (use YYYY-MM-DD)' });
        }

        const result = await pool.query(
            `SELECT id, date, time, line_id, program_code, label, program_name, category, duration, price, hosts, second_animator, room, notes, status, kids_count, group_name, created_by, created_at
             FROM bookings
             WHERE date = $1 AND status != 'cancelled'
             ORDER BY time`,
            [date]
        );

        res.json({ bookings: result.rows });
    } catch (err) {
        log.error('Bookings list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/external/staff
 *
 * Returns staff schedule for a specific date.
 *
 * Query: ?date=YYYY-MM-DD
 */
router.get('/staff', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Missing or invalid date parameter (use YYYY-MM-DD)' });
        }

        const result = await pool.query(
            `SELECT s.id, s.name, s.department, s.position, s.phone, s.telegram_username,
                    ss.shift_start, ss.shift_end, ss.status, ss.note
             FROM staff s
             LEFT JOIN staff_schedule ss ON s.id = ss.staff_id AND ss.date = $1
             WHERE s.is_active = true
             ORDER BY s.department, s.name`,
            [date]
        );

        res.json({ staff: result.rows });
    } catch (err) {
        log.error('Staff schedule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/external/greeting
 *
 * Generates a personalized greeting message with context.
 *
 * Body: { username }
 *
 * Returns: { greeting: "...", context: {...} }
 */
router.post('/greeting', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Missing required field: username' });
        }

        // Fetch user info
        const userResult = await pool.query('SELECT name, role FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userResult.rows[0];
        const today = new Date().toISOString().split('T')[0];

        // Fetch context for greeting
        const [pendingTasks, todayBookings, overdueTasks] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM tasks WHERE assigned_to = $1 AND status IN ('todo', 'in_progress')", [username]),
            pool.query("SELECT COUNT(*) FROM bookings WHERE date = $1 AND status = 'confirmed'", [today]),
            pool.query("SELECT COUNT(*) FROM tasks WHERE assigned_to = $1 AND status IN ('todo', 'in_progress') AND date < $2", [username, today])
        ]);

        const context = {
            name: user.name,
            role: user.role,
            pendingTasks: parseInt(pendingTasks.rows[0].count),
            todayBookings: parseInt(todayBookings.rows[0].count),
            overdueTasks: parseInt(overdueTasks.rows[0].count)
        };

        // Generate greeting message
        const hour = new Date().getHours();
        let timeGreeting = 'Доброго дня';
        if (hour < 12) timeGreeting = 'Доброго ранку';
        else if (hour >= 18) timeGreeting = 'Доброго вечора';

        let greeting = `${timeGreeting}, ${context.name}! 👋`;

        if (context.overdueTasks > 0) {
            greeting += `\n\n⚠️ У вас ${context.overdueTasks} прострочен${context.overdueTasks === 1 ? 'а задача' : 'их задач'}.`;
        } else if (context.pendingTasks > 0) {
            greeting += `\n\n📋 У вас ${context.pendingTasks} активн${context.pendingTasks === 1 ? 'а задача' : 'их задач'}.`;
        } else {
            greeting += `\n\n✅ Всі задачі виконані!`;
        }

        if (context.todayBookings > 0) {
            greeting += `\n🎉 Сьогодні ${context.todayBookings} бронюван${context.todayBookings === 1 ? 'ня' : 'ь'}.`;
        }

        res.json({ greeting, context });
    } catch (err) {
        log.error('Greeting generation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/external/events
 *
 * Polling endpoint for webhook events.
 * Returns unprocessed events from events_log and marks them as processed.
 *
 * Query: ?limit=10 (default 10, max 100)
 */
router.get('/events', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);

        await client.query('BEGIN');

        // Fetch unprocessed events
        const result = await client.query(
            `SELECT id, event_type, payload, created_at
             FROM events_log
             WHERE processed_at IS NULL
             ORDER BY created_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [limit]
        );

        if (result.rows.length === 0) {
            await client.query('COMMIT');
            return res.json({ events: [] });
        }

        // Mark as processed
        const ids = result.rows.map(r => r.id);
        await client.query(
            `UPDATE events_log SET processed_at = NOW() WHERE id = ANY($1)`,
            [ids]
        );

        await client.query('COMMIT');

        res.json({ events: result.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Events polling error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
