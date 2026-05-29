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
    assert.match(service, /line_id = ANY\(\$3::text\[\]\) OR room = ANY\(\$4::text\[\]\)/);
    assert.match(service, /requestedCapacity/);
    assert.match(service, /capacityAvailable/);
    assert.match(service, /overCapacity/);
    assert.match(service, /resourceBlock/);
});

test('lines route switches resource-backed modes away from animator sync', () => {
    const route = read('routes/lines.js');
    assert.match(route, /getTimelineDisplaySettings/);
    assert.match(route, /resourceTypeForDisplayMode\(display\.mode, display\)/);
    assert.match(route, /timelineResourceLinesForMode\(pool, businessContext, display\.mode, display\)/);
    assert.match(route, /X-Timeline-Lines-Source', 'timeline_resources'/);
    assert.match(route, /syncTimelineResourcesFromLines\(client, businessContext, resourceType, lines\)/);
});

test('free-room path becomes business-aware resource availability for cabinet modes', () => {
    const settings = read('routes/settings.js');
    const booking = read('js/booking.js');
    assert.match(settings, /timelineResourceAvailability/);
    assert.match(settings, /resourceTypeForDisplayMode\(display\.mode, display\)/);
    assert.match(settings, /COALESCE\(b\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(booking, /appendApiContext\?\.\(`\/rooms\/free\/\$\{date\}\/\$\{time\}\/\$\{duration\}`\)/);
    assert.match(settings, /req\.query\.capacity \|\| req\.query\.attendees \|\| req\.query\.kidsCount/);
    assert.match(booking, /capacity=\$\{encodeURIComponent\(String\(requestedCapacity\)\)\}/);
    assert.match(booking, /data-free-room/);
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
    assert.equal(startPagePathForBusiness('maysternya_doli', { mode: 'simple', timelineEnabled: true, startPage: 'timeline' }), '/maysternya-doli');
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
    assert.match(api, /async function apiGetBusinessCabinet/);
    assert.match(api, /async function apiSaveBusinessCabinet/);
    assert.match(settings, /function renderBusinessCabinetModuleButtons/);
    assert.match(settings, /function collectBusinessCabinetModules/);
    assert.match(settings, /apiSaveBusinessCabinet/);
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
    assert.equal(darCabinet.businessType, 'no_timeline');
    assert.equal(darCabinet.startPage, 'dashboard');
    assert.equal(darCabinet.timelineEnabled, false);

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
