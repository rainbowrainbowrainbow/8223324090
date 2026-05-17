/**
 * routes/task-templates.js — Recurring task templates CRUD (v7.9)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const {
    VALID_TASK_CATEGORIES,
    normalizeTaskCategory,
    normalizeTaskSubcategory,
    normalizeChecklistTemplateKey,
    normalizeOwnerRole,
    normalizeSlaMinutes
} = require('../services/taskTaxonomy');

const log = createLogger('TaskTemplates');

// All task-templates routes require authentication
router.use(authenticateToken);

const VALID_PATTERNS = ['daily', 'weekly', 'weekdays', 'custom'];
const VALID_PRIORITIES = ['low', 'normal', 'high'];
const VALID_CATEGORIES = VALID_TASK_CATEGORIES;
const VALID_TASK_KINDS = ['action', 'reminder', 'followup', 'deep_work', 'checklist', 'routine', 'waiting', 'idea', 'decision'];

function mapTemplateRow(row) {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        category: row.category || 'admin',
        subcategory: row.subcategory || null,
        defaultTaskKind: row.default_task_kind || 'action',
        checklistTemplateKey: row.checklist_template_key || null,
        ownerRole: row.owner_role || null,
        slaMinutes: row.sla_minutes || null,
        assignedTo: row.assigned_to,
        recurrencePattern: row.recurrence_pattern,
        recurrenceDays: row.recurrence_days,
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at
    };
}

// GET /api/task-templates
router.get('/', async (req, res) => {
    try {
        const { active } = req.query;
        let query = 'SELECT * FROM task_templates';
        const params = [];
        if (active === 'true') {
            query += ' WHERE is_active = true';
        }
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows.map(mapTemplateRow));
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/task-templates
router.post('/', async (req, res) => {
    try {
        const { title, description, priority, category, subcategory, assignedTo, recurrencePattern, recurrenceDays } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (!VALID_PATTERNS.includes(recurrencePattern)) {
            return res.status(400).json({ error: 'Invalid recurrence pattern' });
        }
        if (recurrencePattern === 'custom' && !recurrenceDays) {
            return res.status(400).json({ error: 'recurrenceDays required for custom pattern' });
        }

        const templatePriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const templateCategory = normalizeTaskCategory(category, 'admin');
        const templateSubcategory = normalizeTaskSubcategory(templateCategory, subcategory);
        const defaultTaskKind = VALID_TASK_KINDS.includes(req.body.defaultTaskKind || req.body.default_task_kind)
            ? (req.body.defaultTaskKind || req.body.default_task_kind)
            : (templateCategory === 'checklist' ? 'checklist' : 'action');
        const checklistTemplateKey = templateCategory === 'checklist'
            ? normalizeChecklistTemplateKey(req.body.checklistTemplateKey || req.body.checklist_template_key, templateSubcategory)
            : null;
        const ownerRole = normalizeOwnerRole(req.body.ownerRole || req.body.owner_role);
        const slaMinutes = normalizeSlaMinutes(req.body.slaMinutes || req.body.sla_minutes);
        const username = req.user?.username || 'system';

        const result = await pool.query(
            `INSERT INTO task_templates (title, description, priority, category, subcategory, assigned_to,
             recurrence_pattern, recurrence_days, created_by, default_task_kind, checklist_template_key, owner_role, sla_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [title.trim(), description || null, templatePriority, templateCategory, templateSubcategory, assignedTo || null,
             recurrencePattern, recurrenceDays || null, username, defaultTaskKind,
             checklistTemplateKey, ownerRole, slaMinutes]
        );
        res.json({ success: true, template: mapTemplateRow(result.rows[0]) });
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/task-templates/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, priority, category, subcategory, assignedTo, recurrencePattern, recurrenceDays, isActive } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (!VALID_PATTERNS.includes(recurrencePattern)) {
            return res.status(400).json({ error: 'Invalid recurrence pattern' });
        }

        const templatePriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const templateCategory = normalizeTaskCategory(category, 'admin');
        const templateSubcategory = normalizeTaskSubcategory(templateCategory, subcategory);
        const defaultTaskKind = VALID_TASK_KINDS.includes(req.body.defaultTaskKind || req.body.default_task_kind)
            ? (req.body.defaultTaskKind || req.body.default_task_kind)
            : (templateCategory === 'checklist' ? 'checklist' : 'action');
        const checklistTemplateKey = templateCategory === 'checklist'
            ? normalizeChecklistTemplateKey(req.body.checklistTemplateKey || req.body.checklist_template_key, templateSubcategory)
            : null;
        const ownerRole = normalizeOwnerRole(req.body.ownerRole || req.body.owner_role);
        const slaMinutes = normalizeSlaMinutes(req.body.slaMinutes || req.body.sla_minutes);

        await pool.query(
            `UPDATE task_templates SET title=$1, description=$2, priority=$3, category=$4, subcategory=$5, assigned_to=$6,
             recurrence_pattern=$7, recurrence_days=$8, is_active=$9, default_task_kind=$10,
             checklist_template_key=$11, owner_role=$12, sla_minutes=$13 WHERE id=$14`,
            [title.trim(), description || null, templatePriority, templateCategory, templateSubcategory, assignedTo || null,
             recurrencePattern, recurrenceDays || null, isActive !== false,
             defaultTaskKind, checklistTemplateKey, ownerRole, slaMinutes, id]
        );
        const updated = await pool.query('SELECT * FROM task_templates WHERE id = $1', [id]);
        if (updated.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ success: true, template: mapTemplateRow(updated.rows[0]) });
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/task-templates/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM task_templates WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
