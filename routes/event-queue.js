/**
 * routes/event-queue.js — Event Queue + Rule Engine API (v19.1)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { publish: publishEvent, processEventRules } = require('../services/eventBus');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('EventQueue');

// All event-queue routes require authentication
router.use(authenticateToken);

// ============================================
// Event Queue
// ============================================

// POST /api/events/publish — publish event to queue (uses eventBus)
router.post('/publish', async (req, res) => {
    try {
        const { event_type, payload, idempotency_key } = req.body;
        if (!event_type) {
            return res.status(400).json({ error: 'event_type обов\'язковий' });
        }

        const event = await publishEvent(event_type, payload, idempotency_key);
        if (!event) {
            return res.json({ success: true, duplicate: true, message: 'Подія з таким ключем вже існує' });
        }

        res.json({ success: true, event });
    } catch (err) {
        log.error('Publish event error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events — list events
router.get('/', async (req, res) => {
    try {
        const { status, event_type, limit: lim } = req.query;
        let query = 'SELECT * FROM event_queue';
        const conditions = [];
        const params = [];
        if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
        if (event_type) { params.push(event_type); conditions.push(`event_type = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ` ORDER BY created_at DESC LIMIT ${parseInt(lim) || 50}`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List events error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/overview — queue dashboard
router.get('/overview', async (req, res) => {
    try {
        const [queue, deadLetter, rules, executions] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processed') as processed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM event_queue`),
            pool.query('SELECT COUNT(*) as count FROM event_dead_letter'),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE is_active) as active,
                COUNT(*) as total
             FROM rule_definitions`),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE result = 'success') as success,
                COUNT(*) FILTER (WHERE result = 'error') as errors,
                COUNT(*) as total
             FROM rule_execution_log WHERE executed_at > NOW() - INTERVAL '24 hours'`)
        ]);

        res.json({
            queue: queue.rows[0],
            dead_letter: deadLetter.rows[0],
            rules: rules.rows[0],
            executions_24h: executions.rows[0]
        });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/events/:id/retry — retry failed event
router.post('/:id/retry', async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE event_queue SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = NULL
             WHERE id = $1 AND status = 'failed' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Подію не знайдено або вона не в статусі failed' });
        }
        res.json({ success: true, event: result.rows[0] });
    } catch (err) {
        log.error('Retry event error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/dead-letter — dead letter queue
router.get('/dead-letter', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM event_dead_letter ORDER BY moved_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) {
        log.error('Dead letter error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Rule Engine
// ============================================

// GET /api/events/rules — list rules
router.get('/rules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rule_definitions ORDER BY priority DESC, created_at LIMIT 500');
        res.json(result.rows);
    } catch (err) {
        log.error('List rules error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/events/rules — create rule
router.post('/rules', async (req, res) => {
    try {
        const { code, name, description, trigger_event, conditions, actions, priority } = req.body;
        if (!code || !name || !trigger_event) {
            return res.status(400).json({ error: 'code, name, trigger_event обов\'язкові' });
        }

        const result = await pool.query(
            `INSERT INTO rule_definitions (code, name, description, trigger_event, conditions, actions, priority, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [code, name, description || null, trigger_event,
             JSON.stringify(conditions || {}), JSON.stringify(actions || []),
             priority || 0, req.user?.username || 'system']
        );

        log.info(`Rule created: ${code}`);
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        if (err.constraint === 'rule_definitions_code_key') {
            return res.status(400).json({ error: 'Правило з таким кодом вже існує' });
        }
        log.error('Create rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/events/rules/:id — update rule
router.put('/rules/:id', async (req, res) => {
    try {
        const { name, description, trigger_event, conditions, actions, priority, is_active } = req.body;
        const result = await pool.query(
            `UPDATE rule_definitions SET name=$1, description=$2, trigger_event=$3,
             conditions=$4, actions=$5, priority=$6, is_active=$7, updated_at=NOW()
             WHERE id=$8 RETURNING *`,
            [name, description, trigger_event, JSON.stringify(conditions || {}),
             JSON.stringify(actions || []), priority || 0, is_active !== false, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Правило не знайдено' });
        }
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        log.error('Update rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/events/rules/:id — delete rule
router.delete('/rules/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM rule_definitions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/rules/log — execution log
router.get('/rules/log', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT rel.*
             FROM rule_execution_log rel
             ORDER BY rel.executed_at DESC LIMIT 100`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Rule log error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
