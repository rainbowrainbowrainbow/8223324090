/**
 * routes/lines.js — Animator lines per date
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, syncScheduledAnimatorLines, ALL_ROOMS } = require('../services/booking');
const { broadcast } = require('../services/websocket');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const {
    DEFAULT_TIMELINE_CONTEXT,
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');
const {
    getTimelineDisplaySettings,
    listTimelineResources,
    resourceToLine,
    resourceTypeForDisplayMode,
    timelineResourceLinesForMode,
    syncTimelineResourcesFromLines
} = require('../services/timelineResources');

const log = createLogger('Lines');

const MAYSTERNYA_DEFAULT_LINES = [
    { id: 'md-consult-room', name: 'Олександр', color: '#0EA586', fromSheet: false, staffId: null, shiftStart: null, shiftEnd: null, shiftStatus: null, source: 'maysternya_default' }
];

function normalizeTimelineView(value) {
    return String(value || '').trim().toLowerCase() === 'rooms' ? 'rooms' : 'animators';
}

function fallbackRoomLines(businessContext) {
    const colors = ['#10B981', '#3B82F6', '#F97316', '#8B5CF6', '#06B6D4'];
    return ALL_ROOMS.map((name, index) => ({
        id: name,
        resourceId: name,
        resourceType: 'room',
        businessContext,
        name,
        shortName: name,
        color: colors[index % colors.length],
        fromSheet: false,
        staffId: null,
        shiftStart: null,
        shiftEnd: null,
        shiftStatus: null,
        source: 'rooms_fallback',
        sortOrder: index * 10
    }));
}

async function roomTimelineLinesForContext(businessContext) {
    const resources = await listTimelineResources(pool, {
        context: businessContext,
        type: 'room',
        includeInactive: false
    });
    if (resources.length) return resources.map(resourceToLine);
    return fallbackRoomLines(businessContext);
}

// All lines routes require authentication
router.use(authenticateToken);

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const timelineView = normalizeTimelineView(req.query.timelineView);
        if (timelineView === 'rooms' && businessContext === DEFAULT_TIMELINE_CONTEXT) {
            const lines = await roomTimelineLinesForContext(businessContext);
            res.set('X-Timeline-Lines-Source', lines.some(line => line.source === 'timeline_resource') ? 'timeline_resources' : 'rooms_fallback');
            res.set('X-Timeline-Resource-Type', 'room');
            res.set('X-Timeline-View', 'rooms');
            return res.json(lines);
        }
        const display = await getTimelineDisplaySettings(pool, businessContext);
        const resourceType = resourceTypeForDisplayMode(display.mode, display);
        if (resourceType) {
            const lines = await timelineResourceLinesForMode(pool, businessContext, display.mode, display);
            res.set('X-Timeline-Lines-Source', 'timeline_resources');
            res.set('X-Timeline-Resource-Type', resourceType);
            return res.json(lines || []);
        }

        const sync = businessContext === DEFAULT_TIMELINE_CONTEXT
            ? await syncScheduledAnimatorLines(date)
            : { source: 'maysternya_context' };
        const result = await pool.query(
            `SELECT
                 l.*,
                 ss.shift_start,
                 ss.shift_end,
                 ss.status AS shift_status,
                 s.id AS staff_id
             FROM lines_by_date l
             LEFT JOIN staff s ON l.line_id = s.id::text
             LEFT JOIN staff_schedule ss
                ON ss.staff_id = s.id
               AND ss.date = l.date
               AND COALESCE(ss.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
               AND ss.status IN ('working', 'remote')
             WHERE l.date = $1 AND COALESCE(l.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
             ORDER BY
                CASE WHEN ss.staff_id IS NULL THEN 1 ELSE 0 END,
                ss.shift_start NULLS LAST,
                l.id`,
            [date, businessContext]
        );
        const lines = result.rows.map(row => ({
            id: row.line_id,
            resourceId: row.line_id,
            resourceType: 'animator',
            businessContext,
            name: row.name,
            color: row.color,
            fromSheet: row.from_sheet,
            staffId: row.staff_id || null,
            shiftStart: row.shift_start || null,
            shiftEnd: row.shift_end || null,
            shiftStatus: row.shift_status || null,
            source: row.staff_id ? 'staff_schedule' : (row.from_sheet ? 'sheet' : 'manual')
        }));
        res.set('X-Timeline-Lines-Source', sync.source);
        res.json(lines.length ? lines : (businessContext === DEFAULT_TIMELINE_CONTEXT ? [] : MAYSTERNYA_DEFAULT_LINES.map(line => ({
            ...line,
            resourceId: line.id,
            resourceType: 'specialist',
            businessContext
        }))));
    } catch (err) {
        log.error('Error fetching lines', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const lines = req.body;

        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!Array.isArray(lines)) return res.status(400).json({ error: 'Lines must be an array' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'settings')) return;
        const display = await getTimelineDisplaySettings(client, businessContext);
        const resourceType = resourceTypeForDisplayMode(display.mode, display);

        if (resourceType) {
            await client.query('BEGIN');
            const resources = await syncTimelineResourcesFromLines(client, businessContext, resourceType, lines);
            await client.query('COMMIT');
            const savedLines = resources.map(resource => ({
                id: resource.resourceId,
                resourceId: resource.resourceId,
                resourceType: resource.type,
                businessContext,
                name: resource.name,
                shortName: resource.shortName,
                color: resource.color,
                capacity: resource.capacity,
                equipment: resource.equipment,
                metadata: resource.metadata,
                fromSheet: false,
                source: 'timeline_resource',
                sortOrder: resource.sortOrder
            }));
            broadcast('line:updated', { date, lines: savedLines, businessContext, resourceType }, req.user?.id?.toString(), date);
            return res.json({ success: true, resources, lines: savedLines });
        }

        await client.query('BEGIN');
        await client.query(
            `DELETE FROM lines_by_date WHERE date = $1 AND COALESCE(business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2`,
            [date, businessContext]
        );

        for (const line of lines) {
            await client.query(
                'INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet) VALUES ($1, $2, $3, $4, $5, $6)',
                [businessContext, date, line.id, line.name, line.color, line.fromSheet || false]
            );
        }

        await client.query('COMMIT');

        // WebSocket: notify other clients about line changes
        broadcast('line:updated', { date, lines, businessContext }, req.user?.id?.toString(), date);

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Error saving lines', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
