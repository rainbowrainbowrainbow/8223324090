'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { redactRevenueFields } = require('./revenueAccessPolicy');

// Keep canonical booking identities untouched. Unstructured notes/packages may
// contain customer contacts, so they are never part of the coordination DTO.
const COORDINATION_FIELDS = new Set([
    'id', 'businessContext', 'date', 'time', 'duration', 'lineId', 'resourceId',
    'resourceType', 'timelineIdentity', 'room', 'roomResourceId', 'linkedTo',
    'programId', 'programCode', 'programName', 'label', 'category', 'status',
    'updatedAt', 'updatedAtVersion', 'timelineCode', 'bookingLinks', 'banquetLinks'
]);
const WORK_FIELDS = new Set([
    ...COORDINATION_FIELDS, 'hosts', 'secondAnimator', 'costume', 'kidsCount',
    'banquetGuests', 'banquetAdults', 'banquetTables', 'pinataMode', 'pinataNumber'
]);
const IDENTITY_FIELDS = new Set([
    ...COORDINATION_FIELDS, 'bookingId', 'sourceBookingId', 'targetBookingId',
    'primaryBookingId', 'relationType', 'bookings', 'links', 'source'
]);

function retainFields(value, fields) {
    if (Array.isArray(value)) return value.map(item => retainFields(item, fields));
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => fields.has(key))
        .map(([key, item]) => [key, item && typeof item === 'object'
            ? retainFields(item, IDENTITY_FIELDS) : item]));
}

function shapeBookingFields(booking, user) {
    const allowed = key => resolveCapability(user, key, { type: 'action' }).allowed;
    const details = allowed('bookings.details.view');
    const contacts = allowed('bookings.contacts.view');
    const revenue = allowed('view_revenue');
    const fields = new Set(details ? WORK_FIELDS : COORDINATION_FIELDS);
    if (revenue) ['price', 'paymentMethod', 'deposit', 'total', 'amount'].forEach(key => fields.add(key));
    const visible = details && contacts ? booking : retainFields(booking, fields);
    return revenue ? visible : redactRevenueFields(visible);
}

function shapeBookingResponse(value, user) {
    if (Array.isArray(value)) return value.map(item => shapeBookingResponse(item, user));
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    if (value.document?.type === 'banquet_summary'
        && !resolveCapability(user, 'bookings.contacts.view').allowed) {
        const summary = {
            success: value.success, schemaVersion: value.schemaVersion, mode: value.mode,
            bookingId: value.bookingId, businessContext: value.businessContext,
            event: retainFields(value.event, COORDINATION_FIELDS),
            counts: value.counts
        };
        if (resolveCapability(user, 'view_revenue').allowed) summary.totals = value.totals;
        return summary;
    }
    if (value.id && value.date && value.time !== undefined) return shapeBookingFields(value, user);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeBookingResponse(item, user)]));
}

function installBookingFieldAccess(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const json = res.json.bind(res);
    res.json = value => json(shapeBookingResponse(value, req.user));
    return next();
}

module.exports = { shapeBookingFields, shapeBookingResponse, installBookingFieldAccess };
