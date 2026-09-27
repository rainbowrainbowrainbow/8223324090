'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

const PARK_ONBOARDING_PATHS = new Set([
    '/onboarding',
    '/onboarding/templates',
    '/onboarding/responsible-candidates'
]);

function isParkHrOnboardingRoute(req) {
    return req.method === 'GET' && PARK_ONBOARDING_PATHS.has(parkStaffScheduleRoutePath(req));
}

function canReadParkHrOnboarding(req) {
    return isParkHrOnboardingRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.staff.view', { type: 'action' }).allowed;
}

function pick(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

function projectProgress(value) {
    const progress = pick(value, [
        'id', 'staff_id', 'staff_name', 'department', 'template_id', 'template_name',
        'scope', 'status', 'training_status', 'started_at', 'completed_at',
        'responsible_name', 'responsible_restricted',
        'completed_items', 'total_items', 'percent'
    ]);
    progress.items = Array.isArray(value?.items)
        ? value.items.map(item => pick(item, ['id', 'key', 'title', 'done'])).filter(item => item.title) : [];
    progress.task_summary = pick(value?.task_summary, ['total', 'active', 'completed']);
    return progress;
}

function projectParkHrOnboardingPayload(path, payload) {
    if (payload?.success !== true) return payload;
    if (path === '/onboarding') {
        return { success: true, data: Array.isArray(payload.data) ? payload.data.map(projectProgress) : [],
            onboardingAccess: { readOnly: true, partial: true, scope: 'general' } };
    }
    if (path === '/onboarding/templates') {
        return { success: true, data: Array.isArray(payload.data)
            ? payload.data.map(row => pick(row, ['id', 'name', 'department'])) : [] };
    }
    if (path === '/onboarding/responsible-candidates') {
        return { success: true, data: Array.isArray(payload.data)
            ? payload.data.map(row => ({ id: row.id, name: row.name || null,
                label: String(row.name || '').trim() || 'Відповідальний' })) : [] };
    }
    return payload;
}

module.exports = {
    isParkHrOnboardingRoute,
    canReadParkHrOnboarding,
    projectParkHrOnboardingPayload
};
