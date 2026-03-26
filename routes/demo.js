/**
 * routes/demo.js — Demo mode: scenarios, guided tours, guest access
 * v18.3.0
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const { JWT_SECRET } = require('../middleware/auth');
const log = createLogger('Demo');

// ==========================================
// DEMO LOGIN (guest access without registration)
// ==========================================

// POST /api/demo/login — Create a temporary demo session
router.post('/login', async (req, res) => {
    try {
        const { name, company } = req.body;

        // Check if demo mode is enabled
        const flagResult = await pool.query(
            "SELECT is_enabled FROM feature_flags WHERE code = 'demo_mode'"
        );
        const demoEnabled = flagResult.rows[0]?.is_enabled;

        if (!demoEnabled) {
            return res.status(403).json({ success: false, error: 'Demo-режим вимкнено' });
        }

        // Generate a demo JWT token (viewer role, 2h expiry)
        const demoUser = {
            id: -1,
            username: 'demo',
            role: 'viewer',
            name: name || 'Demo User',
            isDemo: true
        };

        const token = jwt.sign(demoUser, JWT_SECRET, { expiresIn: '2h' });

        log.info(`Demo login: ${name || 'anonymous'} (${company || 'no company'})`);

        res.json({
            success: true,
            token,
            user: { username: 'demo', role: 'viewer', name: name || 'Demo User', isDemo: true }
        });
    } catch (err) {
        log.error('POST /login error', err);
        res.status(500).json({ success: false, error: 'Помилка demo входу' });
    }
});

// ==========================================
// SCENARIOS
// ==========================================

// GET /api/demo/scenarios — List all active demo scenarios
router.get('/scenarios', async (req, res) => {
    try {
        const { category } = req.query;
        let query = 'SELECT * FROM demo_scenarios WHERE is_active = true';
        const params = [];
        if (category) {
            query += ' AND category = $1';
            params.push(category);
        }
        query += ' ORDER BY sort_order, id';
        const result = await pool.query(query, params);
        res.json({ success: true, scenarios: result.rows });
    } catch (err) {
        log.error('GET /scenarios error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження сценаріїв' });
    }
});

// GET /api/demo/scenarios/:id — Single scenario with steps
router.get('/scenarios/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM demo_scenarios WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Сценарій не знайдено' });
        }
        res.json({ success: true, scenario: result.rows[0] });
    } catch (err) {
        log.error('GET /scenarios/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/demo/scenarios — Create scenario (admin)
router.post('/scenarios', requireRole('admin'), async (req, res) => {
    try {
        const { code, title, description, category, steps, duration_minutes, icon } = req.body;
        if (!code || !title || !category) {
            return res.status(400).json({ success: false, error: 'code, title та category обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO demo_scenarios (code, title, description, category, steps, duration_minutes, icon)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [code, title, description || null, category, JSON.stringify(steps || []),
             duration_minutes || 5, icon || '🎯']
        );
        res.json({ success: true, scenario: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Сценарій з таким кодом вже існує' });
        }
        log.error('POST /scenarios error', err);
        res.status(500).json({ success: false, error: 'Помилка створення' });
    }
});

// PUT /api/demo/scenarios/:id — Update scenario (admin)
router.put('/scenarios/:id', requireRole('admin'), async (req, res) => {
    try {
        const { title, description, category, steps, duration_minutes, icon, is_active } = req.body;
        const result = await pool.query(
            `UPDATE demo_scenarios SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                category = COALESCE($3, category),
                steps = COALESCE($4, steps),
                duration_minutes = COALESCE($5, duration_minutes),
                icon = COALESCE($6, icon),
                is_active = COALESCE($7, is_active)
             WHERE id = $8 RETURNING *`,
            [title, description, category,
             steps ? JSON.stringify(steps) : null,
             duration_minutes, icon, is_active, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        res.json({ success: true, scenario: result.rows[0] });
    } catch (err) {
        log.error('PUT /scenarios/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// DELETE /api/demo/scenarios/:id (admin)
router.delete('/scenarios/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM demo_scenarios WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /scenarios/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ==========================================
// DEMO SESSIONS (tracking demo playback)
// ==========================================

// POST /api/demo/sessions — Start a demo session
router.post('/sessions', async (req, res) => {
    try {
        const { scenario_id, user_name, company_name } = req.body;
        if (!scenario_id) {
            return res.status(400).json({ success: false, error: 'scenario_id обовʼязковий' });
        }

        // Increment run_count
        await pool.query('UPDATE demo_scenarios SET run_count = run_count + 1 WHERE id = $1', [scenario_id]);

        const result = await pool.query(
            `INSERT INTO demo_sessions (scenario_id, user_name, company_name)
             VALUES ($1, $2, $3) RETURNING *`,
            [scenario_id, user_name || null, company_name || null]
        );
        res.json({ success: true, session: result.rows[0] });
    } catch (err) {
        log.error('POST /sessions error', err);
        res.status(500).json({ success: false, error: 'Помилка створення сесії' });
    }
});

// PUT /api/demo/sessions/:id — Update session (step progress, complete, feedback)
router.put('/sessions/:id', async (req, res) => {
    try {
        const { current_step, status, feedback, rating } = req.body;
        const updates = [];
        const params = [];
        let idx = 1;

        if (current_step !== undefined) {
            updates.push(`current_step = $${idx++}`);
            params.push(current_step);
        }
        if (status) {
            updates.push(`status = $${idx++}`);
            params.push(status);
            if (status === 'completed') {
                updates.push('completed_at = NOW()');
            }
        }
        if (feedback !== undefined) {
            updates.push(`feedback = $${idx++}`);
            params.push(feedback);
        }
        if (rating !== undefined) {
            updates.push(`rating = $${idx++}`);
            params.push(rating);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Немає полів для оновлення' });
        }

        params.push(req.params.id);
        const result = await pool.query(
            `UPDATE demo_sessions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Сесію не знайдено' });
        }
        res.json({ success: true, session: result.rows[0] });
    } catch (err) {
        log.error('PUT /sessions/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// GET /api/demo/sessions — List sessions (admin)
router.get('/sessions', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ds.*, s.title AS scenario_title, s.icon AS scenario_icon
            FROM demo_sessions ds
            LEFT JOIN demo_scenarios s ON ds.scenario_id = s.id
            ORDER BY ds.started_at DESC
            LIMIT 100
        `);
        res.json({ success: true, sessions: result.rows });
    } catch (err) {
        log.error('GET /sessions error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ==========================================
// OVERVIEW — Demo dashboard
// ==========================================
router.get('/overview', async (req, res) => {
    try {
        // Scenarios count
        const scenariosResult = await pool.query('SELECT COUNT(*) FROM demo_scenarios WHERE is_active = true');
        const scenarioCount = parseInt(scenariosResult.rows[0].count);

        // Total sessions
        const sessionsResult = await pool.query('SELECT COUNT(*) FROM demo_sessions');
        const sessionCount = parseInt(sessionsResult.rows[0].count);

        // Completed sessions
        const completedResult = await pool.query("SELECT COUNT(*) FROM demo_sessions WHERE status = 'completed'");
        const completedCount = parseInt(completedResult.rows[0].count);

        // Average rating
        const ratingResult = await pool.query('SELECT AVG(rating) as avg_rating FROM demo_sessions WHERE rating IS NOT NULL');
        const avgRating = ratingResult.rows[0].avg_rating ? parseFloat(ratingResult.rows[0].avg_rating).toFixed(1) : null;

        // Demo mode status
        const flagResult = await pool.query("SELECT is_enabled FROM feature_flags WHERE code = 'demo_mode'");
        const demoEnabled = flagResult.rows[0]?.is_enabled || false;

        // Popular scenarios
        const popularResult = await pool.query(`
            SELECT id, title, icon, run_count, category
            FROM demo_scenarios WHERE is_active = true
            ORDER BY run_count DESC LIMIT 5
        `);

        res.json({
            success: true,
            demoEnabled,
            scenarioCount,
            sessionCount,
            completedCount,
            completionRate: sessionCount > 0 ? Math.round((completedCount / sessionCount) * 100) : 0,
            avgRating,
            popularScenarios: popularResult.rows
        });
    } catch (err) {
        log.error('GET /overview error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/demo/toggle — Enable/disable demo mode (admin)
router.post('/toggle', requireRole('admin'), async (req, res) => {
    try {
        const { enabled } = req.body;
        await pool.query(
            "UPDATE feature_flags SET is_enabled = $1, updated_at = NOW() WHERE code = 'demo_mode'",
            [!!enabled]
        );
        log.info(`Demo mode ${enabled ? 'enabled' : 'disabled'}`);
        res.json({ success: true, enabled: !!enabled });
    } catch (err) {
        log.error('POST /toggle error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

module.exports = router;
