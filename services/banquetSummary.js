'use strict';

const { normalizeMenuPositions, normalizeServiceEvents, menuPositionsSubtotal } = require('./bookingPackage');
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
    const raw = booking.extraData !== undefined && booking.extraData !== null && booking.extraData !== ''
        ? booking.extraData
        : (booking.extra_data || {});
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

function bookingWorkspaceOf(booking = {}) {
    const extra = extraDataOf(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    return workspace && typeof workspace === 'object' && !Array.isArray(workspace) ? workspace : {};
}

function bookingWorkspaceCommentsOf(booking = {}) {
    const comments = bookingWorkspaceOf(booking).comments || {};
    return comments && typeof comments === 'object' && !Array.isArray(comments) ? comments : {};
}

function bookingWorkspaceComment(booking = {}, type = 'internal', max = 500) {
    if (!['kitchen', 'activity', 'internal'].includes(type)) return null;
    return cleanText(bookingWorkspaceCommentsOf(booking)[type], max);
}

function bookingSummaryComment(booking = {}, type = 'internal', options = {}) {
    const fallbackKeys = Array.isArray(options.fallbackKeys) ? options.fallbackKeys : ['notes'];
    const fallback = fallbackKeys.length ? valueOf(booking, ...fallbackKeys) : null;
    return cleanText(
        bookingWorkspaceComment(booking, type, options.max || 500)
        || fallback,
        options.max || 500
    );
}

function bookingIdOf(booking = {}) {
    return cleanText(valueOf(booking, 'id', 'bookingId', 'booking_id'), 100);
}

function bookingLinkedToOf(booking = {}) {
    return cleanText(valueOf(booking, 'linkedTo', 'linked_to'), 100);
}

function isRootBooking(booking = {}) {
    return !bookingLinkedToOf(booking);
}

function isActiveBooking(booking = {}) {
    return String(valueOf(booking, 'status') || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function bookingTitle(booking = {}) {
    return cleanText(
        valueOf(booking, 'programName', 'program_name', 'label', 'groupName', 'group_name'),
        200
    );
}

function sameBooking(a = {}, b = {}) {
    const aId = bookingIdOf(a);
    const bId = bookingIdOf(b);
    return Boolean(aId && bId && aId === bId);
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
        comment: bookingSummaryComment(mainBooking, 'activity', { fallbackKeys: [] })
            || bookingSummaryComment(mainBooking, 'internal', { fallbackKeys: ['notes'] }),
        meta: {
            programId: cleanText(valueOf(mainBooking, 'programId', 'program_id'), 120),
            programCode: cleanText(valueOf(mainBooking, 'programCode', 'program_code'), 80),
            category: cleanText(valueOf(mainBooking, 'category'), 80),
            room: cleanText(valueOf(mainBooking, 'room'), 120)
        }
    };
}

function shouldIncludeProgramOrderRow(primaryBooking = {}, programBasePrice, menuRows = []) {
    const extra = extraDataOf(primaryBooking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const scenario = cleanText(valueOf(workspace, 'scenario'), 80);
    const hasEvent = valueOf(workspace, 'hasEvent', 'has_event');
    const normalizedScenario = String(scenario || '').trim().toLowerCase();
    const normalizedHasEvent = typeof hasEvent === 'string' ? hasEvent.trim().toLowerCase() : hasEvent;
    const programId = cleanText(valueOf(primaryBooking, 'programId', 'program_id'), 120);
    const programCode = cleanText(valueOf(primaryBooking, 'programCode', 'program_code'), 80);
    const normalizedProgramCode = String(programCode || '').trim().toUpperCase();
    const kitchenIdentityOnly = normalizedScenario === 'kitchen_only'
        || normalizedHasEvent === false
        || normalizedHasEvent === 'false'
        || normalizedHasEvent === 0
        || normalizedHasEvent === '0';

    if (
        kitchenIdentityOnly
        && money(programBasePrice) === 0
        && !programId
        && (!programCode || normalizedProgramCode === 'KITCHEN')
        && Array.isArray(menuRows)
        && menuRows.length
    ) {
        return false;
    }

    return true;
}

function buildLinkedActivityRows(linkedBookings = [], options = {}) {
    const source = options.source || 'linked_booking';
    return (Array.isArray(linkedBookings) ? linkedBookings : [])
        .filter(isRootBooking)
        .filter(isActiveBooking)
        .map((booking, index) => {
            const title = bookingTitle(booking);
            const subtotal = money(valueOf(booking, 'price'));
            if (!title && subtotal === null) return null;
            return {
                id: `activity:${bookingIdOf(booking) || index + 1}`,
                type: 'activity',
                source,
                bookingId: bookingIdOf(booking),
                title: title || `Додаткова активність ${index + 1}`,
                quantity: 1,
                unitPrice: subtotal,
                subtotal,
                comment: bookingSummaryComment(booking, 'activity', { fallbackKeys: ['notes', 'label'] }),
                meta: {
                    relationType: cleanText(booking._banquetLink?.relation_type || booking._banquetLink?.relationType, 80) || 'banquet_activity',
                    relationLabel: cleanText(booking._banquetLink?.label, 200),
                    banquetGroupId: cleanText(booking._banquetGroupId, 100),
                    banquetRole: cleanText(booking._banquetRole, 80),
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
        comment: cleanText(item.servingNote || item.note, 500),
        meta: {
            productId: item.productId || null,
            code: item.code || null,
            menuSection: item.menuSection || null,
            servingUnit: item.servingUnit || null,
            servingTime: item.servingTime || null,
            servingNote: item.servingNote || null,
            servingGroupId: item.servingGroupId || null,
            servingBatchId: item.servingBatchId || null,
            kitchenType: item.kitchenType || null,
            weightValue: item.weightValue || null,
            cakeDecoration: item.cakeDecoration || null
        }
    }));
}

function buildServiceEventRows(serviceEvents = []) {
    return normalizeServiceEvents(serviceEvents).map((event, index) => ({
        id: `service-event:${event.id || index + 1}`,
        type: 'service_event',
        source: event.source || 'booking_package',
        bookingId: null,
        title: event.title,
        quantity: 1,
        unitPrice: null,
        subtotal: null,
        comment: cleanText(event.note, 500),
        meta: {
            eventType: event.type,
            time: event.time || null,
            durationMinutes: event.durationMinutes || null,
            relatedMenuPositionIds: event.relatedMenuPositionIds || [],
            status: event.status || 'planned'
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

function mergeSummaryComments(...comments) {
    const unique = [];
    const seen = new Set();
    for (const comment of comments) {
        const clean = cleanText(comment, 500);
        const key = clean ? clean.toLowerCase() : null;
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        unique.push(clean);
    }
    return cleanText(unique.join(' · '), 500);
}

function uniqueSummaryCommentSources(entries = []) {
    const result = [];
    const seen = new Set();
    for (const entry of entries) {
        const booking = entry?.booking;
        if (!booking) continue;
        const id = bookingIdOf(booking);
        const key = id || `${entry.role || 'manual'}:${result.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
            booking,
            role: cleanText(entry.role, 40) || 'manual'
        });
    }
    return result;
}

function buildSummaryComments({ primaryBooking, kitchenBooking, activityBookings = [], serviceBookings = [], manualBookings = [] } = {}) {
    const comments = [];
    const seenTexts = new Set();
    const sources = uniqueSummaryCommentSources([
        { booking: kitchenBooking, role: 'kitchen' },
        ...(activityBookings || []).map(booking => ({ booking, role: 'activity' })),
        { booking: primaryBooking, role: 'primary' },
        ...(serviceBookings || []).map(booking => ({ booking, role: 'service' })),
        ...(manualBookings || []).map(booking => ({ booking, role: 'manual' }))
    ]);
    const add = (type, label, text, booking) => {
        const clean = cleanText(text, 500);
        const key = clean ? clean.toLowerCase() : null;
        if (!clean || seenTexts.has(key)) return;
        seenTexts.add(key);
        comments.push({
            type,
            label,
            text: clean,
            bookingId: bookingIdOf(booking)
        });
    };

    sources.forEach(({ booking, role }) => {
        const text = role === 'kitchen'
            ? bookingSummaryComment(booking, 'kitchen', { fallbackKeys: ['notes'] })
            : bookingWorkspaceComment(booking, 'kitchen');
        add('kitchen', 'Кухня', text, booking);
    });

    sources.forEach(({ booking, role }) => {
        const text = role === 'activity'
            ? bookingSummaryComment(booking, 'activity', { fallbackKeys: ['notes'] })
            : bookingWorkspaceComment(booking, 'activity');
        add('activity', `Активність — ${bookingTitle(booking) || 'Активність'}`, text, booking);
    });

    sources.forEach(({ booking, role }) => {
        const fallbackKeys = role === 'kitchen' || role === 'activity' ? [] : ['notes'];
        const text = bookingSummaryComment(booking, 'internal', { fallbackKeys });
        add('internal', 'Внутрішній коментар', text, booking);
    });

    return comments;
}

function applyKitchenCommentToMenuRows(menuRows = [], kitchenBooking = {}) {
    const kitchenComment = bookingSummaryComment(kitchenBooking, 'kitchen', { fallbackKeys: ['notes'] });
    if (!kitchenComment || !Array.isArray(menuRows) || !menuRows.length) return menuRows;
    return menuRows.map((row, index) => {
        if (index !== 0) return row;
        return {
            ...row,
            comment: mergeSummaryComments(kitchenComment, row.comment)
        };
    });
}

function sumKnown(rows = []) {
    const values = rows.map(row => money(row.subtotal)).filter(value => value !== null);
    if (!values.length) return null;
    return money(values.reduce((sum, value) => sum + value, 0));
}

function addMoney(...values) {
    const known = values.map(money).filter(value => value !== null);
    if (!known.length) return null;
    return money(known.reduce((sum, value) => sum + value, 0));
}

function firstNonNull(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
}

function normalizeResolvedGroup(resolvedGroup = null, fallbackMainBooking = {}, fallbackLinkedBookings = []) {
    if (!resolvedGroup || typeof resolvedGroup !== 'object') {
        return {
            source: 'current_booking',
            group: null,
            groupId: null,
            warnings: [],
            primaryBooking: fallbackMainBooking,
            kitchenBooking: fallbackMainBooking,
            activityBookings: (Array.isArray(fallbackLinkedBookings) ? fallbackLinkedBookings : []).filter(isRootBooking),
            serviceBookings: [],
            manualBookings: []
        };
    }

    const members = Array.isArray(resolvedGroup.members) ? resolvedGroup.members : [];
    const primaryMember = members.find(member => member.isPrimary)
        || members.find(member => bookingIdOf(member.booking) === bookingIdOf(resolvedGroup.bookings?.primary))
        || null;
    const kitchenMember = members.find(member => member.role === 'kitchen' || member.isKitchenCandidate)
        || null;
    const primaryBooking = primaryMember?.booking || resolvedGroup.bookings?.primary || fallbackMainBooking;
    const kitchenBooking = kitchenMember?.booking
        || (Array.isArray(resolvedGroup.bookings?.kitchen) ? resolvedGroup.bookings.kitchen[0] : null)
        || primaryBooking;
    const activityBookings = members
        .filter(member => member.role === 'activity')
        .map(member => member.booking)
        .filter(isRootBooking)
        .filter(isActiveBooking);
    const serviceBookings = members
        .filter(member => member.role === 'service')
        .map(member => member.booking)
        .filter(isRootBooking)
        .filter(isActiveBooking);
    const manualBookings = members
        .filter(member => member.role === 'manual')
        .map(member => member.booking)
        .filter(isRootBooking)
        .filter(isActiveBooking);

    return {
        source: resolvedGroup.source || (resolvedGroup.groupId ? 'banquet_group' : 'legacy_booking_banquet_links'),
        group: resolvedGroup.group || null,
        groupId: resolvedGroup.groupId || resolvedGroup.group?.id || null,
        warnings: Array.isArray(resolvedGroup.warnings) ? resolvedGroup.warnings : [],
        primaryBooking,
        kitchenBooking,
        activityBookings,
        serviceBookings,
        manualBookings
    };
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

function normalizeResolvedTerms(defaults = null) {
    if (!defaults) return { title: 'Умови банкету', items: [], missingCodes: [] };
    const source = Array.isArray(defaults) ? { items: defaults } : defaults;
    const items = Array.isArray(source.items)
        ? source.items.map(item => cleanText(item, 800)).filter(Boolean)
        : [];
    const missingCodes = Array.isArray(source.missingCodes)
        ? source.missingCodes.map(code => cleanText(code, 120)).filter(Boolean)
        : [];
    return {
        title: cleanText(source.title, 120) || 'Умови банкету',
        items,
        missingCodes
    };
}

function termsOf(mainBooking = {}, warnings, options = {}) {
    const extra = extraDataOf(mainBooking);
    const rawTerms = extra.banquetTerms || extra.banquet_terms || extra.terms || [];
    const items = Array.isArray(rawTerms)
        ? rawTerms.map(item => cleanText(item, 800)).filter(Boolean)
        : cleanText(rawTerms, 3000)
            ? cleanText(rawTerms, 3000).split(/\r?\n/).map(item => cleanText(item, 800)).filter(Boolean)
            : [];
    if (items.length) {
        return {
            title: 'Умови банкету',
            items
        };
    }

    const defaults = normalizeResolvedTerms(options.defaults || options.banquetTermsDefaults);
    if (defaults.missingCodes.length) {
        warnings.push({
            code: 'banquet_terms_price_rule_missing',
            message: `Не знайдено price_rules для стандартних умов банкету: ${defaults.missingCodes.join(', ')}.`
        });
    }

    if (defaults.items.length) {
        return {
            title: defaults.title,
            items: defaults.items
        };
    }

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

function buildBanquetSummary({ mainBooking, customer = null, linkedBookings = [], businessContext, generatedBy = null, resolvedGroup = null, banquetTermsDefaults = null } = {}) {
    if (!mainBooking || typeof mainBooking !== 'object') {
        throw new Error('mainBooking is required');
    }

    const warnings = [];
    const groupState = normalizeResolvedGroup(resolvedGroup, mainBooking, linkedBookings);
    for (const warning of groupState.warnings) {
        if (!warning?.code && !warning?.message) continue;
        warnings.push({
            code: cleanText(warning.code, 120) || 'banquet_group_warning',
            message: cleanText(warning.message, 1000) || cleanText(warning.code, 120) || 'Banquet group warning'
        });
    }
    const primaryBooking = groupState.primaryBooking || mainBooking;
    const kitchenBooking = groupState.kitchenBooking || primaryBooking;
    const context = normalizeBusinessContext(
        businessContext
        || valueOf(primaryBooking, 'businessContext', 'business_context')
        || valueOf(kitchenBooking, 'businessContext', 'business_context')
        || DEFAULT_BUSINESS_CONTEXT
    );
    const primaryPackage = bookingPackageOf(primaryBooking) || {};
    const kitchenPackage = bookingPackageOf(kitchenBooking) || {};
    const samePrimaryAndKitchen = sameBooking(primaryBooking, kitchenBooking);
    const bookingPackage = kitchenPackage || {};
    const menuPositions = normalizeMenuPositions(bookingPackage.menuPositions || bookingPackage.menu_positions || []);
    const rawMenuRows = menuPositions.length ? buildMenuRows(menuPositions) : buildLegacyBanquetMenuRows(kitchenBooking);
    const menuRows = applyKitchenCommentToMenuRows(rawMenuRows, kitchenBooking);
    const serviceEventRows = buildServiceEventRows(bookingPackage.serviceEvents || bookingPackage.service_events || []);
    if (!menuPositions.length && menuRows.length) {
        warnings.push({
            code: 'legacy_banquet_menu_used',
            message: 'Меню взято з legacy поля banquet_menu, бо structured menuPositions порожні.'
        });
    }
    const missingServingTimeCount = menuPositions.filter(item => !item.servingTime).length;
    if (missingServingTimeCount > 0) {
        warnings.push({
            code: 'serving_time_missing',
            message: `Не вказано час видачі для ${missingServingTimeCount} позицій меню.`
        });
    }

    const bookingPrice = money(valueOf(primaryBooking, 'price'));
    const menuSubtotal = money(valueOf(bookingPackage, 'positionsSubtotal', 'positions_subtotal')) ?? sumKnown(menuRows);
    const explicitProgramBasePrice = money(valueOf(primaryPackage, 'programBasePrice', 'program_base_price'));
    const inferredProgramBasePrice = samePrimaryAndKitchen && bookingPrice !== null && menuSubtotal !== null
        ? money(Math.max(0, bookingPrice - menuSubtotal))
        : bookingPrice;
    const programBasePrice = explicitProgramBasePrice ?? inferredProgramBasePrice;
    const programRow = shouldIncludeProgramOrderRow(primaryBooking, programBasePrice, menuRows)
        ? buildProgramRow(primaryBooking, programBasePrice)
        : null;
    const activityRows = buildLinkedActivityRows(groupState.activityBookings, { source: groupState.groupId ? 'banquet_group' : 'linked_booking' });
    const summaryComments = buildSummaryComments({
        primaryBooking,
        kitchenBooking,
        activityBookings: groupState.activityBookings,
        serviceBookings: groupState.serviceBookings,
        manualBookings: groupState.manualBookings
    });
    const activitySubtotal = sumKnown(activityRows);
    const orderRows = [programRow, ...activityRows, ...menuRows, ...serviceEventRows].filter(Boolean);
    const rowsTotal = sumKnown(orderRows);
    const packageTotal = samePrimaryAndKitchen ? money(valueOf(bookingPackage, 'finalTotal', 'final_total')) : null;
    const computedTotal = addMoney(programBasePrice, activitySubtotal, menuSubtotal);
    const orderTotal = rowsTotal ?? computedTotal ?? packageTotal ?? bookingPrice;
    const deposit = explicitDepositOf(primaryBooking);
    const paidAmount = money(valueOf(primaryBooking, 'paidAmount', 'paid_amount'));
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

    const explicitChildrenCount = firstNonNull(
        valueOf(primaryBooking, 'kidsCount', 'kids_count'),
        valueOf(kitchenBooking, 'kidsCount', 'kids_count')
    );
    const legacyChildrenCount = firstNonNull(
        valueOf(kitchenBooking, 'banquetGuests', 'banquet_guests'),
        valueOf(primaryBooking, 'banquetGuests', 'banquet_guests')
    );

    return {
        success: true,
        schemaVersion: BANQUET_SUMMARY_SCHEMA_VERSION,
        bookingId: bookingIdOf(primaryBooking),
        businessContext: context,
        group: groupState.group ? {
            id: groupState.group.id || groupState.groupId || null,
            source: groupState.source,
            primaryBookingId: groupState.group.primaryBookingId || groupState.group.primary_booking_id || bookingIdOf(primaryBooking),
            status: groupState.group.status || null,
            groupName: groupState.group.groupName || groupState.group.group_name || null
        } : null,
        document: {
            type: 'banquet_summary',
            title: 'БАНКЕТНИЙ ЛИСТ',
            generatedAt: new Date().toISOString(),
            generatedBy: cleanText(generatedBy?.name || generatedBy?.username || generatedBy, 160)
        },
        venue: venueForContext(context, warnings),
        event: {
            date: cleanText(valueOf(primaryBooking, 'date'), 40),
            time: cleanText(valueOf(primaryBooking, 'time'), 20),
            room: cleanText(valueOf(primaryBooking, 'room'), 120),
            programName: cleanText(valueOf(primaryBooking, 'programName', 'program_name'), 200),
            groupName: cleanText(
                valueOf(groupState.group || {}, 'groupName', 'group_name')
                || (!groupState.group ? valueOf(primaryBooking, 'groupName', 'group_name') : null),
                200
            ),
            createdAt: cleanText(valueOf(primaryBooking, 'createdAt', 'created_at'), 80),
            manager: cleanText(valueOf(primaryBooking, 'createdBy', 'created_by'), 160),
            status: cleanText(valueOf(primaryBooking, 'status'), 40)
        },
        customer: normalizeCustomer(customer || {}),
        celebrant: normalizeCelebrant(primaryBooking, customer || {}),
        counts: {
            children: nullableNumber(firstNonNull(explicitChildrenCount, legacyChildrenCount)),
            adults: nullableNumber(firstNonNull(valueOf(kitchenBooking, 'banquetAdults', 'banquet_adults'), valueOf(primaryBooking, 'banquetAdults', 'banquet_adults'))),
            guests: null,
            tables: nullableNumber(firstNonNull(valueOf(kitchenBooking, 'banquetTables', 'banquet_tables'), valueOf(primaryBooking, 'banquetTables', 'banquet_tables')))
        },
        orderRows,
        serviceEvents: serviceEventRows,
        comments: summaryComments,
        totals: {
            programBasePrice,
            menuSubtotal,
            activitySubtotal,
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
        terms: termsOf(primaryBooking, warnings, { banquetTermsDefaults }),
        warnings
    };
}

module.exports = {
    BANQUET_SUMMARY_SCHEMA_VERSION,
    buildBanquetSummary
};
