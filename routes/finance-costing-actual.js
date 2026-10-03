'use strict';

// Nested under the existing finance role, revenue-view and finance.manage guards.
const router = require('express').Router();
const { pool } = require('../db');
const { businessContextFromRequest, requireBusinessContext } = require('../services/businessContext');
const { ActualInputError, normalizeRecord, summarizeTarget, aggregateGroup } = require('../services/costingActuals');
const { previewReconciliation } = require('../services/costingReconciliation');
const { SourceLinkInputError, previewCanonicalSource } = require('../services/costingSourceLink');
const { createLogger } = require('../utils/logger');
const log = createLogger('FinanceCostingActual');

const GROUP_KINDS = new Set(['course', 'session', 'day']);

function business(req, res) {
    const context = businessContextFromRequest(req);
    return requireBusinessContext(req, res, context) ? context : null;
}

function id(raw) {
    const text = String(raw || '');
    if (!/^[1-9]\d{0,17}$/.test(text)) throw new ActualInputError('ID must be a positive integer');
    return text;
}

function field(raw, name, max, pattern = null) {
    const value = String(raw || '').trim();
    if (!value || value.length > max || (pattern && !pattern.test(value))) throw new ActualInputError(`Invalid ${name}`);
    return value;
}

function normalizeMembers(members) {
    if (!Array.isArray(members) || members.length < 1 || members.length > 200) throw new ActualInputError('Group needs 1–200 explicit members');
    const seen = new Set();
    return members.map(member => {
        if (!member || typeof member !== 'object' || Array.isArray(member) ||
            Object.keys(member).some(key => !['planId', 'includePlanRevenue', 'includePlanDirectCost'].includes(key))) {
            throw new ActualInputError('Nested groups are not supported; members must be plans');
        }
        const planId = id(member.planId);
        if (seen.has(planId) || typeof member.includePlanRevenue !== 'boolean' || typeof member.includePlanDirectCost !== 'boolean') {
            throw new ActualInputError('Each group member needs unique planId and explicit revenue/cost inclusion');
        }
        if (!member.includePlanRevenue && !member.includePlanDirectCost) {
            throw new ActualInputError('Each member must contribute revenue, cost, or both');
        }
        seen.add(planId);
        return { planId, includePlanRevenue: member.includePlanRevenue, includePlanDirectCost: member.includePlanDirectCost };
    });
}

function revisionNumber(raw) {
    if (!/^[1-9]\d*$/.test(String(raw ?? '')) || Number(raw) > 2147483646) {
        throw new ActualInputError('expectedRevision must be a positive revision number');
    }
    return Number(raw);
}

async function lockPlans(db, context, planIds) {
    const result = await db.query(
        'SELECT id FROM costing_plan_snapshots WHERE business_context=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR UPDATE',
        [context, planIds]
    );
    if (result.rowCount !== planIds.length) {
        const error = new Error('Execution not found'); error.status = 404; throw error;
    }
}

async function assertPlansAvailable(db, context, planIds, groupId = null) {
    const result = await db.query(
        `SELECT m.plan_id FROM costing_group_revision_members m
         JOIN costing_group_revisions r ON r.id=m.revision_id AND r.business_context=m.business_context
         WHERE m.business_context=$1 AND m.plan_id=ANY($2::bigint[])
           AND r.revision_number=(SELECT MAX(latest.revision_number) FROM costing_group_revisions latest WHERE latest.group_id=r.group_id)
           AND ($3::bigint IS NULL OR r.group_id<>$3::bigint) LIMIT 1`,
        [context, planIds, groupId]
    );
    if (result.rowCount) throw conflict(`Plan ${result.rows[0].plan_id} already belongs to an aggregate`);
}

async function insertRevisionMembers(db, context, revisionId, members) {
    for (const member of members) {
        await db.query(
            `INSERT INTO costing_group_revision_members
             (revision_id, plan_id, business_context, include_plan_revenue, include_plan_direct_cost)
             VALUES ($1,$2,$3,$4,$5)`,
            [revisionId, member.planId, context, member.includePlanRevenue, member.includePlanDirectCost]
        );
    }
}

function conflict(message) {
    const error = new Error(message);
    error.status = 409;
    return error;
}

function fail(res, error, action) {
    if (error instanceof ActualInputError || error instanceof SourceLinkInputError) return res.status(400).json({ success: false, error: error.message });
    if (error.status === 404 || error.status === 409) return res.status(error.status).json({ success: false, error: error.message });
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'This source or plan is already linked' });
    if (error.code === '40P01' || error.code === '40001') return res.status(409).json({ success: false, error: 'Concurrent group change; reload and retry' });
    log.error(action, error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

async function targetRow(db, context, kind, targetId, lock = false) {
    const table = kind === 'plan' ? 'costing_plan_snapshots' : 'costing_execution_groups';
    const result = await db.query(`SELECT * FROM ${table} WHERE id=$1 AND business_context=$2${lock ? ' FOR UPDATE' : ''}`, [targetId, context]);
    if (!result.rowCount) { const error = new Error('Execution not found'); error.status = 404; throw error; }
    return result.rows[0];
}

async function withReadSnapshot(run) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const value = await run(client);
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

async function evidence(db, context, kind, targetId) {
    const column = kind === 'plan' ? 'plan_id' : 'group_id';
    const sources = await db.query(`SELECT s.id, s.source_system, s.external_id, s.economic_role, s.category,
                         e.id AS entry_id, e.amount_minor::text, e.evidence_state, e.semantic, e.revision_number
                    FROM costing_actual_sources s
                    JOIN costing_actual_entries e ON e.source_id=s.id AND e.business_context=s.business_context AND e.entry_type='record'
                    LEFT JOIN costing_actual_entries reversal ON reversal.reverses_entry_id=e.id
                   WHERE s.business_context=$1 AND s.${column}=$2 AND reversal.id IS NULL
                   ORDER BY s.id`, [context, targetId]);
    const entries = await db.query(`SELECT e.id, e.source_id, e.revision_number, e.entry_type, e.amount_minor::text,
                         e.evidence_state, e.semantic, e.reason, e.reverses_entry_id, e.created_by, e.created_at,
                         s.source_system, s.external_id, s.economic_role, s.category
                    FROM costing_actual_entries e
                    JOIN costing_actual_sources s ON s.id=e.source_id AND s.business_context=e.business_context
                   WHERE s.business_context=$1 AND s.${column}=$2
                   ORDER BY e.id`, [context, targetId]);
    const completions = await db.query(`SELECT id, category, is_complete, evidence_entry_id, reason, created_by, created_at
                    FROM costing_actual_completions
                   WHERE business_context=$1 AND ${column}=$2 ORDER BY id`, [context, targetId]);
    return { sources: sources.rows, entries: entries.rows, completions: completions.rows };
}

async function detail(db, context, kind, targetId) {
    const target = await targetRow(db, context, kind, targetId);
    const data = await evidence(db, context, kind, targetId);
    const watermarks = {};
    for (const entry of data.entries) {
        if (!watermarks[entry.category] || BigInt(entry.id) > BigInt(watermarks[entry.category])) watermarks[entry.category] = entry.id;
    }
    const summary = summarizeTarget(kind === 'plan' ? target : null, data.sources, data.completions, watermarks);
    return { target, ...data, summary };
}

async function listPlan(req, res) {
    try {
        const context = business(req, res); if (!context) return;
        res.json({ success: true, ...(await withReadSnapshot(db => detail(db, context, 'plan', id(req.params.id)))) });
    } catch (error) { fail(res, error, 'GET plan actual'); }
}
router.get('/plans/:id', listPlan);
router.post('/source-links/preview', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        res.json({ success: true, preview: await previewCanonicalSource(pool, context, req.body) });
    } catch (error) { fail(res, error, 'POST canonical source preview'); }
});
router.get('/plans/:id/reconciliation', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        const data = await withReadSnapshot(db => detail(db, context, 'plan', id(req.params.id)));
        res.json({ success: true, preview: previewReconciliation(data) });
    } catch (error) { fail(res, error, 'GET reconciliation preview'); }
});

async function registerSource(req, res, kind) {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const targetId = id(req.params.id);
        const externalId = field(req.body?.externalId, 'externalId', 120, /^[a-zA-Z0-9:_-]+$/);
        const economicRole = field(req.body?.economicRole, 'economicRole', 80, /^[a-z0-9_]+$/);
        const category = field(req.body?.category, 'category', 20);
        const record = normalizeRecord(req.body, category);
        const column = kind === 'plan' ? 'plan_id' : 'group_id';
        client = await pool.connect();
        await client.query('BEGIN');
        await targetRow(client, context, kind, targetId, true);
        const inserted = await client.query(
            `INSERT INTO costing_actual_sources
             (business_context, ${column}, source_system, external_id, economic_role, category, created_by)
             VALUES ($1, $2, 'manual', $3, $4, $5, $6)
             ON CONFLICT (business_context, source_system, external_id) DO NOTHING RETURNING id`,
            [context, targetId, externalId, economicRole, category, req.user?.username || null]
        );
        if (!inserted.rowCount) {
            const existing = await client.query(
                'SELECT * FROM costing_actual_sources WHERE business_context=$1 AND source_system=$2 AND external_id=$3 FOR UPDATE',
                [context, 'manual', externalId]
            );
            const source = existing.rows[0];
            if (!source || String(source[column]) !== targetId || source.category !== category || source.economic_role !== economicRole) {
                throw conflict('Source identity is already linked to another execution or category');
            }
            const active = await client.query(
                `SELECT e.* FROM costing_actual_entries e
                 LEFT JOIN costing_actual_entries reversal ON reversal.reverses_entry_id=e.id
                 WHERE e.source_id=$1 AND e.entry_type='record' AND reversal.id IS NULL
                 ORDER BY e.revision_number DESC LIMIT 1`, [source.id]
            );
            const current = active.rows[0];
            if (!current || String(current.amount_minor) !== record.amountMinor || current.evidence_state !== record.evidenceState || current.semantic !== record.semantic) {
                throw conflict('Source already exists with different evidence; use a reasoned correction');
            }
            await client.query('COMMIT');
            return res.json({ success: true, sourceId: source.id, entryId: current.id, idempotent: true });
        }
        const entry = await client.query(
            `INSERT INTO costing_actual_entries
             (business_context, source_id, revision_number, entry_type, amount_minor, evidence_state, semantic, created_by)
             VALUES ($1, $2, 1, 'record', $3::bigint, $4, $5, $6) RETURNING id`,
            [context, inserted.rows[0].id, record.amountMinor, record.evidenceState, record.semantic, req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, sourceId: inserted.rows[0].id, entryId: entry.rows[0].id, idempotent: false });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST actual source');
    } finally { client?.release(); }
}
router.post('/plans/:id/sources', (req, res) => registerSource(req, res, 'plan'));
router.post('/groups/:id/sources', (req, res) => registerSource(req, res, 'group'));

router.post('/sources/:id/correct', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const sourceId = id(req.params.id);
        const reason = field(req.body?.reason, 'correction reason', 300);
        client = await pool.connect();
        await client.query('BEGIN');
        const sourceResult = await client.query('SELECT * FROM costing_actual_sources WHERE id=$1 AND business_context=$2', [sourceId, context]);
        if (!sourceResult.rowCount) { const error = new Error('Source not found'); error.status = 404; throw error; }
        const source = sourceResult.rows[0];
        await targetRow(client, context, source.plan_id ? 'plan' : 'group', source.plan_id || source.group_id, true);
        await client.query('SELECT id FROM costing_actual_sources WHERE id=$1 AND business_context=$2 FOR UPDATE', [sourceId, context]);
        const record = normalizeRecord(req.body, source.category);
        const currentResult = await client.query(
            `SELECT e.* FROM costing_actual_entries e LEFT JOIN costing_actual_entries reversal ON reversal.reverses_entry_id=e.id
             WHERE e.source_id=$1 AND e.entry_type='record' AND reversal.id IS NULL
             ORDER BY e.revision_number DESC LIMIT 1`, [sourceId]
        );
        if (!currentResult.rowCount) throw conflict('Source has no active evidence to correct');
        const current = currentResult.rows[0];
        const revision = current.revision_number + 1;
        await client.query(
            `INSERT INTO costing_actual_entries
             (business_context, source_id, revision_number, entry_type, amount_minor, evidence_state, semantic,
              reason, reverses_entry_id, created_by)
             VALUES ($1, $2, $3, 'reversal', $4::bigint, $5, $6, $7, $8, $9)`,
            [context, sourceId, revision, (-BigInt(current.amount_minor)).toString(), current.evidence_state,
                current.semantic, reason, current.id, req.user?.username || null]
        );
        const newEntry = await client.query(
            `INSERT INTO costing_actual_entries
             (business_context, source_id, revision_number, entry_type, amount_minor, evidence_state, semantic, reason, created_by)
             VALUES ($1, $2, $3, 'record', $4::bigint, $5, $6, $7, $8) RETURNING id`,
            [context, sourceId, revision, record.amountMinor, record.evidenceState, record.semantic, reason, req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, sourceId, entryId: newEntry.rows[0].id, revision });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST actual correction');
    } finally { client?.release(); }
});

async function complete(req, res, kind) {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const targetId = id(req.params.id);
        const category = field(req.body?.category, 'category', 20);
        if (!['revenue', 'direct_cost'].includes(category) || typeof req.body?.isComplete !== 'boolean') {
            throw new ActualInputError('category and isComplete are required');
        }
        const reason = field(req.body?.reason, 'completion reason', 300);
        client = await pool.connect();
        await client.query('BEGIN');
        await targetRow(client, context, kind, targetId, true);
        if (kind === 'group') {
            const expectedRevision = revisionNumber(req.body?.expectedRevision);
            const latest = await client.query(
                `SELECT revision_number FROM costing_group_revisions
                 WHERE group_id=$1 AND business_context=$2 ORDER BY revision_number DESC LIMIT 1`,
                [targetId, context]
            );
            if (!latest.rowCount || latest.rows[0].revision_number !== expectedRevision) {
                throw conflict('Group composition changed; reload before reconciling');
            }
        }
        const column = kind === 'plan' ? 'plan_id' : 'group_id';
        if (req.body.isComplete) {
            const estimates = await client.query(
                `SELECT COUNT(*)::int AS count FROM costing_actual_sources s
                 JOIN costing_actual_entries e ON e.source_id=s.id AND e.business_context=s.business_context AND e.entry_type='record'
                 LEFT JOIN costing_actual_entries reversal ON reversal.reverses_entry_id=e.id
                 WHERE s.business_context=$1 AND s.${column}=$2 AND s.category=$3
                   AND e.evidence_state='estimate' AND reversal.id IS NULL`, [context, targetId, category]
            );
            if (estimates.rows[0].count) throw conflict('Resolve estimated sources before marking this category complete');
        }
        const watermark = await client.query(
            `SELECT COALESCE(MAX(e.id), 0)::text AS last_entry_id FROM costing_actual_entries e
             JOIN costing_actual_sources s ON s.id=e.source_id AND s.business_context=e.business_context
             WHERE s.business_context=$1 AND s.${column}=$2 AND s.category=$3`, [context, targetId, category]
        );
        const result = await client.query(
            `INSERT INTO costing_actual_completions (business_context, ${column}, category, is_complete,
             evidence_entry_id, reason, created_by)
             VALUES ($1, $2, $3, $4, $5::bigint, $6, $7) RETURNING id`,
            [context, targetId, category, req.body.isComplete, watermark.rows[0].last_entry_id, reason, req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, completionId: result.rows[0].id });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST actual completion');
    } finally { client?.release(); }
}
router.post('/plans/:id/completions', (req, res) => complete(req, res, 'plan'));
router.post('/groups/:id/completions', (req, res) => complete(req, res, 'group'));

router.post('/groups', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const kind = field(req.body?.kind, 'group kind', 16);
        if (!GROUP_KINDS.has(kind)) throw new ActualInputError('Unsupported group kind');
        const label = field(req.body?.label, 'group label', 200);
        const normalized = normalizeMembers(req.body?.members);
        client = await pool.connect();
        await client.query('BEGIN');
        const planIds = normalized.map(member => member.planId);
        await lockPlans(client, context, planIds);
        await assertPlansAvailable(client, context, planIds);
        const group = await client.query(
            'INSERT INTO costing_execution_groups (business_context, kind, label, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
            [context, kind, label, req.user?.username || null]
        );
        const revision = await client.query(
            `INSERT INTO costing_group_revisions
             (group_id, business_context, revision_number, reason, created_by)
             VALUES ($1,$2,1,$3,$4) RETURNING id`,
            [group.rows[0].id, context, 'Initial composition', req.user?.username || null]
        );
        await insertRevisionMembers(client, context, revision.rows[0].id, normalized);
        await client.query('COMMIT');
        res.status(201).json({ success: true, groupId: group.rows[0].id, revision: 1 });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST actual group');
    } finally { client?.release(); }
});

router.post('/groups/:id/revisions', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const groupId = id(req.params.id);
        const expectedRevision = revisionNumber(req.body?.expectedRevision);
        const reason = field(req.body?.reason, 'revision reason', 240);
        const members = normalizeMembers(req.body?.members);
        client = await pool.connect();
        await client.query('BEGIN');
        await targetRow(client, context, 'group', groupId, true);
        const current = await client.query(
            'SELECT id, revision_number FROM costing_group_revisions WHERE group_id=$1 AND business_context=$2 ORDER BY revision_number DESC LIMIT 1',
            [groupId, context]
        );
        if (!current.rowCount) throw conflict('Group has no composition revision');
        if (current.rows[0].revision_number !== expectedRevision) throw conflict('Group composition changed; reload before revising');
        const previous = await client.query(
            `SELECT plan_id, include_plan_revenue, include_plan_direct_cost
             FROM costing_group_revision_members WHERE revision_id=$1 ORDER BY plan_id`, [current.rows[0].id]
        );
        const oldIds = previous.rows.map(row => String(row.plan_id));
        const newIds = members.map(member => member.planId);
        await lockPlans(client, context, [...new Set([...oldIds, ...newIds])]);
        await assertPlansAvailable(client, context, newIds, groupId);
        const prior = previous.rows.map(row => `${row.plan_id}:${row.include_plan_revenue}:${row.include_plan_direct_cost}`).sort();
        const next = members.map(member => `${member.planId}:${member.includePlanRevenue}:${member.includePlanDirectCost}`).sort();
        if (JSON.stringify(prior) === JSON.stringify(next)) throw conflict('Group composition is unchanged');
        const revisionNumberNext = expectedRevision + 1;
        const revision = await client.query(
            `INSERT INTO costing_group_revisions
             (group_id, business_context, revision_number, reason, created_by)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [groupId, context, revisionNumberNext, reason, req.user?.username || null]
        );
        await insertRevisionMembers(client, context, revision.rows[0].id, members);
        for (const category of ['revenue', 'direct_cost']) {
            await client.query(
                `INSERT INTO costing_actual_completions
                 (business_context, group_id, category, is_complete, evidence_entry_id, reason, created_by)
                 VALUES ($1,$2,$3,FALSE,0,$4,$5)`,
                [context, groupId, category, `Composition revision ${revisionNumberNext}: ${reason}`, req.user?.username || null]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ success: true, groupId, revision: revisionNumberNext });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST actual group revision');
    } finally { client?.release(); }
});

router.get('/groups', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        const result = await pool.query(
            'SELECT id, kind, label, created_at FROM costing_execution_groups WHERE business_context=$1 ORDER BY id DESC LIMIT 100', [context]
        );
        res.json({ success: true, groups: result.rows });
    } catch (error) { fail(res, error, 'GET actual groups'); }
});

router.get('/groups/:id', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        const groupId = id(req.params.id);
        const response = await withReadSnapshot(async db => {
            const own = await detail(db, context, 'group', groupId);
            const revisionRows = await db.query(
                `SELECT id, revision_number, reason, created_by, created_at
                 FROM costing_group_revisions WHERE group_id=$1 AND business_context=$2 ORDER BY revision_number`,
                [groupId, context]
            );
            const historyMembers = await db.query(
                `SELECT r.revision_number, m.plan_id, m.include_plan_revenue, m.include_plan_direct_cost
                 FROM costing_group_revisions r
                 JOIN costing_group_revision_members m ON m.revision_id=r.id AND m.business_context=r.business_context
                 WHERE r.group_id=$1 AND r.business_context=$2 ORDER BY r.revision_number, m.plan_id`,
                [groupId, context]
            );
            const history = revisionRows.rows.map(revision => ({ ...revision,
                members: historyMembers.rows.filter(member => member.revision_number === revision.revision_number) }));
            const active = revisionRows.rows.at(-1);
            if (!active) throw conflict('Group has no composition revision');
            const memberRows = await db.query(
                `SELECT m.plan_id, m.include_plan_revenue, m.include_plan_direct_cost
                   FROM costing_group_revision_members m
                  WHERE m.revision_id=$1 AND m.business_context=$2 ORDER BY m.plan_id`, [active.id, context]
            );
            const members = [];
            for (const member of memberRows.rows) {
                const plan = await detail(db, context, 'plan', member.plan_id);
                members.push({ planId: member.plan_id, include_plan_revenue: member.include_plan_revenue,
                    include_plan_direct_cost: member.include_plan_direct_cost, summary: plan.summary });
            }
            return { success: true, group: own.target, revision: active.revision_number, history,
                sources: own.sources, entries: own.entries, completions: own.completions,
                members, summary: aggregateGroup(members, own.summary) };
        });
        res.json(response);
    } catch (error) { fail(res, error, 'GET actual group'); }
});

module.exports = router;
