'use strict';

const {
    ADMISSION_CONTEXTS,
    ROOM_TAKEAWAY_RESOURCE_ID,
    TICKET_DAY_TYPES,
    resolveAdmissionContext,
    ticketDayType
} = require('./ticketTariffContract');
const { normalizeBusinessContext } = require('./businessContext');

const CURRENCY = 'UAH';
const TICKET_AVAILABILITY = Object.freeze({
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable'
});
const TICKET_TYPE_CODES = Object.freeze([
    'regular_child',
    'under_3_child',
    'discounted_child',
    'birthday_child',
    'adult_companion',
    'adult_game'
]);
const MANUAL_TICKET_TYPE_CODES = Object.freeze([
    'birthday_child',
    'under_3_child',
    'discounted_child',
    'adult_game'
]);
const REMAINDER_TICKET_TYPE_CODES = Object.freeze([
    'regular_child',
    'adult_companion'
]);
const FORBIDDEN_QUOTE_FIELDS = Object.freeze([
    'regularChild',
    'regular_child',
    'adultCompanion',
    'adult_companion',
    'unitPrice',
    'unit_price',
    'unitPriceUah',
    'unit_price_uah',
    'subtotal',
    'subtotalUah',
    'subtotal_uah',
    'ticketName',
    'ticket_name',
    'audience',
    'admissionContext',
    'admission_context',
    'tariffVersion',
    'tariff_version',
    'tariffVersionId',
    'tariff_version_id',
    'ticketLines',
    'ticket_lines'
]);

class AdmissionTicketError extends Error {
    constructor(message, { status = 400, code = 'ADMISSION_TICKET_ERROR', details = null } = {}) {
        super(message);
        this.name = 'AdmissionTicketError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function hasOwn(source, key) {
    return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function cleanText(value, maxLength = 500) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function toDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const text = cleanText(value, 32);
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : null;
}

function requireDateOnly(value, field = 'date') {
    const date = toDateOnly(value);
    if (!date || date !== cleanText(value, 32)) {
        throw new AdmissionTicketError(`${field} must use YYYY-MM-DD`, {
            status: 422,
            code: 'TICKET_DATE_INVALID',
            details: { field }
        });
    }
    try {
        ticketDayType(date);
    } catch {
        throw new AdmissionTicketError(`${field} must be a valid calendar date`, {
            status: 422,
            code: 'TICKET_DATE_INVALID',
            details: { field }
        });
    }
    return date;
}

function requireNonNegativeInteger(value, field) {
    if (!Number.isInteger(value) || value < 0) {
        throw new AdmissionTicketError(`${field} must be a non-negative integer`, {
            status: 422,
            code: 'TICKET_QUANTITY_INVALID',
            details: { field }
        });
    }
    return value;
}

function money(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function assertNoTrustedPricingFields(input = {}) {
    for (const key of FORBIDDEN_QUOTE_FIELDS) {
        if (hasOwn(input, key)) {
            throw new AdmissionTicketError(`Client field ${key} is not accepted for ticket pricing`, {
                status: 422,
                code: 'TICKET_PRICING_FIELD_FORBIDDEN',
                details: { field: key }
            });
        }
    }
}

function normalizeManualTicketQuantities(value) {
    if (value === undefined || value === null) {
        return Object.fromEntries(MANUAL_TICKET_TYPE_CODES.map(code => [code, 0]));
    }
    if (!Array.isArray(value)) {
        throw new AdmissionTicketError('ticketQuantities must be an array', {
            status: 422,
            code: 'TICKET_QUANTITIES_INVALID'
        });
    }

    const quantities = Object.fromEntries(MANUAL_TICKET_TYPE_CODES.map(code => [code, 0]));
    const seen = new Set();
    for (const [index, item] of value.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new AdmissionTicketError('Each ticket quantity must be an object', {
                status: 422,
                code: 'TICKET_QUANTITIES_INVALID',
                details: { index }
            });
        }
        assertNoTrustedPricingFields(item);
        const code = cleanText(item.code || item.ticketTypeCode || item.ticket_type_code, 64);
        if (!code || !MANUAL_TICKET_TYPE_CODES.includes(code)) {
            throw new AdmissionTicketError(`Unknown or non-manual ticket type: ${code || '(empty)'}`, {
                status: 422,
                code: 'TICKET_TYPE_UNKNOWN',
                details: { index, code: code || null }
            });
        }
        if (seen.has(code)) {
            throw new AdmissionTicketError(`Duplicate ticket type: ${code}`, {
                status: 422,
                code: 'TICKET_TYPE_DUPLICATE',
                details: { index, code }
            });
        }
        seen.add(code);
        quantities[code] = requireNonNegativeInteger(item.quantity, `ticketQuantities[${index}].quantity`);
    }
    return quantities;
}

function deriveTicketQuantities({ banquetGuests, banquetAdults, manualQuantities }) {
    const guests = requireNonNegativeInteger(banquetGuests, 'banquetGuests');
    const adults = requireNonNegativeInteger(banquetAdults, 'banquetAdults');
    const manual = normalizeManualTicketQuantities(
        MANUAL_TICKET_TYPE_CODES.map(code => ({ code, quantity: manualQuantities?.[code] ?? 0 }))
    );
    const specialChildren = manual.birthday_child
        + manual.under_3_child
        + manual.discounted_child;
    if (specialChildren > guests) {
        throw new AdmissionTicketError('Special child ticket total exceeds banquetGuests', {
            status: 422,
            code: 'TICKET_CHILD_TOTAL_EXCEEDED',
            details: { banquetGuests: guests, specialChildTotal: specialChildren }
        });
    }
    if (manual.adult_game > adults) {
        throw new AdmissionTicketError('adult_game exceeds banquetAdults', {
            status: 422,
            code: 'TICKET_ADULT_TOTAL_EXCEEDED',
            details: { banquetAdults: adults, adultGame: manual.adult_game }
        });
    }
    return Object.freeze({
        regular_child: guests - specialChildren,
        under_3_child: manual.under_3_child,
        discounted_child: manual.discounted_child,
        birthday_child: manual.birthday_child,
        adult_companion: adults - manual.adult_game,
        adult_game: manual.adult_game
    });
}

function mapTicketTypeRow(row = {}) {
    return {
        id: Number(row.id),
        businessContext: row.business_context,
        code: row.code,
        name: row.name,
        audience: row.audience,
        allocationStrategy: row.allocation_strategy,
        requirementText: row.requirement_text || null,
        isSystem: row.is_system === true,
        isActive: row.is_active === true,
        sortOrder: Number(row.sort_order || 0),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapTariffVersionRow(row = {}) {
    if (!row.id && !row.tariff_version_id) return null;
    return {
        id: Number(row.id || row.tariff_version_id),
        ticketTypeId: Number(row.ticket_type_id),
        admissionContext: row.admission_context,
        dayType: row.day_type,
        availability: row.availability,
        amountUah: row.amount_uah === null || row.amount_uah === undefined
            ? null
            : money(row.amount_uah),
        effectiveFrom: toDateOnly(row.effective_from),
        revision: Number(row.revision),
        createdBy: row.created_by || null,
        createdAt: row.created_at || null,
        changeNote: row.change_note || null
    };
}

async function listAdmissionTicketCatalog(queryable, {
    businessContext,
    pricingDate = new Date().toISOString().slice(0, 10)
} = {}) {
    const context = normalizeBusinessContext(businessContext);
    const date = requireDateOnly(pricingDate, 'pricingDate');
    const result = await queryable.query(
        `SELECT
             ticket_type.id,
             ticket_type.business_context,
             ticket_type.code,
             ticket_type.name,
             ticket_type.audience,
             ticket_type.allocation_strategy,
             ticket_type.requirement_text,
             ticket_type.is_system,
             ticket_type.is_active,
             ticket_type.sort_order,
             ticket_type.created_at,
             ticket_type.updated_at,
             tariff.id AS tariff_version_id,
             tariff.ticket_type_id,
             tariff.admission_context,
             tariff.day_type,
             tariff.availability,
             tariff.amount_uah,
             tariff.effective_from,
             tariff.revision,
             tariff.created_by,
             tariff.created_at AS tariff_created_at,
             tariff.change_note
         FROM admission_ticket_types ticket_type
         LEFT JOIN admission_ticket_tariff_versions tariff
           ON tariff.ticket_type_id = ticket_type.id
         WHERE ticket_type.business_context = $1
         ORDER BY
             ticket_type.sort_order,
             ticket_type.code,
             tariff.admission_context,
             tariff.day_type,
             tariff.effective_from DESC,
             tariff.revision DESC`,
        [context]
    );

    const byId = new Map();
    for (const row of result.rows) {
        const typeId = Number(row.id);
        if (!byId.has(typeId)) {
            byId.set(typeId, {
                ...mapTicketTypeRow(row),
                currentTariffs: [],
                tariffHistory: []
            });
        }
        if (!row.tariff_version_id) continue;
        const version = mapTariffVersionRow({
            id: row.tariff_version_id,
            ticket_type_id: row.ticket_type_id,
            admission_context: row.admission_context,
            day_type: row.day_type,
            availability: row.availability,
            amount_uah: row.amount_uah,
            effective_from: row.effective_from,
            revision: row.revision,
            created_by: row.created_by,
            created_at: row.tariff_created_at,
            change_note: row.change_note
        });
        const type = byId.get(typeId);
        type.tariffHistory.push(version);
        if (
            version.effectiveFrom <= date
            && !type.currentTariffs.some(item => (
                item.admissionContext === version.admissionContext
                && item.dayType === version.dayType
            ))
        ) {
            type.currentTariffs.push(version);
        }
    }

    return {
        businessContext: context,
        pricingDate: date,
        currency: CURRENCY,
        ticketTypes: [...byId.values()]
    };
}

function validateTariffMutation(input = {}) {
    const admissionContext = cleanText(input.admissionContext || input.admission_context, 32);
    const dayType = cleanText(input.dayType || input.day_type, 16);
    const availability = cleanText(input.availability, 16);
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    const effectiveFrom = requireDateOnly(
        input.effectiveFrom || input.effective_from,
        'effectiveFrom'
    );
    if (!Object.values(ADMISSION_CONTEXTS).includes(admissionContext)) {
        throw new AdmissionTicketError('Unknown admissionContext', {
            status: 422,
            code: 'TICKET_ADMISSION_CONTEXT_INVALID'
        });
    }
    if (!Object.values(TICKET_DAY_TYPES).includes(dayType)) {
        throw new AdmissionTicketError('Unknown dayType', {
            status: 422,
            code: 'TICKET_DAY_TYPE_INVALID'
        });
    }
    if (!Object.values(TICKET_AVAILABILITY).includes(availability)) {
        throw new AdmissionTicketError('Unknown availability', {
            status: 422,
            code: 'TICKET_AVAILABILITY_INVALID'
        });
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new AdmissionTicketError('expectedRevision must be a non-negative integer', {
            status: 422,
            code: 'TICKET_EXPECTED_REVISION_INVALID'
        });
    }

    const rawAmount = input.amountUah ?? input.amount_uah;
    const amountUah = rawAmount === null || rawAmount === undefined || rawAmount === ''
        ? null
        : Number(rawAmount);
    if (
        availability === TICKET_AVAILABILITY.AVAILABLE
        && (!Number.isFinite(amountUah) || amountUah < 0)
    ) {
        throw new AdmissionTicketError('Available tariff requires amountUah >= 0', {
            status: 422,
            code: 'TICKET_AMOUNT_INVALID'
        });
    }
    if (availability === TICKET_AVAILABILITY.UNAVAILABLE && amountUah !== null) {
        throw new AdmissionTicketError('Unavailable tariff requires amountUah = null', {
            status: 422,
            code: 'TICKET_AMOUNT_INVALID'
        });
    }
    return {
        admissionContext,
        dayType,
        availability,
        amountUah: amountUah === null ? null : money(amountUah),
        effectiveFrom,
        expectedRevision,
        changeNote: cleanText(input.changeNote || input.change_note, 1000) || null
    };
}

async function appendAdmissionTicketTariffVersion(db, {
    businessContext,
    code,
    actor,
    input
} = {}) {
    const context = normalizeBusinessContext(businessContext);
    const ticketCode = cleanText(code, 64);
    const username = cleanText(actor, 100);
    if (!username) {
        throw new AdmissionTicketError('Tariff actor is required', {
            status: 422,
            code: 'TICKET_ACTOR_REQUIRED'
        });
    }
    const mutation = validateTariffMutation(input);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ticketTypeResult = await client.query(
            `SELECT *
             FROM admission_ticket_types
             WHERE business_context = $1
               AND code = $2
             FOR UPDATE`,
            [context, ticketCode]
        );
        const ticketType = ticketTypeResult.rows[0];
        if (!ticketType) {
            throw new AdmissionTicketError('Ticket type not found', {
                status: 404,
                code: 'TICKET_TYPE_NOT_FOUND'
            });
        }
        if (ticketType.is_active !== true) {
            throw new AdmissionTicketError('Ticket type is inactive', {
                status: 409,
                code: 'TICKET_TYPE_INACTIVE'
            });
        }

        const currentResult = await client.query(
            `SELECT *
             FROM admission_ticket_tariff_versions
             WHERE ticket_type_id = $1
               AND admission_context = $2
               AND day_type = $3
             ORDER BY revision DESC
             LIMIT 1`,
            [ticketType.id, mutation.admissionContext, mutation.dayType]
        );
        const oldTariff = currentResult.rows[0] || null;
        const currentRevision = Number(oldTariff?.revision || 0);
        if (mutation.expectedRevision !== currentRevision) {
            throw new AdmissionTicketError('Tariff was changed by another editor', {
                status: 409,
                code: 'TICKET_TARIFF_REVISION_CONFLICT',
                details: {
                    expectedRevision: mutation.expectedRevision,
                    currentRevision,
                    currentTariff: oldTariff ? mapTariffVersionRow(oldTariff) : null
                }
            });
        }

        const inserted = await client.query(
            `INSERT INTO admission_ticket_tariff_versions (
                 ticket_type_id,
                 admission_context,
                 day_type,
                 availability,
                 amount_uah,
                 effective_from,
                 revision,
                 created_by,
                 change_note
             )
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
             RETURNING *`,
            [
                ticketType.id,
                mutation.admissionContext,
                mutation.dayType,
                mutation.availability,
                mutation.amountUah,
                mutation.effectiveFrom,
                currentRevision + 1,
                username,
                mutation.changeNote
            ]
        );
        const newTariff = inserted.rows[0];
        await client.query(
            `INSERT INTO admission_ticket_tariff_audit (
                 ticket_type_id,
                 business_context,
                 ticket_type_code,
                 admission_context,
                 day_type,
                 old_tariff_version_id,
                 new_tariff_version_id,
                 old_availability,
                 new_availability,
                 old_amount_uah,
                 new_amount_uah,
                 effective_from,
                 actor,
                 change_note
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14)`,
            [
                ticketType.id,
                context,
                ticketCode,
                mutation.admissionContext,
                mutation.dayType,
                oldTariff?.id || null,
                newTariff.id,
                oldTariff?.availability || null,
                newTariff.availability,
                oldTariff?.amount_uah ?? null,
                newTariff.amount_uah,
                mutation.effectiveFrom,
                username,
                mutation.changeNote
            ]
        );
        await client.query('COMMIT');
        return {
            ticketType: mapTicketTypeRow(ticketType),
            previousTariff: oldTariff ? mapTariffVersionRow(oldTariff) : null,
            tariff: mapTariffVersionRow(newTariff)
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function bookingPackageFromBooking(booking = {}) {
    const rawExtra = booking.extra_data ?? booking.extraData;
    let extra = rawExtra;
    if (typeof extra === 'string') {
        try {
            extra = JSON.parse(extra);
        } catch {
            extra = {};
        }
    }
    extra = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function readAdmissionTicketSnapshot(booking = {}) {
    const bookingPackage = bookingPackageFromBooking(booking);
    const ticketLines = bookingPackage.ticketLines || bookingPackage.ticket_lines;
    if (Array.isArray(ticketLines)) {
        const normalizedLines = ticketLines
            .filter(line => line && typeof line === 'object')
            .map(line => ({
                ticketTypeId: Number(line.ticketTypeId || line.ticket_type_id),
                ticketTypeCode: cleanText(line.ticketTypeCode || line.ticket_type_code, 64),
                ticketTypeName: cleanText(line.ticketTypeName || line.ticket_type_name, 160),
                audience: cleanText(line.audience, 16),
                quantity: Number(line.quantity),
                unitPriceUah: money(line.unitPriceUah ?? line.unit_price_uah),
                subtotalUah: money(line.subtotalUah ?? line.subtotal_uah),
                tariffVersionId: Number(line.tariffVersionId || line.tariff_version_id),
                effectiveFrom: toDateOnly(line.effectiveFrom || line.effective_from),
                admissionContext: cleanText(line.admissionContext || line.admission_context, 32),
                dayType: cleanText(line.dayType || line.day_type, 16),
                currency: cleanText(line.currency, 8) || CURRENCY
            }))
            .filter(line => TICKET_TYPE_CODES.includes(line.ticketTypeCode));
        return {
            kind: 'v3',
            schemaVersion: Number(bookingPackage.schemaVersion || bookingPackage.schema_version || 3),
            ticketLines: normalizedLines,
            ticketSubtotal: money(
                bookingPackage.ticketSubtotal
                ?? bookingPackage.ticket_subtotal
                ?? normalizedLines.reduce((sum, line) => sum + line.subtotalUah, 0)
            ),
            manualQuantities: Object.fromEntries(MANUAL_TICKET_TYPE_CODES.map(code => [
                code,
                normalizedLines.find(line => line.ticketTypeCode === code)?.quantity || 0
            ]))
        };
    }

    const entryCharge = bookingPackage.entryCharge || bookingPackage.entry_charge;
    if (entryCharge && typeof entryCharge === 'object') {
        const quantity = Number(entryCharge.quantity);
        const unitPrice = Number(entryCharge.unitPrice ?? entryCharge.unit_price);
        const subtotal = Number(
            bookingPackage.entrySubtotal
            ?? bookingPackage.entry_subtotal
            ?? entryCharge.subtotal
            ?? (quantity * unitPrice)
        );
        return {
            kind: 'legacy',
            schemaVersion: Number(bookingPackage.schemaVersion || bookingPackage.schema_version || 2),
            ticketLines: [{
                ticketTypeId: null,
                ticketTypeCode: 'regular_child',
                ticketTypeName: 'Вхід (legacy)',
                audience: 'child',
                quantity: Number.isFinite(quantity) ? quantity : 0,
                unitPriceUah: Number.isFinite(unitPrice) ? money(unitPrice) : 0,
                subtotalUah: Number.isFinite(subtotal) ? money(subtotal) : 0,
                tariffVersionId: null,
                effectiveFrom: null,
                admissionContext: null,
                dayType: null,
                currency: CURRENCY
            }],
            ticketSubtotal: Number.isFinite(subtotal) ? money(subtotal) : 0,
            manualQuantities: Object.fromEntries(MANUAL_TICKET_TYPE_CODES.map(code => [code, 0])),
            requiresExplicitConversion: true
        };
    }
    return null;
}

async function loadRoomResource(queryable, businessContext, roomResourceId) {
    const resourceId = cleanText(roomResourceId, 100);
    if (!resourceId || resourceId === ROOM_TAKEAWAY_RESOURCE_ID) return null;
    const result = await queryable.query(
        `SELECT resource_id, business_context, type, is_active
         FROM timeline_resources
         WHERE business_context = $1
           AND resource_id = $2
         LIMIT 1`,
        [businessContext, resourceId]
    );
    return result.rows[0] || null;
}

async function loadExistingBanquetEvidence(queryable, bookingId, businessContext) {
    const result = await queryable.query(
        `SELECT
             membership.booking_id,
             membership.group_id,
             membership.business_context,
             banquet_group.id AS banquet_group_id,
             banquet_group.business_context AS banquet_group_business_context,
             banquet_group.status AS banquet_group_status
         FROM banquet_group_bookings membership
         JOIN banquet_groups banquet_group
           ON banquet_group.id = membership.group_id
          AND banquet_group.business_context = membership.business_context
         WHERE membership.booking_id = $1
           AND membership.business_context = $2
         LIMIT 1`,
        [bookingId, businessContext]
    );
    const row = result.rows[0];
    if (!row) return { banquetMembership: null, banquetGroup: null };
    return {
        banquetMembership: {
            booking_id: row.booking_id,
            group_id: row.group_id,
            business_context: row.business_context
        },
        banquetGroup: {
            id: row.banquet_group_id,
            business_context: row.banquet_group_business_context,
            status: row.banquet_group_status
        }
    };
}

async function resolveServerAdmissionContext(queryable, {
    booking,
    businessContext,
    roomResourceId,
    newBanquetFlow = false
} = {}) {
    const context = normalizeBusinessContext(businessContext);
    const bookingId = cleanText(booking?.id, 100) || '__new_ticket_quote__';
    const candidateBooking = {
        ...booking,
        id: bookingId,
        business_context: context,
        room_resource_id: cleanText(roomResourceId, 100) || null
    };
    const roomResource = await loadRoomResource(
        queryable,
        context,
        candidateBooking.room_resource_id
    );
    const evidence = booking?.id
        ? await loadExistingBanquetEvidence(queryable, booking.id, context)
        : (
            newBanquetFlow
                ? {
                    banquetMembership: {
                        booking_id: bookingId,
                        group_id: '__new_ticket_group__',
                        business_context: context
                    },
                    banquetGroup: {
                        id: '__new_ticket_group__',
                        business_context: context,
                        status: 'active'
                    }
                }
                : { banquetMembership: null, banquetGroup: null }
        );
    return resolveAdmissionContext({
        booking: candidateBooking,
        banquetMembership: evidence.banquetMembership,
        banquetGroup: evidence.banquetGroup,
        roomResource
    });
}

async function loadQuoteTariffs(queryable, {
    businessContext,
    admissionContext,
    dayType,
    pricingDate
} = {}) {
    const result = await queryable.query(
        `SELECT
             ticket_type.id AS ticket_type_id,
             ticket_type.code,
             ticket_type.name,
             ticket_type.audience,
             ticket_type.allocation_strategy,
             ticket_type.requirement_text,
             ticket_type.is_active,
             tariff.id AS tariff_version_id,
             tariff.admission_context,
             tariff.day_type,
             tariff.availability,
             tariff.amount_uah,
             tariff.effective_from,
             tariff.revision
         FROM admission_ticket_types ticket_type
         LEFT JOIN LATERAL (
             SELECT version.*
             FROM admission_ticket_tariff_versions version
             WHERE version.ticket_type_id = ticket_type.id
               AND version.admission_context = $2
               AND version.day_type = $3
               AND version.effective_from <= $4::date
             ORDER BY version.effective_from DESC, version.revision DESC
             LIMIT 1
         ) tariff ON true
         WHERE ticket_type.business_context = $1
           AND ticket_type.code = ANY($5::text[])
         ORDER BY ticket_type.sort_order, ticket_type.code`,
        [
            normalizeBusinessContext(businessContext),
            admissionContext,
            dayType,
            pricingDate,
            TICKET_TYPE_CODES
        ]
    );
    const byCode = new Map(result.rows.map(row => [row.code, row]));
    const missingTypes = TICKET_TYPE_CODES.filter(code => !byCode.has(code));
    const missingTariffs = TICKET_TYPE_CODES.filter(code => (
        byCode.has(code) && !byCode.get(code).tariff_version_id
    ));
    if (missingTypes.length || missingTariffs.length) {
        throw new AdmissionTicketError('Ticket tariff configuration is incomplete', {
            status: 503,
            code: 'TICKET_TARIFF_MISSING',
            details: { missingTypes, missingTariffs, admissionContext, dayType, pricingDate }
        });
    }
    return byCode;
}

function manualQuantitiesFromSnapshot(snapshot) {
    return Object.fromEntries(MANUAL_TICKET_TYPE_CODES.map(code => [
        code,
        snapshot?.manualQuantities?.[code] || 0
    ]));
}

async function resolveAdmissionTicketQuote({
    queryable,
    businessContext,
    input = {},
    existingBooking = null,
    newBanquetFlow = false,
    now = new Date()
} = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new TypeError('resolveAdmissionTicketQuote requires a queryable');
    }
    assertNoTrustedPricingFields(input);
    const context = normalizeBusinessContext(businessContext);
    const snapshot = existingBooking ? readAdmissionTicketSnapshot(existingBooking) : null;
    const explicitQuantities = hasOwn(input, 'ticketQuantities')
        || hasOwn(input, 'ticket_quantities');
    if (
        snapshot?.kind === 'legacy'
        && !explicitQuantities
        && input.convertLegacy !== true
        && input.convert_legacy !== true
    ) {
        return {
            legacy: true,
            requiresExplicitConversion: true,
            currency: CURRENCY,
            ticketLines: snapshot.ticketLines,
            ticketSubtotal: snapshot.ticketSubtotal,
            pricedAt: null
        };
    }

    const pricingDate = requireDateOnly(
        input.date ?? existingBooking?.date,
        'date'
    );
    const banquetGuests = input.banquetGuests
        ?? input.banquet_guests
        ?? existingBooking?.banquet_guests;
    const banquetAdults = input.banquetAdults
        ?? input.banquet_adults
        ?? existingBooking?.banquet_adults;
    const kidsCount = input.kidsCount
        ?? input.kids_count
        ?? existingBooking?.kids_count;
    const guests = requireNonNegativeInteger(Number(banquetGuests), 'banquetGuests');
    const adults = requireNonNegativeInteger(Number(banquetAdults), 'banquetAdults');
    if (
        kidsCount !== null
        && kidsCount !== undefined
        && cleanText(kidsCount, 32) !== ''
        && Number(kidsCount) !== guests
    ) {
        throw new AdmissionTicketError('kids_count conflicts with banquet_guests', {
            status: 422,
            code: 'TICKET_GUEST_COUNT_CONFLICT',
            details: { kidsCount: Number(kidsCount), banquetGuests: guests }
        });
    }

    const manualQuantities = explicitQuantities
        ? normalizeManualTicketQuantities(input.ticketQuantities ?? input.ticket_quantities)
        : manualQuantitiesFromSnapshot(snapshot);
    const quantities = deriveTicketQuantities({
        banquetGuests: guests,
        banquetAdults: adults,
        manualQuantities
    });
    const roomResourceId = input.roomResourceId
        ?? input.room_resource_id
        ?? existingBooking?.room_resource_id;
    const admissionContext = await resolveServerAdmissionContext(queryable, {
        booking: existingBooking,
        businessContext: context,
        roomResourceId,
        newBanquetFlow
    });
    const dayType = ticketDayType(pricingDate);
    const tariffs = await loadQuoteTariffs(queryable, {
        businessContext: context,
        admissionContext,
        dayType,
        pricingDate
    });

    const ticketLines = [];
    for (const code of TICKET_TYPE_CODES) {
        const quantity = quantities[code];
        const row = tariffs.get(code);
        if (row.is_active !== true && quantity > 0) {
            throw new AdmissionTicketError(`${row.name} is inactive`, {
                status: 422,
                code: 'TICKET_TYPE_INACTIVE',
                details: { ticketTypeCode: code }
            });
        }
        if (row.availability === TICKET_AVAILABILITY.UNAVAILABLE) {
            if (quantity > 0) {
                throw new AdmissionTicketError(`${row.name} is unavailable for ${dayType}`, {
                    status: 422,
                    code: 'TICKET_TYPE_UNAVAILABLE',
                    details: { ticketTypeCode: code, dayType, admissionContext }
                });
            }
            continue;
        }
        if (quantity <= 0) continue;
        const unitPriceUah = money(row.amount_uah);
        ticketLines.push({
            ticketTypeId: Number(row.ticket_type_id),
            ticketTypeCode: code,
            ticketTypeName: row.name,
            audience: row.audience,
            quantity,
            unitPriceUah,
            subtotalUah: money(quantity * unitPriceUah),
            tariffVersionId: Number(row.tariff_version_id),
            effectiveFrom: toDateOnly(row.effective_from),
            admissionContext,
            dayType,
            currency: CURRENCY
        });
    }
    return {
        legacy: false,
        ticketLines,
        ticketSubtotal: money(ticketLines.reduce((sum, line) => sum + line.subtotalUah, 0)),
        admissionContext,
        dayType,
        pricingDate,
        pricedAt: now.toISOString(),
        currency: CURRENCY,
        normalizedQuantities: quantities
    };
}

module.exports = {
    AdmissionTicketError,
    CURRENCY,
    FORBIDDEN_QUOTE_FIELDS,
    MANUAL_TICKET_TYPE_CODES,
    REMAINDER_TICKET_TYPE_CODES,
    TICKET_AVAILABILITY,
    TICKET_TYPE_CODES,
    appendAdmissionTicketTariffVersion,
    assertNoTrustedPricingFields,
    deriveTicketQuantities,
    listAdmissionTicketCatalog,
    loadQuoteTariffs,
    mapTariffVersionRow,
    mapTicketTypeRow,
    normalizeManualTicketQuantities,
    readAdmissionTicketSnapshot,
    resolveAdmissionTicketQuote,
    resolveServerAdmissionContext,
    validateTariffMutation
};
