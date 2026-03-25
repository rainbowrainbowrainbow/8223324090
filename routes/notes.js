/**
 * routes/notes.js — User notes (sticky notes) API
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Notes');

// GET /api/notes
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const userRole = req.user.role || '';
        const result = await pool.query(
            `SELECT * FROM quick_notes
             WHERE user_id = $1
                OR is_shared = true
                OR (visible_to_depts IS NOT NULL AND $2 = ANY(visible_to_depts))
             ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
            [userId, userRole]
        );
        res.json(result.rows.map(n => ({
            id: n.id, text: n.text, content: n.text, title: n.title || '',
            pinned: n.pinned || false, createdAt: n.created_at,
            isShared: n.is_shared || false, visibleToDepts: n.visible_to_depts || null
        })));
    } catch (err) {
        log.error('Get notes error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/notes
router.post('/', requireRole(...ANY_ROLE), async (req, res) => {
    const { title, content, color, is_shared, visible_to_depts, channel_id } = req.body;
    const noteText = content || title || '';
    if (!noteText.trim()) return res.status(400).json({ error: 'text обов\'язковий' });
    try {
        const result = await pool.query(
            `INSERT INTO quick_notes (user_id, text, is_shared, visible_to_depts, channel_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.user.id || req.user.userId, noteText.trim().slice(0, 200),
             !!is_shared, visible_to_depts || null, channel_id || null]
        );
        const n = result.rows[0];
        res.json({ id: n.id, text: n.text, content: n.text, isShared: n.is_shared,
                   visibleToDepts: n.visible_to_depts, createdAt: n.created_at });
    } catch (err) {
        log.error('Create note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/notes/:id
router.put('/:id', requireRole(...ANY_ROLE), async (req, res) => {
    const { title, content, color } = req.body;
    try {
        const result = await pool.query(
            `UPDATE quick_notes SET title = COALESCE($1, title), content = COALESCE($2, content),
             color = COALESCE($3, color), updated_at = NOW()
             WHERE id = $4 AND user_id = $5 RETURNING *`,
            [title, content, color, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('Update note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/notes/:id
router.delete('/:id', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM quick_notes WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('Delete note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/notes/:id/pin
router.put('/:id/pin', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE quick_notes SET pinned = NOT pinned, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING pinned',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, pinned: result.rows[0].pinned });
    } catch (err) {
        log.error('Pin note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// MEETING NOTES WITH AUTO-TASKS (v25.4.0)
// ============================================================

// POST /api/notes/meeting — create meeting note
router.post('/meeting', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const { title, summary, content, meetingDate, durationMinutes, participants, channelId, actionItems } = req.body;
        if (!title || !meetingDate) {
            return res.status(400).json({ error: 'title та meetingDate обов\'язкові' });
        }
        const userId = req.user.id || req.user.userId;

        const meetingResult = await pool.query(
            `INSERT INTO meeting_notes (title, summary, content, meeting_date, duration_minutes, participants, created_by, channel_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [title, summary || null, content || null, meetingDate, durationMinutes || null,
             participants || '{}', userId, channelId || null]
        );
        const meeting = meetingResult.rows[0];

        // Create action items if provided
        // v38.4.0: Batch INSERT instead of N+1 loop
        let items = [];
        if (Array.isArray(actionItems) && actionItems.length > 0) {
            const values = actionItems.map((_, i) => `($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`).join(',');
            const params = actionItems.flatMap(item => [meeting.id, item.description, item.assignedTo || null, item.dueDate || null]);
            const itemResult = await pool.query(
                `INSERT INTO meeting_action_items (meeting_id, description, assigned_to, due_date) VALUES ${values} RETURNING *`,
                params
            );
            items = itemResult.rows;
        }

        res.json({ success: true, meeting, actionItems: items });
    } catch (err) {
        log.error('Create meeting note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/notes/meetings — list meetings
router.get('/meetings', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, u.name AS created_by_name,
                   (SELECT COUNT(*) FROM meeting_action_items WHERE meeting_id = m.id) AS action_items_count,
                   (SELECT COUNT(*) FROM meeting_action_items WHERE meeting_id = m.id AND status = 'done') AS completed_items_count
            FROM meeting_notes m
            LEFT JOIN users u ON u.id = m.created_by
            ORDER BY m.meeting_date DESC
            LIMIT 50
        `);
        res.json({ success: true, meetings: result.rows });
    } catch (err) {
        log.error('Get meetings error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/notes/meeting/:id — meeting details with action items
router.get('/meeting/:id', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const meeting = await pool.query('SELECT * FROM meeting_notes WHERE id = $1', [req.params.id]);
        if (meeting.rows.length === 0) return res.status(404).json({ error: 'Зустріч не знайдено' });

        const items = await pool.query(
            `SELECT ai.*, u.name AS assigned_name
             FROM meeting_action_items ai
             LEFT JOIN users u ON u.id = ai.assigned_to
             WHERE ai.meeting_id = $1 ORDER BY ai.id`,
            [req.params.id]
        );
        res.json({ meeting: meeting.rows[0], actionItems: items.rows });
    } catch (err) {
        log.error('Get meeting error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/notes/meeting/:id/create-tasks — create tasks from action items
router.post('/meeting/:id/create-tasks', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const items = await pool.query(
            'SELECT * FROM meeting_action_items WHERE meeting_id = $1 AND task_id IS NULL',
            [req.params.id]
        );
        if (items.rows.length === 0) return res.json({ success: true, created: 0 });

        const meeting = await pool.query('SELECT title FROM meeting_notes WHERE id = $1', [req.params.id]);
        const meetingTitle = meeting.rows[0]?.title || 'Зустріч';
        let created = 0;

        for (const item of items.rows) {
            const taskResult = await pool.query(
                `INSERT INTO tasks (title, description, status, priority, assigned_to, owner_id, category)
                 VALUES ($1, $2, 'todo', 'normal', $3, $4, 'operational') RETURNING id`,
                [`[${meetingTitle}] ${item.description}`, `Задача зі зустрічі: ${meetingTitle}`,
                 item.assigned_to, req.user.id || req.user.userId]
            );
            await pool.query(
                'UPDATE meeting_action_items SET task_id = $1, status = $2 WHERE id = $3',
                [taskResult.rows[0].id, 'created', item.id]
            );
            created++;
        }

        res.json({ success: true, created });
    } catch (err) {
        log.error('Create tasks from meeting error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
