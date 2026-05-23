/**
 * routes/lines.js — Animator lines per date
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, syncScheduledAnimatorLines } = require('../services/booking');
const { broadcast } = require('../services/websocket');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const {
    DEFAULT_TIMELINE_CONTEXT,
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');

const log = createLogger('Lines');

const MAYSTERNYA_DEFAULT_LINES = [
    { id: 'md-consult-room', name: 'Олександр', color: '#0EA586', fromSheet: false, staffId: null, shiftStart: null, shiftEnd: null, shiftStatus: null, source: 'maysternya_default' }
];

// All lines routes require authentication
router.use(authenticateToken);

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;

        const sync = businessContext === DEFAULT_TIMELINE_CONTEXT
            ? await syncScheduledAnimatorLines(date)
            : { source: 'maysternya_context' };
        const result = await pool.query(
            `SELECT
                 l.*,
                 ss.shift_start,
                 ss.shift_end,
                 ss.status AS shift_status,
                 s.id AS staff_id
             FROM lines_by_date l
             LEFT JOIN staff s ON l.line_id = s.id::text
             LEFT JOIN staff_schedule ss
                ON ss.staff_id = s.id
               AND ss.date = l.date
               AND ss.status IN ('working', 'remote')
             WHERE l.date = $1 AND l.business_context = $2
             ORDER BY
                CASE WHEN ss.staff_id IS NULL THEN 1 ELSE 0 END,
                ss.shift_start NULLS LAST,
                l.id`,
            [date, businessContext]
        );
        const lines = result.rows.map(row => ({
            id: row.line_id,
            name: row.name,
            color: row.color,
            fromSheet: row.from_sheet,
            staffId: row.staff_id || null,
            shiftStart: row.shift_start || null,
            shiftEnd: row.shift_end || null,
            shiftStatus: row.shift_status || null,
            source: row.staff_id ? 'staff_schedule' : (row.from_sheet ? 'sheet' : 'manual')
        }));
        res.set('X-Timeline-Lines-Source', sync.source);
        res.json(lines.length ? lines : (businessContext === DEFAULT_TIMELINE_CONTEXT ? [] : MAYSTERNYA_DEFAULT_LINES));
    } catch (err) {
        log.error('Error fetching lines', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const lines = req.body;

        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!Array.isArray(lines)) return res.status(400).json({ error: 'Lines must be an array' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'settings')) return;

        await client.query('BEGIN');
        await client.query('DELETE FROM lines_by_date WHERE date = $1 AND business_context = $2', [date, businessContext]);

        for (const line of lines) {
            await client.query(
                'INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet) VALUES ($1, $2, $3, $4, $5, $6)',
                [businessContext, date, line.id, line.name, line.color, line.fromSheet || false]
            );
        }

        await client.query('COMMIT');

        // WebSocket: notify other clients about line changes
        broadcast('line:updated', { date, lines, businessContext }, req.user?.id?.toString(), date);

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Error saving lines', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
