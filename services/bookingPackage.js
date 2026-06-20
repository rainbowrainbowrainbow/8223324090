const BOOKING_PACKAGE_SCHEMA_VERSION = 2;
const SERVICE_EVENT_TYPES = new Set(['food_service', 'cake', 'drinks', 'room_setup', 'custom']);
const SERVICE_EVENT_STATUSES = new Set(['planned', 'done', 'skipped']);

function cleanText(value, max = 240) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function toMoney(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n * 100) / 100;
}

function toQuantity(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.round(n * 100) / 100;
}

const MENU_PORTION_UNITS = new Set(['порція', 'порції', 'порцій', 'порц', 'portion', 'portions']);

function formatMenuQuantityNumber(value) {
    const quantity = toQuantity(value);
    return Number.isInteger(quantity) ? String(quantity) : String(quantity).replace('.', ',');
}

function menuPortionWord(value) {
    const quantity = toQuantity(value);
    if (!Number.isInteger(quantity)) return 'порції';
    const absolute = Math.abs(quantity);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'порцій';
    if (last === 1) return 'порція';
    if (last >= 2 && last <= 4) return 'порції';
    return 'порцій';
}

function normalizeMenuServingUnitDisplay(value) {
    const text = cleanText(value, 80);
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')
        .replace(/^(\d+(?:[,.]\d+)?)\s*(кг|г|гр|мг|л|мл)$/iu, '$1 $2')
        .trim();
}

function isPortionServingUnit(value) {
    const unit = normalizeMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return !unit || MENU_PORTION_UNITS.has(unit);
}

function isPackServingUnit(value) {
    return /^\d+(?:[,.]\d+)?\s*(кг|г|гр|мг|л|мл)$/iu.test(normalizeMenuServingUnitDisplay(value));
}

function formatMenuQuantityWithServingUnit(quantity, servingUnit) {
    const quantityLabel = formatMenuQuantityNumber(quantity);
    const unit = normalizeMenuServingUnitDisplay(servingUnit);
    if (isPortionServingUnit(unit)) return `${quantityLabel} ${menuPortionWord(quantity)}`;
    if (isPackServingUnit(unit)) return `${quantityLabel} ${menuPortionWord(quantity)} по ${unit}`;
    return `${quantityLabel} ${unit}`.trim();
}

function formatMenuPositionQuantity(item = {}) {
    return formatMenuQuantityWithServingUnit(
        item.quantity ?? item.qty,
        item.servingUnit || item.serving_unit || item.priceUnit || item.price_unit
    );
}

function stableLineId(raw, index) {
    return cleanText(raw?.id || raw?.lineId || raw?.uid, 80) || `item-${index + 1}`;
}

function normalizeServingTime(value) {
    const text = cleanText(value, 20);
    if (!text) return null;
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : null;
}

function normalizeServingType(value, fallback = 'food_service') {
    const type = cleanText(value, 40) || fallback;
    return SERVICE_EVENT_TYPES.has(type) ? type : fallback;
}

function normalizeServingStatus(value, fallback = 'planned') {
    const status = cleanText(value, 40) || fallback;
    return SERVICE_EVENT_STATUSES.has(status) ? status : fallback;
}

function normalizeMenuPosition(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const title = cleanText(raw.title || raw.label || raw.name || raw.productName, 160);
    if (!title) return null;
    const quantity = toQuantity(raw.quantity ?? raw.qty);
    const unitPrice = toMoney(raw.unitPrice ?? raw.unit_price ?? raw.price);
    return {
        id: stableLineId(raw, index),
        productId: cleanText(raw.productId || raw.product_id || raw.sourceItemId, 120),
        code: cleanText(raw.code || raw.productCode || raw.product_code, 80),
        title,
        quantity,
        unitPrice,
        subtotal: toMoney(raw.subtotal, toMoney(quantity * unitPrice)),
        note: cleanText(raw.note || raw.notes, 500),
        menuSection: cleanText(raw.menuSection || raw.menu_section, 120),
        servingUnit: cleanText(raw.servingUnit || raw.serving_unit || raw.priceUnit, 80),
        kitchenType: cleanText(raw.kitchenType || raw.kitchen_type || raw.itemType, 40) || 'menu',
        servingTime: normalizeServingTime(raw.servingTime || raw.serving_time),
        servingNote: cleanText(raw.servingNote || raw.serving_note, 500),
        servingGroupId: cleanText(raw.servingGroupId || raw.serving_group_id || raw.servingBatchId || raw.serving_batch_id, 80),
        servingBatchId: cleanText(raw.servingBatchId || raw.serving_batch_id || raw.servingGroupId || raw.serving_group_id, 80),
        weightValue: cleanText(raw.weightValue || raw.weight_value, 80),
        cakeDecoration: cleanText(raw.cakeDecoration || raw.cake_decoration, 240),
        source: cleanText(raw.source, 40) || (raw.productId || raw.product_id ? 'product' : 'custom')
    };
}

function normalizeMenuPositions(value) {
    const source = Array.isArray(value) ? value : [];
    return source
        .map((item, index) => normalizeMenuPosition(item, index))
        .filter(Boolean);
}

function menuPositionsSubtotal(positions) {
    return toMoney((positions || []).reduce((sum, item) => sum + toMoney(item.subtotal), 0));
}

function normalizeServiceEvent(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const type = normalizeServingType(raw.type || raw.eventType || raw.event_type, 'custom');
    const defaultTitle = type === 'cake' ? 'Винос торта' : 'Подія';
    const title = cleanText(raw.title || raw.label || raw.name, 160) || defaultTitle;
    const time = normalizeServingTime(raw.time || raw.servingTime || raw.serving_time);
    const durationMinutes = Number(raw.durationMinutes ?? raw.duration_minutes);
    const related = Array.isArray(raw.relatedMenuPositionIds || raw.related_menu_position_ids)
        ? (raw.relatedMenuPositionIds || raw.related_menu_position_ids)
            .map(item => cleanText(item, 80))
            .filter(Boolean)
        : [];
    return {
        id: cleanText(raw.id || raw.uid, 80) || `service-event-${index + 1}`,
        type,
        title,
        time,
        durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : null,
        relatedMenuPositionIds: related,
        note: cleanText(raw.note || raw.notes || raw.comment, 500),
        status: normalizeServingStatus(raw.status, 'planned'),
        source: cleanText(raw.source, 40) || 'booking_workspace'
    };
}

function normalizeServiceEvents(value) {
    const source = Array.isArray(value) ? value : [];
    return source
        .map((item, index) => normalizeServiceEvent(item, index))
        .filter(Boolean);
}

function buildLegacyBanquetMenu(positions, fallback = null) {
    const rows = normalizeMenuPositions(positions);
    if (!rows.length) return cleanText(fallback, 2000);
    return rows
        .map(item => {
            const price = item.unitPrice ? ` × ${item.unitPrice} грн` : '';
            const note = item.note ? ` (${item.note})` : '';
            return `${item.title} - ${formatMenuPositionQuantity(item)}${price}${note}`;
        })
        .join('\n');
}

function extractIncomingPositions(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return booking.menuPositions
        || booking.menu_positions
        || extra.bookingPackage?.menuPositions
        || extra.booking_package?.menu_positions
        || extra.menuPositions
        || [];
}

function extractIncomingServiceEvents(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return booking.serviceEvents
        || booking.service_events
        || extra.bookingPackage?.serviceEvents
        || extra.booking_package?.service_events
        || extra.serviceEvents
        || [];
}

function hasBookingPackageInput(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return Object.prototype.hasOwnProperty.call(booking, 'menuPositions')
        || Object.prototype.hasOwnProperty.call(booking, 'menu_positions')
        || Object.prototype.hasOwnProperty.call(booking, 'serviceEvents')
        || Object.prototype.hasOwnProperty.call(booking, 'service_events')
        || Object.prototype.hasOwnProperty.call(booking, 'programBasePrice')
        || Object.prototype.hasOwnProperty.call(booking, 'program_base_price')
        || Boolean(extra.bookingPackage || extra.booking_package || extra.menuPositions || extra.serviceEvents);
}

function buildBookingPackage(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    const previousPackage = extra.bookingPackage || extra.booking_package || {};
    const positions = normalizeMenuPositions(extractIncomingPositions(booking));
    const serviceEvents = normalizeServiceEvents(extractIncomingServiceEvents(booking));
    const positionsSubtotal = menuPositionsSubtotal(positions);
    const fallbackBase = toMoney((booking.price || 0) - positionsSubtotal);
    const programBasePrice = toMoney(
        booking.programBasePrice ?? booking.program_base_price ?? previousPackage.programBasePrice,
        fallbackBase
    );
    const finalTotal = toMoney(programBasePrice + positionsSubtotal);
    return {
        schemaVersion: BOOKING_PACKAGE_SCHEMA_VERSION,
        programBasePrice,
        positionsSubtotal,
        finalTotal,
        menuPositions: positions,
        serviceEvents,
        source: 'booking_workspace'
    };
}

function applyBookingPackage(booking = {}) {
    if (!hasBookingPackageInput(booking)) return booking;
    const extra = booking.extraData && typeof booking.extraData === 'object' ? { ...booking.extraData } : {};
    const bookingPackage = buildBookingPackage({ ...booking, extraData: extra });
    booking.extraData = {
        ...extra,
        bookingPackage
    };
    booking.price = bookingPackage.finalTotal;
    booking.banquetMenu = buildLegacyBanquetMenu(bookingPackage.menuPositions, booking.banquetMenu);
    return booking;
}

function bookingPackageAudit(oldRow, nextBooking) {
    const oldExtra = oldRow?.extra_data || {};
    const oldPackage = oldExtra.bookingPackage || oldExtra.booking_package || null;
    const nextPackage = nextBooking?.extraData?.bookingPackage || null;
    const oldCustomerId = oldRow?.customer_id || null;
    const nextCustomerId = nextBooking?.customerId || nextBooking?.customer_id || oldCustomerId || null;
    return {
        customerChanged: String(oldCustomerId || '') !== String(nextCustomerId || ''),
        packageChanged: JSON.stringify(oldPackage || null) !== JSON.stringify(nextPackage || null),
        from: {
            customerId: oldCustomerId,
            bookingPackage: oldPackage,
            price: oldRow?.price ?? null,
            banquetMenu: oldRow?.banquet_menu || null
        },
        to: {
            customerId: nextCustomerId,
            bookingPackage: nextPackage,
            price: nextBooking?.price ?? null,
            banquetMenu: nextBooking?.banquetMenu || nextBooking?.banquet_menu || null
        }
    };
}

module.exports = {
    BOOKING_PACKAGE_SCHEMA_VERSION,
    normalizeMenuPosition,
    normalizeMenuPositions,
    menuPositionsSubtotal,
    normalizeMenuServingUnitDisplay,
    formatMenuQuantityWithServingUnit,
    formatMenuPositionQuantity,
    normalizeServiceEvent,
    normalizeServiceEvents,
    buildLegacyBanquetMenu,
    buildBookingPackage,
    applyBookingPackage,
    bookingPackageAudit
};
