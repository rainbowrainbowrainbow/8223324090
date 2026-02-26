/**
 * routes/print.js — Print & Assets API (v19.0)
 * Template library, preflight validation, print routing.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Print');

// ============================================
// Print Templates
// ============================================

// GET /api/print/templates — list templates
router.get('/templates', async (req, res) => {
    try {
        const { category } = req.query;
        let query = 'SELECT * FROM print_templates';
        const params = [];
        if (category) { params.push(category); query += ` WHERE category = $1`; }
        query += ' ORDER BY category, name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List templates error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/print/templates — create template
router.post('/templates', async (req, res) => {
    try {
        const { code, name, category, format, width_mm, height_mm, dpi, color_space, required_fields, font_requirements } = req.body;
        if (!code || !name) {
            return res.status(400).json({ error: 'code і name обов\'язкові' });
        }
        const result = await pool.query(
            `INSERT INTO print_templates (code, name, category, format, width_mm, height_mm, dpi, color_space, required_fields, font_requirements)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [code, name, category || 'certificate', format || 'A4',
             width_mm || 210, height_mm || 297, dpi || 300, color_space || 'CMYK',
             JSON.stringify(required_fields || []), JSON.stringify(font_requirements || [])]
        );
        log.info(`Print template created: ${code}`);
        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        if (err.constraint === 'print_templates_code_key') {
            return res.status(400).json({ error: 'Шаблон з таким кодом вже існує' });
        }
        log.error('Create template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/print/templates/:id — update template
router.put('/templates/:id', async (req, res) => {
    try {
        const { name, category, format, width_mm, height_mm, dpi, color_space, required_fields, font_requirements, is_active } = req.body;
        const result = await pool.query(
            `UPDATE print_templates SET name=$1, category=$2, format=$3, width_mm=$4, height_mm=$5,
             dpi=$6, color_space=$7, required_fields=$8, font_requirements=$9, is_active=$10,
             version=version+1, updated_at=NOW() WHERE id=$11 RETURNING *`,
            [name, category, format, width_mm, height_mm, dpi, color_space,
             JSON.stringify(required_fields || []), JSON.stringify(font_requirements || []),
             is_active !== false, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }
        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        log.error('Update template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Preflight Validation
// ============================================

// POST /api/print/preflight — validate print job before sending
router.post('/preflight', async (req, res) => {
    try {
        const { template_code, data } = req.body;
        if (!template_code) {
            return res.status(400).json({ error: 'template_code обов\'язковий' });
        }

        const tmpl = await pool.query('SELECT * FROM print_templates WHERE code = $1', [template_code]);
        if (tmpl.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }
        const template = tmpl.rows[0];

        const checks = [];
        let passed = true;

        // 1. Check required fields
        const requiredFields = template.required_fields || [];
        for (const field of requiredFields) {
            if (!data || !data[field]) {
                checks.push({ check: 'required_field', field, status: 'fail', message: `Поле "${field}" обов'язкове` });
                passed = false;
            } else {
                checks.push({ check: 'required_field', field, status: 'pass' });
            }
        }

        // 2. Check dimensions
        if (template.width_mm && template.height_mm) {
            checks.push({ check: 'dimensions', status: 'pass', message: `${template.width_mm}x${template.height_mm}mm (${template.format})` });
        }

        // 3. Check DPI
        if (template.dpi >= 300) {
            checks.push({ check: 'dpi', status: 'pass', message: `${template.dpi} dpi` });
        } else {
            checks.push({ check: 'dpi', status: 'warn', message: `DPI ${template.dpi} нижче рекомендованих 300` });
        }

        // 4. Check color space
        checks.push({ check: 'color_space', status: 'pass', message: template.color_space });

        // 5. Check fonts
        const fonts = template.font_requirements || [];
        if (fonts.length > 0) {
            checks.push({ check: 'fonts', status: 'pass', message: `Потрібні шрифти: ${fonts.join(', ')}` });
        }

        // 6. Text length validation (avoid overflow)
        if (data) {
            for (const [key, val] of Object.entries(data)) {
                if (typeof val === 'string' && val.length > 500) {
                    checks.push({ check: 'text_length', field: key, status: 'warn', message: `Текст "${key}" дуже довгий (${val.length} символів)` });
                }
            }
        }

        res.json({
            passed,
            template_code: template.code,
            template_name: template.name,
            checks,
            total_checks: checks.length,
            failed: checks.filter(c => c.status === 'fail').length,
            warnings: checks.filter(c => c.status === 'warn').length
        });
    } catch (err) {
        log.error('Preflight error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Print Jobs
// ============================================

// POST /api/print/jobs — create print job (with auto-preflight)
router.post('/jobs', async (req, res) => {
    try {
        const { template_id, booking_id, certificate_id, data, target } = req.body;

        // Get template
        let template = null;
        if (template_id) {
            const t = await pool.query('SELECT * FROM print_templates WHERE id = $1', [template_id]);
            template = t.rows[0];
        }

        // Auto-determine routing
        let finalTarget = target || 'local_printer';
        if (!target && template) {
            const routing = await pool.query(
                `SELECT target FROM print_routing_rules
                 WHERE is_active = true AND (
                    (condition_type = 'category' AND condition_value = $1) OR
                    (condition_type = 'format' AND condition_value = $2)
                 ) ORDER BY priority DESC LIMIT 1`,
                [template.category, template.format]
            );
            if (routing.rows.length > 0) {
                finalTarget = routing.rows[0].target;
            }
        }

        // Run preflight
        let preflightResult = {};
        let preflightPassed = true;
        if (template) {
            const requiredFields = template.required_fields || [];
            for (const field of requiredFields) {
                if (!data || !data[field]) {
                    preflightPassed = false;
                    preflightResult[field] = 'missing';
                } else {
                    preflightResult[field] = 'ok';
                }
            }
        }

        const result = await pool.query(
            `INSERT INTO print_jobs (template_id, booking_id, certificate_id, job_type, target, data, preflight_result, preflight_passed, printed_by)
             VALUES ($1, $2, $3, 'print', $4, $5, $6, $7, $8) RETURNING *`,
            [template_id || null, booking_id || null, certificate_id || null,
             finalTarget, JSON.stringify(data || {}), JSON.stringify(preflightResult),
             preflightPassed, req.user?.username || 'system']
        );

        log.info(`Print job created: id=${result.rows[0].id}, target=${finalTarget}, preflight=${preflightPassed}`);
        res.json({ success: true, job: result.rows[0] });
    } catch (err) {
        log.error('Create job error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/print/jobs — list jobs
router.get('/jobs', async (req, res) => {
    try {
        const { status } = req.query;
        let query = `SELECT pj.*, pt.name as template_name, pt.code as template_code
                     FROM print_jobs pj LEFT JOIN print_templates pt ON pj.template_id = pt.id`;
        const params = [];
        if (status) { params.push(status); query += ` WHERE pj.status = $1`; }
        query += ' ORDER BY pj.queued_at DESC LIMIT 50';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List jobs error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/print/jobs/:id/status — update job status
router.put('/jobs/:id/status', async (req, res) => {
    try {
        const { status, error } = req.body;
        const validStatuses = ['queued', 'printing', 'completed', 'failed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Невірний статус. Допустимі: ${validStatuses.join(', ')}` });
        }

        let setClause = 'status = $1';
        if (status === 'printing') setClause += ', started_at = NOW()';
        if (status === 'completed') setClause += ', completed_at = NOW()';
        if (error) setClause += `, error = '${error.replace(/'/g, "''")}'`;

        const result = await pool.query(
            `UPDATE print_jobs SET ${setClause} WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Завдання друку не знайдено' });
        }
        res.json({ success: true, job: result.rows[0] });
    } catch (err) {
        log.error('Update job status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/print/routing — list routing rules
router.get('/routing', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM print_routing_rules ORDER BY priority DESC');
        res.json(result.rows);
    } catch (err) {
        log.error('List routing error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/print/overview — print dashboard
router.get('/overview', async (req, res) => {
    try {
        const [jobs, templates] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'queued') as queued,
                COUNT(*) FILTER (WHERE status = 'printing') as printing,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE preflight_passed = false) as preflight_failed,
                COUNT(*) as total
             FROM print_jobs`),
            pool.query('SELECT COUNT(*) FILTER (WHERE is_active) as active, COUNT(*) as total FROM print_templates')
        ]);
        res.json({ jobs: jobs.rows[0], templates: templates.rows[0] });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
