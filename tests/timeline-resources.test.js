const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const {
    buildModuleMap,
    startPagePathForBusiness
} = require('../services/businessProfile');
const {
    normalizeBusinessCabinetSettings,
    timelineDisplayFromBusinessCabinet
} = require('../services/businessCabinet');
const {
    canAccessTimelineContext,
    isTimelineContext,
    timelineContextFromRequest
} = require('../services/timelineContext');
const {
    normalizeTimelineDisplaySettings,
    resourceTypeForDisplayMode,
    findTimelineResourceByName,
    resourceToLine,
    timelineResourceAvailability,
    timelineResourceRoomMatchValues,
    mergeTimelineResourceRenameAliases,
    resolveRoomTimelineResourceIdentity,
    canonicalizeBookingRoomResource,
    upsertTimelineResource,
    countFutureActiveBookingsForTimelineResource
} = require('../services/timelineResources');
const {
    TIMELINE_VISUAL_BLOCKS,
    mergeTimelineVisibilityPayload,
    normalizeTimelineVisibilityView,
    sanitizeTimelineVisibilityPayload,
    timelineVisibilityResponse
} = require('../services/timelineVisibilitySettings');
const {
    checkRoomConflict,
    checkServerConflicts,
    isLineConflictBlockingLine,
    isRoomConflictBlockingRoom,
    isTakeawayRoomValue,
    lockBookingConflictResources,
    findRoomConflictAmongCandidates
} = require('../services/booking');
const banquetConflictMatrix = require('./fixtures/banquet-conflict-matrix');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pinataNumbersHarness() {
    const ui = read('js/ui.js');
    const start = ui.indexOf('const PINATA_NUMBERS_ROOT');
    const end = ui.indexOf('function getSharedPinataNumbers', start);
    assert.ok(start >= 0 && end > start, 'shared PinataNumbers helper slice exists');
    const context = { console };
    vm.createContext(context);
    vm.runInContext(ui.slice(start, end), context);
    assert.ok(context.PinataNumbers, 'PinataNumbers is registered on globalThis');
    return context.PinataNumbers;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function createConfigHarness() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const context = {
        console,
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        setTimeout,
        clearTimeout,
        Date,
        URLSearchParams
    };
    context.window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'event_genix' }),
        presentation: () => ({ mode: 'park' }),
        storageKey: name => `test_${name}`
    };
    vm.createContext(context);
    vm.runInContext(read('js/config.js'), context);
    return { context, close: () => dom.window.close() };
}

test('timeline API products keep canonical durations for known programs', () => {
    const config = read('js/config.js');
    assert.match(config, /const EVENT_GENIX_PROGRAM_DURATION_FALLBACKS = EVENT_GENIX_PROGRAMS\.reduce/);
    assert.match(config, /!product\.isCustom[\s\S]*product\.category !== 'custom'/);
    assert.match(config, /function normalizeTimelineProductDurationFromApi/);
    assert.match(config, /fallback > 15[\s\S]*duration <= 15/);
    assert.match(config, /duration:\s*normalizeTimelineProductDurationFromApi\(p\)/);

    const { context, close } = createConfigHarness();
    try {
        const map = id => context.mapApiProductToTimelineProduct({
            id,
            duration: 15,
            businessContext: 'event_genix'
        }).duration;

        assert.equal(map('bubble'), 30);
        assert.equal(map('neon_bubble'), 30);
        assert.equal(map('paper'), 30);
        assert.equal(map('pinata'), 15);
        assert.equal(map('custom'), 15);
        assert.equal(map('unknown'), 15);
    } finally {
        close();
    }
});

function createTimelineResourceMatchingHarness(options = {}) {
    const timeline = read('js/timeline.js');
    const timelineResourceIdentity = read('js/timeline-resource-identity.js');
    const start = timeline.indexOf('function timelineExtraData');
    const end = timeline.indexOf('async function handleTimelineBusinessContextChanged');
    assert.ok(start >= 0 && end > start, 'timeline resource matching helper slice exists');
    const context = {
        console,
        __roomView: Boolean(options.roomView),
        TIMELINE_VIEW_ROOMS: 'rooms',
        TIMELINE_BANQUET_SERVICE_LINE_ID: 'banquet-service',
        TIMELINE_BANQUET_SERVICE_LINE_LABEL: 'Banquet service',
        document: {
            addEventListener: () => {}
        },
        window: {
            TimelineBusinessContext: {
                presentation: () => ({ mode: 'park', resourceType: options.roomView ? 'room' : 'animator' }),
                current: () => ({ apiValue: 'event_genix' }),
                state: () => ({ activeBusinessContext: 'event_genix' })
            }
        },
        isRoomTimelineView: () => context.__roomView,
        isParkAnimatorTimelineView: () => !context.__roomView,
        escapeHtml: value => String(value ?? '')
    };
    vm.createContext(context);
    vm.runInContext(`${timelineResourceIdentity}
        ${timeline.slice(start, end)}
        this.__resourceMatchingHooks = {
            setRoomView: value => { this.__roomView = Boolean(value); },
            timelineBookingMatchKeys,
            timelineBookingsForLine,
            timelineBookingRenderHiddenReason,
            timelineProjectionDiagnosticReason,
            timelineBookingMatchDiagnostic,
            normalizeTimelineBookingsForContext,
            timelineBookingDiagnosticsStore,
            resetTimelineBookingDiagnostics,
            isTimelineRoomQuarantineLine,
            shouldRenderTimelineLine,
            timelineRoomQuarantineDiagnosticReasons,
            timelineLineHeaderTitle,
            timelineLineUnavailableStatusText
        };
    `, context, { filename: 'js/timeline.js' });
    return context.__resourceMatchingHooks;
}

function roomConflictPolicyClient(rows, sourceGroups = []) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            if (/FROM timeline_resources/i.test(sql)) {
                return { rows: [], rowCount: 0 };
            }
            queries.push({ sql, params });
            if (/FROM banquet_group_bookings/i.test(sql) && /booking_id = \$1/i.test(sql)) {
                return { rows: sourceGroups.map(group_id => ({ group_id })) };
            }
            return { rows };
        }
    };
}

function cssRule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(match, `CSS rule exists for ${selector}`);
    return match[1];
}

function cssRuleIncludingSelector(css, selector) {
    const normalizedSelector = String(selector || '').trim().replace(/\s+/g, ' ');
    let rule = '';
    for (const match of css.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)) {
        const selectors = match[1].split(',').map(item => item.trim().replace(/\s+/g, ' '));
        if (selectors.includes(normalizedSelector)) rule = match[2];
    }
    if (rule) return rule;
    assert.fail(`CSS rule exists for selector ${selector}`);
}

function cssDeclaration(rule, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rule.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
    assert.ok(match, `CSS declaration exists for ${property}`);
    return match[1].trim();
}

function cssPxValue(rule, property) {
    const value = cssDeclaration(rule, property);
    const match = value.match(/^([0-9.]+)px$/);
    assert.ok(match, `${property} is a px value`);
    return Number(match[1]);
}

function cssNumberValue(rule, property) {
    const value = cssDeclaration(rule, property);
    const parsed = Number(value);
    assert.ok(Number.isFinite(parsed), `${property} is numeric`);
    return parsed;
}

function firstCssPxValue(value) {
    const match = String(value || '').match(/([0-9.]+)px/);
    assert.ok(match, `CSS value includes px: ${value}`);
    return Number(match[1]);
}

function createTimelineBanquetMarkerHarness() {
    const timeline = read('js/timeline.js');
    const banquetInspectorHelpers = read('js/timeline-banquet-inspector-helpers.js');
    const start = timeline.indexOf('function timelineExtraData');
    const end = timeline.indexOf('function showTimelineBanquetPreviewFromBlock');
    assert.ok(start >= 0 && end > start, 'timeline banquet room preview slice exists');
    const viewState = { room: true };

    const dom = new JSDOM(`
        <!doctype html>
        <html>
            <body>
                <div class="timeline-line">
                    <div class="line-header" data-line-id="room-a" data-timeline-room-name="Room A">
                        <span class="line-name">Room A</span>
                    </div>
                    <div class="line-grid" data-line-id="room-a">
                        <div class="grid-cell"></div>
                    </div>
                </div>
            </body>
        </html>
    `, { url: 'http://localhost/timeline' });

    const context = {
        console,
        document: dom.window.document,
        window: dom.window,
        URLSearchParams: dom.window.URLSearchParams,
        __timelineViewState: viewState,
        __cachedBookings: [],
        TIMELINE_BANQUET_ROOM_PREVIEWS: new Map(),
        TIMELINE_BANQUET_SERVICE_LINE_ID: 'banquet-service',
        TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES: new Set(['primary', 'root', 'banquet']),
        TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES: new Set(['activity', 'service', 'manual']),
        TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES: new Set([
            'banquet_group_not_found',
            'legacy_banquet_links_fallback',
            'banquet_group_schema_unavailable'
        ]),
        AppState: { selectedDate: new Date('2099-06-18T00:00:00') },
        CONFIG: { TIMELINE: { CELL_MINUTES: 30, CELL_WIDTH: 50 } },
        isRoomTimelineView: () => viewState.room,
        setTimelineActiveBanquetContext: () => ({ groupId: 'group-regression' }),
        clearTimelineActiveBanquetContext: () => {},
        _getTimelineCachedBookings: () => context.__cachedBookings,
        timelineBusinessContextValue: () => 'event_genix',
        getTimeRange: () => ({ start: 10, end: 20 }),
        getTimelineLineGrid: lineId => dom.window.document.querySelector(`.line-grid[data-line-id="${lineId}"]`),
        normalizedTimelineMatchKey: value => String(value || '').trim().toLowerCase(),
        timeToMinutes: value => {
            const [hours, minutes] = String(value || '').split(':').map(Number);
            return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
        },
        timelineMinutesToPixels: minutes => (minutes / 30) * 50,
        timelineDurationWidth: duration => (duration / 30) * 50 - 4,
        showTimelineBanquetInspector: () => {
            context.__inspectorOpened = true;
        },
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    };

    vm.createContext(context);
    vm.runInContext(`${banquetInspectorHelpers}
        ${timeline.slice(start, end)}`, context, { filename: 'js/timeline.js' });
    return context;
}

function createTimelineBanquetMarkerScenario(bookingPackage, options = {}) {
    const ctx = createTimelineBanquetMarkerHarness();
    const hasCreatedByOption = Object.prototype.hasOwnProperty.call(options, 'createdBy');
    const createdBy = hasCreatedByOption ? options.createdBy : (bookingPackage.createdBy || bookingPackage.created_by || 'Svitlana');
    const kitchenBooking = {
        id: 'BK-KITCHEN',
        date: '2099-06-18',
        time: '11:00',
        room: 'Room A',
        extraData: { bookingPackage }
    };
    if (createdBy) kitchenBooking.createdBy = createdBy;
    const summary = {
        primaryBooking: kitchenBooking,
        carrierBooking: kitchenBooking,
        kitchenBookings: [kitchenBooking],
        allBookings: [kitchenBooking],
        room: 'Room A',
        customerName: 'Regression Customer',
        date: '2099-06-18',
        time: '11:00',
        hasMenu: true,
        menuCount: (bookingPackage.menuPositions || []).length,
        activityCount: 0,
        menuPreviewItems: ctx.timelineBanquetMenuPreviewItems([kitchenBooking]),
        warnings: []
    };
    if (options.arrival) {
        summary.arrival = options.arrival;
        summary.banquetArrival = options.arrival;
    }
    const servingInfo = ctx.timelineBanquetServingInfo(summary);
    const inspectorSummary = ctx.timelineBanquetSummaryForInspector(summary, servingInfo, kitchenBooking);
    return { ctx, inspectorSummary };
}

for (const scenario of banquetConflictMatrix) {
    test(`server banquet conflict matrix: ${scenario.name}`, async () => {
        const candidate = {
            id: 'BK-candidate',
            date: '2099-06-01',
            time: '11:30',
            duration: 60,
            room: scenario.candidate.room || 'Room A',
            status: 'confirmed',
            ...scenario.candidate
        };
        const conflictBooking = {
            id: 'BK-conflict',
            date: candidate.date,
            time: '11:30',
            duration: 60,
            room: scenario.conflict.room || 'Room A',
            status: 'confirmed',
            ...scenario.conflict
        };
        const client = roomConflictPolicyClient([conflictBooking]);
        const conflict = await checkRoomConflict(
            client,
            candidate.date,
            candidate.room,
            candidate.time,
            candidate.duration,
            {
                banquetGroupId: candidate.banquetGroupId,
                sourceBookingId: candidate.id,
                candidateBooking: candidate,
                allowSameBanquetOperationalOverlap: true
            }
        );

        assert.equal(Boolean(conflict), scenario.expected === 'block', scenario.name);
        if (scenario.expected === 'block') assert.equal(conflict.id, 'BK-conflict');
    });
}

test('atomic room candidates use role-aware policy and return a concrete conflicting booking', () => {
    const base = {
        date: '2099-06-01',
        time: '11:30',
        duration: 60,
        room: 'Room A',
        status: 'confirmed',
        banquetGroupId: 'BG-1'
    };
    const kitchen = { ...base, id: 'BK-kitchen', category: 'kitchen', programCode: 'KITCHEN', banquetGroupRole: 'kitchen' };
    const firstActivity = { ...base, id: 'BK-activity-1', category: 'animation', banquetGroupRole: 'activity' };
    const secondActivity = { ...base, id: 'BK-activity-2', category: 'quest', banquetGroupRole: 'activity' };

    assert.equal(findRoomConflictAmongCandidates([kitchen, firstActivity]), null);
    const conflict = findRoomConflictAmongCandidates([kitchen, firstActivity, secondActivity]);
    assert.equal(conflict.candidate.id, 'BK-activity-1');
    assert.equal(conflict.conflict.id, 'BK-activity-2');
});

function renderTimelineBanquetRoomGridMarkers(bookingPackage, options = {}) {
    const { ctx, inspectorSummary } = createTimelineBanquetMarkerScenario(bookingPackage, options);
    ctx.__timelineViewState.room = options.roomView !== false;
    const lineGrid = ctx.document.querySelector('.line-grid');
    (options.activityBlocks || []).forEach((activity, index) => {
        const activityMinutes = ctx.timeToMinutes(activity.time || '12:00');
        const startMinutes = ctx.getTimeRange().start * 60;
        const left = ctx.timelineMinutesToPixels(activityMinutes - startMinutes);
        const width = ctx.timelineDurationWidth(activity.duration || 30);
        const block = ctx.document.createElement('div');
        block.className = `booking-block ${activity.category || 'animation'} is-room-timeline-activity-card booking-block--${activity.density || 'short'}`;
        block.dataset.bookingId = activity.id || `activity-${index}`;
        block.style.left = `${left}px`;
        block.style.width = `${width}px`;
        block.innerHTML = `
            <div class="timeline-room-activity-main">
                <span class="booking-block-time">${activity.time || '12:00'}</span>
                <span class="timeline-room-activity-title">${activity.title || 'Activity'}</span>
            </div>
        `;
        lineGrid.appendChild(block);
    });
    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    const line = lineGrid?.closest('.timeline-line');
    return {
        ctx,
        inspectorSummary,
        layout: {
            gridLaneCount: lineGrid?.dataset.roomMarkerLanes || '',
            gridOperationalLaneCount: lineGrid?.dataset.roomOperationalLanes || '',
            gridRowHeight: lineGrid?.style.getPropertyValue('--room-service-marker-row-height') || '',
            gridOperationalRowHeight: lineGrid?.style.getPropertyValue('--timeline-room-operational-row-height') || '',
            lineLaneCount: line?.dataset.roomMarkerLanes || '',
            lineOperationalLaneCount: line?.dataset.roomOperationalLanes || '',
            lineRowHeight: line?.style.getPropertyValue('--room-service-marker-row-height') || '',
            lineOperationalRowHeight: line?.style.getPropertyValue('--timeline-room-operational-row-height') || '',
            lineMinHeight: line?.style.getPropertyValue('--timeline-line-min-h') || '',
            hasGridLaneClass: lineGrid?.classList.contains('has-timeline-room-service-markers') || false,
            hasGridOperationalLaneClass: lineGrid?.classList.contains('has-timeline-room-operational-lanes') || false,
            hasLineLaneClass: line?.classList.contains('has-timeline-room-service-marker-lanes') || false,
            hasLineOperationalLaneClass: line?.classList.contains('has-timeline-room-operational-lanes') || false
        },
        markers: Array.from(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker')).map(node => {
            const userLetter = node.querySelector('.user-letter');
            return {
            tagName: node.tagName,
            className: node.className,
            type: node.dataset.banquetRoomMarker,
            text: node.textContent.trim(),
            primary: [
                node.querySelector('.timeline-room-service-marker-time')?.textContent.trim(),
                node.querySelector('.timeline-room-service-marker-title')?.textContent.trim()
            ].filter(Boolean).join(' '),
            detail: node.querySelector('.timeline-room-service-marker-detail')?.textContent.trim() || '',
            hasMainLine: Boolean(node.querySelector('.timeline-room-service-marker-main')),
            hasTimeElement: Boolean(node.querySelector('.timeline-room-service-marker-time')),
            hasTitleElement: Boolean(node.querySelector('.timeline-room-service-marker-title')),
            hasDetailElement: Boolean(node.querySelector('.timeline-room-service-marker-detail')),
            hasUserLetter: Boolean(userLetter),
            hasUserLetterClass: node.classList.contains('has-user-letter'),
            userLetter: userLetter?.textContent.trim() || '',
            userLetterTitle: userLetter?.getAttribute('title') || '',
            markerTitle: node.dataset.markerTitle,
            markerDetail: node.dataset.markerDetail || '',
            bookingId: node.dataset.bookingId || '',
            bookingIds: node.dataset.bookingIds || '',
            groupId: node.dataset.banquetRoomMarkerGroup || '',
            canonicalGroupId: node.dataset.banquetGroupId || '',
            draggable: node.draggable,
            time: node.dataset.markerTime,
            lane: node.dataset.markerLane,
            parentClass: node.parentElement?.className || '',
            left: node.style.left,
            top: node.style.top,
            width: node.style.width,
            markerTop: node.style.getPropertyValue('--marker-top'),
            roomOperationalLane: node.dataset.roomOperationalLane,
            roomLaneTop: node.style.getPropertyValue('--timeline-room-lane-top'),
            ariaHaspopup: node.getAttribute('aria-haspopup'),
            ariaLabel: node.getAttribute('aria-label') || '',
            titleAttr: node.getAttribute('title') || ''
        };
        }),
        activities: Array.from(ctx.document.querySelectorAll('.line-grid .is-room-timeline-activity-card')).map(node => ({
            className: node.className,
            text: node.textContent.trim(),
            left: node.style.left,
            top: node.style.top,
            width: node.style.width,
            height: node.style.height,
            roomOperationalLane: node.dataset.roomOperationalLane,
            roomActivityLane: node.dataset.roomActivityLane,
            roomLaneTop: node.style.getPropertyValue('--timeline-room-lane-top'),
            roomActivityHeight: node.style.getPropertyValue('--timeline-room-activity-card-height')
        }))
    };
}

test('timeline banquet snapshot summary reads canonical arrival projection', () => {
    const ctx = createTimelineBanquetMarkerHarness();
    const summary = ctx.timelineBanquetSnapshotSummary({
        success: true,
        source: 'group',
        group: {
            id: 'GRP-ARRIVAL-1',
            date: '2099-06-18',
            room: 'Old Room',
            primaryBookingId: 'BK-PRIMARY'
        },
        arrival: {
            bookingId: 'BK-ACTIVITY',
            date: '2099-06-19',
            time: '13:05',
            room: 'Arrival Room',
            source: 'banquet_group',
            groupSource: 'manual',
            updatedAt: '2099-06-18T10:00:00.000Z'
        },
        bookings: {
            primary: {
                id: 'BK-PRIMARY',
                category: 'banquet',
                date: '2099-06-18',
                time: '11:00',
                room: 'Old Room',
                customerName: 'Regression Customer'
            },
            activities: [{
                id: 'BK-ACTIVITY',
                category: 'animation',
                date: '2099-06-19',
                time: '13:05',
                room: 'Arrival Room'
            }],
            kitchen: []
        },
        members: []
    });

    assert.equal(summary.arrival.bookingId, 'BK-ACTIVITY');
    assert.equal(summary.arrival.groupId, 'GRP-ARRIVAL-1');
    assert.equal(summary.arrival.updatedAt, '2099-06-18T10:00:00.000Z');
    assert.equal(summary.date, '2099-06-19');
    assert.equal(summary.time, '13:05');
    assert.equal(summary.room, 'Arrival Room');
    assert.equal(summary.banquetArrival.source, 'banquet_group');
});

test('timeline banquet snapshot keeps active kitchen data visible when the primary booking is cancelled', () => {
    const ctx = createTimelineBanquetMarkerHarness();
    const primary = {
        id: 'FIXTURE-LEGACY-PRIMARY',
        status: 'cancelled',
        category: 'banquet',
        date: '2099-08-20',
        time: '12:15',
        room: 'Fixture Room'
    };
    const kitchen = {
        id: 'FIXTURE-LEGACY-KITCHEN',
        status: 'confirmed',
        category: 'banquet',
        date: '2099-08-20',
        time: '12:15',
        room: 'Fixture Room',
        banquetGuests: 14,
        extraData: {
            bookingPackage: {
                menuPositions: [{
                    title: 'Synthetic menu item',
                    quantity: 1,
                    servingTime: '12:15'
                }]
            }
        }
    };
    const summary = ctx.timelineBanquetSnapshotSummary({
        success: true,
        source: 'group',
        group: {
            id: 'FIXTURE-LEGACY-GROUP',
            status: 'active',
            date: '2099-08-20',
            room: 'Fixture Room',
            primaryBookingId: primary.id
        },
        arrival: {
            bookingId: primary.id,
            date: '2099-08-20',
            time: '12:15',
            room: 'Fixture Room',
            source: 'banquet_group'
        },
        bookings: {
            primary,
            kitchen: [kitchen],
            activities: [],
            services: [],
            manual: []
        },
        members: [
            { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary },
            { bookingId: kitchen.id, role: 'kitchen', booking: kitchen }
        ]
    });

    assert.equal(summary.primaryBooking.status, 'cancelled');
    assert.equal(summary.kitchenBookings.length, 1);
    assert.equal(summary.kitchenBookings[0].id, kitchen.id);
    assert.equal(summary.hasMenu, true);
    assert.equal(summary.menuCount, 1);
    assert.equal(summary.activityCount, 0);
    assert.equal(summary.kidsCount, 14);
    assert.equal(summary.date, '2099-08-20');
    assert.equal(summary.time, '12:15');
    assert.equal(summary.room, 'Fixture Room');
});

test('timeline banquet inspector summary trusts the canonical group customer and keeps cancelled primary plus active kitchen', () => {
    const ctx = createTimelineBanquetMarkerHarness();
    const primary = {
        id: 'FIXTURE-CANCELLED-PRIMARY',
        status: 'cancelled',
        category: 'banquet',
        date: '2099-08-20',
        time: '12:15',
        room: 'Fixture Room',
        customerId: 101,
        customerName: null
    };
    const kitchen = {
        id: 'FIXTURE-ACTIVE-KITCHEN',
        status: 'confirmed',
        category: 'kitchen',
        date: '2099-08-20',
        time: '12:15',
        room: 'Fixture Room',
        customerId: 202,
        customerName: 'Unrelated member customer',
        banquetGuests: 14,
        extraData: {
            bookingPackage: {
                menuPositions: [{
                    title: 'Synthetic menu item',
                    quantity: 1,
                    servingTime: '13:45'
                }]
            }
        }
    };
    const summary = ctx.timelineBanquetSnapshotSummary({
        success: true,
        source: 'banquet_group',
        group: {
            id: 'FIXTURE-HISTORICAL-GROUP',
            status: 'active',
            date: '2099-08-20',
            room: 'Fixture Room',
            primaryBookingId: primary.id,
            customerId: 101,
            customerName: 'Canonical Group Customer'
        },
        arrival: {
            bookingId: primary.id,
            date: '2099-08-20',
            time: '12:15',
            room: 'Fixture Room',
            source: 'banquet_group'
        },
        bookings: {
            primary,
            kitchen: [kitchen],
            activities: [],
            services: [],
            manual: []
        },
        memberships: [{
            bookingId: primary.id,
            role: 'primary'
        }, {
            bookingId: kitchen.id,
            role: 'kitchen'
        }],
        members: [{
            bookingId: primary.id,
            role: 'primary',
            membershipRole: 'primary',
            isPrimary: true,
            isKitchenCandidate: false,
            booking: primary
        }, {
            bookingId: kitchen.id,
            role: 'kitchen',
            membershipRole: 'kitchen',
            isPrimary: false,
            isKitchenCandidate: true,
            booking: kitchen
        }],
        warnings: [{
            code: 'incomplete_historical_banquet_record',
            message: 'Неповний історичний банкетний запис'
        }]
    });

    assert.equal(summary.customerName, 'Canonical Group Customer');
    assert.equal(summary.activityCount, 0);
    assert.equal(summary.primaryBooking.id, primary.id);
    assert.equal(summary.primaryBooking.status, 'cancelled');
    assert.equal(summary.activityBookings.length, 0);
    assert.equal(summary.kitchenBookings.length, 1);
    assert.equal(summary.kitchenBookings[0].id, kitchen.id);
    assert.equal(summary.hasMenu, true);
    assert.equal(summary.menuCount, 1);
    assert.equal(summary.kidsCount, 14);
    assert.deepEqual(Array.from(summary.warnings), ['Неповний історичний банкетний запис']);
    ctx.canAccess = permission => permission === 'edit_booking';
    const servingInfo = ctx.timelineBanquetServingInfo(summary);
    const inspectorSummary = ctx.timelineBanquetSummaryForInspector(summary, servingInfo, kitchen);
    ctx.showTimelineBanquetInspector(null, inspectorSummary, null);
    const inspector = ctx.document.getElementById('timelineBanquetInspector');
    assert.equal(inspector.dataset.state, 'ready');
    assert.match(inspector.textContent, /12:15/);
    assert.match(inspector.textContent, /13:45/);
    assert.equal(inspector.querySelector('[data-banquet-inspector-edit-arrival]'), null);
    assert.equal(inspector.querySelector('[data-banquet-inspector-edit]'), null);
    assert.match(
        inspector.textContent,
        /Неповний історичний банкетний запис/
    );

    const unresolvedCustomerSummary = ctx.timelineBanquetSnapshotSummary({
        ...summary.snapshot,
        group: {
            ...summary.snapshot.group,
            customerName: null
        }
    });
    assert.equal(
        unresolvedCustomerSummary.customerName,
        null,
        'a differently identified kitchen member must not become the group customer'
    );
    const unresolvedServingInfo = ctx.timelineBanquetServingInfo(unresolvedCustomerSummary);
    const unresolvedInspectorSummary = ctx.timelineBanquetSummaryForInspector(
        unresolvedCustomerSummary,
        unresolvedServingInfo,
        kitchen
    );
    ctx.showTimelineBanquetInspector(null, unresolvedInspectorSummary, null);
    assert.doesNotMatch(inspector.textContent, /Unrelated member customer/);

    const normalPrimary = { ...primary, status: 'confirmed', customerName: 'Canonical Group Customer' };
    const normalSnapshot = {
        ...summary.snapshot,
        group: { ...summary.snapshot.group, status: 'active' },
        bookings: { ...summary.snapshot.bookings, primary: normalPrimary },
        members: summary.snapshot.members.map(member => (
            member.bookingId === primary.id
                ? { ...member, booking: normalPrimary }
                : member
        )),
        warnings: []
    };
    const normalSummary = ctx.timelineBanquetSnapshotSummary(normalSnapshot);
    assert.equal(normalSummary.primaryBooking.status, 'confirmed');
    assert.equal(normalSummary.kitchenBookings.length, 1);
    assert.equal(ctx.timelineCanEditBanquet(normalSummary), true);
    const activityCarrier = {
        id: 'BK-ACTIVITY-CARRIER',
        programId: 'PROGRAM-1',
        lineId: 'animator-1'
    };
    const normalInspectorSummary = ctx.timelineBanquetSummaryForInspector(
        normalSummary,
        ctx.timelineBanquetServingInfo(normalSummary),
        activityCarrier
    );
    const editCalls = [];
    ctx.editBooking = (bookingId, options) => editCalls.push({ bookingId, options });
    ctx.showTimelineBanquetInspector(null, normalInspectorSummary, null);
    const editButton = inspector.querySelector('[data-banquet-inspector-edit]');
    assert.ok(editButton);
    assert.equal(inspector.querySelector('[data-banquet-inspector-edit-arrival]'), null);
    editButton.click();
    assert.deepEqual(plain(editCalls), [{
        bookingId: activityCarrier.id,
        options: {
            source: 'timeline_banquet_inspector',
            preferBanquetEditor: true
        }
    }]);

    ctx.canAccess = () => false;
    ctx.showTimelineBanquetInspector(null, normalInspectorSummary, null);
    assert.equal(inspector.querySelector('[data-banquet-inspector-edit]'), null);
});

function applyTimelineBanquetPreviewWithVisibleBlocks(bookingPackage) {
    const ctx = createTimelineBanquetMarkerHarness();
    const lineGrid = ctx.document.querySelector('.line-grid');
    const rootBooking = {
        id: 'BK-ROOT',
        category: 'banquet',
        date: '2099-06-18',
        time: '11:00',
        duration: 180,
        room: 'Room A',
        customerName: 'Regression Customer'
    };
    const kitchenBooking = {
        id: 'BK-KITCHEN',
        category: 'banquet',
        date: '2099-06-18',
        time: '11:30',
        duration: 120,
        room: 'Room A',
        label: 'Kitchen duplicate',
        extraData: { bookingPackage }
    };
    const activityBooking = {
        id: 'BK-ACTIVITY',
        category: 'animation',
        date: '2099-06-18',
        time: '12:00',
        duration: 60,
        room: 'Room A',
        label: 'Animator'
    };
    const rootBlock = ctx.document.createElement('div');
    rootBlock.className = 'booking-block banquet-block';
    rootBlock.dataset.bookingId = rootBooking.id;
    rootBlock.innerHTML = '<div class="user-letter">R</div><div class="title">Root banquet block</div><div class="subtitle">11:00</div>';
    const kitchenBlock = ctx.document.createElement('div');
    kitchenBlock.className = 'booking-block banquet-block';
    kitchenBlock.dataset.bookingId = kitchenBooking.id;
    kitchenBlock.innerHTML = '<div class="user-letter">K</div><div class="title">Kitchen duplicate block</div><div class="subtitle">11:30</div>';
    const activityBlock = ctx.document.createElement('div');
    activityBlock.className = 'booking-block animation';
    activityBlock.dataset.bookingId = activityBooking.id;
    activityBlock.innerHTML = '<div class="user-letter">A</div><div class="title">Animator block</div><div class="subtitle">12:00</div>';
    lineGrid.append(rootBlock, kitchenBlock, activityBlock);

    ctx.__cachedBookings = [rootBooking, kitchenBooking, activityBooking];
    ctx.applyTimelineBanquetPreview({
        success: true,
        group: {
            id: 'GRP-ROOM-1',
            room: 'Room A',
            date: '2099-06-18',
            primaryBookingId: rootBooking.id
        },
        bookings: {
            primary: rootBooking,
            kitchen: [kitchenBooking],
            activities: [activityBooking],
            services: [],
            manual: []
        },
        members: [
            { bookingId: rootBooking.id, role: 'primary', isPrimary: true, booking: rootBooking },
            { bookingId: kitchenBooking.id, role: 'kitchen', booking: kitchenBooking },
            { bookingId: activityBooking.id, role: 'activity', booking: activityBooking }
        ]
    });

    return { ctx, rootBlock, kitchenBlock, activityBlock };
}

function applyTimelineBanquetPreviewWithPrimaryActivityAndKitchenMarker(options = {}) {
    const ctx = createTimelineBanquetMarkerHarness();
    const lineGrid = ctx.document.querySelector('.line-grid');
    const activityBooking = {
        id: 'BK-ACTIVITY-PRIMARY',
        category: 'animation',
        date: '2099-06-18',
        time: '14:00',
        duration: 60,
        room: 'Room A',
        lineId: 'room-a',
        line_id: 'room-a',
        label: 'Primary animator',
        timelineProjection: {
            timelineView: 'rooms',
            view: 'rooms',
            resourceType: 'room',
            resourceId: 'Room A',
            resourceName: 'Room A',
            lineId: 'room-a',
            sourceLineId: 'room-a',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const secondaryActivityBooking = options.secondaryActivity ? {
        id: 'BK-ACTIVITY-SECONDARY',
        category: 'show',
        date: '2099-06-18',
        time: '14:00',
        duration: 30,
        room: 'Room A',
        lineId: 'room-a',
        line_id: 'room-a',
        label: 'Secondary animator',
        timelineProjection: {
            timelineView: 'rooms',
            view: 'rooms',
            resourceType: 'room',
            resourceId: 'Room A',
            resourceName: 'Room A',
            lineId: 'room-a',
            sourceLineId: 'room-a',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    } : null;
    const kitchenBooking = {
        id: 'BK-KITCHEN-MARKER',
        category: 'banquet',
        date: '2099-06-18',
        time: '14:00',
        duration: 60,
        room: 'Room A',
        lineId: 'banquet-service',
        line_id: 'banquet-service',
        label: 'Kitchen marker',
        extraData: {
            bookingPackage: {
                menuPositions: [
                    { id: 'menu-1', title: 'Pizza', servingTime: '14:00' }
                ],
                serviceEvents: []
            }
        },
        timelineProjection: {
            timelineView: 'rooms',
            view: 'rooms',
            resourceType: 'room',
            resourceId: 'Room A',
            resourceName: 'Room A',
            lineId: 'banquet-service',
            sourceLineId: 'banquet-service',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: false,
            displaySurface: 'service_marker',
            hiddenReason: null
        }
    };
    const activityBlock = ctx.document.createElement('div');
    activityBlock.className = 'booking-block animation is-room-timeline-activity-card';
    activityBlock.dataset.bookingId = activityBooking.id;
    const activityMinutes = ctx.timeToMinutes(activityBooking.time);
    const startMinutes = ctx.getTimeRange().start * 60;
    activityBlock.style.left = `${ctx.timelineMinutesToPixels(activityMinutes - startMinutes)}px`;
    activityBlock.style.width = `${ctx.timelineDurationWidth(activityBooking.duration)}px`;
    activityBlock.innerHTML = '<div class="user-letter">A</div><div class="title">Primary animator</div><div class="subtitle">14:00</div>';
    let secondaryActivityBlock = null;
    if (secondaryActivityBooking) {
        secondaryActivityBlock = ctx.document.createElement('div');
        secondaryActivityBlock.className = 'booking-block show is-room-timeline-activity-card';
        secondaryActivityBlock.dataset.bookingId = secondaryActivityBooking.id;
        const secondaryActivityMinutes = ctx.timeToMinutes(secondaryActivityBooking.time);
        secondaryActivityBlock.style.left = `${ctx.timelineMinutesToPixels(secondaryActivityMinutes - startMinutes)}px`;
        secondaryActivityBlock.style.width = `${ctx.timelineDurationWidth(secondaryActivityBooking.duration)}px`;
        secondaryActivityBlock.innerHTML = '<div class="user-letter">S</div><div class="title">Secondary animator</div><div class="subtitle">14:00</div>';
    }
    const kitchenBlock = ctx.document.createElement('div');
    kitchenBlock.className = 'booking-block banquet-block';
    kitchenBlock.dataset.bookingId = kitchenBooking.id;
    kitchenBlock.innerHTML = '<div class="user-letter">K</div><div class="title">Kitchen marker</div><div class="subtitle">14:00</div>';
    lineGrid.append(...[activityBlock, secondaryActivityBlock, kitchenBlock].filter(Boolean));

    ctx.__cachedBookings = [activityBooking, secondaryActivityBooking, kitchenBooking].filter(Boolean);
    ctx.applyTimelineBanquetPreview({
        success: true,
        group: {
            id: 'GRP-ACTIVITY-FIRST',
            room: 'Room A',
            date: '2099-06-18',
            primaryBookingId: activityBooking.id
        },
        bookings: {
            primary: activityBooking,
            kitchen: [kitchenBooking],
            activities: secondaryActivityBooking ? [secondaryActivityBooking] : [],
            services: [],
            manual: []
        },
        members: [
            { bookingId: activityBooking.id, role: 'primary', isPrimary: true, booking: activityBooking },
            ...(secondaryActivityBooking ? [{ bookingId: secondaryActivityBooking.id, role: 'activity', booking: secondaryActivityBooking }] : []),
            { bookingId: kitchenBooking.id, role: 'kitchen', booking: kitchenBooking }
        ]
    });

    return { ctx, activityBlock, secondaryActivityBlock, kitchenBlock };
}

test('timeline resource migration creates durable multi-cabinet resources', () => {
    const sql = read('db/migrations/239_timeline_resource_multi_cabinet_engine.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS timeline_resources/);
    assert.match(sql, /business_context VARCHAR\(64\) NOT NULL DEFAULT 'event_genix'/);
    assert.match(sql, /resource_id VARCHAR\(100\) NOT NULL/);
    assert.match(sql, /type VARCHAR\(32\) NOT NULL DEFAULT 'cabinet'/);
    assert.match(sql, /UNIQUE \(business_context, resource_id\)/);
    assert.match(sql, /idx_timeline_resources_business_type_active/);
    assert.match(sql, /'edu-cabinet-1', 'cabinet', 'Кабінет 1'/);
    assert.match(sql, /'maysternya_doli', 'md-consult-room', 'specialist', 'Олександр'/);
});

test('timeline business-context constraints stay dynamic for new cabinets', () => {
    const oldSql = read('db/migrations/190_maysternya_doli_timeline_context.sql');
    const repairSql = read('db/migrations/242_timeline_business_context_dynamic_checks.sql');

    assert.match(oldSql, /bookings_business_context_check[\s\S]*event_genix[\s\S]*maysternya_doli/);
    assert.match(repairSql, /DROP CONSTRAINT IF EXISTS bookings_business_context_check/);
    assert.match(repairSql, /DROP CONSTRAINT IF EXISTS lines_by_date_business_context_check/);
    assert.match(repairSql, /bookings_business_context_format_check/);
    assert.match(repairSql, /lines_by_date_business_context_format_check/);
    assert.match(repairSql, /business_context ~ '\^\[a-z0-9_:-\]\{1,64\}\$'/);
    assert.doesNotMatch(repairSql, /CHECK \(business_context IN \('event_genix', 'maysternya_doli'\)\)/);
});

test('timeline resources service owns mode-to-resource contract and availability', () => {
    const service = read('services/timelineResources.js');
    assert.match(service, /RESOURCE_TYPE_BY_DISPLAY_MODE[\s\S]*simple: 'specialist'/);
    assert.match(service, /RESOURCE_TYPE_BY_DISPLAY_MODE[\s\S]*specialist: 'specialist'/);
    assert.match(service, /RESOURCE_TYPE_BY_DISPLAY_MODE[\s\S]*education: 'cabinet'/);
    assert.match(service, /TIMELINE_DISPLAY_MODES = new Set\(\['disabled', 'simple', 'specialist', 'park', 'education'\]\)/);
    assert.match(service, /function normalizeTimelineDisplaySettings/);
    assert.match(service, /enabledModules/);
    assert.match(service, /timelineFeatures/);
    assert.match(service, /bookingPolicy/);
    assert.match(service, /resourceModel/);
    assert.match(service, /function resourceTypeForDisplayMode/);
    assert.match(service, /function timelineResourceAvailability/);
    assert.match(service, /async function findTimelineResourceByName/);
    assert.match(service, /function timelineResourceRoomMatchValues/);
    assert.match(service, /function timelineResourceMatchesRoomValue/);
    assert.match(service, /b\.line_id = ANY\(\$3::text\[\]\) OR b\.room = ANY\(\$4::text\[\]\)/);
    assert.doesNotMatch(service, /b\.resource_id = ANY/);
    assert.match(service, /requestedCapacity/);
    assert.match(service, /capacityAvailable/);
    assert.match(service, /overCapacity/);
    assert.match(service, /resourceBlock/);
});

test('timeline resource lookup can recover stale booking line ids by visible resource name', async () => {
    const queries = [];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            return {
                rows: [{
                    id: 12,
                    business_context: 'event_genix',
                    resource_id: 'cabinet-a',
                    type: 'cabinet',
                    name: 'Кабінет A',
                    short_name: 'A',
                    color: '#10B981',
                    capacity: 8,
                    equipment: [],
                    is_active: true,
                    sort_order: 10,
                    metadata: {}
                }]
            };
        }
    };

    const resource = await findTimelineResourceByName(fakeDb, 'event_genix', 'Кабінет A', { type: 'cabinet' });

    assert.equal(resource.resourceId, 'cabinet-a');
    assert.equal(resource.type, 'cabinet');
    assert.match(queries[0].sql, /LOWER\(BTRIM\(name\)\)/);
    assert.deepEqual(queries[0].params, ['event_genix', 'Кабінет A', 'cabinet']);
});

test('timeline resources expose canonical line identity to the frontend', () => {
    const line = resourceToLine({
        businessContext: 'event_genix',
        resourceId: 'cabinet-a',
        type: 'cabinet',
        name: 'Cabinet A',
        shortName: 'A',
        color: '#10B981',
        capacity: 8,
        equipment: ['projector'],
        metadata: { floor: 2 },
        sortOrder: 10
    });

    assert.equal(line.id, 'cabinet-a');
    assert.equal(line.resourceId, 'cabinet-a');
    assert.equal(line.resourceType, 'cabinet');
    assert.equal(line.businessContext, 'event_genix');
    assert.equal(line.source, 'timeline_resource');
    assert.equal(line.resourceSource, 'timeline_resource');
});

test('park timeline keeps legacy animator lines even if resource model is mis-set', () => {
    const normalized = normalizeTimelineDisplaySettings({
        mode: 'park',
        resourceModel: 'animator'
    }, 'event_genix');

    assert.equal(normalized.mode, 'park');
    assert.equal(normalized.resourceModel, 'auto');
    assert.equal(resourceTypeForDisplayMode('park', { resourceModel: 'animator' }), null);
    assert.equal(resourceTypeForDisplayMode('education', { resourceModel: 'cabinet' }), 'cabinet');
});

test('park manual animator lines are not deleted as legacy default lines', () => {
    const bookingService = read('services/booking.js');
    const settings = read('js/settings.js');
    assert.match(bookingService, /l\.line_id IN \('line1', 'line2', 'line1_' \|\| \$1, 'line2_' \|\| \$1\)/);
    assert.doesNotMatch(bookingService, /\^line\[0-9\]/);
    assert.match(settings, /id:\s*`manual_animator_\$\{Date\.now\(\)\}_\$\{dateStr\}`/);
});

test('lines route switches resource-backed modes away from animator sync', () => {
    const route = read('routes/lines.js');
    assert.match(route, /getTimelineDisplaySettings/);
    assert.match(route, /resourceTypeForDisplayMode\(display\.mode, display\)/);
    assert.match(route, /timelineResourceLinesForMode\(pool, businessContext, display\.mode, display\)/);
    assert.match(route, /X-Timeline-Lines-Source', 'timeline_resources'/);
    assert.match(route, /syncTimelineResourcesFromLines\(client, businessContext, resourceType, lines\)/);
    assert.match(read('services/timelineResources.js'), /if \(normalizedMode === 'park'\) return null/);
});

test('room-first timeline keeps park source of truth but projects rows by room', () => {
    const linesRoute = read('routes/lines.js');
    const bookingsRoute = read('routes/bookings.js');
    const api = read('js/api.js');
    const timeline = read('js/timeline.js');
    const timelineResourceIdentity = read('js/timeline-resource-identity.js');
    const timelineCss = read('css/timeline.css');
    const ui = read('js/ui.js');
    const timelineContext = read('js/timeline-context.js');
    const booking = read('js/booking.js');
    const resources = read('services/timelineResources.js');
    const html = read('index.html');
    const migration = read('db/migrations/263_event_genix_room_timeline_resources.sql');

    assert.match(linesRoute, /normalizeTimelineView\(req\.query\.timelineView\)/);
    assert.match(linesRoute, /roomTimelineLinesForContext\(businessContext\)/);
    assert.match(linesRoute, /fallbackRoomLines\(businessContext\)/);
    assert.match(linesRoute, /ROOM_TIMELINE_TAKEAWAY_LINE/);
    assert.match(linesRoute, /withTakeawayRoomLine\(resources\.map\(resourceToLine\), businessContext\)/);
    assert.match(linesRoute, /id: 'room-takeaway'/);
    assert.match(linesRoute, /id: 'room-quarantine'/);
    assert.match(linesRoute, /assignmentAllowed: false/);
    assert.match(linesRoute, /BANQUET_SERVICE_LINE_ID/);
    assert.match(linesRoute, /String\(row\.line_id \|\| ''\)\.trim\(\) === BANQUET_SERVICE_LINE_ID/);
    assert.match(linesRoute, /!isLegacyRoomTimelineLineRow\(row\)/);
    assert.match(bookingsRoute, /projectBookingsForTimelineView/);
    assert.match(bookingsRoute, /attachRoomTimelineResourceResolution/);
    assert.match(bookingsRoute, /resolveRoomTimelineResourceIdentity/);
    assert.match(bookingsRoute, /function bookingMatchesBanquetServiceLine/);
    assert.match(bookingsRoute, /function isBanquetServiceTimelineBooking/);
    assert.match(bookingsRoute, /function isBanquetServiceRootBooking/);
    assert.match(bookingsRoute, /function isRoomProjectableBanquetServiceRootBooking/);
    assert.match(bookingsRoute, /function buildBookingTimelineProjection/);
    assert.match(bookingsRoute, /BANQUET_SERVICE_LINE_ID/);
    assert.match(bookingsRoute, /return bookings\.map\(booking => projectBookingForTimelineView\(booking, timelineView\)\)/);
    assert.match(bookingsRoute, /hiddenReason = 'banquet_service_hidden_from_animator'/);
    assert.match(bookingsRoute, /timelineView !== 'rooms'/);
    assert.match(bookingsRoute, /\.filter\(booking => !isBanquetServiceRootBooking\(booking\) \|\| isRoomProjectableBanquetServiceRootBooking\(booking\)\)/);
    assert.match(bookingsRoute, /!String\(booking\.linkedTo \|\| ''\)\.trim\(\) && isRealRoom\(booking\.room\)/);
    assert.match(bookingsRoute, /isRoomConflictBlockingRoom/);
    assert.match(bookingsRoute, /if \(!isRoomConflictBlockingRoom\(candidate\.room\)\) return null/);
    assert.match(api, /function timelineApiUrlWithView/);
    assert.match(api, /timelineView=\$\{encodeURIComponent\(String\(view\)\)\}/);
    assert.match(timeline, /TIMELINE_VIEW_ROOMS = 'rooms'/);
    assert.match(timeline, /function shouldRenderBookingVisualLink/);
    assert.match(timeline, /relationType === SHARED_ROOM_LINK_RELATION_TYPE && !isRoomTimelineView\(\)/);
    assert.match(timeline, /function clearBanquetLinkLayer\(\)[\s\S]*document\.getElementById\('timelineBanquetLinkLayer'\)[\s\S]*layer\.innerHTML = ''/);
    assert.match(timeline, /function renderBanquetLinksOverlay\(\) \{\s*if \(isRoomTimelineView\(\)\) \{\s*clearBanquetLinkLayer\(\);\s*return;\s*\}/);
    assert.match(timeline, /if \(!shouldRenderBookingVisualLink\(link\)\) return/);
    assert.match(timeline, /const targetBlock = blockById\.get\(targetId\)/);
    assert.match(timeline, /if \(!targetBlock\) return/);
    assert.match(timelineCss, /body\.timeline-view-rooms \.timeline-banquet-link-layer\s*\{\s*display: none;\s*\}/);
    assert.match(timeline, /function defaultTimelineViewMode\(\)/);
    assert.match(timeline, /presentation\?\.\(\)\?\.defaultTimelineView/);
    assert.match(timeline, /TIMELINE_VIEW_USER_CHOICE_VERSION/);
    assert.match(timeline, /function normalizeStoredTimelineViewMode\(value\)/);
    assert.match(timeline, /const requested = urlView \|\| storedView \|\| defaultView/);
    assert.match(timeline, /localStorage\.removeItem\(timelineViewStorageKey\(\)\)/);
    assert.doesNotMatch(timeline, /function roomLoadBookingMinutes/);
    assert.doesNotMatch(timeline, /roomLoadPanel/);
    assert.match(timeline, /TIMELINE_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(timeline, /function isParkAnimatorTimelineView/);
    assert.match(timeline, /function isTimelineBanquetServicePseudoLine/);
    assert.match(timeline, /function isTimelineBanquetServiceBooking/);
    assert.match(timelineResourceIdentity, /function timelineCanonicalProjectionForCurrentView/);
    assert.match(timelineResourceIdentity, /function timelineBookingRenderHiddenReason/);
    assert.match(timeline, /\.filter\(line => !isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)\)/);
    assert.match(timeline, /\.filter\(booking => !booking\.timelineRenderHiddenReason\)/);
    assert.match(ui, /function getTimelineExportLineBookings/);
    assert.match(ui, /timelineBookingsForLine\(bookings,\s*line\)/);
    assert.match(ui, /normalizeTimelineExportBookings/);
    assert.match(ui, /normalizeTimelineExportLines/);
    assert.match(ui, /getTimelineExportLineBookings\(dd\.bookings,\s*line\)/);
    assert.doesNotMatch(ui, /String\(b\.lineId \|\| ''\) === String\(line\.id \|\| ''\)/);
    assert.match(timelineContext, /roomTimelineEnabled/);
    assert.match(timelineContext, /defaultTimelineView/);
    assert.match(resources, /TIMELINE_VIEW_MODES/);
    assert.match(resources, /normalizeDefaultTimelineView/);
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park' }, 'event_genix').defaultTimelineView, 'rooms');
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park', defaultTimelineView: 'animators' }, 'event_genix').defaultTimelineView, 'animators');
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park', defaultTimelineView: 'rooms' }, 'event_genix').defaultTimelineView, 'rooms');
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park', roomTimelineEnabled: false }, 'event_genix').defaultTimelineView, 'animators');
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park' }, 'maysternya_doli').defaultTimelineView, 'animators');
    assert.match(timeline, /assignmentMode = isRoomTimelineView\(\) \? 'room' : 'line'/);
    assert.match(booking, /ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(booking, /BOOKING_TAKEAWAY_ROOM_VALUE = 'На виніс'/);
    assert.match(booking, /takeawayOption\.dataset\.serviceRoom = 'takeaway'/);
    assert.match(booking, /bookingPrimaryAnimatorSelect/);
    assert.match(booking, /prefillRoomFirstCustomerFromRoomLine/);
    assert.match(booking, /shouldEditBookingInAnimatorView/);
    assert.match(booking, /openAnimationBookingInAnimatorView/);
    assert.match(booking, /openRoomBookingAnimationBridge/);
    assert.match(html, /id="periodSelector"[^>]*data-schedule-view-mode-selector/);
    assert.match(html, /data-schedule-view-mode="day"/);
    assert.match(html, /data-schedule-view-mode="week"/);
    assert.doesNotMatch(html, /id="periodSelector"[\s\S]*data-schedule-view-mode="rooms"/);
    assert.doesNotMatch(html, /data-timeline-type-selector/);
    assert.doesNotMatch(html, /id="timelineTypeSelector"/);
    assert.doesNotMatch(html, /timeline-visible-type-switch/);
    assert.doesNotMatch(html, /id="timelineHolidaysToggle"[^>]*data-timeline-holidays-toggle/);
    assert.match(html, /<option value="rooms" selected>Кімнати<\/option>/);
    assert.match(html, /id="settingsTimelineRoomFirstEnabled"/);
    assert.match(html, /id="settingsTimelineDefaultView"/);
    assert.match(migration, /MIGRATION_KIND: data-fix/);
    assert.match(migration, /'room-marvel', 'room', 'Марвел'/);
});

test('operational room catalog no longer uses ALL_ROOMS or static HTML options', () => {
    const migration = read('db/migrations/263_event_genix_room_timeline_resources.sql');
    const html = read('index.html');
    const bookingRoutes = read('routes/bookings.js');
    const linesRoutes = read('routes/lines.js');
    const settingsRoutes = read('routes/settings.js');
    const seededRoomNames = Array.from(
        migration.matchAll(/\('event_genix', 'room-[^']+', 'room', '([^']+)'/g),
        match => match[1]
    );

    assert.ok(seededRoomNames.length >= 10, 'room timeline resource seed must contain the operational room catalog');
    assert.doesNotMatch(bookingRoutes, /\bALL_ROOMS\b/);
    assert.doesNotMatch(linesRoutes, /\bALL_ROOMS\b/);
    assert.doesNotMatch(settingsRoutes, /\bALL_ROOMS\b/);
    assert.match(html, /id="roomSelect"[^>]*data-room-catalog="timeline_resources"/);
    assert.doesNotMatch(html, /<option value="Марвел">/);
    assert.doesNotMatch(html, /<option value="Інше">/);
});

test('room resource id schema migration is additive and stays outside db startup surface', () => {
    const migration = read('db/migrations/296_room_resource_id_schema.sql');
    const migrationSql = migration
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');
    const dbIndex = read('db/index.js');

    assert.match(migration, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);

    for (const table of ['bookings', 'banquet_groups', 'booking_templates', 'recurring_templates']) {
        assert.match(
            migration,
            new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS room_resource_id VARCHAR\\(100\\)`, 'i')
        );
        assert.match(
            migration,
            new RegExp(`${table}_room_resource_id_not_blank[\\s\\S]*CHECK \\(room_resource_id IS NULL OR BTRIM\\(room_resource_id\\) <> ''\\)`, 'i')
        );
    }

    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_bookings_room_resource_active_v296[\s\S]*ON bookings \(business_context, date, room_resource_id\)[\s\S]*status[\s\S]*<> 'cancelled'/i);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_banquet_groups_room_resource_active_v296[\s\S]*ON banquet_groups \(business_context, date, room_resource_id\)[\s\S]*status[\s\S]*<> 'cancelled'/i);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_booking_templates_room_resource_v296[\s\S]*ON booking_templates \(room_resource_id\)/i);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_recurring_templates_room_resource_active_v296[\s\S]*ON recurring_templates \(room_resource_id, is_active\)/i);
    assert.match(migration, /Validated by backend because templates do not currently carry business_context/i);
    assert.match(migration, /Validated by backend because recurring templates do not currently carry business_context/i);

    assert.doesNotMatch(migrationSql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(migrationSql, /\bREFERENCES\s+timeline_resources\b/i);
    assert.doesNotMatch(migrationSql, /\bALTER TABLE\s+\w+[^;]*DROP\b/i);
    assert.doesNotMatch(dbIndex, /room_resource_id/);
});

test('durable room identity is carried by every booking write surface', () => {
    const bookingFrontend = read('js/booking.js');
    const bookingForm = read('js/booking-form.js');
    const bookingRoutes = read('routes/bookings.js');
    const banquetService = read('services/banquetGroups.js');
    const templateRoutes = read('routes/booking-templates.js');
    const recurringRoutes = read('routes/recurring.js');
    const recurringService = read('services/recurring.js');
    const bookingService = read('services/booking.js');

    assert.match(bookingFrontend, /roomResourceId:\s*roomIdentity\.roomResourceId/);
    assert.match(bookingFrontend, /roomResourceId:\s*formData\.roomResourceId \|\| null/);
    assert.match(bookingFrontend, /roomResourceId:\s*booking\.roomResourceId \|\| booking\.room_resource_id \|\| null/);
    assert.match(bookingForm, /roomResourceId:\s*roomSel\?\.selectedOptions/);

    assert.match(bookingRoutes, /validateBookingRoomResourceForWrite/);
    assert.match(bookingRoutes, /canonicalizeBookingRoomResource/);
    assert.match(bookingRoutes, /INSERT INTO bookings[\s\S]*room_resource_id/);
    assert.match(bookingRoutes, /UPDATE bookings SET[\s\S]*room_resource_id=/);
    assert.match(bookingRoutes, /\['roomResourceId', 'room_resource_id'\]/);

    assert.match(banquetService, /canonicalizeBanquetBookingRoom/);
    assert.match(banquetService, /INSERT INTO banquet_groups[\s\S]*room_resource_id/);
    assert.match(banquetService, /INSERT INTO bookings[\s\S]*room_resource_id/);
    assert.match(banquetService, /UPDATE bookings SET[\s\S]*room_resource_id=/);

    assert.match(templateRoutes, /INSERT INTO booking_templates[\s\S]*room_resource_id/);
    assert.match(templateRoutes, /UPDATE booking_templates SET[\s\S]*room_resource_id =/);
    assert.match(recurringRoutes, /INSERT INTO recurring_templates[\s\S]*room_resource_id/);
    assert.match(recurringRoutes, /UPDATE recurring_templates SET[\s\S]*room_resource_id =/);
    assert.match(recurringService, /canonicalizeBookingRoomResource\(pool, DEFAULT_TIMELINE_CONTEXT, template, \{\s*required: true\s*\}\)/);
    assert.match(recurringService, /INSERT INTO bookings[\s\S]*room_resource_id/);
    assert.match(bookingService, /roomResourceId:\s*row\.room_resource_id \|\| null/);
});

test('booking room selector and settings manager use timeline room resources as source of truth', () => {
    const html = read('index.html');
    const booking = read('js/booking.js');
    const settings = read('js/settings.js');
    const api = read('js/api.js');
    const route = read('routes/timeline-resources.js');

    assert.match(html, /id="roomSelect"[^>]*data-room-catalog="timeline_resources"/);
    assert.match(booking, /function renderBookingRoomCatalogOptions/);
    assert.match(booking, /apiGetTimelineResources\('room', \{ includeInactive: true \}\)/);
    assert.match(booking, /option\.dataset\.resourceId/);
    assert.match(booking, /currentBookingRoom: true/);
    assert.match(booking, /current\.disabled = options\.currentRoomDisabled !== false/);
    assert.match(booking, /includeCurrentRoom: Boolean\(selectedRoom && AppState\.editingBookingId\)/);
    assert.match(settings, /normalized\.mode === 'park'\) return normalized\.roomTimelineEnabled \? 'room' : null;/);
    assert.match(settings, /if \(type === 'room'\)/);
    assert.match(settings, /normalizeTimelineResourceColorInput/);
    assert.match(settings, /RESOURCE_HAS_FUTURE_BOOKINGS/);
    assert.match(api, /confirmFutureBookings/);
    assert.match(route, /countFutureActiveBookingsForTimelineResource/);
    assert.match(route, /RESOURCE_HAS_FUTURE_BOOKINGS/);
});

test('timeline resource matching prefers canonical projection over legacy fallback collisions', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: false });
    const animatorLineNamedAsRoom = {
        id: 'room-a',
        name: 'Room A',
        resourceId: 'Room A',
        resourceType: 'animator'
    };
    const canonicalBooking = {
        id: 'BK-CANONICAL',
        lineId: 'stale-line',
        resourceId: 'Room A',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: 'line-real',
            lineId: 'line-real',
            resourceType: 'animator',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };

    assert.deepEqual([...hooks.timelineBookingMatchKeys(canonicalBooking)].sort(), ['line-real']);
    assert.equal(hooks.timelineBookingsForLine([canonicalBooking], animatorLineNamedAsRoom).length, 0);
});

test('timeline resource matching attaches linked animator rows to their own canonical line', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: false });
    const parentLine = {
        id: 'line-main',
        name: 'Main Animator',
        resourceId: 'line-main',
        resourceType: 'animator'
    };
    const secondLine = {
        id: 'line-second',
        name: 'Second Animator',
        resourceId: 'line-second',
        resourceType: 'animator'
    };
    const linkedBooking = {
        id: 'BK-LINKED-SECOND',
        linkedTo: 'BK-MAIN',
        lineId: 'line-main',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: 'line-second',
            lineId: 'line-second',
            resourceType: 'animator',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: false,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };

    assert.deepEqual([...hooks.timelineBookingMatchKeys(linkedBooking)].sort(), ['line-second']);
    assert.equal(hooks.timelineBookingsForLine([linkedBooking], secondLine).length, 1);
    assert.equal(hooks.timelineBookingsForLine([linkedBooking], parentLine).length, 0);
    assert.equal(hooks.timelineBookingRenderHiddenReason(linkedBooking), '');
});

test('timeline resource matching keeps legacy room fallback only when projection is absent', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const roomLine = {
        id: 'room-a',
        name: 'Room A',
        resourceId: 'room-a',
        resourceType: 'room'
    };
    const legacyBooking = {
        id: 'BK-LEGACY-ROOM',
        lineId: 'legacy-line',
        resourceType: 'room',
        room: 'Room A'
    };

    assert.equal(hooks.timelineBookingsForLine([legacyBooking], roomLine).length, 1);
});

test('timeline resource matching ignores stale line ids when room projection is canonical', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const roomLine = {
        id: 'room-a',
        name: 'Room A',
        resourceId: 'room-a',
        resourceType: 'room'
    };
    const staleLine = {
        id: 'line-stale',
        name: 'Stale animator',
        resourceId: 'line-stale',
        resourceType: 'room'
    };
    const canonicalRoomBooking = {
        id: 'BK-ROOM-CANONICAL',
        lineId: 'line-stale',
        room: 'Wrong Room',
        timelineProjection: {
            timelineView: 'rooms',
            resourceId: 'Room A',
            lineId: 'line-stale',
            resourceType: 'room',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };

    assert.deepEqual([...hooks.timelineBookingMatchKeys(canonicalRoomBooking)].sort(), ['room a']);
    assert.equal(hooks.timelineBookingsForLine([canonicalRoomBooking], roomLine).length, 1);
    assert.equal(hooks.timelineBookingsForLine([canonicalRoomBooking], staleLine).length, 0);
});

test('banquet animation matches room and animator lines across view switches and reloads', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const roomLine = {
        id: 'room-a',
        name: 'Room A',
        resourceId: 'Room A',
        resourceType: 'room'
    };
    const animatorLine = {
        id: 'animator-anna',
        name: 'Animator Anna',
        resourceId: 'animator-anna',
        resourceType: 'animator'
    };
    const roomAnimation = {
        id: 'BK-ACTIVITY-PRIMARY',
        category: 'animation',
        lineId: 'animator-anna',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'rooms',
            view: 'rooms',
            resourceType: 'room',
            resourceId: 'Room A',
            resourceName: 'Room A',
            lineId: 'room-a',
            sourceLineId: 'animator-anna',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const roomKitchen = {
        id: 'BK-KITCHEN-MARKER',
        category: 'banquet',
        lineId: 'banquet-service',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'rooms',
            view: 'rooms',
            resourceType: 'room',
            resourceId: 'Room A',
            resourceName: 'Room A',
            lineId: 'banquet-service',
            sourceLineId: 'banquet-service',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: false,
            displaySurface: 'service_marker',
            hiddenReason: null
        }
    };
    const animatorAnimation = {
        ...roomAnimation,
        timelineProjection: {
            timelineView: 'animators',
            view: 'animators',
            resourceType: 'animator',
            resourceId: 'animator-anna',
            resourceName: 'Animator Anna',
            lineId: 'animator-anna',
            sourceLineId: 'animator-anna',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const animatorKitchen = {
        ...roomKitchen,
        timelineProjection: {
            timelineView: 'animators',
            view: 'animators',
            resourceType: 'service',
            resourceId: 'banquet-service',
            resourceName: 'Banquet service',
            lineId: 'banquet-service',
            sourceLineId: 'banquet-service',
            visibleInRoomTimeline: true,
            visibleInAnimatorTimeline: false,
            displaySurface: 'hidden',
            hiddenReason: 'banquet_service_hidden_from_animator'
        }
    };

    let normalizedRoomBookings = hooks.normalizeTimelineBookingsForContext([roomAnimation, roomKitchen]);
    assert.deepEqual(normalizedRoomBookings.map(booking => booking.id).sort(), ['BK-ACTIVITY-PRIMARY', 'BK-KITCHEN-MARKER']);
    assert.deepEqual([...hooks.timelineBookingMatchKeys(normalizedRoomBookings.find(booking => booking.id === 'BK-ACTIVITY-PRIMARY'))].sort(), ['room a']);
    assert.equal(hooks.timelineBookingsForLine(normalizedRoomBookings, roomLine).filter(booking => booking.id === 'BK-ACTIVITY-PRIMARY').length, 1);
    assert.equal(hooks.timelineBookingsForLine(normalizedRoomBookings, animatorLine).length, 0);

    normalizedRoomBookings = hooks.normalizeTimelineBookingsForContext([roomAnimation, roomKitchen]);
    assert.equal(hooks.timelineBookingsForLine(normalizedRoomBookings, roomLine).filter(booking => booking.id === 'BK-ACTIVITY-PRIMARY').length, 1);

    hooks.setRoomView(false);
    const normalizedAnimatorBookings = hooks.normalizeTimelineBookingsForContext([animatorAnimation, animatorKitchen]);
    assert.deepEqual(normalizedAnimatorBookings.map(booking => booking.id), ['BK-ACTIVITY-PRIMARY']);
    assert.deepEqual([...hooks.timelineBookingMatchKeys(normalizedAnimatorBookings[0])].sort(), ['animator-anna']);
    assert.equal(hooks.timelineBookingsForLine(normalizedAnimatorBookings, animatorLine).length, 1);
    assert.equal(hooks.timelineBookingsForLine(normalizedAnimatorBookings, roomLine).length, 0);

    hooks.setRoomView(true);
    const normalizedReturnedRoomBookings = hooks.normalizeTimelineBookingsForContext([roomAnimation, roomKitchen]);
    const returnedRoomActivityMatches = hooks.timelineBookingsForLine(normalizedReturnedRoomBookings, roomLine)
        .filter(booking => booking.id === 'BK-ACTIVITY-PRIMARY');
    assert.equal(normalizedReturnedRoomBookings.filter(booking => booking.id === 'BK-ACTIVITY-PRIMARY').length, 1);
    assert.equal(returnedRoomActivityMatches.length, 1);
});

test('timeline resource matching exposes deterministic hidden reasons for canonical hidden bookings', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: false });
    const kitchen = {
        id: 'BK-KITCHEN-HIDDEN',
        lineId: 'banquet-service',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: 'banquet-service',
            lineId: 'banquet-service',
            resourceType: 'service',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true,
            displaySurface: 'hidden',
            hiddenReason: 'banquet_service_hidden_from_animator'
        }
    };
    const missingResource = {
        id: 'BK-MISSING-RESOURCE',
        lineId: 'stale-line',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: null,
            lineId: null,
            resourceType: 'unknown',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true,
            displaySurface: 'hidden',
            hiddenReason: 'missing_animator_resource'
        }
    };
    const staleLine = { id: 'stale-line', name: 'Room A', resourceId: 'stale-line', resourceType: 'animator' };

    assert.equal(hooks.timelineBookingRenderHiddenReason(kitchen), 'banquet_service_hidden_from_animator');
    assert.equal(hooks.normalizeTimelineBookingsForContext([kitchen]).length, 0);
    assert.equal(hooks.timelineBookingRenderHiddenReason(missingResource), 'missing_animator_resource');
    assert.equal(hooks.timelineBookingsForLine([missingResource], staleLine).length, 0);
});

test('timeline diagnostics preserve hidden and unmatched booking reasons without forcing render', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: false });
    hooks.resetTimelineBookingDiagnostics({ test: 'timeline-diagnostics' });
    const hidden = {
        id: 'BK-HIDDEN-DIAG',
        lineId: 'stale-line',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: null,
            lineId: null,
            resourceType: 'unknown',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true,
            displaySurface: 'hidden',
            hiddenReason: 'missing_animator_resource'
        }
    };
    const validUnmatched = {
        id: 'BK-VALID-UNMATCHED',
        lineId: 'line-real',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: 'line-real',
            lineId: 'line-real',
            resourceType: 'animator',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const staleLine = { id: 'line-stale', name: 'Stale Animator', resourceId: 'line-stale', resourceType: 'animator' };

    assert.deepEqual(hooks.normalizeTimelineBookingsForContext([hidden]), []);
    const store = hooks.timelineBookingDiagnosticsStore();
    assert.equal(store.hidden.length, 1);
    assert.equal(store.hidden[0].id, 'BK-HIDDEN-DIAG');
    assert.equal(store.hidden[0].hiddenReason, 'missing_animator_resource');
    assert.equal(store.hidden[0].reason, 'missing_animator_resource');

    assert.equal(hooks.timelineBookingsForLine([validUnmatched], staleLine).length, 0);
    const diagnostic = hooks.timelineBookingMatchDiagnostic(validUnmatched, [staleLine]);
    assert.equal(diagnostic.reason, 'unmatched_line_keys');
    assert.deepEqual(Array.from(diagnostic.bookingKeys), ['line-real']);
    assert.deepEqual(Array.from(diagnostic.matchedLineIds), []);
    assert.equal(diagnostic.lineDiagnostics[0].lineId, 'line-stale');
});

test('timeline diagnostics identify wrong-view and visible missing-line projections', () => {
    const animatorHooks = createTimelineResourceMatchingHarness({ roomView: false });
    const wrongView = {
        id: 'BK-WRONG-VIEW',
        room: 'Room A',
        timelineProjection: {
            timelineView: 'rooms',
            resourceId: 'Room A',
            lineId: 'line-a',
            resourceType: 'room',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const wrongViewDiagnostic = animatorHooks.timelineProjectionDiagnosticReason(wrongView);
    assert.equal(wrongViewDiagnostic.reason, 'wrong_timeline_view');
    assert.equal(wrongViewDiagnostic.currentView, 'animators');
    assert.equal(wrongViewDiagnostic.projectionView, 'rooms');

    const missingLine = {
        id: 'BK-MISSING-LINE-VISIBLE',
        timelineProjection: {
            timelineView: 'animators',
            resourceId: null,
            lineId: null,
            resourceType: 'animator',
            visibleInAnimatorTimeline: true,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            hiddenReason: null
        }
    };
    const missingLineDiagnostic = animatorHooks.timelineProjectionDiagnosticReason(missingLine);
    assert.equal(missingLineDiagnostic.reason, 'missing_animator_resource');
    assert.equal(missingLineDiagnostic.category, 'missing_line');
});

test('room timeline rows cannot be saved through legacy animator lines endpoint', () => {
    const linesRoute = read('routes/lines.js');
    const timeline = read('js/timeline.js');
    const api = read('js/api.js');
    const settings = read('js/settings.js');

    assert.match(linesRoute, /function isRoomTimelineLinePayload/);
    assert.match(linesRoute, /function lineValueStartsWithRoomId/);
    assert.match(linesRoute, /resourceType === 'room'/);
    assert.match(linesRoute, /rooms_virtual/);
    assert.match(linesRoute, /rooms_fallback/);
    assert.match(linesRoute, /source === 'timeline_resource' && resourceType === 'room'/);
    assert.match(linesRoute, /businessContext === DEFAULT_TIMELINE_CONTEXT && display\.mode === 'park' && lines\.some\(isRoomTimelineLinePayload\)/);
    assert.match(linesRoute, /res\.status\(409\)\.json/);
    assert.match(linesRoute, /room_timeline_legacy_line_save_blocked/);
    assert.match(linesRoute, /Room timeline rows cannot be saved through legacy animator lines endpoint/);

    assert.match(timeline, /Blocked legacy line save from room timeline view/);
    assert.match(timeline, /isViewer\(\) \|\| isRoomTimelineView\(\)/);
    assert.match(timeline, /if \(isRoomTimelineView\(\)\) return;[\s\S]*editLineModal\(line\.id\)/);
    assert.ok(api.includes('window.TimelineView?.isRooms?.()'));
    assert.ok(api.includes('timelineApiUrlWithView(`/lines/${date}`)'));
    assert.match(settings, /function isRoomTimelineLineEditingBlocked/);
    assert.match(settings, /async function addNewLine\(\)[\s\S]*isRoomTimelineLineEditingBlocked\(\)/);
    assert.match(settings, /async function editLineModal\(lineId\)[\s\S]*isRoomTimelineLineEditingBlocked\(\)/);
    assert.match(settings, /async function handleEditLine\(e\)[\s\S]*isRoomTimelineLineEditingBlocked\(\)/);
    assert.match(settings, /async function deleteLine\(\)[\s\S]*isRoomTimelineLineEditingBlocked\(\)/);
});

test('animator timeline booking blocks show room meta without room timeline duplication', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /const bookingRoomName = String\(renderBooking\.room \|\| ''\)\.trim\(\)/);
    assert.match(timeline, /const shouldShowBookingRoomMeta = Boolean\(bookingRoomName\)[\s\S]*&& isParkAnimatorTimelineView\(\)[\s\S]*&& !isMaysternyaSlotClosed[\s\S]*&& !isEducationLessonBlock[\s\S]*&& renderBooking\.category !== 'graduation'/);
    assert.match(timeline, /block\.classList\.add\('has-booking-room-meta'\)/);
    assert.match(timeline, /block\.dataset\.bookingRoom = bookingRoomName/);
    assert.ok(timeline.includes("(!isRoomTimelineView() && !shouldShowBookingRoomMeta ? bookingRoomName : '')"));
    assert.match(timeline, /class="booking-block-room" title="\$\{escapeHtml\(bookingRoomName\)\}"/);
    assert.match(timeline, /<div class="subtitle"><span class="booking-block-time">\$\{escapeHtml\(renderBooking\.time\)\}<\/span>\$\{bookingRoomMeta\}\$\{bookingKidsMeta\}<\/div>/);
    assert.match(css, /\.booking-block \.booking-block-room/);
    assert.match(css, /\.booking-block\.has-booking-room-meta \.subtitle\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*6px;[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.booking-block\.has-booking-room-meta \.booking-block-room\s*\{[\s\S]*margin-left:\s*0;[\s\S]*max-width:\s*min\(96px, calc\(100% - 48px\)\)/);
    assert.match(css, /\.booking-block\.booking-block--short \.timeline-compact-booking-meta\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*4px;[\s\S]*width:\s*calc\(100% - 18px\);[\s\S]*max-width:\s*calc\(100% - 18px\)/);
    assert.match(css, /\.booking-block\.booking-block--short\.has-booking-room-meta \.timeline-compact-booking-meta \.booking-block-room\s*\{[\s\S]*max-width:\s*min\(72px, 100%\)/);
    assert.match(css, /body\.dark-mode \.booking-block \.booking-block-room/);
    assert.match(css, /html\[data-theme="dark"\] \.booking-block \.booking-block-room/);
});

test('polluted room lines are quarantined from park animator timeline reads', () => {
    const linesRoute = read('routes/lines.js');
    const timeline = read('js/timeline.js');

    assert.doesNotMatch(linesRoute, /ROOM_TIMELINE_ROOM_NAMES/);
    assert.match(linesRoute, /function isLegacyRoomTimelineLineRow/);
    assert.match(linesRoute, /lineId\.toLowerCase\(\) === 'room-takeaway'/);
    assert.match(linesRoute, /lineValueStartsWithRoomId\(lineId\)/);
    assert.match(linesRoute, /lineValueStartsWithRoomId\(resourceId\)/);
    assert.match(linesRoute, /const quarantinedRoomRows = result\.rows\.filter\(isLegacyRoomTimelineLineRow\)/);
    assert.match(linesRoute, /const filteredRows = result\.rows\.filter/);
    assert.match(linesRoute, /!isLegacyRoomTimelineLineRow\(row\)/);
    assert.match(linesRoute, /Filtered room timeline rows from animator timeline response/);
    assert.match(linesRoute, /count: quarantinedRoomRows\.length/);
    assert.match(linesRoute, /const lines = filteredRows/);

    assert.match(timeline, /function isTimelineRoomOnlyLine/);
    assert.match(timeline, /function timelineLineValueStartsWithRoomId/);
    assert.match(timeline, /resourceType === 'room'/);
    assert.match(timeline, /rooms_virtual/);
    assert.match(timeline, /rooms_fallback/);
    assert.match(timeline, /!isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)/);
});

test('takeaway room stays visible but does not reserve a physical room slot', async () => {
    assert.equal(isTakeawayRoomValue('На виніс'), true);
    assert.equal(isTakeawayRoomValue('room-takeaway'), true);
    assert.equal(isRoomConflictBlockingRoom('На виніс'), false);
    assert.equal(isRoomConflictBlockingRoom('room-takeaway'), false);
    assert.equal(isRoomConflictBlockingRoom('Монстер Хай'), true);
    assert.equal(isLineConflictBlockingLine('room-takeaway'), false);
    assert.equal(isLineConflictBlockingLine('banquet-service'), false);

    const conflictQueries = [];
    const conflictClient = {
        query: async (sql, params) => {
            conflictQueries.push({ sql, params });
            return { rows: [] };
        }
    };
    const conflict = await checkRoomConflict(conflictClient, '2026-06-14', 'На виніс', '12:00', 30);
    assert.equal(conflict, null);
    assert.equal(conflictQueries.length, 0);
    const lineConflict = await checkServerConflicts(conflictClient, '2026-06-14', 'room-takeaway', '12:00', 30);
    assert.deepEqual(lineConflict, { overlap: false, noPause: false, conflictWith: null });
    assert.equal(conflictQueries.length, 0);

    const lockQueries = [];
    const lockClient = {
        query: async (sql, params) => {
            lockQueries.push({ sql, params });
            return { rows: [] };
        }
    };
    const lockKeys = await lockBookingConflictResources(lockClient, [{
        date: '2026-06-14',
        lineId: 'banquet-service',
        room: 'На виніс'
    }]);
    assert.deepEqual(lockKeys, []);
    assert.equal(lockQueries.length, 0);
});

test('room conflict checks can exclude same-banquet source ids without hiding unrelated room bookings', async () => {
    const queries = [];
    const conflictClient = {
        query: async (sql, params) => {
            queries.push({ sql, params });
            return {
                rows: [
                    {
                        id: 'BK-SOURCE',
                        time: '12:45',
                        duration: 120,
                        label: 'Kitchen source',
                        program_code: 'KITCHEN'
                    },
                    {
                        id: 'BK-OTHER',
                        time: '12:45',
                        duration: 60,
                        label: 'Other booking',
                        program_code: 'AN'
                    }
                ]
            };
        }
    };

    const conflict = await checkRoomConflict(
        conflictClient,
        '2026-06-14',
        'РњР°СЂРІРµР»',
        '12:45',
        60,
        { excludeIds: ['BK-SOURCE'] }
    );

    const bookingQuery = queries.find(query => /FROM bookings/i.test(query.sql));
    assert.equal(conflict.id, 'BK-OTHER');
    assert.match(bookingQuery.sql, /room = ANY\(\$2::text\[\]\)/);
    assert.match(bookingQuery.sql, /line_id = ANY\(\$4::text\[\]\)/);
    assert.match(bookingQuery.sql, /room_resource_id = ANY\(\$4::text\[\]\)/);
    assert.match(bookingQuery.sql, /room_resource_id IS NULL/);
    assert.deepEqual(bookingQuery.params[4], ['BK-SOURCE']);
    assert.match(bookingQuery.sql, /id != ALL\(\$5::text\[\]\)/);
});

test('room conflict checks and advisory locks use room resource aliases after rename', async () => {
    const queries = [];
    const resourceRow = {
        resource_id: 'room-marvel',
        type: 'room',
        name: 'Марвел Prime',
        short_name: null,
        metadata: { aliases: ['Марвел'] }
    };
    const client = {
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (/FROM timeline_resources/i.test(sql)) {
                return { rows: [resourceRow], rowCount: 1 };
            }
            if (/FROM bookings/i.test(sql)) {
                return {
                    rows: [{
                        id: 'BK-OLD-ROOM',
                        room: 'Марвел',
                        time: '15:00',
                        duration: 60,
                        label: 'Old room booking',
                        program_code: 'QUEST'
                    }],
                    rowCount: 1
                };
            }
            if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const conflict = await checkRoomConflict(client, '2099-07-01', 'Марвел Prime', '15:15', 30);
    assert.equal(conflict.id, 'BK-OLD-ROOM');
    const bookingQuery = queries.find(query => /FROM bookings/i.test(query.sql));
    assert.deepEqual(bookingQuery.params[1], ['Марвел Prime', 'Марвел']);
    assert.deepEqual(bookingQuery.params[3], ['room-marvel']);
    assert.match(bookingQuery.sql, /room = ANY\(\$2::text\[\]\)/);
    assert.match(bookingQuery.sql, /line_id = ANY\(\$4::text\[\]\)/);
    assert.match(bookingQuery.sql, /room_resource_id = ANY\(\$4::text\[\]\)/);
    assert.match(bookingQuery.sql, /room_resource_id IS NULL/);

    const lockClient = {
        query: async (sql, params) => {
            if (/FROM timeline_resources/i.test(sql)) {
                return { rows: [resourceRow], rowCount: 1 };
            }
            queries.push({ sql, params });
            return { rows: [], rowCount: 1 };
        }
    };
    const keys = await lockBookingConflictResources(lockClient, [{
        businessContext: 'event_genix',
        date: '2099-07-01',
        room: 'Марвел Prime'
    }]);
    assert.deepEqual(keys, [
        'room-resource:event_genix:2099-07-01:room-marvel',
        'room:event_genix:2099-07-01:марвел',
        'room:event_genix:2099-07-01:марвел prime'
    ]);
});

test('durable room id is the primary conflict and advisory-lock identity', async () => {
    const queries = [];
    const resourceRow = {
        resource_id: 'room-a',
        type: 'room',
        name: 'Room A Prime',
        short_name: 'A',
        metadata: { aliases: ['Room A'] }
    };
    const client = {
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (/FROM timeline_resources/i.test(sql)) return { rows: [resourceRow], rowCount: 1 };
            if (/FROM bookings/i.test(sql)) {
                return {
                    rows: [{
                        id: 'BK-LEGACY',
                        room_resource_id: null,
                        room: 'Room A',
                        time: '10:00',
                        duration: 60,
                        label: 'Legacy room booking'
                    }],
                    rowCount: 1
                };
            }
            if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const conflict = await checkRoomConflict(
        client,
        '2099-08-01',
        'Untrusted snapshot',
        '10:15',
        30,
        { candidateBooking: { roomResourceId: 'room-a' } }
    );
    assert.equal(conflict.id, 'BK-LEGACY');
    const bookingQuery = queries.find(query => /FROM bookings/i.test(query.sql));
    assert.deepEqual(bookingQuery.params[3], ['room-a']);
    assert.deepEqual(bookingQuery.params[1], ['Untrusted snapshot', 'Room A Prime', 'A', 'Room A']);
    assert.match(bookingQuery.sql, /room_resource_id = ANY\(\$4::text\[\]\)/);
    assert.match(bookingQuery.sql, /room_resource_id IS NULL/);

    const lockKeys = await lockBookingConflictResources(client, [{
        businessContext: 'event_genix',
        date: '2099-08-01',
        room: 'Untrusted snapshot',
        roomResourceId: 'room-a'
    }]);
    assert.ok(lockKeys.includes('room-resource:event_genix:2099-08-01:room-a'));
    assert.ok(lockKeys.includes('room:event_genix:2099-08-01:room a'));
    assert.ok(lockKeys.includes('room:event_genix:2099-08-01:room a prime'));
});

test('room conflict policy keeps legacy room conflicts strict without allow flag', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-KITCHEN',
        time: '11:30',
        duration: 60,
        label: 'Kitchen',
        program_code: 'KITCHEN',
        category: 'kitchen',
        banquet_group_id: 'BG-1',
        banquet_group_role: 'kitchen',
        extra_data: {}
    }]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        60,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'animation' }
        }
    );

    assert.equal(conflict.id, 'BK-KITCHEN');
    assert.equal(client.queries.length, 1);
    assert.doesNotMatch(client.queries[0].sql, /LEFT JOIN banquet_group_bookings/);
});

test('room conflict policy allows same-banquet kitchen and activity overlap', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-KITCHEN',
        time: '11:30',
        duration: 60,
        label: 'Kitchen',
        program_code: 'KITCHEN',
        program_name: 'Kitchen',
        category: 'kitchen',
        banquet_group_id: 'BG-1',
        banquet_group_role: 'kitchen',
        extra_data: {}
    }]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        60,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'quest', programCode: 'QUEST' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict, null);
    assert.equal(client.queries.length, 1);
    assert.match(client.queries[0].sql, /LEFT JOIN banquet_group_bookings/);
});

test('room conflict policy allows same-banquet kitchen candidate over activity booking', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-ACTIVITY',
        time: '11:30',
        duration: 60,
        label: 'Activity',
        program_code: 'AN',
        program_name: 'Animation',
        category: 'animation',
        banquet_group_id: 'BG-1',
        banquet_group_role: 'activity',
        extra_data: {}
    }]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        30,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'kitchen', programCode: 'KITCHEN' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict, null);
});

test('room conflict policy still blocks same-banquet activity over activity booking', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-ACTIVITY',
        time: '11:30',
        duration: 60,
        label: 'Activity',
        program_code: 'AN',
        program_name: 'Animation',
        category: 'animation',
        banquet_group_id: 'BG-1',
        banquet_group_role: 'activity',
        extra_data: {}
    }]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        30,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'animation', programCode: 'MAFIA' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict.id, 'BK-ACTIVITY');
});

test('room conflict policy keeps cancelled bookings out of policy conflict rows', async () => {
    const client = roomConflictPolicyClient([]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        60,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'animation', programCode: 'AN' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict, null);
    assert.match(client.queries[0].sql, /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.status\), ''\), 'confirmed'\)\) != 'cancelled'/);
});

test('room conflict policy still blocks unrelated banquet room bookings', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-OTHER-KITCHEN',
        time: '11:30',
        duration: 60,
        label: 'Other kitchen',
        program_code: 'KITCHEN',
        program_name: 'Kitchen',
        category: 'kitchen',
        banquet_group_id: 'BG-OTHER',
        banquet_group_role: 'kitchen',
        extra_data: {}
    }]);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        30,
        {
            banquetGroupId: 'BG-1',
            candidateBooking: { category: 'animation', programCode: 'AN' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict.id, 'BK-OTHER-KITCHEN');
});

test('room conflict policy can resolve same-banquet context from source booking membership', async () => {
    const client = roomConflictPolicyClient([{
        id: 'BK-KITCHEN',
        time: '11:30',
        duration: 60,
        label: 'Kitchen',
        program_code: 'KITCHEN',
        program_name: 'Kitchen',
        category: 'kitchen',
        banquet_group_id: 'BG-1',
        banquet_group_role: 'kitchen',
        extra_data: {}
    }], ['BG-1']);

    const conflict = await checkRoomConflict(
        client,
        '2099-06-01',
        'Room A',
        '11:30',
        30,
        {
            sourceBookingId: 'BK-SOURCE',
            candidateBooking: { category: 'animation', programCode: 'AN' },
            allowSameBanquetOperationalOverlap: true
        }
    );

    assert.equal(conflict, null);
    assert.deepEqual(client.queries[0].params[4], ['BK-SOURCE']);
    assert.match(client.queries[1].sql, /FROM banquet_group_bookings/);
    assert.deepEqual(client.queries[1].params, ['BK-SOURCE', 'event_genix']);
});

test('free-room path becomes business-aware resource availability for cabinet modes', () => {
    const settings = read('routes/settings.js');
    const booking = read('js/booking.js');
    assert.match(settings, /timelineResourceAvailability/);
    assert.match(settings, /resourceTypeForDisplayMode\(display\.mode, display\)/);
    assert.match(settings, /if \(resourceType \|\| display\.mode === 'park'\)/);
    assert.match(settings, /type: resourceType \|\| 'room'/);
    assert.match(settings, /roomAvailabilityPayloadFromResources\(resourceAvailability\)/);
    assert.match(settings, /COALESCE\(b\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(settings, /c\.name AS customer_name/);
    assert.match(booking, /appendApiContext\?\.\(`\/rooms\/free\/\$\{date\}\/\$\{time\}\/\$\{duration\}`\)/);
    assert.match(settings, /req\.query\.capacity \|\| req\.query\.attendees \|\| req\.query\.kidsCount/);
    assert.match(booking, /capacity=\$\{encodeURIComponent\(String\(requestedCapacity\)\)\}/);
    assert.match(booking, /data-free-room/);
});

test('free-room route exposes structured room day booking banquet metadata', () => {
    const settings = read('routes/settings.js');
    assert.match(settings, /b\.customer_id, b\.business_context/);
    assert.match(settings, /LEFT JOIN banquet_group_bookings bgb/);
    assert.match(settings, /LEFT JOIN banquet_groups bg/);
    assert.match(settings, /LOWER\(COALESCE\(NULLIF\(BTRIM\(bg\.status\), ''\), 'active'\)\) = 'active'/);
    assert.match(settings, /bg\.id AS banquet_group_id/);
    assert.match(settings, /CASE WHEN bg\.id IS NOT NULL THEN bgb\.role ELSE NULL END AS banquet_group_role/);
    assert.match(settings, /bg\.primary_booking_id AS banquet_group_primary_booking_id/);
    assert.match(settings, /bg\.customer_id AS banquet_group_customer_id/);
    assert.match(settings, /id: b\.id[\s\S]*time: b\.time[\s\S]*duration: b\.duration \|\| 0[\s\S]*customerName[\s\S]*label: b\.label \|\| null[\s\S]*programName: b\.program_name \|\| null/);
    assert.match(settings, /customerId: b\.customer_id \?\? null/);
    assert.match(settings, /room: b\.room \|\| null/);
    assert.match(settings, /businessContext: b\.business_context \|\| context \|\| DEFAULT_TIMELINE_CONTEXT/);
    assert.match(settings, /banquetGroupId: b\.banquet_group_id \|\| null/);
    assert.match(settings, /banquetGroupRole: b\.banquet_group_role \|\| null/);
    assert.match(settings, /banquetGroupPrimaryBookingId: b\.banquet_group_primary_booking_id \|\| null/);
    assert.match(settings, /banquetGroupCustomerId: b\.banquet_group_customer_id \?\? null/);
    assert.match(settings, /isBanquetGroupMember: Boolean\(b\.banquet_group_id\)/);
    assert.match(settings, /isBanquetPrimary: Boolean\(/);
});

test('resource availability keeps day booking metadata separate from selected-time conflicts', async () => {
    const queries = [];
    const resources = [{
        id: 1,
        business_context: 'event_genix',
        resource_id: 'cabinet-a',
        type: 'cabinet',
        name: 'Cabinet A',
        short_name: 'A',
        color: '#10B981',
        capacity: 8,
        equipment: [],
        is_active: true,
        sort_order: 10,
        metadata: {}
    }];
    const bookingRows = [{
        id: 'BK-2099-0101',
        line_id: 'cabinet-a',
        room: 'Cabinet A',
        time: '10:00',
        duration: 60,
        label: 'Lesson A',
        program_code: 'LESSON',
        program_name: 'Lesson',
        status: 'confirmed',
        kids_count: 4,
        group_name: null,
        linked_to: null,
        extra_data: {},
        customer_name: 'Ушакова Ірина',
        customer_id: 101,
        business_context: 'event_genix',
        banquet_group_id: 'BQ-ROOT',
        banquet_group_role: 'kitchen',
        banquet_group_primary_booking_id: 'BK-2099-0101',
        banquet_group_customer_id: 101
    }, {
        id: 'BK-2099-0102',
        line_id: 'cabinet-a',
        room: 'Cabinet A',
        time: '15:00',
        duration: 60,
        label: 'Lesson B',
        program_code: 'LESSON_B',
        program_name: 'Lesson B',
        status: 'confirmed',
        kids_count: 3,
        group_name: 'Група B',
        linked_to: null,
        extra_data: {},
        customer_name: null,
        customer_id: null,
        business_context: 'event_genix',
        banquet_group_id: null,
        banquet_group_role: null,
        banquet_group_primary_booking_id: null,
        banquet_group_customer_id: null
    }];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            const text = String(sql);
            if (/SELECT COUNT\(\*\)::int AS count FROM timeline_resources/i.test(text)) {
                return { rows: [{ count: resources.length }], rowCount: 1 };
            }
            if (/SELECT \*\s+FROM timeline_resources/i.test(text)) {
                return { rows: resources, rowCount: resources.length };
            }
            if (/FROM bookings b/i.test(text)) {
                return { rows: bookingRows, rowCount: bookingRows.length };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };

    const availability = await timelineResourceAvailability(fakeDb, {
        context: 'event_genix',
        type: 'cabinet',
        date: '2099-03-10',
        time: '12:00',
        duration: 60
    });

    assert.deepEqual(availability.free, ['Cabinet A']);
    assert.deepEqual(availability.occupied, []);
    assert.equal(availability.resources[0].occupied, false);
    assert.deepEqual(availability.resources[0].bookings, []);
    assert.equal(availability.resources[0].dayBookings.length, 2);
    assert.equal(availability.resources[0].dayBookings[0].customerName, 'Ушакова Ірина');
    assert.equal(availability.resources[0].dayBookings[1].customerName, 'Група B');
    assert.deepEqual(
        {
            id: availability.resources[0].dayBookings[0].id,
            time: availability.resources[0].dayBookings[0].time,
            duration: availability.resources[0].dayBookings[0].duration,
            label: availability.resources[0].dayBookings[0].label,
            programName: availability.resources[0].dayBookings[0].programName
        },
        {
            id: 'BK-2099-0101',
            time: '10:00',
            duration: 60,
            label: 'Lesson A',
            programName: 'Lesson'
        }
    );
    assert.equal(availability.resources[0].dayBookings[0].customerId, 101);
    assert.equal(availability.resources[0].dayBookings[0].room, 'Cabinet A');
    assert.equal(availability.resources[0].dayBookings[0].businessContext, 'event_genix');
    assert.equal(availability.resources[0].dayBookings[0].banquetGroupId, 'BQ-ROOT');
    assert.equal(availability.resources[0].dayBookings[0].banquetGroupRole, 'kitchen');
    assert.equal(availability.resources[0].dayBookings[0].banquetGroupPrimaryBookingId, 'BK-2099-0101');
    assert.equal(availability.resources[0].dayBookings[0].banquetGroupCustomerId, 101);
    assert.equal(availability.resources[0].dayBookings[0].isBanquetGroupMember, true);
    assert.equal(availability.resources[0].dayBookings[0].isBanquetPrimary, true);
    assert.equal(availability.resources[0].dayBookings[1].customerId, null);
    assert.equal(availability.resources[0].dayBookings[1].banquetGroupId, null);
    assert.equal(availability.resources[0].dayBookings[1].banquetGroupRole, null);
    assert.equal(availability.resources[0].dayBookings[1].banquetGroupPrimaryBookingId, null);
    assert.equal(availability.resources[0].dayBookings[1].banquetGroupCustomerId, null);
    assert.equal(availability.resources[0].dayBookings[1].isBanquetGroupMember, false);
    assert.equal(availability.resources[0].dayBookings[1].isBanquetPrimary, false);
    const bookingQuery = queries.find(query => /FROM bookings b/i.test(query.sql));
    assert.match(bookingQuery.sql, /c\.name AS customer_name/);
    assert.match(bookingQuery.sql, /LEFT JOIN banquet_group_bookings bgb/);
    assert.match(bookingQuery.sql, /LEFT JOIN banquet_groups bg/);
});

test('room resource availability resolves legacy room aliases and durable resource ids', async () => {
    const queries = [];
    const resources = [{
        id: 1,
        business_context: 'event_genix',
        resource_id: 'room-marvel-prime',
        type: 'room',
        name: 'Марвел Prime',
        short_name: 'Марвел+',
        color: '#10B981',
        capacity: null,
        equipment: [],
        is_active: true,
        sort_order: 10,
        metadata: { aliases: ['Марвел'] }
    }];
    const bookingRows = [{
        id: 'BK-ROOM-ALIAS',
        line_id: 'legacy-line',
        resource_id: null,
        room: 'Марвел',
        time: '14:00',
        duration: 60,
        label: 'Alias booking',
        program_code: 'QUEST',
        program_name: 'Quest',
        status: 'confirmed',
        kids_count: 6,
        group_name: null,
        linked_to: null,
        extra_data: {},
        customer_name: null,
        customer_id: null,
        business_context: 'event_genix',
        banquet_group_id: null,
        banquet_group_role: null,
        banquet_group_primary_booking_id: null,
        banquet_group_customer_id: null
    }];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            const text = String(sql);
            if (/SELECT COUNT\(\*\)::int AS count FROM timeline_resources/i.test(text)) {
                return { rows: [{ count: resources.length }], rowCount: 1 };
            }
            if (/SELECT \*\s+FROM timeline_resources/i.test(text)) {
                return { rows: resources, rowCount: resources.length };
            }
            if (/FROM bookings b/i.test(text)) {
                return { rows: bookingRows, rowCount: bookingRows.length };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };

    const availability = await timelineResourceAvailability(fakeDb, {
        context: 'event_genix',
        type: 'room',
        date: '2099-03-10',
        time: '14:30',
        duration: 30
    });

    assert.deepEqual(timelineResourceRoomMatchValues(availability.resources[0]), ['Марвел Prime', 'Марвел+', 'Марвел']);
    assert.deepEqual(availability.occupied, ['Марвел Prime']);
    assert.deepEqual(availability.free, []);
    assert.equal(availability.resources[0].dayBookings[0].room, 'Марвел');
    const bookingQuery = queries.find(query => /FROM bookings b/i.test(query.sql));
    assert.match(bookingQuery.sql, /b\.line_id = ANY\(\$3::text\[\]\)/);
    assert.match(bookingQuery.sql, /b\.room = ANY\(\$4::text\[\]\)/);
    assert.doesNotMatch(bookingQuery.sql, /b\.resource_id = ANY/);
    assert.deepEqual(bookingQuery.params[2], ['room-marvel-prime']);
    assert.deepEqual(bookingQuery.params[3], ['Марвел Prime', 'Марвел+', 'Марвел']);
});

test('education resources support capacity guard and quick slot closure', () => {
    const booking = read('js/booking.js');
    const timeline = read('js/timeline.js');
    const bookingsRoute = read('routes/bookings.js');
    const panelCss = read('css/panel.css');
    const featureCss = read('css/features.css');

    assert.match(booking, /function isTimelineResourceBackedBookingMode/);
    assert.match(booking, /function timelineResourceCapacityError/);
    assert.match(booking, /timelineResourceBlock/);
    assert.match(booking, /resource_blackout/);
    assert.match(booking, /Закрити кабінет/);
    assert.match(timeline, /resourceBlockExtra/);
    assert.match(timeline, /resourceBlocked === true/);
    assert.match(bookingsRoute, /function validateBookingTimelineResourceCapacity/);
    assert.match(bookingsRoute, /function resolveBookingTimelineResource/);
    assert.match(bookingsRoute, /findTimelineResourceByName/);
    assert.match(bookingsRoute, /має місткість/);
    assert.doesNotMatch(panelCss, /body\.timeline-mode-education #kidsCountSection/);
    assert.match(featureCss, /\.free-room-chip small/);
});

test('education timeline bookings persist lesson details and guard teacher conflicts', () => {
    const html = read('index.html');
    const booking = read('js/booking.js');
    const bookingForm = read('js/booking-form.js');
    const timeline = read('js/timeline.js');
    const bookingsRoute = read('routes/bookings.js');
    const panelCss = read('css/panel.css');

    assert.match(html, /educationLessonSection/);
    assert.match(html, /educationLessonTeacher/);
    assert.match(html, /educationLessonRepeatEvery/);
    assert.match(booking, /function getEducationLessonDetails/);
    assert.match(booking, /apiCreateEducationLessonSeries/);
    assert.match(booking, /extraData\.educationLesson/);
    assert.match(booking, /loadEducationLessonTeachers/);
    assert.match(bookingForm, /educationLessonRepeatEvery/);
    assert.match(timeline, /educationLessonExtra/);
    assert.match(timeline, /lessonSeriesBadge/);
    assert.match(timeline, /education-lesson/);
    assert.match(bookingsRoute, /education-series/);
    assert.match(bookingsRoute, /router\.get\('\/education-series\/:seriesId'/);
    assert.match(bookingsRoute, /router\.post\('\/education-series\/:seriesId\/cancel'/);
    assert.match(bookingsRoute, /buildEducationLessonSeriesCandidates/);
    assert.match(bookingsRoute, /function validateEducationLessonTeacherConflict/);
    assert.match(bookingsRoute, /seriesRootBookingId/);
    assert.match(bookingsRoute, /extra_data->'educationLesson'->>'teacherId'/);
    assert.match(panelCss, /\.education-lesson-section/);
});

test('settings UI exposes real timeline resource management for multi-cabinet mode', () => {
    const html = read('index.html');
    const settings = read('js/settings.js');
    const api = read('js/api.js');
    const app = read('js/app.js');
    const css = read('css/features.css');
    assert.match(html, /settingsTimelineResourcesCard/);
    assert.match(html, /settingsTimelineControlCenter/);
    assert.match(html, /data-timeline-preset="education"/);
    assert.match(html, /data-timeline-module="lessonSeries"/);
    assert.match(settings, /function renderTimelineResourcesManager/);
    assert.match(settings, /function applyTimelineSettingsToControls/);
    assert.match(settings, /function collectTimelineDisplaySettingsFromControls/);
    assert.match(settings, /function handleTimelineControlClick/);
    assert.match(settings, /function addTimelineResourceFromSettings/);
    assert.match(settings, /function handleTimelineResourceListClick/);
    assert.match(api, /async function apiGetTimelineResources/);
    assert.match(api, /async function apiSaveTimelineResource/);
    assert.match(api, /async function apiUpdateTimelineResource/);
    assert.match(app, /settingsAddTimelineResourceBtn/);
    assert.match(app, /settingsTimelineControlCenter/);
    assert.match(css, /\.timeline-resource-row/);
    assert.match(css, /\.timeline-control-center/);
});

test('timeline visual settings v2 keeps stable block ids, metadata, and legacy overrides', () => {
    const response = timelineVisibilityResponse({
        version: 1,
        overrides: {
            dateControls: true,
            bookingClose: false,
            unknownBlock: true
        }
    }, 'dar');

    assert.equal(response.version, 2);
    assert.equal(response.timelineId, 'timeline:dar');
    assert.equal(response.blocks.dateControls.visible, false);
    assert.equal(response.blocks.bookingClose.visible, true);
    assert.equal(response.overrides.dateControls, true);
    assert.equal(response.overrides.bookingClose, false);
    assert.equal(response.blocks.unknownBlock, undefined);
    assert.ok(Array.isArray(response.registry));
    assert.ok(response.registry.length >= 40);

    for (const block of TIMELINE_VISUAL_BLOCKS) {
        assert.match(block.id, /^[a-zA-Z0-9_-]+$/);
        assert.ok(block.description && block.description.length > 10, `${block.id} needs description`);
        assert.ok(block.howToUse && block.howToUse.length > 10, `${block.id} needs howToUse`);
        assert.ok(block.impact && block.impact.length > 10, `${block.id} needs impact`);
        assert.deepEqual(block.variables, ['visible', 'order', 'density', 'emphasis', 'customLabel', 'adminNote']);
    }

    const sanitized = sanitizeTimelineVisibilityPayload({
        blocks: {
            timelineGrid: {
                visible: false,
                order: 42,
                density: 'compact',
                emphasis: 'accent',
                customLabel: 'Головна сітка',
                adminNote: 'Не ховати в операційні дні',
                unsafe: 'ignored'
            },
            unknownBlock: { visible: false }
        },
        overrides: {
            bookingClose: true,
            unknownBlock: true
        }
    }, 'maysternya_doli');

    assert.equal(sanitized.version, 2);
    assert.equal(sanitized.timelineId, 'timeline:maysternya_doli');
    assert.deepEqual(sanitized.blocks.timelineGrid, {
        visible: false,
        order: 42,
        density: 'compact',
        emphasis: 'accent',
        customLabel: 'Головна сітка',
        adminNote: 'Не ховати в операційні дні'
    });
    assert.equal(sanitized.blocks.unknownBlock, undefined);
    assert.equal(sanitized.overrides.timelineGrid, true);
    assert.equal(sanitized.overrides.bookingClose, true);
    assert.equal(sanitized.overrides.unknownBlock, undefined);
});

test('timeline visual settings ignore deprecated room-load keys from saved payloads', () => {
    const legacyPayload = {
        version: 2,
        blocks: {
            roomLoad: { visible: false, order: 15 },
            roomLoadPanel: { visible: false, density: 'compact' },
            dateControls: { visible: false, order: 20 }
        },
        overrides: {
            roomLoad: true,
            roomLoadPanel: true,
            dateControls: true
        },
        views: {
            rooms: {
                blocks: {
                    roomLoadPanel: { visible: false },
                    legend: { visible: false, density: 'compact' }
                },
                overrides: {
                    roomLoadPanel: true,
                    legend: true
                }
            }
        }
    };

    const response = timelineVisibilityResponse(legacyPayload, 'event_genix', { view: 'rooms' });
    assert.equal(response.blocks.roomLoad, undefined);
    assert.equal(response.blocks.roomLoadPanel, undefined);
    assert.equal(response.overrides.roomLoad, undefined);
    assert.equal(response.overrides.roomLoadPanel, undefined);
    assert.equal(response.views.rooms.blocks.roomLoadPanel, undefined);
    assert.equal(response.views.rooms.overrides.roomLoadPanel, undefined);
    assert.equal(response.views.rooms.blocks.legend.visible, false);
    assert.equal(response.registry.some(block => block.id === 'roomLoad' || block.id === 'roomLoadPanel'), false);

    const merged = mergeTimelineVisibilityPayload(legacyPayload, {
        timelineView: 'rooms',
        blocks: {
            roomLoad: { visible: false },
            roomLoadPanel: { visible: false },
            legend: { visible: true }
        },
        overrides: {
            roomLoad: true,
            roomLoadPanel: true
        }
    }, 'event_genix', {
        view: 'rooms',
        updatedAt: '2026-06-22T12:00:00.000Z',
        updatedBy: 'creator'
    });

    assert.equal(merged.blocks.roomLoad, undefined);
    assert.equal(merged.blocks.roomLoadPanel, undefined);
    assert.equal(merged.overrides.roomLoad, undefined);
    assert.equal(merged.overrides.roomLoadPanel, undefined);
    assert.equal(merged.views.rooms.blocks.roomLoad, undefined);
    assert.equal(merged.views.rooms.blocks.roomLoadPanel, undefined);
    assert.deepEqual(merged.views.rooms.blocks.legend, { visible: true });
    assert.equal(merged.views.rooms.overrides.roomLoad, undefined);
    assert.equal(merged.views.rooms.overrides.roomLoadPanel, undefined);

    const savePayload = sanitizeTimelineVisibilityPayload({
        blocks: {
            roomLoad: { visible: false },
            roomLoadPanel: { visible: false },
            timelineGrid: { visible: true }
        },
        overrides: {
            roomLoad: true,
            roomLoadPanel: true
        }
    }, 'event_genix');

    assert.equal(savePayload.blocks.roomLoad, undefined);
    assert.equal(savePayload.blocks.roomLoadPanel, undefined);
    assert.equal(savePayload.overrides.roomLoad, undefined);
    assert.equal(savePayload.overrides.roomLoadPanel, undefined);
    assert.deepEqual(savePayload.blocks.timelineGrid, { visible: true });
});

test('room timeline banquet preview is room-only, frontend-only, and snapshot-backed', () => {
    const timeline = read('js/timeline.js');
    const booking = read('js/booking.js');
    const banquetInspectorHelpers = read('js/timeline-banquet-inspector-helpers.js');
    const css = read('css/timeline.css');
    const controlsCss = read('css/controls.css');

    assert.match(timeline, /TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES = new Set\(\['primary', 'root', 'banquet'\]\)/);
    assert.match(timeline, /TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set\(\['activity', 'service', 'manual'\]\)/);
    assert.match(timeline, /Timeline banquet inspector summary helpers live in js\/timeline-banquet-inspector-helpers\.js/);
    assert.match(banquetInspectorHelpers, /function timelineBanquetServingInfo/);
    assert.match(banquetInspectorHelpers, /timelineBanquetMenuPositions\(booking\)/);
    assert.match(timeline, /function timelineBanquetServiceEvents/);
    assert.match(timeline, /function applyTimelineBanquetPreview/);
    assert.match(timeline, /function renderTimelineBanquetRoomCard/);
    assert.match(timeline, /function showTimelineBanquetInspector/);
    assert.match(timeline, /function timelineCanEditBanquet\(summary = \{\}\)/);
    assert.match(timeline, /function timelineCanEditBanquetArrival/);
    assert.match(timeline, /canAccess\('edit_booking'\)/);
    const banquetInspectorStart = timeline.indexOf('function showTimelineBanquetInspector');
    const banquetInspectorEnd = timeline.indexOf('function timelineBanquetRoomKey', banquetInspectorStart);
    const banquetInspector = timeline.slice(banquetInspectorStart, banquetInspectorEnd);
    assert.match(banquetInspector, /const bookingId = summary\.carrierBooking\?\.id \|\| summary\.primaryBooking\?\.id;/);
    assert.match(banquetInspector, /data-banquet-inspector-edit>Редагувати<\/button>/);
    assert.match(banquetInspector, /editBooking\(bookingId, \{[\s\S]*?source: 'timeline_banquet_inspector',[\s\S]*?preferBanquetEditor: true[\s\S]*?\}\);/);
    assert.doesNotMatch(banquetInspector, /data-banquet-inspector-edit-arrival/);
    assert.doesNotMatch(banquetInspector, /timelineBanquetSummaryHref\(summary, \{ editArrival: true \}\)/);

    const editBookingStart = booking.indexOf('async function editBooking');
    const editBookingEnd = booking.indexOf('// ==========================================\n// DUPLICATE BOOKING', editBookingStart);
    const editBookingBlock = booking.slice(editBookingStart, editBookingEnd);
    assert.match(editBookingBlock, /async function editBooking\(bookingId, options = \{\}\)/);
    assert.match(booking, /function shouldRouteBookingEditToAnimatorView\(booking = \{\}, options = \{\}, banquetEditContext = null\)/);
    assert.match(editBookingBlock, /if \(shouldRouteBookingEditToAnimatorView\(anchorBooking, options, banquetEditContext\)\)/);
    assert.ok(
        editBookingBlock.indexOf('const banquetEditContext') < editBookingBlock.indexOf('if (shouldRouteBookingEditToAnimatorView(anchorBooking, options, banquetEditContext))'),
        'banquet context must be resolved before deciding whether to switch to the animator view'
    );

    assert.match(timeline, /params\.set\('editArrival', '1'\)/);
    assert.match(timeline, /const timeText = normalizeTimelineBanquetServingTime\(arrival\.time\)/);
    assert.doesNotMatch(timeline, /function timelineBanquetDateTimeText[\s\S]*?timeToMinutes\(startTime\)/);
    assert.match(banquetInspectorHelpers, /function timelineBanquetCommentItems/);
    assert.match(timeline, /function timelineBanquetCommentsHtml/);
    assert.match(banquetInspectorHelpers, /function timelineBanquetActivityStartsText/);
    assert.match(timeline, /TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES/);
    assert.match(timeline, /'banquet_group_not_found'/);
    assert.match(timeline, /'legacy_banquet_links_fallback'/);
    assert.match(timeline, /'banquet_group_schema_unavailable'/);
    assert.match(banquetInspectorHelpers, /function timelineBanquetSnapshotWarningText/);
    assert.match(banquetInspectorHelpers, /\.map\(timelineBanquetSnapshotWarningText\)/);
    assert.doesNotMatch(timeline, /Booking is not attached to a banquet group\./);
    assert.doesNotMatch(timeline, /Loaded from legacy booking_banquet_links because no banquet group exists yet\./);
    assert.doesNotMatch(timeline, /Banquet group schema is not available\./);
    assert.match(banquetInspectorHelpers, /bookingWorkspace/);
    assert.match(banquetInspectorHelpers, /comments\.kitchen/);
    assert.match(banquetInspectorHelpers, /comments\.activity/);
    assert.match(banquetInspectorHelpers, /comments\.internal/);
    assert.match(banquetInspectorHelpers, /item\?\.servingNote \|\| item\?\.serving_note/);
    assert.match(banquetInspectorHelpers, /item\?\.note \|\| item\?\.notes/);
    assert.match(timeline, /timeline-banquet-inspector-menu-note/);
    assert.match(timeline, /data-banquet-inspector-menu-toggle/);
    assert.match(timeline, /aria-expanded="\$\{expanded \? 'true' : 'false'\}"/);
    assert.match(timeline, /aria-controls="\$\{escapeHtml\(listId\)\}"/);
    assert.match(timeline, /\['Enter', ' ', 'Spacebar'\]/);
    assert.match(timeline, /renderTimelineBanquetInspectorMenu/);
    assert.match(timeline, /Початок активностей/);
    assert.match(timeline, /<span>Прихід гостей<\/span><strong>\$\{escapeHtml\(timelineBanquetDateTimeText\(summary\)\)\}<\/strong>/);
    assert.match(timeline, /\['Прихід гостей', timelineBanquetDateTimeText\(summary\)\]/);
    assert.match(timeline, /Прихід гостей: \$\{arrivalText\}/);
    assert.doesNotMatch(timeline, /<span>Дата\/час<\/span><strong>\$\{escapeHtml\(timelineBanquetDateTimeText\(summary\)\)\}<\/strong>/);
    assert.doesNotMatch(timeline, /\['Час', timelineBanquetDateTimeText\(summary\)\]/);
    assert.match(timeline, /Примітки/);
    assert.match(banquetInspectorHelpers, /Активність —/);
    assert.match(banquetInspectorHelpers, /Внутрішній коментар/);
    assert.match(timeline, />Банкетний лист<\/a>/);
    assert.doesNotMatch(timeline, />Вижимка<\/a>/);
    assert.match(timeline, /function timelineBanquetPreviewRolesByBookingId/);
    assert.match(timeline, /function timelineBanquetBlockCanOpenInspector/);
    assert.match(timeline, /function timelineBanquetPreviewRoleUsesOccupancyBand/);
    assert.match(timeline, /function setTimelineBanquetOccupancyBand/);
    assert.match(timeline, /function timelineBanquetPreviewRoleUsesGridDuplicateHide/);
    assert.match(timeline, /function timelineBanquetPreviewGridDuplicateReason/);
    assert.match(timeline, /function setTimelineBanquetGridDuplicateHidden/);
    assert.match(timeline, /function applyTimelineBanquetGridPreviewVisuals/);
    assert.match(timeline, /function timelineBanquetRoomCardSignals/);
    assert.match(timeline, /function timelineBanquetRoomServingSignals/);
    assert.match(banquetInspectorHelpers, /function normalizeTimelineBanquetServiceEventType/);
    assert.match(banquetInspectorHelpers, /function timelineBanquetServiceEventLabel/);
    assert.match(timeline, /function timelineBanquetSummaryHasPersistentRoot/);
    assert.match(timeline, /function timelineBanquetGlanceRows/);
    assert.match(timeline, /data-banquet-room-card/);
    assert.match(timeline, /data-banquet-room-marker/);
    assert.match(timeline, /dataset\.timelineBanquetPreviewRole/);
    assert.match(timeline, /requestIdleCallback/);
    assert.match(timeline, /function hydrateTimelineBanquetPreview[\s\S]*isRoomTimelineView\(\)/);
    assert.match(timeline, /function applyTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)\) return/);
    assert.match(timeline, /timelineBanquetServingInfo\(summary\)/);
    assert.match(timeline, /applyTimelineBanquetGridPreviewVisuals\(target\.block, targetRole, hasRoomServiceMarkers, target\.booking, \{ isPrimary: targetIsPrimary \}\)/);
    assert.match(timeline, /applyTimelineBanquetGridPreviewVisuals\(block, carrierRole, hasRoomServiceMarkers, carrierBooking, \{ isPrimary: carrierIsPrimary \}\)/);
    assert.match(timeline, /clearTimelineBanquetPreviewVisuals\(block\)[\s\S]*setTimelineBanquetOccupancyBand\(block, false\)/);
    assert.match(timeline, /clearTimelineBanquetPreviewVisuals\(block\)[\s\S]*setTimelineBanquetGridDuplicateHidden\(block, false\)/);
    assert.match(timeline, /clearTimelineBanquetRoomPreviews\(\)[\s\S]*booking-block\.has-timeline-banquet-preview-trigger/);
    assert.match(timeline, /clearTimelineBanquetRoomPreviews\(\)[\s\S]*booking-block\.is-timeline-banquet-grid-duplicate/);
    assert.match(timeline, /timelineBanquetRoomServingSignals\(servingMarkers\)/);
    assert.match(timeline, /signals\.push\(\.\.\.timelineBanquetRoomServingSignals\(servingMarkers\)\)/);
    assert.match(banquetInspectorHelpers, /case 'room_setup':\s*return 'Підготувати кімнату'/);
    assert.match(timeline, /return signals;\s*\}/);
    assert.doesNotMatch(timeline, /signals\.slice\(0,\s*3\)/);
    assert.doesNotMatch(timeline, /cakeMarker \|\| servingMarkers\.find/);
    assert.match(timeline, /renderTimelineBanquetRoomCard[\s\S]*if \(!signals\.length && timelineBanquetSummaryHasPersistentRoot\(summary\)\)[\s\S]*signals\.push\(\{/);
    assert.match(timeline, /card\.removeAttribute\('title'\)/);
    assert.doesNotMatch(timeline, /data-banquet-badge/);
    assert.doesNotMatch(timeline, /data-banquet-preview-trigger/);
    assert.doesNotMatch(timeline, /data-banquet-service-marker/);
    assert.doesNotMatch(timeline, /timeline-banquet-room-card-icons/);
    assert.doesNotMatch(timeline, /card\.title/);
    assert.doesNotMatch(timeline, /showTimelineBanquetPopover/);
    assert.doesNotMatch(timeline, /\/banquet-service-markers/);
    assert.match(css, /\.timeline-banquet-room-card/);
    assert.match(css, /\.timeline-banquet-room-card-signal/);
    assert.match(css, /\.timeline-banquet-room-marker/);
    assert.match(css, /\.timeline-banquet-room-card-signal--room-setup/);
    assert.match(css, /\.timeline-banquet-room-card-glance/);
    assert.match(css, /\.timeline-banquet-inspector/);
    assert.match(css, /\.timeline-banquet-inspector-section--notes/);
    assert.match(css, /\.timeline-banquet-inspector-notes/);
    assert.match(css, /\.timeline-banquet-inspector-menu-note/);
    assert.match(css, /\.timeline-banquet-inspector-menu-toggle:focus-visible/);
    assert.match(css, /overscroll-behavior:\s*contain/);
    assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(css, /\.timeline-banquet-inspector-note-text/);
    assert.match(css, /\.timeline-room-service-marker-main/);
    assert.match(css, /\.timeline-room-service-marker-detail/);
    assert.match(css, /\.booking-block\.is-timeline-banquet-occupancy-band/);
    assert.match(css, /\.booking-block\.is-timeline-banquet-occupancy-band \.title/);
    assert.match(css, /\.booking-block\.is-timeline-banquet-occupancy-band \.subtitle/);
    assert.match(css, /\.booking-block\.is-timeline-banquet-grid-duplicate\s*\{[\s\S]*display:\s*none !important;[\s\S]*pointer-events:\s*none/);
    assert.match(css, /\.timeline-line\.has-timeline-room-service-marker-lanes/);
    assert.match(css, /\.line-grid\.has-timeline-room-operational-lanes/);
    assert.match(css, /\.timeline-line\.has-timeline-room-operational-lanes/);
    assert.match(css, /\.timeline-container\.compact \.timeline-line\.has-timeline-room-operational-lanes/);
    assert.match(css, /\.timeline-container\.compact \.timeline-line\.has-timeline-room-service-marker-lanes > \.line-grid/);
    assert.match(controlsCss, /\.timeline-container\[data-zoom\] \.timeline-line\.has-timeline-room-operational-lanes/);
    assert.match(controlsCss, /\.timeline-container\[data-zoom\] \.timeline-line\.has-timeline-room-service-marker-lanes > \.line-grid/);
    assert.match(css, /--timeline-room-operational-row-height/);
    assert.match(css, /--room-service-marker-row-height/);
    assert.match(css, /height:\s*54px/);
    assert.match(css, /min-width:\s*168px/);
    assert.doesNotMatch(css, /\.timeline-banquet-chip/);
    assert.doesNotMatch(css, /\.timeline-banquet-service-marker/);
    assert.doesNotMatch(css, /timeline-banquet-room-card-icons/);
});

test('booking edit routing keeps direct activities in animator view and bypasses it only for a valid banquet inspector context', () => {
    const booking = read('js/booking.js');
    const helperStart = booking.indexOf('function shouldEditBookingInAnimatorView');
    const helperEnd = booking.indexOf('function canAddAnimationFromRoomBooking', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'booking edit route helper slice exists');

    const context = {
        ROOM_FIRST_BANQUET_SERVICE_LINE_ID: 'banquet-service',
        isRoomFirstTimelineView: () => true
    };
    vm.createContext(context);
    vm.runInContext(
        booking.slice(helperStart, helperEnd)
            + '\nthis.__bookingEditRoute = shouldRouteBookingEditToAnimatorView;',
        context,
        { filename: 'js/booking.js' }
    );

    const routeToAnimator = context.__bookingEditRoute;
    const activityCarrier = {
        id: 'BK-ACTIVITY-CARRIER',
        lineId: 'animator-1',
        programId: 'PROGRAM-1'
    };
    const banquetEditContext = { groupId: 'BG-1', primaryBookingId: 'BK-PRIMARY' };

    assert.equal(
        routeToAnimator(activityCarrier, {}, banquetEditContext),
        true,
        'direct activity editing still routes to the animator view'
    );
    assert.equal(
        routeToAnimator(activityCarrier, {
            source: 'timeline_banquet_inspector',
            preferBanquetEditor: true
        }, banquetEditContext),
        false,
        'banquet inspector editing stays in the canonical banquet editor'
    );
});

test('banquet inspector editor keeps second animator self-conflicts inside the edit context', () => {
    const booking = read('js/booking.js');
    const editBlock = booking.slice(
        booking.indexOf('async function editBooking'),
        booking.indexOf('// DUPLICATE BOOKING')
    );
    const selectBlock = booking.slice(
        booking.indexOf('async function getAnimatorLinesForBookingDate'),
        booking.indexOf('function selectedSecondAnimatorLineCandidate')
    );
    const activityBlock = booking.slice(
        booking.indexOf('async function populateSelectedActivitySecondAnimatorSelects'),
        booking.indexOf('function setSelectedActivityPinataField')
    );

    assert.match(editBlock, /resolveSecondAnimatorSelectionCandidate\(\{/);
    assert.match(editBlock, /excludeBookingIds:\s*bookingEditConflictExcludeIds\(\)/);
    assert.match(selectBlock, /getAnimatorBookingsForBookingDate\(\{ forceAnimatorView: true, fresh: true \}\)/);
    assert.match(selectBlock, /preserveSelected[\s\S]*animatorSelectConflictExcludeIds/);
    assert.match(activityBlock, /selectedCandidate[\s\S]*selectedLineId/);
    assert.match(activityBlock, /excludeBookingIds:\s*bookingEditConflictExcludeIds\(\)/);
});
test('booking detail and invite fallbacks use group snapshot arrival instead of member booking time', () => {
    const booking = read('js/booking.js');
    const detailStart = booking.indexOf('function bookingDetailBanquetArrival');
    const detailEnd = booking.indexOf('function renderBookingCustomerCopyAction', detailStart);
    const renderStart = booking.indexOf("const isBanquetArrivalMode = bookingDetailSafeRender('banquet-arrival-mode'");
    const renderEnd = booking.indexOf('const customerBlockHtml', renderStart);
    const inviteStart = booking.indexOf('function bookingInviteFallbackSnapshotArrival');
    const inviteEnd = booking.indexOf('function buildBookingInviteSharePayloadFallback', inviteStart);
    const detailHelpers = booking.slice(detailStart, detailEnd);
    const detailRender = booking.slice(renderStart, renderEnd);
    const inviteFallback = booking.slice(inviteStart, inviteEnd);

    assert.ok(detailStart >= 0 && detailEnd > detailStart);
    assert.match(detailHelpers, /banquetSnapshot\?\.arrival/);
    assert.match(detailHelpers, /time: time \|\| null/);
    assert.match(detailRender, /banquetArrival\?\.time \|\| '-'/);
    assert.doesNotMatch(detailRender, /isBanquetArrivalMode \? \(booking\.time/);
    assert.match(inviteFallback, /bookingInviteFallbackHasActivityTime/);
    assert.match(inviteFallback, /time: hasActivityTime \? booking\.time : ''/);
    assert.match(inviteFallback, /arrival: arrival\?\.time \|\| ''/);
});

test('room timeline active banquet context is carried from inspector to empty-cell booking creation', () => {
    const timeline = read('js/timeline.js');
    const inspectorStart = timeline.indexOf('function showTimelineBanquetInspector');
    const inspectorEnd = timeline.indexOf('function timelineBanquetRoomKey');
    const hideStart = timeline.indexOf('function hideTimelineBanquetInspector');
    const hideEnd = timeline.indexOf('function timelineBanquetDateTimeText');
    const selectStart = timeline.indexOf('async function selectCell');
    const selectEnd = timeline.indexOf('function getDefaultTimelineBookingTime');
    const toolbarStart = timeline.indexOf('async function openTimelineCreateBookingFromToolbar');
    const toolbarEnd = timeline.indexOf('window.openTimelineCreateBookingFromToolbar');

    assert.ok(inspectorStart >= 0 && inspectorEnd > inspectorStart, 'inspector block should exist');
    assert.ok(hideStart >= 0 && hideEnd > hideStart, 'hide inspector block should exist');
    assert.ok(selectStart >= 0 && selectEnd > selectStart, 'selectCell block should exist');
    assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, 'toolbar create block should exist');

    const inspectorBlock = timeline.slice(inspectorStart, inspectorEnd);
    const hideBlock = timeline.slice(hideStart, hideEnd);
    const selectCellBlock = timeline.slice(selectStart, selectEnd);
    const toolbarBlock = timeline.slice(toolbarStart, toolbarEnd);

    assert.match(timeline, /function normalizeTimelineActiveBanquetContext/, 'timeline should normalize an active banquet context');
    assert.match(timeline, /function timelineActiveBanquetPackageSnapshot/, 'timeline should carry package snapshot for add-to-existing prefill');
    assert.match(timeline, /function setTimelineActiveBanquetContext/, 'timeline should store the active banquet context');
    assert.match(timeline, /function clearTimelineActiveBanquetContext/, 'timeline should clear stale active banquet context');
    assert.match(timeline, /function getTimelineActiveBanquetContextForCell/, 'timeline should resolve active banquet context for a clicked cell');
    assert.match(timeline, /banquetGuests[\s\S]*banquetAdults[\s\S]*banquetTables[\s\S]*packageSnapshot/, 'active context should include guest counts and package snapshot');
    assert.match(
        inspectorBlock,
        /setTimelineActiveBanquetContext\(summary,\s*\{[\s\S]*source:\s*'timeline_banquet_inspector'/,
        'opening the mini banquet inspector should store full active context'
    );
    assert.match(
        hideBlock,
        /clearTimelineActiveBanquetContext\('inspector_closed'\)/,
        'closing the inspector should clear the active context'
    );
    assert.match(timeline, /clearTimelineActiveBanquetContext\('timeline_view_changed'\)/, 'timeline view changes should clear active banquet context');
    assert.match(timeline, /clearTimelineActiveBanquetContext\('business_context_changed'\)/, 'business context changes should clear active banquet context');
    assert.match(timeline, /clearTimelineActiveBanquetContext\('date_change'\)/, 'date changes should clear active banquet context');
    assert.match(
        timeline,
        /function getTimelineActiveBanquetContext\(\)[\s\S]*clearTimelineActiveBanquetContext\('stale_context'\)/,
        'stale active banquet context should fail closed'
    );
    assert.match(
        selectCellBlock,
        /const banquetContext = getTimelineActiveBanquetContextForCell\(cell\)/,
        'empty cell click should read active banquet context'
    );
    assert.match(
        selectCellBlock,
        /openBookingPanel\(cell\.dataset\.time,\s*cell\.dataset\.line,\s*\{[\s\S]*banquetContext[\s\S]*contextSource:\s*'timeline_empty_cell'/,
        'empty cell click should pass banquet context into the booking drawer'
    );
    assert.match(timeline, /targetIsDifferentRoom/, 'cell context should mark another room instead of rejecting it');
    assert.doesNotMatch(
        selectCellBlock,
        /cellRoomKeys\.includes\(contextRoomKey\)\)\s*return null/,
        'another room in the same active banquet should not be rejected by timeline'
    );
    assert.match(
        toolbarBlock,
        /const activeBanquetContext = getTimelineActiveBanquetContext\(\);[\s\S]*timelineConfirmStandaloneCreateWithActiveBanquet\(activeBanquetContext\)/,
        'toolbar create without a selected cell should ask before standalone create while banquet is active'
    );
});

test('room timeline banquet preview hydration is guarded against stale async mutations', () => {
    const timeline = read('js/timeline.js');
    const booking = read('js/booking.js');

    assert.match(timeline, /function invalidateTimelineBanquetPreviewFreshness\(options = \{\}\)/);
    assert.match(timeline, /window\.invalidateTimelineBanquetPreviewFreshness = invalidateTimelineBanquetPreviewFreshness/);
    assert.match(timeline, /function timelineBanquetPreviewHydrationContext\(block, booking = \{\}\)/);
    assert.match(timeline, /renderGeneration: _renderGen/);
    assert.match(timeline, /date: timelineDateKey\(booking\?\.date \|\| AppState\.selectedDate\)/);
    assert.match(timeline, /timelineView: timelineCurrentViewKey\(\)/);
    assert.match(timeline, /businessContext: booking\?\.businessContext \|\| booking\?\.business_context \|\| timelineBusinessContextValue\(\)/);
    assert.match(timeline, /groupId: timelineBanquetGroupIdFromSource\(booking\)/);
    assert.match(timeline, /function timelineBanquetPreviewHydrationIsFresh\(context = \{\}, block = null, snapshot = null\)[\s\S]*context\.renderGeneration !== _renderGen/);
    assert.match(timeline, /function timelineBanquetPreviewHydrationIsFresh\(context = \{\}, block = null, snapshot = null\)[\s\S]*context\.timelineView !== timelineCurrentViewKey\(\)/);
    assert.match(timeline, /function timelineBanquetPreviewHydrationIsFresh\(context = \{\}, block = null, snapshot = null\)[\s\S]*context\.date !== timelineDateKey\(AppState\.selectedDate\)/);
    assert.match(timeline, /function timelineBanquetPreviewHydrationIsFresh\(context = \{\}, block = null, snapshot = null\)[\s\S]*timelineBanquetSnapshotContainsBooking\(snapshot, context\.bookingId\)/);
    assert.match(timeline, /function applyTimelineBanquetPreview\(snapshot = \{\}, options = \{\}\)[\s\S]*timelineBanquetPreviewHydrationIsFresh\(options\.context, options\.block \|\| null, snapshot\)[\s\S]*return false/);
    assert.match(timeline, /function hydrateTimelineBanquetPreview\(block, booking = \{\}\)[\s\S]*const hydrationContext = timelineBanquetPreviewHydrationContext\(block, booking\)[\s\S]*timelineBanquetPreviewHydrationIsFresh\(hydrationContext, block\)[\s\S]*applyTimelineBanquetPreview\(snapshot, \{ context: hydrationContext, block \}\)/);
    assert.match(timeline, /const inspector = document\.getElementById\('timelineBanquetInspector'\);\s*if \(inspector && !inspector\.classList\.contains\('hidden'\)/);
    assert.doesNotMatch(timeline, /!inspector\?\.classList\.contains\('hidden'\) && inspector\._timelineBanquetTrigger/);
    assert.match(timeline, /apiCreateBookingBanquetLink\(sourceId, targetId, label\)[\s\S]*invalidateTimelineBanquetPreviewFreshness\(\{ bookingIds: \[sourceId, targetId\] \}\)/);
    assert.match(timeline, /apiDeleteBookingBanquetLink\(sourceId, targetId, relationType\)[\s\S]*invalidateTimelineBanquetPreviewFreshness\(\{ bookingIds: \[sourceId, targetId\] \}\)/);
    assert.match(timeline, /apiUpdateLinkedBookingsAtomic\(intent\.mainBooking\.id, payload\)[\s\S]*invalidateTimelineBanquetPreviewFreshness\(/);
    assert.match(timeline, /apiUpdateLinkedBookingsAtomic\(resizeIntent\.mainBooking\.id, payload\)[\s\S]*invalidateTimelineBanquetPreviewFreshness\(/);
    assert.match(booking, /function invalidateBookingBanquetPreviewFreshness\(options = \{\}\)/);
    assert.match(booking, /apiUpdateBooking\(booking\.id, booking\)[\s\S]*invalidateBookingBanquetPreviewFreshness\(/);
    assert.match(booking, /collectCreatedBookingRecords\(createResult\)[\s\S]*invalidateBookingBanquetPreviewFreshness\(/);
    assert.match(booking, /apiDeleteBooking\(mainBookingId\)[\s\S]*invalidateBookingBanquetPreviewFreshness\(/);
});

test('room timeline banquet preview state only top-aligns headers with rendered cards', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /function clearTimelineBanquetRoomHeaderPreviewState\(header\)/);
    assert.match(timeline, /function renderTimelineBanquetRoomCard\(header, summary = \{\}\)[\s\S]*return false;/);
    assert.match(timeline, /function renderTimelineBanquetRoomCard\(header, summary = \{\}\)[\s\S]*card\.onclick[\s\S]*return true;/);
    assert.match(timeline, /const rendered = renderTimelineBanquetRoomCard\(header, TIMELINE_BANQUET_ROOM_PREVIEWS\.get\(key\)\);/);
    assert.match(timeline, /if \(rendered\) \{[\s\S]*header\.classList\.add\('has-timeline-banquet-room-preview'\)/);
    assert.match(timeline, /else \{[\s\S]*clearTimelineBanquetRoomHeaderPreviewState\(header\);/);
    assert.match(css, /\.line-header\.has-timeline-banquet-room-preview\s*\{[\s\S]*justify-content:\s*flex-start/);
});

test('room timeline service markers keep readable event-block dimensions and structured content', () => {
    const css = read('css/timeline.css');
    const markerRule = cssRule(css, '.timeline-room-service-marker');
    const markerHeight = cssPxValue(markerRule, 'height');
    const markerMinWidth = cssPxValue(markerRule, 'min-width');
    const markerFontSize = cssPxValue(markerRule, 'font-size');
    const markerPadding = firstCssPxValue(cssDeclaration(markerRule, 'padding'));

    assert.ok(markerHeight >= 52, 'marker height reserves text descenders');
    assert.ok(markerMinWidth >= 150, 'marker width stays readable');
    assert.ok(markerFontSize >= 10, 'marker text is not reduced into a badge');
    assert.ok(markerPadding >= 4, 'marker keeps practical internal padding');
    assert.equal(cssDeclaration(markerRule, 'display'), 'flex');
    assert.equal(cssDeclaration(markerRule, 'flex-direction'), 'column');
    assert.equal(cssDeclaration(markerRule, 'background'), 'var(--timeline-service-card-bg)');
    assert.match(markerRule, /(?:^|\n)\s*color:\s*#F8FAFC;/);
    assert.equal(cssDeclaration(markerRule, 'border-left-color'), 'var(--timeline-service-card-accent)');
    const markerWithBadgeRule = cssRule(css, '.timeline-room-service-marker.has-user-letter');
    const markerBadgeRule = cssRule(css, '.timeline-room-service-marker .user-letter');
    assert.match(css, /\.timeline-room-service-marker\.booking-block--just-created/);
    assert.equal(cssDeclaration(markerWithBadgeRule, 'padding-right'), '34px');
    assert.equal(cssDeclaration(markerBadgeRule, 'position'), 'absolute');
    assert.equal(cssDeclaration(markerBadgeRule, 'pointer-events'), 'none');
    assert.ok(cssPxValue(markerBadgeRule, 'width') >= 16);
    assert.ok(cssPxValue(markerBadgeRule, 'height') >= 16);

    const { ctx, markers, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' },
            { id: 'drinks-1', type: 'drinks', title: 'Drinks', time: '15:45' }
        ]
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 3);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'room_setup', 'drinks']);
    assert.ok(markers.every(marker => marker.bookingId === 'BK-KITCHEN'));
    assert.ok(markers.every(marker => marker.bookingIds.split(/\s+/).includes('BK-KITCHEN')));
    assert.ok(markers.every(marker => marker.groupId === 'group-regression'));
    assert.ok(markers.every(marker => marker.tagName === 'BUTTON'));
    assert.ok(markers.every(marker => marker.className.includes('timeline-room-service-marker--')));
    assert.ok(markers.every(marker => parseFloat(marker.width) >= markerMinWidth));
    assert.ok(markers.every(marker => marker.hasMainLine));
    assert.ok(markers.every(marker => marker.hasTimeElement));
    assert.ok(markers.every(marker => marker.hasTitleElement));
    assert.ok(markers.every(marker => marker.hasDetailElement));
    assert.ok(markers.every(marker => marker.hasUserLetter));
    assert.ok(markers.every(marker => marker.hasUserLetterClass));
    assert.deepEqual(markers.map(marker => marker.userLetter), ['S', 'S', 'S']);
    assert.ok(markers.every(marker => marker.userLetterTitle === 'Svitlana'));
    assert.ok(markers.every(marker => marker.ariaLabel.includes('Svitlana')));
    assert.ok(markers.every(marker => marker.titleAttr.includes('Svitlana')));
    assert.ok(markers.every(marker => marker.primary.startsWith(`${marker.time} `)));
    assert.ok(markers.every(marker => marker.markerTitle.length >= 4));
    assert.ok(markers.every(marker => !marker.markerTitle.includes('_')));
    assert.ok(markers.every(marker => marker.markerTitle !== marker.type));
    assert.ok(markers.some(marker => marker.type === 'food_service' && marker.detail));
    assert.ok(markers.some(marker => marker.type === 'room_setup' && marker.detail));
    assert.ok(markers.some(marker => marker.type === 'drinks' && marker.primary.includes(marker.time)));
    assert.equal(markers[0].left, markers[1].left);
    assert.notEqual(markers[0].lane, markers[1].lane);
    assert.notEqual(markers[0].markerTop, markers[1].markerTop);
    assert.equal(layout.hasGridLaneClass, true);
    assert.equal(layout.hasLineLaneClass, true);
});

test('room timeline creator badges share one scoped metric system', () => {
    const css = read('css/timeline.css');
    const roomTokensRule = cssRule(css, 'body.timeline-view-rooms');
    const expectedTokens = {
        '--timeline-room-card-badge-size': '18px',
        '--timeline-room-card-badge-font-size': '10px',
        '--timeline-room-card-badge-font-weight': '900',
        '--timeline-room-card-badge-offset-top': '7px',
        '--timeline-room-card-badge-offset-right': '8px',
        '--timeline-room-card-badge-opacity': '1'
    };

    Object.entries(expectedTokens).forEach(([property, value]) => {
        assert.equal(cssDeclaration(roomTokensRule, property), value);
    });

    const activityBadgeRule = cssRuleIncludingSelector(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .user-letter');
    const shortActivityBadgeRule = cssRuleIncludingSelector(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--short .user-letter');
    const tinyActivityBadgeRule = cssRuleIncludingSelector(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--tiny .user-letter');
    const compactActivityBadgeRule = cssRule(css, 'body.timeline-view-rooms .timeline-container.compact .booking-block.is-room-timeline-activity-card .user-letter');
    const serviceMarkerBadgeRule = cssRule(css, 'body.timeline-view-rooms .timeline-room-service-marker .user-letter');
    const sharedBadgeDeclarations = {
        top: 'var(--timeline-room-card-badge-offset-top)',
        right: 'var(--timeline-room-card-badge-offset-right)',
        width: 'var(--timeline-room-card-badge-size)',
        'min-width': 'var(--timeline-room-card-badge-size)',
        height: 'var(--timeline-room-card-badge-size)',
        'min-height': 'var(--timeline-room-card-badge-size)',
        'font-size': 'var(--timeline-room-card-badge-font-size)',
        'font-weight': 'var(--timeline-room-card-badge-font-weight)',
        'line-height': '1',
        opacity: 'var(--timeline-room-card-badge-opacity)'
    };

    [
        activityBadgeRule,
        shortActivityBadgeRule,
        tinyActivityBadgeRule,
        compactActivityBadgeRule,
        serviceMarkerBadgeRule
    ].forEach((rule) => {
        Object.entries(sharedBadgeDeclarations).forEach(([property, value]) => {
            assert.equal(cssDeclaration(rule, property), value, `${property} uses shared room badge token`);
        });
    });

    assert.equal(cssDeclaration(activityBadgeRule, 'display'), 'flex');
    assert.equal(cssDeclaration(activityBadgeRule, 'align-items'), 'center');
    assert.equal(cssDeclaration(activityBadgeRule, 'justify-content'), 'center');
    assert.doesNotMatch(css, /body\.timeline-view-animators[\s\S]*--timeline-room-card-badge/);
});

test('room timeline activity and service marker typography use shared room tokens', () => {
    const css = read('css/timeline.css');
    const roomTokensRule = cssRule(css, 'body.timeline-view-rooms');
    const expectedTokens = {
        '--timeline-room-card-time-font-size': '13px',
        '--timeline-room-card-title-font-size': '12px',
        '--timeline-room-card-detail-font-size': '12px',
        '--timeline-room-card-time-line-height': '1.2',
        '--timeline-room-card-title-line-height': '1.2',
        '--timeline-room-card-detail-line-height': '1.22',
        '--timeline-room-card-title-font-weight': '900',
        '--timeline-room-card-detail-font-weight': '850'
    };

    Object.entries(expectedTokens).forEach(([property, value]) => {
        assert.equal(cssDeclaration(roomTokensRule, property), value);
    });

    const activityMainRule = cssRule(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-main');
    const activityTimeRule = cssRule(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .booking-block-time');
    const activityTitleRule = cssRule(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-title');
    const activityDetailRule = cssRule(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-detail');
    const shortActivityMainRule = cssRuleIncludingSelector(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--short .timeline-room-activity-main');
    const shortActivityTitleRule = cssRuleIncludingSelector(css, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--short .timeline-room-activity-title');
    const serviceMainRule = cssRule(css, 'body.timeline-view-rooms .timeline-room-service-marker-main');
    const serviceTimeRule = cssRule(css, 'body.timeline-view-rooms .timeline-room-service-marker-time');
    const serviceTitleRule = cssRule(css, 'body.timeline-view-rooms .timeline-room-service-marker-title');
    const serviceDetailRule = cssRule(css, 'body.timeline-view-rooms .timeline-room-service-marker-detail');

    [activityMainRule, activityTimeRule, shortActivityMainRule, serviceMainRule, serviceTimeRule].forEach((rule) => {
        assert.equal(cssDeclaration(rule, 'font-size'), 'var(--timeline-room-card-time-font-size)');
        assert.equal(cssDeclaration(rule, 'font-weight'), 'var(--timeline-room-card-title-font-weight)');
    });
    [activityMainRule, activityTimeRule, shortActivityMainRule, serviceMainRule, serviceTimeRule].forEach((rule) => {
        assert.equal(cssDeclaration(rule, 'line-height'), 'var(--timeline-room-card-time-line-height)');
    });
    [activityTitleRule, shortActivityTitleRule, serviceTitleRule].forEach((rule) => {
        assert.equal(cssDeclaration(rule, 'font-size'), 'var(--timeline-room-card-title-font-size)');
        assert.equal(cssDeclaration(rule, 'line-height'), 'var(--timeline-room-card-title-line-height)');
    });
    [activityTitleRule, serviceTitleRule].forEach((rule) => {
        assert.equal(cssDeclaration(rule, 'font-weight'), 'var(--timeline-room-card-title-font-weight)');
    });
    [activityDetailRule, serviceDetailRule].forEach((rule) => {
        assert.equal(cssDeclaration(rule, 'font-size'), 'var(--timeline-room-card-detail-font-size)');
        assert.equal(cssDeclaration(rule, 'font-weight'), 'var(--timeline-room-card-detail-font-weight)');
        assert.equal(cssDeclaration(rule, 'line-height'), 'var(--timeline-room-card-detail-line-height)');
    });
    const roomCardSignalRule = cssRule(css, '.timeline-banquet-room-card-signal');
    assert.equal(cssDeclaration(roomCardSignalRule, 'line-height'), '1.25');
    assert.equal(cssDeclaration(roomCardSignalRule, 'padding'), '2px 5px 3px');
    assert.doesNotMatch(css, /body\.timeline-view-animators[\s\S]*--timeline-room-card-(?:time|title|detail)/);
});

test('room timeline service markers omit creator badge when owner is unavailable', () => {
    const { markers } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:30' }
        ]
    }, { createdBy: '' });

    assert.equal(markers.length, 2);
    assert.ok(markers.every(marker => !marker.hasUserLetter));
    assert.ok(markers.every(marker => !marker.hasUserLetterClass));
    assert.ok(markers.every(marker => marker.userLetter === ''));
    assert.ok(markers.every(marker => marker.userLetterTitle === ''));
});

test('room timeline service markers use solid category surfaces instead of transparent gradients', () => {
    const css = read('css/timeline.css');
    const solidTypes = [
        ['.timeline-room-service-marker--guest-arrival', '#4D7C0F'],
        ['.timeline-room-service-marker--food-service', '#0F766E'],
        ['.timeline-room-service-marker--room-setup', '#5B21B6'],
        ['.timeline-room-service-marker--cake', '#BE185D'],
        ['.timeline-room-service-marker--drinks', '#1D4ED8'],
        ['.timeline-room-service-marker--custom', '#334155'],
        ['.timeline-room-service-marker--service', '#0E7490']
    ];

    solidTypes.forEach(([selector, color]) => {
        const rule = cssRule(css, selector);
        assert.equal(cssDeclaration(rule, '--timeline-service-card-bg'), color);
        assert.match(cssDeclaration(rule, '--timeline-service-card-bg'), /^#[0-9A-F]{6}$/i);
        assert.doesNotMatch(rule, /background:\s*linear-gradient/i);
    });

    const darkTypeRules = [...css.matchAll(/(?:body\.dark-mode|html\[data-theme="dark"\]) \.timeline-room-service-marker--(?:guest-arrival|food-service|room-setup|cake|drinks|custom|service)\s*\{([\s\S]*?)\}/g)];
    assert.ok(darkTypeRules.length >= 7);
    darkTypeRules.forEach(([, rule]) => {
        assert.match(cssDeclaration(rule, '--timeline-service-card-bg'), /^#[0-9A-F]{6}$/i);
        assert.doesNotMatch(rule, /background:\s*linear-gradient/i);
    });
});

test('room timeline activity cards share marker visual language without global animator changes', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /const isRoomTimelineActivityCard = isRoomTimelineView\(\)[\s\S]*&& !isMaysternyaSlotClosed[\s\S]*&& !isEducationLessonBlock[\s\S]*&& renderBooking\.category !== 'banquet'[\s\S]*&& renderBooking\.category !== 'graduation'/);
    assert.match(timeline, /if \(isRoomTimelineActivityCard\) \{\s*block\.classList\.add\('is-room-timeline-activity-card'\);\s*\}/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\s*\{[\s\S]*border-radius:\s*8px;[\s\S]*box-shadow:\s*0 10px 24px/);
    assert.match(css, /body\.timeline-view-rooms \.timeline-room-service-marker\s*\{[\s\S]*border-radius:\s*8px;[\s\S]*box-shadow:\s*0 10px 24px/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\s*\{[\s\S]*--timeline-room-card-accent:[\s\S]*border-left:\s*4px solid var\(--timeline-room-card-accent\)/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.animation/);
    assert.match(timeline, /<div class="timeline-room-activity-main">\s*<span class="booking-block-time">\$\{escapeHtml\(renderBooking\.time\)\}<\/span>\s*<span class="timeline-room-activity-title">/);
    assert.match(timeline, /class="timeline-room-activity-detail" title="\$\{escapeHtml\(roomActivityDetail\)\}"/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card \.timeline-room-activity-main\s*\{[\s\S]*font-size:\s*13px/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card \.timeline-room-activity-title\s*\{[\s\S]*text-overflow:\s*ellipsis/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card \.timeline-room-activity-detail\s*\{[\s\S]*-webkit-line-clamp:\s*2/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card \.booking-banquet-link-handle\s*\{[\s\S]*display:\s*none/);
    assert.doesNotMatch(css, /body\.timeline-view-animators \.booking-block\.is-room-timeline-activity-card/);
});

test('room timeline activity cards use solid category surfaces instead of transparent gradients', () => {
    const css = read('css/timeline.css');
    const bgDeclarations = [...css.matchAll(/body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card[^{]*\{[\s\S]*?--timeline-room-card-bg:\s*([^;]+);/g)]
        .map((match) => match[1].trim());

    assert.ok(bgDeclarations.length >= 7);
    bgDeclarations.forEach((value) => {
        assert.doesNotMatch(value, /linear-gradient/i);
        assert.doesNotMatch(value, /rgba?\(/i);
        assert.match(value, /^#[0-9A-F]{6}$/i);
    });
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.animation\s*\{[\s\S]*--timeline-room-card-bg:\s*#1D4ED8;/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.show\s*\{[\s\S]*--timeline-room-card-bg:\s*#C2410C;/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.pinata\s*\{[\s\S]*--timeline-room-card-bg:\s*#BE185D;/);
});

test('timeline booking blocks expose width-based density display modes', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /function timelineBookingBlockDensity\(width\) \{[\s\S]*if \(!Number\.isFinite\(safeWidth\) \|\| safeWidth < 44\) return 'micro';[\s\S]*if \(safeWidth < 90\) return 'tiny';[\s\S]*if \(safeWidth < 140\) return 'short';[\s\S]*if \(safeWidth < 220\) return 'medium';[\s\S]*return 'wide';/);
    assert.match(timeline, /const width = Math\.max\(18, timelineDurationWidth\(effectiveDuration, anchor\)\);[\s\S]*const bookingBlockDensity = timelineBookingBlockDensity\(width\);/);
    assert.match(timeline, /block\.classList\.add\(`booking-block--\$\{bookingBlockDensity\}`\);/);
    assert.match(css, /\.booking-block--micro,\s*\.booking-block--tiny,\s*\.booking-block--short,\s*\.booking-block--medium,\s*\.booking-block--wide\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /\.booking-block--micro\s*\{\s*--timeline-booking-density:\s*micro;\s*\}/);
    assert.match(css, /\.booking-block--tiny\s*\{\s*--timeline-booking-density:\s*tiny;\s*\}/);
    assert.match(css, /\.booking-block--short\s*\{\s*--timeline-booking-density:\s*short;\s*\}/);
    assert.match(css, /\.booking-block--medium\s*\{\s*--timeline-booking-density:\s*medium;\s*\}/);
    assert.match(css, /\.booking-block--wide\s*\{\s*--timeline-booking-density:\s*wide;\s*\}/);
});

test('short timeline activity blocks use compact labels while preserving full titles', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /function timelineCompactActivityLabel\(booking, renderBooking, bookingTitle, bookingTitleTail, density = 'medium'\) \{/);
    assert.match(timeline, /function timelinePinataNumberValue\(booking, renderBooking,[\s\S]*function timelinePinataNumberDisplay\(value\)/);
    assert.match(timeline, /timelineIsPinataActivity\(source, booking, haystack\)[\s\S]*return 'ПІН'/);
    assert.match(timeline, /category === 'animation'[\s\S]*return 'АН'/);
    assert.match(timeline, /haystack\.includes\('бульб'\)[\s\S]*return 'Бульб\.'/);
    assert.match(timeline, /category === 'masterclass'[\s\S]*return 'МК'/);
    assert.match(timeline, /category === 'quest'[\s\S]*return 'КВ'/);
    assert.match(timeline, /category === 'show'[\s\S]*return 'ШОУ'/);
    assert.match(timeline, /category === 'photo'[\s\S]*return 'ФОТО'/);
    assert.match(timeline, /function timelineCompactActivityTailLabel\(bookingTitleTail, bookingTitle, compactActivityLabel\) \{/);
    assert.match(timeline, /const isCompactActivityBlock = \(bookingBlockDensity === 'micro' \|\| bookingBlockDensity === 'tiny' \|\| bookingBlockDensity === 'short'\)[\s\S]*renderBooking\.category !== 'banquet'[\s\S]*renderBooking\.category !== 'graduation'/);
    assert.match(timeline, /const compactActivityLabel = timelineCompactActivityLabel\(booking, renderBooking, bookingTitle, bookingTitleTail, bookingBlockDensity\);/);
    assert.match(timeline, /const microActivityLabel = timelineMicroActivityLabel\(booking, renderBooking, compactActivityLabel, bookingTitle, bookingTitleTail\);/);
    assert.match(timeline, /const compactActivityTail = bookingBlockDensity === 'short'[\s\S]*timelineCompactActivityTailLabel\(bookingTitleTail, bookingTitle, compactActivityLabel\)/);
    assert.match(timeline, /function timelineRoomActivityDisplayLabel\(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, density = 'medium'\) \{/);
    assert.match(timeline, /const roomActivityDisplayLabel = timelineRoomActivityDisplayLabel\(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, bookingBlockDensity\);/);
    assert.match(timeline, /block\.setAttribute\('title', fullBookingLabel\);/);
    assert.match(timeline, /<div class="timeline-micro-booking-code" data-code-length="\$\{escapeHtml\(String\(microActivityLabel\.length\)\)\}">\$\{escapeHtml\(microActivityLabel\)\}<\/div>/);
    assert.match(timeline, /<span class="timeline-compact-booking-label">\$\{escapeHtml\(compactActivityLabel\)\}<\/span>/);
    assert.match(timeline, /block\.innerHTML = isRoomTimelineActivityCard[\s\S]*bookingBlockDensity === 'micro' \? microBookingHtml : compactBookingHtml/);
    assert.match(timeline, /isCompactActivityBlock \? roomActivityDisplayLabel : \(bookingTitle \|\| renderBooking\.programCode \|\| renderBooking\.category/);
    assert.match(css, /\.booking-block \.timeline-compact-booking-main\s*\{[\s\S]*display:\s*flex/);
    assert.match(css, /\.booking-block \.timeline-compact-booking-label\s*\{[\s\S]*text-overflow:\s*ellipsis/);
});

test('room timeline matches quarantined booking only to quarantine and keeps diagnostic reason', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const booking = {
        id: 'BK-QUARANTINE',
        room: 'Legacy Custom Room',
        resourceId: 'room-takeaway',
        timelineProjection: {
            timelineView: 'rooms',
            resourceId: 'room-quarantine',
            resourceName: 'Невідома / неактивна кімната',
            resourceType: 'room',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            diagnosticReason: 'custom_room'
        }
    };
    const takeawayLine = { id: 'room-takeaway', resourceId: 'room-takeaway', resourceType: 'room' };
    const quarantineLine = { id: 'room-quarantine', resourceId: 'room-quarantine', resourceType: 'room' };

    assert.equal(hooks.timelineBookingsForLine([booking], takeawayLine).length, 0);
    assert.equal(hooks.timelineBookingsForLine([booking], quarantineLine).length, 1);
    const diagnostic = hooks.timelineBookingMatchDiagnostic(booking, [takeawayLine, quarantineLine]);
    assert.equal(diagnostic.reason, 'custom_room');
    assert.deepEqual(Array.from(diagnostic.matchedLineIds), ['room-quarantine']);
});

test('empty room quarantine remains loaded for matching but hidden from render', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const takeawayLine = { id: 'room-takeaway', resourceId: 'room-takeaway', resourceType: 'room' };
    const quarantineLine = {
        id: 'room-quarantine',
        resourceId: 'room-quarantine',
        resourceType: 'room',
        assignmentAllowed: false,
        isUnavailable: true,
        metadata: { quarantine: true }
    };
    const marvelLine = { id: 'room-marvel', resourceId: 'room-marvel', resourceType: 'room' };

    assert.equal(hooks.isTimelineRoomQuarantineLine(quarantineLine), true);
    assert.equal(hooks.timelineBookingsForLine([], quarantineLine).length, 0);
    assert.equal(hooks.shouldRenderTimelineLine(quarantineLine, []), false);
    assert.equal(hooks.shouldRenderTimelineLine(takeawayLine, []), true);
    assert.equal(hooks.shouldRenderTimelineLine(marvelLine, []), true);

    const visibleLines = [takeawayLine, quarantineLine, marvelLine]
        .filter(line => hooks.shouldRenderTimelineLine(line, hooks.timelineBookingsForLine([], line)));
    assert.deepEqual(visibleLines.map(line => line.id), ['room-takeaway', 'room-marvel']);
});

test('room quarantine renders with problematic booking and exposes diagnostic reason only', () => {
    const hooks = createTimelineResourceMatchingHarness({ roomView: true });
    const booking = {
        id: 'BK-QUARANTINE',
        room: 'Legacy Customer Room Name',
        resourceId: 'room-takeaway',
        customerName: 'Sensitive Customer',
        phone: '+380000000000',
        timelineProjection: {
            timelineView: 'rooms',
            resourceId: 'room-quarantine',
            resourceName: 'Невідома / неактивна кімната',
            resourceType: 'room',
            visibleInAnimatorTimeline: false,
            visibleInRoomTimeline: true,
            displaySurface: 'booking_block',
            diagnosticReason: 'custom_room'
        }
    };
    const quarantineLine = {
        id: 'room-quarantine',
        resourceId: 'room-quarantine',
        resourceType: 'room',
        assignmentAllowed: false,
        isUnavailable: true,
        warning: 'Проблемне бронювання кімнати потребує перевірки.',
        metadata: { roomIdentityQuarantine: true }
    };

    const lineBookings = hooks.timelineBookingsForLine([booking], quarantineLine);
    assert.equal(lineBookings.length, 1);
    assert.equal(hooks.shouldRenderTimelineLine(quarantineLine, lineBookings), true);
    assert.deepEqual(Array.from(hooks.timelineRoomQuarantineDiagnosticReasons(lineBookings)), ['custom_room']);

    const headerTitle = hooks.timelineLineHeaderTitle(quarantineLine, lineBookings);
    const statusText = hooks.timelineLineUnavailableStatusText(quarantineLine, lineBookings);
    assert.match(headerTitle, /diagnosticReason: custom_room/);
    assert.equal(statusText, 'diagnosticReason: custom_room');
    assert.doesNotMatch(`${headerTitle} ${statusText}`, /Legacy Customer Room Name|Sensitive Customer|\+380|BK-QUARANTINE/);
});

test('room render fallback is quarantine-only and never uses the first room line', () => {
    const timeline = read('js/timeline.js');
    const fallbackStart = timeline.indexOf('const unmatchedBookings = bookings.filter');
    const fallbackEnd = timeline.indexOf('if (isRoomTimelineView()) {', fallbackStart + 1);
    const fallbackBlock = timeline.slice(fallbackStart, fallbackEnd);

    assert.match(fallbackBlock, /String\(line\?\.id \|\| line\?\.resourceId \|\| ''\)\.trim\(\) === 'room-quarantine'/);
    assert.match(fallbackBlock, /isRoomTimelineView\(\)[\s\S]*:\s*lines\[0\]/);
    assert.doesNotMatch(fallbackBlock, /const fallbackLine = lines\[0\]/);
});

test('room identity resolver maps active and renamed rooms to durable resources', () => {
    const resources = [{
        resourceId: 'room-marvel',
        type: 'room',
        name: 'Marvel Hall',
        shortName: 'Marvel',
        isActive: true,
        metadata: { aliases: ['Old Marvel'] }
    }];

    const active = resolveRoomTimelineResourceIdentity(resources, { room: 'Marvel Hall' });
    assert.equal(active.resourceId, 'room-marvel');
    assert.equal(active.resourceName, 'Marvel Hall');
    assert.equal(active.diagnosticReason, null);
    assert.equal(active.assignmentAllowed, true);

    const renamed = resolveRoomTimelineResourceIdentity(resources, { room: 'Old Marvel' });
    assert.equal(renamed.resourceId, 'room-marvel');
    assert.equal(renamed.resourceName, 'Marvel Hall');
    assert.equal(renamed.legacyRoomName, 'Old Marvel');
    assert.equal(renamed.diagnosticReason, 'renamed_room');
    assert.equal(renamed.assignmentAllowed, true);
});

test('room identity resolver quarantines inactive, unmatched and custom rooms without colliding with takeaway', () => {
    const inactiveResources = [{
        resourceId: 'room-retired',
        type: 'room',
        name: 'Retired Room',
        isActive: false,
        metadata: { aliases: ['Former Room'] }
    }];

    for (const booking of [
        { room: 'Retired Room' },
        { room: 'Former Room' },
        { room: 'Unknown Room', roomResourceId: 'room-missing' },
        { room: 'Custom Room' }
    ]) {
        const resolved = resolveRoomTimelineResourceIdentity(inactiveResources, booking);
        assert.equal(resolved.resourceId, 'room-quarantine');
        assert.equal(resolved.assignmentAllowed, false);
        assert.notEqual(resolved.diagnosticReason, null);
    }

    const takeaway = resolveRoomTimelineResourceIdentity(inactiveResources, { room: 'room-takeaway' });
    assert.equal(takeaway.resourceId, 'room-takeaway');
    assert.equal(takeaway.diagnosticReason, null);
    assert.equal(takeaway.assignmentAllowed, true);
});

test('booking room writes persist durable IDs and canonical catalog names', async () => {
    const fakeDb = {
        async query(sql) {
            assert.match(String(sql), /FROM timeline_resources/);
            return {
                rows: [{
                    id: 1,
                    business_context: 'event_genix',
                    resource_id: 'room-marvel',
                    type: 'room',
                    name: 'Marvel Hall',
                    short_name: 'Marvel',
                    is_active: true,
                    sort_order: 10,
                    metadata: { aliases: ['Old Marvel'] }
                }]
            };
        }
    };

    const byId = { room: 'Untrusted client text', roomResourceId: 'room-marvel' };
    await canonicalizeBookingRoomResource(fakeDb, 'event_genix', byId, { required: true });
    assert.equal(byId.roomResourceId, 'room-marvel');
    assert.equal(byId.room_resource_id, 'room-marvel');
    assert.equal(byId.room, 'Marvel Hall');

    const legacyAlias = { room: 'Old Marvel' };
    await canonicalizeBookingRoomResource(fakeDb, 'event_genix', legacyAlias, { required: true });
    assert.equal(legacyAlias.roomResourceId, 'room-marvel');
    assert.equal(legacyAlias.room, 'Marvel Hall');
});

test('booking room writes reject unknown and inactive resources but preserve current inactive identity', async () => {
    const fakeDb = {
        async query() {
            return {
                rows: [{
                    id: 2,
                    business_context: 'event_genix',
                    resource_id: 'room-retired',
                    type: 'room',
                    name: 'Retired Room',
                    is_active: false,
                    sort_order: 20,
                    metadata: {}
                }]
            };
        }
    };

    await assert.rejects(
        canonicalizeBookingRoomResource(fakeDb, 'event_genix', { roomResourceId: 'room-missing' }, { required: true }),
        error => error.code === 'ROOM_RESOURCE_UNKNOWN'
    );
    await assert.rejects(
        canonicalizeBookingRoomResource(fakeDb, 'event_genix', { roomResourceId: 'room-retired' }, { required: true }),
        error => error.code === 'ROOM_RESOURCE_INACTIVE'
    );

    const current = { roomResourceId: 'room-retired', room: 'Legacy snapshot' };
    await canonicalizeBookingRoomResource(fakeDb, 'event_genix', current, {
        required: true,
        allowInactiveResourceId: 'room-retired'
    });
    assert.equal(current.room, 'Retired Room');
    assert.equal(current.roomResourceId, 'room-retired');
});

test('takeaway room write uses a virtual durable identity without querying the physical catalog', async () => {
    const fakeDb = {
        async query() {
            throw new Error('physical room catalog must not be queried for takeaway');
        }
    };
    const booking = { room: 'На виніс' };
    const resource = await canonicalizeBookingRoomResource(fakeDb, 'event_genix', booking, { required: true });
    assert.equal(resource.virtual, true);
    assert.equal(booking.roomResourceId, 'room-takeaway');
    assert.equal(booking.room, 'На виніс');
});

test('timeline resource rename metadata preserves old and incoming aliases', () => {
    const metadata = mergeTimelineResourceRenameAliases(
        { name: 'Old Name', shortName: 'Old', metadata: { aliases: ['Very Old Name'] } },
        { aliases: ['Imported Alias'], custom: true },
        'New Name'
    );
    assert.deepEqual(new Set(metadata.aliases), new Set(['Very Old Name', 'Imported Alias', 'Old Name', 'Old']));
    assert.equal(metadata.custom, true);
});

test('upserting renamed room resource persists old name as alias', async () => {
    const queries = [];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            const text = String(sql);
            if (/SELECT \* FROM timeline_resources/i.test(text)) {
                return {
                    rows: [{
                        id: 7,
                        business_context: 'event_genix',
                        resource_id: 'room-marvel',
                        type: 'room',
                        name: 'Марвел',
                        short_name: 'Марвел',
                        color: '#10B981',
                        capacity: null,
                        equipment: [],
                        is_active: true,
                        sort_order: 10,
                        metadata: { aliases: ['Marvel legacy'] }
                    }],
                    rowCount: 1
                };
            }
            if (/INSERT INTO timeline_resources/i.test(text)) {
                return {
                    rows: [{
                        id: 7,
                        business_context: params[0],
                        resource_id: params[1],
                        type: params[2],
                        name: params[3],
                        short_name: params[4],
                        color: params[5],
                        capacity: params[6],
                        equipment: JSON.parse(params[7]),
                        is_active: params[8],
                        sort_order: params[9],
                        metadata: JSON.parse(params[10])
                    }],
                    rowCount: 1
                };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };

    const resource = await upsertTimelineResource(fakeDb, 'event_genix', {
        resourceId: 'room-marvel',
        type: 'room',
        name: 'Марвел Prime',
        shortName: 'Марвел+',
        color: '#10B981',
        metadata: { aliases: ['External Alias'] }
    });

    assert.equal(resource.resourceId, 'room-marvel');
    assert.equal(resource.name, 'Марвел Prime');
    assert.deepEqual(
        new Set(resource.metadata.aliases),
        new Set(['Marvel legacy', 'External Alias', 'Марвел'])
    );
    assert.match(queries[1].sql, /metadata = EXCLUDED\.metadata/);
});

test('room resource deactivate guard counts future bookings by durable id and aliases', async () => {
    const queries = [];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            return { rows: [{ count: 2 }], rowCount: 1 };
        }
    };

    const count = await countFutureActiveBookingsForTimelineResource(fakeDb, 'event_genix', {
        resourceId: 'room-marvel-prime',
        type: 'room',
        name: 'Марвел Prime',
        shortName: 'Марвел+',
        metadata: { aliases: ['Марвел'] }
    });

    assert.equal(count, 2);
    assert.match(queries[0].sql, /b\.line_id = \$2/);
    assert.doesNotMatch(queries[0].sql, /b\.resource_id = \$2/);
    assert.match(queries[0].sql, /b\.room = ANY\(\$3::text\[\]\)/);
    assert.deepEqual(queries[0].params, ['event_genix', 'room-marvel-prime', ['Марвел Prime', 'Марвел+', 'Марвел']]);
});

test('shared PinataNumbers helper owns operational number normalization', () => {
    const helper = pinataNumbersHarness();

    assert.equal(helper.OPERATIONAL_BASE, 500);
    assert.equal(helper.normalize('P-001'), '501');
    assert.equal(helper.normalize('P 036'), '536');
    assert.equal(helper.normalize('№505'), '505');
    assert.equal(helper.display('505'), '№505');
    assert.equal(helper.extractFromText('Піньята Фудкорт №505'), '505');
    assert.equal(helper.fromCatalogId(36), '536');
    assert.equal(helper.valueFromBooking({ category: 'pinata', pinata_number: 'P-005' }), '505');
    assert.equal(helper.isPinataBooking({ category: 'pinata' }), true);
});

test('pinata compact labels preserve operational numbers without using duration as a fallback', () => {
    const timeline = read('js/timeline.js');
    const start = timeline.indexOf('function timelineCompactLabelCandidate');
    const end = timeline.indexOf('function getTimelineLineGrid');
    assert.ok(start >= 0 && end > start, 'timeline compact helper slice exists');
    const context = { console, PinataNumbers: pinataNumbersHarness() };
    vm.createContext(context);
    vm.runInContext(`
        ${timeline.slice(start, end)}
        this.__pinataTimeline = {
            timelineCompactActivityLabel,
            timelineMicroActivityLabel,
            timelineRoomActivityDisplayLabel
        };
    `, context);
    const hooks = context.__pinataTimeline;

    assert.equal(
        hooks.timelineCompactActivityLabel({ category: 'pinata', pinataNumber: '501' }, null, 'Пін(15)', 'Піньята', 'tiny'),
        'ПІН №501'
    );
    assert.equal(
        hooks.timelineMicroActivityLabel({ category: 'pinata', pinataNumber: '501' }, null, 'ПІН №501', 'Пін(15)', 'Піньята'),
        '№501'
    );
    assert.equal(
        hooks.timelineCompactActivityLabel({ category: 'pinata', pinataNumber: 'P-001' }, null, 'Пін(15)', 'Піньята', 'tiny'),
        'ПІН №501'
    );
    assert.equal(
        hooks.timelineCompactActivityLabel({ category: 'pinata', label: 'Піньята №501' }, null, 'Пін(15)', '', 'short'),
        'ПІН №501'
    );
    assert.equal(
        hooks.timelineCompactActivityLabel({ category: 'pinata', label: 'Пін(15)' }, null, 'Пін(15)', 'Піньята', 'tiny'),
        'ПІН'
    );
    assert.equal(
        hooks.timelineRoomActivityDisplayLabel({ category: 'pinata', pinata_number: '501' }, null, 'Пін(15)', 'Піньята', 'ПІН №501', 'medium'),
        'ПІН №501'
    );
});

test('booking tooltip exposes operational pinata number on hover', () => {
    const ui = read('js/ui.js');
    const start = ui.indexOf('const PINATA_NUMBERS_ROOT');
    const end = ui.indexOf('function showTooltip', start);
    assert.ok(start >= 0 && end > start, 'tooltip pinata helper slice exists');
    const context = { console };
    vm.createContext(context);
    vm.runInContext(`
        ${ui.slice(start, end)}
        this.__pinataTooltip = {
            tooltipIsPinataBooking,
            tooltipPinataNumberValue,
            tooltipPinataNumberDisplay
        };
    `, context);
    const hooks = context.__pinataTooltip;

    assert.equal(hooks.tooltipIsPinataBooking({ category: 'pinata' }), true);
    assert.equal(hooks.tooltipPinataNumberValue({ category: 'pinata', pinata_number: 'P-005' }), '505');
    assert.equal(hooks.tooltipPinataNumberDisplay('505'), '№505');
    assert.equal(
        hooks.tooltipPinataNumberValue({ category: 'pinata', label: 'Пін+свій: Піньята Фудкорт Піньята №505' }),
        '505'
    );
});

test('booking pinata details and picker eligibility preserve operational pinata numbers', () => {
    const booking = read('js/booking.js');
    const helperStart = booking.indexOf('function isPinataProgram');
    const helperEnd = booking.indexOf('const BookingPackageState', helperStart);
    const detailStart = booking.indexOf('function inferBookingPinataMode');
    const detailEnd = booking.indexOf('async function openBookingPanel', detailStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'booking pinata helper slice exists');
    assert.ok(detailStart >= 0 && detailEnd > detailStart, 'booking pinata detail slice exists');

    const context = {
        PinataNumbers: pinataNumbersHarness(),
        console,
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        formatPrice: value => `${value} грн`
    };
    vm.createContext(context);
    vm.runInContext(`
        ${booking.slice(helperStart, helperEnd)}
        ${booking.slice(detailStart, detailEnd)}
        this.__pinataBooking = {
            isPinataProgram,
            bookingPinataNumberValue,
            buildPinataDesignChoices,
            renderPinataDetailRows
        };
    `, context);
    const hooks = context.__pinataBooking;

    assert.equal(hooks.isPinataProgram({ id: 'activity-501', code: 'Пін(15)', name: 'Піньята' }), true);
    assert.equal(hooks.bookingPinataNumberValue({ category: 'pinata', pinata_number: '501', label: 'Пін(15)' }), '501');
    assert.equal(hooks.bookingPinataNumberValue({ category: 'pinata', pinata_number: 'P-001', label: 'Пін(15)' }), '501');
    assert.equal(hooks.bookingPinataNumberValue({ category: 'pinata', pinata_number: 'P-036', label: 'Пін(15)' }), '536');
    assert.deepEqual(
        hooks.buildPinataDesignChoices({ designs: [{ id: 'design-501', pinata_number: '501', name: 'Кругла піньята' }] }).map(choice => ({
            value: choice.value,
            number: choice.number,
            title: choice.title
        })),
        [{ value: '501', number: '501', title: 'Кругла піньята' }]
    );
    assert.deepEqual(
        hooks.buildPinataDesignChoices({ designs: [{ id: 1, name: 'Кругла піньята' }, { id: 36, name: 'Фінальна піньята' }] }).map(choice => ({
            value: choice.value,
            number: choice.number,
            title: choice.title
        })),
        [
            { value: '501', number: '501', title: 'Кругла піньята' },
            { value: '536', number: '536', title: 'Фінальна піньята' }
        ]
    );
    assert.equal(hooks.buildPinataDesignChoices({ designs: [] }).length, 36);

    const details = hooks.renderPinataDetailRows({
        category: 'pinata',
        pinata_mode: 'park',
        pinata_number: '501',
        pinata_filler: 'M'
    });
    assert.match(details, /Номер піньяти:/);
    assert.match(details, /№501/);
    assert.doesNotMatch(details, /P-001/);

    const legacyDetails = hooks.renderPinataDetailRows({
        category: 'pinata',
        pinata_mode: 'park',
        pinata_number: 'P-001',
        pinata_filler: 'M'
    });
    assert.match(legacyDetails, /№501/);
    assert.doesNotMatch(legacyDetails, /P-001/);

    const fallbackDetails = hooks.renderPinataDetailRows({
        category: 'pinata',
        label: 'Піньята №501'
    });
    assert.match(fallbackDetails, /№501/);

    const durationOnly = hooks.renderPinataDetailRows({
        category: 'pinata',
        label: 'Пін\(15\)'
    });
    assert.doesNotMatch(durationOnly, /№15/);
});

test('micro, short and tiny timeline activity blocks have dedicated compact CSS layout', () => {
    const css = read('css/timeline.css');

    assert.match(css, /\.booking-block\.booking-block--micro,\s*\.booking-block\.booking-block--short,\s*\.booking-block\.booking-block--tiny\s*\{[\s\S]*justify-content:\s*center;[\s\S]*gap:\s*2px;[\s\S]*padding:\s*5px 8px;/);
    assert.match(css, /\.booking-block\.booking-block--micro \.timeline-micro-booking-code\s*\{[\s\S]*flex:\s*0 0 100%;[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*box-sizing:\s*border-box;[\s\S]*font-size:\s*9px;[\s\S]*text-align:\s*center;[\s\S]*text-overflow:\s*clip/);
    assert.match(css, /\.booking-block\.booking-block--micro \.timeline-micro-booking-code\[data-code-length="4"\]\s*\{[\s\S]*font-size:\s*7px/);
    assert.match(css, /body\.timeline-dashboard-page \.booking-block\.booking-block--micro\s*\{[\s\S]*padding:\s*0 2px !important;[\s\S]*border-left-width:\s*2px/);
    assert.match(css, /\.booking-block\.booking-block--micro \.timeline-compact-booking-main,[\s\S]*?\.booking-block\.booking-block--micro \.booking-banquet-link-handle\s*\{[\s\S]*display:\s*none/);
    assert.match(css, /\.booking-block\.booking-block--short \.timeline-compact-booking-main\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*max-width:\s*calc\(100% - 18px\)/);
    assert.match(css, /\.booking-block\.booking-block--tiny \.timeline-compact-booking-main\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*max-width:\s*100%/);
    assert.match(css, /\.booking-block\.booking-block--short \.timeline-compact-booking-main \.booking-block-time,\s*\.booking-block\.booking-block--tiny \.timeline-compact-booking-main \.booking-block-time\s*\{[\s\S]*font-size:\s*11px;[\s\S]*font-weight:\s*950/);
    assert.match(css, /\.booking-block\.booking-block--short \.timeline-compact-booking-label,\s*\.booking-block\.booking-block--tiny \.timeline-compact-booking-label\s*\{[\s\S]*font-size:\s*12px;[\s\S]*letter-spacing:\s*0/);
    assert.match(css, /\.booking-block\.booking-block--short \.timeline-compact-booking-tail\s*\{[\s\S]*text-overflow:\s*ellipsis/);
    assert.match(css, /\.booking-block\.booking-block--tiny \.timeline-compact-booking-meta,[\s\S]*?\.booking-block\.booking-block--tiny \.duration-badge\s*\{[\s\S]*display:\s*none/);
    assert.match(css, /\.booking-block\.booking-block--short \.user-letter,\s*\.booking-block\.booking-block--tiny \.user-letter\s*\{[\s\S]*position:\s*absolute;[\s\S]*width:\s*17px/);
    assert.match(css, /\.booking-block\.booking-block--short \.booking-block-room\s*\{[\s\S]*max-width:\s*72px;[\s\S]*margin-left:\s*0/);
    assert.match(css, /\.booking-block\.booking-block--short\.has-booking-room-meta \.timeline-compact-booking-meta \.booking-block-room\s*\{[\s\S]*max-width:\s*min\(72px, 100%\)/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.booking-block--short,[\s\S]*?body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.booking-block--tiny\s*\{[\s\S]*min-width:\s*124px;[\s\S]*padding:\s*7px 9px/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.booking-block--short \.timeline-room-activity-title,[\s\S]*?body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.booking-block--tiny \.timeline-room-activity-title\s*\{[\s\S]*white-space:\s*normal;[\s\S]*-webkit-line-clamp:\s*2/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.quest\s*\{[\s\S]*--timeline-room-card-accent:\s*#A78BFA/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.masterclass\s*\{[\s\S]*--timeline-room-card-accent:\s*#84CC16/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.pinata\s*\{[\s\S]*--timeline-room-card-accent:\s*#F472B6/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.photo\s*\{[\s\S]*--timeline-room-card-accent:\s*#22D3EE/);
    assert.match(css, /body\.timeline-view-rooms \.booking-block\.is-room-timeline-activity-card\.custom\s*\{[\s\S]*--timeline-room-card-accent:\s*#94A3B8/);
    assert.match(css, /body\.dark-mode \.booking-block\.booking-block--short \.timeline-compact-booking-label,[\s\S]*?html\[data-theme="dark"\] \.booking-block\.booking-block--tiny \.timeline-compact-booking-label\s*\{[\s\S]*color:\s*rgba\(248, 250, 252, 0\.98\)/);
});

test('room timeline hides duplicate banquet grid blocks when service markers exist', () => {
    const css = read('css/timeline.css');
    const markerRule = cssRule(css, '.timeline-room-service-marker');
    const duplicateRule = cssRule(css, '.booking-block.is-timeline-banquet-grid-duplicate');
    const { ctx, rootBlock, kitchenBlock, activityBlock } = applyTimelineBanquetPreviewWithVisibleBlocks({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' }
        ]
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 2);
    assert.equal(cssDeclaration(markerRule, 'display'), 'flex');
    assert.equal(cssDeclaration(markerRule, 'pointer-events'), 'auto');
    assert.ok(cssNumberValue(markerRule, 'z-index') > 0);
    assert.equal(cssDeclaration(duplicateRule, 'display'), 'none !important');
    assert.equal(cssDeclaration(duplicateRule, 'pointer-events'), 'none');
    assert.equal(rootBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(rootBlock.classList.contains('is-timeline-banquet-occupancy-band'), false);
    assert.equal(rootBlock.classList.contains('is-timeline-banquet-grid-duplicate'), true);
    assert.equal(rootBlock.dataset.timelineBanquetGridDuplicate, '1');
    assert.equal(rootBlock.dataset.timelineBanquetGridDuplicateReason, 'banquet_root_duplicate');
    assert.equal(rootBlock.dataset.timelineBanquetPreviewRole, 'primary');
    assert.equal(rootBlock.getAttribute('aria-hidden'), 'true');
    assert.equal(kitchenBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-occupancy-band'), false);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-grid-duplicate'), true);
    assert.equal(
        ctx.document.querySelector('.booking-block.is-timeline-banquet-occupancy-band'),
        null
    );
    assert.equal(kitchenBlock.dataset.timelineBanquetOccupancyBand, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicate, '1');
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicateReason, 'kitchen_duplicate');
    assert.equal(kitchenBlock.dataset.timelineBanquetPreviewRole, 'kitchen');
    assert.ok(kitchenBlock._timelineBanquetSummary);
    assert.equal(ctx.timelineBanquetBlockCanOpenInspector(kitchenBlock), true);
    assert.ok(ctx.document.querySelector('[data-banquet-room-card]'));

    assert.equal(activityBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(activityBlock.classList.contains('is-timeline-banquet-occupancy-band'), false);
    assert.equal(activityBlock.classList.contains('is-timeline-banquet-grid-duplicate'), false);
    assert.equal(activityBlock.dataset.timelineBanquetPreviewRole, 'activity');
    assert.equal(ctx.timelineBanquetPreviewRoleUsesGridDuplicateHide('primary'), false);
    assert.equal(ctx.timelineBanquetBlockCanOpenInspector(activityBlock), false);

    ctx.clearTimelineBanquetPreviewVisuals(kitchenBlock);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-occupancy-band'), false);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-grid-duplicate'), false);
    assert.equal(kitchenBlock.dataset.timelineBanquetOccupancyBand, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicate, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicateReason, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetPreviewRole, undefined);
});

test('room timeline keeps activity-first primary animation visible beside kitchen service marker', () => {
    const { ctx, activityBlock, kitchenBlock } = applyTimelineBanquetPreviewWithPrimaryActivityAndKitchenMarker();
    const serviceMarkers = ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker');
    const lineGrid = ctx.document.querySelector('.line-grid');
    const line = ctx.document.querySelector('.timeline-line');

    assert.equal(serviceMarkers.length, 1);
    assert.equal(serviceMarkers[0].dataset.bookingId, 'BK-KITCHEN-MARKER');
    assert.equal(serviceMarkers[0].dataset.banquetRoomMarker, 'food_service');

    const inspectorSummary = kitchenBlock._timelineBanquetSummary;
    assert.ok(inspectorSummary, 'kitchen marker keeps banquet inspector summary');
    assert.equal(inspectorSummary.activityCount, 1);
    assert.deepEqual(Array.from(inspectorSummary.activityBookings, booking => booking.id), ['BK-ACTIVITY-PRIMARY']);
    assert.deepEqual(Array.from(inspectorSummary.activityPreviewItems, item => item.title), ['Primary animator']);

    assert.ok(activityBlock, 'primary animation block exists');
    assert.equal(activityBlock.dataset.bookingId, 'BK-ACTIVITY-PRIMARY');
    assert.equal(activityBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(activityBlock.classList.contains('is-room-timeline-activity-card'), true);
    assert.equal(activityBlock.classList.contains('is-timeline-banquet-grid-duplicate'), false);
    assert.equal(activityBlock.dataset.timelineBanquetGridDuplicate, undefined);
    assert.equal(activityBlock.dataset.timelineBanquetGridDuplicateReason, 'activity_primary_visible');
    assert.equal(activityBlock.getAttribute('aria-hidden'), null);
    assert.equal(activityBlock.dataset.timelineBanquetPreviewRole, 'activity');
    assert.equal(ctx.timelineBanquetBlockCanOpenInspector(activityBlock), false);
    assert.equal(activityBlock.style.left, serviceMarkers[0].style.left);
    assert.equal(activityBlock.dataset.roomOperationalLane, '0');
    assert.equal(activityBlock.dataset.roomActivityLane, '0');
    assert.equal(activityBlock.style.getPropertyValue('--timeline-room-lane-top'), '10px');
    assert.equal(activityBlock.style.top, '10px');
    assert.equal(activityBlock.style.height, '72px');
    assert.equal(activityBlock.style.getPropertyValue('--timeline-room-activity-card-height'), '72px');

    assert.equal(kitchenBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(kitchenBlock.dataset.timelineBanquetPreviewRole, 'kitchen');
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-grid-duplicate'), true);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicateReason, 'kitchen_duplicate');
    assert.equal(kitchenBlock.getAttribute('aria-hidden'), 'true');
    assert.equal(serviceMarkers[0].dataset.markerLane, '1');
    assert.equal(serviceMarkers[0].dataset.roomOperationalLane, '1');
    assert.equal(serviceMarkers[0].style.getPropertyValue('--timeline-room-lane-top'), '90px');
    assert.equal(serviceMarkers[0].style.top, '90px');
    assert.equal(lineGrid.dataset.roomOperationalLanes, '2');
    assert.equal(line.dataset.roomOperationalLanes, '2');
    assert.equal(lineGrid.style.getPropertyValue('--timeline-room-operational-row-height'), '154px');
    assert.equal(line.style.getPropertyValue('--timeline-line-min-h'), '154px');
    assert.equal(lineGrid.classList.contains('has-timeline-room-operational-lanes'), true);
    assert.equal(line.classList.contains('has-timeline-room-operational-lanes'), true);
});

test('room timeline keeps two banquet activities visible beside overlapping kitchen marker', () => {
    const { ctx, activityBlock, secondaryActivityBlock, kitchenBlock } = applyTimelineBanquetPreviewWithPrimaryActivityAndKitchenMarker({
        secondaryActivity: true
    });
    const serviceMarkers = ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker');
    const lineGrid = ctx.document.querySelector('.line-grid');
    const activityBlocks = Array.from(ctx.document.querySelectorAll('.line-grid .is-room-timeline-activity-card'));

    assert.equal(activityBlocks.length, 2);
    assert.deepEqual(activityBlocks.map(block => block.dataset.bookingId).sort(), ['BK-ACTIVITY-PRIMARY', 'BK-ACTIVITY-SECONDARY']);
    assert.equal(new Set(activityBlocks.map(block => block.dataset.bookingId)).size, 2);
    assert.equal(serviceMarkers.length, 1);
    assert.equal(kitchenBlock._timelineBanquetSummary.activityCount, 2);
    assert.deepEqual(
        Array.from(kitchenBlock._timelineBanquetSummary.activityBookings, booking => booking.id).sort(),
        ['BK-ACTIVITY-PRIMARY', 'BK-ACTIVITY-SECONDARY']
    );
    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker[data-booking-id="BK-KITCHEN-MARKER"]').length, 1);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-grid-duplicate'), true);
    assert.equal(serviceMarkers[0].dataset.banquetRoomMarker, 'food_service');

    for (const block of [activityBlock, secondaryActivityBlock]) {
        assert.ok(block, 'activity block exists');
        assert.equal(block.classList.contains('is-timeline-banquet-grid-duplicate'), false);
        assert.equal(block.getAttribute('aria-hidden'), null);
        assert.equal(block.dataset.timelineBanquetPreviewRole, 'activity');
        assert.equal(block.style.left, serviceMarkers[0].style.left);
    }

    assert.equal(activityBlock.dataset.roomOperationalLane, '0');
    assert.equal(secondaryActivityBlock.dataset.roomOperationalLane, '1');
    assert.equal(serviceMarkers[0].dataset.roomOperationalLane, '2');
    assert.equal(activityBlock.style.top, '10px');
    assert.equal(secondaryActivityBlock.style.top, '90px');
    assert.equal(serviceMarkers[0].style.top, '170px');
    assert.equal(lineGrid.dataset.roomOperationalLanes, '3');
    assert.equal(lineGrid.style.getPropertyValue('--timeline-room-operational-row-height'), '234px');
});

test('room timeline keeps kitchen booking block normal when no service markers exist', () => {
    const { ctx, rootBlock, kitchenBlock } = applyTimelineBanquetPreviewWithVisibleBlocks({
        menuPositions: [
            { id: 'item-a', title: 'Pizza' }
        ],
        serviceEvents: []
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 0);
    assert.equal(kitchenBlock.classList.contains('has-timeline-banquet-preview-trigger'), true);
    assert.equal(rootBlock.classList.contains('is-timeline-banquet-grid-duplicate'), false);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-occupancy-band'), false);
    assert.equal(kitchenBlock.classList.contains('is-timeline-banquet-grid-duplicate'), false);
    assert.equal(kitchenBlock.dataset.timelineBanquetOccupancyBand, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicate, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetGridDuplicateReason, undefined);
    assert.equal(kitchenBlock.dataset.timelineBanquetPreviewRole, 'kitchen');
});

test('room timeline renders multiple menu serving markers inside the room grid', () => {
    const { ctx, markers, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' },
            { id: 'item-b', title: 'Juice', servingTime: '12:30' }
        ],
        serviceEvents: []
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 2);
    assert.deepEqual(markers.map(marker => marker.primary), [
        '12:00 Видача',
        '12:30 Видача'
    ]);
    assert.deepEqual(markers.map(marker => marker.detail), ['Кухня 1 поз.', 'Кухня 1 поз.']);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'food_service']);
    assert.deepEqual(markers.map(marker => marker.time), ['12:00', '12:30']);
    assert.ok(markers.every(marker => marker.parentClass.includes('line-grid')));
    assert.ok(markers.every(marker => parseFloat(marker.width) >= 168));
    assert.notEqual(markers[0].left, markers[1].left);
    assert.ok(parseFloat(markers[1].left) > parseFloat(markers[0].left));
    assert.deepEqual(markers.map(marker => marker.lane), ['1', '2']);
    assert.deepEqual(markers.map(marker => marker.markerTop), ['66px', '122px']);
    assert.equal(layout.gridLaneCount, '3');
    assert.equal(layout.gridOperationalLaneCount, '3');
    assert.equal(layout.gridRowHeight, '186px');
    assert.equal(layout.gridOperationalRowHeight, '186px');
    assert.equal(layout.lineMinHeight, '186px');
    assert.equal(layout.hasGridLaneClass, true);
    assert.equal(layout.hasGridOperationalLaneClass, true);
    assert.equal(layout.hasLineLaneClass, true);
    assert.equal(layout.hasLineOperationalLaneClass, true);
});

test('room timeline renders canonical banquet arrival as a room-grid operational marker', () => {
    const { ctx, inspectorSummary, markers, activities, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:30' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' }
        ]
    }, {
        arrival: {
            bookingId: 'BK-ACTIVITY-ARRIVAL',
            date: '2099-06-18',
            time: '12:00',
            room: 'Room A',
            source: 'activity'
        },
        activityBlocks: [
            { id: 'activity-1', category: 'show', time: '12:00', duration: 30, title: 'Activity' }
        ]
    });

    const arrivalNode = ctx.document.querySelector('.line-grid .timeline-room-service-marker--guest-arrival');
    assert.ok(arrivalNode);
    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 3);
    assert.deepEqual(markers.map(marker => marker.type), ['guest_arrival', 'room_setup', 'food_service']);
    assert.deepEqual(markers.map(marker => marker.primary), [
        '12:00 Прихід гостей',
        '12:00 Підготовка',
        '12:30 Видача'
    ]);
    assert.equal(markers[0].bookingId, 'BK-ACTIVITY-ARRIVAL');
    assert.equal(markers[0].bookingIds, 'BK-ACTIVITY-ARRIVAL');
    assert.equal(markers[0].groupId, 'group-regression');
    assert.equal(markers[0].canonicalGroupId, 'group-regression');
    assert.equal(markers[0].draggable, false);
    assert.equal(markers[0].markerTitle, 'Прихід гостей');
    assert.equal(markers[0].detail, 'Room A');
    assert.equal(markers[0].ariaHaspopup, 'dialog');
    assert.ok(!markers[0].className.includes('booking-block'));
    assert.equal(activities.length, 1);
    assert.equal(layout.hasGridOperationalLaneClass, true);
    assert.equal(layout.hasLineOperationalLaneClass, true);

    arrivalNode.click();
    assert.equal(ctx.document.body.classList.contains('timeline-banquet-inspector-open'), true);
    assert.equal(ctx.document.getElementById('timelineBanquetInspector')?.dataset.banquetGroupId, 'group-regression');

    ctx.__timelineViewState.room = false;
    ctx.clearTimelineRoomServiceMarkers();
    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker--guest-arrival').length, 0);
});

test('room timeline banquet inspector and service markers use clear menu quantity wording', () => {
    const { ctx, inspectorSummary, markers } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            {
                id: 'cake-nutella',
                title: 'Нутелла',
                quantity: 5,
                servingUnit: '100г',
                unitPrice: 90,
                subtotal: 450,
                servingTime: '14:30',
                servingNote: 'без горіхів'
            },
            {
                id: 'burger-child',
                title: 'Бургер дитячий',
                quantity: 3,
                servingUnit: 'порція',
                unitPrice: 260,
                subtotal: 780,
                servingTime: '16:30'
            }
        ],
        serviceEvents: []
    });

    const inspectorHtml = ctx.timelineBanquetMenuPreviewHtml(inspectorSummary);
    assert.match(inspectorHtml, /5 порцій по 100 г/);
    assert.match(inspectorHtml, /3 порції/);
    assert.match(inspectorHtml, /без горіхів/);
    assert.doesNotMatch(inspectorHtml, /× 5|5 100г|5 100 г|x5/);

    assert.match(markers[0].titleAttr, /Нутелла 5 порцій по 100 г без горіхів/);
    assert.match(markers[1].titleAttr, /Бургер дитячий 3 порції/);
    assert.doesNotMatch(markers.map(marker => marker.titleAttr).join('\n'), /x5|5 100г|5 100 г/);
});

test('room timeline banquet inspector empty menu uses an actionable hint and localized warning', () => {
    const ctx = createTimelineBanquetMarkerHarness();
    const emptyMenuHtml = ctx.timelineBanquetMenuPreviewHtml({ menuPreviewItems: [] });

    assert.match(emptyMenuHtml, /Щоб додати меню, натисніть будь-який вільний часовий слот\./);
    assert.doesNotMatch(emptyMenuHtml, /Меню не додано/);

    const primaryBooking = {
        id: 'BK-PRIMARY',
        date: '2099-06-18',
        time: '15:00',
        duration: 60,
        room: 'Room A',
        category: 'banquet',
        status: 'confirmed'
    };
    const summary = ctx.timelineBanquetSnapshotSummary({
        success: true,
        source: 'group',
        group: {
            id: 'BG-EMPTY-MENU',
            date: '2099-06-18',
            room: 'Room A',
            status: 'active'
        },
        bookings: {
            primary: primaryBooking,
            kitchen: [],
            activities: [],
            services: [],
            manual: []
        },
        members: [
            {
                bookingId: primaryBooking.id,
                role: 'primary',
                isPrimary: true,
                booking: primaryBooking
            }
        ],
        warnings: [
            {
                code: 'kitchen_booking_missing',
                message: 'No kitchen/menu booking was detected for this banquet.'
            }
        ]
    });

    assert.deepEqual(summary.warnings, [
        'Для цього банкету ще немає окремого бронювання кухні / меню.'
    ]);
});
test('room timeline banquet inspector expands and collapses hidden menu positions by click, Enter, and Space', () => {
    const menuPositions = Array.from({ length: 11 }, (_, index) => ({
        id: `menu-${index + 1}`,
        title: `Long banquet menu position ${index + 1} with preparation details`,
        quantity: index + 1,
        servingUnit: 'portion',
        servingTime: `${String(12 + Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`
    }));
    const { ctx, inspectorSummary } = renderTimelineBanquetRoomGridMarkers({ menuPositions, serviceEvents: [] });
    ctx.showTimelineBanquetInspector(null, inspectorSummary, null);
    const inspector = ctx.document.getElementById('timelineBanquetInspector');
    const visibleRows = () => inspector.querySelectorAll('.timeline-banquet-inspector-menu li').length;
    const toggle = () => inspector.querySelector('[data-banquet-inspector-menu-toggle]');

    assert.equal(visibleRows(), 5);
    assert.equal(toggle().tagName, 'BUTTON');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(toggle().getAttribute('aria-controls'), 'timelineBanquetInspectorMenuList');
    assert.match(toggle().textContent, /Ще позицій: 6/);

    toggle().click();
    assert.equal(visibleRows(), 11);
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.match(toggle().textContent, /Згорнути/);

    toggle().click();
    assert.equal(visibleRows(), 5);
    toggle().dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(visibleRows(), 11);
    toggle().dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.equal(visibleRows(), 5);

    toggle().click();
    assert.equal(visibleRows(), 11);
    ctx.hideTimelineBanquetInspector();
    ctx.showTimelineBanquetInspector(null, inspectorSummary, null);
    assert.equal(visibleRows(), 5, 'expanded state resets when the inspector is reopened');
});

test('canonical timeline banquet inspector owns accessible loading, empty, and error states', () => {
    const ctx = createTimelineBanquetMarkerHarness();
    const trigger = ctx.document.createElement('button');
    trigger.dataset.bookingId = 'BK-INSPECTOR-STATE';
    ctx.document.body.appendChild(trigger);

    const expectations = [
        ['loading', 'Завантаження банкету', 'status', 'true'],
        ['empty', 'Дані банкету відсутні', 'status', 'false'],
        ['error', 'Не вдалося завантажити банкет', 'alert', 'false']
    ];
    for (const [state, title, role, ariaBusy] of expectations) {
        ctx.showTimelineBanquetInspector(null, null, trigger, { state });
        const inspector = ctx.document.getElementById('timelineBanquetInspector');
        const stateNode = inspector.querySelector('.timeline-banquet-inspector-state');
        assert.equal(ctx.document.querySelectorAll('#timelineBanquetInspector').length, 1);
        assert.equal(inspector.dataset.state, state);
        assert.equal(inspector.getAttribute('aria-busy'), ariaBusy);
        assert.equal(stateNode.getAttribute('role'), role);
        assert.match(stateNode.textContent, new RegExp(title));
        assert.equal(inspector._timelineBanquetTrigger, trigger);
    }

    const css = read('css/timeline.css');
    assert.match(css, /\.timeline-banquet-inspector-state--loading[\s\S]*animation:\s*timeline-banquet-inspector-spin/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
});

test('room timeline renders room_setup service event as a separate room-grid marker', () => {
    const { ctx, markers, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' }
        ]
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 1);
    assert.deepEqual(markers.map(({ type, primary, detail }) => ({ type, primary, detail })), [
        { type: 'room_setup', primary: '12:00 Підготовка', detail: 'Підготувати кімнату' }
    ]);
    assert.equal(markers[0].time, '12:00');
    assert.ok(markers[0].parentClass.includes('line-grid'));
    assert.equal(markers[0].left, '200px');
    assert.equal(markers[0].top, '10px');
    assert.ok(parseFloat(markers[0].width) >= 168);
    assert.equal(markers[0].ariaHaspopup, 'dialog');
    assert.equal(markers[0].lane, '0');
    assert.equal(markers[0].markerTop, '10px');
    assert.equal(layout.gridLaneCount, '1');
    assert.equal(layout.gridOperationalLaneCount, '1');
    assert.equal(layout.gridRowHeight, '74px');
    assert.equal(layout.gridOperationalRowHeight, '74px');
    assert.equal(layout.lineMinHeight, '74px');
});

test('room timeline keeps mixed same-time room-grid markers without dedupe', () => {
    const { ctx, markers, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' },
            { id: 'item-b', title: 'Juice', servingTime: '12:30' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' }
        ]
    });

    assert.equal(markers.length, 3);
    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 3);
    assert.deepEqual(markers.map(marker => marker.primary), [
        '12:00 Видача',
        '12:00 Підготовка',
        '12:30 Видача'
    ]);
    assert.deepEqual(markers.map(marker => marker.detail), ['Кухня 1 поз.', 'Підготувати кімнату', 'Кухня 1 поз.']);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'room_setup', 'food_service']);
    assert.equal(markers.filter(marker => marker.time === '12:00').length, 2);
    assert.equal(markers[0].left, markers[1].left);
    assert.notEqual(markers[0].top, markers[1].top);
    assert.notEqual(markers[1].left, markers[2].left);
    assert.ok(parseFloat(markers[2].left) > parseFloat(markers[1].left));
    assert.deepEqual(markers.map(marker => marker.lane), ['1', '0', '2']);
    assert.deepEqual(markers.map(marker => marker.markerTop), ['66px', '10px', '122px']);
    assert.equal(layout.gridLaneCount, '3');
    assert.equal(layout.gridOperationalLaneCount, '3');
    assert.equal(layout.gridRowHeight, '186px');
    assert.equal(layout.gridOperationalRowHeight, '186px');
    assert.equal(layout.lineMinHeight, '186px');
});

test('room service marker lanes avoid close-time collisions and reserve row height', () => {
    const { markers, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' },
            { id: 'item-b', title: 'Juice', servingTime: '12:30' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' },
            { id: 'drinks-1', type: 'drinks', title: 'Drinks', time: '12:30' }
        ]
    });

    assert.equal(markers.length, 4);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'room_setup', 'food_service', 'drinks']);
    assert.deepEqual(markers.map(marker => marker.lane), ['1', '0', '2', '3']);
    assert.deepEqual(markers.map(marker => marker.markerTop), ['66px', '10px', '122px', '178px']);
    assert.equal(layout.gridLaneCount, '4');
    assert.equal(layout.gridOperationalLaneCount, '4');
    assert.equal(layout.lineLaneCount, '4');
    assert.equal(layout.lineOperationalLaneCount, '4');
    assert.equal(layout.gridRowHeight, '242px');
    assert.equal(layout.gridOperationalRowHeight, '242px');
    assert.equal(layout.lineRowHeight, '242px');
    assert.equal(layout.lineOperationalRowHeight, '242px');
    assert.equal(layout.lineMinHeight, '242px');
});

test('room operational lanes separate same-time service marker and activity block', () => {
    const { markers, activities, layout } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' }
        ]
    }, {
        activityBlocks: [
            { id: 'activity-1', category: 'show', time: '12:00', duration: 30, title: 'Р‘СѓР»СЊР±.' }
        ]
    });

    assert.equal(markers.length, 1);
    assert.equal(activities.length, 1);
    assert.equal(markers[0].left, activities[0].left);
    assert.equal(markers[0].lane, '0');
    assert.equal(activities[0].roomOperationalLane, '1');
    assert.equal(activities[0].roomActivityLane, '1');
    assert.notEqual(markers[0].top, activities[0].top);
    assert.equal(markers[0].markerTop, '10px');
    assert.equal(activities[0].roomLaneTop, '90px');
    assert.equal(activities[0].height, '72px');
    assert.equal(activities[0].roomActivityHeight, '72px');
    assert.equal(layout.gridOperationalLaneCount, '2');
    assert.equal(layout.lineOperationalLaneCount, '2');
    assert.equal(layout.gridOperationalRowHeight, '172px');
    assert.equal(layout.lineMinHeight, '172px');
    assert.equal(layout.hasGridOperationalLaneClass, true);
    assert.equal(layout.hasLineOperationalLaneClass, true);
});

test('room-grid service markers stay isolated across room and animator timeline views', () => {
    const bookingPackage = {
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' },
            { id: 'item-b', title: 'Juice', servingTime: '12:30' }
        ],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Prepare room', time: '12:00' }
        ]
    };
    const { ctx, inspectorSummary, markers } = renderTimelineBanquetRoomGridMarkers(bookingPackage, { roomView: true });

    assert.equal(markers.length, 3);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'room_setup', 'food_service']);
    assert.deepEqual(markers.map(marker => marker.time), ['12:00', '12:00', '12:30']);
    assert.ok(markers.every(marker => marker.parentClass.includes('line-grid')));
    assert.ok(markers.every(marker => marker.ariaHaspopup === 'dialog'));

    ctx.__timelineViewState.room = false;
    ctx.clearTimelineRoomServiceMarkers();
    assert.equal(ctx.document.querySelectorAll('.timeline-room-service-marker').length, 0);
    const clearedGrid = ctx.document.querySelector('.line-grid');
    const clearedLine = ctx.document.querySelector('.timeline-line');
    assert.equal(clearedGrid.classList.contains('has-timeline-room-service-markers'), false);
    assert.equal(clearedLine.classList.contains('has-timeline-room-service-marker-lanes'), false);
    assert.equal(clearedGrid.classList.contains('has-timeline-room-operational-lanes'), false);
    assert.equal(clearedLine.classList.contains('has-timeline-room-operational-lanes'), false);
    assert.equal(clearedGrid.style.getPropertyValue('--room-service-marker-row-height'), '');
    assert.equal(clearedGrid.style.getPropertyValue('--timeline-room-operational-row-height'), '');
    assert.equal(clearedLine.style.getPropertyValue('--timeline-line-min-h'), '');

    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    assert.equal(ctx.document.querySelectorAll('.timeline-room-service-marker').length, 0);

    ctx.__timelineViewState.room = true;
    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    assert.equal(ctx.document.querySelectorAll('.timeline-room-service-marker').length, 3);
    assert.equal(ctx.document.querySelector('.timeline-line').classList.contains('has-timeline-room-service-marker-lanes'), true);
});

test('room-grid service marker lifecycle is scoped to room view and view-aware cache keys', () => {
    const timeline = read('js/timeline.js');
    const timelineCache = read('js/timeline-cache.js');
    const rendererBlock = timeline.slice(
        timeline.indexOf('function renderTimelineRoomServiceMarkers'),
        timeline.indexOf('function clearTimelineBanquetRoomPreviews')
    );
    const clearBlock = timeline.slice(
        timeline.indexOf('function clearTimelineBanquetRoomPreviews'),
        timeline.indexOf('function timelineBanquetSummarySortValue')
    );
    const setViewBlock = timeline.slice(
        timeline.indexOf('async function setTimelineView'),
        timeline.indexOf('window.TimelineView =')
    );
    const renderStartIndex = timeline.indexOf('async function renderTimeline()');
    const renderClearIndex = timeline.indexOf('clearTimelineBanquetRoomPreviews()', renderStartIndex);
    const renderFetchIndex = timeline.indexOf('getLinesForDate(selectedDate, { requestToken: renderRequestToken })', renderStartIndex);
    const cacheScopeBlock = timelineCache.slice(
        timelineCache.indexOf('function timelineCacheScopeKey'),
        timelineCache.indexOf('function timelineDateKey')
    );

    assert.match(rendererBlock, /if \(!isRoomTimelineView\(\) \|\| !summary\) return/);
    assert.match(timeline, /function timelineRoomServiceMarkerPreferredLane/);
    assert.match(timeline, /function timelineRoomServiceMarkerLane/);
    assert.match(timeline, /function syncTimelineRoomOperationalLayout/);
    assert.match(timeline, /function syncTimelineRoomServiceMarkerLayout/);
    assert.match(timeline, /\.booking-block\.is-room-timeline-activity-card:not\(\.status-hidden\)/);
    assert.match(timeline, /dataset\.roomOperationalLane = String\(lane\)/);
    assert.match(timeline, /style\.setProperty\('--timeline-room-lane-top', `\$\{top\}px`\)/);
    assert.match(rendererBlock, /timelineRoomServiceMarkerLane\(type, left, baseWidth, laneSegments\)/);
    assert.match(rendererBlock, /markerEl\.dataset\.markerLane = String\(laneIndex\)/);
    assert.match(rendererBlock, /syncTimelineRoomServiceMarkerLayout\(lineGrid\)/);
    assert.match(clearBlock, /clearTimelineRoomServiceMarkers\(\)/);
    assert.match(timeline, /has-timeline-room-service-marker-lanes/);
    assert.match(timeline, /has-timeline-room-operational-lanes/);
    assert.match(timeline, /--timeline-room-operational-row-height/);
    assert.match(timeline, /--timeline-line-min-h/);
    assert.ok(setViewBlock.includes('clearTimelineBanquetRoomPreviews()'));
    assert.ok(setViewBlock.indexOf('clearTimelineBanquetRoomPreviews()') < setViewBlock.indexOf('await renderTimeline()'));
    assert.ok(renderClearIndex > renderStartIndex);
    assert.ok(renderFetchIndex > renderClearIndex);
    assert.match(cacheScopeBlock, /const timelineView = timelineCurrentView\(\)/);
    assert.match(cacheScopeBlock, /`\$\{context\}\|\$\{mode\}\|\$\{resourceType\}\|\$\{timelineView\}`/);
});

test('room timeline banquet activity blocks keep full booking modal click ownership', () => {
    const timeline = read('js/timeline.js');
    const inspectorFunction = timeline.slice(
        timeline.indexOf('function timelineBanquetBlockCanOpenInspector'),
        timeline.indexOf('function hydrateTimelineBanquetBadges')
    );
    const previewFunction = timeline.slice(
        timeline.indexOf('function showTimelineBanquetPreviewFromBlock'),
        timeline.indexOf('async function openTimelineBookingDetailsFromBlock')
    );
    const openDetailsFunction = timeline.slice(
        timeline.indexOf('async function openTimelineBookingDetailsFromBlock'),
        timeline.indexOf('document.addEventListener', timeline.indexOf('async function openTimelineBookingDetailsFromBlock'))
    );
    const renderBlockClickStart = timeline.indexOf('if (isLinked) {', timeline.indexOf("block.setAttribute('data-booking-id'"));
    const linkedClickBlock = timeline.slice(
        renderBlockClickStart,
        timeline.indexOf('} else {', renderBlockClickStart)
    );
    const ownClickBlock = timeline.slice(
        timeline.indexOf('} else {', renderBlockClickStart),
        timeline.indexOf('block.addEventListener(\'mouseenter\'')
    );

    assert.match(timeline, /TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES = new Set\(\['primary', 'root', 'banquet'\]\)/);
    assert.match(timeline, /TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set\(\['activity', 'service', 'manual'\]\)/);
    assert.match(inspectorFunction, /TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES\.has\(role\)\) return false/);
    assert.match(inspectorFunction, /TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES\.has\(role\)\) return true/);
    assert.match(previewFunction, /if \(!isRoomTimelineView\(\) \|\| !block\) return false/);
    assert.match(previewFunction, /if \(!timelineBanquetBlockCanOpenInspector\(block\)\) return false/);
    assert.match(previewFunction, /const state = block\._timelineBanquetInspectorState/);
    assert.match(previewFunction, /if \(!block\._timelineBanquetSummary && !state\) return false/);
    assert.match(previewFunction, /showTimelineBanquetInspector\(event, block\._timelineBanquetSummary \|\| null, block, \{/);
    assert.match(timeline, /const targetRole = timelineBanquetPreviewRoleForTarget\(target, previewRolesByBookingId\)/);
    assert.match(timeline, /setTimelineBanquetPreviewRole\(target\.block, targetRole\)/);
    assert.match(openDetailsFunction, /const ownId = String\(renderBooking\?\.id \|\| ''\)\.trim\(\)/);
    assert.match(openDetailsFunction, /const linkedId = String\(renderBooking\?\.linkedTo \|\| renderBooking\?\.linked_to \|\| ''\)\.trim\(\)/);
    assert.match(openDetailsFunction, /const targetId = ownId \|\| linkedId/);
    assert.match(openDetailsFunction, /const timelineView = typeof timelineCurrentViewKey === 'function' \? timelineCurrentViewKey\(\) : null/);
    assert.match(openDetailsFunction, /const ownDetailsOptions = \{[\s\S]*source: 'timeline_block_click'[\s\S]*fallbackBooking: renderBooking[\s\S]*\}/);
    assert.match(openDetailsFunction, /const detailMisses = \[\]/);
    assert.match(openDetailsFunction, /const collectDetailMiss = phase => diagnostic =>/);
    assert.match(openDetailsFunction, /showBookingDetails\(targetId, \{[\s\S]*silentMissing: true[\s\S]*\.\.\.ownDetailsOptions[\s\S]*onMissing: collectDetailMiss\(linkedId \? 'linked_child' : 'direct'\)[\s\S]*\}\)/);
    assert.match(openDetailsFunction, /if \(linkedId && ownId && ownId !== linkedId\)/);
    assert.match(openDetailsFunction, /showBookingDetails\(linkedId, \{[\s\S]*silentMissing: true[\s\S]*source: 'timeline_block_click_parent_fallback'[\s\S]*onMissing: collectDetailMiss\('linked_parent'\)[\s\S]*\}\)/);
    assert.match(openDetailsFunction, /Booking block could not be opened in current timeline view/);
    assert.match(openDetailsFunction, /timelineBookingDetailModalIsOpen\(\)/);
    assert.match(openDetailsFunction, /timelineProbeBookingOpenDiagnostic\(probeId, linkedId \? 'linked_child_probe' : 'direct_probe'\)/);
    assert.match(openDetailsFunction, /const publicCode = lastDiagnostic\?\.code \|\| 'TL-BK-OPEN-MISS'/);
    assert.match(openDetailsFunction, /Код: \$\{publicCode\}/);
    assert.match(openDetailsFunction, /source: 'timeline_block_click'/);
    assert.doesNotMatch(openDetailsFunction, /timelineOpenRecoveredBookingDetails/);
    assert.doesNotMatch(timeline, /TL-BK-DETAIL-RECOVERY-OPENED/);
    assert.doesNotMatch(timeline, /bookingDetails\.innerHTML/);
    assert.doesNotMatch(
        openDetailsFunction,
        /customer(?:Id|Name|Phone|Instagram|Email)|child(?:Name|Birthday)|phone|instagram|authorization|bearer|token|password|secret/i
    );
    assert.doesNotMatch(openDetailsFunction, /showBookingDetails\(\s*renderBooking\.(?:linkedTo|linked_to)\s*\)/);
    assert.doesNotMatch(timeline, /showBookingDetails\(\s*booking\.(?:linkedTo|linked_to)\s*\)/);
    assert.match(linkedClickBlock, /if \(showTimelineBanquetPreviewFromBlock\(e, block\)\) return;\s*void openTimelineBookingDetailsFromBlock\(renderBooking\)/);
    assert.match(ownClickBlock, /if \(showTimelineBanquetPreviewFromBlock\(e, block\)\) return;\s*void openTimelineBookingDetailsFromBlock\(renderBooking\)/);
});

test('timeline block click open helper calls booking details with expected ids and fallback behavior', async () => {
    const timeline = read('js/timeline.js');
    const helperStart = timeline.indexOf('function timelineBookingDetailModalIsOpen');
    const openStart = timeline.indexOf('async function openTimelineBookingDetailsFromBlock');
    const openEnd = timeline.indexOf('document.addEventListener', openStart);
    assert.ok(helperStart >= 0 && helperStart < openStart, 'timeline block open helper dependencies exist');
    assert.ok(openStart >= 0 && openEnd > openStart, 'timeline block open helper source exists');

    const warnings = [];
    const notifications = [];
    const context = {
        console: {
            warn: (...args) => warnings.push(args)
        },
        timelineCurrentViewKey: () => 'rooms',
        showNotification: (...args) => notifications.push(args),
        showBookingDetails: async () => false
    };
    vm.createContext(context);
    vm.runInContext(`
        ${timeline.slice(helperStart, openEnd)}
        this.__openTimelineBookingDetailsFromBlock = openTimelineBookingDetailsFromBlock;
    `, context, { filename: 'js/timeline.js' });

    const openFromBlock = context.__openTimelineBookingDetailsFromBlock;

    let calls = [];
    context.showBookingDetails = async (id, options) => {
        calls.push({ id, options });
        return id === 'BK-OWN';
    };
    assert.equal(await openFromBlock({ id: 'BK-OWN' }), true);
    assert.deepEqual(plain(calls), [
        { id: 'BK-OWN', options: { silentMissing: true, source: 'timeline_block_click', fallbackBooking: { id: 'BK-OWN' } } }
    ]);
    assert.equal(notifications.length, 0, 'valid own block does not show a missing-booking toast');

    calls = [];
    context.showBookingDetails = async (id, options) => {
        calls.push({ id, options });
        return id === 'BK-LINKED-CHILD';
    };
    assert.equal(await openFromBlock({ id: 'BK-LINKED-CHILD', linkedTo: 'BK-PARENT' }), true);
    assert.deepEqual(plain(calls), [
        { id: 'BK-LINKED-CHILD', options: { silentMissing: true, source: 'timeline_block_click', fallbackBooking: { id: 'BK-LINKED-CHILD', linkedTo: 'BK-PARENT' } } }
    ]);
    assert.equal(notifications.length, 0, 'valid linked child does not show a missing-booking toast');

    calls = [];
    warnings.length = 0;
    notifications.length = 0;
    context.showBookingDetails = async (id, options) => {
        calls.push({ id, options });
        if (typeof options?.onMissing === 'function') {
            options.onMissing({
                code: id === 'BK-MISSING' ? 'TL-BK-NOT-FOUND' : 'TL-BK-ID-MISS',
                bookingId: id,
                source: options.source || 'test',
                lookupSource: 'id-fetch-miss',
                status: 404,
                apiCode: null,
                offline: false,
                error: 'Booking not found'
            });
        }
        return false;
    };
    assert.equal(await openFromBlock({ id: 'BK-MISSING', linked_to: 'BK-MISSING-PARENT' }), false);
    assert.deepEqual(plain(calls), [
        { id: 'BK-MISSING', options: { silentMissing: true, source: 'timeline_block_click', fallbackBooking: { id: 'BK-MISSING', linked_to: 'BK-MISSING-PARENT' } } },
        { id: 'BK-MISSING-PARENT', options: { silentMissing: true, source: 'timeline_block_click_parent_fallback' } }
    ]);
    assert.equal(notifications.length, 1, 'full miss shows a single manager-facing toast');
    assert.match(notifications[0][0], /TL-BK-NOT-FOUND/);
    assert.equal(warnings.at(-1)?.[0], '[timeline] Booking block could not be opened in current timeline view');
    assert.equal(warnings.at(-1)?.[1]?.code, 'TL-BK-NOT-FOUND');
    assert.equal(warnings.at(-1)?.[1]?.timelineView, 'rooms');
    assert.equal(warnings.at(-1)?.[1]?.targetId, 'BK-MISSING');
    assert.equal(
        Object.keys(warnings.at(-1)?.[1] || {}).some(key => /customer|phone|instagram|child|authorization|bearer|token|password|secret/i.test(key)),
        false,
        'timeline miss diagnostics should not include customer, auth, or secret keys'
    );

    calls = [];
    warnings.length = 0;
    notifications.length = 0;
    context.showBookingDetails = async (id, options) => {
        calls.push({ id, options });
        return false;
    };
    context.apiGetBookingById = async id => ({
        success: false,
        status: id === 'BK-LEGACY-CHILD' ? 403 : 404,
        error: id === 'BK-LEGACY-CHILD' ? 'Forbidden' : 'Booking not found'
    });
    assert.equal(await openFromBlock({ id: 'BK-LEGACY-CHILD', linkedTo: 'BK-LEGACY-PARENT' }), false);
    assert.deepEqual(plain(calls), [
        { id: 'BK-LEGACY-CHILD', options: { silentMissing: true, source: 'timeline_block_click', fallbackBooking: { id: 'BK-LEGACY-CHILD', linkedTo: 'BK-LEGACY-PARENT' } } },
        { id: 'BK-LEGACY-PARENT', options: { silentMissing: true, source: 'timeline_block_click_parent_fallback' } }
    ]);
    assert.equal(notifications.length, 1, 'legacy no-diagnostic miss still shows a single manager-facing toast');
    assert.match(notifications[0][0], /TL-BK-FORBIDDEN/);
    assert.equal(warnings.at(-1)?.[1]?.code, 'TL-BK-FORBIDDEN');
    assert.equal(warnings.at(-1)?.[1]?.detailMisses?.[0]?.lookupSource, 'timeline-detail-probe-miss');

    calls = [];
    warnings.length = 0;
    notifications.length = 0;
    context.showBookingDetails = async (id, options) => {
        calls.push({ id, options });
        throw new Error(`render failed for ${id}`);
    };
    context.apiGetBookingById = async id => ({
        success: true,
        booking: {
            id,
            date: '2099-07-03',
            time: '16:00',
            duration: 60,
            room: 'Диван 2',
            programName: 'Анімація 60хв',
            status: 'confirmed',
            customerName: 'Sensitive Customer',
            phone: '+380000000000'
        }
    });
    assert.equal(await openFromBlock({ id: 'BK-RECOVERY-CHILD', linkedTo: 'BK-RECOVERY-PARENT' }), false);
    assert.equal(notifications.length, 1, 'detail API hit without canonical modal shows a single manager-facing toast');
    assert.match(notifications[0][0], /TL-BK-DETAIL-OK-OPEN-FAILED/);
    assert.deepEqual(calls.map(call => call.id), ['BK-RECOVERY-CHILD', 'BK-RECOVERY-PARENT']);
    assert.equal(warnings.at(-1)?.[0], '[timeline] Booking block could not be opened in current timeline view');
    assert.equal(warnings.at(-1)?.[1]?.code, 'TL-BK-DETAIL-OK-OPEN-FAILED');
    assert.equal(
        warnings.at(-1)?.[1]?.detailMisses?.some(item => item?.lookupSource === 'timeline-detail-probe-hit'),
        true,
        'detail API hit is preserved as a diagnostic, not a parallel modal renderer'
    );
    assert.equal(
        warnings.at(-1)?.[1]?.detailMisses?.some(item => item && (
            Object.prototype.hasOwnProperty.call(item, 'booking')
            || Object.keys(item).some(key => /customer|phone|instagram|child|authorization|bearer|token|password|secret/i.test(key))
        )),
        false,
        'timeline detail probe diagnostics should not include booking payloads or sensitive keys'
    );
});

test('timeline block click opens the canonical booking.js details modal', async () => {
    const timeline = read('js/timeline.js');
    const booking = read('js/booking.js');
    const helperStart = timeline.indexOf('function timelineBookingDetailModalIsOpen');
    const openStart = timeline.indexOf('async function openTimelineBookingDetailsFromBlock');
    const openEnd = timeline.indexOf('document.addEventListener', openStart);
    const resolverStart = booking.indexOf('function bookingDetailsFallbackMatchesCurrentSlice');
    const resolverEnd = booking.indexOf('function selectedBanquetCandidateRole', resolverStart);
    assert.ok(helperStart >= 0 && helperStart < openStart, 'timeline open helper dependencies exist');
    assert.ok(openStart >= 0 && openEnd > openStart, 'timeline open helper source exists');
    assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'canonical booking details source exists');

    const dom = new JSDOM(`
        <!doctype html>
        <html>
            <body>
                <div id="bookingModal" class="modal hidden" aria-hidden="true">
                    <div id="bookingDetails"></div>
                </div>
            </body>
        </html>
    `, { url: 'https://crm.example.test/' });
    const warnings = [];
    const notifications = [];
    const detailBooking = {
        id: 'BK-CANONICAL-DETAIL',
        date: '2099-07-03',
        time: '16:00',
        duration: 60,
        room: 'Диван 2',
        lineId: 'animator-1',
        programId: 'animation-60',
        programName: 'Анімація 60хв',
        programCode: 'AH',
        label: 'AH(60)',
        status: 'confirmed',
        hosts: 1,
        updatedAt: '2099-07-02T13:42:45.000Z'
    };
    const context = {
        console: {
            warn: (...args) => warnings.push(args)
        },
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        Date,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        AppState: { selectedDate: '2099-07-03' },
        timelineCurrentViewKey: () => 'rooms',
        currentCreatedBookingTimelineView: () => 'rooms',
        isRoomFirstTimelineView: () => true,
        isParkTimelineBookingMode: () => true,
        ROOM_FIRST_BANQUET_SERVICE_LINE_ID: 'banquet-service',
        createdBookingProjectionMatchesCurrentSlice: () => false,
        createdBookingTimelineProjection: () => ({}),
        createdBookingProjectionTimelineView: () => '',
        showNotification: (...args) => notifications.push(args),
        formatDate: value => String(value || '').slice(0, 10),
        normalizeBookingDateKey: value => String(value || '').slice(0, 10),
        getBookingsForDate: async () => [],
        apiGetBookingById: async id => id === detailBooking.id
            ? { success: true, booking: detailBooking }
            : { success: false, status: 404, error: 'Booking not found' },
        apiGetBanquetByBooking: async id => id === detailBooking.id
            ? {
                success: true,
                source: 'group',
                groupId: 'BQ-CANONICAL-DETAIL',
                group: {
                    id: 'BQ-CANONICAL-DETAIL',
                    groupName: 'Primary activity detail',
                    date: detailBooking.date,
                    room: detailBooking.room,
                    status: 'active'
                },
                members: [
                    { bookingId: detailBooking.id, role: 'primary', isPrimary: true, booking: detailBooking },
                    {
                        bookingId: 'BK-CANONICAL-DETAIL-HOST',
                        role: 'activity',
                        booking: {
                            id: 'BK-CANONICAL-DETAIL-HOST',
                            linkedTo: detailBooking.id,
                            date: detailBooking.date,
                            time: detailBooking.time,
                            duration: detailBooking.duration,
                            room: detailBooking.room,
                            programName: 'Additional host',
                            programCode: '+Host',
                            label: '+Host(60)',
                            status: 'confirmed'
                        }
                    }
                ],
                warnings: []
            }
            : { success: false, status: 404 },
        getLinesForDate: async () => [{ id: 'animator-1', name: 'Аніматор 1', color: '#2563eb' }],
        getAnimatorLinesForBookingDate: async () => [{ id: 'animator-1', name: 'Аніматор 1', color: '#2563eb' }],
        addMinutesToTime: (time, minutes) => {
            const [hours, rawMinutes] = String(time || '00:00').split(':').map(Number);
            const total = (Number.isFinite(hours) ? hours : 0) * 60
                + (Number.isFinite(rawMinutes) ? rawMinutes : 0)
                + Number(minutes || 0);
            const nextHours = String(Math.floor(total / 60) % 24).padStart(2, '0');
            const nextMinutes = String(total % 60).padStart(2, '0');
            return `${nextHours}:${nextMinutes}`;
        },
        isMaysternyaClosedSlotBooking: () => false,
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        getProductsSync: () => [{
            id: 'animation-60',
            name: 'Анімація 60хв',
            description: '',
            category: 'animation'
        }],
        getBookingEventCardRecord: bookingRecord => ({ title: bookingRecord.programName, imageUrl: '/images/event-card.png' }),
        educationLessonDetailsFromBooking: () => null,
        canAddAnimationFromRoomBooking: () => false,
        bookingDetailIsActivityWithRoomContext: () => true,
        resolveBookingDetailAnimatorDisplay: async () => 'Аніматор 1',
        buildBookingDetailsInviteModelFallback: () => ({
            payload: {
                inviteUrl: '#invite',
                fullInviteUrl: 'https://crm.example.test/invite',
                shortText: 'short invite',
                messengerText: 'messenger invite',
                instagramText: 'instagram invite',
                dateLabel: '2099-07-03',
                timeRangeLabel: '16:00 - 17:00',
                programLabel: 'Анімація 60хв',
                roomLabel: 'Диван 2',
                shareTitle: 'Event Genix'
            },
            previewChips: ['2099-07-03', '16:00 - 17:00', 'Анімація 60хв', 'Диван 2']
        }),
        renderFullBanquetDetail: () => '',
        bookingSummaryPreviewUrl: () => '/booking-summary.html?id=BK-CANONICAL-DETAIL',
        isViewer: () => false,
        canDeleteTimelineBooking: () => false,
        canEditTimelineBooking: () => false,
        shouldEditBookingInAnimatorView: () => false,
        bookingDetailModalTitle: bookingRecord => `${bookingRecord.programCode}: ${bookingRecord.programName}`,
        bookingKitchenChildrenCountFromBooking: () => 0,
        renderEducationLessonDetail: () => '',
        renderBookingWorkspaceDetail: () => '<div class="booking-detail-row"><span class="label">Сценарій:</span><span class="value">Додатковий ведучий</span></div>',
        renderBookingPackageDetail: () => '',
        getBookingPackageFromBooking: () => null,
        renderBookingCommentDetailRow: () => '',
        renderPinataDetailRows: () => '',
        bookingDetailHeaderPackageBooking: bookingRecord => bookingRecord,
        bookingDetailHeaderScheduleSummary: () => '',
        bookingDetailHeaderIsBanquetScheduleMode: () => false,
        bookingDetailIsBanquetArrivalMode: () => false,
        loadBanquetDepositStatusForDetails: () => {}
    };
    context.window.EventCards = {
        renderEventCardImage: record => `<img class="event-card-image event-card-image--booking" src="${context.escapeHtml(record.imageUrl)}" alt="${context.escapeHtml(record.title)}">`
    };
    context.window.BookingBanquetDetail = {
        renderFullBanquetDetail: () => {
            throw new Error('primary banquet optional renderer failed');
        }
    };
    context.window.InviteConfig = {};
    context.window.TimelineBusinessContext = {
        state: () => ({ activeBusinessContext: 'event_genix' }),
        current: () => ({ apiValue: 'event_genix' })
    };
    vm.createContext(context);
    vm.runInContext(`
        ${booking.slice(resolverStart, resolverEnd)}
        ${timeline.slice(helperStart, openEnd)}
        this.__openTimelineBookingDetailsFromBlock = openTimelineBookingDetailsFromBlock;
    `, context, { filename: 'timeline-booking-details-canonical.vm.js' });

    const opened = await context.__openTimelineBookingDetailsFromBlock({ id: detailBooking.id });
    const modal = dom.window.document.getElementById('bookingModal');
    const detailsHtml = dom.window.document.getElementById('bookingDetails').innerHTML;

    assert.equal(opened, true, JSON.stringify({
        warnings,
        notifications,
        detailsHtml
    }, null, 2));
    assert.equal(modal.classList.contains('hidden'), false, 'canonical modal is visible');
    assert.equal(notifications.length, 0, 'canonical open does not show a failure toast');
    assert.match(detailsHtml, /booking-detail-header booking-detail-header--compact/);
    assert.match(detailsHtml, /event-card-image--booking/);
    assert.match(detailsHtml, /Дата:/);
    assert.match(detailsHtml, /Час активності:/);
    assert.match(detailsHtml, /Аніматори:/);
    assert.match(detailsHtml, /Сценарій:/);
    assert.match(detailsHtml, /Статус:/);
    assert.match(detailsHtml, /Оновлено:/);
    assert.match(detailsHtml, /Редагувати/);
    assert.match(detailsHtml, /Банкетний лист/);
    assert.match(detailsHtml, /Ще/);
    assert.doesNotMatch(detailsHtml, /Recovery після detail API|TL-BK-DETAIL-RECOVERY-OPENED|Режим відкриття/);
    assert.equal(
        warnings.some(args => args[0] === '[booking] Optional booking detail section failed'
            && args[1]?.section === 'full-banquet-detail'
            && args[1]?.bookingId === detailBooking.id),
        true,
        'optional banquet renderer failure is logged without blocking the canonical modal'
    );
});

test('banquet delete flow invalidates snapshot-backed room preview caches', () => {
    const timeline = read('js/timeline.js');
    const booking = read('js/booking.js');

    assert.match(timeline, /function invalidateTimelineBanquetSnapshotCache/);
    assert.match(timeline, /TIMELINE_BANQUET_SNAPSHOT_CACHE\.byBooking\.clear\(\)/);
    assert.match(timeline, /TIMELINE_BANQUET_SNAPSHOT_CACHE\.byGroup\.clear\(\)/);
    assert.match(timeline, /window\.invalidateTimelineBanquetSnapshotCache = invalidateTimelineBanquetSnapshotCache/);
    assert.match(timeline, /function invalidateTimelineBanquetPreviewFreshness\(options = \{\}\)[\s\S]*if \(hasScopedTarget\) invalidateTimelineBanquetSnapshotCache\(options\)[\s\S]*clearTimelineBanquetRoomPreviews\(\)/);
    assert.match(timeline, /window\.invalidateTimelineBanquetPreviewFreshness = invalidateTimelineBanquetPreviewFreshness/);
    assert.match(timeline, /async function removeBookingBanquetLink[\s\S]*invalidateTimelineBanquetPreviewFreshness\(\{ bookingIds: \[sourceId, targetId\] \}\)/);
    assert.match(booking, /function invalidateBookingBanquetPreviewFreshness\(options = \{\}\)[\s\S]*window\.invalidateTimelineBanquetPreviewFreshness/);
    assert.match(booking, /apiDeleteBooking\(mainBookingId\)[\s\S]*invalidateBookingBanquetPreviewFreshness\(\{\s*bookingIds: allToDelete\.map\(item => item\?\.id\)\.filter\(Boolean\)\s*\}\)/);
});

test('room timeline keeps banquet root teaser visible when activity count reaches zero', () => {
    const timeline = read('js/timeline.js');

    assert.match(timeline, /function timelineBanquetSummaryHasPersistentRoot[\s\S]*category === 'banquet'/);
    assert.match(timeline, /function timelineBanquetSummaryHasPersistentRoot[\s\S]*summary\.groupId/);
    assert.match(timeline, /renderTimelineBanquetRoomCard[\s\S]*key: 'banquet'/);
    assert.match(timeline, /renderTimelineBanquetRoomCard[\s\S]*label: `\$\{activityCount\} \$\{timelineBanquetPlural\(activityCount, 'активність', 'активності', 'активностей'\)\}`/);
});

test('animator timeline keeps banquet teaser surfaces out of park animator view', () => {
    const timeline = read('js/timeline.js');
    const timelineResourceIdentity = read('js/timeline-resource-identity.js');

    assert.match(timeline, /function isParkAnimatorTimelineView/);
    assert.match(timeline, /function isTimelineBanquetServicePseudoLine/);
    assert.match(timeline, /function isTimelineRoomOnlyLine/);
    assert.match(timeline, /function isTimelineBanquetServiceBooking/);
    assert.match(timelineResourceIdentity, /function timelineCanonicalProjectionForCurrentView/);
    assert.match(timelineResourceIdentity, /function timelineBookingRenderHiddenReason/);
    assert.match(timeline, /\.filter\(line => !isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)\)/);
    assert.match(timeline, /\.filter\(booking => !booking\.timelineRenderHiddenReason\)/);
    assert.match(timeline, /function hydrateTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)/);
    assert.match(timeline, /function applyTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)\) return/);
    assert.doesNotMatch(timeline, /showTimelineBanquetServiceInspector/);
    assert.doesNotMatch(timeline, /data-banquet-preview-trigger/);
    assert.doesNotMatch(timeline, /data-banquet-service-marker/);
});

test('timeline summary exits loading state on booking fetch and render failures', () => {
    const timeline = read('js/timeline.js');
    const bookingFailureStart = timeline.indexOf('if (bookingFetchError && !Array.isArray(bookingsResult))');
    const criticalFetchStart = timeline.indexOf("console.error('[Timeline] Critical fetch error:', err)");
    const outerRenderStart = timeline.indexOf("console.error('[Timeline] CRITICAL renderTimeline error:', outerErr)");
    const bookingFailure = timeline.slice(bookingFailureStart, timeline.indexOf('bookings = normalizeTimelineBookingsForContext', bookingFailureStart));
    const criticalFetch = timeline.slice(criticalFetchStart, timeline.indexOf('// v7.0:', criticalFetchStart));
    const outerRenderFailure = timeline.slice(outerRenderStart, timeline.indexOf('// v8.6:', outerRenderStart));

    for (const block of [bookingFailure, criticalFetch, outerRenderFailure]) {
        assert.match(block, /dispatchTimelineSummaryChanged\(\{/);
        assert.match(block, /status: 'error'/);
        assert.match(block, /return false/);
    }
    assert.match(criticalFetch, /renderTimelineDataError\(container, err, selectedDate\)/);
});


test('timeline browser smoke runner covers two-way banquet bridge regressions', () => {
    const packageJson = JSON.parse(read('package.json'));
    const smoke = read('tests/browser/timeline-browser-smoke.js');

    assert.equal(
        packageJson.scripts['test:browser:timeline'],
        'npx --yes --package playwright node tests/browser/timeline-browser-smoke.js'
    );
    assert.match(smoke, /TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION/);
    assert.match(smoke, /refusing production timeline smoke with TIMELINE_BROWSER_SMOKE_CLEANUP=false/);
    assert.match(smoke, /DISPOSABLE_QA_SOURCE: QA_CLEANUP_SOURCE/);
    assert.match(smoke, /attachSharedDisposableQaMarker/);
    assert.match(smoke, /expected-booking/);
    assert.match(smoke, /function cleanupBanquetGroups/);
    assert.match(smoke, /banquet-production-recovery\.js/);
    assert.match(smoke, /--confirm=\$\{QA_CLEANUP_CONFIRMATION\}/);
    assert.match(smoke, /refusing non-local browser smoke/);
    assert.match(smoke, /function requirePlaywright/);
    assert.match(smoke, /function waitForTimelineReady/);
    assert.match(smoke, /TIMELINE_BROWSER_SMOKE_RATE_LIMIT_RETRY_MS \|\| 65000/);
    assert.match(smoke, /function waitForLegacyTimelineTypeSwitchRemoved/);
    assert.match(smoke, /function writeTimelineFailureDiagnostic/);
    assert.match(smoke, /canonical room timeline reveal succeeds: \$\{JSON\.stringify\(attempts\)\}/);
    assert.match(smoke, /function ensureKitchenTicketQuoteReady/);
    assert.match(smoke, /BookingTickets\?\.quoteNow/);
    assert.match(smoke, /BookingTickets\?\.collect/);
    const kitchenSubmitStart = smoke.indexOf('async function fillKitchenAndSubmit');
    const kitchenSubmitEnd = smoke.indexOf('async function assertTimelineDeepLinkSwitching', kitchenSubmitStart);
    const kitchenSubmit = smoke.slice(kitchenSubmitStart, kitchenSubmitEnd);
    assert.match(kitchenSubmit, /ensureKitchenTicketQuoteReady/);
    assert.match(kitchenSubmit, /BookingTickets\.reset\(\)/);
    assert.match(kitchenSubmit, /BookingTickets\.setActive\(false\)/);
    assert.match(smoke, /output', 'playwright', 'timeline-browser-smoke'/);
    assert.match(smoke, /execution context was destroyed/);
    assert.match(smoke, /serviceWorker/);
    assert.match(smoke, /typeSwitch/);
    assert.match(smoke, /function assertTimelineViewPanelInteractions/);
    assert.match(smoke, /\/api\/banquets\/from-source\/member-booking/);
    assert.match(smoke, /banquetContext:\s*\{\s*mode: 'new',\s*groupId: null,\s*guestArrivalTime: activitySnapshot\.group\?\.guestArrivalTime/);
    assert.match(smoke, /\/api\/banquets\/from-source\/activity-booking/);
    assert.match(smoke, /function openActiveBanquetEmptyCellDrawer/);
    assert.match(smoke, /page\.evaluate\(async \(\{ date, room, time, snapshot \}\) =>/);
    assert.match(smoke, /\}, \{ date, room, time, snapshot \}\);/);
    assert.match(smoke, /function ensureActiveBanquetMemberDrawer/);
    assert.match(smoke, /function clickActiveBanquetMemberSubmit/);
    assert.match(smoke, /function submitActiveBanquetMemberFromEmptyCell/);
    const emptyCellSubmitStart = smoke.indexOf('async function submitActiveBanquetMemberFromEmptyCell');
    const emptyCellSubmitEnd = smoke.indexOf('async function chooseFirstActivityProgram', emptyCellSubmitStart);
    const emptyCellSubmit = smoke.slice(emptyCellSubmitStart, emptyCellSubmitEnd);
    assert.match(emptyCellSubmit, /clickActiveBanquetMemberSubmit/);
    assert.match(emptyCellSubmit, /setBookingKitchenEnabled\(false/);
    assert.doesNotMatch(emptyCellSubmit, /dispatchEvent\(new Event\('submit'/);
    const kitchenActivitySubmitStart = smoke.indexOf('async function submitActivityFromKitchen');
    const kitchenActivitySubmitEnd = smoke.indexOf('async function assertRoomMarkerVisible', kitchenActivitySubmitStart);
    const kitchenActivitySubmit = smoke.slice(kitchenActivitySubmitStart, kitchenActivitySubmitEnd);
    assert.match(kitchenActivitySubmit, /acknowledgeGuestArrivalPromptIfVisible/);
    assert.match(kitchenActivitySubmit, /locator\('#bookingForm \.btn-submit'\)\.click\(\)/);
    assert.doesNotMatch(kitchenActivitySubmit, /dispatchEvent\(new Event\('submit'/);
    assert.match(smoke, /active inspector -> empty cell/);
    assert.match(smoke, /\/api\/banquets\/\$\{encodeURIComponent\(groupId\)\}\/member-booking/);
    assert.match(smoke, /genericBookingRequests/);
    assert.match(smoke, /does not use generic booking endpoints/);
    assert.match(smoke, /activity first -> kitchen/);
    assert.match(smoke, /kitchen first -> activity/);
    assert.match(smoke, /date: kitchenFirstDate,\s*time: '13:00'/);
    assert.doesNotMatch(smoke, /time: '18:15'/);
    assert.match(smoke, /kitchenFirstDate, 'rooms', \{ forceBookings: true \}/);
    assert.match(smoke, /findKitchenFirstSmokeDate/);
    assert.match(smoke, /source kitchen -> activity endpoint returns ok: \$\{responseDiagnostic\}/);
    assert.match(smoke, /timeline render error: \$\{renderState\.errorText\}/);
    assert.match(smoke, /label: `banquet snapshot \$\{bookingId\}`/);
    const kitchenFirstCreateStart = smoke.indexOf('const kitchenFirstCreate = await createBooking');
    const kitchenFirstCreateEnd = smoke.indexOf('recordCreatedBookingIds(createdBookingIds, kitchenFirstCreate)', kitchenFirstCreateStart);
    assert.doesNotMatch(
        smoke.slice(kitchenFirstCreateStart, kitchenFirstCreateEnd),
        /banquetGuests/,
        'kitchen-first bridge source must stay non-ticketed'
    );
    assert.match(smoke, /Банкетів цього клієнта на дату не знайдено/);
    assert.match(smoke, /Без прив.?язки/);
    assert.match(smoke, /function waitForLegacyTimelineTypeSwitchRemoved/);
    assert.match(smoke, /showBookingInRoomTimeline\(bookingId, bookingDate\)/);
    assert.match(smoke, /cancelled group is absent from active banquet API/);
    assert.match(smoke, /\.timeline-room-service-marker\[data-booking-id/);
    assert.match(smoke, /assertKitchenHiddenFromAnimator/);
    assert.match(smoke, /assertRoomMarkerVisible/);
    assert.match(smoke, /async function runRevealAction/);
    assert.match(smoke, /await showBookingDetails\(id\)/);
    assert.match(smoke, /window\.TimelineView\?\.set\?\.\('rooms', \{ render: false \}\)/);
    assert.match(smoke, /window\.TimelineView\?\.set\)\s*await window\.TimelineView\.set\('animators', \{ render: false \}\)/);
});

test('room-to-animator timeline view switch reconciles vertical shell height', () => {
    const timeline = read('js/timeline.js');
    const app = read('js/app.js');
    const ui = read('js/ui.js');
    const css = read('css/timeline.css');
    const responsive = read('css/responsive.css');

    assert.match(ui, /function syncTimelineViewHeight/);
    assert.match(ui, /function resetTimelineVerticalScroll/);
    assert.match(ui, /scroll\.scrollTop = 0/);
    assert.match(ui, /resetVerticalScroll: detail\.view !== detail\.previousView/);
    assert.match(ui, /function scheduleTimelineViewHeightSync/);
    assert.match(ui, /window\.addEventListener\?\.\('timeline:view-changed'/);
    assert.match(ui, /container\.dataset\.timelineView = view/);
    assert.match(ui, /container\.dataset\.lineCount = String\(lineCount\)/);
    assert.match(ui, /--timeline-content-height/);
    assert.match(timeline, /resetTimelineVerticalScroll\('view-switch-before-render'\)/);
    assert.match(timeline, /scheduleTimelineViewHeightSync\('render-complete'\)/);
    assert.match(app, /document\.body\?\.classList\?\.toggle\('timeline-view-panel-open', nextOpen\)/);
    assert.match(app, /scheduleTimelineViewHeightSync\(nextOpen \? 'view-panel-open' : 'view-panel-close'\)/);
    assert.match(css, /body\.timeline-view-animators \.timeline-container\[data-timeline-height-ready="true"\]/);
    assert.match(css, /body\.timeline-dashboard-page\.timeline-view-panel-open \.timeline-container/);
    assert.match(css, /--timeline-shell-max-height: clamp\(360px, calc\(var\(--eg-viewport-height, 100vh\) - 336px\), 62vh\)/);
    assert.match(css, /--timeline-shell-max-height: clamp\(360px, calc\(var\(--eg-viewport-height, 100dvh\) - 336px\), 62dvh\)/);
    assert.match(css, /body\.timeline-dashboard-page\.timeline-view-rooms\.timeline-view-panel-open \.timeline-container\s*\{[\s\S]*height:\s*var\(--timeline-shell-max-height\);[\s\S]*max-height:\s*var\(--timeline-shell-max-height\);/);
    assert.match(css, /body\.timeline-dashboard-page\.timeline-view-rooms\.timeline-view-panel-open \.timeline-scroll\s*\{[\s\S]*overflow-x:\s*scroll;[\s\S]*overflow-y:\s*scroll;[\s\S]*scrollbar-gutter:\s*stable both-edges;/);
    assert.match(css, /max-height: min\(var\(--timeline-content-height\), var\(--timeline-shell-max-height\)\)/);
    assert.match(responsive, /body\.timeline-dashboard-page\.timeline-view-animators \.timeline-container\[data-timeline-height-ready="true"\]/);
    assert.match(responsive, /v0\.73\.80: iPhone 11\/Safari needs a definite container height/);
    assert.match(responsive, /height: clamp\(360px, calc\(var\(--eg-viewport-height, 100dvh\) - 250px\), 58dvh\) !important;/);
});

test('timeline dynamic width contract derives surfaces from range and cell geometry', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');
    const helperStart = timeline.indexOf('function getTimelineCellWidth');
    const helperEnd = timeline.indexOf('function timelineBookingBlockDensity');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'timeline geometry helpers are locatable');

    const helperSource = timeline.slice(helperStart, helperEnd);
    const styleTargets = [];
    const cell = { getBoundingClientRect: () => ({ width: 40 }) };
    const header = { getBoundingClientRect: () => ({ width: 96 }) };
    const makeTarget = () => {
        const vars = new Map();
        const target = {
            vars,
            style: {
                setProperty(name, value) {
                    vars.set(name, value);
                }
            },
            addEventListener() {},
            closest(selector) {
                return selector === '.timeline-container' ? container : null;
            },
            querySelector(selector) {
                return selector === '.grid-cell' ? cell : null;
            },
            getBoundingClientRect: () => ({ width: 0 })
        };
        styleTargets.push(target);
        return target;
    };
    const container = makeTarget();
    const scroll = makeTarget();
    const lines = makeTarget();
    const timeScale = makeTarget();
    const addLineBtn = makeTarget();
    const grid = makeTarget();
    scroll.closest = selector => selector === '.timeline-container' ? container : null;

    const context = {
        CONFIG: { TIMELINE: { CELL_MINUTES: 15, CELL_WIDTH: 40 } },
        getTimeRange: () => ({ start: '17:45', end: '20:00' }),
        document: {
            getElementById(id) {
                return {
                    timelineScroll: scroll,
                    timelineLines: lines,
                    timeScale,
                    addLineBtn
                }[id] || null;
            },
            querySelector(selector) {
                if (selector === '.line-header') return header;
                if (selector === '.timeline-container') return container;
                if (selector === '.line-grid[data-line-id]') return grid;
                return null;
            }
        },
        window: {
            addEventListener() {},
            visualViewport: { addEventListener() {} }
        },
        requestAnimationFrame: () => 1
    };
    vm.createContext(context);
    vm.runInContext(helperSource, context);

    const geometry = context.syncTimelineContentWidth(new Date('2026-06-19T00:00:00'), grid);
    assert.equal(geometry.cellWidth, 40);
    assert.equal(geometry.gridWidth, 360);
    assert.equal(geometry.headerWidth, 96);
    assert.equal(geometry.contentWidth, 456);
    for (const target of [container, scroll, lines, timeScale, addLineBtn]) {
        assert.equal(target.vars.get('--timeline-grid-width'), '360px');
        assert.equal(target.vars.get('--timeline-content-width'), '456px');
    }

    const helperContractEnd = timeline.indexOf('function visibleTimelineAddLineParts');
    assert.ok(helperContractEnd > helperStart, 'timeline width contract block is locatable');
    const helperBlock = timeline.slice(timeline.indexOf('function timelineRangeBoundMinutes'), helperContractEnd);
    assert.match(helperBlock, /if \(endMinutes <= startMinutes\) endMinutes \+= 24 \* 60/);
    assert.match(helperBlock, /timelineRangeCellCount\(date\) \* cellWidth/);
    assert.doesNotMatch(helperBlock, /timelineRangeMarkCount\(date\) \* cellWidth/);
    assert.doesNotMatch(helperBlock, /17:45|20:00|clientWidth|innerWidth|viewport/i);

    assert.equal(cssDeclaration(cssRule(css, '.timeline-scroll'), '--timeline-content-width'), '100%');
    assert.equal(cssDeclaration(cssRule(css, '.timeline-scroll'), '--timeline-grid-width'), 'max-content');
    assert.equal(cssDeclaration(cssRule(css, '.time-scale'), 'width'), 'var(--timeline-grid-width, max-content)');
    assert.equal(cssDeclaration(cssRule(css, '.time-scale'), 'min-width'), 'var(--timeline-grid-width, max-content)');
    assert.equal(cssDeclaration(cssRule(css, '.timeline-lines'), 'width'), 'var(--timeline-content-width, 100%)');
    assert.equal(cssDeclaration(cssRule(css, '.timeline-line'), 'width'), 'var(--timeline-content-width, 100%)');
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const lineGridRule = cssRuleIncludingSelector(cssWithoutComments, '.line-grid');
    assert.equal(cssDeclaration(lineGridRule, 'flex'), '0 0 var(--timeline-grid-width, auto)');
    assert.equal(cssDeclaration(lineGridRule, 'width'), 'var(--timeline-grid-width, auto)');
    assert.equal(cssDeclaration(lineGridRule, 'min-width'), 'var(--timeline-grid-width, 0)');
    assert.equal(cssDeclaration(cssRule(css, '.btn-add-line-big'), 'width'), 'var(--timeline-content-width, 100%)');
    assert.equal(cssDeclaration(cssRule(css, '.btn-add-line-big'), 'min-width'), 'var(--timeline-content-width, 100%)');
    assert.doesNotMatch(cssDeclaration(cssRule(css, '.btn-add-line-big'), 'transition'), /^all\b/);
    assert.equal(cssDeclaration(cssRule(css, '.btn-add-line-big--centered-cta > span'), 'transform'), 'translateX(var(--timeline-add-cta-x, 0px))');

    const responsiveCss = read('css/responsive.css');
    const responsiveWithoutComments = responsiveCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
        cssDeclaration(cssRuleIncludingSelector(responsiveWithoutComments, 'body.timeline-dashboard-page .time-scale'), 'width'),
        'var(--timeline-grid-width, max-content) !important'
    );
    assert.equal(
        cssDeclaration(cssRuleIncludingSelector(responsiveWithoutComments, 'body.timeline-dashboard-page .timeline-lines'), 'width'),
        'var(--timeline-content-width, 100%) !important'
    );
    assert.equal(
        cssDeclaration(cssRuleIncludingSelector(responsiveWithoutComments, 'body.timeline-dashboard-page .timeline-line'), 'width'),
        'var(--timeline-content-width, 100%) !important'
    );
    assert.equal(
        cssDeclaration(cssRuleIncludingSelector(responsiveWithoutComments, 'body.timeline-dashboard-page .line-grid'), 'flex'),
        '0 0 var(--timeline-grid-width, auto) !important'
    );
    assert.equal(
        cssDeclaration(cssRuleIncludingSelector(responsiveWithoutComments, 'body.timeline-dashboard-page .btn-add-line-big'), 'min-width'),
        'var(--timeline-content-width, 100%) !important'
    );
});

test('timeline time marker placement clamps start label without overlapping the first interval mark', () => {
    const timeline = read('js/timeline.js');
    const helperStart = timeline.indexOf('function getTimelineCellWidth');
    const helperEnd = timeline.indexOf('function timelineBookingBlockDensity');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'timeline geometry helpers are locatable');

    const helperSource = timeline.slice(helperStart, helperEnd);
    const cell = { getBoundingClientRect: () => ({ width: 40 }) };
    const grid = {
        querySelector(selector) {
            return selector === '.grid-cell' ? cell : null;
        },
        closest() {
            return null;
        }
    };
    const context = {
        CONFIG: { TIMELINE: { CELL_MINUTES: 15, CELL_WIDTH: 40 } },
        getTimeRange: () => ({ start: '10:00', end: '20:00' }),
        document: {
            querySelector() {
                return null;
            }
        },
        window: {
            getComputedStyle: () => ({ getPropertyValue: () => '' }),
            addEventListener() {},
            visualViewport: { addEventListener() {} }
        }
    };
    vm.createContext(context);
    vm.runInContext(helperSource, context);

    [
        { level: 15, cellWidth: 40, nextLabel: '10:15' },
        { level: 30, cellWidth: 54, nextLabel: '10:30' },
        { level: 60, cellWidth: 84, nextLabel: '11:00' }
    ].forEach(({ level, cellWidth, nextLabel }) => {
        context.CONFIG.TIMELINE.CELL_MINUTES = level;
        context.CONFIG.TIMELINE.CELL_WIDTH = cellWidth;
        cell.getBoundingClientRect = () => ({ width: cellWidth });

        const gridWidth = context.timelineRangeCellCount(new Date('2026-06-19T00:00:00')) * cellWidth;
        const placements = context.timelineTimeMarkPlacements(new Date('2026-06-19T00:00:00'), grid, { gridWidth, cellWidth });
        const startMark = placements[0];
        const firstIntervalMark = placements[1];
        const endMark = placements.at(-1);

        assert.equal(startMark.label, '10:00');
        assert.equal(firstIntervalMark.label, nextLabel);
        assert.equal(startMark.x, 0);
        assert.ok(startMark.left <= 0);
        assert.ok(startMark.left >= -(startMark.width / 2));
        assert.ok(startMark.right >= 0);
        assert.ok(startMark.right <= firstIntervalMark.left, `${startMark.label} overlaps ${firstIntervalMark.label}`);
        assert.ok(firstIntervalMark.left >= 0);
        assert.equal(endMark.right, gridWidth);
        assert.equal(
            context.timelineTimeToPixel(firstIntervalMark.label, new Date('2026-06-19T00:00:00'), grid),
            firstIntervalMark.x
        );
    });
});

test('timeline time marker placement thins minor labels when compact density cannot fit every interval', () => {
    const timeline = read('js/timeline.js');
    const helperStart = timeline.indexOf('function getTimelineCellWidth');
    const helperEnd = timeline.indexOf('function timelineBookingBlockDensity');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'timeline geometry helpers are locatable');

    const helperSource = timeline.slice(helperStart, helperEnd);
    const cell = { getBoundingClientRect: () => ({ width: 28 }) };
    const grid = {
        querySelector(selector) {
            return selector === '.grid-cell' ? cell : null;
        },
        closest() {
            return null;
        }
    };
    const context = {
        CONFIG: { TIMELINE: { CELL_MINUTES: 15, CELL_WIDTH: 28 } },
        getTimeRange: () => ({ start: '10:00', end: '20:00' }),
        document: {
            querySelector() {
                return null;
            }
        },
        window: {
            getComputedStyle: () => ({ getPropertyValue: () => '' }),
            addEventListener() {},
            visualViewport: { addEventListener() {} }
        }
    };
    vm.createContext(context);
    vm.runInContext(helperSource, context);

    const date = new Date('2026-06-19T00:00:00');
    [28, 38].forEach(cellWidth => {
        context.CONFIG.TIMELINE.CELL_WIDTH = cellWidth;
        cell.getBoundingClientRect = () => ({ width: cellWidth });

        const gridWidth = context.timelineRangeCellCount(date) * cellWidth;
        const placements = context.timelineTimeMarkPlacements(date, grid, { gridWidth, cellWidth });
        const labels = placements.map(mark => mark.label);

        assert.equal(labels[0], '10:00');
        assert.equal(labels[1], '10:30');
        assert.ok(!labels.includes('10:15'), 'quarter-hour label should be hidden when compact density cannot fit it');
        assert.ok(labels.includes('20:00'));
        assert.equal(placements.at(-1).right, gridWidth);

        for (let index = 1; index < placements.length; index += 1) {
            const previous = placements[index - 1];
            const current = placements[index];
            assert.ok(previous.right <= current.left, `${previous.label} overlaps ${current.label}`);
        }
    });
});

test('timeline time marker placement clamps end label without overlapping the previous mark', () => {
    const timeline = read('js/timeline.js');
    const helperStart = timeline.indexOf('function getTimelineCellWidth');
    const helperEnd = timeline.indexOf('function timelineBookingBlockDensity');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'timeline geometry helpers are locatable');

    const helperSource = timeline.slice(helperStart, helperEnd);
    const cell = { getBoundingClientRect: () => ({ width: 40 }) };
    const grid = {
        querySelector(selector) {
            return selector === '.grid-cell' ? cell : null;
        },
        closest() {
            return null;
        }
    };
    const context = {
        CONFIG: { TIMELINE: { CELL_MINUTES: 15, CELL_WIDTH: 40 } },
        getTimeRange: () => ({ start: '13:00', end: '20:00' }),
        document: {
            querySelector() {
                return null;
            }
        },
        window: {
            getComputedStyle: () => ({ getPropertyValue: () => '' }),
            addEventListener() {},
            visualViewport: { addEventListener() {} }
        }
    };
    vm.createContext(context);
    vm.runInContext(helperSource, context);

    [
        { level: 15, cellWidth: 40, previousLabel: '19:45' },
        { level: 30, cellWidth: 54, previousLabel: '19:30' },
        { level: 60, cellWidth: 84, previousLabel: '19:00' }
    ].forEach(({ level, cellWidth, previousLabel }) => {
        context.CONFIG.TIMELINE.CELL_MINUTES = level;
        context.CONFIG.TIMELINE.CELL_WIDTH = cellWidth;
        cell.getBoundingClientRect = () => ({ width: cellWidth });

        const gridWidth = context.timelineRangeCellCount(new Date('2026-06-19T00:00:00')) * cellWidth;
        const placements = context.timelineTimeMarkPlacements(new Date('2026-06-19T00:00:00'), grid, { gridWidth, cellWidth });
        const endMark = placements.at(-1);
        const previousMark = placements.at(-2);

        assert.equal(endMark.label, '20:00');
        assert.equal(previousMark.label, previousLabel);
        assert.equal(endMark.x, gridWidth);
        assert.equal(endMark.right, gridWidth);
        assert.ok(endMark.left >= 0);
        assert.ok(previousMark.right <= endMark.left, `${previousMark.label} overlaps ${endMark.label}`);
        assert.equal(
            context.timelineTimeToPixel(previousMark.label, new Date('2026-06-19T00:00:00'), grid),
            previousMark.x
        );
    });
});

test('timeline visual settings keep park animator and room views isolated', () => {
    assert.equal(normalizeTimelineVisibilityView('rooms'), 'rooms');
    assert.equal(normalizeTimelineVisibilityView('bad', 'animators'), 'animators');

    const animatorPayload = mergeTimelineVisibilityPayload({}, {
        timelineView: 'animators',
        blocks: {
            dateControls: { visible: false, order: 10 }
        }
    }, 'event_genix', {
        view: 'animators',
        updatedAt: '2026-06-15T10:00:00.000Z',
        updatedBy: 'creator'
    });

    const roomsPayload = mergeTimelineVisibilityPayload(animatorPayload, {
        timelineView: 'rooms',
        blocks: {
            dateControls: { visible: true, order: 90 },
            legend: { visible: false, density: 'compact' }
        }
    }, 'event_genix', {
        view: 'rooms',
        updatedAt: '2026-06-15T10:05:00.000Z',
        updatedBy: 'creator'
    });

    const animators = timelineVisibilityResponse(roomsPayload, 'event_genix', { view: 'animators' });
    const rooms = timelineVisibilityResponse(roomsPayload, 'event_genix', { view: 'rooms' });

    assert.equal(animators.view, 'animators');
    assert.equal(rooms.view, 'rooms');
    assert.equal(animators.blocks.dateControls.visible, false);
    assert.equal(animators.blocks.dateControls.order, 10);
    assert.equal(rooms.blocks.dateControls.visible, true);
    assert.equal(rooms.blocks.dateControls.order, 90);
    assert.equal(rooms.blocks.legend.visible, false);
    assert.equal(rooms.views.animators.blocks.dateControls.visible, false);
    assert.equal(rooms.views.rooms.blocks.legend.density, 'compact');
});

test('timeline identity repair report is read-only and covers banquet duplicate marker risk', () => {
    const report = read('docs/TIMELINE_IDENTITY_BROKEN_ROWS_READONLY_2026-06-24.sql');
    const repairPlan = read('docs/TIMELINE_ANIMATION_IDENTITY_REPAIR_PLAN_2026-06-23.md');
    const stripped = report
        .replace(/--.*$/gm, '')
        .replace(/'[^']*'/g, "''");

    assert.match(report, /READ ONLY: this script only runs SELECT statements/);
    assert.match(report, /missing_line_id/);
    assert.match(report, /line_id_without_matching_resource/);
    assert.match(report, /timeline_identity_line_mismatch/);
    assert.match(report, /stored_missing_animator_resource/);
    assert.match(report, /computed_missing_animator_resource_candidate/);
    assert.match(report, /linked_missing_timeline_identity/);
    assert.match(report, /second_animator_missing_linked_booking/);
    assert.match(report, /banquet_activity_hidden_by_duplicate_marker_risk/);
    assert.match(report, /banquet_group_bookings/);
    assert.match(report, /banquet_groups/);
    assert.match(report, /booking_block/);
    assert.match(report, /service_marker/);
    assert.doesNotMatch(stripped, /\b(UPDATE|DELETE|INSERT|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i);

    assert.match(repairPlan, /TIMELINE_IDENTITY_BROKEN_ROWS_READONLY_2026-06-24\.sql/);
    assert.match(repairPlan, /banquet_activity_hidden_by_duplicate_marker_risk/);
    assert.match(repairPlan, /No data update/);
    assert.match(repairPlan, /fix code, not data/);
});

test('business operating profile owns shell start page and module visibility', () => {
    const service = read('services/businessProfile.js');
    const settingsRoute = read('routes/settings.js');
    const api = read('js/api.js');
    const auth = read('js/auth.js');
    const sidebar = read('js/components/sidebar.js');
    const html = read('index.html');

    assert.match(service, /async function buildBusinessOperatingProfile/);
    assert.match(service, /startPagePathForBusiness/);
    assert.match(service, /buildModuleMap/);
    assert.match(settingsRoute, /router\.get\('\/business\/profile'/);
    assert.match(api, /const crmBusinessProfileState/);
    assert.match(api, /async function hydrateCrmBusinessProfile/);
    assert.match(api, /source: 'server_business_profile'/);
    assert.match(api, /merge: false/);
    assert.match(api, /profileFor: getCrmBusinessProfileForContext/);
    assert.match(api, /startPageForUser: crmBusinessStartPageForUser/);
    assert.match(auth, /await hydrateBusinessOperatingProfile\(data\.user \|\| AppState\.currentUser\)/);
    assert.match(auth, /await hydrateBusinessOperatingProfile\(user\)/);
    assert.match(sidebar, /crmBusinessProfileChanged/);
    assert.match(html, /settingsBusinessProfileContract/);

    const disabledModules = buildModuleMap('event_genix', {
        mode: 'disabled',
        timelineEnabled: false,
        enabledModules: { timeline: false, leads: true, customers: true, omni: true, tasks: true }
    });
    assert.equal(disabledModules.enabled.timeline, false);
    assert.equal(disabledModules.enabled.leads, true);
    assert.equal(startPagePathForBusiness('event_genix', { mode: 'disabled', timelineEnabled: false, startPage: 'timeline' }), '/dashboard');
    assert.equal(startPagePathForBusiness('dar', { mode: 'simple', timelineEnabled: true, startPage: 'timeline' }), '/?businessContext=dar');
    assert.equal(startPagePathForBusiness('maysternya_doli', { mode: 'simple', timelineEnabled: true, startPage: 'timeline' }), '/maysternya-doli');
});

test('timeline context keeps explicit non-timeline CRM requests out of the default timeline', () => {
    const contextCode = read('js/timeline-context.js');

    assert.equal(timelineContextFromRequest({ query: { businessContext: 'dar' } }), 'dar');
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'unknown' } }), 'unknown');
    assert.equal(isTimelineContext('event_genix'), true);
    assert.equal(isTimelineContext('dar'), true);
    assert.equal(isTimelineContext('crm'), false);
    assert.equal(canAccessTimelineContext({ role: 'creator', business_contexts: ['event_genix', 'dar'] }, 'dar'), true);
    assert.equal(canAccessTimelineContext({ role: 'creator', business_contexts: ['event_genix', 'dar'] }, 'unknown'), false);
    assert.equal(canAccessTimelineContext({ role: 'creator', business_contexts: ['event_genix', 'crm'] }, 'crm'), false);
    assert.match(contextCode, /function contextForBusiness/);
    assert.doesNotMatch(contextCode, /if \(ctx\.key === 'event_genix'\) return url/);
    assert.doesNotMatch(contextCode, /if \(ctx\.key === 'event_genix'\) return payload/);
});

test('business cabinet is the persistent control surface for shell modules and timeline display', () => {
    const service = read('services/businessCabinet.js');
    const profile = read('services/businessProfile.js');
    const settingsRoute = read('routes/settings.js');
    const api = read('js/api.js');
    const settings = read('js/settings.js');
    const html = read('index.html');
    const css = read('css/features.css');

    assert.match(service, /business_cabinet:\$\{normalizeBusinessContext\(context\)\}/);
    assert.match(service, /function normalizeBusinessCabinetSettings/);
    assert.match(service, /async function saveBusinessCabinetSettings/);
    assert.match(service, /timeline_display:\$\{key\}/);
    assert.match(profile, /getBusinessCabinetSettings/);
    assert.match(profile, /cabinet\.businessType/);
    assert.match(profile, /cabinet\.startPage/);
    assert.match(settingsRoute, /router\.get\('\/business\/cabinet'/);
    assert.match(settingsRoute, /router\.put\('\/business\/cabinet'/);
    assert.match(settingsRoute, /isTimelineContext\(context\) && !requireTimelineAction\(req, res, context, 'settings'\)/);
    assert.match(api, /async function apiGetBusinessCabinet/);
    assert.match(api, /async function apiSaveBusinessCabinet/);
    assert.match(settings, /function renderBusinessCabinetModuleButtons/);
    assert.match(settings, /function collectBusinessCabinetModules/);
    assert.match(settings, /apiSaveBusinessCabinet/);
    assert.match(settings, /if \(result\?\.cabinet\)/);
    assert.match(settings, /Legacy display settings fallback unavailable/);
    assert.match(read('js/timeline-context.js'), /if \(displayMode\?\.key === 'park'\) return null/);
    assert.match(settings, /currentMode === 'park' \? 'auto' : button\.dataset\.timelineResourceModel/);
    assert.match(html, /settingsBusinessModuleGrid/);
    assert.match(html, /settingsBusinessGuardrails/);
    assert.match(css, /\.business-cabinet-guardrails/);

    const disabledCabinet = normalizeBusinessCabinetSettings({
        businessType: 'no_timeline',
        startPage: 'timeline',
        modules: { enabled: { dashboard: false, settings: false, timeline: true } }
    }, 'event_genix');
    assert.equal(disabledCabinet.businessType, 'no_timeline');
    assert.equal(disabledCabinet.timelineMode, 'disabled');
    assert.equal(disabledCabinet.startPage, 'dashboard');
    assert.equal(disabledCabinet.modules.enabled.dashboard, true);
    assert.equal(disabledCabinet.modules.enabled.settings, true);
    assert.equal(disabledCabinet.modules.enabled.timeline, false);
    assert.ok(disabledCabinet.guardrails.includes('timeline_start_requires_enabled_timeline'));

    const darCabinet = normalizeBusinessCabinetSettings({}, 'dar');
    assert.equal(darCabinet.businessType, 'simple');
    assert.equal(darCabinet.startPage, 'timeline');
    assert.equal(darCabinet.timelineEnabled, true);
    assert.equal(darCabinet.timelineMode, 'simple');

    const timeline = timelineDisplayFromBusinessCabinet({
        businessContext: 'maysternya_doli',
        businessType: 'simple',
        startPage: 'timeline',
        modules: { enabled: { timeline: true, leads: true, customers: true, omni: true, tasks: true } }
    });
    assert.equal(timeline.mode, 'simple');
    assert.equal(timeline.startPage, 'timeline');
    assert.equal(timeline.context, 'maysternya_doli');
});
