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
    timelineResourceAvailability
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
    lockBookingConflictResources
} = require('../services/booking');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function createTimelineBanquetMarkerHarness() {
    const timeline = read('js/timeline.js');
    const start = timeline.indexOf('function timelineExtraData');
    const end = timeline.indexOf('function clearTimelineBanquetRoomPreviews');
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
        AppState: { selectedDate: new Date('2099-06-18T00:00:00') },
        CONFIG: { TIMELINE: { CELL_MINUTES: 30, CELL_WIDTH: 50 } },
        isRoomTimelineView: () => viewState.room,
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
    vm.runInContext(timeline.slice(start, end), context, { filename: 'js/timeline.js' });
    return context;
}

function createTimelineBanquetMarkerScenario(bookingPackage) {
    const ctx = createTimelineBanquetMarkerHarness();
    const kitchenBooking = {
        id: 'BK-KITCHEN',
        date: '2099-06-18',
        time: '11:00',
        room: 'Room A',
        extraData: { bookingPackage }
    };
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
        menuPreviewItems: (bookingPackage.menuPositions || []).map(item => ({
            title: item.title,
            servingTime: item.servingTime
        })),
        warnings: []
    };
    const servingInfo = ctx.timelineBanquetServingInfo(summary);
    const inspectorSummary = ctx.timelineBanquetSummaryForInspector(summary, servingInfo, kitchenBooking);
    return { ctx, inspectorSummary };
}

function renderTimelineBanquetRoomGridMarkers(bookingPackage, options = {}) {
    const { ctx, inspectorSummary } = createTimelineBanquetMarkerScenario(bookingPackage);
    ctx.__timelineViewState.room = options.roomView !== false;
    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    return {
        ctx,
        inspectorSummary,
        markers: Array.from(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker')).map(node => ({
            type: node.dataset.banquetRoomMarker,
            text: node.textContent.trim(),
            time: node.dataset.markerTime,
            parentClass: node.parentElement?.className || '',
            left: node.style.left,
            top: node.style.top,
            ariaHaspopup: node.getAttribute('aria-haspopup')
        }))
    };
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
    assert.match(service, /b\.line_id = ANY\(\$3::text\[\]\) OR b\.room = ANY\(\$4::text\[\]\)/);
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
    assert.match(bookingService, /\^line\[0-9\]\{1,3\}\(_/);
    assert.doesNotMatch(bookingService, /\^line\[0-9\]\+\(_/);
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
    assert.match(linesRoute, /BANQUET_SERVICE_LINE_ID/);
    assert.match(linesRoute, /String\(row\.line_id \|\| ''\)\.trim\(\) === BANQUET_SERVICE_LINE_ID/);
    assert.match(linesRoute, /!isLegacyRoomTimelineLineRow\(row\)/);
    assert.match(bookingsRoute, /projectBookingsForTimelineView/);
    assert.match(bookingsRoute, /function bookingMatchesBanquetServiceLine/);
    assert.match(bookingsRoute, /function isBanquetServiceTimelineBooking/);
    assert.match(bookingsRoute, /function isBanquetServiceRootBooking/);
    assert.match(bookingsRoute, /function isRoomProjectableBanquetServiceRootBooking/);
    assert.match(bookingsRoute, /BANQUET_SERVICE_LINE_ID/);
    assert.match(bookingsRoute, /return bookings\.filter\(booking => !isBanquetServiceTimelineBooking\(booking\)\)/);
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
    assert.match(timeline, /if \(!shouldRenderBookingVisualLink\(link\)\) return/);
    assert.match(timeline, /const targetBlock = blockById\.get\(targetId\)/);
    assert.match(timeline, /if \(!targetBlock\) return/);
    assert.match(timeline, /function defaultTimelineViewMode\(\)/);
    assert.match(timeline, /presentation\?\.\(\)\?\.defaultTimelineView/);
    assert.match(timeline, /TIMELINE_VIEW_USER_CHOICE_VERSION/);
    assert.match(timeline, /function roomLoadBookingMinutes/);
    assert.match(timeline, /TIMELINE_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(timeline, /function isParkAnimatorTimelineView/);
    assert.match(timeline, /function isTimelineBanquetServicePseudoLine/);
    assert.match(timeline, /function isTimelineBanquetServiceBooking/);
    assert.match(timeline, /\.filter\(line => !isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)\)/);
    assert.match(timeline, /\.filter\(booking => !isTimelineBanquetServiceBooking\(booking\)\)/);
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
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park' }, 'event_genix').defaultTimelineView, 'animators');
    assert.equal(normalizeTimelineDisplaySettings({ mode: 'park', defaultTimelineView: 'rooms' }, 'event_genix').defaultTimelineView, 'rooms');
    assert.match(timeline, /assignmentMode = isRoomTimelineView\(\) \? 'room' : 'line'/);
    assert.match(booking, /ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(booking, /BOOKING_TAKEAWAY_ROOM_VALUE = 'На виніс'/);
    assert.match(booking, /takeawayOption\.dataset\.serviceRoom = 'takeaway'/);
    assert.match(booking, /bookingPrimaryAnimatorSelect/);
    assert.match(booking, /prefillRoomFirstCustomerFromRoomLine/);
    assert.match(booking, /shouldEditBookingInAnimatorView/);
    assert.match(booking, /openAnimationBookingInAnimatorView/);
    assert.match(booking, /openRoomBookingAnimationBridge/);
    assert.match(html, /id="timelineViewSelector"/);
    assert.match(html, /class="period-btn timeline-view-btn active" data-timeline-view="animators"/);
    assert.match(html, /<option value="animators" selected>Свята<\/option>/);
    assert.match(html, /id="settingsTimelineRoomFirstEnabled"/);
    assert.match(html, /id="settingsTimelineDefaultView"/);
    assert.match(migration, /MIGRATION_KIND: data-fix/);
    assert.match(migration, /'room-marvel', 'room', 'Марвел'/);
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

test('polluted room lines are quarantined from park animator timeline reads', () => {
    const linesRoute = read('routes/lines.js');
    const timeline = read('js/timeline.js');

    assert.match(linesRoute, /const ROOM_TIMELINE_ROOM_NAMES = new Set/);
    assert.match(linesRoute, /function isLegacyRoomTimelineLineRow/);
    assert.match(linesRoute, /lineId\.toLowerCase\(\) === 'room-takeaway'/);
    assert.match(linesRoute, /lineValueStartsWithRoomId\(lineId\)/);
    assert.match(linesRoute, /ROOM_TIMELINE_ROOM_NAMES\.has\(visibleName\)/);
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

test('free-room path becomes business-aware resource availability for cabinet modes', () => {
    const settings = read('routes/settings.js');
    const booking = read('js/booking.js');
    assert.match(settings, /timelineResourceAvailability/);
    assert.match(settings, /resourceTypeForDisplayMode\(display\.mode, display\)/);
    assert.match(settings, /COALESCE\(b\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(settings, /c\.name AS customer_name/);
    assert.match(booking, /appendApiContext\?\.\(`\/rooms\/free\/\$\{date\}\/\$\{time\}\/\$\{duration\}`\)/);
    assert.match(settings, /req\.query\.capacity \|\| req\.query\.attendees \|\| req\.query\.kidsCount/);
    assert.match(booking, /capacity=\$\{encodeURIComponent\(String\(requestedCapacity\)\)\}/);
    assert.match(booking, /data-free-room/);
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
        customer_name: 'Ушакова Ірина'
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
        customer_name: null
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
    assert.match(queries.find(query => /FROM bookings b/i.test(query.sql)).sql, /c\.name AS customer_name/);
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

test('room timeline banquet preview is room-only, frontend-only, and snapshot-backed', () => {
    const timeline = read('js/timeline.js');
    const css = read('css/timeline.css');

    assert.match(timeline, /TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES = new Set\(\['primary', 'root', 'banquet'\]\)/);
    assert.match(timeline, /TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set\(\['activity', 'service', 'manual'\]\)/);
    assert.match(timeline, /function timelineBanquetServingInfo/);
    assert.match(timeline, /timelineBanquetMenuPositions\(booking\)/);
    assert.match(timeline, /function timelineBanquetServiceEvents/);
    assert.match(timeline, /function applyTimelineBanquetPreview/);
    assert.match(timeline, /function renderTimelineBanquetRoomCard/);
    assert.match(timeline, /function showTimelineBanquetInspector/);
    assert.match(timeline, /function timelineBanquetPreviewRolesByBookingId/);
    assert.match(timeline, /function timelineBanquetBlockCanOpenInspector/);
    assert.match(timeline, /function timelineBanquetRoomCardSignals/);
    assert.match(timeline, /function timelineBanquetRoomServingSignals/);
    assert.match(timeline, /function normalizeTimelineBanquetServiceEventType/);
    assert.match(timeline, /function timelineBanquetServiceEventLabel/);
    assert.match(timeline, /function timelineBanquetSummaryHasPersistentRoot/);
    assert.match(timeline, /function timelineBanquetGlanceRows/);
    assert.match(timeline, /data-banquet-room-card/);
    assert.match(timeline, /data-banquet-room-marker/);
    assert.match(timeline, /dataset\.timelineBanquetPreviewRole/);
    assert.match(timeline, /requestIdleCallback/);
    assert.match(timeline, /function hydrateTimelineBanquetPreview[\s\S]*isRoomTimelineView\(\)/);
    assert.match(timeline, /function applyTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)\) return/);
    assert.match(timeline, /timelineBanquetServingInfo\(summary\)/);
    assert.match(timeline, /timelineBanquetRoomServingSignals\(servingMarkers\)/);
    assert.match(timeline, /signals\.push\(\.\.\.timelineBanquetRoomServingSignals\(servingMarkers\)\)/);
    assert.match(timeline, /case 'room_setup':\s*return 'Підготувати кімнату'/);
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
    assert.doesNotMatch(css, /\.timeline-banquet-chip/);
    assert.doesNotMatch(css, /\.timeline-banquet-service-marker/);
    assert.doesNotMatch(css, /timeline-banquet-room-card-icons/);
});

test('room timeline renders multiple menu serving markers inside the room grid', () => {
    const { ctx, markers } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [
            { id: 'item-a', title: 'Pizza', servingTime: '12:00' },
            { id: 'item-b', title: 'Juice', servingTime: '12:30' }
        ],
        serviceEvents: []
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 2);
    assert.deepEqual(markers.map(marker => marker.text), [
        'Видача 12:00',
        'Видача 12:30'
    ]);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'food_service']);
    assert.deepEqual(markers.map(marker => marker.time), ['12:00', '12:30']);
    assert.ok(markers.every(marker => marker.parentClass.includes('line-grid')));
    assert.notEqual(markers[0].left, markers[1].left);
    assert.ok(parseFloat(markers[1].left) > parseFloat(markers[0].left));
});

test('room timeline renders room_setup service event as a separate room-grid marker', () => {
    const { ctx, markers } = renderTimelineBanquetRoomGridMarkers({
        menuPositions: [],
        serviceEvents: [
            { id: 'setup-1', type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' }
        ]
    });

    assert.equal(ctx.document.querySelectorAll('.line-grid .timeline-room-service-marker').length, 1);
    assert.deepEqual(markers.map(({ type, text }) => ({ type, text })), [
        { type: 'room_setup', text: 'Підготувати кімнату 12:00' }
    ]);
    assert.equal(markers[0].time, '12:00');
    assert.ok(markers[0].parentClass.includes('line-grid'));
    assert.equal(markers[0].left, '200px');
    assert.equal(markers[0].top, '4px');
    assert.equal(markers[0].ariaHaspopup, 'dialog');
});

test('room timeline keeps mixed same-time room-grid markers without dedupe', () => {
    const { ctx, markers } = renderTimelineBanquetRoomGridMarkers({
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
    assert.deepEqual(markers.map(marker => marker.text), [
        'Видача 12:00',
        'Підготувати кімнату 12:00',
        'Видача 12:30'
    ]);
    assert.deepEqual(markers.map(marker => marker.type), ['food_service', 'room_setup', 'food_service']);
    assert.equal(markers.filter(marker => marker.text.endsWith('12:00')).length, 2);
    assert.equal(markers[0].left, markers[1].left);
    assert.notEqual(markers[0].top, markers[1].top);
    assert.notEqual(markers[1].left, markers[2].left);
    assert.ok(parseFloat(markers[2].left) > parseFloat(markers[1].left));
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

    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    assert.equal(ctx.document.querySelectorAll('.timeline-room-service-marker').length, 0);

    ctx.__timelineViewState.room = true;
    ctx.renderTimelineRoomServiceMarkers(inspectorSummary, { groupId: 'group-regression' });
    assert.equal(ctx.document.querySelectorAll('.timeline-room-service-marker').length, 3);
});

test('room-grid service marker lifecycle is scoped to room view and view-aware cache keys', () => {
    const timeline = read('js/timeline.js');
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
    const renderFetchIndex = timeline.indexOf('getLinesForDate(selectedDate)', renderStartIndex);
    const cacheScopeBlock = timeline.slice(
        timeline.indexOf('function timelineCacheScopeKey'),
        timeline.indexOf('function timelineDateKey')
    );

    assert.match(rendererBlock, /if \(!isRoomTimelineView\(\) \|\| !summary\) return/);
    assert.match(clearBlock, /clearTimelineRoomServiceMarkers\(\)/);
    assert.ok(setViewBlock.includes('clearTimelineBanquetRoomPreviews()'));
    assert.ok(setViewBlock.indexOf('clearTimelineBanquetRoomPreviews()') < setViewBlock.indexOf('await renderTimeline()'));
    assert.ok(renderClearIndex > renderStartIndex);
    assert.ok(renderFetchIndex > renderClearIndex);
    assert.match(cacheScopeBlock, /const timelineView = timelineCurrentView\(\)/);
    assert.match(cacheScopeBlock, /`\$\{context\}\|\$\{mode\}\|\$\{resourceType\}\|\$\{timelineView\}`/);
});

test('room timeline banquet activity blocks keep full booking modal click ownership', () => {
    const timeline = read('js/timeline.js');

    assert.match(timeline, /function timelineBanquetBlockCanOpenInspector[\s\S]*TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES\.has\(role\)\) return false/);
    assert.match(timeline, /function timelineBanquetBlockCanOpenInspector[\s\S]*TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES\.has\(role\)\) return true/);
    assert.match(timeline, /function showTimelineBanquetPreviewFromBlock[\s\S]*if \(!timelineBanquetBlockCanOpenInspector\(block\)\) return false;[\s\S]*showTimelineBanquetInspector\(event, block\._timelineBanquetSummary, block\)/);
    assert.match(timeline, /setTimelineBanquetPreviewRole\(target\.block, timelineBanquetPreviewRoleForTarget\(target, previewRolesByBookingId\)\)/);
    assert.match(timeline, /if \(showTimelineBanquetPreviewFromBlock\(e, block\)\) return;\s*showBookingDetails\(renderBooking\.id\)/);
});

test('banquet delete flow invalidates snapshot-backed room preview caches', () => {
    const timeline = read('js/timeline.js');
    const booking = read('js/booking.js');

    assert.match(timeline, /function invalidateTimelineBanquetSnapshotCache/);
    assert.match(timeline, /TIMELINE_BANQUET_SNAPSHOT_CACHE\.byBooking\.clear\(\)/);
    assert.match(timeline, /TIMELINE_BANQUET_SNAPSHOT_CACHE\.byGroup\.clear\(\)/);
    assert.match(timeline, /window\.invalidateTimelineBanquetSnapshotCache = invalidateTimelineBanquetSnapshotCache/);
    assert.match(timeline, /async function removeBookingBanquetLink[\s\S]*invalidateTimelineBanquetSnapshotCache\(\{ bookingIds: \[sourceId, targetId\] \}\)/);
    assert.match(booking, /window\.invalidateTimelineBanquetSnapshotCache\(\{\s*bookingIds: allToDelete\.map\(item => item\?\.id\)\.filter\(Boolean\)\s*\}\)/);
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

    assert.match(timeline, /function isParkAnimatorTimelineView/);
    assert.match(timeline, /function isTimelineBanquetServicePseudoLine/);
    assert.match(timeline, /function isTimelineRoomOnlyLine/);
    assert.match(timeline, /function isTimelineBanquetServiceBooking/);
    assert.match(timeline, /\.filter\(line => !isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)\)/);
    assert.match(timeline, /\.filter\(booking => !isTimelineBanquetServiceBooking\(booking\)\)/);
    assert.match(timeline, /function hydrateTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)/);
    assert.match(timeline, /function applyTimelineBanquetPreview[\s\S]*if \(!isRoomTimelineView\(\)\) return/);
    assert.doesNotMatch(timeline, /showTimelineBanquetServiceInspector/);
    assert.doesNotMatch(timeline, /data-banquet-preview-trigger/);
    assert.doesNotMatch(timeline, /data-banquet-service-marker/);
});

test('room-to-animator timeline view switch reconciles vertical shell height', () => {
    const timeline = read('js/timeline.js');
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
    assert.match(css, /body\.timeline-view-animators \.timeline-container\[data-timeline-height-ready="true"\]/);
    assert.match(css, /max-height: min\(var\(--timeline-content-height\), var\(--timeline-shell-max-height\)\)/);
    assert.match(responsive, /body\.timeline-dashboard-page\.timeline-view-animators \.timeline-container\[data-timeline-height-ready="true"\]/);
    assert.match(responsive, /v0\.73\.80: iPhone 11\/Safari needs a definite container height/);
    assert.match(responsive, /height: clamp\(360px, calc\(var\(--eg-viewport-height, 100dvh\) - 250px\), 58dvh\) !important;/);
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
            roomLoadPanel: { visible: false, density: 'compact' }
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
    assert.equal(rooms.blocks.roomLoadPanel.visible, false);
    assert.equal(rooms.views.animators.blocks.dateControls.visible, false);
    assert.equal(rooms.views.rooms.blocks.roomLoadPanel.density, 'compact');
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
