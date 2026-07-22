const BOOKING_PACKAGE_SCHEMA_VERSION = 3;
const SERVICE_EVENT_TYPES = new Set(['food_service', 'cake', 'drinks', 'room_setup', 'custom']);
const SERVICE_EVENT_STATUSES = new Set(['planned', 'done', 'skipped']);
const BANQUET_ENTRY_PRICE_RULE_CODES = Object.freeze({
    weekday: 'banquet_entry_weekday_child',
    weekend: 'banquet_entry_weekend_child'
});
const { buildBanquetPreorderStatus, loadBanquetPreorderRuleContract } = require('./banquetPreorderRules');
const { hasBanquetMenuWorkflowInput, normalizeBanquetMenuWorkflow } = require('./banquetMenuWorkflow');
const { buildMenuMinimumAdjustment, calculateBanquetMenuFinancials } = require('./banquetMenuFinalization');
const BANQUET_ENTRY_PRICE_RULE_CODE_LIST = Object.freeze(Object.values(BANQUET_ENTRY_PRICE_RULE_CODES));
const BANQUET_ENTRY_SOURCE = 'banquet_entry_price_rules';
const LEGACY_ENTRY_WARNING_CODES = new Set([
    'entry_quantity_missing',
    'entry_date_missing',
    'entry_price_rule_missing'
]);
const BANQUET_ENTRY_TITLE = 'Вхід';

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

function toPositiveInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.trunc(n);
}

function normalizeDateOnly(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function banquetEntryDateType(value) {
    const dateText = normalizeDateOnly(value);
    if (!dateText) return null;
    const [year, month, day] = dateText.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

function normalizeRuleMap(priceRules = []) {
    if (priceRules && typeof priceRules === 'object' && !Array.isArray(priceRules)) {
        return new Map(Object.entries(priceRules));
    }
    return new Map((Array.isArray(priceRules) ? priceRules : [])
        .map(rule => [String(rule?.code || '').trim(), rule])
        .filter(([code]) => code));
}

function numericRuleValue(rule) {
    const value = Number(rule?.value);
    if (!Number.isFinite(value) || value < 0) return null;
    return toMoney(value);
}

const MENU_PORTION_UNITS = new Set(['порція', 'порції', 'порцій', 'порц', 'portion', 'portions']);
const MENU_ADDON_UNITS = new Set(['додаток', 'додатки', 'додатків']);

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

function menuAddonWord(value) {
    const quantity = toQuantity(value);
    if (!Number.isInteger(quantity)) return 'додатки';
    const absolute = Math.abs(quantity);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'додатків';
    if (last === 1) return 'додаток';
    if (last >= 2 && last <= 4) return 'додатки';
    return 'додатків';
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

function isAddonServingUnit(value) {
    const unit = normalizeMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return MENU_ADDON_UNITS.has(unit);
}

function isPackServingUnit(value) {
    return /^\d+(?:[,.]\d+)?\s*(кг|г|гр|мг|л|мл)$/iu.test(normalizeMenuServingUnitDisplay(value));
}

function formatMenuQuantityWithServingUnit(quantity, servingUnit) {
    const quantityLabel = formatMenuQuantityNumber(quantity);
    const unit = normalizeMenuServingUnitDisplay(servingUnit);
    if (isPortionServingUnit(unit)) return `${quantityLabel} ${menuPortionWord(quantity)}`;
    if (isAddonServingUnit(unit)) return `${quantityLabel} ${menuAddonWord(quantity)}`;
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

function parseExtraDataObject(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function extraDataObjectOf(booking = {}) {
    return parseExtraDataObject(booking.extraData ?? booking.extra_data);
}

function extraDataCandidatesOf(booking = {}) {
    return [
        ['extraData', parseExtraDataObject(booking.extraData)],
        ['extra_data', parseExtraDataObject(booking.extra_data)]
    ];
}

function hasBanquetEntrySurface(booking = {}) {
    const extra = extraDataObjectOf(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const scenario = String(workspace.scenario || booking.scenario || '').trim().toLowerCase();
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    return category === 'banquet'
        || category === 'kitchen'
        || programCode === 'KITCHEN'
        || scenario === 'kitchen_only'
        || scenario === 'event_kitchen'
        || booking.banquetGuests != null
        || booking.banquet_guests != null
        || booking.banquetAdults != null
        || booking.banquet_adults != null
        || booking.banquetTables != null
        || booking.banquet_tables != null;
}

function banquetEntryQuantityForBooking(booking = {}, options = {}) {
    const sources = [
        booking.banquetGuests,
        booking.banquet_guests,
        booking.kidsCount,
        booking.kids_count,
        options.sourceBooking?.kids_count,
        options.sourceBooking?.kidsCount,
        options.primaryBooking?.kids_count,
        options.primaryBooking?.kidsCount,
        options.sourceBooking?.banquet_guests,
        options.sourceBooking?.banquetGuests,
        options.primaryBooking?.banquet_guests,
        options.primaryBooking?.banquetGuests
    ];
    for (const value of sources) {
        const quantity = toPositiveInteger(value);
        if (quantity) return quantity;
    }
    return null;
}

function normalizeEntryTitle(value) {
    return String(value || '')
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function isEntryIdentifier(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'entry'
        || text === 'banquet_entry'
        || text === BANQUET_ENTRY_SOURCE
        || BANQUET_ENTRY_PRICE_RULE_CODE_LIST.includes(text);
}

function isManualEntryMenuPosition(item = {}) {
    if (!item || typeof item !== 'object') return false;
    if (item.isEntryCharge === true || item.entryCharge === true || item.entry_charge === true) return true;
    if (isEntryIdentifier(item.source) || isEntryIdentifier(item.type) || isEntryIdentifier(item.kitchenType || item.kitchen_type)) return true;
    if (isEntryIdentifier(item.id) || isEntryIdentifier(item.productId || item.product_id) || isEntryIdentifier(item.code || item.productCode || item.product_code)) return true;
    return normalizeEntryTitle(item.title || item.label || item.name || item.productName) === 'вхід';
}

function bookingPackageWarnings(previousWarnings = [], nextWarnings = []) {
    const result = [];
    const seen = new Set();
    for (const warning of [...(Array.isArray(previousWarnings) ? previousWarnings : []), ...nextWarnings]) {
        const code = cleanText(warning?.code, 120);
        const message = cleanText(warning?.message, 1000);
        if (!code && !message) continue;
        const key = `${code || ''}:${message || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const normalized = { code: code || 'booking_package_warning', message: message || code };
        if (Array.isArray(warning?.missingCodes)) {
            normalized.missingCodes = warning.missingCodes.map(item => cleanText(item, 120)).filter(Boolean);
        }
        result.push(normalized);
    }
    return result;
}

function buildBanquetEntryCharge(booking = {}, options = {}) {
    const warnings = [];
    if (!hasBanquetEntrySurface(booking)) {
        return { entryCharge: null, entrySubtotal: 0, warnings };
    }

    const positions = Array.isArray(options.positions) ? options.positions : normalizeMenuPositions(extractIncomingPositions(booking));
    if (positions.some(isManualEntryMenuPosition)) {
        warnings.push({
            code: 'manual_entry_position_present',
            message: 'У меню вже є окрема позиція "Вхід", автоматичний вхід не додано вдруге.'
        });
        return { entryCharge: null, entrySubtotal: 0, warnings };
    }

    const quantity = banquetEntryQuantityForBooking(booking, options);
    if (!quantity) {
        warnings.push({
            code: 'entry_quantity_missing',
            message: 'Кількість дітей для автоматичного входу не вказана, вхід не додано до суми.'
        });
        return { entryCharge: null, entrySubtotal: 0, warnings };
    }

    const dateType = banquetEntryDateType(booking.date || booking.bookingDate || booking.date_at || options.date);
    if (!dateType) {
        warnings.push({
            code: 'entry_date_missing',
            message: 'Дата бронювання некоректна, вхід не додано до суми.'
        });
        return { entryCharge: null, entrySubtotal: 0, warnings };
    }

    const ruleCode = BANQUET_ENTRY_PRICE_RULE_CODES[dateType];
    const rules = normalizeRuleMap(options.priceRules);
    const rule = rules.get(ruleCode);
    const unitPrice = numericRuleValue(rule);
    if (unitPrice === null) {
        warnings.push({
            code: 'entry_price_rule_missing',
            message: `Не знайдено price_rules.${ruleCode}, вхід не додано до суми.`,
            missingCodes: [ruleCode]
        });
        return { entryCharge: null, entrySubtotal: 0, warnings };
    }

    const subtotal = toMoney(quantity * unitPrice);
    return {
        entryCharge: {
            title: BANQUET_ENTRY_TITLE,
            quantity,
            unitPrice,
            subtotal,
            ruleCode,
            dateType,
            source: BANQUET_ENTRY_SOURCE
        },
        entrySubtotal: subtotal,
        warnings
    };
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
    const topLevelPackage = booking.bookingPackage || booking.booking_package || {};
    const extra = booking.extraData || booking.extra_data || {};
    return booking.menuPositions
        || booking.menu_positions
        || topLevelPackage.menuPositions
        || topLevelPackage.menu_positions
        || extra.bookingPackage?.menuPositions
        || extra.booking_package?.menu_positions
        || extra.menuPositions
        || [];
}

function normalizeTicketLine(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const ticketTypeCode = cleanText(raw.ticketTypeCode || raw.ticket_type_code, 64);
    const quantity = Number(raw.quantity);
    const unitPriceUah = Number(raw.unitPriceUah ?? raw.unit_price_uah);
    const subtotalUah = Number(raw.subtotalUah ?? raw.subtotal_uah);
    const ticketTypeId = Number(raw.ticketTypeId || raw.ticket_type_id);
    const tariffVersionId = Number(raw.tariffVersionId || raw.tariff_version_id);
    if (
        !ticketTypeCode
        || !Number.isInteger(quantity)
        || quantity < 0
        || !Number.isFinite(unitPriceUah)
        || unitPriceUah < 0
        || !Number.isFinite(subtotalUah)
        || subtotalUah < 0
        || !Number.isInteger(ticketTypeId)
        || ticketTypeId <= 0
        || !Number.isInteger(tariffVersionId)
        || tariffVersionId <= 0
    ) return null;
    return {
        ticketTypeId,
        ticketTypeCode,
        ticketTypeName: cleanText(raw.ticketTypeName || raw.ticket_type_name, 160) || ticketTypeCode,
        audience: cleanText(raw.audience, 16),
        quantity,
        unitPriceUah: toMoney(unitPriceUah),
        subtotalUah: toMoney(subtotalUah),
        tariffVersionId,
        effectiveFrom: normalizeDateOnly(raw.effectiveFrom || raw.effective_from),
        admissionContext: cleanText(raw.admissionContext || raw.admission_context, 32),
        dayType: cleanText(raw.dayType || raw.day_type, 16),
        currency: cleanText(raw.currency, 8) || 'UAH'
    };
}

function normalizeTicketLines(value) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeTicketLine)
        .filter(Boolean);
}

function nestedTicketQuotePath(booking = {}) {
    const packages = [
        ['bookingPackage', booking.bookingPackage],
        ['booking_package', booking.booking_package]
    ];
    for (const [extraPath, extra] of extraDataCandidatesOf(booking)) {
        packages.push(
            [`${extraPath}.bookingPackage`, extra.bookingPackage],
            [`${extraPath}.booking_package`, extra.booking_package]
        );
    }
    for (const [path, bookingPackage] of packages) {
        if (!bookingPackage || typeof bookingPackage !== 'object' || Array.isArray(bookingPackage)) continue;
        if (Object.prototype.hasOwnProperty.call(bookingPackage, 'ticketQuote')) return `${path}.ticketQuote`;
        if (Object.prototype.hasOwnProperty.call(bookingPackage, 'ticket_quote')) return `${path}.ticket_quote`;
    }
    for (const [extraPath, extra] of extraDataCandidatesOf(booking)) {
        if (Object.prototype.hasOwnProperty.call(extra, 'ticketQuote')) return `${extraPath}.ticketQuote`;
        if (Object.prototype.hasOwnProperty.call(extra, 'ticket_quote')) return `${extraPath}.ticket_quote`;
    }
    return null;
}

function ticketQuoteFromBooking(booking = {}, options = {}) {
    return options.ticketQuote
        || booking.ticketQuote
        || booking.ticket_quote
        || null;
}

function hasExplicitTicketPackageInput(booking = {}, options = {}) {
    return Boolean(ticketQuoteFromBooking(booking, options))
        || Object.prototype.hasOwnProperty.call(booking, 'ticketQuantities')
        || Object.prototype.hasOwnProperty.call(booking, 'ticket_quantities');
}

function extractIncomingServiceEvents(booking = {}) {
    const topLevelPackage = booking.bookingPackage || booking.booking_package || {};
    const extra = booking.extraData || booking.extra_data || {};
    return booking.serviceEvents
        || booking.service_events
        || topLevelPackage.serviceEvents
        || topLevelPackage.service_events
        || extra.bookingPackage?.serviceEvents
        || extra.booking_package?.service_events
        || extra.serviceEvents
        || [];
}

function hasBookingPackageInput(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return hasExplicitTicketPackageInput(booking)
        || Object.prototype.hasOwnProperty.call(booking, 'menuPositions')
        || Object.prototype.hasOwnProperty.call(booking, 'menu_positions')
        || Object.prototype.hasOwnProperty.call(booking, 'serviceEvents')
        || Object.prototype.hasOwnProperty.call(booking, 'service_events')
        || Object.prototype.hasOwnProperty.call(booking, 'programBasePrice')
        || Object.prototype.hasOwnProperty.call(booking, 'program_base_price')
        || Object.prototype.hasOwnProperty.call(booking, 'bookingPackage')
        || Object.prototype.hasOwnProperty.call(booking, 'booking_package')
        || hasBanquetMenuWorkflowInput(booking)
        || Boolean(extra.bookingPackage || extra.booking_package || extra.menuPositions || extra.serviceEvents);
}

function buildBookingPackage(booking = {}, options = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    const previousPackage = extra.bookingPackage || extra.booking_package || {};
    const positions = normalizeMenuPositions(extractIncomingPositions(booking));
    const serviceEvents = normalizeServiceEvents(extractIncomingServiceEvents(booking));
    const positionsSubtotal = menuPositionsSubtotal(positions);
    const previousSchemaVersion = Number(
        previousPackage.schemaVersion || previousPackage.schema_version || 0
    );
    const previousEntryCharge = previousPackage.entryCharge || previousPackage.entry_charge || null;
    const previousEntrySubtotal = toMoney(
        previousPackage.entrySubtotal
        ?? previousPackage.entry_subtotal
        ?? previousEntryCharge?.subtotal
        ?? 0
    );
    const previousTicketLines = normalizeTicketLines(
        previousPackage.ticketLines || previousPackage.ticket_lines
    );
    const hasPreviousTicketSnapshot = previousSchemaVersion >= 3
        && Array.isArray(previousPackage.ticketLines || previousPackage.ticket_lines);
    const previousTicketSubtotal = hasPreviousTicketSnapshot
        ? toMoney(
            previousPackage.ticketSubtotal
            ?? previousPackage.ticket_subtotal
            ?? previousTicketLines.reduce((sum, line) => sum + line.subtotalUah, 0)
        )
        : 0;
    const previousAdmissionSubtotal = hasPreviousTicketSnapshot
        ? previousTicketSubtotal
        : previousEntrySubtotal;
    const fallbackBase = toMoney(
        (booking.price || 0) - positionsSubtotal - previousAdmissionSubtotal
    );
    const programBasePrice = toMoney(
        booking.programBasePrice
        ?? booking.program_base_price
        ?? previousPackage.programBasePrice
        ?? previousPackage.program_base_price,
        fallbackBase
    );
    const ticketQuote = ticketQuoteFromBooking(booking, options);
    const quotedRawTicketLines = ticketQuote?.ticketLines || ticketQuote?.ticket_lines;
    const hasQuotedTicketSnapshot = Boolean(
        ticketQuote
        && ticketQuote.legacy !== true
        && Array.isArray(quotedRawTicketLines)
    );
    const quotedTicketLines = normalizeTicketLines(ticketQuote?.ticketLines || ticketQuote?.ticket_lines);
    const hasTicketSnapshot = hasQuotedTicketSnapshot || hasPreviousTicketSnapshot;
    const ticketLines = hasQuotedTicketSnapshot ? quotedTicketLines : previousTicketLines;
    if (hasTicketSnapshot && positions.some(isManualEntryMenuPosition)) {
        const error = new Error('Manual menu position "Вхід" cannot be combined with ticketLines');
        error.code = 'TICKET_MANUAL_ENTRY_CONFLICT';
        error.statusCode = 422;
        error.publicMessage = 'Позицію меню «Вхід» не можна додавати разом із квитками. Видаліть ручну позицію «Вхід» і повторіть збереження.';
        error.details = {
            field: 'menuPositions',
            conflictWith: 'ticketLines'
        };
        throw error;
    }
    const entryResult = hasTicketSnapshot
        ? { entryCharge: null, entrySubtotal: 0, warnings: [] }
        : (
            previousEntryCharge && options.forceLegacyEntryReprice !== true
                ? {
                    entryCharge: previousEntryCharge,
                    entrySubtotal: previousEntrySubtotal,
                    warnings: []
                }
                : (
                    Object.prototype.hasOwnProperty.call(options, 'priceRules')
                        ? buildBanquetEntryCharge(booking, {
                            ...options,
                            positions
                        })
                        : {
                            entryCharge: null,
                            entrySubtotal: 0,
                            warnings: []
                        }
                )
        );
    const ticketSubtotal = hasTicketSnapshot
        ? toMoney(
            ticketQuote?.ticketSubtotal
            ?? ticketQuote?.ticket_subtotal
            ?? ticketLines.reduce((sum, line) => sum + line.subtotalUah, 0)
        )
        : 0;
    const entrySubtotal = hasTicketSnapshot
        ? ticketSubtotal
        : (entryResult.entryCharge ? toMoney(entryResult.entrySubtotal) : 0);
    const previousWarnings = hasTicketSnapshot
        ? (Array.isArray(previousPackage.warnings)
            ? previousPackage.warnings.filter(warning => !LEGACY_ENTRY_WARNING_CODES.has(warning?.code))
            : [])
        : previousPackage.warnings;
    const warnings = bookingPackageWarnings(previousWarnings, entryResult.warnings);
    const banquetPreorderRuleContract = options.banquetPreorderRuleContract || options.menuRuleContract || null;
    const menuWorkflow = normalizeBanquetMenuWorkflow({
        booking,
        previousWorkflow: previousPackage.menuWorkflow || previousPackage.menu_workflow || null,
        ruleContract: banquetPreorderRuleContract,
        actor: options.menuWorkflowActor || options.actor || null,
        now: options.now || null
    });
    const menuMinimumSnapshot = menuWorkflow?.minimumSnapshot || menuWorkflow?.minimum_snapshot || {};
    const menuFinancials = calculateBanquetMenuFinancials({
        positionsSubtotal,
        minimumAmount: menuMinimumSnapshot.minimumAmount ?? menuMinimumSnapshot.minimum_amount,
        programBasePrice,
        entrySubtotal,
        mode: menuWorkflow?.mode || 'preorder',
        status: menuWorkflow?.status || null,
        allowBelowMinimumException: Boolean(menuWorkflow?.creatorException)
    });
    const finalTotal = menuFinancials.finalTotal;
    const result = {
        schemaVersion: hasTicketSnapshot
            ? BOOKING_PACKAGE_SCHEMA_VERSION
            : Math.min(Number(previousPackage.schemaVersion || previousPackage.schema_version || 2), 2),
        programBasePrice,
        positionsSubtotal,
        entryCharge: hasTicketSnapshot ? null : (entryResult.entryCharge || null),
        entrySubtotal,
        finalTotal,
        menuPositions: positions,
        serviceEvents,
        source: 'booking_workspace'
    };
    if (menuWorkflow) {
        result.menuWorkflow = menuWorkflow;
    }
    if (menuFinancials.applies) {
        result.menuChargedSubtotal = menuFinancials.menuChargedSubtotal;
        result.billingBasis = menuFinancials.billingBasis;
        if (menuWorkflow?.status === 'finalized') {
            const minimumAdjustment = buildMenuMinimumAdjustment({
                amount: menuFinancials.adjustmentAmount,
                minimumAmount: menuFinancials.minimumAmount,
                positionsSubtotal,
                actor: options.menuWorkflowActor || options.actor || null,
                now: options.now || null,
                status: 'final'
            });
            if (minimumAdjustment) result.menuMinimumAdjustment = minimumAdjustment;
        }
    }
    const banquetPreorderStatus = buildBanquetPreorderStatus({
        booking,
        bookingPackage: result,
        deposit: booking.banquetDeposit || booking.banquet_deposit || booking.deposit || null,
        ruleContract: banquetPreorderRuleContract
    });
    if (banquetPreorderStatus.applies) {
        result.banquetPreorderStatus = banquetPreorderStatus;
    }
    if (previousPackage.preorderWarningAcknowledgement || previousPackage.preorder_warning_acknowledgement) {
        result.preorderWarningAcknowledgement = previousPackage.preorderWarningAcknowledgement || previousPackage.preorder_warning_acknowledgement;
    }
    if (hasTicketSnapshot) {
        result.ticketLines = ticketLines;
        result.ticketSubtotal = ticketSubtotal;
        result.ticketQuoteContractVersion = Number(
            ticketQuote?.quoteContractVersion
            ?? ticketQuote?.quote_contract_version
            ?? previousPackage.ticketQuoteContractVersion
            ?? previousPackage.ticket_quote_contract_version
            ?? 0
        ) || null;
        result.ticketQuoteFingerprint = cleanText(
            ticketQuote?.quoteFingerprint
            || ticketQuote?.quote_fingerprint
            || previousPackage.ticketQuoteFingerprint
            || previousPackage.ticket_quote_fingerprint,
            120
        );
        result.ticketBusinessContext = cleanText(
            ticketQuote?.businessContext
            || ticketQuote?.business_context
            || previousPackage.ticketBusinessContext
            || previousPackage.ticket_business_context,
            64
        );
        result.ticketPricingContext = cleanText(
            ticketQuote?.admissionContext
            || ticketQuote?.admission_context
            || previousPackage.ticketPricingContext
            || previousPackage.ticket_pricing_context
            || ticketLines[0]?.admissionContext,
            32
        );
        result.ticketDayType = cleanText(
            ticketQuote?.dayType
            || ticketQuote?.day_type
            || previousPackage.ticketDayType
            || previousPackage.ticket_day_type
            || ticketLines[0]?.dayType,
            16
        );
        result.ticketPricingDate = normalizeDateOnly(
            ticketQuote?.pricingDate
            || ticketQuote?.pricing_date
            || previousPackage.ticketPricingDate
            || previousPackage.ticket_pricing_date
            || booking.date
        );
        result.ticketPricedAt = cleanText(
            ticketQuote?.pricedAt
            || ticketQuote?.priced_at
            || previousPackage.ticketPricedAt
            || previousPackage.ticket_priced_at,
            80
        );
    }
    if (warnings.length) result.warnings = warnings;
    return result;
}

function applyBookingPackage(booking = {}, options = {}) {
    const forbiddenTicketQuotePath = nestedTicketQuotePath(booking);
    if (forbiddenTicketQuotePath) {
        const error = new Error('Ticket quotes must be supplied only through the canonical top-level server quote flow');
        error.code = 'TICKET_SNAPSHOT_INPUT_FORBIDDEN';
        error.statusCode = 422;
        error.details = { field: forbiddenTicketQuotePath };
        throw error;
    }
    if (!hasBookingPackageInput(booking)) return booking;
    const extra = booking.extraData && typeof booking.extraData === 'object' ? { ...booking.extraData } : {};
    const bookingPackage = buildBookingPackage({ ...booking, extraData: extra }, options);
    booking.extraData = {
        ...extra,
        bookingPackage
    };
    booking.price = bookingPackage.finalTotal;
    booking.banquetMenu = buildLegacyBanquetMenu(bookingPackage.menuPositions, booking.banquetMenu);
    return booking;
}

async function loadBanquetEntryPriceRules(queryable) {
    if (!queryable || typeof queryable.query !== 'function') return [];
    const result = await queryable.query(
        `SELECT code, name, value, unit, category, description
           FROM price_rules
          WHERE code = ANY($1::text[])`,
        [BANQUET_ENTRY_PRICE_RULE_CODE_LIST]
    );
    return result.rows || [];
}

async function applyBookingPackageEntryCharge(queryable, booking = {}, options = {}) {
    if (!hasBookingPackageInput(booking)) return booking;
    const banquetPreorderRuleContract = options.banquetPreorderRuleContract
        || options.menuRuleContract
        || await loadBanquetPreorderRuleContract(queryable);
    if (hasExplicitTicketPackageInput(booking, options)) {
        return applyBookingPackage(booking, {
            ...options,
            banquetPreorderRuleContract
        });
    }
    if (options.preserveNoTicketPackage === true) {
        return applyBookingPackage(booking, {
            ...options,
            banquetPreorderRuleContract
        });
    }
    const priceRules = Array.isArray(options.priceRules)
        ? options.priceRules
        : await loadBanquetEntryPriceRules(queryable);
    return applyBookingPackage(booking, {
        ...options,
        priceRules,
        banquetPreorderRuleContract
    });
}

function bookingPackageAudit(oldRow, nextBooking) {
    const oldExtra = oldRow?.extra_data || {};
    const oldPackage = oldExtra.bookingPackage || oldExtra.booking_package || null;
    const nextPackage = nextBooking?.extraData?.bookingPackage || null;
    const oldCustomerId = oldRow?.customer_id || null;
    const nextCustomerId = nextBooking?.customerId || nextBooking?.customer_id || oldCustomerId || null;
    const oldTicketLines = normalizeTicketLines(oldPackage?.ticketLines || oldPackage?.ticket_lines);
    const nextTicketLines = normalizeTicketLines(nextPackage?.ticketLines || nextPackage?.ticket_lines);
    const oldTicketSubtotal = oldPackage?.ticketSubtotal
        ?? oldPackage?.ticket_subtotal
        ?? (oldTicketLines.length ? oldTicketLines.reduce((sum, line) => sum + line.subtotalUah, 0) : null);
    const nextTicketSubtotal = nextPackage?.ticketSubtotal
        ?? nextPackage?.ticket_subtotal
        ?? (nextTicketLines.length ? nextTicketLines.reduce((sum, line) => sum + line.subtotalUah, 0) : null);
    const ticketChanged = JSON.stringify(oldTicketLines) !== JSON.stringify(nextTicketLines)
        || toMoney(oldTicketSubtotal || 0) !== toMoney(nextTicketSubtotal || 0);
    let ticketReason = null;
    if (ticketChanged) {
        const oldDate = normalizeDateOnly(oldRow?.date);
        const nextDate = normalizeDateOnly(nextBooking?.date);
        const oldContext = oldPackage?.ticketPricingContext || oldPackage?.ticket_pricing_context || null;
        const nextContext = nextPackage?.ticketPricingContext || nextPackage?.ticket_pricing_context || null;
        if (nextBooking?.convertLegacy === true || nextBooking?.convert_legacy === true) ticketReason = 'explicit_conversion';
        else if (oldDate && nextDate && oldDate !== nextDate) ticketReason = 'date';
        else if (oldContext !== nextContext) ticketReason = 'context';
        else ticketReason = 'quantities';
    }
    return {
        customerChanged: String(oldCustomerId || '') !== String(nextCustomerId || ''),
        packageChanged: JSON.stringify(oldPackage || null) !== JSON.stringify(nextPackage || null),
        ticketAudit: {
            changed: ticketChanged,
            reason: ticketReason,
            oldTicketLines,
            newTicketLines: nextTicketLines,
            oldTicketSubtotal: oldTicketSubtotal === null ? null : toMoney(oldTicketSubtotal),
            newTicketSubtotal: nextTicketSubtotal === null ? null : toMoney(nextTicketSubtotal)
        },
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
    BANQUET_ENTRY_PRICE_RULE_CODES,
    BANQUET_ENTRY_PRICE_RULE_CODE_LIST,
    BANQUET_ENTRY_SOURCE,
    normalizeMenuPosition,
    normalizeMenuPositions,
    menuPositionsSubtotal,
    banquetEntryDateType,
    banquetEntryQuantityForBooking,
    isManualEntryMenuPosition,
    buildBanquetEntryCharge,
    loadBanquetEntryPriceRules,
    normalizeMenuServingUnitDisplay,
    formatMenuQuantityWithServingUnit,
    formatMenuPositionQuantity,
    normalizeServiceEvent,
    normalizeServiceEvents,
    normalizeTicketLine,
    normalizeTicketLines,
    hasExplicitTicketPackageInput,
    buildLegacyBanquetMenu,
    buildBookingPackage,
    applyBookingPackage,
    applyBookingPackageEntryCharge,
    bookingPackageAudit
};
