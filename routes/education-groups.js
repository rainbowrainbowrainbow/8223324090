'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken, requireAction } = require('../middleware/auth');
const { timelineContextFromRequest, requireTimelineContext, requireTimelineAction } = require('../services/timelineContext');
const groups = require('../services/educationGroups');
const { createLogger } = require('../utils/logger');
const log = createLogger('EducationGroups');

router.use(authenticateToken);

function context(req, res, action = 'view') {
    const selected = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, selected)) return null;
    if (action !== 'view' && !requireTimelineAction(req, res, selected, action)) return null;
    return selected;
}

function handle(res, error) {
    if (!(error instanceof groups.EducationGroupError)) log.error('Education group request failed', error);
    res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Internal server error' });
}

router.get('/', async (req, res) => {
    const business = context(req, res);
    if (!business) return;
    try {
        res.json({ success: true, groups: await groups.listGroups(business, req.query.includeArchived === 'true') });
    } catch (error) { handle(res, error); }
});

router.get('/children/search', async (req, res) => {
    const business = context(req, res);
    if (!business) return;
    const search = String(req.query.q || '').trim();
    if (search.length < 2 || search.length > 100) return res.status(400).json({ error: 'Enter 2–100 characters' });
    try {
        const result = await pool.query(
            `SELECT cc.id, cc.name, cc.customer_id, c.name AS parent_name
             FROM customer_children cc JOIN customers c ON c.id = cc.customer_id
             WHERE cc.business_context = $1 AND COALESCE(c.business_context, 'event_genix') = $1
               AND (cc.name ILIKE $2 OR c.name ILIKE $2)
             ORDER BY cc.name, cc.id LIMIT 30`,
            [business, `%${search.replace(/[\\%_]/g, '\\$&')}%`]
        );
        res.json({ success: true, children: result.rows });
    } catch (error) { handle(res, error); }
});

router.get('/:id', async (req, res) => {
    const business = context(req, res);
    if (!business) return;
    try {
        res.json({ success: true, group: await groups.getGroup(business, req.params.id) });
    } catch (error) { handle(res, error); }
});

router.post('/', requireAction('create_booking'), async (req, res) => {
    const business = context(req, res, 'create');
    if (!business) return;
    try {
        res.status(201).json({ success: true, group: await groups.saveGroup(business, req.body || {}) });
    } catch (error) { handle(res, error); }
});

router.put('/:id', requireAction('edit_booking'), async (req, res) => {
    const business = context(req, res, 'edit');
    if (!business) return;
    try {
        res.json({ success: true, group: await groups.saveGroup(business, req.body || {}, req.params.id) });
    } catch (error) { handle(res, error); }
});

router.post('/:id/archive', requireAction('delete_booking'), async (req, res) => {
    const business = context(req, res, 'delete');
    if (!business) return;
    try {
        res.json({ success: true, group: await groups.archiveGroup(business, req.params.id) });
    } catch (error) { handle(res, error); }
});

router.post('/:id/members', requireAction('edit_booking'), async (req, res) => {
    const business = context(req, res, 'edit');
    if (!business) return;
    try {
        res.status(201).json({ success: true, member: await groups.enrollChild(business, req.params.id, req.body || {}) });
    } catch (error) { handle(res, error); }
});

router.post('/:id/members/:memberId/end', requireAction('edit_booking'), async (req, res) => {
    const business = context(req, res, 'edit');
    if (!business) return;
    try {
        res.json({ success: true, member: await groups.endMembership(business, req.params.id, req.params.memberId, req.body?.endDate) });
    } catch (error) { handle(res, error); }
});

module.exports = router;
