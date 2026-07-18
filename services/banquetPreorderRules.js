'use strict';

const BANQUET_PREORDER_RULES = Object.freeze({
    room: Object.freeze({
        placeType: 'room',
        placeLabel: 'Кімнатка',
        requiredMenuMinimum: 4000
    }),
    table: Object.freeze({
        placeType: 'table',
        placeLabel: 'Столик',
        requiredMenuMinimum: 2500
    })
});

const BANQUET_RECOMMENDED_DEPOSIT_AMOUNT = 2000;

function cleanText(value, max = 240) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, max);
}

function money(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = typeof value === 'string'
        ? value.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
        : value;
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.round(number * 100) / 100;
}

function nullableMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    return money(value, null);
}

function parseObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function firstClean(...values) {
    for (const value of values) {
        const text = cleanText(value);
        if (text) return text;
    }
    return '';
}

function normalizeExplicitPlaceType(value) {
    const raw = cleanText(value, 80).toLowerCase();
    if (!raw) return null;
    if (['room', 'private_room', 'banquet_room', 'themed_room', 'кімнатка', 'кімната', 'кімнатна бронь'].includes(raw)) return 'room';
    if (['table', 'reserved_table', 'hall_table', 'столик', 'стіл', 'диван'].includes(raw)) return 'table';
    if (/кімнат|room|hall/.test(raw)) return 'room';
    if (/стол|стіл|table|диван|sofa|couch/.test(raw)) return 'table';
    return null;
}

function roomTextLooksLikeTable(value) {
    const text = cleanText(value, 240).toLowerCase();
    if (!text) return false;
    return /стол|стіл|столик|диван|table|sofa|couch|reserved[_ -]?table/.test(text);
}

function roomTextLooksLikeRoom(value) {
    const text = cleanText(value, 240).toLowerCase();
    if (!text) return false;
    return /кімнат|кімната|кімнатка|room|hall|зал/.test(text);
}

function banquetPackageOf(source = {}) {
    const extra = parseObject(source.extraData ?? source.extra_data);
    return source.bookingPackage
        || source.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function resolveBanquetPreorderPlaceType(input = {}) {
    const booking = input.booking && typeof input.booking === 'object' ? input.booking : input;
    const extra = parseObject(booking.extraData ?? booking.extra_data);
    const workspace = parseObject(extra.bookingWorkspace || extra.booking_workspace);
    const packageData = input.bookingPackage || banquetPackageOf(booking);
    const explicit = normalizeExplicitPlaceType(
        input.placeType
        || input.banquetPlaceType
        || input.banquet_place_type
        || booking.banquetPlaceType
        || booking.banquet_place_type
        || workspace.banquetPlaceType
        || workspace.banquet_place_type
        || packageData.banquetPlaceType
        || packageData.banquet_place_type
        || packageData.placeType
        || packageData.place_type
    );
    if (explicit) return explicit;

    const roomIdentity = firstClean(
        input.roomResourceId,
        input.room_resource_id,
        booking.roomResourceId,
        booking.room_resource_id,
        input.room,
        booking.room,
        input.roomLabel,
        input.room_label
    );
    if (roomTextLooksLikeTable(roomIdentity)) return 'table';
    if (roomTextLooksLikeRoom(roomIdentity)) return 'room';
    return null;
}

function menuSubtotalFromPackage(bookingPackage = {}, fallback = null) {
    const explicit = nullableMoney(bookingPackage.positionsSubtotal ?? bookingPackage.positions_subtotal);
    if (explicit !== null) return explicit;
    const positions = bookingPackage.menuPositions || bookingPackage.menu_positions || [];
    if (Array.isArray(positions)) {
        return money(positions.reduce((sum, item) => sum + money(item?.subtotal ?? (money(item?.quantity ?? item?.qty, 1) * money(item?.unitPrice ?? item?.unit_price ?? item?.price, 0))), 0));
    }
    return nullableMoney(fallback) ?? 0;
}

function depositAmountFromSource(source = null) {
    if (!source || typeof source !== 'object') return null;
    const deposit = source.deposit && typeof source.deposit === 'object' ? source.deposit : source;
    const display = source.display && typeof source.display === 'object' ? source.display : {};
    return nullableMoney(
        deposit.paidAmount
        ?? deposit.paid_amount
        ?? deposit.expectedAmount
        ?? deposit.expected_amount
        ?? deposit.amount
        ?? display.amount
    );
}

function formatRuleMoney(value) {
    const amount = money(value, 0);
    return Number.isInteger(amount) ? String(amount) : String(amount).replace('.', ',');
}

function isBanquetPreorderApplicable(booking = {}, bookingPackage = {}, options = {}) {
    if (options.applies === true) return true;
    if (options.applies === false) return false;
    const extra = parseObject(booking.extraData ?? booking.extra_data);
    const workspace = parseObject(extra.bookingWorkspace || extra.booking_workspace);
    const category = cleanText(booking.category || booking.category_id, 80).toLowerCase();
    const programCode = cleanText(booking.programCode || booking.program_code, 80).toUpperCase();
    const scenario = cleanText(workspace.scenario || booking.scenario, 80).toLowerCase();
    return category === 'kitchen'
        || category === 'banquet'
        || programCode === 'KITCHEN'
        || scenario === 'kitchen_only'
        || scenario === 'event_kitchen'
        || booking.banquetGuests != null
        || booking.banquet_guests != null
        || booking.banquetAdults != null
        || booking.banquet_adults != null
        || booking.banquetTables != null
        || booking.banquet_tables != null
        || (Array.isArray(bookingPackage.menuPositions) && bookingPackage.menuPositions.length > 0)
        || (Array.isArray(bookingPackage.menu_positions) && bookingPackage.menu_positions.length > 0);
}

function buildBanquetPreorderStatus(input = {}) {
    const booking = input.booking && typeof input.booking === 'object' ? input.booking : input;
    const bookingPackage = input.bookingPackage || banquetPackageOf(booking);
    const applies = isBanquetPreorderApplicable(booking, bookingPackage, input);
    const placeType = resolveBanquetPreorderPlaceType(input);
    const rule = placeType ? BANQUET_PREORDER_RULES[placeType] : null;
    const currentMenuSubtotal = menuSubtotalFromPackage(bookingPackage, input.menuSubtotal ?? input.menu_subtotal);
    const currentDepositAmount = depositAmountFromSource(
        input.depositProjection
        || input.deposit
        || booking.banquetDeposit
        || booking.banquet_deposit
        || booking.deposit
    );
    const warnings = [];
    let menuStatus = 'not_applicable';
    let missingMenuAmount = null;

    if (applies && rule) {
        missingMenuAmount = money(Math.max(0, rule.requiredMenuMinimum - currentMenuSubtotal));
        menuStatus = missingMenuAmount > 0 ? 'below_minimum' : 'sufficient';
        if (missingMenuAmount > 0) {
            warnings.push({
                code: 'banquet_menu_minimum_below',
                message: `Меню нижче мінімуму для ${rule.placeLabel.toLowerCase()}: потрібно ${formatRuleMoney(rule.requiredMenuMinimum)} грн, зараз ${formatRuleMoney(currentMenuSubtotal)} грн, бракує ${formatRuleMoney(missingMenuAmount)} грн. Збереження не блокується.`,
                severity: 'warning'
            });
        }
    } else if (applies) {
        menuStatus = 'place_type_unknown';
        warnings.push({
            code: 'banquet_place_type_unknown',
            message: 'Не визначено тип місця для банкету: кімнатка чи столик. Перевірте мінімальне передзамовлення вручну.',
            severity: 'warning'
        });
    }

    let depositStatus = 'not_applicable';
    let missingDepositAmount = null;
    if (applies) {
        if (currentDepositAmount === null) {
            depositStatus = 'missing';
            missingDepositAmount = BANQUET_RECOMMENDED_DEPOSIT_AMOUNT;
            warnings.push({
                code: 'banquet_deposit_missing',
                message: `Завдаток не вказано. Рекомендований завдаток — ${formatRuleMoney(BANQUET_RECOMMENDED_DEPOSIT_AMOUNT)} грн. Збереження не блокується.`,
                severity: 'warning'
            });
        } else {
            missingDepositAmount = money(Math.max(0, BANQUET_RECOMMENDED_DEPOSIT_AMOUNT - currentDepositAmount));
            depositStatus = missingDepositAmount > 0 ? 'below_recommended' : 'sufficient';
            if (missingDepositAmount > 0) {
                warnings.push({
                    code: 'banquet_deposit_below_recommended',
                    message: `Завдаток нижче рекомендації: потрібно ${formatRuleMoney(BANQUET_RECOMMENDED_DEPOSIT_AMOUNT)} грн, зараз ${formatRuleMoney(currentDepositAmount)} грн, бракує ${formatRuleMoney(missingDepositAmount)} грн. Збереження не блокується.`,
                    severity: 'warning'
                });
            }
        }
    }

    return {
        applies,
        placeType,
        placeLabel: rule?.placeLabel || null,
        requiredMenuMinimum: rule?.requiredMenuMinimum ?? null,
        currentMenuSubtotal,
        missingMenuAmount,
        menuStatus,
        recommendedDepositAmount: BANQUET_RECOMMENDED_DEPOSIT_AMOUNT,
        currentDepositAmount,
        missingDepositAmount,
        depositStatus,
        warnings
    };
}

module.exports = {
    BANQUET_PREORDER_RULES,
    BANQUET_RECOMMENDED_DEPOSIT_AMOUNT,
    resolveBanquetPreorderPlaceType,
    menuSubtotalFromPackage,
    depositAmountFromSource,
    buildBanquetPreorderStatus
};
