/**
 * timeline-banquet-inspector-helpers.js
 * Pure banquet summary and service-marker helpers used by js/timeline.js.
 */

function timelineBanquetMenuPreviewItems(kitchenBookings = []) {
    const items = [];
    const noteText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const noteParts = item => {
        const parts = [
            noteText(item?.servingNote || item?.serving_note),
            noteText(item?.note || item?.notes)
        ].filter(Boolean);
        return [...new Set(parts)].join(' · ') || null;
    };
    kitchenBookings.forEach(booking => {
        const positions = timelineBanquetMenuPositions(booking);
        if (!positions.length) {
            const fallbackTitle = String(booking?.banquetMenu || booking?.banquet_menu || '').trim();
            if (fallbackTitle) {
                items.push({
                    title: fallbackTitle,
                    quantity: null,
                    servingUnit: null,
                    unitPrice: null,
                    servingTime: '',
                    note: null
                });
            }
            return;
        }
        positions.forEach((item, index) => {
            const quantity = Number(item?.quantity || item?.qty || 0);
            const unitPrice = Number(item?.unitPrice ?? item?.unit_price ?? item?.price);
            items.push({
                title: timelineBanquetMenuItemTitle(item, index),
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                servingUnit: item?.servingUnit || item?.serving_unit || item?.priceUnit || item?.price_unit || null,
                unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : null,
                servingTime: normalizeTimelineBanquetServingTime(item?.servingTime || item?.serving_time),
                note: noteParts(item)
            });
        });
    });
    return items;
}

function timelineBanquetActivityPreviewItems(activityBookings = []) {
    return activityBookings.map(booking => ({
        title: String(booking?.label || booking?.programName || booking?.program_name || booking?.programCode || booking?.program_code || 'Активність').trim(),
        time: normalizeTimelineBanquetServingTime(booking?.time),
        room: String(booking?.room || '').trim()
    })).filter(item => item.title);
}

function timelineBanquetBookingActivityTitle(booking = {}) {
    return String(booking?.label || booking?.programName || booking?.program_name || booking?.programCode || booking?.program_code || 'Активність').trim();
}

function timelineBanquetCleanComment(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 500) : '';
}

function timelineBanquetWorkspaceComments(booking = {}) {
    const extra = timelineExtraData(booking);
    const workspace = extra?.bookingWorkspace || extra?.booking_workspace || {};
    const comments = workspace?.comments || {};
    return comments && typeof comments === 'object' ? comments : {};
}

function timelineBanquetCommentSources(summary = {}) {
    const sources = [];
    const seen = new Set();
    const add = (booking, role = 'manual') => {
        const id = String(booking?.id || booking?.bookingId || '').trim();
        const key = id || `${role}:${sources.length}`;
        if (!booking || seen.has(key)) return;
        seen.add(key);
        sources.push({ booking, role: String(role || 'manual').trim().toLowerCase() });
    };

    (summary.kitchenBookings || []).forEach(booking => add(booking, 'kitchen'));
    (summary.activityBookings || []).forEach(booking => add(booking, 'activity'));
    add(summary.primaryBooking, 'primary');
    (summary.snapshot?.members || []).forEach(member => add(member?.booking, member?.isPrimary ? 'primary' : member?.role));
    (summary.allBookings || []).forEach(booking => add(booking, 'manual'));

    return sources;
}

function timelineBanquetCommentItems(summary = {}) {
    const result = [];
    const seenComments = new Set();
    const addComment = (label, value) => {
        const text = timelineBanquetCleanComment(value);
        if (!text) return;
        const key = text.toLocaleLowerCase('uk-UA');
        if (seenComments.has(key)) return;
        seenComments.add(key);
        result.push({ label, text });
    };

    timelineBanquetCommentSources(summary).forEach(({ booking, role }) => {
        const comments = timelineBanquetWorkspaceComments(booking);
        const kitchenComment = timelineBanquetCleanComment(comments.kitchen);
        const activityComment = timelineBanquetCleanComment(comments.activity);
        const internalComment = timelineBanquetCleanComment(comments.internal);
        const legacyComment = timelineBanquetCleanComment(booking?.notes);

        if (kitchenComment) {
            addComment('Кухня', kitchenComment);
        }
        if (activityComment) {
            addComment(`Активність — ${timelineBanquetBookingActivityTitle(booking)}`, activityComment);
        }
        if (internalComment) {
            addComment('Внутрішній коментар', internalComment);
        }
        if (!kitchenComment && !activityComment && !internalComment && legacyComment) {
            if (role === 'kitchen' || role === 'service' || timelineBanquetBookingHasMenu(booking) || timelineBanquetServiceEvents(booking).length > 0) {
                addComment('Кухня', legacyComment);
            } else if (role === 'activity') {
                addComment(`Активність — ${timelineBanquetBookingActivityTitle(booking)}`, legacyComment);
            } else {
                addComment('Внутрішній коментар', legacyComment);
            }
        }
    });

    return result;
}

function timelineBanquetActivityStartsText(summary = {}) {
    const items = (summary.activityPreviewItems || [])
        .filter(item => item?.time)
        .map(item => `${item.time} — ${item.title || 'Активність'}`);
    return items.join(' · ');
}

function normalizeTimelineBanquetServingTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeTimelineBanquetServiceEventType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (['guest_arrival', 'food_service', 'cake', 'drinks', 'room_setup', 'custom'].includes(type)) return type;
    return 'service';
}

function timelineBanquetServiceEventLabel(type) {
    switch (normalizeTimelineBanquetServiceEventType(type)) {
        case 'guest_arrival':
            return 'Прихід гостей';
        case 'cake':
            return 'Торт';
        case 'drinks':
            return 'Напої';
        case 'room_setup':
            return 'Підготувати кімнату';
        case 'custom':
            return 'Подія';
        case 'food_service':
            return 'Видача';
        default:
            return 'Сервіс';
    }
}

function timelineBanquetSnapshotArrival(snapshot = {}) {
    const raw = snapshot?.arrival || snapshot?.banquetArrival || snapshot?.group?.arrival || snapshot?.group?.banquetArrival;
    if (!raw || typeof raw !== 'object') return null;
    const bookingId = String(raw.bookingId || raw.booking_id || '').trim();
    const date = String(raw.date || '').trim().slice(0, 10);
    const time = normalizeTimelineBanquetServingTime(raw.time);
    const room = String(raw.room || '').trim();
    const source = String(raw.source || '').trim();
    const updatedAt = String(raw.updatedAt || raw.updated_at || '').trim();
    const groupId = String(snapshot?.groupId || snapshot?.group?.id || '').trim();
    if (!bookingId && !date && !time && !room && !source) return null;
    return {
        bookingId: bookingId || null,
        groupId: groupId || null,
        date: date || null,
        time: time || null,
        room: room || null,
        source: source || null,
        updatedAt: updatedAt || null
    };
}

function timelineBanquetArrivalMarker(summary = {}) {
    const arrival = summary.arrival || summary.banquetArrival || null;
    if (!arrival || typeof arrival !== 'object') return null;
    const time = normalizeTimelineBanquetServingTime(arrival.time);
    if (!time) return null;
    const bookingId = String(arrival.bookingId || arrival.booking_id || '').trim();
    const groupId = String(arrival.groupId || arrival.group_id || summary.groupId || '').trim();
    const room = String(arrival.room || summary.room || '').trim();
    return {
        type: 'guest_arrival',
        label: 'Прихід гостей',
        title: 'Прихід гостей',
        time,
        date: String(arrival.date || summary.date || '').trim().slice(0, 10) || null,
        room: room || null,
        source: String(arrival.source || '').trim() || null,
        groupId: groupId || null,
        bookingId: bookingId || null,
        bookingIds: bookingId ? [bookingId] : [],
        count: 1,
        items: [{
            title: 'Прихід гостей',
            quantity: null,
            note: room || null
        }]
    };
}

function timelineBanquetBookingHasMenu(booking = {}) {
    return timelineBanquetMenuCount(booking) > 0
        || booking?.banquetGuests != null
        || booking?.banquet_guests != null
        || booking?.banquetAdults != null
        || booking?.banquet_adults != null
        || booking?.banquetTables != null
        || booking?.banquet_tables != null;
}

function uniqueTimelineBanquetBookings(bookings = []) {
    const seen = new Set();
    return (bookings || []).filter(booking => {
        const id = String(booking?.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function timelineBanquetSnapshotBookings(snapshot = {}) {
    const grouped = snapshot?.bookings || {};
    const fromMembers = (snapshot?.members || []).map(member => member?.booking).filter(Boolean);
    return uniqueTimelineBanquetBookings([
        grouped.primary,
        ...(grouped.kitchen || []),
        ...(grouped.activities || []),
        ...(grouped.services || []),
        ...(grouped.manual || []),
        ...fromMembers
    ].filter(Boolean));
}

function firstTimelineBanquetValue(bookings = [], getter) {
    for (const booking of bookings) {
        const value = getter(booking);
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
}

function timelineBanquetReliableCustomerName(snapshot = {}, bookings = []) {
    const group = snapshot?.group || null;
    const explicitGroupName = String(group?.customerName || group?.customer_name || '').trim();
    if (explicitGroupName) return explicitGroupName;

    const groupCustomerId = String(group?.customerId || group?.customer_id || '').trim();
    const groupPrimaryId = String(group?.primaryBookingId || group?.primary_booking_id || '').trim();
    const primaryBooking = groupPrimaryId
        ? (bookings || []).find(booking => String(booking?.id || booking?.bookingId || '').trim() === groupPrimaryId) || null
        : null;
    const primaryCustomerId = String(primaryBooking?.customerId || primaryBooking?.customer_id || '').trim();
    const primaryCustomerName = String(primaryBooking?.customerName || primaryBooking?.customer_name || '').trim();
    if (primaryCustomerName && (!groupCustomerId || primaryCustomerId === groupCustomerId)) {
        return primaryCustomerName;
    }

    const candidates = (bookings || [])
        .map(booking => ({
            customerId: String(booking?.customerId || booking?.customer_id || '').trim(),
            customerName: String(booking?.customerName || booking?.customer_name || '').trim()
        }))
        .filter(candidate => candidate.customerName)
        .filter(candidate => !groupCustomerId || candidate.customerId === groupCustomerId);
    const customerIds = new Set(candidates.map(candidate => candidate.customerId).filter(Boolean));
    const customerNames = new Set(candidates.map(candidate => candidate.customerName));
    const identityIsReliable = groupCustomerId
        ? customerNames.size === 1
        : customerIds.size === 1 && customerNames.size === 1;
    return identityIsReliable ? [...customerNames][0] : null;
}

const TIMELINE_BANQUET_WARNING_TEXT_BY_CODE = Object.freeze({
    guest_arrival_missing: 'Не вказано коректний час приходу гостей для банкету.',
    primary_booking_missing: 'Основну бронь банкету не визначено.',
    kitchen_booking_missing: 'Для цього банкету ще немає окремого бронювання кухні / меню.',
    multiple_kitchen_bookings: 'Знайдено кілька бронювань кухні / меню. Перед друком або редагуванням перевірте основне бронювання пакета.',
    hidden_members_omitted: 'Частину бронювань приховано правилами доступу.'
});
function timelineBanquetSnapshotWarningText(warning) {
    const code = String(warning?.code || '').trim();
    const text = String(warning?.message || warning?.text || warning || '').trim();
    const hiddenWarningCodes = typeof TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES === 'undefined'
        ? null
        : TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES;
    if (code && hiddenWarningCodes?.has?.(code)) return '';
    if (code && TIMELINE_BANQUET_WARNING_TEXT_BY_CODE[code]) return TIMELINE_BANQUET_WARNING_TEXT_BY_CODE[code];
    const normalized = text.toLowerCase();
    const looksTechnicalBanquetWarning = (
        (normalized.includes('attached') && normalized.includes('banquet group'))
        || (normalized.includes('legacy') && normalized.includes('booking_banquet_links'))
        || (normalized.includes('schema') && normalized.includes('banquet group'))
    );
    if (looksTechnicalBanquetWarning) return '';
    return text;
}

function timelineBanquetOwnerName(source = {}) {
    return String(source?.createdBy || source?.created_by || '').trim();
}

function timelineBanquetSnapshotSummary(snapshot = {}) {
    if (!snapshot?.success) return null;
    const allBookings = timelineBanquetSnapshotBookings(snapshot);
    if (!allBookings.length) return null;
    const grouped = snapshot.bookings || {};
    const primaryBooking = grouped.primary || (snapshot.members || []).find(member => member?.isPrimary)?.booking || allBookings[0];
    const kitchenBookings = uniqueTimelineBanquetBookings([
        ...(grouped.kitchen || []),
        ...allBookings.filter(booking => timelineBanquetBookingHasMenu(booking) || timelineBanquetServiceEvents(booking).length > 0)
    ]);
    const primaryActivityBookings = timelineBanquetPreviewBookingIsRenderableActivity(primaryBooking) ? [primaryBooking] : [];
    const activityBookings = uniqueTimelineBanquetBookings([
        ...primaryActivityBookings,
        ...(grouped.activities || []),
        ...(snapshot.members || [])
            .filter(member => member?.role === 'activity')
            .map(member => member.booking)
            .filter(Boolean)
    ]);
    const menuCount = kitchenBookings.reduce((sum, booking) => sum + timelineBanquetMenuCount(booking), 0);
    const sourceForCounts = [primaryBooking, ...kitchenBookings, ...activityBookings, ...allBookings].filter(Boolean);
    const warnings = (snapshot.warnings || [])
        .map(timelineBanquetSnapshotWarningText)
        .filter(Boolean);
    const carrierBooking = null;
    const arrival = timelineBanquetSnapshotArrival(snapshot);
    const fallbackDate = snapshot?.group?.date || firstTimelineBanquetValue(sourceForCounts, booking => booking.date);
    const fallbackTime = firstTimelineBanquetValue([primaryBooking, ...allBookings].filter(Boolean), booking => booking.time);
    const fallbackRoom = snapshot?.group?.room || firstTimelineBanquetValue(sourceForCounts, booking => booking.room);
    const date = arrival?.date || fallbackDate;
    const time = arrival?.time || fallbackTime;
    const duration = firstTimelineBanquetValue([primaryBooking, ...allBookings].filter(Boolean), booking => booking.duration);
    const activityPreviewItems = timelineBanquetActivityPreviewItems(activityBookings);
    return {
        snapshot,
        arrival,
        banquetArrival: arrival,
        groupId: timelineBanquetSnapshotGroupId(snapshot),
        primaryBooking,
        carrierBooking,
        allBookings,
        kitchenBookings,
        activityBookings,
        hasMenu: menuCount > 0,
        menuCount,
        activityCount: activityBookings.length,
        menuPreviewItems: timelineBanquetMenuPreviewItems(kitchenBookings),
        activityPreviewItems,
        summaryAvailable: true,
        customerName: timelineBanquetReliableCustomerName(snapshot, sourceForCounts),
        room: arrival?.room || fallbackRoom,
        date,
        time,
        duration,
        kidsCount: firstTimelineBanquetValue(sourceForCounts, booking => booking.kidsCount ?? booking.kids_count)
            ?? firstTimelineBanquetValue(sourceForCounts, booking => booking.banquetGuests ?? booking.banquet_guests),
        banquetAdults: firstTimelineBanquetValue(sourceForCounts, booking => booking.banquetAdults ?? booking.banquet_adults),
        banquetTables: firstTimelineBanquetValue(sourceForCounts, booking => booking.banquetTables ?? booking.banquet_tables),
        warnings
    };
}

function timelineBanquetServingInfo(summary = {}) {
    const servingGroups = new Map();
    const markers = [];
    let missingCount = 0;
    const kitchenBookings = Array.isArray(summary.kitchenBookings) ? summary.kitchenBookings : [];

    kitchenBookings.forEach(booking => {
        const bookingOwnerName = timelineBanquetOwnerName(booking);
        const bookingId = String(booking?.id || booking?.bookingId || '').trim();
        timelineBanquetMenuPositions(booking).forEach((item, index) => {
            const servingTime = normalizeTimelineBanquetServingTime(item?.servingTime || item?.serving_time);
            const title = String(item?.title || item?.name || item?.productName || item?.product_name || `Позиція ${index + 1}`).trim();
            if (!servingTime) {
                missingCount += 1;
                return;
            }
            const group = servingGroups.get(servingTime) || {
                type: 'food_service',
                label: 'Видача',
                title: `Видача ${servingTime}`,
                time: servingTime,
                count: 0,
                bookingId: bookingId || null,
                bookingIds: [],
                items: []
            };
            if (bookingOwnerName && !group.createdBy) group.createdBy = bookingOwnerName;
            if (bookingId && !group.bookingIds.includes(bookingId)) group.bookingIds.push(bookingId);
            if (bookingId && !group.bookingId) group.bookingId = bookingId;
            const quantity = Number(item?.quantity || item?.qty || 0);
            const unitPrice = Number(item?.unitPrice ?? item?.unit_price ?? item?.price);
            group.count += 1;
            group.items.push({
                title,
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                servingUnit: item?.servingUnit || item?.serving_unit || item?.priceUnit || item?.price_unit || null,
                unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : null,
                note: item?.servingNote || item?.serving_note || item?.note || null
            });
            servingGroups.set(servingTime, group);
        });

        timelineBanquetServiceEvents(booking).forEach((item, index) => {
            const servingTime = normalizeTimelineBanquetServingTime(item?.time || item?.servingTime || item?.serving_time);
            if (!servingTime) {
                missingCount += 1;
                return;
            }
            const eventType = normalizeTimelineBanquetServiceEventType(item?.type);
            const label = timelineBanquetServiceEventLabel(eventType);
            const title = String(item?.title || label || `Сервіс ${index + 1}`).trim();
            markers.push({
                type: eventType,
                label,
                title,
                time: servingTime,
                bookingId: bookingId || null,
                bookingIds: bookingId ? [bookingId] : [],
                createdBy: bookingOwnerName || null,
                count: 1,
                items: [{
                    title,
                    quantity: null,
                    note: item?.note || item?.comment || null
                }]
            });
        });
    });

    servingGroups.forEach(group => markers.push(group));
    markers.sort((a, b) => {
        const byTime = String(a.time || '').localeCompare(String(b.time || ''));
        if (byTime) return byTime;
        return String(a.label || '').localeCompare(String(b.label || ''));
    });

    return { markers, missingCount };
}
