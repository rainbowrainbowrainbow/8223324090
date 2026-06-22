function timelineLineResourceIdentity(line = {}, index = 0) {
    const embedded = timelineEmbeddedIdentity(line);
    const resourceId = String(
        line?.resourceId
        || line?.resource_id
        || embedded.resourceId
        || embedded.resource_id
        || line?.id
        || line?.lineId
        || line?.line_id
        || ''
    ).trim() || String(index + 1);
    return {
        resourceId,
        resourceType: line?.resourceType || line?.resource_type || line?.type || embedded.resourceType || embedded.resource_type || timelineDefaultResourceType(),
        businessContext: line?.businessContext || line?.business_context || embedded.businessContext || embedded.business_context || timelineBusinessContextValue(),
        source: line?.source || line?.resourceSource || embedded.source || (line?.resourceId || line?.resource_id ? 'timeline_resource' : 'timeline_line')
    };
}

function timelineProjectionView(projection = {}) {
    return String(projection?.timelineView || projection?.timeline_view || projection?.view || '').trim().toLowerCase();
}

function timelineCurrentViewKey() {
    return isRoomTimelineView() ? TIMELINE_VIEW_ROOMS : 'animators';
}

function timelineCanonicalProjectionForCurrentView(booking = {}) {
    const projection = booking?.timelineProjection || booking?.timeline_projection || null;
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return null;
    const projectionView = timelineProjectionView(projection);
    if (!projectionView || projectionView !== timelineCurrentViewKey()) return null;
    const hasCanonicalSignal = Boolean(
        projection?.resourceId
        || projection?.resource_id
        || projection?.lineId
        || projection?.line_id
        || projection?.displaySurface
        || projection?.display_surface
        || projection?.hiddenReason
        || projection?.hidden_reason
        || Object.prototype.hasOwnProperty.call(projection, 'visibleInAnimatorTimeline')
        || Object.prototype.hasOwnProperty.call(projection, 'visible_in_animator_timeline')
        || Object.prototype.hasOwnProperty.call(projection, 'visibleInRoomTimeline')
        || Object.prototype.hasOwnProperty.call(projection, 'visible_in_room_timeline')
    );
    return hasCanonicalSignal ? projection : null;
}

function timelineProjectionResourceId(projection = {}) {
    return String(projection?.resourceId || projection?.resource_id || '').trim();
}

function timelineProjectionLineId(projection = {}) {
    return String(projection?.lineId || projection?.line_id || '').trim();
}

function timelineProjectionResourceType(projection = {}) {
    return String(projection?.resourceType || projection?.resource_type || '').trim();
}

function timelineProjectionDisplaySurface(projection = {}) {
    return String(projection?.displaySurface || projection?.display_surface || '').trim();
}

function timelineProjectionHiddenReason(projection = {}) {
    return String(projection?.hiddenReason || projection?.hidden_reason || '').trim();
}

function timelineProjectionVisibleInCurrentView(projection = {}) {
    if (isRoomTimelineView()) {
        if (Object.prototype.hasOwnProperty.call(projection, 'visibleInRoomTimeline')) return projection.visibleInRoomTimeline !== false;
        if (Object.prototype.hasOwnProperty.call(projection, 'visible_in_room_timeline')) return projection.visible_in_room_timeline !== false;
        return true;
    }
    if (Object.prototype.hasOwnProperty.call(projection, 'visibleInAnimatorTimeline')) return projection.visibleInAnimatorTimeline !== false;
    if (Object.prototype.hasOwnProperty.call(projection, 'visible_in_animator_timeline')) return projection.visible_in_animator_timeline !== false;
    return true;
}

function timelineBookingRenderHiddenReason(booking = {}) {
    const projection = timelineCanonicalProjectionForCurrentView(booking);
    if (projection) {
        const hiddenReason = timelineProjectionHiddenReason(projection);
        if (timelineProjectionDisplaySurface(projection) === 'hidden') {
            return hiddenReason || 'timeline_projection_hidden';
        }
        if (!timelineProjectionVisibleInCurrentView(projection)) {
            return hiddenReason || (isRoomTimelineView() ? 'not_visible_in_room_timeline' : 'not_visible_in_animator_timeline');
        }
        return '';
    }
    return isTimelineBanquetServiceBooking(booking) ? 'banquet_service_hidden_from_animator' : '';
}

function timelineBookingResourceIdentity(booking = {}) {
    const embedded = timelineEmbeddedIdentity(booking);
    const projection = booking?.timelineProjection || booking?.timeline_projection || {};
    const canonicalProjection = timelineCanonicalProjectionForCurrentView(booking);
    const roomProjection = isRoomTimelineView() || projection?.view === TIMELINE_VIEW_ROOMS;
    if (canonicalProjection) {
        const resourceId = isRoomTimelineView()
            ? timelineProjectionResourceId(canonicalProjection)
            : (timelineProjectionResourceId(canonicalProjection) || timelineProjectionLineId(canonicalProjection));
        return {
            resourceId,
            resourceType: isRoomTimelineView() ? 'room' : (timelineProjectionResourceType(canonicalProjection) || timelineDefaultResourceType()),
            businessContext: booking?.businessContext || booking?.business_context || embedded.businessContext || embedded.business_context || timelineBusinessContextValue(),
            source: 'timeline_projection'
        };
    }
    const resourceId = String(
        roomProjection
            ? (
                projection?.resourceId
                || projection?.resource_id
                || projection?.lineId
                || projection?.line_id
                || booking?.resourceId
                || booking?.resource_id
                || booking?.room
                || embedded.resourceId
                || embedded.resource_id
                || booking?.lineId
                || booking?.line_id
                || ''
            )
            : (
                projection?.resourceId
                || projection?.resource_id
                || projection?.lineId
                || projection?.line_id
                || booking?.lineId
                || booking?.line_id
                || booking?.resourceId
                || booking?.resource_id
                || embedded.resourceId
                || embedded.resource_id
                || ''
            )
    ).trim();
    return {
        resourceId,
        resourceType: roomProjection ? 'room' : (projection?.resourceType || projection?.resource_type || booking?.resourceType || booking?.resource_type || embedded.resourceType || embedded.resource_type || timelineDefaultResourceType()),
        businessContext: booking?.businessContext || booking?.business_context || embedded.businessContext || embedded.business_context || timelineBusinessContextValue(),
        source: projection?.source || embedded.source || booking?.resourceSource || booking?.source || 'booking_line'
    };
}

function normalizedTimelineMatchKey(value) {
    return String(value ?? '').trim().toLowerCase();
}

function addTimelineMatchKey(keys, value) {
    const key = normalizedTimelineMatchKey(value);
    if (key) keys.add(key);
}

function addTimelineMetadataMatchKeys(keys, metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return;
    addTimelineMatchKey(keys, metadata.legacyLineId);
    addTimelineMatchKey(keys, metadata.legacy_line_id);
    addTimelineMatchKey(keys, metadata.lineId);
    addTimelineMatchKey(keys, metadata.line_id);
    addTimelineMatchKey(keys, metadata.resourceId);
    addTimelineMatchKey(keys, metadata.resource_id);
    const legacyIds = metadata.legacyLineIds || metadata.legacy_line_ids;
    if (Array.isArray(legacyIds)) legacyIds.forEach(item => addTimelineMatchKey(keys, item));
}

function timelineLineMatchKeys(line = {}) {
    const embedded = timelineEmbeddedIdentity(line);
    const identity = timelineLineResourceIdentity(line);
    const keys = new Set();
    [
        line?.id,
        line?.lineId,
        line?.line_id,
        line?.resourceId,
        line?.resource_id,
        line?.staffId,
        line?.staff_id,
        identity.resourceId,
        embedded.resourceId,
        embedded.resource_id,
        line?.name,
        line?.shortName,
        line?.short_name
    ].forEach(value => addTimelineMatchKey(keys, value));
    addTimelineMetadataMatchKeys(keys, line?.metadata);
    addTimelineMetadataMatchKeys(keys, line?.extraData || line?.extra_data);
    return keys;
}

function timelineBookingMatchKeys(booking = {}) {
    const embedded = timelineEmbeddedIdentity(booking);
    const identity = timelineBookingResourceIdentity(booking);
    const canonicalProjection = timelineCanonicalProjectionForCurrentView(booking);
    const keys = new Set();
    if (canonicalProjection) {
        addTimelineMatchKey(keys, timelineProjectionResourceId(canonicalProjection));
        if (!isRoomTimelineView()) addTimelineMatchKey(keys, timelineProjectionLineId(canonicalProjection));
        return keys;
    }
    [
        booking?.lineId,
        booking?.line_id,
        booking?.resourceId,
        booking?.resource_id,
        identity.resourceId,
        embedded.resourceId,
        embedded.resource_id
    ].forEach(value => addTimelineMatchKey(keys, value));
    addTimelineMetadataMatchKeys(keys, booking?.metadata);
    addTimelineMetadataMatchKeys(keys, booking?.extraData || booking?.extra_data);

    // Resource-backed cabinet/room timelines historically stored the visible room
    // name in bookings.room while lines now use durable resource ids.
    const lineType = normalizedTimelineMatchKey(identity.resourceType);
    if (lineType === 'cabinet' || lineType === 'room' || lineType === 'resource') {
        addTimelineMatchKey(keys, booking?.room);
    }
    return keys;
}

function timelineBookingsForLine(bookings = [], line = {}) {
    const lineKeys = timelineLineMatchKeys(line);
    return bookings.filter(booking => {
        const bookingKeys = timelineBookingMatchKeys(booking);
        for (const key of bookingKeys) {
            if (lineKeys.has(key)) return true;
        }
        return false;
    });
}
window.timelineLineResourceIdentity = timelineLineResourceIdentity;
window.timelineBookingResourceIdentity = timelineBookingResourceIdentity;
window.timelineBookingMatchKeys = timelineBookingMatchKeys;
window.timelineLineMatchKeys = timelineLineMatchKeys;
window.timelineBookingsForLine = timelineBookingsForLine;
window.timelineCanonicalProjectionForCurrentView = timelineCanonicalProjectionForCurrentView;
window.timelineBookingRenderHiddenReason = timelineBookingRenderHiddenReason;
