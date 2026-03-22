/**
 * routes/support.js — Support/SLA + Retention Policy API (v19.0)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('Support');

// All support routes require authentication
router.use(authenticateToken);

// ============================================
// Support Tickets
// ============================================

// GET /api/support/tickets — list tickets
router.get('/tickets', async (req, res) => {
    try {
        const { status, priority, category } = req.query;
        let query = `SELECT st.*, c.name as customer_name, c.phone as customer_phone
                     FROM support_tickets st
                     LEFT JOIN customers c ON st.customer_id = c.id`;
        const conditions = [];
        const params = [];
        if (status) { params.push(status); conditions.push(`st.status = $${params.length}`); }
        if (priority) { params.push(priority); conditions.push(`st.priority = $${params.length}`); }
        if (category) { params.push(category); conditions.push(`st.category = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY CASE st.priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, st.created_at DESC LIMIT 100';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List tickets error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/support/tickets — create ticket
router.post('/tickets', async (req, res) => {
    try {
        const { subject, description, category, priority, customer_id, assigned_to } = req.body;
        if (!subject || !subject.trim()) {
            return res.status(400).json({ error: 'Тема тікету обов\'язкова' });
        }

        // Generate ticket number
        const counter = await pool.query(
            'UPDATE support_counter SET current_number = current_number + 1 RETURNING current_number'
        );
        const num = counter.rows[0].current_number;
        const ticketNumber = `TK-${new Date().getFullYear()}-${String(num).padStart(4, '0')}`;

        // Apply SLA rule
        let slaResponse = 120;
        let slaResolve = 480;
        const slaRule = await pool.query(
            `SELECT * FROM sla_rules WHERE is_active = true
             AND ($1::varchar IS NULL OR category = $1)
             AND ($2::varchar IS NULL OR priority = $2)
             ORDER BY response_minutes ASC LIMIT 1`,
            [category || null, priority || null]
        );
        if (slaRule.rows.length > 0) {
            slaResponse = slaRule.rows[0].response_minutes;
            slaResolve = slaRule.rows[0].resolve_minutes;
        }

        const result = await pool.query(
            `INSERT INTO support_tickets (ticket_number, subject, description, category, priority, customer_id, assigned_to, sla_response_minutes, sla_resolve_minutes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [ticketNumber, subject.trim(), description || null, category || 'general',
             priority || 'medium', customer_id || null, assigned_to || null,
             slaResponse, slaResolve, req.user?.username || 'system']
        );

        log.info(`Ticket created: ${ticketNumber} (${priority || 'medium'})`);
        res.json({ success: true, ticket: result.rows[0] });
    } catch (err) {
        log.error('Create ticket error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/support/tickets/:id — single ticket with messages
router.get('/tickets/:id', async (req, res) => {
    try {
        const ticket = await pool.query(
            `SELECT st.*, c.name as customer_name FROM support_tickets st
             LEFT JOIN customers c ON st.customer_id = c.id WHERE st.id = $1`,
            [req.params.id]
        );
        if (ticket.rows.length === 0) {
            return res.status(404).json({ error: 'Тікет не знайдено' });
        }

        const messages = await pool.query(
            'SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at',
            [req.params.id]
        );

        // Check SLA breach
        const t = ticket.rows[0];
        const elapsed = (Date.now() - new Date(t.created_at).getTime()) / 60000;
        const slaBreached = !t.resolved_at && elapsed > t.sla_resolve_minutes;

        res.json({ ...t, messages: messages.rows, sla_elapsed_minutes: Math.round(elapsed), sla_breached: slaBreached });
    } catch (err) {
        log.error('Get ticket error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/support/tickets/:id — update ticket status
router.put('/tickets/:id', async (req, res) => {
    try {
        const { status, assigned_to, priority } = req.body;
        const validStatuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Невірний статус. Допустимі: ${validStatuses.join(', ')}` });
        }

        let setClause = [];
        const params = [];
        if (status) {
            params.push(status);
            setClause.push(`status = $${params.length}`);
            if (status === 'resolved') setClause.push('resolved_at = NOW()');
        }
        if (assigned_to !== undefined) {
            params.push(assigned_to);
            setClause.push(`assigned_to = $${params.length}`);
        }
        if (priority) {
            params.push(priority);
            setClause.push(`priority = $${params.length}`);
        }

        params.push(req.params.id);
        const result = await pool.query(
            `UPDATE support_tickets SET ${setClause.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тікет не знайдено' });
        }
        res.json({ success: true, ticket: result.rows[0] });
    } catch (err) {
        log.error('Update ticket error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/support/tickets/:id/messages — add message to ticket
router.post('/tickets/:id/messages', async (req, res) => {
    try {
        const { message, sender_type, is_internal } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Повідомлення обов\'язкове' });
        }

        const result = await pool.query(
            `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_name, message, is_internal)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.params.id, sender_type || 'agent', req.user?.username || 'system',
             message.trim(), is_internal || false]
        );

        // Mark first response
        await pool.query(
            `UPDATE support_tickets SET first_response_at = COALESCE(first_response_at, NOW())
             WHERE id = $1 AND first_response_at IS NULL`,
            [req.params.id]
        );

        res.json({ success: true, message: result.rows[0] });
    } catch (err) {
        log.error('Add message error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// SLA Rules
// ============================================

// GET /api/support/sla — list SLA rules
router.get('/sla', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sla_rules ORDER BY response_minutes');
        res.json(result.rows);
    } catch (err) {
        log.error('List SLA error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/support/sla — create SLA rule
router.post('/sla', async (req, res) => {
    try {
        const { name, category, priority, response_minutes, resolve_minutes, escalation_after_minutes, escalation_to } = req.body;
        if (!name) return res.status(400).json({ error: 'Назва обов\'язкова' });

        const result = await pool.query(
            `INSERT INTO sla_rules (name, category, priority, response_minutes, resolve_minutes, escalation_after_minutes, escalation_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, category || null, priority || null, response_minutes || 120,
             resolve_minutes || 480, escalation_after_minutes || 60, escalation_to || null]
        );
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        log.error('Create SLA error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Retention Policies
// ============================================

// GET /api/support/retention — list policies
router.get('/retention', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM retention_policies ORDER BY table_name');
        res.json(result.rows);
    } catch (err) {
        log.error('List retention error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/support/retention/run — execute retention cleanup
router.post('/retention/run', async (req, res) => {
    try {
        const policies = await pool.query('SELECT * FROM retention_policies WHERE is_active = true');
        const results = [];

        for (const policy of policies.rows) {
            try {
                const deleteResult = await pool.query(
                    `DELETE FROM ${policy.table_name} WHERE ${policy.condition_column} < NOW() - INTERVAL '${policy.retention_days} days'`
                );
                const deleted = deleteResult.rowCount;
                await pool.query(
                    'UPDATE retention_policies SET last_cleanup_at = NOW(), rows_deleted_last = $1 WHERE id = $2',
                    [deleted, policy.id]
                );
                results.push({ table: policy.table_name, deleted, retention_days: policy.retention_days });
                if (deleted > 0) log.info(`Retention: ${policy.table_name} — ${deleted} rows deleted`);
            } catch (tableErr) {
                results.push({ table: policy.table_name, error: tableErr.message });
            }
        }

        res.json({ success: true, results });
    } catch (err) {
        log.error('Retention run error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/support/retention/:id — update policy
router.put('/retention/:id', async (req, res) => {
    try {
        const { retention_days, is_active } = req.body;
        const result = await pool.query(
            'UPDATE retention_policies SET retention_days = $1, is_active = $2 WHERE id = $3 RETURNING *',
            [retention_days, is_active !== false, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Політику не знайдено' });
        res.json({ success: true, policy: result.rows[0] });
    } catch (err) {
        log.error('Update retention error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/support/overview — dashboard
router.get('/overview', async (req, res) => {
    try {
        const [tickets, sla] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'open') as open_count,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
                COUNT(*) FILTER (WHERE status = 'closed') as closed,
                COUNT(*) FILTER (WHERE sla_breached) as sla_breached,
                COUNT(*) as total
             FROM support_tickets`),
            pool.query(`SELECT
                AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) as avg_response_minutes,
                AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60) FILTER (WHERE resolved_at IS NOT NULL) as avg_resolve_minutes
             FROM support_tickets WHERE first_response_at IS NOT NULL`)
        ]);
        res.json({ tickets: tickets.rows[0], performance: sla.rows[0] });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
