'use strict';

const { normalizeMenuPositions, normalizeServiceEvents, menuPositionsSubtotal } = require('./bookingPackage');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextCatalog,
    normalizeBusinessContext
} = require('./businessContext');

const BANQUET_SUMMARY_SCHEMA_VERSION = 1;
const CURRENCY = 'UAH';
const BANQUET_SUMMARY_MODES = Object.freeze(['client', 'kitchen', 'staff']);
const BANQUET_SUMMARY_VALID_MODES = new Set(BANQUET_SUMMARY_MODES);
const BANQUET_SUMMARY_MODE_LABELS = Object.freeze({
    client: 'Для клієнта',
    kitchen: 'Для кухні',
    staff: 'Для персоналу'
});
const BANQUET_SUMMARY_MODE_CONTRACTS = Object.freeze({
    client: Object.freeze({
        mode: 'client',
        label: BANQUET_SUMMARY_MODE_LABELS.client,
        sections: Object.freeze({
            header: true,
            brief: true,
            orderRows: true,
            schedule: true,
            finance: true,
            terms: true,
            comments: false,
            warnings: false,
            responsible: true
        }),
        orderRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu']),
        scheduleSourceRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu', 'service_event']),
        commentTypes: Object.freeze([]),
        responsibleDetail: 'manager',
        scheduleDetail: 'client',
        showPrices: true,
        showInternalFields: false,
        showEmptyResponsible: false,
        exportBlocking: 'strict'
    }),
    kitchen: Object.freeze({
        mode: 'kitchen',
        label: BANQUET_SUMMARY_MODE_LABELS.kitchen,
        sections: Object.freeze({
            header: true,
            brief: true,
            orderRows: true,
            schedule: true,
            finance: false,
            terms: false,
            comments: true,
            warnings: false,
            responsible: true
        }),
        orderRowTypes: Object.freeze(['menu']),
        scheduleSourceRowTypes: Object.freeze(['menu', 'service_event']),
        commentTypes: Object.freeze(['kitchen']),
        responsibleDetail: 'kitchen',
        scheduleDetail: 'kitchen',
        showPrices: false,
        showInternalFields: false,
        showEmptyResponsible: true,
        exportBlocking: 'kitchen'
    }),
    staff: Object.freeze({
        mode: 'staff',
        label: BANQUET_SUMMARY_MODE_LABELS.staff,
        sections: Object.freeze({
            header: true,
            brief: true,
            orderRows: true,
            schedule: true,
            finance: true,
            terms: true,
            comments: true,
            warnings: true,
            responsible: true
        }),
        orderRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu']),
        scheduleSourceRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu', 'service_event']),
        commentTypes: Object.freeze(['activity', 'kitchen', 'internal']),
        responsibleDetail: 'full',
        scheduleDetail: 'staff',
        showPrices: true,
        showInternalFields: true,
        showEmptyResponsible: true,
        exportBlocking: 'warnings_only'
    })
});

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

function normalizeBanquetSummaryMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return BANQUET_SUMMARY_VALID_MODES.has(normalized) ? normalized : 'client';
}

function cloneBanquetSummaryModeContract(contract) {
    return {
        ...contract,
        sections: { ...contract.sections },
        orderRowTypes: [...contract.orderRowTypes],
        scheduleSourceRowTypes: [...contract.scheduleSourceRowTypes],
        commentTypes: [...contract.commentTypes]
    };
}

function banquetSummaryModeContract(mode = 'client') {
    const normalized = normalizeBanquetSummaryMode(mode);
    return cloneBanquetSummaryModeContract(BANQUET_SUMMARY_MODE_CONTRACTS[normalized]);
}

function banquetSummaryModeRowTypes(mode = 'client') {
    return new Set(banquetSummaryModeContract(mode).orderRowTypes);
}

function banquetSummaryModeAllowsComment(mode = 'client', type = '') {
    const contract = banquetSummaryModeContract(mode);
    return Boolean(contract.sections.comments && contract.commentTypes.includes(String(type || '').trim().toLowerCase()));
}

function quantity(value, fallback = 1) {
    const n = nullableNumber(value);
    if (n === null || n <= 0) return fallback;
    return Math.round(n * 100) / 100;
}

function durationMinutesOfBooking(booking = {}) {
    const n = nullableNumber(valueOf(booking, 'durationMinutes', 'duration_minutes', 'duration'));
    if (n === null || n <= 0) return null;
    return Math.round(n);
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

function dateOnly(value) {
    if (!value) return null;
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function normalizeCustomerChild(child = {}) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return null;
    const name = cleanText(valueOf(child, 'name', 'childName', 'child_name'), 200);
    const birthday = dateOnly(valueOf(child, 'birthday', 'birthDate', 'birth_date', 'childBirthday', 'child_birthday'));
    const ageSnapshot = nullableNumber(valueOf(child, 'ageSnapshot', 'age_snapshot', 'age', 'childAge', 'child_age'));
    const note = cleanText(valueOf(child, 'note', 'notes'), 500);
    if (!name && !birthday && ageSnapshot === null && !note) return null;
    return { name, birthday, ageSnapshot, note };
}

function normalizeCustomerChildren(customer = {}) {
    const canonical = Array.isArray(customer.children)
        ? customer.children.map(normalizeCustomerChild).filter(Boolean)
        : [];
    if (canonical.length) return canonical;

    const legacy = normalizeCustomerChild({
        name: valueOf(customer, 'childName', 'child_name'),
        birthday: valueOf(customer, 'childBirthday', 'child_birthday')
    });
    return legacy ? [legacy] : [];
}

function customerChildLine(child = {}) {
    if (child.name && child.birthday) return `${child.name} (${child.birthday})`;
    return child.name || child.birthday || null;
}

function customerChildrenFullDisplay(children = []) {
    const lines = (Array.isArray(children) ? children : []).map(customerChildLine).filter(Boolean);
    return lines.length ? lines.join(', ') : null;
}

function customerChildrenBirthdayDisplay(children = []) {
    const birthdays = (Array.isArray(children) ? children : []).map(child => child.birthday).filter(Boolean);
    return birthdays.length ? birthdays.join(', ') : null;
}

function normalizeCustomer(customer = {}) {
    const children = normalizeCustomerChildren(customer);
    const primary = children[0] || {};
    return {
        id: valueOf(customer, 'id'),
        name: cleanText(valueOf(customer, 'name', 'customerName', 'customer_name'), 200),
        phone: cleanText(valueOf(customer, 'phone', 'customerPhone', 'customer_phone'), 80),
        instagram: cleanText(valueOf(customer, 'instagram'), 120),
        source: cleanText(valueOf(customer, 'source'), 120),
        notes: cleanText(valueOf(customer, 'notes'), 1000),
        childName: primary.name || cleanText(valueOf(customer, 'childName', 'child_name'), 200),
        childBirthday: primary.birthday || dateOnly(valueOf(customer, 'childBirthday', 'child_birthday')),
        childNameDisplay: children.map(child => child.name).filter(Boolean).join(', ') || null,
        childBirthdayDisplay: customerChildrenBirthdayDisplay(children),
        childrenDisplay: customerChildrenFullDisplay(children),
        children
    };
}

function primaryCustomerChild(customer = {}) {
    const children = Array.isArray(customer.children) ? customer.children : [];
    return children.find(child => child && (
        valueOf(child, 'name', 'childName', 'child_name')
        || valueOf(child, 'birthday', 'birthDate', 'childBirthday', 'child_birthday')
    )) || {};
}

function normalizeCelebrant(mainBooking = {}, customer = {}) {
    const extra = extraDataOf(mainBooking);
    const celebrant = extra.celebrant || extra.child || {};
    const customerChild = primaryCustomerChild(customer);
    return {
        name: cleanText(
            valueOf(celebrant, 'name')
            || valueOf(customerChild, 'name', 'childName', 'child_name')
            || valueOf(customer, 'childName', 'child_name')
            || valueOf(mainBooking, 'childName', 'child_name'),
            200
        ),
        birthday: cleanText(
            valueOf(celebrant, 'birthday', 'birthDate')
            || valueOf(customerChild, 'birthday', 'birthDate', 'childBirthday', 'child_birthday')
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
        durationMinutes: durationMinutesOfBooking(mainBooking),
        quantity: null,
        unitPrice: programBasePrice,
        subtotal: programBasePrice,
        comment: bookingSummaryComment(mainBooking, 'activity', { fallbackKeys: ['notes'] }),
        meta: {
            programId: cleanText(valueOf(mainBooking, 'programId', 'program_id'), 120),
            programCode: cleanText(valueOf(mainBooking, 'programCode', 'program_code'), 80),
            category: cleanText(valueOf(mainBooking, 'category'), 80),
            room: cleanText(valueOf(mainBooking, 'room'), 120),
            time: cleanText(valueOf(mainBooking, 'time'), 20),
            duration: durationMinutesOfBooking(mainBooking)
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

function isRealBanquetProgram(booking = {}) {
    const workspace = bookingWorkspaceOf(booking);
    const scenario = cleanText(valueOf(workspace, 'scenario'), 80);
    const hasEvent = valueOf(workspace, 'hasEvent', 'has_event');
    const normalizedScenario = String(scenario || '').trim().toLowerCase();
    const normalizedHasEvent = typeof hasEvent === 'string' ? hasEvent.trim().toLowerCase() : hasEvent;
    const programId = cleanText(valueOf(booking, 'programId', 'program_id'), 120);
    const programCode = cleanText(valueOf(booking, 'programCode', 'program_code'), 80);
    const normalizedProgramCode = String(programCode || '').trim().toUpperCase();
    const category = cleanText(valueOf(booking, 'category'), 80);
    const normalizedCategory = String(category || '').trim().toLowerCase();

    if (
        normalizedScenario === 'kitchen_only'
        || normalizedScenario === 'lead_only'
        || normalizedHasEvent === false
        || normalizedHasEvent === 'false'
        || normalizedHasEvent === 0
        || normalizedHasEvent === '0'
        || normalizedProgramCode === 'KITCHEN'
        || normalizedProgramCode === 'LEAD'
    ) {
        return false;
    }

    if (programId) return true;
    if (programCode) return true;

    return Boolean(normalizedCategory && !['custom', 'kitchen', 'lead', 'food', 'menu'].includes(normalizedCategory));
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
                durationMinutes: durationMinutesOfBooking(booking),
                quantity: null,
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

function normalizeScheduleTime(value) {
    const text = cleanText(value, 20);
    if (!text) return null;
    const match = text.match(/^(\d{1,2}):([0-5]\d)/);
    if (!match) return null;
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function scheduleSortValue(item = {}) {
    const match = String(item.time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 99999;
    return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeScheduleModes(value, fallback = ['client', 'kitchen', 'staff']) {
    const source = Array.isArray(value) ? value : fallback;
    const allowed = new Set(['client', 'kitchen', 'staff']);
    const modes = source.map(item => cleanText(item, 20)).filter(item => allowed.has(item));
    return modes.length ? [...new Set(modes)] : [...fallback];
}

function pushScheduleWarning(warnings, code, message, extra = {}) {
    if (!Array.isArray(warnings)) return;
    const key = `${code}:${message}`;
    if (warnings.some(item => `${item?.code}:${item?.message}` === key)) return;
    warnings.push({
        code,
        message,
        ...extra
    });
}

function pushBanquetScheduleItem(items, seen, warnings, input = {}) {
    const title = cleanText(input.title, 200);
    const time = normalizeScheduleTime(input.time);
    if (!title) return;
    if (!time) {
        if (input.warnOnMissingTime !== false) {
            pushScheduleWarning(
                warnings,
                'schedule_time_missing',
                `Не вказано час для події розкладу: ${title}.`,
                { staffOnly: true, source: input.source || null }
            );
        }
        return;
    }
    const note = cleanText(input.note, 500);
    const modes = normalizeScheduleModes(input.modes);
    const noteModes = note ? normalizeScheduleModes(input.noteModes, modes) : [];
    const key = [
        time,
        cleanText(input.type, 60) || 'schedule',
        title,
        note || ''
    ].join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
        id: cleanText(input.id, 120) || `schedule:${items.length + 1}`,
        type: cleanText(input.type, 60) || 'schedule',
        source: cleanText(input.source, 120) || null,
        time,
        title,
        note,
        modes,
        noteModes,
        sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : items.length
    });
}

function serviceEventScheduleModes(row = {}) {
    const type = cleanText(row.meta?.eventType || row.eventType || row.type, 60);
    if (type === 'room_setup' || type === 'custom') return ['staff'];
    if (['cake', 'drinks', 'food_service'].includes(type)) return ['client', 'kitchen', 'staff'];
    return ['staff'];
}

function buildBanquetSchedule({ event = {}, orderRows = [], serviceEvents = [], warnings = [] } = {}) {
    const items = [];
    const seen = new Set();
    const rows = Array.isArray(orderRows) ? orderRows : [];
    const menuClientServingTimes = new Set();

    pushBanquetScheduleItem(items, seen, warnings, {
        id: 'schedule:arrival',
        type: 'arrival',
        source: 'event',
        time: event.time,
        title: 'Прихід гостей',
        note: event.room ? `Кімната: ${event.room}` : null,
        modes: ['client', 'staff'],
        noteModes: ['client', 'staff'],
        sortOrder: 0
    });

    rows.forEach((row, index) => {
        if (!row || row.type === 'entry') return;
        if (row.type === 'program' || row.type === 'activity') {
            pushBanquetScheduleItem(items, seen, warnings, {
                id: `schedule:${row.id || row.bookingId || index}`,
                type: row.type,
                source: row.source || row.type,
                time: row.meta?.time || event.time,
                title: row.title || 'Активність',
                note: row.comment || row.meta?.room || null,
                modes: ['client', 'staff'],
                noteModes: ['staff'],
                sortOrder: 20 + index
            });
            return;
        }
        if (row.type === 'menu') {
            const servingTime = row.meta?.servingTime || row.meta?.time;
            const normalizedTime = normalizeScheduleTime(servingTime);
            if (normalizedTime && !menuClientServingTimes.has(normalizedTime)) {
                menuClientServingTimes.add(normalizedTime);
                pushBanquetScheduleItem(items, seen, warnings, {
                    id: `schedule:menu:${normalizedTime}`,
                    type: 'menu_service',
                    source: 'menu_positions',
                    time: normalizedTime,
                    title: 'Видача меню',
                    modes: ['client'],
                    sortOrder: 40 + index
                });
            }
            pushBanquetScheduleItem(items, seen, warnings, {
                id: `schedule:${row.id || index}`,
                type: 'menu',
                source: row.source || 'menu_position',
                time: servingTime,
                title: `Видача: ${row.title || 'Меню'}`,
                note: row.comment || null,
                modes: ['kitchen', 'staff'],
                noteModes: ['kitchen', 'staff'],
                sortOrder: 45 + index,
                warnOnMissingTime: false
            });
        }
    });

    (Array.isArray(serviceEvents) ? serviceEvents : []).forEach((row, index) => {
        pushBanquetScheduleItem(items, seen, warnings, {
            id: `schedule:${row.id || index}`,
            type: row.meta?.eventType || 'service_event',
            source: row.source || 'service_event',
            time: row.meta?.time || row.meta?.servingTime,
            title: row.title || 'Подія',
            note: row.comment || null,
            modes: serviceEventScheduleModes(row),
            noteModes: ['kitchen', 'staff'],
            sortOrder: 60 + index
        });
    });

    return items.sort((a, b) => {
        const timeDiff = scheduleSortValue(a) - scheduleSortValue(b);
        if (timeDiff !== 0) return timeDiff;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
}

function responsibleSourceOf(booking = {}) {
    const extra = extraDataOf(booking);
    const workspace = bookingWorkspaceOf(booking);
    const candidates = [
        workspace.responsiblePeople,
        workspace.responsible_people,
        workspace.responsible,
        workspace.staff,
        extra.responsiblePeople,
        extra.responsible_people,
        extra.responsible,
        extra.banquetResponsible,
        extra.banquet_responsible,
        extra.staff
    ];
    return candidates.find(item => item && typeof item === 'object' && !Array.isArray(item)) || {};
}

function responsibleValue(booking = {}, ...keys) {
    const extra = extraDataOf(booking);
    const workspace = bookingWorkspaceOf(booking);
    const responsible = responsibleSourceOf(booking);
    return cleanText(
        valueOf(booking, ...keys)
        || valueOf(workspace, ...keys)
        || valueOf(responsible, ...keys)
        || valueOf(extra, ...keys),
        160
    );
}

function actorName(value) {
    if (!value) return null;
    if (typeof value === 'object') {
        return cleanText(value.name || value.fullName || value.full_name || value.username || value.email, 160);
    }
    return cleanText(value, 160);
}

function lineDisplayName(booking = {}, options = {}) {
    const identity = booking.timelineIdentity || booking.timeline_identity || {};
    const known = cleanText(
        valueOf(booking, 'lineName', 'line_name', 'animatorName', 'animator_name', 'resourceName', 'resource_name')
        || valueOf(identity, 'lineName', 'line_name', 'resourceName', 'resource_name', 'name'),
        160
    );
    if (known) return known;
    const lineId = cleanText(valueOf(booking, 'lineId', 'line_id'), 120);
    if (!options.fallbackLineId || !lineId || lineId === 'banquet-service') return null;
    return lineId;
}

function pushResponsibleRow(rows, seen, row = {}) {
    const label = cleanText(row.label, 80);
    if (!label) return;
    const name = cleanText(row.name, 160);
    if (!name && row.showWhenEmpty !== true) return;
    const modes = Array.isArray(row.modes) && row.modes.length
        ? [...new Set(row.modes.map(mode => cleanText(mode, 20)).filter(Boolean))]
        : ['staff'];
    const key = `${row.role || label}:${name || ''}:${modes.join(',')}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
        role: cleanText(row.role, 80) || label.toLowerCase(),
        label,
        name,
        source: cleanText(row.source, 120),
        modes,
        showWhenEmpty: row.showWhenEmpty === true
    });
}

function buildResponsiblePeople({ primaryBooking, kitchenBooking, activityBookings = [], serviceBookings = [], manualBookings = [], generatedBy = null, hasRealProgram = false } = {}) {
    const rows = [];
    const seen = new Set();
    const manager = responsibleValue(primaryBooking, 'managerName', 'manager_name', 'manager', 'createdBy', 'created_by')
        || actorName(generatedBy);
    pushResponsibleRow(rows, seen, {
        role: 'manager',
        label: 'Менеджер',
        name: manager,
        source: 'booking_created_by',
        modes: ['client', 'kitchen', 'staff'],
        showWhenEmpty: true
    });

    const activitySources = [primaryBooking, ...(Array.isArray(activityBookings) ? activityBookings : [])]
        .filter(Boolean)
        .filter(booking => isRealBanquetProgram(booking));
    const animatorNames = new Set();
    activitySources.forEach((booking, index) => {
        const animatorName = responsibleValue(booking, 'animatorName', 'animator_name', 'hostName', 'host_name', 'host')
            || lineDisplayName(booking, { fallbackLineId: true });
        const animatorKey = animatorName ? animatorName.toLowerCase() : '';
        if (!animatorKey || !animatorNames.has(animatorKey)) {
            if (animatorKey) animatorNames.add(animatorKey);
            pushResponsibleRow(rows, seen, {
                role: index === 0 ? 'animator' : 'activity_animator',
                label: index === 0 ? 'Аніматор' : 'Аніматор активності',
                name: animatorName,
                source: 'booking_line',
                modes: ['staff'],
                showWhenEmpty: hasRealProgram && index === 0
            });
        }

        const secondAnimator = responsibleValue(booking, 'secondAnimatorName', 'second_animator_name', 'secondAnimator', 'second_animator', 'secondHost', 'second_host');
        pushResponsibleRow(rows, seen, {
            role: 'second_animator',
            label: 'Другий аніматор',
            name: secondAnimator,
            source: 'booking_second_animator',
            modes: ['staff'],
            showWhenEmpty: false
        });
    });

    const allOperationalBookings = [kitchenBooking, primaryBooking, ...activityBookings, ...serviceBookings, ...manualBookings].filter(Boolean);
    const firstResponsible = (...keys) => {
        for (const booking of allOperationalBookings) {
            const value = responsibleValue(booking, ...keys);
            if (value) return value;
        }
        return null;
    };

    pushResponsibleRow(rows, seen, {
        role: 'kitchen',
        label: 'Кухня',
        name: firstResponsible('kitchenResponsible', 'kitchen_responsible', 'kitchenManager', 'kitchen_manager', 'chef', 'cook'),
        source: 'booking_workspace',
        modes: ['kitchen', 'staff'],
        showWhenEmpty: true
    });
    pushResponsibleRow(rows, seen, {
        role: 'waiter',
        label: 'Офіціант',
        name: firstResponsible('waiterResponsible', 'waiter_responsible', 'waiter', 'serviceResponsible', 'service_responsible'),
        source: 'booking_workspace',
        modes: ['staff'],
        showWhenEmpty: true
    });
    pushResponsibleRow(rows, seen, {
        role: 'room',
        label: 'Кімната',
        name: firstResponsible('roomResponsible', 'room_responsible', 'roomHost', 'room_host', 'roomManager', 'room_manager'),
        source: 'booking_workspace',
        modes: ['staff'],
        showWhenEmpty: true
    });

    return {
        rows,
        source: 'bookings_and_workspace',
        hasKnownPeople: rows.some(row => Boolean(row.name))
    };
}

function buildEntryChargeRow(bookingPackage = {}, warnings = []) {
    const entry = bookingPackage.entryCharge || bookingPackage.entry_charge || null;
    const fallbackSubtotal = money(valueOf(bookingPackage, 'entrySubtotal', 'entry_subtotal'));
    const fallbackRow = () => {
        if (fallbackSubtotal === null || fallbackSubtotal <= 0) return null;
        if (Array.isArray(warnings)) {
            warnings.push({
                code: 'entry_charge_snapshot_missing',
                message: 'У пакеті є сума входу, але немає деталізації entryCharge. Рядок входу показано без кількості та ціни.'
            });
        }
        return {
            id: 'entry:banquet_entry_snapshot',
            type: 'entry',
            source: 'booking_package_entry_subtotal_fallback',
            bookingId: null,
            title: 'Вхід',
            quantity: null,
            unitPrice: null,
            subtotal: fallbackSubtotal,
            comment: 'Деталі входу не збережені у пакеті.',
            meta: {
                ruleCode: null,
                dateType: null,
                fallback: true
            }
        };
    };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fallbackRow();
    const subtotal = money(valueOf(entry, 'subtotal'));
    if (subtotal === null) return fallbackRow();
    return {
        id: `entry:${cleanText(valueOf(entry, 'ruleCode', 'rule_code'), 120) || 'banquet_entry'}`,
        type: 'entry',
        source: cleanText(valueOf(entry, 'source'), 120) || 'banquet_entry_price_rules',
        bookingId: null,
        title: cleanText(valueOf(entry, 'title'), 160) || 'Вхід',
        quantity: quantity(valueOf(entry, 'quantity'), null),
        unitPrice: money(valueOf(entry, 'unitPrice', 'unit_price')),
        subtotal,
        comment: null,
        meta: {
            ruleCode: cleanText(valueOf(entry, 'ruleCode', 'rule_code'), 120),
            dateType: cleanText(valueOf(entry, 'dateType', 'date_type'), 40)
        }
    };
}

function pushPackageWarnings(warnings, bookingPackage = {}) {
    const packageWarnings = Array.isArray(bookingPackage.warnings) ? bookingPackage.warnings : [];
    for (const warning of packageWarnings) {
        const code = cleanText(warning?.code, 120);
        const message = cleanText(warning?.message, 1000);
        if (!code && !message) continue;
        const normalized = {
            code: code || 'booking_package_warning',
            message: message || code
        };
        if (Array.isArray(warning?.missingCodes)) {
            normalized.missingCodes = warning.missingCodes.map(item => cleanText(item, 120)).filter(Boolean);
        }
        warnings.push(normalized);
    }
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

function summaryCommentKey(value) {
    const clean = cleanText(value, 500);
    return clean ? clean.toLowerCase() : null;
}

function addInlineCommentKey(keys, value) {
    const clean = cleanText(value, 500);
    const key = summaryCommentKey(clean);
    if (!key) return;
    keys.add(key);
    clean.split(/\s+·\s+/).forEach(part => {
        const partKey = summaryCommentKey(part);
        if (partKey) keys.add(partKey);
    });
}

function inlineCommentKeysFromRows(rows = []) {
    const keys = new Set();
    (Array.isArray(rows) ? rows : []).forEach(row => addInlineCommentKey(keys, row?.comment));
    return keys;
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

function buildSummaryComments({ primaryBooking, kitchenBooking, activityBookings = [], serviceBookings = [], manualBookings = [], inlineCommentKeys = null } = {}) {
    const comments = [];
    const seenTexts = new Set();
    const inlineKeys = inlineCommentKeys instanceof Set ? inlineCommentKeys : new Set();
    const sources = uniqueSummaryCommentSources([
        { booking: kitchenBooking, role: 'kitchen' },
        ...(activityBookings || []).map(booking => ({ booking, role: 'activity' })),
        { booking: primaryBooking, role: 'primary' },
        ...(serviceBookings || []).map(booking => ({ booking, role: 'service' })),
        ...(manualBookings || []).map(booking => ({ booking, role: 'manual' }))
    ]);
    const add = (type, label, text, booking) => {
        const clean = cleanText(text, 500);
        const key = summaryCommentKey(clean);
        if (!clean || seenTexts.has(key) || inlineKeys.has(key)) return;
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
        add('activity', 'Коментар до активності', text, booking);
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

function subtractMoney(total, amount) {
    const totalMoney = money(total);
    if (totalMoney === null) return null;
    return money(Math.max(0, totalMoney - (money(amount) || 0)));
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

function canonicalDepositProjectionOf(projection = null) {
    if (!projection || typeof projection !== 'object' || projection.success === false) {
        return { found: false };
    }
    const deposit = projection.deposit && typeof projection.deposit === 'object' ? projection.deposit : null;
    const status = cleanText(projection.status || projection.state || deposit?.status, 80);
    const isMissing = !deposit && (!status || status === 'missing');
    if (isMissing) return { found: false };
    const display = projection.display && typeof projection.display === 'object' ? projection.display : {};
    const sourcePayload = deposit?.sourcePayload && typeof deposit.sourcePayload === 'object' ? deposit.sourcePayload : {};
    const meta = deposit?.meta && typeof deposit.meta === 'object' ? deposit.meta : {};
    const confirmation = sourcePayload.accountantConfirmation || meta.accountantConfirmation || {};
    const receivedDate = cleanText(
        confirmation.receivedDate
        || (deposit?.verifiedAt ? String(deposit.verifiedAt).slice(0, 10) : null),
        40
    );
    return {
        found: true,
        amount: money(deposit?.amount ?? display.amount),
        paymentMethod: cleanText(deposit?.paymentMethod || display.paymentMethod, 80),
        paymentStatus: status || null,
        status: status || null,
        note: cleanText(confirmation.note || deposit?.meta?.note, 500),
        source: 'canonical_banquet_deposits',
        sourceKind: cleanText(deposit?.sourceKind, 120),
        id: deposit?.id || null,
        receivedDate,
        verifiedAt: cleanText(deposit?.verifiedAt, 80),
        accountantTaskId: deposit?.accountantTaskId || null
    };
}

function summaryDepositOf(mainBooking = {}, canonicalDepositProjection = null) {
    const canonical = canonicalDepositProjectionOf(canonicalDepositProjection);
    if (canonical.found) return canonical;
    return {
        ...explicitDepositOf(mainBooking),
        status: null,
        sourceKind: null,
        id: null,
        receivedDate: null,
        verifiedAt: null,
        accountantTaskId: null
    };
}

function buildFinanceRows({ programBasePrice, entrySubtotal, menuSubtotal, activitySubtotal, orderTotal, bookingPrice, deposit } = {}) {
    const rows = [];
    const currency = CURRENCY;
    const add = (key, label, amount, options = {}) => {
        const value = money(amount);
        if (value === null) return;
        if (options.hideZero !== false && value <= 0) return;
        rows.push({
            key,
            label,
            amount: value,
            currency,
            role: options.role || 'line'
        });
    };

    const normalizedOrderTotal = money(orderTotal);
    const normalizedBookingPrice = money(bookingPrice);
    add('total', 'Загальна сума', normalizedOrderTotal ?? normalizedBookingPrice, { hideZero: false, role: 'total' });
    const depositAmount = deposit?.amount === null || deposit?.amount === undefined ? null : money(deposit.amount);

    return {
        currency,
        amountDue: subtractMoney(normalizedOrderTotal, depositAmount),
        rows
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
        missingCodes,
        source: cleanText(source.source, 120)
    };
}

function termsSnapshotOf(extra = {}) {
    const snapshot = extra.banquetTermsSnapshot
        || extra.banquet_terms_snapshot
        || extra.termsSnapshot
        || extra.terms_snapshot
        || {};
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
}

function termsSnapshotSourceOf(extra = {}) {
    return cleanText(valueOf(termsSnapshotOf(extra), 'source', 'termsSource', 'terms_source'), 120);
}

function isPriceRuleTermsSnapshot(extra = {}) {
    return String(termsSnapshotSourceOf(extra) || '').toLowerCase() === 'price_rules';
}

function normalizeRawTerms(rawTerms) {
    return Array.isArray(rawTerms)
        ? rawTerms.map(item => cleanText(item, 800)).filter(Boolean)
        : cleanText(rawTerms, 3000)
            ? cleanText(rawTerms, 3000).split(/\r?\n/).map(item => cleanText(item, 800)).filter(Boolean)
            : [];
}

function termsOf(mainBooking = {}, warnings, options = {}) {
    const extra = extraDataOf(mainBooking);
    const rawTerms = extra.banquetTerms || extra.banquet_terms || extra.terms || [];
    const items = normalizeRawTerms(rawTerms);
    const snapshotSource = termsSnapshotSourceOf(extra);
    const priceRuleSnapshot = isPriceRuleTermsSnapshot(extra);
    const defaults = normalizeResolvedTerms(options.defaults || options.banquetTermsDefaults);

    if (items.length && !priceRuleSnapshot) {
        return {
            title: 'Умови банкету',
            items,
            source: 'manual',
            snapshotSource: snapshotSource || null,
            missingCodes: []
        };
    }

    if (defaults.missingCodes.length) {
        warnings.push({
            code: 'banquet_terms_price_rule_missing',
            message: `Не знайдено price_rules для стандартних умов банкету: ${defaults.missingCodes.join(', ')}.`
        });
    }

    if (defaults.items.length) {
        return {
            title: defaults.title,
            items: defaults.items,
            source: defaults.source || 'price_rules',
            snapshotSource: priceRuleSnapshot ? snapshotSource : null,
            missingCodes: defaults.missingCodes
        };
    }

    if (items.length && priceRuleSnapshot) {
        warnings.push({
            code: 'banquet_terms_snapshot_fallback',
            message: 'Актуальні price_rules для умов банкету недоступні, тому використано збережений snapshot умов.'
        });
        return {
            title: 'Умови банкету',
            items,
            source: 'snapshot_fallback',
            snapshotSource: snapshotSource || 'price_rules',
            missingCodes: defaults.missingCodes
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
        items,
        source: null,
        snapshotSource: snapshotSource || null,
        missingCodes: defaults.missingCodes
    };
}

function buildBanquetSummary({ mainBooking, customer = null, linkedBookings = [], businessContext, generatedBy = null, resolvedGroup = null, banquetTermsDefaults = null, mode = 'client', canonicalDepositProjection = null, depositProjection = null } = {}) {
    if (!mainBooking || typeof mainBooking !== 'object') {
        throw new Error('mainBooking is required');
    }

    const normalizedMode = normalizeBanquetSummaryMode(mode);
    const modeContract = banquetSummaryModeContract(normalizedMode);
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
    const entryRow = buildEntryChargeRow(bookingPackage, warnings);
    pushPackageWarnings(warnings, bookingPackage);
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
    const entrySubtotal = money(valueOf(bookingPackage, 'entrySubtotal', 'entry_subtotal')) ?? money(entryRow?.subtotal);
    const explicitProgramBasePrice = money(valueOf(primaryPackage, 'programBasePrice', 'program_base_price'));
    const inferredProgramBasePrice = samePrimaryAndKitchen && bookingPrice !== null
        ? money(Math.max(0, bookingPrice - (menuSubtotal || 0) - (entrySubtotal || 0)))
        : bookingPrice;
    const programBasePrice = explicitProgramBasePrice ?? inferredProgramBasePrice;
    const programRow = shouldIncludeProgramOrderRow(primaryBooking, programBasePrice, menuRows)
        ? buildProgramRow(primaryBooking, programBasePrice)
        : null;
    const activityRows = buildLinkedActivityRows(groupState.activityBookings, { source: groupState.groupId ? 'banquet_group' : 'linked_booking' });
    const activitySubtotal = sumKnown(activityRows);
    const orderRows = [programRow, ...activityRows, entryRow, ...menuRows, ...serviceEventRows].filter(Boolean);
    const summaryComments = buildSummaryComments({
        primaryBooking,
        kitchenBooking,
        activityBookings: groupState.activityBookings,
        serviceBookings: groupState.serviceBookings,
        manualBookings: groupState.manualBookings,
        inlineCommentKeys: inlineCommentKeysFromRows(orderRows)
    });
    const rowsTotal = sumKnown(orderRows);
    const packageTotal = samePrimaryAndKitchen ? money(valueOf(bookingPackage, 'finalTotal', 'final_total')) : null;
    const computedTotal = addMoney(programBasePrice, activitySubtotal, menuSubtotal, entrySubtotal);
    const orderTotal = rowsTotal ?? computedTotal ?? packageTotal ?? bookingPrice;
    const deposit = summaryDepositOf(primaryBooking, canonicalDepositProjection || depositProjection);
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
    const finance = buildFinanceRows({
        programBasePrice,
        entrySubtotal,
        menuSubtotal,
        activitySubtotal,
        orderTotal,
        bookingPrice,
        deposit
    });

    const explicitChildrenCount = firstNonNull(
        valueOf(primaryBooking, 'kidsCount', 'kids_count'),
        valueOf(kitchenBooking, 'kidsCount', 'kids_count')
    );
    const legacyChildrenCount = firstNonNull(
        valueOf(kitchenBooking, 'banquetGuests', 'banquet_guests'),
        valueOf(primaryBooking, 'banquetGuests', 'banquet_guests')
    );
    const eventProgramName = cleanText(valueOf(primaryBooking, 'programName', 'program_name'), 200);
    const hasRealProgram = isRealBanquetProgram(primaryBooking);
    const eventSummary = {
        date: cleanText(valueOf(primaryBooking, 'date'), 40),
        time: cleanText(valueOf(primaryBooking, 'time'), 20),
        room: cleanText(valueOf(primaryBooking, 'room'), 120),
        programName: eventProgramName,
        hasRealProgram,
        programDisplayName: hasRealProgram ? eventProgramName : null,
        groupName: cleanText(
            valueOf(groupState.group || {}, 'groupName', 'group_name')
            || (!groupState.group ? valueOf(primaryBooking, 'groupName', 'group_name') : null),
            200
        ),
        createdAt: cleanText(valueOf(primaryBooking, 'createdAt', 'created_at'), 80),
        manager: cleanText(valueOf(primaryBooking, 'createdBy', 'created_by'), 160),
        status: cleanText(valueOf(primaryBooking, 'status'), 40)
    };
    const schedule = buildBanquetSchedule({
        event: eventSummary,
        orderRows,
        serviceEvents: serviceEventRows,
        warnings
    });
    const responsible = buildResponsiblePeople({
        primaryBooking,
        kitchenBooking,
        activityBookings: groupState.activityBookings,
        serviceBookings: groupState.serviceBookings,
        manualBookings: groupState.manualBookings,
        generatedBy,
        hasRealProgram
    });
    const normalizedCustomer = normalizeCustomer(customer || {});
    const normalizedCelebrant = normalizeCelebrant(primaryBooking, normalizedCustomer);

    return {
        success: true,
        schemaVersion: BANQUET_SUMMARY_SCHEMA_VERSION,
        mode: normalizedMode,
        modeContract,
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
            generatedBy: cleanText(generatedBy?.name || generatedBy?.username || generatedBy, 160)
        },
        venue: venueForContext(context, warnings),
        event: eventSummary,
        customer: normalizedCustomer,
        celebrants: normalizedCustomer.children,
        celebrant: normalizedCelebrant,
        counts: {
            children: nullableNumber(firstNonNull(explicitChildrenCount, legacyChildrenCount)),
            adults: nullableNumber(firstNonNull(valueOf(kitchenBooking, 'banquetAdults', 'banquet_adults'), valueOf(primaryBooking, 'banquetAdults', 'banquet_adults'))),
            guests: null,
            tables: nullableNumber(firstNonNull(valueOf(kitchenBooking, 'banquetTables', 'banquet_tables'), valueOf(primaryBooking, 'banquetTables', 'banquet_tables')))
        },
        orderRows,
        serviceEvents: serviceEventRows,
        schedule,
        responsible,
        comments: summaryComments,
        totals: {
            programBasePrice,
            menuSubtotal,
            entrySubtotal,
            activitySubtotal,
            orderTotal,
            bookingPrice,
            currency: CURRENCY
        },
        deposit: {
            id: deposit.id || null,
            amount: deposit.amount,
            paymentMethod: deposit.paymentMethod,
            paymentStatus: deposit.paymentStatus,
            status: deposit.status || null,
            note: deposit.note,
            source: deposit.source,
            sourceKind: deposit.sourceKind || null,
            receivedDate: deposit.receivedDate || null,
            verifiedAt: deposit.verifiedAt || null,
            accountantTaskId: deposit.accountantTaskId || null
        },
        finance,
        terms: termsOf(primaryBooking, warnings, { banquetTermsDefaults }),
        warnings
    };
}

module.exports = {
    BANQUET_SUMMARY_SCHEMA_VERSION,
    BANQUET_SUMMARY_MODES,
    BANQUET_SUMMARY_MODE_LABELS,
    BANQUET_SUMMARY_MODE_CONTRACTS,
    normalizeBanquetSummaryMode,
    banquetSummaryModeContract,
    banquetSummaryModeRowTypes,
    banquetSummaryModeAllowsComment,
    buildBanquetSummary
};
