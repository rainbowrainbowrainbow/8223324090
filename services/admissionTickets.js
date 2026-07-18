'use strict';

const crypto = require('node:crypto');
const {
    ADMISSION_CONTEXTS,
    ROOM_TAKEAWAY_RESOURCE_ID,
    TICKET_DAY_TYPES,
    resolveAdmissionContext,
    ticketDayType
} = require('./ticketTariffContract');
const { normalizeBusinessContext } = require('./businessContext');

const CURRENCY = 'UAH';
const QUOTE_CONTRACT_VERSION = 1;
const MAX_POSTGRES_INTEGER = 2147483647;
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
        this.statusCode = status;
        this.code = code;
        this.details = details;
        this.publicMessage = message;
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
    if (!Number.isSafeInteger(value) || value < 0) {
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

function dateOnlyInTimeZone(value = new Date(), timeZone = 'Europe/Kyiv') {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function listAdmissionTicketCatalog(queryable, {
    businessContext,
    pricingDate = dateOnlyInTimeZone()
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
                headTariffs: [],
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
        const headIndex = type.headTariffs.findIndex(item => (
            item.admissionContext === version.admissionContext
            && item.dayType === version.dayType
        ));
        if (headIndex === -1) {
            type.headTariffs.push(version);
        } else if (version.revision > type.headTariffs[headIndex].revision) {
            type.headTariffs[headIndex] = version;
        }
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
        && (
            !Number.isSafeInteger(amountUah)
            || amountUah < 0
            || amountUah > MAX_POSTGRES_INTEGER
        )
    ) {
        throw new AdmissionTicketError('Available tariff requires a whole UAH amount within PostgreSQL INTEGER range', {
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
        amountUah,
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

function parseBookingObject(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            parsed = {};
        }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function bookingExtraDataCandidates(booking = {}) {
    return [
        ['extraData', parseBookingObject(booking.extraData)],
        ['extra_data', parseBookingObject(booking.extra_data)]
    ];
}

function bookingExtraDataFromBooking(booking = {}) {
    const candidates = bookingExtraDataCandidates(booking);
    return candidates.find(([, extra]) => Object.keys(extra).length)?.[1] || {};
}

function bookingPackageCandidates(booking = {}) {
    const candidates = [
        ['bookingPackage', booking.bookingPackage],
        ['booking_package', booking.booking_package]
    ];
    for (const [extraPath, extra] of bookingExtraDataCandidates(booking)) {
        candidates.push(
            [`${extraPath}.bookingPackage`, extra.bookingPackage],
            [`${extraPath}.booking_package`, extra.booking_package]
        );
    }
    return candidates
        .filter(([, bookingPackage]) => (
            bookingPackage
            && typeof bookingPackage === 'object'
            && !Array.isArray(bookingPackage)
        ))
        .map(([path, bookingPackage]) => ({ path, bookingPackage }));
}

function bookingPackageHasTicketSnapshotFields(bookingPackage = {}) {
    return Number(bookingPackage.schemaVersion || bookingPackage.schema_version || 0) >= 3
        || Array.isArray(bookingPackage.ticketLines || bookingPackage.ticket_lines)
        || hasOwn(bookingPackage, 'ticketSubtotal')
        || hasOwn(bookingPackage, 'ticket_subtotal')
        || hasOwn(bookingPackage, 'ticketPricingContext')
        || hasOwn(bookingPackage, 'ticket_pricing_context')
        || hasOwn(bookingPackage, 'ticketDayType')
        || hasOwn(bookingPackage, 'ticket_day_type')
        || hasOwn(bookingPackage, 'ticketPricingDate')
        || hasOwn(bookingPackage, 'ticket_pricing_date')
        || hasOwn(bookingPackage, 'ticketPricedAt')
        || hasOwn(bookingPackage, 'ticket_priced_at');
}

function bookingPackageFromBooking(booking = {}) {
    const candidates = bookingPackageCandidates(booking);
    return candidates.find(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage))?.bookingPackage
        || candidates[0]?.bookingPackage
        || {};
}

function hasTicketSnapshotFields(booking = {}) {
    return bookingPackageCandidates(booking)
        .some(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage));
}

function hasTicketQuoteInput(booking = {}) {
    return hasOwn(booking, 'ticketQuote')
        || hasOwn(booking, 'ticket_quote')
        || Boolean(nestedTicketQuotePath(booking));
}

function nestedTicketQuotePath(booking = {}) {
    for (const { path, bookingPackage } of bookingPackageCandidates(booking)) {
        if (hasOwn(bookingPackage, 'ticketQuote')) return `${path}.ticketQuote`;
        if (hasOwn(bookingPackage, 'ticket_quote')) return `${path}.ticket_quote`;
    }
    for (const [path, extra] of bookingExtraDataCandidates(booking)) {
        if (hasOwn(extra, 'ticketQuote')) return `${path}.ticketQuote`;
        if (hasOwn(extra, 'ticket_quote')) return `${path}.ticket_quote`;
    }
    return null;
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
    pricingDate,
    lockTariffTypes = false
} = {}) {
    const context = normalizeBusinessContext(businessContext);
    if (lockTariffTypes) {
        const lockResult = await queryable.query(
            `SELECT id, code
               FROM admission_ticket_types
              WHERE business_context = $1
                AND code = ANY($2::text[])
              ORDER BY code
              FOR SHARE`,
            [context, TICKET_TYPE_CODES]
        );
        const lockedCodes = new Set((lockResult.rows || []).map(row => row.code));
        const missingLockedTypes = TICKET_TYPE_CODES.filter(code => !lockedCodes.has(code));
        if (missingLockedTypes.length) {
            throw new AdmissionTicketError('Ticket type configuration is incomplete', {
                status: 503,
                code: 'TICKET_TARIFF_MISSING',
                details: { missingTypes: missingLockedTypes }
            });
        }
    }
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
            context,
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

function ticketVersionMap(quote = {}) {
    return new Map((Array.isArray(quote?.ticketLines) ? quote.ticketLines : [])
        .map(line => [
            cleanText(line?.ticketTypeCode || line?.ticket_type_code, 64),
            Number(line?.tariffVersionId || line?.tariff_version_id)
        ])
        .filter(([code, versionId]) => code && Number.isInteger(versionId) && versionId > 0));
}

function ticketQuoteVersionDiff(previousQuote = {}, currentQuote = {}) {
    const previous = ticketVersionMap(previousQuote);
    const current = ticketVersionMap(currentQuote);
    const codes = new Set([...previous.keys(), ...current.keys()]);
    return [...codes]
        .map(code => ({
            ticketTypeCode: code,
            previousTariffVersionId: previous.get(code) || null,
            currentTariffVersionId: current.get(code) || null
        }))
        .filter(item => item.previousTariffVersionId !== item.currentTariffVersionId);
}

function quoteLines(quote = {}) {
    const lines = quote.ticketLines ?? quote.ticket_lines;
    return Array.isArray(lines) ? lines : [];
}

function quoteLineMap(quote = {}) {
    return new Map(quoteLines(quote)
        .map(line => [cleanText(line?.ticketTypeCode || line?.ticket_type_code, 64), line])
        .filter(([code]) => TICKET_TYPE_CODES.includes(code)));
}

function comparableQuoteInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function comparableQuoteMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? money(number) : null;
}

function quoteNormalizedQuantities(quote = {}, linesByCode = quoteLineMap(quote)) {
    const raw = quote.normalizedQuantities ?? quote.normalized_quantities;
    const normalized = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(TICKET_TYPE_CODES.map(code => {
        const line = linesByCode.get(code);
        const lineQuantity = comparableQuoteInteger(line?.quantity);
        const normalizedQuantity = comparableQuoteInteger(normalized[code]);
        return [code, lineQuantity ?? normalizedQuantity ?? 0];
    }));
}

function ticketQuoteFingerprintPayload(quote = {}) {
    const linesByCode = quoteLineMap(quote);
    const quantities = quoteNormalizedQuantities(quote, linesByCode);
    return {
        quoteContractVersion: QUOTE_CONTRACT_VERSION,
        businessContext: cleanText(quote.businessContext ?? quote.business_context, 64) || null,
        admissionContext: cleanText(quote.admissionContext ?? quote.admission_context, 32) || null,
        dayType: cleanText(quote.dayType ?? quote.day_type, 16) || null,
        pricingDate: toDateOnly(quote.pricingDate ?? quote.pricing_date),
        currency: cleanText(quote.currency, 8) || CURRENCY,
        ticketSubtotal: comparableQuoteMoney(quote.ticketSubtotal ?? quote.ticket_subtotal),
        ticketLineCount: quoteLines(quote).length,
        lines: Object.fromEntries(TICKET_TYPE_CODES.map(code => {
            const line = linesByCode.get(code);
            return [code, {
                quantity: quantities[code],
                tariffVersionId: comparableQuoteInteger(line?.tariffVersionId ?? line?.tariff_version_id),
                unitPriceUah: comparableQuoteMoney(line?.unitPriceUah ?? line?.unit_price_uah),
                subtotalUah: comparableQuoteMoney(line?.subtotalUah ?? line?.subtotal_uah)
            }];
        }))
    };
}

function ticketQuoteFingerprint(quote = {}) {
    const payload = JSON.stringify(ticketQuoteFingerprintPayload(quote));
    return `v${QUOTE_CONTRACT_VERSION}:${crypto.createHash('sha256').update(payload).digest('hex')}`;
}

function ticketQuoteDiff(previousQuote = {}, currentQuote = {}) {
    const previous = ticketQuoteFingerprintPayload(previousQuote);
    const current = ticketQuoteFingerprintPayload(currentQuote);
    const diff = [];
    for (const field of ['businessContext', 'admissionContext', 'dayType', 'pricingDate', 'currency', 'ticketSubtotal', 'ticketLineCount']) {
        if (field === 'businessContext' && previous[field] === null) continue;
        if (previous[field] === current[field]) continue;
        diff.push({
            field,
            previousValue: previous[field],
            currentValue: current[field]
        });
    }
    for (const code of TICKET_TYPE_CODES) {
        const oldLine = previous.lines[code];
        const newLine = current.lines[code];
        if (
            oldLine.quantity === newLine.quantity
            && oldLine.tariffVersionId === newLine.tariffVersionId
            && oldLine.unitPriceUah === newLine.unitPriceUah
            && oldLine.subtotalUah === newLine.subtotalUah
        ) continue;
        diff.push({
            ticketTypeCode: code,
            previousQuantity: oldLine.quantity,
            currentQuantity: newLine.quantity,
            previousTariffVersionId: oldLine.tariffVersionId,
            currentTariffVersionId: newLine.tariffVersionId,
            previousUnitPriceUah: oldLine.unitPriceUah,
            currentUnitPriceUah: newLine.unitPriceUah,
            previousSubtotalUah: oldLine.subtotalUah,
            currentSubtotalUah: newLine.subtotalUah
        });
    }
    return diff;
}

function ticketQuoteInputsChanged(diff = []) {
    return diff.some(item => (
        ['businessContext', 'admissionContext', 'dayType', 'pricingDate', 'currency', 'ticketLineCount']
            .includes(item.field)
        || (
            item.ticketTypeCode
            && item.previousQuantity !== item.currentQuantity
        )
    ));
}

function ticketSnapshotQuoteCandidate(booking, bookingPackage) {
    const ticketLines = bookingPackage.ticketLines ?? bookingPackage.ticket_lines;
    if (!Array.isArray(ticketLines)) return null;
    return {
        businessContext: booking.businessContext ?? booking.business_context ?? null,
        admissionContext: bookingPackage.ticketPricingContext
            ?? bookingPackage.ticket_pricing_context
            ?? ticketLines[0]?.admissionContext
            ?? ticketLines[0]?.admission_context,
        dayType: bookingPackage.ticketDayType
            ?? bookingPackage.ticket_day_type
            ?? ticketLines[0]?.dayType
            ?? ticketLines[0]?.day_type,
        pricingDate: bookingPackage.ticketPricingDate
            ?? bookingPackage.ticket_pricing_date
            ?? booking.date,
        currency: ticketLines[0]?.currency || CURRENCY,
        ticketLines,
        ticketSubtotal: bookingPackage.ticketSubtotal
            ?? bookingPackage.ticket_subtotal
            ?? ticketLines.reduce((sum, line) => (
                sum + Number(line?.subtotalUah ?? line?.subtotal_uah ?? 0)
            ), 0)
    };
}

function ticketQuoteFromStoredSnapshot(booking = {}) {
    const candidate = bookingPackageCandidates(booking)
        .find(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage));
    if (!candidate) return null;
    const quote = ticketSnapshotQuoteCandidate(booking, candidate.bookingPackage);
    if (!quote) return null;
    quote.legacy = false;
    quote.quoteContractVersion = QUOTE_CONTRACT_VERSION;
    quote.pricedAt = candidate.bookingPackage.ticketPricedAt
        ?? candidate.bookingPackage.ticket_priced_at
        ?? null;
    quote.normalizedQuantities = quoteNormalizedQuantities(quote);
    quote.quoteFingerprint = ticketQuoteFingerprint(quote);
    return quote;
}

function validateStoredAdmissionTicketSnapshot(booking = {}) {
    const candidate = bookingPackageCandidates(booking)
        .find(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage));
    if (!candidate) return null;
    const { path, bookingPackage } = candidate;
    const fail = (reason, details = {}) => {
        throw new AdmissionTicketError('Stored admission ticket snapshot is invalid', {
            status: 409,
            code: 'TICKET_SNAPSHOT_INVALID',
            details: { path, reason, ...details }
        });
    };
    const schemaVersion = Number(bookingPackage.schemaVersion ?? bookingPackage.schema_version);
    const ticketLines = bookingPackage.ticketLines ?? bookingPackage.ticket_lines;
    if (!Number.isInteger(schemaVersion) || schemaVersion < 3) {
        fail('schema_version');
    }
    if (!Array.isArray(ticketLines)) {
        fail('ticket_lines');
    }

    const seenCodes = new Set();
    let calculatedSubtotal = 0;
    for (let index = 0; index < ticketLines.length; index += 1) {
        const line = ticketLines[index];
        if (!line || typeof line !== 'object' || Array.isArray(line)) {
            fail('ticket_line_shape', { lineIndex: index });
        }
        const code = cleanText(line.ticketTypeCode ?? line.ticket_type_code, 64);
        if (!TICKET_TYPE_CODES.includes(code)) {
            fail('ticket_type_code', { lineIndex: index, ticketTypeCode: code || null });
        }
        if (seenCodes.has(code)) {
            fail('duplicate_ticket_type', { lineIndex: index, ticketTypeCode: code });
        }
        seenCodes.add(code);

        const quantity = Number(line.quantity);
        const unitPriceUah = Number(line.unitPriceUah ?? line.unit_price_uah);
        const subtotalUah = Number(line.subtotalUah ?? line.subtotal_uah);
        const tariffVersionId = Number(line.tariffVersionId ?? line.tariff_version_id);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            fail('quantity', { lineIndex: index, ticketTypeCode: code });
        }
        if (
            !Number.isSafeInteger(unitPriceUah)
            || unitPriceUah < 0
            || unitPriceUah > MAX_POSTGRES_INTEGER
        ) {
            fail('unit_price', { lineIndex: index, ticketTypeCode: code });
        }
        if (
            !Number.isSafeInteger(subtotalUah)
            || subtotalUah < 0
            || subtotalUah > MAX_POSTGRES_INTEGER
            || quantity * unitPriceUah !== subtotalUah
        ) {
            fail('line_subtotal', { lineIndex: index, ticketTypeCode: code });
        }
        if (!Number.isSafeInteger(tariffVersionId) || tariffVersionId <= 0) {
            fail('tariff_version', { lineIndex: index, ticketTypeCode: code });
        }
        calculatedSubtotal += subtotalUah;
        if (!Number.isSafeInteger(calculatedSubtotal) || calculatedSubtotal > MAX_POSTGRES_INTEGER) {
            fail('ticket_subtotal_range');
        }
    }

    const storedSubtotal = Number(
        bookingPackage.ticketSubtotal
        ?? bookingPackage.ticket_subtotal
        ?? 0
    );
    if (
        !Number.isSafeInteger(storedSubtotal)
        || storedSubtotal < 0
        || storedSubtotal > MAX_POSTGRES_INTEGER
        || storedSubtotal !== calculatedSubtotal
    ) {
        fail('ticket_subtotal', {
            storedSubtotal,
            calculatedSubtotal
        });
    }

    const storedFingerprint = cleanText(
        bookingPackage.ticketQuoteFingerprint
        ?? bookingPackage.ticket_quote_fingerprint,
        120
    );
    if (storedFingerprint) {
        const quote = ticketSnapshotQuoteCandidate(booking, bookingPackage);
        if (!quote || ticketQuoteFingerprint(quote) !== storedFingerprint) {
            fail('quote_fingerprint');
        }
    }
    return {
        path,
        schemaVersion,
        ticketLineCount: ticketLines.length,
        ticketSubtotal: storedSubtotal
    };
}

function ticketSnapshotMismatchPath(booking = {}, existingBooking = null) {
    const incoming = bookingPackageCandidates(booking)
        .filter(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage));
    if (!incoming.length) return null;
    const existingSignatures = new Set(
        bookingPackageCandidates(existingBooking || {})
            .filter(({ bookingPackage }) => bookingPackageHasTicketSnapshotFields(bookingPackage))
            .map(({ bookingPackage }) => ticketSnapshotQuoteCandidate(existingBooking || {}, bookingPackage))
            .filter(Boolean)
            .map(quote => JSON.stringify(ticketQuoteFingerprintPayload({
                ...quote,
                businessContext: null
            })))
    );
    for (const { path, bookingPackage } of incoming) {
        const quote = ticketSnapshotQuoteCandidate(booking, bookingPackage);
        if (!quote) return path;
        const signature = JSON.stringify(ticketQuoteFingerprintPayload({
            ...quote,
            businessContext: null
        }));
        if (!existingSignatures.has(signature)) return path;
    }
    return null;
}

function bookingTicketResolverInput(booking = {}) {
    const input = {};
    const copyAlias = (target, camel, snake) => {
        if (hasOwn(booking, camel)) input[target] = booking[camel];
        else if (hasOwn(booking, snake)) input[target] = booking[snake];
    };
    copyAlias('date', 'date', 'date');
    copyAlias('roomResourceId', 'roomResourceId', 'room_resource_id');
    copyAlias('banquetGuests', 'banquetGuests', 'banquet_guests');
    copyAlias('banquetAdults', 'banquetAdults', 'banquet_adults');
    copyAlias('kidsCount', 'kidsCount', 'kids_count');
    copyAlias('ticketQuantities', 'ticketQuantities', 'ticket_quantities');
    if (hasOwn(booking, 'convertLegacy') || hasOwn(booking, 'convert_legacy')) {
        input.convertLegacy = booking.convertLegacy === true || booking.convert_legacy === true;
    }
    return input;
}

function bookingTicketPricingInputsChanged(booking = {}, existingBooking = {}) {
    const comparisons = [
        {
            camel: 'date',
            snake: 'date',
            current: booking.date,
            previous: existingBooking.date,
            normalize: value => toDateOnly(value)
        },
        {
            camel: 'roomResourceId',
            snake: 'room_resource_id',
            current: booking.roomResourceId ?? booking.room_resource_id,
            previous: existingBooking.room_resource_id ?? existingBooking.roomResourceId,
            normalize: value => cleanText(value, 100) || null
        },
        {
            camel: 'banquetGuests',
            snake: 'banquet_guests',
            current: booking.banquetGuests ?? booking.banquet_guests,
            previous: existingBooking.banquet_guests
                ?? existingBooking.banquetGuests
                ?? existingBooking.kids_count
                ?? existingBooking.kidsCount,
            normalize: value => comparableQuoteInteger(value)
        },
        {
            camel: 'banquetAdults',
            snake: 'banquet_adults',
            current: booking.banquetAdults ?? booking.banquet_adults,
            previous: existingBooking.banquet_adults ?? existingBooking.banquetAdults ?? 0,
            normalize: value => comparableQuoteInteger(value)
        },
        {
            camel: 'kidsCount',
            snake: 'kids_count',
            current: booking.kidsCount ?? booking.kids_count,
            previous: existingBooking.kids_count
                ?? existingBooking.kidsCount
                ?? existingBooking.banquet_guests
                ?? existingBooking.banquetGuests,
            normalize: value => comparableQuoteInteger(value)
        }
    ];
    return comparisons.some(item => {
        if (!hasOwn(booking, item.camel) && !hasOwn(booking, item.snake)) return false;
        return item.normalize(item.current) !== item.normalize(item.previous);
    });
}

function applyNormalizedTicketCounts(booking = {}, quote = {}) {
    const quantities = quoteNormalizedQuantities(quote);
    const normalizedChildren = quantities.regular_child
        + quantities.under_3_child
        + quantities.discounted_child
        + quantities.birthday_child;
    const normalizedAdults = quantities.adult_companion + quantities.adult_game;
    booking.banquetGuests = normalizedChildren;
    booking.kidsCount = normalizedChildren;
    booking.banquetAdults = normalizedAdults;
}

async function resolveAndApplyAdmissionTicketQuote({
    queryable,
    businessContext,
    booking = {},
    existingBooking = null,
    newBanquetFlow = false,
    now = new Date()
} = {}) {
    const forbiddenNestedQuotePath = nestedTicketQuotePath(booking);
    if (forbiddenNestedQuotePath) {
        throw new AdmissionTicketError('Ticket quotes must use the canonical top-level ticketQuote field', {
            status: 422,
            code: 'TICKET_SNAPSHOT_INPUT_FORBIDDEN',
            details: { field: forbiddenNestedQuotePath }
        });
    }
    const mismatchedSnapshotPath = ticketSnapshotMismatchPath(booking, existingBooking);
    if (mismatchedSnapshotPath) {
        throw new AdmissionTicketError('Persisted ticket snapshots cannot be supplied or changed by the client', {
            status: 422,
            code: 'TICKET_SNAPSHOT_INPUT_FORBIDDEN',
            details: { field: mismatchedSnapshotPath }
        });
    }
    const existingSnapshot = existingBooking
        ? readAdmissionTicketSnapshot(existingBooking)
        : null;
    const explicitQuantities = hasOwn(booking, 'ticketQuantities')
        || hasOwn(booking, 'ticket_quantities');
    const explicitConversion = booking.convertLegacy === true
        || booking.convert_legacy === true;
    if (
        existingSnapshot?.kind !== 'v3'
        && (hasTicketSnapshotFields(booking) || hasTicketQuoteInput(booking))
        && !explicitQuantities
    ) {
        throw new AdmissionTicketError('Persisted ticket snapshots cannot be supplied by the client', {
            status: 422,
            code: 'TICKET_SNAPSHOT_INPUT_FORBIDDEN'
        });
    }
    if (existingSnapshot?.kind === 'legacy' && explicitQuantities && !explicitConversion) {
        throw new AdmissionTicketError('Legacy ticket conversion requires explicit confirmation', {
            status: 409,
            code: 'TICKET_LEGACY_CONVERSION_CONFIRMATION_REQUIRED'
        });
    }
    if (existingSnapshot?.kind === 'legacy' && explicitConversion && !explicitQuantities) {
        throw new AdmissionTicketError('Legacy ticket conversion requires explicit ticket quantities', {
            status: 422,
            code: 'TICKET_QUANTITIES_REQUIRED'
        });
    }
    const shouldResolve = explicitQuantities || existingSnapshot?.kind === 'v3';
    if (!shouldResolve) {
        return {
            applied: false,
            quote: null,
            preserveNoTicketPackage: Boolean(existingBooking && !existingSnapshot)
        };
    }

    const input = bookingTicketResolverInput(booking);
    if (!explicitQuantities) delete input.ticketQuantities;
    const clientQuote = booking.ticketQuote || booking.ticket_quote || null;
    if (
        existingSnapshot?.kind === 'v3'
        && !explicitQuantities
        && (!clientQuote || typeof clientQuote !== 'object' || Array.isArray(clientQuote))
        && !bookingTicketPricingInputsChanged(booking, existingBooking || {})
    ) {
        validateStoredAdmissionTicketSnapshot(existingBooking || {});
        const preservedQuote = ticketQuoteFromStoredSnapshot(existingBooking || {});
        if (!preservedQuote) {
            return { applied: false, quote: null, preserved: true };
        }
        booking.ticketQuote = preservedQuote;
        delete booking.ticket_quote;
        applyNormalizedTicketCounts(booking, preservedQuote);
        return { applied: true, quote: preservedQuote, preserved: true };
    }
    const quote = await resolveAdmissionTicketQuote({
        queryable,
        businessContext,
        input,
        existingBooking,
        newBanquetFlow,
        now,
        lockTariffTypes: true
    });
    if (!clientQuote || typeof clientQuote !== 'object' || Array.isArray(clientQuote)) {
        throw new AdmissionTicketError('A current server ticket quote is required before saving', {
            status: 409,
            code: 'TICKET_QUOTE_REQUIRED',
            details: { quote }
        });
    }
    const diff = ticketQuoteDiff(clientQuote, quote);
    if (diff.length) {
        const quoteInputsChanged = ticketQuoteInputsChanged(diff);
        throw new AdmissionTicketError(
            quoteInputsChanged
                ? 'Ticket quantities or pricing context changed after preview'
                : 'Ticket prices changed after preview',
            {
            status: 409,
            code: quoteInputsChanged ? 'TICKET_QUOTE_CHANGED' : 'TICKET_PRICE_CHANGED',
            details: { quote, diff }
            }
        );
    }
    booking.ticketQuote = quote;
    delete booking.ticket_quote;
    applyNormalizedTicketCounts(booking, quote);
    return { applied: true, quote };
}

async function resolveAdmissionTicketQuote({
    queryable,
    businessContext,
    input = {},
    existingBooking = null,
    newBanquetFlow = false,
    now = new Date(),
    lockTariffTypes = false
} = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new TypeError('resolveAdmissionTicketQuote requires a queryable');
    }
    assertNoTrustedPricingFields(input);
    const context = normalizeBusinessContext(businessContext);
    const snapshot = existingBooking ? readAdmissionTicketSnapshot(existingBooking) : null;
    const explicitQuantities = hasOwn(input, 'ticketQuantities')
        || hasOwn(input, 'ticket_quantities');
    const explicitConversion = input.convertLegacy === true
        || input.convert_legacy === true;
    if (snapshot?.kind === 'legacy' && explicitQuantities && !explicitConversion) {
        throw new AdmissionTicketError('Legacy ticket conversion requires explicit confirmation', {
            status: 409,
            code: 'TICKET_LEGACY_CONVERSION_CONFIRMATION_REQUIRED'
        });
    }
    if (snapshot?.kind === 'legacy' && explicitConversion && !explicitQuantities) {
        throw new AdmissionTicketError('Legacy ticket conversion requires explicit ticket quantities', {
            status: 422,
            code: 'TICKET_QUANTITIES_REQUIRED'
        });
    }
    if (
        snapshot?.kind === 'legacy'
        && !explicitQuantities
        && !explicitConversion
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
    const hasExplicitBanquetGuests = hasOwn(input, 'banquetGuests')
        || hasOwn(input, 'banquet_guests');
    const hasExplicitBanquetAdults = hasOwn(input, 'banquetAdults')
        || hasOwn(input, 'banquet_adults');
    const hasExplicitKidsCount = hasOwn(input, 'kidsCount')
        || hasOwn(input, 'kids_count');
    const banquetGuests = (hasExplicitBanquetGuests
        ? (input.banquetGuests ?? input.banquet_guests)
        : undefined)
        ?? existingBooking?.banquet_guests
        ?? existingBooking?.banquetGuests
        ?? existingBooking?.kids_count
        ?? existingBooking?.kidsCount;
    const banquetAdults = (hasExplicitBanquetAdults
        ? (input.banquetAdults ?? input.banquet_adults)
        : undefined)
        ?? existingBooking?.banquet_adults
        ?? existingBooking?.banquetAdults
        ?? (existingBooking ? 0 : undefined);
    const kidsCount = hasExplicitKidsCount
        ? (input.kidsCount ?? input.kids_count)
        : undefined;
    const guests = requireNonNegativeInteger(Number(banquetGuests), 'banquetGuests');
    const adults = requireNonNegativeInteger(Number(banquetAdults), 'banquetAdults');
    if (
        hasExplicitKidsCount
        &&
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
        pricingDate,
        lockTariffTypes
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
                const unavailableMessage = code === 'under_3_child' && dayType === TICKET_DAY_TYPES.WEEKEND
                    ? 'Квиток для дитини до 3 років недоступний у вихідні.'
                    : `Квиток «${row.name}» недоступний для обраної дати.`;
                throw new AdmissionTicketError(unavailableMessage, {
                    status: 422,
                    code: 'TICKET_TYPE_UNAVAILABLE',
                    details: { ticketTypeCode: code, dayType, admissionContext }
                });
            }
            continue;
        }
        if (quantity <= 0) continue;
        const unitPriceUah = Number(row.amount_uah);
        const subtotalUah = quantity * unitPriceUah;
        if (
            !Number.isSafeInteger(unitPriceUah)
            || unitPriceUah < 0
            || unitPriceUah > MAX_POSTGRES_INTEGER
            || !Number.isSafeInteger(subtotalUah)
            || subtotalUah > MAX_POSTGRES_INTEGER
        ) {
            throw new AdmissionTicketError('Ticket amount is outside the supported whole-UAH range', {
                status: 503,
                code: 'TICKET_AMOUNT_INVALID',
                details: { ticketTypeCode: code }
            });
        }
        ticketLines.push({
            ticketTypeId: Number(row.ticket_type_id),
            ticketTypeCode: code,
            ticketTypeName: row.name,
            audience: row.audience,
            quantity,
            unitPriceUah,
            subtotalUah,
            tariffVersionId: Number(row.tariff_version_id),
            effectiveFrom: toDateOnly(row.effective_from),
            admissionContext,
            dayType,
            currency: CURRENCY
        });
    }
    const ticketSubtotal = ticketLines.reduce((sum, line) => sum + line.subtotalUah, 0);
    if (!Number.isSafeInteger(ticketSubtotal) || ticketSubtotal > MAX_POSTGRES_INTEGER) {
        throw new AdmissionTicketError('Ticket subtotal is outside the supported PostgreSQL INTEGER range', {
            status: 422,
            code: 'TICKET_TOTAL_OUT_OF_RANGE'
        });
    }
    const quote = {
        legacy: false,
        quoteContractVersion: QUOTE_CONTRACT_VERSION,
        businessContext: context,
        ticketLines,
        ticketSubtotal,
        admissionContext,
        dayType,
        pricingDate,
        pricedAt: now.toISOString(),
        currency: CURRENCY,
        normalizedQuantities: quantities
    };
    quote.quoteFingerprint = ticketQuoteFingerprint(quote);
    return quote;
}

module.exports = {
    AdmissionTicketError,
    CURRENCY,
    FORBIDDEN_QUOTE_FIELDS,
    MANUAL_TICKET_TYPE_CODES,
    MAX_POSTGRES_INTEGER,
    QUOTE_CONTRACT_VERSION,
    REMAINDER_TICKET_TYPE_CODES,
    TICKET_AVAILABILITY,
    TICKET_TYPE_CODES,
    appendAdmissionTicketTariffVersion,
    assertNoTrustedPricingFields,
    deriveTicketQuantities,
    dateOnlyInTimeZone,
    hasTicketSnapshotFields,
    hasTicketQuoteInput,
    nestedTicketQuotePath,
    listAdmissionTicketCatalog,
    loadQuoteTariffs,
    mapTariffVersionRow,
    mapTicketTypeRow,
    normalizeManualTicketQuantities,
    readAdmissionTicketSnapshot,
    ticketQuoteDiff,
    ticketQuoteFingerprint,
    ticketQuoteFingerprintPayload,
    ticketQuoteVersionDiff,
    bookingTicketResolverInput,
    resolveAndApplyAdmissionTicketQuote,
    resolveAdmissionTicketQuote,
    resolveServerAdmissionContext,
    validateStoredAdmissionTicketSnapshot,
    validateTariffMutation
};
