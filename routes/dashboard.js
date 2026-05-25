/**
 * routes/dashboard.js — Dashboard API (v24.3.0)
 * User dashboard config, widget data, /today aggregate, weather/currency cache
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, ROLE_LEVEL } = require('../middleware/auth');
const { getDefaultWidgets, canAccessDashboardWidget } = require('../config/roles');
const { createLogger } = require('../utils/logger');
const { getKyivDateStr } = require('../services/booking');
const { buildTaskVisibilityScope, normalizeUserId, taskOwnerState, userNameTokens } = require('../services/taskPolicy');
const { normalizeSubtaskSummary } = require('../services/taskSubtasks');
const { buildTaskOperationsSummary, deriveTaskIntelligence } = require('../services/taskIntelligence');
const { getOnlineUserIds } = require('../services/websocket');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { buildWorkQueue } = require('../services/workQueue');
const { getOmniAccountAlertsAsync } = require('../services/omni-accounts');

const log = createLogger('Dashboard');

// All routes require authentication
router.use(authenticateToken);

function buildOwnTaskFilter(user, params, alias = 't') {
    const userId = normalizeUserId(user);
    const typed = userId ? `${alias}.owner_user_id = $${params.push(userId)}` : 'FALSE';
    const tokenRefs = userNameTokens(user).map(token => `$${params.push(token)}`);
    const legacy = tokenRefs.length
        ? `(${alias}.owner_user_id IS NULL AND (${alias}.assigned_to IN (${tokenRefs.join(',')}) OR ${alias}.owner IN (${tokenRefs.join(',')})))`
        : 'FALSE';
    return `AND (${typed} OR ${legacy})`;
}

const TASK_WIDGET_SUBTASK_SELECT = `
                           COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                           COALESCE(st.total, 0)::int AS subtask_count,
                           COALESCE(st.done, 0)::int AS subtask_done_count`;

const TASK_WIDGET_SUBTASK_JOINS = `
                    LEFT JOIN (
                        SELECT task_id,
                               COUNT(*)::int AS total,
                               COUNT(*) FILTER (WHERE is_done = true)::int AS done
                        FROM task_subtasks
                        GROUP BY task_id
                    ) st ON st.task_id = t.id
                    LEFT JOIN (
                        SELECT task_id,
                               json_agg(json_build_object(
                                   'id', id,
                                   'task_id', task_id,
                                   'title', title,
                                   'is_done', is_done,
                                   'sort_order', sort_order,
                                   'source_type', COALESCE(source_type, 'manual'),
                                   'created_at', created_at,
                                   'completed_at', completed_at,
                                   'updated_at', updated_at
                               ) ORDER BY sort_order ASC, id ASC) AS subtasks
                        FROM task_subtasks
                        GROUP BY task_id
                    ) subtask_rows ON subtask_rows.task_id = t.id`;

function taskWidgetPayload(rows = []) {
    return rows.map(row => {
        const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
        const ownerState = taskOwnerState(row);
        const subtaskSummary = normalizeSubtaskSummary(row);
        return {
            ...row,
            ownerLabel,
            ownerState,
            ownerUserId: row.owner_user_id || null,
            subtasks: subtaskSummary.subtasks,
            subtask_count: subtaskSummary.subtaskCount,
            subtask_done_count: subtaskSummary.subtaskDoneCount,
            subtaskCount: subtaskSummary.subtaskCount,
            subtaskDoneCount: subtaskSummary.subtaskDoneCount,
            subtaskProgress: subtaskSummary.subtaskProgress,
            subtaskProgressPercent: subtaskSummary.subtaskProgressPercent,
            intelligence: deriveTaskIntelligence({ ...row, owner_label: ownerLabel, ownerState })
        };
    });
}

const TASKER_DONE_STATUSES = new Set(['done', 'completed', 'complete']);
const TASKER_CLOSED_STATUSES = new Set(['done', 'completed', 'complete', 'cancelled', 'archived']);

function normalizeTaskStatus(value) {
    return String(value || 'todo').trim().toLowerCase();
}

function isTaskerClosed(row = {}) {
    return TASKER_CLOSED_STATUSES.has(normalizeTaskStatus(row.status));
}

function isTaskerOverdue(row = {}) {
    if (!row.deadline || isTaskerClosed(row)) return false;
    const deadline = new Date(row.deadline);
    return !Number.isNaN(deadline.getTime()) && deadline.getTime() < Date.now();
}

function isTaskerDoneToday(row = {}) {
    if (!TASKER_DONE_STATUSES.has(normalizeTaskStatus(row.status))) return false;
    const completedAt = row.completed_at || row.updated_at;
    if (!completedAt) return false;
    const completed = new Date(completedAt);
    if (Number.isNaN(completed.getTime())) return false;
    return completed.toISOString().slice(0, 10) === getKyivDateStr();
}

function matchesTaskerUserIdentity(row = {}, user, fields = []) {
    const userId = normalizeUserId(user);
    if (userId && fields.some(field => Number(row[field] || 0) === userId)) return true;
    const tokens = new Set(userNameTokens(user).map(token => String(token || '').trim().toLowerCase()).filter(Boolean));
    if (!tokens.size) return false;
    return fields.some(field => {
        const value = String(row[field] || '').trim().toLowerCase();
        return value && tokens.has(value);
    });
}

function taskerStats(tasks = []) {
    const total = tasks.length;
    const done = tasks.filter(task => TASKER_DONE_STATUSES.has(normalizeTaskStatus(task.status))).length;
    const active = tasks.filter(task => !isTaskerClosed(task)).length;
    const todo = tasks.filter(task => normalizeTaskStatus(task.status) === 'todo').length;
    const inProgress = tasks.filter(task => normalizeTaskStatus(task.status) === 'in_progress').length;
    const doneToday = tasks.filter(isTaskerDoneToday).length;
    const overdue = tasks.filter(isTaskerOverdue).length;
    return {
        total,
        active,
        todo,
        inProgress,
        done,
        doneToday,
        overdue,
        completionRate: total ? Math.round((done / total) * 100) : 0
    };
}

function buildPersonalTaskerPayload(rows = [], user) {
    const payloadTasks = taskWidgetPayload(rows).map((task, index) => ({
        ...task,
        creatorLabel: rows[index]?.creator_name || rows[index]?.creator_username || rows[index]?.created_by || null,
        createdByUserId: rows[index]?.created_by_user_id || null,
        isOverdue: isTaskerOverdue(rows[index] || task),
        completedAt: rows[index]?.completed_at || null
    }));
    const byId = new Map(payloadTasks.map(task => [String(task.id), task]));
    const assignedRows = rows.filter(row => matchesTaskerUserIdentity(row, user, ['owner_user_id', 'assigned_to', 'owner']));
    const createdRows = rows.filter(row => matchesTaskerUserIdentity(row, user, ['created_by_user_id', 'created_by', 'creator_username', 'creator_name']));
    const assigned = assignedRows.map(row => byId.get(String(row.id))).filter(Boolean);
    const created = createdRows.map(row => byId.get(String(row.id))).filter(Boolean);
    const allStats = taskerStats(rows);
    return {
        scope: 'creator',
        currentUser: {
            id: normalizeUserId(user),
            username: user?.username || null,
            name: user?.name || user?.username || null
        },
        views: {
            assigned_to_me: { label: 'Мені', tasks: assigned, stats: taskerStats(assignedRows) },
            created_by_me: { label: 'Поставив', tasks: created, stats: taskerStats(createdRows) },
            all_tasks: { label: 'Всі', tasks: payloadTasks, stats: allStats }
        },
        stats: allStats,
        achievements: [
            { key: 'done_today', label: 'Готово сьогодні', value: allStats.doneToday, tone: allStats.doneToday > 0 ? 'success' : 'quiet' },
            { key: 'overdue_guard', label: allStats.overdue === 0 ? 'Без прострочки' : 'Прострочено', value: allStats.overdue, tone: allStats.overdue === 0 ? 'success' : 'warning' },
            { key: 'completion_rate', label: 'Закриття', value: `${allStats.completionRate}%`, tone: allStats.completionRate >= 70 ? 'success' : 'info' }
        ],
        meta: {
            creatorOnly: true,
            views: ['assigned_to_me', 'created_by_me', 'all_tasks'],
            dataSource: 'tasks + task visibility policy'
        }
    };
}

function addDays(dateStr, days) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function countFrom(result) {
    return parseInt(result?.rows?.[0]?.count || 0, 10) || 0;
}

const BOARD_SCHEMA_VERSION = 1;
const BOARD_MAX_ITEMS = 120;
const BOARD_MAX_DRAWINGS = 500;
const BOARD_ALLOWED_TYPES = new Set(['widget', 'note', 'text', 'shape', 'frame', 'space']);
const BOARD_ALLOWED_WIDGET_DEPTHS = new Set(['live-compact', 'headline-only', 'snapshot-static']);
const BOARD_WIDGET_DEPTH_ALIASES = {
    'live-expanded': 'live-compact',
    'snapshot-card': 'snapshot-static'
};
const BOARD_ALLOWED_TOOLS = new Set(['select', 'hand', 'brush', 'highlighter', 'eraser', 'connector', 'note', 'text', 'frame', 'space', 'widget', 'line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
const BOARD_DRAW_TOOLS = new Set(['brush', 'highlighter']);
const BOARD_ALLOWED_SHAPES = new Set(['line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
const BOARD_ALLOWED_CONNECTOR_STYLES = new Set(['line', 'arrow', 'curve']);
const BOARD_ALLOWED_RELATION_TYPES = new Set(['idea', 'depends', 'blocks', 'feeds', 'inspires']);
const BOARD_CONTENT_TONES = new Set(['idea', 'production', 'approved', 'blocked', 'story']);
const DASHBOARD_WORKSPACE_MODE = 'workspace';
const BOARD_SNAP_MODES = new Set(['strict', 'soft', 'freeform']);
const DASHBOARD_CONFIG_PERSISTENCE = Object.freeze({
    source: 'postgres',
    table: 'dashboard_configs',
    endpoint: '/api/dashboard/config',
    boardStatePath: 'layout.boardState'
});
const DASHBOARD_CONFIG_SELECT_SQL = `SELECT layout, widgets, theme FROM ${DASHBOARD_CONFIG_PERSISTENCE.table} WHERE user_id = $1`;
const DASHBOARD_CONFIG_UPSERT_SQL = `
            INSERT INTO ${DASHBOARD_CONFIG_PERSISTENCE.table} (user_id, layout, widgets, theme, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET layout = $2, widgets = $3, theme = $4, updated_at = NOW()
        `;

function parseJsonObject(value, fallback = {}) {
    if (!value) return { ...fallback };
    if (typeof value === 'object' && !Array.isArray(value)) return { ...fallback, ...value };
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return { ...fallback, ...parsed };
            }
        } catch {}
    }
    return { ...fallback };
}

function safeNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizeBoardTool(value) {
    return BOARD_ALLOWED_TOOLS.has(value) ? value : 'select';
}

function normalizeBoardWidgetDepth(value) {
    const depth = String(value || '').trim();
    if (BOARD_ALLOWED_WIDGET_DEPTHS.has(depth)) return depth;
    return BOARD_WIDGET_DEPTH_ALIASES[depth] || 'live-compact';
}

function normalizeBoardShape(value) {
    return BOARD_ALLOWED_SHAPES.has(value) ? value : 'rect';
}

function normalizeBoardTone(value) {
    const tone = String(value || '').trim();
    return BOARD_CONTENT_TONES.has(tone) ? tone : '';
}

function isBoardEquilateralShape(shape) {
    return shape === 'circle' || shape === 'square';
}

function normalizeBoardShapeDimensions(shape, width, height) {
    if (!isBoardEquilateralShape(shape)) return { w: width, h: height };
    const size = safeNumber(Math.max(Number(width || 0), Number(height || 0)), 150, 80, 900);
    return { w: size, h: size };
}

function normalizeBoardConnectorStyle(value) {
    return BOARD_ALLOWED_CONNECTOR_STYLES.has(value) ? value : 'arrow';
}

function normalizeBoardRelationType(value) {
    return BOARD_ALLOWED_RELATION_TYPES.has(value) ? value : 'idea';
}

function normalizeBoardSnapMode(value) {
    return BOARD_SNAP_MODES.has(value) ? value : 'freeform';
}

function sanitizeBoardStroke(stroke, index = 0) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length < 2) return null;
    const tool = normalizeBoardTool(stroke.tool);
    if (!BOARD_DRAW_TOOLS.has(tool)) return null;
    const points = stroke.points
        .slice(0, 2000)
        .map(point => {
            if (!Array.isArray(point) || point.length < 2) return null;
            return [
                safeNumber(point[0], 0, -10000, 10000),
                safeNumber(point[1], 0, -10000, 10000)
            ];
        })
        .filter(Boolean);
    if (points.length < 2) return null;
    return {
        id: String(stroke.id || `stroke-${Date.now()}-${index}`).slice(0, 90),
        tool,
        color: String(stroke.color || (tool === 'highlighter' ? '#f59e0b' : '#10b981')).slice(0, 32),
        width: safeNumber(stroke.width, tool === 'highlighter' ? 12 : 2, 1, 24),
        opacity: safeNumber(stroke.opacity, tool === 'highlighter' ? 0.34 : 0.9, 0.05, 1),
        points
    };
}

function sanitizeBoardConnector(connector, index = 0) {
    if (!connector || typeof connector !== 'object') return null;
    const from = parseJsonObject(connector.from, {});
    const to = parseJsonObject(connector.to, {});
    const fromItemId = String(from.itemId || '').slice(0, 90);
    const toItemId = String(to.itemId || '').slice(0, 90);
    if (!fromItemId || !toItemId || fromItemId === toItemId) return null;
    return {
        id: String(connector.id || `conn-${Date.now()}-${index}`).slice(0, 90),
        from: {
            itemId: fromItemId,
            anchor: ['top', 'right', 'bottom', 'left'].includes(from.anchor) ? from.anchor : 'right'
        },
        to: {
            itemId: toItemId,
            anchor: ['top', 'right', 'bottom', 'left'].includes(to.anchor) ? to.anchor : 'left'
        },
        style: normalizeBoardConnectorStyle(connector.style),
        relationType: normalizeBoardRelationType(connector.relationType),
        color: String(connector.color || '#94a3b8').slice(0, 32),
        width: safeNumber(connector.width, 2, 1, 8),
        label: String(connector.label || '').slice(0, 80)
    };
}

function defaultBoardMeta(overrides = {}) {
    return {
        version: BOARD_SCHEMA_VERSION,
        enabled: true,
        lastSavedAt: null,
        dirty: false,
        privacy: 'private',
        collaboration: 'personal',
        ...overrides,
        version: BOARD_SCHEMA_VERSION,
        dirty: false,
        privacy: 'private',
        collaboration: 'personal'
    };
}

function defaultBoardState(overrides = {}) {
    return {
        schemaVersion: BOARD_SCHEMA_VERSION,
        viewport: { x: 0, y: 0, zoom: 1 },
        items: [],
        drawings: [],
        connectors: [],
        activeTool: 'select',
        preferences: {
            snapToGrid: false,
            snapMode: 'freeform',
            showGrid: true,
            showGuides: true,
            showPlanner: true,
            showMiniMap: false,
            maxLiveWidgets: 18,
            strokeColor: '#10b981',
            fillColor: 'rgba(16, 185, 129, 0.10)',
            strokeWidth: 2,
            connectorStyle: 'arrow',
            relationType: 'idea'
        },
        ...overrides
    };
}

function sanitizeBoardItem(item, role) {
    if (!item || typeof item !== 'object') return null;
    const rawType = String(item.type || item.kind || '').trim();
    const inferredType = rawType || (item.noteText || item.content || item.body || item.label ? 'note' : '');
    const type = BOARD_ALLOWED_TYPES.has(inferredType) ? inferredType : null;
    if (!type) return null;
    const id = String(item.id || '').trim().slice(0, 80);
    if (!id) return null;
    const safe = {
        id,
        type,
        x: safeNumber(item.x, 40, -10000, 10000),
        y: safeNumber(item.y, 40, -10000, 10000),
        w: safeNumber(item.w, type === 'widget' ? 320 : 220, 80, 1200),
        h: safeNumber(item.h, type === 'widget' ? 220 : 120, 60, 900),
        z: safeNumber(item.z, 1, 0, 9999),
        locked: item.locked === true,
        hidden: item.hidden === true
    };

    if (type === 'widget') {
        const widgetType = String(item.widgetType || item.widget || '').trim();
        if (!widgetType || canAccessDashboardWidget(role, widgetType, ROLE_LEVEL) === false) return null;
        safe.widgetType = widgetType;
        safe.depth = normalizeBoardWidgetDepth(item.depth);
        safe.title = String(item.title || '').slice(0, 120);
    } else {
        const legacyText = item.text ?? item.content ?? item.body ?? item.noteText ?? item.label ?? '';
        safe.text = String(legacyText || '').slice(0, 5000);
        safe.title = String(item.title || item.label || '').slice(0, 120);
        safe.color = String(item.color || '').slice(0, 40);
        safe.tone = normalizeBoardTone(item.tone);
        safe.shape = normalizeBoardShape(item.shape || 'rect');
        if (type === 'shape') {
            const dimensions = normalizeBoardShapeDimensions(safe.shape, safe.w, safe.h);
            safe.w = dimensions.w;
            safe.h = dimensions.h;
        }
        if (type === 'space') {
            safe.zoneId = String(item.zoneId || '').slice(0, 80);
            safe.zoneKind = String(item.zoneKind || 'reserved').slice(0, 40);
        }
    }

    return safe;
}

function sanitizeBoardState(input, role) {
    const source = parseJsonObject(input, {});
    const viewportSource = parseJsonObject(source.viewport, {});
    const preferencesSource = parseJsonObject(source.preferences, {});
    const items = Array.isArray(source.items)
        ? source.items.slice(0, BOARD_MAX_ITEMS).map(item => sanitizeBoardItem(item, role)).filter(Boolean)
        : [];
    const drawings = Array.isArray(source.drawings)
        ? source.drawings.slice(0, BOARD_MAX_DRAWINGS).map(sanitizeBoardStroke).filter(Boolean)
        : [];
    const itemIds = new Set(items.map(item => item.id));
    const connectors = Array.isArray(source.connectors)
        ? source.connectors.slice(0, 300).map(sanitizeBoardConnector).filter(Boolean)
            .filter(connector => itemIds.has(connector.from.itemId) && itemIds.has(connector.to.itemId))
        : [];

    return defaultBoardState({
        schemaVersion: BOARD_SCHEMA_VERSION,
        viewport: {
            x: safeNumber(viewportSource.x, 0, -10000, 10000),
            y: safeNumber(viewportSource.y, 0, -10000, 10000),
            zoom: safeNumber(viewportSource.zoom, 1, 0.25, 2)
        },
        items,
        drawings,
        connectors,
        activeTool: normalizeBoardTool(source.activeTool),
        preferences: {
            snapToGrid: normalizeBoardSnapMode(preferencesSource.snapToGrid === false ? 'freeform' : preferencesSource.snapMode || (preferencesSource.snapToGrid === true ? 'soft' : 'freeform')) !== 'freeform' && preferencesSource.snapToGrid !== false,
            snapMode: normalizeBoardSnapMode(preferencesSource.snapToGrid === false ? 'freeform' : preferencesSource.snapMode || (preferencesSource.snapToGrid === true ? 'soft' : 'freeform')),
            showGrid: preferencesSource.showGrid !== false,
            showGuides: preferencesSource.showGuides !== false,
            showPlanner: preferencesSource.showPlanner !== false,
            showMiniMap: preferencesSource.showMiniMap === true,
            maxLiveWidgets: safeNumber(preferencesSource.maxLiveWidgets, 18, 1, 24),
            strokeColor: String(preferencesSource.strokeColor || '#10b981').slice(0, 32),
            fillColor: String(preferencesSource.fillColor || 'rgba(16, 185, 129, 0.10)').slice(0, 64),
            strokeWidth: safeNumber(preferencesSource.strokeWidth, 2, 1, 12),
            connectorStyle: normalizeBoardConnectorStyle(preferencesSource.connectorStyle),
            relationType: normalizeBoardRelationType(preferencesSource.relationType)
        }
    });
}

function normalizeDashboardMode() {
    return DASHBOARD_WORKSPACE_MODE;
}

function normalizeDashboardConfig(raw, role) {
    const layout = parseJsonObject(raw?.layout, {});
    const mode = normalizeDashboardMode(raw?.mode || layout.mode);
    const boardMeta = defaultBoardMeta(parseJsonObject(raw?.boardMeta || layout.boardMeta, {}));
    const boardState = sanitizeBoardState(raw?.boardState || layout.boardState, role);
    return {
        layout: {
            ...layout,
            mode,
            boardMeta,
            boardState
        },
        widgets: Array.isArray(raw?.widgets)
            ? raw.widgets.filter(type => canAccessDashboardWidget(role, type, ROLE_LEVEL) !== false)
            : [],
        theme: raw?.theme || 'default',
        mode,
        boardMeta,
        boardState
    };
}

function buildPersistedDashboardConfig(existingRaw, body, role) {
    const existing = normalizeDashboardConfig(existingRaw || {}, role);
    const incomingLayout = body && Object.prototype.hasOwnProperty.call(body, 'layout')
        ? parseJsonObject(body.layout, {})
        : {};
    const mode = normalizeDashboardMode(body?.mode || incomingLayout.mode || existing.mode);
    const boardMeta = defaultBoardMeta({
        ...existing.boardMeta,
        ...parseJsonObject(incomingLayout.boardMeta, {}),
        ...parseJsonObject(body?.boardMeta, {}),
        lastSavedAt: body?.boardMeta?.lastSavedAt || incomingLayout.boardMeta?.lastSavedAt || new Date().toISOString()
    });
    const boardState = body && (Object.prototype.hasOwnProperty.call(body, 'boardState') || incomingLayout.boardState)
        ? sanitizeBoardState(body.boardState || incomingLayout.boardState, role)
        : existing.boardState;
    const widgets = Array.isArray(body?.widgets)
        ? body.widgets.filter(type => canAccessDashboardWidget(role, type, ROLE_LEVEL) !== false)
        : existing.widgets;
    const layout = {
        ...existing.layout,
        ...incomingLayout,
        mode,
        boardMeta,
        boardState
    };

    return {
        layout,
        widgets,
        theme: body?.theme || existing.theme || 'default',
        mode,
        boardMeta,
        boardState
    };
}

async function buildEventRiskSummary(user) {
    const today = getKyivDateStr();
    const tomorrow = addDays(today, 1);
    const prepParams = [];
    const prepVisibility = buildTaskVisibilityScope(user, prepParams, 't');
    const prepBookingVisibility = getVisibleBookingScope(user, prepParams, 'b');
    const todayParams = [today];
    const todayBookingVisibility = getVisibleBookingScope(user, todayParams, 'b');
    const tomorrowParams = [tomorrow];
    const tomorrowBookingVisibility = getVisibleBookingScope(user, tomorrowParams, 'b');
    const lateParams = [today];
    const lateBookingVisibility = getVisibleBookingScope(user, lateParams, 'b');
    const resourceParams = [today];
    const resourceBookingVisibility = getVisibleBookingScope(user, resourceParams, 'b');

    const [todayUnconfirmed, tomorrowUnconfirmed, latePreliminary, bookingLinkedOverduePrep, resourceWarnings] = await Promise.all([
        pool.query(`
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${todayBookingVisibility.sql}
        `, todayParams),
        pool.query(`
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${tomorrowBookingVisibility.sql}
        `, tomorrowParams),
        pool.query(`
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              AND (SUBSTRING(b.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b.time FROM 4 FOR 2)::int)
                  - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int * 60
                  - EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int
                  BETWEEN 0 AND 120
              ${lateBookingVisibility.sql}
        `, lateParams),
        pool.query(`
            SELECT COUNT(*) AS count
            FROM tasks t
            JOIN bookings b ON t.source_type = 'booking' AND t.source_id = b.id::text
            WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
              AND t.deadline IS NOT NULL
              AND t.deadline < NOW()
              AND COALESCE(b.status, 'confirmed') <> 'cancelled'
              ${prepVisibility}
              ${prepBookingVisibility.sql}
        `, prepParams),
        pool.query(`
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND COALESCE(b.status, 'confirmed') <> 'cancelled'
              AND (b.line_id IS NULL OR b.line_id = 0)
              ${resourceBookingVisibility.sql}
        `, resourceParams)
    ]);

    const summary = {
        todayUnconfirmed: countFrom(todayUnconfirmed),
        tomorrowUnconfirmed: countFrom(tomorrowUnconfirmed),
        latePreliminary: countFrom(latePreliminary),
        bookingLinkedOverduePrep: countFrom(bookingLinkedOverduePrep),
        resourceWarnings: countFrom(resourceWarnings)
    };

    return {
        eventRiskSummary: summary,
        cards: [
            { key: 'today_unconfirmed', label: 'Непідтверджені сьогодні', count: summary.todayUnconfirmed, kind: 'needs_confirmation', href: '/', why: 'preliminary bookings with event date today' },
            { key: 'tomorrow_unconfirmed', label: 'Непідтверджені завтра', count: summary.tomorrowUnconfirmed, kind: 'needs_confirmation', href: '/', why: 'preliminary bookings with event date tomorrow' },
            { key: 'late_preliminary', label: 'Критично пізні preliminary', count: summary.latePreliminary, kind: 'late_preliminary', href: '/', why: 'preliminary bookings starting in the next 2 hours' },
            { key: 'booking_linked_overdue_prep', label: 'Прострочені prep-задачі по бронюваннях', count: summary.bookingLinkedOverduePrep, kind: 'booking_linked_overdue_prep', href: '/tasks?source_type=booking&overdue=1', why: 'only tasks with source_type=booking and matching source_id are counted' },
            { key: 'resource_warnings', label: 'Resource warnings сьогодні', count: summary.resourceWarnings, kind: 'resource_warning', href: '/dashboard#widget-exceptions', why: 'today bookings without assigned line/animator' }
        ],
        meta: {
            globalScore: false,
            visibleScopeOnly: true,
            bookingVisibilityBoundary: 'canonical object-level booking visibility scope',
            bookingVisibilityScopeSource: todayBookingVisibility.scopeSource,
            bookingVisibilityClassification: todayBookingVisibility.classification,
            bookingVisibilityReason: todayBookingVisibility.reason,
            denialSemantics: 'hidden bookings are absent from dashboard event-risk counts',
            missingDurableScopes: ['team', 'line', 'location'],
            prepSource: 'tasks.source_type=booking AND tasks.source_id=bookings.id',
            eventSoonSemantics: 'event_soon remains a timing review cue and is not counted as booking readiness'
        }
    };
}

// GET /api/dashboard/config — user's dashboard configuration
router.get('/config', async (req, res) => {
    try {
        const result = await pool.query(
            DASHBOARD_CONFIG_SELECT_SQL,
            [req.user.id]
        );

        if (result.rows.length > 0) {
            return res.json({ success: true, config: normalizeDashboardConfig(result.rows[0], req.user.role) });
        }

        // Return defaults based on role
        const defaultWidgets = getDefaultWidgets(req.user.role);
        const defaultConfig = normalizeDashboardConfig({
            layout: {},
            widgets: defaultWidgets,
            theme: 'default',
            mode: DASHBOARD_WORKSPACE_MODE
        }, req.user.role);
        res.json({
            success: true,
            config: defaultConfig,
            isDefault: true
        });
    } catch (err) {
        log.error('Failed to get dashboard config', err);
        res.status(500).json({ error: 'Failed to load dashboard config' });
    }
});

// PUT /api/dashboard/config — save user's dashboard configuration
router.put('/config', async (req, res) => {
    try {
        const existingResult = await pool.query(
            DASHBOARD_CONFIG_SELECT_SQL,
            [req.user.id]
        );
        const existingRaw = existingResult.rows[0] || {
            layout: {},
            widgets: getDefaultWidgets(req.user.role),
            theme: 'default'
        };
        const nextConfig = buildPersistedDashboardConfig(existingRaw, req.body || {}, req.user.role);
        await pool.query(DASHBOARD_CONFIG_UPSERT_SQL, [req.user.id, JSON.stringify(nextConfig.layout), JSON.stringify(nextConfig.widgets), nextConfig.theme || 'default']);

        res.json({ success: true, config: normalizeDashboardConfig(nextConfig, req.user.role) });
    } catch (err) {
        log.error('Failed to save dashboard config', err);
        res.status(500).json({ error: 'Failed to save dashboard config' });
    }
});

// GET /api/dashboard/widgets/:type — widget-specific data
router.get('/widgets/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const widgetAccess = canAccessDashboardWidget(req.user.role, type, ROLE_LEVEL);
        if (widgetAccess === false) {
            return res.status(403).json({ error: 'Insufficient widget permissions' });
        }

        let data = {};

        switch (type) {
            case 'tasks': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const ownFilter = buildOwnTaskFilter(req.user, params, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                           t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                           t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                           u.name AS owner_name, u.username AS owner_username,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
                    ${visibility}
                    ${ownFilter}
                    ORDER BY
                        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        t.deadline ASC NULLS LAST
                    LIMIT 10
                `, params);
                const tasks = taskWidgetPayload(result.rows);
                data = { tasks, intelligence: buildTaskOperationsSummary(tasks) };
                break;
            }

            case 'personal_tasker': {
                if (req.user.role !== 'creator') {
                    return res.status(403).json({ error: 'Creator tasker is available only for creator role' });
                }
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                           t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                           t.created_by, t.created_by_user_id, t.completed_at,
                           t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                           u.name AS owner_name, u.username AS owner_username,
                           cu.name AS creator_name, cu.username AS creator_username,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    LEFT JOIN users cu ON cu.id = t.created_by_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE COALESCE(t.status, 'todo') != 'archived'
                    ${visibility}
                    ORDER BY
                        CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived') THEN 0 ELSE 1 END,
                        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        CASE WHEN COALESCE(t.status, 'todo') IN ('done','cancelled') THEN 1 ELSE 0 END,
                        t.deadline ASC NULLS LAST,
                        t.updated_at DESC
                    LIMIT 180
                `, params);
                data = buildPersonalTaskerPayload(result.rows, req.user);
                break;
            }

            case 'my_focus': {
                const params = [];
                const ownFilter = buildOwnTaskFilter(req.user, params, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                           t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                           t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                           u.name AS owner_name, u.username AS owner_username,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
                    ${ownFilter}
                    ORDER BY
                        CASE WHEN COALESCE(t.focus_rank, 0) > 0 THEN 0 ELSE 1 END,
                        COALESCE(t.focus_rank, 99),
                        t.deadline ASC NULLS LAST,
                        t.updated_at DESC
                    LIMIT 6
                `, params);
                const countParams = [];
                const countOwn = buildOwnTaskFilter(req.user, countParams, 't');
                const counts = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE t.deadline IS NOT NULL AND t.deadline < NOW() AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived'))::int AS overdue_count,
                        COUNT(*) FILTER (WHERE (COALESCE(t.workflow_state, 'todo') = 'waiting' OR COALESCE(t.task_kind, 'action') = 'waiting') AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived'))::int AS waiting_count
                    FROM tasks t
                    WHERE 1=1 ${countOwn}
                `, countParams);
                const tasks = taskWidgetPayload(result.rows);
                data = {
                    tasks,
                    overdueCount: counts.rows[0]?.overdue_count || 0,
                    waitingCount: counts.rows[0]?.waiting_count || 0
                };
                break;
            }

            case 'bookings_today': {
                const today = getKyivDateStr();
                const params = [today];
                const bookingVisibility = getVisibleBookingScope(req.user, params, 'b');
                const result = await pool.query(`
                    SELECT b.id, b.label as client_name, b.program_name as program,
                           b.time as start_time, b.room, b.status, b.kids_count as children_count
                    FROM bookings b
                    WHERE b.date = $1 AND b.status != 'cancelled'
                    ${bookingVisibility.sql}
                    ORDER BY b.time ASC
                `, params);
                data = { bookings: result.rows, date: today, meta: { visibleScopeOnly: true, scopeSource: bookingVisibility.scopeSource } };
                break;
            }

            case 'my_schedule': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT ss.date, ss.status, ss.shift_start as start_time, ss.shift_end as end_time, ss.note
                    FROM staff_schedule ss
                    JOIN employee_profiles ep ON ep.staff_id = ss.staff_id
                    WHERE ep.user_id = $1 AND ss.date::date >= $2::date
                    ORDER BY ss.date ASC
                    LIMIT 7
                `, [req.user.id, today]);
                data = { shifts: result.rows };
                break;
            }

            case 'team_online': {
                const rawLimit = parseInt(req.query.limit, 10);
                const limit = Math.max(5, Math.min(Number.isInteger(rawLimit) ? rawLimit : 30, 80));
                const scope = String(req.query.scope || 'online').toLowerCase();
                const includeHistory = ['history', 'all', 'shift', 'last_seen'].includes(scope);
                const onlineUserIds = (typeof getOnlineUserIds === 'function' ? getOnlineUserIds() : [])
                    .map(id => parseInt(id, 10))
                    .filter(id => Number.isInteger(id) && id > 0);
                const onlineSet = new Set(onlineUserIds.map(String));
                if (!includeHistory && onlineUserIds.length === 0) {
                    data = {
                        online: [],
                        users: [],
                        meta: {
                            scope: 'online',
                            onlineSource: 'websocket_online_users',
                            lastSeenSource: 'hidden_until_history_enabled',
                            onlineCount: 0,
                            recentlyActiveCount: 0,
                            returned: 0,
                            limit,
                            refreshable: true
                        }
                    };
                    break;
                }
                const result = await pool.query(`
                    SELECT u.id, u.username, u.name, u.role,
                           u.last_seen_at AS user_last_seen_at,
                           ep.last_activity_at AS profile_last_activity_at,
                           COALESCE(u.last_seen_at, ep.last_activity_at) AS last_seen
                    FROM users u
                    LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_active = true
                    WHERE COALESCE(u.is_active, true) = true
                    AND u.role NOT IN ('bot', 'viewer')
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'openclaw%'
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'open_claw%'
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'open-claw%'
                    AND lower(COALESCE(u.name, '')) NOT LIKE 'openclaw%'
                    AND lower(COALESCE(u.name, '')) NOT LIKE 'open claw%'
                    AND ($3::boolean = true OR u.id = ANY($1::int[]))
                    ORDER BY
                        CASE WHEN u.id = ANY($1::int[]) THEN 0 ELSE 1 END,
                        COALESCE(u.last_seen_at, ep.last_activity_at) DESC NULLS LAST,
                        COALESCE(NULLIF(u.name, ''), u.username) ASC,
                        u.id ASC
                    LIMIT $2
                `, [onlineUserIds, limit, includeHistory]);
                const now = Date.now();
                const users = result.rows.map(row => {
                    const lastSeenDate = row.last_seen ? new Date(row.last_seen) : null;
                    const diffMs = lastSeenDate && !Number.isNaN(lastSeenDate.getTime()) ? now - lastSeenDate.getTime() : null;
                    const recentlyActive = diffMs !== null && diffMs >= 0 && diffMs <= 5 * 60 * 1000;
                    const isOnline = onlineSet.has(String(row.id));
                    return {
                        id: row.id,
                        username: row.username || null,
                        name: row.name || row.username || `User #${row.id}`,
                        role: row.role || null,
                        isOnline,
                        recentlyActive,
                        status: isOnline ? 'online' : (recentlyActive ? 'recently_active' : 'offline'),
                        lastSeen: row.last_seen || null,
                        lastSeenAt: row.last_seen || null,
                        userLastSeenAt: row.user_last_seen_at || null,
                        profileLastActivityAt: row.profile_last_activity_at || null
                    };
                });
                data = {
                    online: users,
                    users,
                    meta: {
                        scope: includeHistory ? 'history' : 'online',
                        onlineSource: 'websocket_online_users',
                        lastSeenSource: 'users.last_seen_at_or_employee_profiles.last_activity_at',
                        onlineCount: users.filter(user => user.isOnline).length,
                        recentlyActiveCount: users.filter(user => !user.isOnline && user.recentlyActive).length,
                        returned: users.length,
                        limit,
                        refreshable: true
                    }
                };
                break;
            }

            case 'quick_stats': {
                const today = getKyivDateStr();
                const activeTaskParams = [];
                const activeTaskVisibility = buildTaskVisibilityScope(req.user, activeTaskParams, 't');
                const overdueTaskParams = [];
                const overdueTaskVisibility = buildTaskVisibilityScope(req.user, overdueTaskParams, 't');
                const bookingCountParams = [today];
                const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
                const revenueParams = [today];
                const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');
                const unconfirmedParams = [today];
                const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
                const [bookings, tasks, revenue, overdueQS, unconfirmedQS, lowStockQS, coldLeadsQS] = await Promise.all([
                    pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql}`, bookingCountParams),
                    pool.query(`SELECT COUNT(*) as count FROM tasks t WHERE t.status = 'in_progress' ${activeTaskVisibility}`, activeTaskParams),
                    pool.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql}`, revenueParams),
                    pool.query(`SELECT COUNT(*) as count FROM tasks t WHERE t.deadline < NOW() AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived') ${overdueTaskVisibility}`, overdueTaskParams),
                    pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status = 'preliminary' ${unconfirmedVisibility.sql}`, unconfirmedParams),
                    pool.query("SELECT COUNT(*) as count FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true"),
                    pool.query("SELECT COUNT(*) as count FROM leads WHERE status = 'new' AND created_at < NOW() - INTERVAL '48 hours'")
                ]);
                const ov = parseInt(overdueQS.rows[0].count);
                const uc = parseInt(unconfirmedQS.rows[0].count);
                const ls = parseInt(lowStockQS.rows[0].count);
                const cl = parseInt(coldLeadsQS.rows[0].count);
                data = {
                    bookingsToday: parseInt(bookings.rows[0].count),
                    activeTasks: parseInt(tasks.rows[0].count),
                    revenueToday: parseFloat(revenue.rows[0].total),
                    needsAttention: ov + uc + ls + cl,
                    overdueTasks: ov,
                    unconfirmedBookings: uc,
                    lowStockItems: ls,
                    coldLeads: cl
                };
                break;
            }

            case 'alerts': {
                const alertToday = getKyivDateStr();
                const overdueParams = [];
                const overdueVisibility = buildTaskVisibilityScope(req.user, overdueParams, 't');
                const unconfirmedParams = [alertToday];
                const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
                const shiftParams = [alertToday];
                const shiftVisibility = getVisibleBookingScope(req.user, shiftParams, 'b');
                const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
                    pool.query(`SELECT t.id, t.title, t.deadline FROM tasks t
                                WHERE t.deadline < NOW()
                                  AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                                  ${overdueVisibility}
                                ORDER BY t.deadline ASC LIMIT 5`, overdueParams),
                    pool.query(`SELECT b.id, b.label, b.time FROM bookings b
                                WHERE b.date = $1 AND b.status = 'preliminary'
                                  ${unconfirmedVisibility.sql}
                                ORDER BY b.time LIMIT 5`, unconfirmedParams),
                    pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock
                                WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
                    pool.query(`SELECT COUNT(*) as c FROM leads
                                WHERE status = 'new' AND created_at < NOW() - INTERVAL '48 hours'`),
                    pool.query(`SELECT
                                  (SELECT COUNT(*) FROM cash_register_shifts WHERE status = 'open') AS open_shifts,
                                  (SELECT COUNT(*) FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${shiftVisibility.sql}) AS today_bk`,
                                shiftParams)
                ]);
                const alerts = [];
                overdue.rows.forEach(t => {
                    alerts.push({ id: `overdue_${t.id}`, type: 'warning', level: 'warning', icon: '⚠️',
                        title: `Прострочена: "${(t.title || '').slice(0, 40)}"`, link: '/tasks',
                        action: { label: '📋 Задача', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
                    });
                });
                unconfirmed.rows.forEach(b => {
                    alerts.push({ id: `unconfirmed_${b.id}`, type: 'info', level: 'info', icon: '📋',
                        title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`, link: '/',
                        action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
                    });
                });
                lowStock.rows.forEach((s, i) => {
                    alerts.push({ id: `stock_${i}`, type: 'warning', level: 'warning', icon: '📦',
                        title: `Мало: ${s.name} (${s.quantity} ${s.unit})`, link: '/warehouse',
                        action: { label: '📋 Замовити', prompt: `На складі мало: ${s.name} (${s.quantity}/${s.min_quantity}). Замовити.` }
                    });
                });
                const coldCount = parseInt(coldLeads.rows[0].c);
                if (coldCount > 0) {
                    alerts.push({ id: 'cold_leads', type: 'warning', level: 'warning', icon: '🥶',
                        title: `${coldCount} лідів без відповіді >48год`, link: '/sales-funnel',
                        action: { label: '📋 Обдзвін', prompt: `${coldCount} лідів без відповіді. Задача менеджеру.` }
                    });
                }
                const { open_shifts, today_bk } = shiftCheck.rows[0];
                if (parseInt(open_shifts) === 0 && parseInt(today_bk) > 0) {
                    alerts.push({ id: 'no_shift', type: 'critical', level: 'critical', icon: '🔴',
                        title: `Каса не відкрита! (${today_bk} броні)`, link: '/finance',
                        action: { label: '💰 Відкрити', prompt: 'Каса не відкрита. Нагадати.' }
                    });
                }
                alerts.push(...await getOmniAccountAlertsAsync());
                data = { alerts, count: alerts.length };
                break;
            }

            case 'event_risk_summary': {
                data = await buildEventRiskSummary(req.user);
                break;
            }

            case 'leads_new': {
                const result = await pool.query(`
                    SELECT id, client_name AS name, phone, source, status, created_at
                    FROM leads
                    WHERE status = 'new'
                    ORDER BY created_at DESC
                    LIMIT 8
                `);
                data = { leads: result.rows, total: result.rows.length };
                break;
            }

            case 'funnel': {
                const queue = await buildWorkQueue({
                    pool,
                    user: req.user,
                    limit: 1,
                    replyScope: 'all',
                    replySla: 'all',
                    replyOwner: 'all',
                    replyEscalation: 'all'
                });
                data = { meta: { funnelInsights: queue?.meta?.funnelInsights || {} } };
                break;
            }

            case 'finance_today': {
                const finToday = getKyivDateStr();
                const revenueParams = [finToday];
                const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');
                const bookingCountParams = [finToday];
                const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
                const [revenue, expenses, bookingCount] = await Promise.all([
                    pool.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql}`, revenueParams),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions WHERE date = $1 AND type = 'expense'", [finToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql}`, bookingCountParams),
                ]);
                data = {
                    revenue: parseFloat(revenue.rows[0].total),
                    expenses: parseFloat(expenses.rows[0].total),
                    bookings: parseInt(bookingCount.rows[0].count),
                    profit: parseFloat(revenue.rows[0].total) - parseFloat(expenses.rows[0].total),
                };
                break;
            }

            case 'announcements': {
                const result = await pool.query(`
                    SELECT id, title, text_content as content, priority, created_at, created_by as author_name
                    FROM announcements
                    WHERE status = 'active'
                    ORDER BY priority DESC, created_at DESC
                    LIMIT 5
                `);
                data = { announcements: result.rows };
                break;
            }

            case 'weather': {
                data = await getCachedData('weather', 1800, fetchWeather);
                break;
            }

            case 'currency': {
                data = await getCachedData('currency', 3600, fetchCurrency);
                break;
            }

            case 'reports_today': {
                const repToday = getKyivDateStr();
                const [repIncome, repExpense, repNew] = await Promise.all([
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'income'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'expense'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COUNT(*) as count FROM reports WHERE created_at::date = $1 AND status = 'new'", [repToday]).catch(() => ({ rows: [{ count: 0 }] })),
                ]);
                data = {
                    income: parseFloat(repIncome.rows[0].total),
                    expense: parseFloat(repExpense.rows[0].total),
                    newCount: parseInt(repNew.rows[0].count)
                };
                break;
            }

            case 'exceptions': {
                const excToday = getKyivDateStr();
                const exceptionPrepParams = [];
                const exceptionPrepVisibility = buildTaskVisibilityScope(req.user, exceptionPrepParams, 't');
                const exceptionPrepBookingVisibility = getVisibleBookingScope(req.user, exceptionPrepParams, 'b');
                const conflictParams = [excToday];
                const conflictVisibility1 = getVisibleBookingScope(req.user, conflictParams, 'b1');
                const conflictVisibility2 = getVisibleBookingScope(req.user, conflictParams, 'b2');
                const noAnimatorParams = [excToday];
                const noAnimatorVisibility = getVisibleBookingScope(req.user, noAnimatorParams, 'b');
                const lateUnconfirmedParams = [excToday];
                const lateUnconfirmedVisibility = getVisibleBookingScope(req.user, lateUnconfirmedParams, 'b');
                const detractorParams = [];
                const detractorBookingVisibility = getVisibleBookingScope(req.user, detractorParams, 'b');
                const [conflictsQ, noAnimatorQ, overduePrep, detractors, cleaningSLA, unconfirmedLate] = await Promise.all([
                    // Resource conflicts: same room, overlapping times
                    pool.query(`
                        SELECT b1.id as booking1, b2.id as booking2, b1.room, b1.time as time1, b2.time as time2
                        FROM bookings b1
                        JOIN bookings b2 ON b1.room = b2.room AND b1.date = b2.date AND b1.id < b2.id
                        WHERE b1.date = $1 AND b1.status != 'cancelled' AND b2.status != 'cancelled'
                          AND b1.room IS NOT NULL AND b1.room != ''
                          ${conflictVisibility1.sql}
                          ${conflictVisibility2.sql}
                          AND ABS(
                            (SUBSTRING(b1.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b1.time FROM 4 FOR 2)::int) -
                            (SUBSTRING(b2.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b2.time FROM 4 FOR 2)::int)
                          ) < COALESCE(b1.duration, 120)
                        LIMIT 5
                    `, conflictParams).catch(() => ({ rows: [] })),
                    // Bookings without assigned animator
                    pool.query(`
                        SELECT b.id, b.label, b.time, b.program_name, b.room
                        FROM bookings b
                        WHERE b.date = $1 AND b.status != 'cancelled'
                          AND (b.line_id IS NULL OR b.line_id = 0)
                          ${noAnimatorVisibility.sql}
                        ORDER BY b.time LIMIT 5
                    `, noAnimatorParams).catch(() => ({ rows: [] })),
                    // Overdue booking-linked prep tasks only; category-only event tasks are not per-booking readiness truth.
                    pool.query(`
                        SELECT t.id, t.title, t.deadline, t.source_id AS booking_id
                        FROM tasks t
                        JOIN bookings b ON t.source_type = 'booking' AND t.source_id = b.id::text
                        WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                          AND t.deadline IS NOT NULL
                          AND t.deadline < NOW()
                          AND COALESCE(b.status, 'confirmed') <> 'cancelled'
                          ${exceptionPrepVisibility}
                          ${exceptionPrepBookingVisibility.sql}
                        ORDER BY t.deadline ASC LIMIT 5
                    `, exceptionPrepParams).catch(() => ({ rows: [] })),
                    // Recent NPS detractors (rating 1-2, last 7 days, no follow-up)
                    pool.query(`
                        SELECT er.id, er.booking_id, er.rating, er.comment, er.customer_name, er.created_at
                        FROM event_reviews er
                        JOIN bookings b ON b.id = er.booking_id
                        WHERE er.rating <= 2 AND er.created_at > NOW() - INTERVAL '7 days'
                          AND (er.follow_up_status IS NULL OR er.follow_up_status = 'none')
                          ${detractorBookingVisibility.sql}
                        ORDER BY er.created_at DESC LIMIT 5
                    `, detractorParams).catch(() => ({ rows: [] })),
                    // Cleaning SLA breaches
                    pool.query(`
                        SELECT id, room, scheduled_at, sla_minutes FROM cleaning_tasks
                        WHERE status = 'pending'
                          AND scheduled_at < NOW() - (sla_minutes || ' minutes')::interval
                        ORDER BY scheduled_at ASC LIMIT 5
                    `).catch(() => ({ rows: [] })),
                    // Unconfirmed bookings close to start (< 2 hours)
                    pool.query(`
                        SELECT b.id, b.label, b.time, b.room FROM bookings b
                        WHERE b.date = $1 AND b.status = 'preliminary'
                          ${lateUnconfirmedVisibility.sql}
                          AND (SUBSTRING(b.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b.time FROM 4 FOR 2)::int)
                              - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int * 60
                              - EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int
                              BETWEEN 0 AND 120
                        ORDER BY b.time LIMIT 5
                    `, lateUnconfirmedParams).catch(() => ({ rows: [] }))
                ]);

                const exceptions = [];

                conflictsQ.rows.forEach(c => {
                    exceptions.push({
                        id: `conflict_${c.booking1}_${c.booking2}`, type: 'conflict', level: 'critical', icon: '💥',
                        title: `Конфлікт кімнати ${c.room}: ${(c.time1 || '').slice(0,5)} vs ${(c.time2 || '').slice(0,5)}`,
                        link: '/', action: { label: 'Вирішити', prompt: `Конфлікт: бронювання ${c.booking1} і ${c.booking2} в кімнаті ${c.room}` }
                    });
                });
                noAnimatorQ.rows.forEach(b => {
                    exceptions.push({
                        id: `no_animator_${b.id}`, type: 'no_animator', level: 'warning', icon: '🎭',
                        title: `Без аніматора: ${(b.time || '').slice(0,5)} ${b.label || b.program_name}`,
                        link: '/', action: { label: 'Призначити', prompt: `Бронювання ${b.id} без аніматора` }
                    });
                });
                overduePrep.rows.forEach(t => {
                    exceptions.push({
                        id: `prep_overdue_${t.id}`, type: 'prep_overdue', level: 'warning', icon: '⏰',
                        title: `Прострочена підготовка: ${(t.title || '').slice(0,40)}`,
                        link: '/tasks', action: { label: 'Виконати', prompt: `Задача підготовки ${t.id} прострочена` }
                    });
                });
                detractors.rows.forEach(r => {
                    exceptions.push({
                        id: `detractor_${r.id}`, type: 'detractor', level: 'warning', icon: '😞',
                        title: `Незадоволений: ${r.customer_name || 'Клієнт'} (${r.rating}/5)`,
                        link: '/customers', action: { label: 'Зателефонувати', prompt: `Клієнт ${r.customer_name} поставив ${r.rating}/5. Коментар: ${r.comment}` }
                    });
                });
                cleaningSLA.rows.forEach(c => {
                    exceptions.push({
                        id: `cleaning_sla_${c.id}`, type: 'cleaning_sla', level: 'info', icon: '🧹',
                        title: `Прибирання просрочено: ${c.room}`,
                        link: '/tasks', action: { label: 'Перевірити', prompt: `Прибирання кімнати ${c.room} перевищило SLA ${c.sla_minutes} хв` }
                    });
                });
                unconfirmedLate.rows.forEach(b => {
                    exceptions.push({
                        id: `late_unconfirmed_${b.id}`, type: 'late_unconfirmed', level: 'critical', icon: '🔴',
                        title: `Не підтверджено за <2год: ${(b.time || '').slice(0,5)} ${b.label || ''}`,
                        link: '/', action: { label: 'Підтвердити', prompt: `Бронювання ${b.id} не підтверджене, початок менш ніж за 2 години!` }
                    });
                });

                data = {
                    exceptions,
                    count: exceptions.length,
                    categories: {
                        conflicts: conflictsQ.rows.length,
                        noAnimator: noAnimatorQ.rows.length,
                        overduePrep: overduePrep.rows.length,
                        detractors: detractors.rows.length,
                        cleaningSLA: cleaningSLA.rows.length,
                        unconfirmedLate: unconfirmedLate.rows.length
                    }
                };
                break;
            }

            case 'catalogs': {
                const [catDefs, catItems] = await Promise.all([
                    pool.query("SELECT cd.id, cd.name, cd.emoji, COUNT(ci.id)::int AS count FROM catalog_definitions cd LEFT JOIN catalog_items ci ON ci.catalog_id = cd.id AND ci.status = 'active' WHERE cd.is_active = true GROUP BY cd.id, cd.name, cd.emoji, cd.sort_order ORDER BY cd.sort_order").catch(() => ({ rows: [] })),
                    pool.query("SELECT ci.id, ci.name, ci.price, ci.image_url, ci.catalog_id, cd.name AS catalog_name, cd.emoji AS catalog_emoji FROM catalog_items ci JOIN catalog_definitions cd ON cd.id = ci.catalog_id WHERE ci.status = 'active' ORDER BY ci.created_at DESC LIMIT 5").catch(() => ({ rows: [] })),
                ]);
                data = { definitions: catDefs.rows, recentItems: catItems.rows };
                break;
            }

            case 'account_stats': {
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false)) as total_staff,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NOT NULL) as with_account,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NULL) as without_account,
                        COUNT(*) FILTER (WHERE s.is_active AND COALESCE(s.is_freelance, false)) as freelance_slots
                    FROM staff s
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                `).catch(() => ({ rows: [{ total_staff: 0, with_account: 0, without_account: 0, freelance_slots: 0 }] }));
                data = stats.rows[0];
                break;
            }

            // v39.10: Staff on shift today
            case 'staff_today': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT s.id, s.name, s.department, s.position, s.color,
                           ss.shift_start, ss.shift_end, ss.status,
                           CASE WHEN u.last_seen_at > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
                    FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                    LEFT JOIN users u ON u.id = ep.user_id
                    WHERE ss.date = $1 AND s.is_active = true AND ss.status = 'working'
                    ORDER BY ss.shift_start, s.department, s.name
                `, [today]);
                const absent = await pool.query(`
                    SELECT s.name, ss.status FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    WHERE ss.date = $1 AND s.is_active = true AND ss.status IN ('sick', 'vacation')
                    ORDER BY s.name
                `, [today]);
                data = { onShift: result.rows, absent: absent.rows, date: today };
                break;
            }

            // v39.10: Bookings this week (7 days)
            case 'week_bookings': {
                const today = getKyivDateStr();
                const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 6);
                const to = weekEnd.toISOString().split('T')[0];
                const params = [today, to];
                const bookingVisibility = getVisibleBookingScope(req.user, params, 'b');
                const result = await pool.query(`
                    SELECT b.date, COUNT(*)::int AS count,
                           COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                           COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS pending,
                           COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue
                    FROM bookings b
                    WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                      AND b.linked_to IS NULL AND b.status != 'cancelled'
                      ${bookingVisibility.sql}
                    GROUP BY b.date ORDER BY b.date
                `, params);
                data = { days: result.rows, from: today, to, meta: { visibleScopeOnly: true, scopeSource: bookingVisibility.scopeSource } };
                break;
            }

            // v39.10: Team tasks (for managers — all team's tasks)
            case 'team_tasks': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.assigned_to, t.owner, t.owner_user_id,
                           u.name AS owner_name, u.username AS owner_username,
                           t.status, t.priority, t.deadline, t.updated_at, t.created_at,
                           CASE WHEN t.deadline < NOW() THEN true ELSE false END AS is_overdue,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
                    ${visibility}
                    ORDER BY
                        CASE WHEN t.deadline < NOW() THEN 0 ELSE 1 END,
                        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                        t.deadline ASC NULLS LAST
                    LIMIT 15
                `, params);
                const statsParams = [];
                const statsVisibility = buildTaskVisibilityScope(req.user, statsParams, 't');
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE t.status = 'todo')::int AS todo,
                        COUNT(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                        COUNT(*) FILTER (WHERE t.deadline < NOW() AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived'))::int AS overdue
                    FROM tasks t
                    WHERE 1=1 ${statsVisibility}
                `, statsParams);
                const tasks = taskWidgetPayload(result.rows);
                data = { tasks, stats: stats.rows[0], intelligence: buildTaskOperationsSummary(tasks) };
                break;
            }

            // v39.10: HR widget — absences, leaves, birthdays, contracts
            case 'hr_overview': {
                const today = getKyivDateStr();
                const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
                const weekStr = weekEnd.toISOString().split('T')[0];
                const [absences, pendingLeaves, birthdays, expiring] = await Promise.all([
                    pool.query(`SELECT s.name, ss.status FROM staff_schedule ss JOIN staff s ON s.id = ss.staff_id
                        WHERE ss.date = $1 AND ss.status IN ('sick','vacation') AND s.is_active = true ORDER BY s.name`, [today]),
                    pool.query(`SELECT lr.id, s.name, lr.type, lr.date_from, lr.date_to FROM hr_leave_requests lr
                        JOIN staff s ON s.id = lr.staff_id WHERE lr.status = 'pending' ORDER BY lr.created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT name, birth_date FROM staff WHERE is_active = true AND birth_date IS NOT NULL
                        AND EXTRACT(MONTH FROM birth_date::date) = EXTRACT(MONTH FROM $1::date)
                        AND EXTRACT(DAY FROM birth_date::date) BETWEEN EXTRACT(DAY FROM $1::date) AND EXTRACT(DAY FROM $2::date)
                        ORDER BY EXTRACT(DAY FROM birth_date::date)`, [today, weekStr]).catch(() => ({ rows: [] })),
                    pool.query(`SELECT name, contract_type FROM staff WHERE is_active = true
                        AND hire_date IS NOT NULL AND hire_date::date < NOW() - INTERVAL '11 months'
                        ORDER BY hire_date LIMIT 5`).catch(() => ({ rows: [] }))
                ]);
                data = {
                    absent: absences.rows,
                    pendingLeaves: pendingLeaves.rows,
                    birthdays: birthdays.rows,
                    contractsExpiring: expiring.rows
                };
                break;
            }

            // v39.10: Director P&L widget
            case 'director_pnl': {
                const today = getKyivDateStr();
                const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
                const ws = weekStart.toISOString().split('T')[0];
                const monthStart = today.slice(0, 7) + '-01';
                const [weekRev, monthRev, weekExp, monthExp, staffCost] = await Promise.all([
                    pool.query(`SELECT COALESCE(SUM(price),0)::int AS rev FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND status = 'confirmed' AND linked_to IS NULL`, [ws, today]),
                    pool.query(`SELECT COALESCE(SUM(price),0)::int AS rev FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND status = 'confirmed' AND linked_to IS NULL`, [monthStart, today]),
                    pool.query(`SELECT COALESCE(SUM(amount),0)::int AS exp FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date AND type = 'expense'`, [ws, today]),
                    pool.query(`SELECT COALESCE(SUM(amount),0)::int AS exp FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date AND type = 'expense'`, [monthStart, today]),
                    pool.query(`SELECT COUNT(*)::int AS staff, COALESCE(SUM(hourly_rate),0)::int AS daily_cost FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL)`).catch(() => ({ rows: [{ staff: 0, daily_cost: 0 }] }))
                ]);
                data = {
                    week: { revenue: weekRev.rows[0].rev, expenses: weekExp.rows[0].exp, profit: weekRev.rows[0].rev - weekExp.rows[0].exp },
                    month: { revenue: monthRev.rows[0].rev, expenses: monthExp.rows[0].exp, profit: monthRev.rows[0].rev - monthExp.rows[0].exp },
                    staffCount: staffCost.rows[0].staff,
                    dailyStaffCost: staffCost.rows[0].daily_cost
                };
                break;
            }

            // v39.10: Art director content pipeline
            case 'content_pipeline': {
                const [inReview, approved, tasks, catalogs] = await Promise.all([
                    pool.query(`SELECT id, title, status FROM art_director_content WHERE status = 'in_review' ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT COUNT(*)::int AS c FROM art_director_content WHERE status = 'approved' AND created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ c: 0 }] })),
                    pool.query(`SELECT id, title, priority FROM tasks WHERE category = 'improvement' AND status NOT IN ('done','cancelled') ORDER BY priority DESC, deadline ASC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT id, name, emoji, status FROM catalog_definitions WHERE is_active = true ORDER BY name`).catch(() => ({ rows: [] }))
                ]);
                data = {
                    inReview: inReview.rows,
                    approvedThisWeek: approved.rows[0].c,
                    designTasks: tasks.rows,
                    catalogs: catalogs.rows
                };
                break;
            }

            // v40.5: Task health widget
            case 'task_health': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE t.health_score > 70 AND t.status NOT IN ('done','cancelled','archived'))::int AS healthy,
                        COUNT(*) FILTER (WHERE t.health_score BETWEEN 41 AND 70 AND t.status NOT IN ('done','cancelled','archived'))::int AS warning,
                        COUNT(*) FILTER (WHERE t.health_score BETWEEN 1 AND 40 AND t.status NOT IN ('done','cancelled','archived'))::int AS critical,
                        COUNT(*) FILTER (WHERE t.status = 'archived')::int AS archived,
                        COALESCE(AVG(t.health_score) FILTER (WHERE t.status NOT IN ('done','cancelled','archived')), 0)::int AS avg_score
                    FROM tasks t
                    WHERE 1=1 ${visibility}
                `, params).catch(() => ({ rows: [{ healthy: 0, warning: 0, critical: 0, archived: 0, avg_score: 0 }] }));
                data = stats.rows[0];
                break;
            }

            // v39.10: Vice director operations overview
            case 'operations': {
                const today = getKyivDateStr();
                const [procurement, complaints, quality, staffGaps] = await Promise.all([
                    pool.query(`SELECT id, name, status FROM procurement_lists WHERE status IN ('draft','ordered') ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'new' AND source = 'complaint' AND created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ c: 0 }] })),
                    pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(3,1) AS avg_rating, COUNT(*)::int AS count FROM event_reviews WHERE created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [{ avg_rating: 0, count: 0 }] })),
                    pool.query(`SELECT COUNT(*)::int AS gaps FROM staff_schedule ss
                        JOIN staff s ON s.id = ss.staff_id
                        JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                        JOIN users u ON u.id = ep.user_id
                        WHERE ss.date = $1 AND ss.status = 'working' AND s.is_active = true
                        AND (u.last_seen_at IS NULL OR u.last_seen_at < NOW() - INTERVAL '30 minutes')`, [today]).catch(() => ({ rows: [{ gaps: 0 }] }))
                ]);
                data = {
                    procurement: procurement.rows,
                    complaintsWeek: complaints.rows[0].c,
                    quality: quality.rows[0],
                    staffNotCheckedIn: staffGaps.rows[0].gaps
                };
                break;
            }

            default:
                return res.status(400).json({ error: 'Unknown widget type' });
        }

        res.json({ success: true, data });
    } catch (err) {
        log.error(`Widget data error (${req.params.type})`, err);
        res.status(500).json({ error: 'Failed to load widget data' });
    }
});

// GET /api/dashboard/roles — role definitions for test panel
router.get('/roles', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT role_key, name_uk, department, level FROM role_definitions WHERE is_active = true ORDER BY level DESC'
        );
        res.json({ success: true, roles: result.rows });
    } catch (err) {
        log.error('Failed to get roles', err);
        res.status(500).json({ error: 'Failed to load roles' });
    }
});

// GET /api/dashboard/today — aggregate "today" data for quick overview
router.get('/today', async (req, res) => {
    try {
        const today = getKyivDateStr();
        const taskParams = [];
        const taskVisibility = buildTaskVisibilityScope(req.user, taskParams, 't');
        const ownTaskFilter = buildOwnTaskFilter(req.user, taskParams, 't');
        const bookingCountParams = [today];
        const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
        const revenueParams = [today];
        const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');

        const [bookings, tasks, revenue, teamOnline, newLeads] = await Promise.all([
            pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql}`, bookingCountParams),
            pool.query(`SELECT COUNT(*) as count
                        FROM tasks t
                        WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
                        ${taskVisibility}
                        ${ownTaskFilter}`, taskParams),
            pool.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql}`, revenueParams),
            pool.query("SELECT COUNT(*) as count FROM users u LEFT JOIN employee_profiles ep ON ep.user_id = u.id WHERE u.is_active = true AND ep.last_activity_at > NOW() - INTERVAL '5 minutes'"),
            pool.query("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").catch(() => ({ rows: [{ count: 0 }] })),
        ]);

        res.json({
            success: true,
            data: {
                date: today,
                bookingsToday: parseInt(bookings.rows[0].count),
                myActiveTasks: parseInt(tasks.rows[0].count),
                revenueToday: parseFloat(revenue.rows[0].total),
                teamOnline: parseInt(teamOnline.rows[0].count),
                newLeads: parseInt(newLeads.rows[0].count),
            }
        });
    } catch (err) {
        log.error('Dashboard /today error', err);
        res.status(500).json({ error: 'Failed to load today data' });
    }
});

// --- Cache helpers ---
async function getCachedData(key, ttlSeconds, fetchFn) {
    try {
        const cached = await pool.query(
            'SELECT data FROM dashboard_cache WHERE cache_key = $1 AND expires_at > NOW()',
            [key]
        );
        if (cached.rows.length > 0) {
            return cached.rows[0].data;
        }

        const freshData = await fetchFn();
        await pool.query(`
            INSERT INTO dashboard_cache (cache_key, data, expires_at)
            VALUES ($1, $2, NOW() + make_interval(secs => $3))
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, expires_at = NOW() + make_interval(secs => $3)
        `, [key, JSON.stringify(freshData), ttlSeconds]);

        return freshData;
    } catch (err) {
        log.error(`Cache error for ${key}`, err);
        return {};
    }
}

async function fetchWeather() {
    try {
        // Kyiv weather via Open-Meteo (free, no API key)
        const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m,weather_code,wind_speed_10m&timezone=Europe/Kyiv');
        if (!resp.ok) return { error: 'Weather API unavailable' };
        const data = await resp.json();
        const current = data.current || {};
        return {
            temperature: current.temperature_2m,
            weatherCode: current.weather_code ?? current.weathercode,
            windSpeed: current.wind_speed_10m ?? current.windspeed_10m,
            city: 'Київ',
            updatedAt: current.time || null
        };
    } catch {
        return { error: 'Weather fetch failed' };
    }
}

async function fetchCurrency() {
    try {
        // NBU currency rates
        const resp = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
        if (!resp.ok) return { error: 'Currency API unavailable' };
        const data = await resp.json();
        const rows = Array.isArray(data) ? data : [];
        const wanted = ['USD', 'EUR', 'GBP', 'PLN', 'CZK'];
        const rates = wanted.reduce((acc, code) => {
            const row = rows.find(c => c.cc === code);
            if (row && Number.isFinite(Number(row.rate))) acc[code] = Number(row.rate);
            return acc;
        }, {});
        return {
            usd: rates.USD || null,
            eur: rates.EUR || null,
            rates,
            base: 'UAH',
            date: rows.find(c => c.cc === 'USD')?.exchangedate || null
        };
    } catch {
        return { error: 'Currency fetch failed' };
    }
}

// GET /api/dashboard/alerts — standalone endpoint for alert bell
router.get('/alerts', async (req, res) => {
    try {
        const today = getKyivDateStr();
        const overdueParams = [];
        const overdueVisibility = buildTaskVisibilityScope(req.user, overdueParams, 't');
        const unconfirmedParams = [today];
        const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
        const shiftParams = [today];
        const shiftVisibility = getVisibleBookingScope(req.user, shiftParams, 'b');
        const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            pool.query(`SELECT t.id, t.title, t.deadline, t.priority, t.status, t.owner_user_id,
                               t.assigned_to, t.owner, t.updated_at, t.created_at,
                               u.name AS owner_name, u.username AS owner_username
                        FROM tasks t
                        LEFT JOIN users u ON u.id = t.owner_user_id
                        WHERE t.deadline < NOW()
                          AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                          ${overdueVisibility}
                        ORDER BY t.deadline ASC
                        LIMIT 5`, overdueParams),
            pool.query(`SELECT b.id, b.label, b.time FROM bookings b WHERE b.date = $1 AND b.status = 'preliminary' ${unconfirmedVisibility.sql} ORDER BY b.time LIMIT 5`, unconfirmedParams),
            pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
            pool.query(`SELECT COUNT(*) as c FROM leads WHERE status='new' AND created_at < NOW() - INTERVAL '48 hours'`),
            pool.query(`SELECT (SELECT COUNT(*) FROM cash_register_shifts WHERE status='open') AS open_shifts,
                               (SELECT COUNT(*) FROM bookings b WHERE b.date=$1 AND b.status='confirmed' ${shiftVisibility.sql}) AS today_bk`, shiftParams)
        ]);
        const alerts = [];
        overdue.rows.forEach(t => {
            const task = taskWidgetPayload([t])[0] || t;
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                owner: task.ownerLabel || null,
                ownerState: task.ownerState || 'unassigned',
                intelligence: task.intelligence || null,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach((s, i) => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }
        alerts.push(...await getOmniAccountAlertsAsync());
        res.json({ success: true, alerts, count: alerts.length });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v39.7.0 — WebSocket alert push: broadcast alerts to all connected users periodically
let _alertBroadcastTimer = null;
let _lastAlertHash = '';

async function broadcastAlerts() {
    try {
        const { broadcast } = require('../services/websocket');
        const today = getKyivDateStr();
        const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            // Task alerts are object-visible, so the global websocket broadcast must not leak task titles.
            Promise.resolve({ rows: [] }),
            // Booking alerts are object-visible; global websocket broadcast cannot apply per-user booking scope.
            Promise.resolve({ rows: [] }),
            pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
            pool.query(`SELECT COUNT(*) as c FROM leads WHERE status='new' AND created_at < NOW() - INTERVAL '48 hours'`),
            pool.query(`SELECT (SELECT COUNT(*) FROM cash_register_shifts WHERE status='open') AS open_shifts,
                               0 AS today_bk`)
        ]);
        const alerts = [];
        overdue.rows.forEach(t => {
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach(s => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }

        // Only broadcast if alerts changed
        const hash = JSON.stringify(alerts.map(a => a.id).sort());
        if (hash !== _lastAlertHash) {
            _lastAlertHash = hash;
            broadcast('alert:updated', { alerts, count: alerts.length });
        }
    } catch (err) {
        // Silent — don't crash on periodic check
    }
}

function startAlertBroadcaster(intervalMs = 60000) {
    if (_alertBroadcastTimer) clearInterval(_alertBroadcastTimer);
    _alertBroadcastTimer = setInterval(broadcastAlerts, intervalMs);
    // Initial broadcast after 5s delay
    setTimeout(broadcastAlerts, 5000);
}

function triggerAlertBroadcast() {
    // Debounce: wait 2s to batch rapid changes
    if (triggerAlertBroadcast._timer) clearTimeout(triggerAlertBroadcast._timer);
    triggerAlertBroadcast._timer = setTimeout(broadcastAlerts, 2000);
}

module.exports = router;
module.exports.startAlertBroadcaster = startAlertBroadcaster;
module.exports.triggerAlertBroadcast = triggerAlertBroadcast;
module.exports.__boardTest = {
    buildPersistedDashboardConfig,
    normalizeDashboardConfig,
    persistenceContract: DASHBOARD_CONFIG_PERSISTENCE,
    sanitizeBoardState
};
