const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('week timeline uses the same canonical resource identity as day timeline', () => {
    const timeline = read('js/timeline.js');

    assert.match(timeline, /function timelineLineResourceIdentity/);
    assert.match(timeline, /function timelineBookingResourceIdentity/);
    assert.match(timeline, /function timelineBookingsForLine/);
    assert.match(timeline, /function normalizeTimelineBookingsForContext/);
    assert.match(timeline, /lines = normalizeTimelineLinesForContext\(Array\.isArray\(linesResult\) \? linesResult : \[\]\)/);
    assert.match(timeline, /bookings = normalizeTimelineBookingsForContext\(Array\.isArray\(bookingsResult\) \? bookingsResult : \[\]\)/);
    assert.match(timeline, /const rawLines = await getLinesForDate\(date\)/);
    assert.match(timeline, /const rawBookings = await getBookingsForDate\(date\)/);
    assert.match(timeline, /const lines = normalizeTimelineLinesForContext\(Array\.isArray\(rawLines\) \? rawLines : \[\]\)/);
    assert.match(timeline, /const bookings = normalizeTimelineBookingsForContext\(Array\.isArray\(rawBookings\) \? rawBookings : \[\]\)/);
    assert.match(timeline, /const hourWidth = cellWidth \* 4/);
    assert.match(timeline, /const gridWidth = Math\.max\(hourWidth, \(end - start\) \* hourWidth\)/);
    assert.match(timeline, /renderMiniLineHtml\(line, lineBookings, start, end, cellWidth\)/);
    assert.match(timeline, /function renderMiniLineHtml\(line, lineBookings, start, end, cellWidth\)/);
    assert.match(timeline, /--mini-grid-width: \$\{gridWidth\}px/);

    const lineBookingMatches = timeline.match(/timelineBookingsForLine\(bookings, line\)/g) || [];
    assert.ok(lineBookingMatches.length >= 2, 'day and week renderers must both use timelineBookingsForLine');
    assert.match(timeline, /data-resource-id="\$\{escapeHtml\(bookingIdentity\.resourceId\)\}"/);
    assert.match(timeline, /data-resource-type="\$\{escapeHtml\(bookingIdentity\.resourceType\)\}"/);
});

test('day/week period switch resets outer horizontal scroll and keeps week shell isolated', () => {
    const app = read('js/app.js');
    const timeline = read('js/timeline.js');
    const renderTimelineBlock = timeline.slice(
        timeline.indexOf('async function renderTimeline'),
        timeline.indexOf('function getBookingDragGroup')
    );
    const renderMultiDayBlock = timeline.slice(
        timeline.indexOf('async function renderMultiDayTimeline'),
        timeline.indexOf('async function changeDate')
    );

    assert.match(app, /function applyTimelinePeriod\(period[\s\S]*const previousPeriod = AppState\.multiDayMode \? TIMELINE_PERIOD_WEEK : TIMELINE_PERIOD_DAY/);
    assert.match(app, /previousPeriod !== normalizedPeriod[\s\S]*markTimelineNavigationScrollReset\('period-change'\)[\s\S]*renderTimeline\(\)/);
    assert.match(renderTimelineBlock, /if \(AppState\.multiDayMode\) \{[\s\S]*await renderMultiDayTimeline\(\);[\s\S]*return;[\s\S]*renderTimeScale\(selectedDate\);/);
    assert.doesNotMatch(renderMultiDayBlock, /captureTimelineHorizontalScrollState|restoreTimelineHorizontalScrollState|scrollLeft =/);
    assert.match(read('css/timeline.css'), /\.day-section-content\s*\{[\s\S]*overflow-x: auto/);
});

test('created booking reveal can find day blocks and week mini-blocks', () => {
    const booking = read('js/booking.js');
    const css = read('css/timeline.css');

    assert.match(booking, /\.booking-block\[data-booking-id="\$\{selectorId\}"\], \.mini-booking-block\[data-booking-id="\$\{selectorId\}"\]/);
    assert.match(booking, /timelineBookingResourceIdentity\(source\)/);
    assert.match(booking, /timelineLineResourceIdentity\(line\)/);
    assert.match(css, /\.mini-booking-block\.booking-block--just-created/);
});

test('booking rows and frontend payloads carry resource identity while keeping lineId compatibility', () => {
    const service = read('services/booking.js');
    const booking = read('js/booking.js');
    const timeline = read('js/timeline.js');

    assert.match(service, /const timelineIdentity = \{/);
    assert.match(service, /resourceId:\s*row\.resource_id\s*\|\|\s*row\.line_id\s*\|\|\s*extraData\?\.timelineIdentity\?\.resourceId/s);
    assert.match(service, /resourceId: timelineIdentity\.resourceId/);
    assert.match(service, /resourceType: timelineIdentity\.resourceType/);
    assert.match(service, /timelineIdentity,/);
    assert.match(timeline, /booking\?\.lineId\s*\|\|\s*booking\?\.line_id\s*\|\|\s*booking\?\.resourceId/s);
    assert.match(booking, /obj\.extraData\.timelineIdentity = \{/);
    assert.match(booking, /obj\.resourceId = timelineIdentity\.resourceId/);
    assert.match(booking, /lineId: formData\.lineId/);
});

test('timeline polish exposes admin presets and visibility presets without changing the default', () => {
    const html = read('index.html');
    const settings = read('js/settings.js');
    const visibility = read('js/timeline-visibility.js');
    const css = read('css/timeline.css');

    assert.match(html, /data-timeline-preset="dar"/);
    assert.match(html, /data-business-context="dar"/);
    assert.match(settings, /hasContextSpecificTwin/);
    assert.match(visibility, /const VISIBILITY_PRESETS = \[/);
    assert.match(visibility, /description:/);
    assert.match(visibility, /key: 'clean_phone'/);
    assert.match(visibility, /<small>\$\{escapeHtml\(preset\.description\)\}<\/small>/);
    assert.match(visibility, /function applyVisibilityPreset/);
    assert.match(css, /\.timeline-constructor-presets/);
    assert.match(css, /\.timeline-constructor-preset small/);
});
