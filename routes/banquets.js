'use strict';

const router = require('express').Router();
const { authenticateToken, requireAction } = require('../middleware/auth');
const { validateDate, validateId, validateBanquetCreationContext } = require('../services/booking');
const {
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');
const {
    bookingAccessDeniedPayload,
    canViewBooking
} = require('../services/bookingVisibility');
const {
    BanquetGroupError,
    attachBookingToBanquetGroup,
    createActivityBookingFromSourceBooking,
    createActivityBookingInBanquetGroup,
    createBanquetGroup,
    createMemberBookingFromSourceBooking,
    createMemberBookingInBanquetGroup,
    detachBookingFromBanquetGroup,
    loadBanquetGroupCandidates,
    loadBanquetGroupByBookingId,
    loadBanquetGroupById,
    updateBanquetGuestArrival
} = require('../services/banquetGroups');
const {
    getDepositProjectionForBooking,
    getDepositProjectionForGroup,
    resolveDepositContextFromBooking
} = require('../services/banquetDeposits');
const { createLogger } = require('../utils/logger');

const log = createLogger('Banquets');

router.use(authenticateToken);

function parsePositiveInteger(value) {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function sanitizeSnapshotForUser(snapshot, user) {
    if (!snapshot) return null;
    const visibleMembers = (snapshot.members || []).filter(member => canViewBooking(user, member.booking));
    const visibleBookingIds = new Set(visibleMembers.map(member => String(member.bookingId)));
    const hiddenCount = (snapshot.members || []).length - visibleMembers.length;

    const technicalChildrenByParentId = {};
    for (const member of visibleMembers) {
        const visibleChildren = (member.technicalChildren || []).filter(child => canViewBooking(user, child));
        if (visibleChildren.length) technicalChildrenByParentId[String(member.bookingId)] = visibleChildren;
    }

    const bookingFromMember = predicate => visibleMembers.filter(predicate).map(member => member.booking);
    const primaryMember = visibleMembers.find(member => member.isPrimary) || null;
    const group = snapshot.group
        ? {
            ...snapshot.group,
            primaryBookingId: snapshot.group.primaryBookingId && visibleBookingIds.has(String(snapshot.group.primaryBookingId))
                ? snapshot.group.primaryBookingId
                : null
        }
        : null;
    const warnings = [...(snapshot.warnings || [])];
    if (hiddenCount > 0) {
        warnings.push({
            code: 'hidden_members_omitted',
            message: `${hiddenCount} banquet booking member(s) were omitted by booking visibility rules.`
        });
    }
    const arrival = snapshot.arrival?.bookingId && visibleBookingIds.has(String(snapshot.arrival.bookingId))
        ? snapshot.arrival
        : null;

    return {
        ...snapshot,
        group,
        arrival,
        banquetArrival: arrival,
        memberships: (snapshot.memberships || []).filter(item => visibleBookingIds.has(String(item.bookingId))),
        members: visibleMembers.map(member => ({
            ...member,
            technicalChildren: technicalChildrenByParentId[String(member.bookingId)] || []
        })),
        bookings: {
            primary: primaryMember?.booking || null,
            kitchen: bookingFromMember(member => member.role === 'kitchen' || member.isKitchenCandidate),
            activities: bookingFromMember(member => member.role === 'activity'),
            services: bookingFromMember(member => member.role === 'service'),
            manual: bookingFromMember(member => member.role === 'manual'),
            technicalChildrenByParentId
        },
        warnings
    };
}

function anchorVisible(snapshot, user) {
    if (!snapshot?.anchorBookingId) return true;
    const anchorId = String(snapshot.anchorBookingId);
    return (snapshot.members || []).some(member => {
        if (String(member.bookingId) === anchorId && canViewBooking(user, member.booking)) return true;
        return (member.technicalChildren || []).some(child => String(child.id) === anchorId && canViewBooking(user, child));
    });
}

function sendReadResult(req, res, snapshot) {
    if (!snapshot) return res.status(404).json({ success: false, error: 'Banquet group not found' });
    if (!anchorVisible(snapshot, req.user)) {
        return res.status(404).json(bookingAccessDeniedPayload());
    }
    const visible = sanitizeSnapshotForUser(snapshot, req.user);
    if (!visible?.members?.length) {
        return res.status(404).json(bookingAccessDeniedPayload());
    }
    return res.json(visible);
}

function sendWriteError(res, err) {
    if (err instanceof BanquetGroupError) {
        return res.status(err.status || 400).json({
            success: false,
            error: err.message,
            code: err.code,
            conflictBookingId: err.details?.conflictBookingId || undefined,
            currentArrival: Object.prototype.hasOwnProperty.call(err.details || {}, 'currentArrival')
                ? err.details.currentArrival
                : undefined,
            currentUpdatedAt: err.details?.currentUpdatedAt || undefined,
            details: err.details || undefined
        });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

function requireBanquetCreationContract(res, value, options = {}) {
    const validation = validateBanquetCreationContext(value, options);
    if (validation.valid) return validation.context;
    res.status(400).json({
        success: false,
        error: validation.error,
        code: validation.code
    });
    return null;
}

router.get('/candidates', async (req, res) => {
    try {
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const date = String(req.query?.date || '').trim();
        if (!validateDate(date)) {
            return res.status(400).json({ success: false, error: 'Invalid date format' });
        }
        const customerId = parsePositiveInteger(req.query?.customerId || req.query?.customer_id);
        if (!customerId) {
            return res.status(400).json({ success: false, error: 'Invalid customer ID' });
        }

        const result = await loadBanquetGroupCandidates({ date, customerId, businessContext });
        const visibleCandidate = candidate => candidate?.primaryBooking && canViewBooking(req.user, candidate.primaryBooking);
        return res.json({
            ...result,
            candidates: (result.candidates || []).filter(visibleCandidate),
            fallbackCandidates: (result.fallbackCandidates || []).filter(visibleCandidate)
        });
    } catch (err) {
        log.error('GET /banquets/candidates error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
        const primaryBookingId = req.body?.primaryBookingId || req.body?.primary_booking_id;
        if (!validateId(primaryBookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid primary booking ID' });
        }
        const banquetContext = requireBanquetCreationContract(res, req.body?.banquetContext, {
            required: true,
            expectedMode: 'new'
        });
        if (!banquetContext) return;
        const result = await createBanquetGroup({
            primaryBookingId,
            businessContext,
            user: req.user,
            groupName: req.body?.groupName || req.body?.group_name,
            source: req.body?.source || 'manual',
            meta: req.body?.meta,
            banquetContext
        });
        return res.status(201).json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets error', err);
        return sendWriteError(res, err);
    }
});

router.post('/from-source/member-booking', async (req, res) => {
    try {
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        const sourceBookingId = req.body?.sourceBookingId || req.body?.source_booking_id;
        if (!validateId(sourceBookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid source booking ID' });
        }
        const banquetContext = requireBanquetCreationContract(res, req.body?.banquetContext, {
            required: true,
            expectedMode: 'new'
        });
        if (!banquetContext) return;
        const result = await createMemberBookingFromSourceBooking({
            sourceBookingId,
            memberBooking: req.body?.booking || req.body?.memberBooking || req.body?.member_booking,
            role: req.body?.role,
            businessContext,
            user: req.user,
            banquetContext
        });
        return res.status(201).json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets/from-source/member-booking error', err);
        return sendWriteError(res, err);
    }
});

router.post('/from-source/activity-booking', async (req, res) => {
    try {
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        const sourceBookingId = req.body?.sourceBookingId || req.body?.source_booking_id;
        if (!validateId(sourceBookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid source booking ID' });
        }
        const banquetContext = requireBanquetCreationContract(res, req.body?.banquetContext, {
            required: true,
            expectedMode: 'new'
        });
        if (!banquetContext) return;
        const activityBooking = req.body?.booking || req.body?.activityBooking || req.body?.activity_booking;
        const linkedBookings = Array.isArray(req.body?.linkedBookings)
            ? req.body.linkedBookings
            : (Array.isArray(req.body?.linked) ? req.body.linked : []);
        const result = await createActivityBookingFromSourceBooking({
            sourceBookingId,
            activityBooking,
            linkedBookings,
            businessContext,
            user: req.user,
            banquetContext
        });
        return res.status(201).json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets/from-source/activity-booking error', err);
        return sendWriteError(res, err);
    }
});

router.post('/:groupId/activity-booking', async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!validateId(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        const sourceBookingId = req.body?.sourceBookingId || req.body?.source_booking_id;
        if (!validateId(sourceBookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid source booking ID' });
        }
        const activityBooking = req.body?.booking || req.body?.activityBooking || req.body?.activity_booking;
        const linkedBookings = Array.isArray(req.body?.linkedBookings)
            ? req.body.linkedBookings
            : (Array.isArray(req.body?.linked) ? req.body.linked : []);
        const result = await createActivityBookingInBanquetGroup({
            groupId,
            sourceBookingId,
            activityBooking,
            linkedBookings,
            businessContext,
            user: req.user
        });
        return res.status(201).json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets/:groupId/activity-booking error', err);
        return sendWriteError(res, err);
    }
});

router.post('/:groupId/member-booking', async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!validateId(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        const result = await createMemberBookingInBanquetGroup({
            groupId,
            sourceBookingId: req.body?.sourceBookingId || req.body?.source_booking_id,
            memberBooking: req.body?.booking || req.body?.memberBooking || req.body?.member_booking,
            role: req.body?.role,
            businessContext,
            user: req.user
        });
        return res.status(201).json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets/:groupId/member-booking error', err);
        return sendWriteError(res, err);
    }
});

router.post('/:groupId/bookings', async (req, res) => {
    try {
        const { groupId } = req.params;
        const bookingId = req.body?.bookingId || req.body?.booking_id;
        if (!validateId(groupId) || !validateId(bookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid booking or group ID' });
        }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
        const result = await attachBookingToBanquetGroup({
            groupId,
            bookingId,
            role: req.body?.role,
            businessContext,
            user: req.user,
            label: req.body?.label,
            sortOrder: req.body?.sortOrder || req.body?.sort_order
        });
        return res.json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('POST /banquets/:groupId/bookings error', err);
        return sendWriteError(res, err);
    }
});

router.delete('/:groupId/bookings/:bookingId', async (req, res) => {
    try {
        const { groupId, bookingId } = req.params;
        if (!validateId(groupId) || !validateId(bookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid booking or group ID' });
        }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
        const result = await detachBookingFromBanquetGroup({
            groupId,
            bookingId,
            businessContext,
            user: req.user
        });
        return res.json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('DELETE /banquets/:groupId/bookings/:bookingId error', err);
        return sendWriteError(res, err);
    }
});

router.get('/by-booking/:bookingId', async (req, res) => {
    try {
        const { bookingId } = req.params;
        if (!validateId(bookingId)) return res.status(400).json({ success: false, error: 'Invalid booking ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const snapshot = await loadBanquetGroupByBookingId({ bookingId, businessContext });
        return sendReadResult(req, res, snapshot);
    } catch (err) {
        log.error('GET /banquets/by-booking/:bookingId error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/:groupId/arrival', requireAction('edit_booking'), async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!validateId(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
        const result = await updateBanquetGuestArrival({
            groupId,
            guestArrivalTime: req.body?.guestArrivalTime ?? req.body?.guest_arrival_time,
            updatedAt: req.body?.updatedAt ?? req.body?.updated_at,
            businessContext,
            user: req.user
        });
        return res.json(result);
    } catch (err) {
        if (!(err instanceof BanquetGroupError)) log.error('PATCH /banquets/:groupId/arrival error', err);
        return sendWriteError(res, err);
    }
});

router.get('/by-booking/:bookingId/deposit', async (req, res) => {
    try {
        const { bookingId } = req.params;
        if (!validateId(bookingId)) return res.status(400).json({ success: false, error: 'Invalid booking ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const context = await resolveDepositContextFromBooking({ bookingId, businessContext });
        if (!context.booking) return res.status(404).json({ success: false, error: 'Booking not found' });
        if (!canViewBooking(req.user, context.booking)) {
            return res.status(404).json(bookingAccessDeniedPayload());
        }
        const projection = await getDepositProjectionForBooking({ bookingId, businessContext });
        return res.json({ success: true, ...projection });
    } catch (err) {
        log.error('GET /banquets/by-booking/:bookingId/deposit error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:groupId/deposit', async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!validateId(groupId)) return res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const snapshot = await loadBanquetGroupById({ groupId, businessContext });
        if (!snapshot) return res.status(404).json({ success: false, error: 'Banquet group not found' });
        if (!anchorVisible(snapshot, req.user)) {
            return res.status(404).json(bookingAccessDeniedPayload());
        }
        const visible = sanitizeSnapshotForUser(snapshot, req.user);
        if (!visible?.members?.length) {
            return res.status(404).json(bookingAccessDeniedPayload());
        }
        const projection = await getDepositProjectionForGroup({ groupId, businessContext });
        return res.json({ success: true, ...projection });
    } catch (err) {
        log.error('GET /banquets/:groupId/deposit error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!validateId(groupId)) return res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const snapshot = await loadBanquetGroupById({ groupId, businessContext });
        return sendReadResult(req, res, snapshot);
    } catch (err) {
        log.error('GET /banquets/:groupId error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
