'use strict';

const { normalizeMenuPositions, menuPositionsSubtotal } = require('./bookingPackage');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextCatalog,
    normalizeBusinessContext
} = require('./businessContext');

const BANQUET_SUMMARY_SCHEMA_VERSION = 1;
const CURRENCY = 'UAH';

const EVENT_GENIX_VENUE = Object.freeze({
    name: 'Розважальний центр "Парк Закревського Періоду"',
    addressLine1: 'м.Київ вул. Закревського 61/2',
    addressLine2: 'ТРЦ "Закревський", 3й поверх',
    phone: '0 800 753 553'
});

function cleanText(value, max = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function nullableNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function money(value) {
    const n = nullableNumber(value);
    return n === null ? null : Math.round(n * 100) / 100;
}

function quantity(value, fallback = 1) {
    const n = nullableNumber(value);
    if (n === null || n <= 0) return fallback;
    return Math.round(n * 100) / 100;
}

function extraDataOf(booking = {}) {
    const raw = booking.extraData || booking.extra_data || {};
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) || {};
        } catch {
            return {};
        }
    }
    return typeof raw === 'object' ? raw : {};
}

function bookingPackageOf(booking = {}) {
    const extra = extraDataOf(booking);
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || null;
}

function valueOf(source = {}, ...keys) {
    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
    }
    return null;
}

function bookingIdOf(booking = {}) {
    return cleanText(valueOf(booking, 'id', 'bookingId', 'booking_id'), 100);
}

function bookingTitle(booking = {}) {
    return cleanText(
        valueOf(booking, 'programName', 'program_name', 'label', 'groupName', 'group_name'),
        200
    );
}

function businessContextLabel(context) {
    const entry = businessContextCatalog().find(item => item.key === context);
    return cleanText(entry?.label || entry?.shortLabel || context, 200) || context;
}

function venueForContext(businessContext, warnings) {
    const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    if (context === DEFAULT_BUSINESS_CONTEXT) {
        return { ...EVENT_GENIX_VENUE };
    }
    warnings.push({
        code: 'venue_neutral_fallback',
        message: 'Для цього businessContext немає окремої шапки закладу.'
    });
    return {
        name: businessContextLabel(context),
        addressLine1: null,
        addressLine2: null,
        phone: null
    };
}

function normalizeCustomer(customer = {}) {
    return {
        id: valueOf(customer, 'id'),
        name: cleanText(valueOf(customer, 'name', 'customerName', 'customer_name'), 200),
        phone: cleanText(valueOf(customer, 'phone', 'customerPhone', 'customer_phone'), 80),
        instagram: cleanText(valueOf(customer, 'instagram'), 120),
        source: cleanText(valueOf(customer, 'source'), 120),
        notes: cleanText(valueOf(customer, 'notes'), 1000)
    };
}

function normalizeCelebrant(mainBooking = {}, customer = {}) {
    const extra = extraDataOf(mainBooking);
    const celebrant = extra.celebrant || extra.child || {};
    return {
        name: cleanText(
            valueOf(celebrant, 'name')
            || valueOf(customer, 'childName', 'child_name')
            || valueOf(mainBooking, 'childName', 'child_name'),
            200
        ),
        birthday: cleanText(
            valueOf(celebrant, 'birthday', 'birthDate')
            || valueOf(customer, 'childBirthday', 'child_birthday')
            || valueOf(mainBooking, 'childBirthday', 'child_birthday'),
            40
        )
    };
}

function buildProgramRow(mainBooking = {}, programBasePrice) {
    const title = bookingTitle(mainBooking);
    if (!title || programBasePrice === null) return null;
    return {
        id: `program:${bookingIdOf(mainBooking) || 'main'}`,
        type: 'program',
        source: 'main_booking',
        bookingId: bookingIdOf(mainBooking),
        title,
        quantity: 1,
        unitPrice: programBasePrice,
        subtotal: programBasePrice,
        comment: cleanText(valueOf(mainBooking, 'notes'), 500),
        meta: {
            programId: cleanText(valueOf(mainBooking, 'programId', 'program_id'), 120),
            programCode: cleanText(valueOf(mainBooking, 'programCode', 'program_code'), 80),
            category: cleanText(valueOf(mainBooking, 'category'), 80),
            room: cleanText(valueOf(mainBooking, 'room'), 120)
        }
    };
}

function buildLinkedActivityRows(linkedBookings = []) {
    return (Array.isArray(linkedBookings) ? linkedBookings : [])
        .map((booking, index) => {
            const title = bookingTitle(booking);
            const subtotal = money(valueOf(booking, 'price'));
            if (!title && subtotal === null) return null;
            return {
                id: `activity:${bookingIdOf(booking) || index + 1}`,
                type: 'activity',
                source: 'linked_booking',
                bookingId: bookingIdOf(booking),
                title: title || `Додаткова активність ${index + 1}`,
                quantity: 1,
                unitPrice: subtotal,
                subtotal,
                comment: cleanText(valueOf(booking, 'notes') || valueOf(booking, 'label'), 500),
                meta: {
                    relationType: cleanText(booking._banquetLink?.relation_type || booking._banquetLink?.relationType, 80) || 'banquet_activity',
                    relationLabel: cleanText(booking._banquetLink?.label, 200),
                    room: cleanText(valueOf(booking, 'room'), 120),
                    time: cleanText(valueOf(booking, 'time'), 20),
                    duration: nullableNumber(valueOf(booking, 'duration'))
                }
            };
        })
        .filter(Boolean);
}

function buildMenuRows(menuPositions = []) {
    return normalizeMenuPositions(menuPositions).map((item, index) => ({
        id: `menu:${item.id || index + 1}`,
        type: 'menu',
        source: item.source || 'booking_package',
        bookingId: null,
        title: item.title,
        quantity: quantity(item.quantity),
        unitPrice: money(item.unitPrice),
        subtotal: money(item.subtotal) ?? money(quantity(item.quantity) * (money(item.unitPrice) || 0)),
        comment: cleanText(item.note, 500),
        meta: {
            productId: item.productId || null,
            code: item.code || null,
            menuSection: item.menuSection || null,
            servingUnit: item.servingUnit || null,
            kitchenType: item.kitchenType || null,
            weightValue: item.weightValue || null,
            cakeDecoration: item.cakeDecoration || null
        }
    }));
}

function buildLegacyBanquetMenuRows(booking = {}) {
    const menu = cleanText(valueOf(booking, 'banquetMenu', 'banquet_menu'), 5000);
    if (!menu) return [];
    return menu
        .split(/\r?\n/)
        .map(line => cleanText(line, 500))
        .filter(Boolean)
        .map((line, index) => ({
            id: `legacy-menu:${index + 1}`,
            type: 'menu',
            source: 'legacy_banquet_menu',
            bookingId: bookingIdOf(booking),
            title: line,
            quantity: 1,
            unitPrice: null,
            subtotal: null,
            comment: null,
            meta: {}
        }));
}

function sumKnown(rows = []) {
    const values = rows.map(row => money(row.subtotal)).filter(value => value !== null);
    if (!values.length) return null;
    return money(values.reduce((sum, value) => sum + value, 0));
}

function depositCandidate(source, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const amount = money(valueOf(value, 'amount', 'depositAmount', 'deposit_amount', 'value'));
    if (amount === null) return null;
    return {
        amount,
        paymentMethod: cleanText(valueOf(value, 'paymentMethod', 'payment_method', 'method'), 80),
        paymentStatus: cleanText(valueOf(value, 'paymentStatus', 'payment_status', 'status'), 80),
        note: cleanText(valueOf(value, 'note', 'comment', 'description'), 500),
        source
    };
}

function explicitDepositOf(mainBooking = {}) {
    const extra = extraDataOf(mainBooking);
    const objectCandidates = [
        ['extra_data.deposit', extra.deposit],
        ['extra_data.banquetDeposit', extra.banquetDeposit],
        ['extra_data.bookingDeposit', extra.bookingDeposit],
        ['extra_data.bookingPayment.deposit', extra.bookingPayment?.deposit],
        ['extra_data.payment.deposit', extra.payment?.deposit]
    ];

    for (const [source, value] of objectCandidates) {
        const candidate = depositCandidate(source, value);
        if (candidate) return candidate;
    }

    const bookingDepositAmount = valueOf(mainBooking, 'depositAmount', 'deposit_amount');
    const extraDepositAmount = valueOf(
        extra,
        'depositAmount',
        'deposit_amount',
        'banquetDepositAmount',
        'banquet_deposit_amount'
    );
    const explicitAmount = money(bookingDepositAmount ?? extraDepositAmount);
    if (explicitAmount !== null) {
        return {
            amount: explicitAmount,
            paymentMethod: cleanText(
                valueOf(mainBooking, 'depositPaymentMethod', 'deposit_payment_method')
                || valueOf(extra, 'depositPaymentMethod', 'deposit_payment_method'),
                80
            ),
            paymentStatus: cleanText(
                valueOf(mainBooking, 'depositPaymentStatus', 'deposit_payment_status')
                || valueOf(extra, 'depositPaymentStatus', 'deposit_payment_status'),
                80
            ),
            note: cleanText(
                valueOf(mainBooking, 'depositNote', 'deposit_note')
                || valueOf(extra, 'depositNote', 'deposit_note'),
                500
            ),
            source: bookingDepositAmount !== null ? 'booking.deposit_amount' : 'extra_data.depositAmount'
        };
    }

    return {
        amount: null,
        paymentMethod: null,
        paymentStatus: null,
        note: null,
        source: null
    };
}

function termsOf(mainBooking = {}, warnings) {
    const extra = extraDataOf(mainBooking);
    const rawTerms = extra.banquetTerms || extra.banquet_terms || extra.terms || [];
    const items = Array.isArray(rawTerms)
        ? rawTerms.map(item => cleanText(item, 800)).filter(Boolean)
        : cleanText(rawTerms, 3000)
            ? cleanText(rawTerms, 3000).split(/\r?\n/).map(item => cleanText(item, 800)).filter(Boolean)
            : [];
    if (!items.length) {
        warnings.push({
            code: 'terms_missing',
            message: 'Умови банкету не знайдені в даних бронювання.'
        });
    }
    return {
        title: 'Умови банкету',
        items
    };
}

function buildBanquetSummary({ mainBooking, customer = null, linkedBookings = [], businessContext, generatedBy = null } = {}) {
    if (!mainBooking || typeof mainBooking !== 'object') {
        throw new Error('mainBooking is required');
    }

    const warnings = [];
    const context = normalizeBusinessContext(
        businessContext
        || valueOf(mainBooking, 'businessContext', 'business_context')
        || DEFAULT_BUSINESS_CONTEXT
    );
    const bookingPackage = bookingPackageOf(mainBooking) || {};
    const menuPositions = normalizeMenuPositions(bookingPackage.menuPositions || bookingPackage.menu_positions || []);
    const menuRows = menuPositions.length ? buildMenuRows(menuPositions) : buildLegacyBanquetMenuRows(mainBooking);
    if (!menuPositions.length && menuRows.length) {
        warnings.push({
            code: 'legacy_banquet_menu_used',
            message: 'Меню взято з legacy поля banquet_menu, бо structured menuPositions порожні.'
        });
    }

    const bookingPrice = money(valueOf(mainBooking, 'price'));
    const menuSubtotal = money(valueOf(bookingPackage, 'positionsSubtotal', 'positions_subtotal')) ?? sumKnown(menuRows);
    const explicitProgramBasePrice = money(valueOf(bookingPackage, 'programBasePrice', 'program_base_price'));
    const inferredProgramBasePrice = bookingPrice !== null && menuSubtotal !== null
        ? money(Math.max(0, bookingPrice - menuSubtotal))
        : bookingPrice;
    const programBasePrice = explicitProgramBasePrice ?? inferredProgramBasePrice;
    const programRow = buildProgramRow(mainBooking, programBasePrice);
    const activityRows = buildLinkedActivityRows(linkedBookings);
    const orderRows = [programRow, ...activityRows, ...menuRows].filter(Boolean);
    const rowsTotal = sumKnown(orderRows);
    const packageTotal = money(valueOf(bookingPackage, 'finalTotal', 'final_total'));
    const orderTotal = rowsTotal ?? packageTotal ?? bookingPrice;
    const deposit = explicitDepositOf(mainBooking);
    const paidAmount = money(valueOf(mainBooking, 'paidAmount', 'paid_amount'));
    if (deposit.amount === null) {
        warnings.push({
            code: 'deposit_not_specified',
            message: 'Завдаток не вказано'
        });
        if (paidAmount !== null && paidAmount > 0) {
            warnings.push({
                code: 'paid_amount_not_used_as_deposit',
                message: 'У бронюванні є paid_amount, але немає явного маркера завдатку, тому paid_amount не підставлено як завдаток.'
            });
        }
    }

    if (!menuPositions.length && !menuRows.length) {
        warnings.push({
            code: 'menu_rows_missing',
            message: 'У бронюванні немає structured menuPositions або legacy banquet_menu.'
        });
    }

    return {
        success: true,
        schemaVersion: BANQUET_SUMMARY_SCHEMA_VERSION,
        bookingId: bookingIdOf(mainBooking),
        businessContext: context,
        document: {
            type: 'banquet_summary',
            title: 'Вижимка банкету',
            generatedAt: new Date().toISOString(),
            generatedBy: cleanText(generatedBy?.name || generatedBy?.username || generatedBy, 160)
        },
        venue: venueForContext(context, warnings),
        event: {
            date: cleanText(valueOf(mainBooking, 'date'), 40),
            time: cleanText(valueOf(mainBooking, 'time'), 20),
            room: cleanText(valueOf(mainBooking, 'room'), 120),
            programName: cleanText(valueOf(mainBooking, 'programName', 'program_name'), 200),
            groupName: cleanText(valueOf(mainBooking, 'groupName', 'group_name'), 200),
            createdAt: cleanText(valueOf(mainBooking, 'createdAt', 'created_at'), 80),
            manager: cleanText(valueOf(mainBooking, 'createdBy', 'created_by'), 160),
            status: cleanText(valueOf(mainBooking, 'status'), 40)
        },
        customer: normalizeCustomer(customer || {}),
        celebrant: normalizeCelebrant(mainBooking, customer || {}),
        counts: {
            children: nullableNumber(valueOf(mainBooking, 'kidsCount', 'kids_count')),
            adults: nullableNumber(valueOf(mainBooking, 'banquetAdults', 'banquet_adults')),
            guests: nullableNumber(valueOf(mainBooking, 'banquetGuests', 'banquet_guests')),
            tables: nullableNumber(valueOf(mainBooking, 'banquetTables', 'banquet_tables'))
        },
        orderRows,
        totals: {
            programBasePrice,
            menuSubtotal,
            orderTotal,
            bookingPrice,
            currency: CURRENCY
        },
        deposit: {
            amount: deposit.amount,
            paymentMethod: deposit.paymentMethod,
            paymentStatus: deposit.paymentStatus,
            note: deposit.note,
            source: deposit.source
        },
        terms: termsOf(mainBooking, warnings),
        warnings
    };
}

module.exports = {
    BANQUET_SUMMARY_SCHEMA_VERSION,
    buildBanquetSummary
};
