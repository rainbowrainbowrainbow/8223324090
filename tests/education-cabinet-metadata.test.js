'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const booking = fs.readFileSync(path.join(root, 'js/booking.js'), 'utf8');
const identity = fs.readFileSync(path.join(root, 'js/timeline-resource-identity.js'), 'utf8');

function harness(education = true) {
    let date = '2030-01-10';
    const ctx = {
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        AppState: { selectedDate: new Date('2030-01-10T12:00:00'), currentUser: { username: 'test' }, editingBookingId: 'lesson-1' },
        BookingDrawerState: {}, window: {},
        isEducationTimelineBookingMode: () => education, isParkTimelineBookingMode: () => !education,
        educationLessonDateKey: () => date, formatDate: () => date,
        toBookingMoney: Number, buildExtraData: () => ({}),
        getNoEventBookingLabel: () => 'Booking', getNoEventProgramName: () => 'Booking',
        bookingPreorderStatusFromFormData: () => null, buildBookingWorkspaceExtraData: () => ({}),
        getBookingLineSnapshot: () => null, timelineEmbeddedIdentity: () => ({}),
        timelineDefaultResourceType: () => education ? 'cabinet' : 'animator',
        timelineBusinessContextValue: () => education ? 'dar' : 'event_genix',
        isMaysternyaBookingContext: () => false, bookingInlineCustomerCreationEnabled: () => false,
        attachActiveBanquetIntentMarker: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(identity.slice(0, identity.indexOf('function timelineProjectionView(')), ctx);
    vm.runInContext(booking.slice(booking.indexOf('function buildBookingObject('), booking.indexOf('function shouldCreateEducationLessonSeries(')), ctx);
    return { build: form => JSON.parse(JSON.stringify(ctx.buildBookingObject(form, null))), setDate: value => { date = value; } };
}

function form(name = 'Мовний кабінет «Веселка»', id = 'edu-cabinet-1') {
    return { hasEvent: true, time: '15:00', duration: 45, lineId: id, lineName: name,
        lineResourceType: 'cabinet', lineSource: 'timeline_resource', room: name,
        childrenCountSource: { value: null },
        educationLesson: { mode: 'education_lesson', title: 'Native calendar', teacherId: '98', groupId: '8', resourceId: id, resourceName: name } };
}

test('first education date edit retains the server-created cabinet display snapshot', () => {
    const h = harness();
    const created = h.build(form());
    // Create API supplies this display metadata; the first edit must not erase it.
    created.extraData.timelineIdentity.resourceName = form().room;
    h.setDate('2030-01-11');
    const edited = h.build(form());
    assert.deepEqual(edited.extraData, created.extraData);
    assert.equal(edited.date, '2030-01-11');
    for (const key of ['time', 'duration', 'room', 'lineId', 'resourceId', 'resourceType']) assert.equal(edited[key], created[key]);
});

test('cabinet display metadata follows the selected lesson cabinet instead of an old snapshot', () => {
    const h = harness();
    h.build(form());
    const changed = h.build(form('Лабораторія «Винахідник»', 'edu-cabinet-2'));
    assert.equal(changed.extraData.timelineIdentity.resourceName, 'Лабораторія «Винахідник»');
    assert.equal(changed.resourceId, 'edu-cabinet-2');
});

test('legacy education drafts use the existing lesson room fallback', () => {
    const draft = form(); delete draft.educationLesson.resourceName;
    const result = harness().build(draft);
    assert.equal(result.extraData.timelineIdentity.resourceName, draft.room);
});

test('Park payloads do not gain education cabinet metadata', () => {
    const draft = form(); delete draft.educationLesson;
    const result = harness(false).build(draft);
    assert.equal(Object.hasOwn(result.extraData.timelineIdentity, 'resourceName'), false);
    assert.equal(Object.hasOwn(result.extraData, 'educationLesson'), false);
});
