/**
 * routes/ai-workers.js — AI Workers (Digital Employees) API (v17.3)
 *
 * Endpoints:
 *   GET    /api/ai-workers              — list all workers
 *   PUT    /api/ai-workers/:id          — update worker settings
 *   POST   /api/ai-workers/:id/tasks    — send task to worker
 *   GET    /api/ai-workers/:id/tasks    — task journal
 *   POST   /api/ai-workers/:id/webhook  — webhook for bot responses
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { sendTaskToWorker } = require('../services/ai-workers');
const { createLogger } = require('../utils/logger');

const log = createLogger('AIWorkers');

// GET /api/ai-workers — list all workers with capabilities
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, avatar, role, department, status, status_label,
                    description, capabilities, integration,
                    webhook_url IS NOT NULL OR bot_token IS NOT NULL AS has_transport,
                    created_at, updated_at
             FROM ai_workers ORDER BY status DESC, name`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /ai-workers error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/ai-workers/:id — update worker settings
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, status_label, bot_token, bot_chat_id, webhook_url, webhook_secret, capabilities, integration, description } = req.body;

        const result = await pool.query(
            `UPDATE ai_workers SET
                status = COALESCE($1, status),
                status_label = COALESCE($2, status_label),
                bot_token = COALESCE($3, bot_token),
                bot_chat_id = COALESCE($4, bot_chat_id),
                webhook_url = COALESCE($5, webhook_url),
                webhook_secret = COALESCE($6, webhook_secret),
                capabilities = COALESCE($7, capabilities),
                integration = COALESCE($8, integration),
                description = COALESCE($9, description),
                updated_at = NOW()
             WHERE id = $10
             RETURNING id, name, avatar, role, department, status, status_label, description, capabilities, integration, updated_at`,
            [status, status_label, bot_token, bot_chat_id, webhook_url, webhook_secret,
             capabilities ? JSON.stringify(capabilities) : null,
             integration, description, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        }

        log.info(`Worker ${id} updated by ${req.user?.username}`);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error(`PUT /ai-workers/${req.params.id} error`, err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/ai-workers/:id/tasks — send task to worker
router.post('/:id/tasks', async (req, res) => {
    try {
        const { id } = req.params;
        const { task } = req.body;
        const username = req.user?.username || 'system';

        if (!task || !task.trim()) {
            return res.status(400).json({ success: false, error: 'Потрібен текст завдання' });
        }

        // Get worker
        const workerRes = await pool.query('SELECT * FROM ai_workers WHERE id = $1', [id]);
        if (workerRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Працівника не знайдено' });
        }

        const worker = workerRes.rows[0];
        let taskStatus = 'sent';

        // If worker is not active or has no transport, queue it
        if (worker.status !== 'active') {
            taskStatus = 'queued';
        }

        // Save task to DB
        const taskRes = await pool.query(
            `INSERT INTO ai_worker_tasks (worker_id, username, task, status)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [id, username, task.trim(), taskStatus]
        );

        const savedTask = taskRes.rows[0];

        // Try to send if worker is active
        let sendResult = null;
        if (worker.status === 'active' && taskStatus === 'sent') {
            sendResult = await sendTaskToWorker(worker, task.trim(), username);

            if (sendResult && !sendResult.sent) {
                // Update status to failed
                await pool.query(
                    `UPDATE ai_worker_tasks SET status = 'failed', result = $1 WHERE id = $2`,
                    [sendResult.error, savedTask.id]
                );
                savedTask.status = 'failed';
                savedTask.result = sendResult.error;
            }
        }

        log.info(`Task ${savedTask.id} sent to worker ${id} by ${username}: ${taskStatus}`);
        res.json({ success: true, data: savedTask, sendResult });
    } catch (err) {
        log.error(`POST /ai-workers/${req.params.id}/tasks error`, err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/ai-workers/:id/tasks — task journal
router.get('/:id/tasks', async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        const result = await pool.query(
            `SELECT id, worker_id, username, task, status, result, created_at, completed_at
             FROM ai_worker_tasks
             WHERE worker_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        );

        const countRes = await pool.query(
            'SELECT COUNT(*) as total FROM ai_worker_tasks WHERE worker_id = $1',
            [id]
        );

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countRes.rows[0].total),
            limit,
            offset
        });
    } catch (err) {
        log.error(`GET /ai-workers/${req.params.id}/tasks error`, err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/ai-workers/:id/webhook — webhook for bot responses
router.post('/:id/webhook', async (req, res) => {
    try {
        const { id } = req.params;
        const { task_id, status, result, secret } = req.body;

        // Verify secret
        const workerRes = await pool.query('SELECT webhook_secret FROM ai_workers WHERE id = $1', [id]);
        if (workerRes.rows.length === 0) {
            return res.status(404).json({ error: 'Worker not found' });
        }

        const expectedSecret = workerRes.rows[0].webhook_secret;
        const providedSecret = req.headers['x-secret'] || secret;

        if (expectedSecret && providedSecret !== expectedSecret) {
            return res.status(401).json({ error: 'Invalid secret' });
        }

        if (!task_id) {
            return res.status(400).json({ error: 'task_id required' });
        }

        const updateRes = await pool.query(
            `UPDATE ai_worker_tasks SET
                status = COALESCE($1, status),
                result = COALESCE($2, result),
                completed_at = CASE WHEN $1 IN ('done', 'failed') THEN NOW() ELSE completed_at END
             WHERE id = $3 AND worker_id = $4
             RETURNING *`,
            [status || 'done', result, task_id, id]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        log.info(`Webhook: worker ${id} task ${task_id} → ${status}`);
        res.json({ success: true, data: updateRes.rows[0] });
    } catch (err) {
        log.error(`POST /ai-workers/${req.params.id}/webhook error`, err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

module.exports = router;
