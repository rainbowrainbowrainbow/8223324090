const BOOKING_PACKAGE_SCHEMA_VERSION = 1;

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

function stableLineId(raw, index) {
    return cleanText(raw?.id || raw?.lineId || raw?.uid, 80) || `item-${index + 1}`;
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

function buildLegacyBanquetMenu(positions, fallback = null) {
    const rows = normalizeMenuPositions(positions);
    if (!rows.length) return cleanText(fallback, 2000);
    return rows
        .map(item => {
            const qty = item.quantity % 1 === 0 ? String(item.quantity) : String(item.quantity).replace('.', ',');
            const price = item.unitPrice ? ` x ${item.unitPrice} грн` : '';
            const note = item.note ? ` (${item.note})` : '';
            return `${item.title} - ${qty}${item.servingUnit ? ` ${item.servingUnit}` : ''}${price}${note}`;
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

function hasBookingPackageInput(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return Object.prototype.hasOwnProperty.call(booking, 'menuPositions')
        || Object.prototype.hasOwnProperty.call(booking, 'menu_positions')
        || Object.prototype.hasOwnProperty.call(booking, 'programBasePrice')
        || Object.prototype.hasOwnProperty.call(booking, 'program_base_price')
        || Boolean(extra.bookingPackage || extra.booking_package || extra.menuPositions);
}

function buildBookingPackage(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    const previousPackage = extra.bookingPackage || extra.booking_package || {};
    const positions = normalizeMenuPositions(extractIncomingPositions(booking));
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
    buildLegacyBanquetMenu,
    buildBookingPackage,
    applyBookingPackage,
    bookingPackageAudit
};
