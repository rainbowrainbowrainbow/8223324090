'use strict';

// Mounted after the existing finance role, revenue-view, and finance.manage guards.
const router = require('express').Router();
const { pool } = require('../db');
const { businessContextFromRequest, requireBusinessContext } = require('../services/businessContext');
const { CostingInputError, normalizeVersion, calculatePlan } = require('../services/costingCalculator');
const { createLogger } = require('../utils/logger');
const log = createLogger('FinanceCosting');

const KINDS = new Set(['lesson', 'session', 'rental', 'service', 'agency_order', 'admission_day']);

function business(req, res) {
    const context = businessContextFromRequest(req);
    return requireBusinessContext(req, res, context) ? context : null;
}

function isoDate(value, field) {
    const text = String(value || '');
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw new CostingInputError(`${field} must be a valid YYYY-MM-DD date`);
    }
    return text;
}

function id(value, field) {
    const text = String(value || '');
    if (!/^[1-9]\d{0,17}$/.test(text)) throw new CostingInputError(`${field} must be a positive ID`);
    return text;
}

function kind(value) {
    const text = String(value || '');
    if (!KINDS.has(text)) throw new CostingInputError('Unsupported execution type');
    return text;
}

function fail(res, error, action) {
    if (error instanceof CostingInputError) return res.status(400).json({ success: false, error: error.message });
    if (error.status === 404 || error.status === 409) return res.status(error.status).json({ success: false, error: error.message });
    log.error(action, error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

async function scopedVersion(queryable, businessContext, templateId, executionDate) {
    const result = await queryable.query(
        `SELECT v.id, v.version_number, v.effective_from::text AS effective_from, v.definition,
                t.id AS template_id, t.name, t.kind
           FROM costing_templates t
           JOIN costing_template_versions v
             ON v.template_id = t.id AND v.business_context = t.business_context
          WHERE t.id = $1 AND t.business_context = $2 AND v.effective_from <= $3::date
          ORDER BY v.effective_from DESC, v.version_number DESC LIMIT 1`,
        [templateId, businessContext, executionDate]
    );
    if (!result.rowCount) {
        const error = new Error('No costing template version applies on this date');
        error.status = 404;
        throw error;
    }
    return result.rows[0];
}

router.get('/templates', async (req, res) => {
    try {
        const context = business(req, res);
        if (!context) return;
        const result = await pool.query(
            `SELECT t.id, t.name, t.kind, t.created_at,
                    v.id AS current_version_id, v.version_number, v.effective_from::text AS effective_from
               FROM costing_templates t
               LEFT JOIN LATERAL (
                   SELECT id, version_number, effective_from
                     FROM costing_template_versions
                    WHERE template_id = t.id AND business_context = t.business_context
                      AND effective_from <= CURRENT_DATE
                    ORDER BY effective_from DESC, version_number DESC LIMIT 1
               ) v ON TRUE
              WHERE t.business_context = $1
              ORDER BY t.name, t.id`, [context]
        );
        res.json({ success: true, templates: result.rows });
    } catch (error) { fail(res, error, 'GET /costing/templates'); }
});

router.get('/templates/:id', async (req, res) => {
    try {
        const context = business(req, res);
        if (!context) return;
        const templateId = id(req.params.id, 'templateId');
        const template = await pool.query('SELECT id, name, kind FROM costing_templates WHERE id = $1 AND business_context = $2', [templateId, context]);
        if (!template.rowCount) return res.status(404).json({ success: false, error: 'Template not found' });
        const versions = await pool.query(
            `SELECT id, version_number, effective_from::text AS effective_from, definition, created_at
               FROM costing_template_versions WHERE template_id = $1 AND business_context = $2
              ORDER BY version_number DESC`, [templateId, context]
        );
        res.json({ success: true, template: template.rows[0], versions: versions.rows });
    } catch (error) { fail(res, error, 'GET /costing/templates/:id'); }
});

router.post('/templates', async (req, res) => {
    let client;
    try {
        const context = business(req, res);
        if (!context) return;
        const name = String(req.body?.name || '').trim();
        if (!name || name.length > 160) throw new CostingInputError('Template name must be 1–160 characters');
        const templateKind = kind(req.body?.kind);
        const effectiveFrom = isoDate(req.body?.effectiveFrom, 'effectiveFrom');
        const definition = normalizeVersion(req.body?.definition);
        client = await pool.connect();
        await client.query('BEGIN');
        const template = await client.query(
            `INSERT INTO costing_templates (business_context, name, kind, created_by)
             VALUES ($1, $2, $3, $4) RETURNING id, name, kind`,
            [context, name, templateKind, req.user?.username || null]
        );
        const version = await client.query(
            `INSERT INTO costing_template_versions
             (business_context, template_id, version_number, effective_from, definition, created_by)
             VALUES ($1, $2, 1, $3::date, $4::jsonb, $5)
             RETURNING id, version_number, effective_from::text AS effective_from`,
            [context, template.rows[0].id, effectiveFrom, JSON.stringify(definition), req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, template: template.rows[0], version: version.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST /costing/templates');
    } finally { client?.release(); }
});

router.post('/templates/:id/versions', async (req, res) => {
    let client;
    try {
        const context = business(req, res);
        if (!context) return;
        const templateId = id(req.params.id, 'templateId');
        const effectiveFrom = isoDate(req.body?.effectiveFrom, 'effectiveFrom');
        const definition = normalizeVersion(req.body?.definition);
        client = await pool.connect();
        await client.query('BEGIN');
        const template = await client.query('SELECT id FROM costing_templates WHERE id = $1 AND business_context = $2 FOR UPDATE', [templateId, context]);
        if (!template.rowCount) {
            const error = new Error('Template not found'); error.status = 404; throw error;
        }
        const version = await client.query(
            `INSERT INTO costing_template_versions
             (business_context, template_id, version_number, effective_from, definition, created_by)
             SELECT $1::varchar(64), $2::bigint, COALESCE(MAX(version_number), 0) + 1, $3::date, $4::jsonb, $5::varchar(100)
               FROM costing_template_versions WHERE template_id = $2::bigint AND business_context = $1::varchar(64)
             RETURNING id, version_number, effective_from::text AS effective_from`,
            [context, templateId, effectiveFrom, JSON.stringify(definition), req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, version: version.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST /costing/templates/:id/versions');
    } finally { client?.release(); }
});

router.post('/preview', async (req, res) => {
    try {
        const context = business(req, res);
        if (!context) return;
        const executionDate = isoDate(req.body?.executionDate, 'executionDate');
        const version = await scopedVersion(pool, context, id(req.body?.templateId, 'templateId'), executionDate);
        const calculation = calculatePlan(version.definition, req.body?.inputs);
        res.json({ success: true, template: { id: version.template_id, name: version.name, kind: version.kind },
            version: { id: version.id, number: version.version_number, effectiveFrom: version.effective_from }, calculation });
    } catch (error) { fail(res, error, 'POST /costing/preview'); }
});

router.post('/plans', async (req, res) => {
    try {
        const context = business(req, res);
        if (!context) return;
        const executionDate = isoDate(req.body?.executionDate, 'executionDate');
        const executionLabel = String(req.body?.executionLabel || '').trim();
        if (!executionLabel || executionLabel.length > 200) throw new CostingInputError('Execution label must be 1–200 characters');
        const clientKey = String(req.body?.clientKey || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientKey)) throw new CostingInputError('clientKey must be a UUID');
        const version = await scopedVersion(pool, context, id(req.body?.templateId, 'templateId'), executionDate);
        if (req.body?.expectedVersionId && String(req.body.expectedVersionId) !== String(version.id)) {
            const error = new Error('Template version changed; preview the plan again'); error.status = 409; throw error;
        }
        const calculation = calculatePlan(version.definition, req.body?.inputs);
        const result = await pool.query(
            `INSERT INTO costing_plan_snapshots
             (business_context, template_version_id, client_key, execution_kind, execution_label,
              execution_date, inputs, result, revenue_minor, direct_cost_minor, contribution_minor, margin_bps, created_by)
             VALUES ($1, $2, $3::uuid, $4, $5, $6::date, $7::jsonb, $8::jsonb,
                     $9::bigint, $10::bigint, $11::bigint, $12, $13)
             ON CONFLICT (business_context, client_key) DO NOTHING RETURNING id`,
            [context, version.id, clientKey, version.kind, executionLabel, executionDate,
                JSON.stringify(calculation.inputs), JSON.stringify(calculation), calculation.revenueMinor,
                calculation.directCostMinor, calculation.contributionMinor, calculation.marginBps,
                req.user?.username || null]
        );
        if (!result.rowCount) return res.status(409).json({ success: false, error: 'This plan was already saved; refresh the list before retrying' });
        res.status(201).json({ success: true, planId: result.rows[0].id, versionId: version.id, calculation });
    } catch (error) { fail(res, error, 'POST /costing/plans'); }
});

router.get('/plans', async (req, res) => {
    try {
        const context = business(req, res);
        if (!context) return;
        const result = await pool.query(
            `SELECT p.id, p.execution_kind, p.execution_label, p.execution_date::text AS execution_date,
                    p.revenue_minor::text, p.direct_cost_minor::text, p.contribution_minor::text,
                    p.margin_bps, p.created_at, t.name AS template_name, v.version_number
               FROM costing_plan_snapshots p
               JOIN costing_template_versions v ON v.id = p.template_version_id AND v.business_context = p.business_context
               JOIN costing_templates t ON t.id = v.template_id AND t.business_context = p.business_context
              WHERE p.business_context = $1
              ORDER BY p.execution_date DESC, p.id DESC LIMIT 100`, [context]
        );
        res.json({ success: true, plans: result.rows });
    } catch (error) { fail(res, error, 'GET /costing/plans'); }
});

module.exports = router;
