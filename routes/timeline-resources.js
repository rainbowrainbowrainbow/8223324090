'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { logAdminAction } = require('../services/adminAudit');
const {
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');
const {
    normalizeResourceType,
    listTimelineResources,
    upsertTimelineResource,
    deleteTimelineResource,
    timelineResourceAvailability
} = require('../services/timelineResources');
const { validateDate, validateTime } = require('../services/booking');

const log = createLogger('TimelineResources');

router.use(authenticateToken);

router.get('/resources', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, context)) return;
        const type = req.query.type ? normalizeResourceType(req.query.type) : null;
        const includeInactive = req.query.includeInactive === 'true' || req.query.include_inactive === 'true';
        const resources = await listTimelineResources(pool, {
            context,
            type,
            includeInactive,
            ensureDefault: Boolean(type)
        });
        res.json({ context, type, resources });
    } catch (err) {
        log.error('GET /timeline/resources error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/resources', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineAction(req, res, context, 'settings')) return;
        const resource = await upsertTimelineResource(pool, context, req.body || {});
        logAdminAction('timeline_resource_upsert', 'timeline_resources', {
            username: req.user?.username,
            target: resource.resourceId,
            details: { context, type: resource.type, name: resource.name },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.status(201).json({ success: true, context, resource });
    } catch (err) {
        log.error('POST /timeline/resources error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    }
});

router.put('/resources/:resourceId', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineAction(req, res, context, 'settings')) return;
        const resource = await upsertTimelineResource(pool, context, {
            ...(req.body || {}),
            resourceId: req.params.resourceId
        });
        logAdminAction('timeline_resource_update', 'timeline_resources', {
            username: req.user?.username,
            target: resource.resourceId,
            details: { context, type: resource.type, name: resource.name, isActive: resource.isActive },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.json({ success: true, context, resource });
    } catch (err) {
        log.error('PUT /timeline/resources/:resourceId error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    }
});

router.delete('/resources/:resourceId', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineAction(req, res, context, 'settings')) return;
        const resource = await deleteTimelineResource(pool, context, req.params.resourceId);
        if (!resource) return res.status(404).json({ error: 'Resource not found' });
        logAdminAction('timeline_resource_disable', 'timeline_resources', {
            username: req.user?.username,
            target: resource.resourceId,
            details: { context, type: resource.type, name: resource.name },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.json({ success: true, context, resource });
    } catch (err) {
        log.error('DELETE /timeline/resources/:resourceId error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/resources/availability', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, context)) return;
        const { date, time } = req.query;
        if (!validateDate(String(date || ''))) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(String(time || ''))) return res.status(400).json({ error: 'Invalid time' });
        const payload = await timelineResourceAvailability(pool, {
            context,
            type: req.query.type || 'cabinet',
            date,
            time,
            duration: req.query.duration || 60
        });
        res.json(payload);
    } catch (err) {
        log.error('GET /timeline/resources/availability error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
