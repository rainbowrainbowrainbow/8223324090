'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

function isParkCheckinJournalRoute(req) {
    return req.method === 'GET' && parkStaffScheduleRoutePath(req) === '/checkins';
}

function canReadParkCheckinJournal(req) {
    return isParkCheckinJournalRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.today.view', { type: 'action' }).allowed;
}

function checkinJournalDate(value, fallback) {
    const date = value === undefined ? fallback : value;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function projectParkCheckinJournal(payload) {
    if (payload?.success !== true) return payload;
    return {
        success: true,
        date: payload.date,
        data: Array.isArray(payload.data) ? payload.data.map(row => ({
            date: row.date,
            check_in_time: row.check_in_time,
            check_out_time: row.check_out_time,
            status: row.status,
            staff_name: row.staff_name
        })) : []
    };
}

module.exports = { isParkCheckinJournalRoute, canReadParkCheckinJournal,
    checkinJournalDate, projectParkCheckinJournal };
