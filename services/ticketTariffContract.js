'use strict';

const {
    ROLE_LEVEL,
    canUseAction,
    normalizeRoleList
} = require('../middleware/auth');
const { canEditBooking } = require('./bookingVisibility');

const TICKET_MIGRATION_NUMBER = 300;
const TICKET_TARIFF_EFFECTIVE_FROM = '2026-07-14';
const TICKET_TIMEZONE = 'Europe/Kyiv';
const ROOM_TAKEAWAY_RESOURCE_ID = 'room-takeaway';

const ADMISSION_CONTEXTS = Object.freeze({
    STANDARD: 'standard',
    RESERVED_TABLE_ROOM: 'reserved_table_room'
});

const TICKET_DAY_TYPES = Object.freeze({
    WEEKDAY: 'weekday',
    WEEKEND: 'weekend'
});

const TICKET_AUDIENCE_CODES = Object.freeze({
    UNDER_3: 'under_3'
});

const TICKET_ROLE_FLOORS = Object.freeze({
    CATALOG_READ: 'manager',
    TARIFF_WRITE: 'senior_manager'
});

function cleanText(value) {
    return String(value || '').trim();
}

function normalizedContext(value) {
    return cleanText(value).toLowerCase();
}

function rowContext(row = {}) {
    const source = row && typeof row === 'object' ? row : {};
    return normalizedContext(source.business_context || source.businessContext);
}

function rowId(row = {}, ...keys) {
    const source = row && typeof row === 'object' ? row : {};
    for (const key of keys) {
        const value = cleanText(source[key]);
        if (value) return value;
    }
    return '';
}

function statusIsActive(value) {
    const status = cleanText(value).toLowerCase();
    return !['cancelled', 'canceled', 'inactive', 'deleted'].includes(status);
}

function booleanIsTrue(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function isIsoDate(value) {
    const input = cleanText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
    const date = new Date(`${input}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input;
}

function ticketDayType(visitDate) {
    if (!isIsoDate(visitDate)) {
        const error = new Error('Ticket visit date must use YYYY-MM-DD');
        error.code = 'TICKET_DATE_INVALID';
        throw error;
    }
    const day = new Date(`${visitDate}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6 ? TICKET_DAY_TYPES.WEEKEND : TICKET_DAY_TYPES.WEEKDAY;
}

function isTicketTariffContractEffective(visitDate) {
    if (!isIsoDate(visitDate)) return false;
    return visitDate >= TICKET_TARIFF_EFFECTIVE_FROM;
}

function ticketAvailability({ visitDate, audienceCode } = {}) {
    const dayType = ticketDayType(visitDate);
    const normalizedAudience = cleanText(audienceCode).toLowerCase();
    if (dayType === TICKET_DAY_TYPES.WEEKEND && normalizedAudience === TICKET_AUDIENCE_CODES.UNDER_3) {
        return Object.freeze({
            available: false,
            dayType,
            reason: 'under_3_weekend_unavailable'
        });
    }
    return Object.freeze({ available: true, dayType, reason: null });
}

function hasActiveBanquetFlowEvidence({ booking = {}, banquetMembership = {}, banquetGroup = {} } = {}) {
    const group = banquetGroup && typeof banquetGroup === 'object' ? banquetGroup : {};
    const bookingId = rowId(booking, 'id', 'booking_id', 'bookingId');
    const membershipBookingId = rowId(banquetMembership, 'booking_id', 'bookingId');
    const membershipGroupId = rowId(banquetMembership, 'group_id', 'groupId');
    const groupId = rowId(banquetGroup, 'id', 'group_id', 'groupId');
    const bookingBusinessContext = rowContext(booking);
    const membershipBusinessContext = rowContext(banquetMembership);
    const groupBusinessContext = rowContext(banquetGroup);

    return Boolean(
        bookingId
        && membershipBookingId === bookingId
        && membershipGroupId
        && groupId === membershipGroupId
        && bookingBusinessContext
        && membershipBusinessContext === bookingBusinessContext
        && groupBusinessContext === bookingBusinessContext
        && statusIsActive(group.status)
    );
}

function hasActivePhysicalRoomEvidence({ booking = {}, roomResource = {} } = {}) {
    const resource = roomResource && typeof roomResource === 'object' ? roomResource : {};
    const bookingResourceId = rowId(booking, 'room_resource_id', 'roomResourceId');
    const resourceId = rowId(roomResource, 'resource_id', 'resourceId', 'id');
    const bookingBusinessContext = rowContext(booking);
    const resourceBusinessContext = rowContext(roomResource);
    const resourceType = cleanText(resource.type).toLowerCase();
    const resourceIsActive = resource.is_active ?? resource.isActive;

    return Boolean(
        bookingResourceId
        && bookingResourceId !== ROOM_TAKEAWAY_RESOURCE_ID
        && resourceId === bookingResourceId
        && resourceId !== ROOM_TAKEAWAY_RESOURCE_ID
        && bookingBusinessContext
        && resourceBusinessContext === bookingBusinessContext
        && resourceType === 'room'
        && booleanIsTrue(resourceIsActive)
    );
}

function resolveAdmissionContext(serverEvidence = {}) {
    if (hasActiveBanquetFlowEvidence(serverEvidence) && hasActivePhysicalRoomEvidence(serverEvidence)) {
        return ADMISSION_CONTEXTS.RESERVED_TABLE_ROOM;
    }
    return ADMISSION_CONTEXTS.STANDARD;
}

function userHasMinimumRole(user, minimumRole) {
    const minimumLevel = ROLE_LEVEL[minimumRole];
    if (!Number.isInteger(minimumLevel)) return false;
    const maximumLevel = normalizeRoleList(user).reduce(
        (highest, role) => Math.max(highest, ROLE_LEVEL[role] ?? -1),
        -1
    );
    return maximumLevel >= minimumLevel;
}

function canReadTicketTariffCatalog(user) {
    return userHasMinimumRole(user, TICKET_ROLE_FLOORS.CATALOG_READ);
}

function canWriteTicketTariffs(user) {
    return userHasMinimumRole(user, TICKET_ROLE_FLOORS.TARIFF_WRITE);
}

function canQuoteTickets(user, booking) {
    return canUseAction(user, 'edit_booking') && canEditBooking(user, booking);
}

function resolveAppliedTariff({ baseTariff = null, specialTariffs = [] } = {}) {
    const eligibleSpecialTariffs = Array.isArray(specialTariffs)
        ? specialTariffs.filter(Boolean)
        : [];
    if (eligibleSpecialTariffs.length > 1) {
        const error = new Error('More than one special ticket tariff matched');
        error.code = 'TICKET_SPECIAL_TARIFF_AMBIGUOUS';
        throw error;
    }
    const tariff = eligibleSpecialTariffs[0] || baseTariff;
    if (!tariff) {
        const error = new Error('No ticket tariff matched');
        error.code = 'TICKET_TARIFF_UNAVAILABLE';
        throw error;
    }
    return Object.freeze({
        tariff,
        source: eligibleSpecialTariffs.length ? 'special_replacement' : 'base'
    });
}

module.exports = {
    ADMISSION_CONTEXTS,
    ROOM_TAKEAWAY_RESOURCE_ID,
    TICKET_AUDIENCE_CODES,
    TICKET_DAY_TYPES,
    TICKET_MIGRATION_NUMBER,
    TICKET_ROLE_FLOORS,
    TICKET_TARIFF_EFFECTIVE_FROM,
    TICKET_TIMEZONE,
    canQuoteTickets,
    canReadTicketTariffCatalog,
    canWriteTicketTariffs,
    hasActiveBanquetFlowEvidence,
    hasActivePhysicalRoomEvidence,
    isTicketTariffContractEffective,
    resolveAdmissionContext,
    resolveAppliedTariff,
    ticketAvailability,
    ticketDayType,
    userHasMinimumRole
};
