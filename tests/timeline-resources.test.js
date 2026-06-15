const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
    assert.match(bookingsRoute, /projectBookingsForTimelineView/);
    assert.match(bookingsRoute, /timelineView !== 'rooms'/);
    assert.match(bookingsRoute, /!String\(booking\.linkedTo \|\| ''\)\.trim\(\) && isRealRoom\(booking\.room\)/);
    assert.match(bookingsRoute, /isRoomConflictBlockingRoom/);
    assert.match(bookingsRoute, /if \(!isRoomConflictBlockingRoom\(candidate\.room\)\) return null/);
    assert.match(api, /function timelineApiUrlWithView/);
    assert.match(api, /timelineView=\$\{encodeURIComponent\(String\(view\)\)\}/);
    assert.match(timeline, /TIMELINE_VIEW_ROOMS = 'rooms'/);
    assert.match(timeline, /function defaultTimelineViewMode\(\)/);
    assert.match(timeline, /presentation\?\.\(\)\?\.defaultTimelineView/);
    assert.match(timeline, /TIMELINE_VIEW_USER_CHOICE_VERSION/);
    assert.match(timeline, /function roomLoadBookingMinutes/);
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
