/**
 * Timeline and booking protected-surface manifest.
 *
 * These entries intentionally hash the critical source-of-truth blocks. If a
 * block changes, update the hash only after explicit product/owner approval and
 * record the reason in this manifest and docs/TIMELINE_PROTECTED_SURFACE.md.
 */

const PROTECTED_TIMELINE_BLOCKS = [
    {
        id: 'booking-detail-identity',
        owner: 'booking-detail',
        file: 'js/booking.js',
        start: 'function bookingDetailTimelineIdentity(booking = {})',
        end: 'function renderFullBanquetDetail(anchorBooking = {}, allBookings = [], snapshot = null)',
        sha256: '5f0d5d22ad9b657307e4e392313abf40071c84b6e1f14342723d3c18fe404c44',
        approval: {
            approvedBy: 'Product owner (explicit Codex Task 5 approval)',
            approvedOn: '2026-08-02',
            reason: 'Revenue access hardening adds a capability guard to canonical banquet deposit details; booking identity priorities, endpoint sources, and modal ownership are unchanged.'
        },
        requiredNeedles: [
            'function bookingDetailTimelineIdentity(booking = {})',
            'function bookingDetailLineIdentityValues(booking = {}, identity = bookingDetailTimelineIdentity(booking))',
            'booking.resourceId',
            'identity.resourceId',
            'booking.lineId',
            'identity.lineId'
        ]
    },
    {
        id: 'booking-detail-safe-open',
        owner: 'booking-detail',
        file: 'js/booking.js',
        start: "function bookingDetailSafeRender(section, booking = {}, renderFn, fallback = '')",
        end: 'function selectedBanquetCandidateRole(bookingId)',
        sha256: '198a22c5a0f22034b1706474a6402b4f1a7c814edf2f69b329ec65e54a802b2a',
        approval: {
            approvedBy: 'Product owner (explicit Codex Tasks 1-5 approval)',
            approvedOn: '2026-08-14',
            reason: 'Canonical detail modal now renders booking cancellation actions from server readiness and routes active banquet members to canonical cancellation endpoints. Booking detail ownership, source priorities, and timeline renderer boundaries are unchanged.'
        },
        requiredNeedles: [
            "function bookingDetailSafeRender(section, booking = {}, renderFn, fallback = '')",
            'async function resolveBookingDetailsRecord(cleanBookingId, options = {})',
            'apiGetBookingById(cleanBookingId, { fresh: true })',
            'async function showBookingDetails(bookingId, options = {})',
            "bookingDetailSafeRender('full-banquet-detail'",
            "bookingDetailSafeRender('event-card-image'",
            'bookingDetailsMissingDiagnostic(cleanBookingId, detailRecord, options)',
            'emitBookingDetailsMissingDiagnostic(diagnostic, options)'
        ]
    },
    {
        id: 'timeline-open-diagnostics',
        owner: 'timeline',
        file: 'js/timeline.js',
        start: 'function timelineBookingDetailModalIsOpen()',
        end: 'function normalizeTimelineLinesForContext(lines = [])',
        sha256: '4f2aec2ccbf0b2874a14d52465be354e72542b11cd8c5b2c1cdaab62e3844d03',
        approval: {
            approvedBy: 'Serhii',
            approvedOn: '2026-07-03',
            reason: 'Timeline linked activity blocks must open their own booking first, with parent as fallback only.'
        },
        requiredNeedles: [
            'function timelineBookingDetailModalIsOpen()',
            'async function timelineProbeBookingOpenDiagnostic(bookingId',
            'async function openTimelineBookingDetailsFromBlock(renderBooking = {})',
            'await showBookingDetails(targetId',
            'await showBookingDetails(linkedId',
            "source: 'timeline_block_click_parent_fallback'",
            'TL-BK-DETAIL-OK-OPEN-FAILED',
            'timelineBookingDetailModalIsOpen()'
        ]
    },
    {
        id: 'route-attach-timeline-identity',
        owner: 'bookings-api',
        file: 'routes/bookings.js',
        start: 'function attachTimelineIdentityToBooking(booking, identity = {})',
        end: 'function bookingExtraDataSqlValue(booking = {})',
        sha256: 'c3f05fb271713d9326033cd85229a4b697f21a7b10cb5f83d96d0427acde8ab2',
        approval: {
            approvedBy: 'Serhii',
            approvedOn: '2026-07-03',
            reason: 'Backend must preserve resourceId/lineId identity when creating linked bookings.'
        },
        requiredNeedles: [
            'function attachTimelineIdentityToBooking(booking, identity = {})',
            'resourceId: identity.resourceId || identity.lineId || booking.lineId || null',
            'lineId: identity.lineId || identity.resourceId || booking.lineId || null',
            'function attachLinkedBookingTimelineIdentity(booking, businessContext, identity = {})',
            "source: identity.source || booking.resourceSource || 'linked_booking_line'"
        ]
    },
    {
        id: 'route-project-timeline-identity',
        owner: 'bookings-api',
        file: 'routes/bookings.js',
        start: 'function bookingTimelineIdentity(booking = {})',
        end: "function projectBookingForTimelineView(booking = {}, timelineView = 'animators')",
        sha256: '5578c4feda4f358ce32c7fb3f0633e11809176c98ab6375c89a7a854b017a850',
        approval: {
            approvedBy: 'Product owner (explicit Codex task approval)',
            approvedOn: '2026-07-17',
            reason: 'Room identity Task 3 makes room_resource_id the first timeline projection identity while retaining the legacy room resolver as a recovery path.'
        },
        requiredNeedles: [
            'function bookingTimelineIdentity(booking = {})',
            'function bookingSourceLineId(booking = {})',
            'function bookingSourceResourceId(booking = {})',
            'const roomResolution = booking.roomTimelineResolution || booking.room_timeline_resolution || null',
            'const roomResourceId = booking.roomResourceId',
            'diagnosticReason: view === \'rooms\' ? (roomResolution?.diagnosticReason || null) : null',
            'const linkedChild = Boolean(String(booking.linkedTo || booking.linked_to ||',
            "hiddenReason = 'linked_child_hidden_from_room_timeline'",
            'resourceId,',
            'lineId: sourceLineId'
        ]
    },
    {
        id: 'service-booking-row-map',
        owner: 'booking-service',
        file: 'services/booking.js',
        start: 'function mapBookingRow(row)',
        end: 'function lineColorForIndex(index, fallback)',
        sha256: '0ffb4b37cbde15cd7ecbb4c627d9c5e168bf7d14f1d75153d229d994bd387c3b',
        approval: {
            approvedBy: 'Product owner (explicit Codex delivery approval)',
            approvedOn: '2026-07-24',
            reason: 'Booking row mapper must preserve explicit zero banquet ticket counts in detail and timeline projections.'
        },
        requiredNeedles: [
            'function mapBookingRow(row)',
            'resourceId: row.resource_id',
            '|| row.line_id',
            'businessContext: extraData?.timelineIdentity?.businessContext',
            'lineId: row.line_id',
            'roomResourceId: row.room_resource_id || null',
            'timelineIdentity,',
            'linkedTo: row.linked_to'
        ]
    }
];

const FORBIDDEN_TIMELINE_NEEDLES = [
    {
        file: 'js/timeline.js',
        needle: 'TL-BK-DETAIL-RECOVERY-OPENED',
        reason: 'Timeline must not ship an alternate recovery details UI.'
    },
    {
        file: 'js/timeline.js',
        needle: 'Recovery \u043f\u0456\u0441\u043b\u044f detail API',
        reason: 'Timeline must not display recovery detail cards.'
    },
    {
        file: 'js/timeline.js',
        needle: "getElementById('bookingDetails').innerHTML",
        reason: 'Only canonical booking modules may render booking details markup.'
    },
    {
        file: 'js/timeline.js',
        needle: 'getElementById("bookingDetails").innerHTML',
        reason: 'Only canonical booking modules may render booking details markup.'
    }
];

const REQUIRED_REGRESSION_TEST_NEEDLES = [
    {
        file: 'tests/timeline-resources.test.js',
        needles: [
            'timeline block click opens the canonical booking.js details modal',
            'primary banquet optional renderer failed',
            'optional banquet renderer failure is logged without blocking the canonical modal'
        ]
    },
    {
        file: 'tests/ui-check.js',
        needles: [
            "const bookingInviteParamsBlock = sourceBlock(bookingCode, \"const inviteModel = bookingDetailSafeRender('invite-model'\"",
            "bookingDetailSafeRender('full-banquet-detail'",
            "bookingDetailSafeRender('banquet-header-package'",
            "bookingDetailSafeRender('comment-detail'"
        ]
    }
];

module.exports = {
    PROTECTED_TIMELINE_BLOCKS,
    FORBIDDEN_TIMELINE_NEEDLES,
    REQUIRED_REGRESSION_TEST_NEEDLES
};
