'use strict';

const MAX_SAVED_TASK_VIEWS = 12;
const MAX_SAVED_VIEW_NAME_LENGTH = 64;
const MAX_SAVED_VIEW_SEARCH_LENGTH = 120;
const SAVED_VIEW_MODES = new Set(['overview', 'team', 'planning', 'library']);
const SAVED_VIEW_QUEUES = new Set(['inbox', 'today', 'my', 'done_today', 'waiting', 'team', 'next', 'week', 'deferred', 'board', 'routines', 'templates', 'archive', 'overdue', 'unassigned', 'blocked', 'stale', 'no_date']);
const SAVED_VIEW_STATUSES = new Set(['todo', 'in_progress', 'waiting', 'scheduled', 'done', 'archived', 'cancelled']);
const SAVED_VIEW_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);
const SAVED_VIEW_SOURCES = new Set(['manual', 'booking', 'lead', 'customer', 'event', 'order', 'hr', 'finance', 'automation']);
const SAVED_VIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function savedViewsError(message, code = 'TASK_SAVED_VIEWS_INVALID') {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = code;
    return error;
}

function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function uniqueAllowed(values, allowed) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(value => String(value || '').trim()).filter(value => allowed.has(value)))];
}

function normalizedDate(value, field) {
    if (value === undefined || value === null || value === '') return null;
    const date = String(value).trim();
    if (!DATE_KEY.test(date)) throw savedViewsError(`${field} must use YYYY-MM-DD`);
    return date;
}

function normalizeSavedTaskView(input = {}) {
    const view = asPlainObject(input);
    if (!view) throw savedViewsError('Saved view must be an object');
    const id = String(view.id || '').trim();
    const name = String(view.name || '').trim();
    if (!SAVED_VIEW_ID.test(id)) throw savedViewsError('Saved view id must be a UUID');
    if (!name || name.length > MAX_SAVED_VIEW_NAME_LENGTH) throw savedViewsError(`Saved view name must be 1-${MAX_SAVED_VIEW_NAME_LENGTH} characters`);
    const rawState = asPlainObject(view.state);
    if (!rawState) throw savedViewsError('Saved view state is required');
    const mode = String(rawState.mode || '').trim();
    const queue = String(rawState.queue || rawState.view || '').trim();
    if (mode && !SAVED_VIEW_MODES.has(mode)) throw savedViewsError('Saved view mode is invalid');
    if (queue && !SAVED_VIEW_QUEUES.has(queue)) throw savedViewsError('Saved view queue is invalid');
    const ownerUserId = rawState.ownerUserId ?? rawState.owner_user_id;
    const owner = ownerUserId === undefined || ownerUserId === null || ownerUserId === '' ? null : Number(ownerUserId);
    if (owner !== null && (!Number.isInteger(owner) || owner <= 0)) throw savedViewsError('Saved view owner must be a positive integer');
    const dateFrom = normalizedDate(rawState.dateFrom ?? rawState.date_from, 'dateFrom');
    const dateTo = normalizedDate(rawState.dateTo ?? rawState.date_to, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw savedViewsError('Saved view date range is invalid');
    const category = String(rawState.category || '').trim().toLowerCase();
    const source = String(rawState.source || '').trim().toLowerCase();
    const search = String(rawState.search || '').trim();
    if (category && !/^[a-z_]{2,48}$/.test(category)) throw savedViewsError('Saved view category is invalid');
    if (source && !SAVED_VIEW_SOURCES.has(source)) throw savedViewsError('Saved view source is invalid');
    if (search.length > MAX_SAVED_VIEW_SEARCH_LENGTH) throw savedViewsError(`Saved view search must be at most ${MAX_SAVED_VIEW_SEARCH_LENGTH} characters`);
    return {
        id,
        name,
        state: {
            ...(mode ? { mode } : {}),
            ...(queue ? { queue } : {}),
            ...(owner ? { ownerUserId: owner } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
            ...(uniqueAllowed(rawState.status, SAVED_VIEW_STATUSES).length ? { status: uniqueAllowed(rawState.status, SAVED_VIEW_STATUSES) } : {}),
            ...(uniqueAllowed(rawState.priority, SAVED_VIEW_PRIORITIES).length ? { priority: uniqueAllowed(rawState.priority, SAVED_VIEW_PRIORITIES) } : {}),
            ...(category ? { category } : {}),
            ...(source ? { source } : {}),
            ...(search ? { search } : {})
        }
    };
}

function normalizeSavedTaskViews(input) {
    if (!Array.isArray(input)) throw savedViewsError('savedTaskViews must be an array');
    if (input.length > MAX_SAVED_TASK_VIEWS) throw savedViewsError(`A user can save at most ${MAX_SAVED_TASK_VIEWS} task views`);
    const views = input.map(normalizeSavedTaskView);
    const ids = new Set(views.map(view => view.id));
    if (ids.size !== views.length) throw savedViewsError('Saved view ids must be unique');
    return views;
}

function taskSavedViewsFromPreferences(preferences = {}) {
    const raw = preferences.saved_task_views ?? preferences.savedTaskViews;
    const views = Array.isArray(raw) ? raw : [];
    return {
        savedTaskViews: views,
        savedTaskViewsRevision: Math.max(0, Number(preferences.saved_task_views_revision ?? preferences.savedTaskViewsRevision ?? 0) || 0)
    };
}

function savedViewsPatchFromBody(body = {}) {
    const rawViews = body.saved_task_views !== undefined ? body.saved_task_views : body.savedTaskViews;
    if (rawViews === undefined) return null;
    const rawRevision = body.saved_task_views_revision !== undefined ? body.saved_task_views_revision : body.savedTaskViewsRevision;
    const revision = Number(rawRevision);
    if (!Number.isInteger(revision) || revision < 0) throw savedViewsError('savedTaskViewsRevision is required');
    return { views: normalizeSavedTaskViews(rawViews), revision };
}

module.exports = {
    MAX_SAVED_TASK_VIEWS,
    SAVED_VIEW_MODES,
    SAVED_VIEW_QUEUES,
    normalizeSavedTaskView,
    normalizeSavedTaskViews,
    savedViewsPatchFromBody,
    taskSavedViewsFromPreferences
};
