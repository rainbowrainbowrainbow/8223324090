/**
 * routes/status.js — Public Status Page API (v18.4)
 * Public endpoints for system health monitoring.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Status');

// GET /api/status/public — public status overview (no auth)
router.get('/public', async (req, res) => {
    try {
        // Get all public components
        const components = await pool.query(
            `SELECT code, name, description, category, status, last_check_at
             FROM system_components WHERE is_public = true ORDER BY sort_order`
        );

        // Get active incidents
        const incidents = await pool.query(
            `SELECT si.*, (
                SELECT json_agg(siu ORDER BY siu.created_at DESC)
                FROM status_incident_updates siu WHERE siu.incident_id = si.id
             ) as updates
             FROM status_incidents si
             WHERE si.status != 'resolved' OR si.resolved_at > NOW() - INTERVAL '48 hours'
             ORDER BY si.started_at DESC LIMIT 20`
        );

        // Calculate overall status
        const statuses = components.rows.map(c => c.status);
        let overall = 'operational';
        if (statuses.includes('major_outage')) overall = 'major_outage';
        else if (statuses.includes('partial_outage')) overall = 'partial_outage';
        else if (statuses.includes('degraded')) overall = 'degraded';
        else if (statuses.includes('maintenance')) overall = 'maintenance';

        // Uptime indicator (simplistic: hours since last major incident)
        const lastMajor = await pool.query(
            `SELECT started_at FROM status_incidents
             WHERE severity IN ('major', 'critical') AND status = 'resolved'
             ORDER BY resolved_at DESC LIMIT 1`
        );
        const hoursSinceIncident = lastMajor.rows.length > 0
            ? Math.round((Date.now() - new Date(lastMajor.rows[0].started_at).getTime()) / 3600000)
            : null;

        res.json({
            overall_status: overall,
            hours_since_incident: hoursSinceIncident,
            components: components.rows,
            incidents: incidents.rows,
            checked_at: new Date().toISOString()
        });
    } catch (err) {
        log.error('Public status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Admin endpoints (require auth)
// ============================================

// GET /api/status/components — all components (admin)
router.get('/components', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_components ORDER BY sort_order');
        res.json(result.rows);
    } catch (err) {
        log.error('Get components error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/status/components/:code — update component status
router.put('/components/:code', async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Невірний статус. Допустимі: ${validStatuses.join(', ')}` });
        }

        const result = await pool.query(
            `UPDATE system_components SET status = $1, last_check_at = NOW() WHERE code = $2 RETURNING *`,
            [status, req.params.code]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Компонент не знайдено' });
        }

        log.info(`Component ${req.params.code} status -> ${status}`);
        res.json({ success: true, component: result.rows[0] });
    } catch (err) {
        log.error('Update component error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/status/incidents — create incident
router.post('/incidents', async (req, res) => {
    try {
        const { title, description, severity, affected_components } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Назва інциденту обов\'язкова' });
        }

        const validSeverities = ['minor', 'major', 'critical'];
        if (severity && !validSeverities.includes(severity)) {
            return res.status(400).json({ error: `Невірна серйозність. Допустимі: ${validSeverities.join(', ')}` });
        }

        const result = await pool.query(
            `INSERT INTO status_incidents (title, description, severity, affected_components, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [
                title.trim(), description || null,
                severity || 'minor',
                JSON.stringify(affected_components || []),
                req.user?.username || 'system'
            ]
        );

        // Update affected components status
        if (affected_components && affected_components.length > 0) {
            const componentStatus = severity === 'critical' ? 'major_outage'
                : severity === 'major' ? 'partial_outage' : 'degraded';
            await pool.query(
                `UPDATE system_components SET status = $1, last_check_at = NOW()
                 WHERE code = ANY($2)`,
                [componentStatus, affected_components]
            );
        }

        log.info(`Incident created: ${title} (severity: ${severity})`);
        res.json({ success: true, incident: result.rows[0] });
    } catch (err) {
        log.error('Create incident error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/status/incidents/:id/update — add incident update
router.post('/incidents/:id/update', async (req, res) => {
    try {
        const { status, message } = req.body;
        const validStatuses = ['investigating', 'identified', 'monitoring', 'resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Невірний статус. Допустимі: ${validStatuses.join(', ')}` });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Повідомлення обов\'язкове' });
        }

        // Add update
        const update = await pool.query(
            `INSERT INTO status_incident_updates (incident_id, status, message, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.params.id, status, message.trim(), req.user?.username || 'system']
        );

        // Update incident status
        const setClause = status === 'resolved'
            ? 'status = $1, resolved_at = NOW()'
            : 'status = $1';
        await pool.query(
            `UPDATE status_incidents SET ${setClause} WHERE id = $2`,
            [status, req.params.id]
        );

        // If resolved, restore affected components
        if (status === 'resolved') {
            const incident = await pool.query(
                'SELECT affected_components FROM status_incidents WHERE id = $1',
                [req.params.id]
            );
            if (incident.rows[0]?.affected_components?.length > 0) {
                await pool.query(
                    `UPDATE system_components SET status = 'operational', last_check_at = NOW()
                     WHERE code = ANY($1)`,
                    [incident.rows[0].affected_components]
                );
            }
        }

        log.info(`Incident ${req.params.id} updated: ${status}`);
        res.json({ success: true, update: update.rows[0] });
    } catch (err) {
        log.error('Update incident error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/status/incidents — all incidents (admin)
router.get('/incidents', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT si.*, (
                SELECT json_agg(siu ORDER BY siu.created_at DESC)
                FROM status_incident_updates siu WHERE siu.incident_id = si.id
             ) as updates
             FROM status_incidents si
             ORDER BY si.started_at DESC LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get incidents error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
