'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const booking = fs.readFileSync(require('node:path').join(__dirname, '../js/booking.js'), 'utf8');
const routes = fs.readFileSync(require('node:path').join(__dirname, '../routes/bookings.js'), 'utf8');
function extract(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
test('education duration accepts whole minutes and rejects empty, fractional and out-of-range inputs', () => {
    let raw;
    const context = { document: { getElementById: () => ({ value: raw }) } };
    vm.createContext(context);
    vm.runInContext(extract(booking, 'function educationLessonDurationMinutes()', 'function getEducationLessonDetails('), context);
    for (const minutes of [1,30,45,60,90,1440]) { raw = String(minutes); assert.equal(context.educationLessonDurationMinutes(), minutes); }
    for (const invalid of ['', ' ', '0', '-1', '1.5', '1441', '45oops', 'Infinity']) { raw = invalid; assert.equal(context.educationLessonDurationMinutes(), 0); }
});
test('API duration validation rejects invalid education values without changing non-education contracts', () => {
    const context = { educationLessonFromPayload: payload => payload.extraData?.educationLesson || null };
    vm.createContext(context);
    vm.runInContext(extract(routes, 'function educationDurationError(', 'async function educationGroupWriteError('), context);
    for (const duration of [undefined,null,'',false,0,-1,1.5,1441,'45oops']) assert.ok(context.educationDurationError({ duration, extraData: { educationLesson: { mode: 'education_lesson' } } }));
    for (const duration of [1,30,45,60,90,1440,'45']) assert.equal(context.educationDurationError({ duration, extraData: { educationLesson: {} } }), null);
    for (const duration of [undefined,0,1.5,'45oops']) assert.equal(context.educationDurationError({ duration }), null);
});
test('education hydration and time-slot duration are independent of custom/catalog defaults', () => {
    const elements = { educationLessonDuration: { value: '30' }, customDuration: { value: '30' } };
    const context = { document: { getElementById: id => elements[id] }, isEducationTimelineBookingMode: () => true,
        educationLessonDetailsFromBooking: () => ({}), booking: { duration: 45 } };
    vm.createContext(context);
    vm.runInContext(extract(booking, 'function educationLessonDurationMinutes()', 'function getEducationLessonDetails('), context);
    // Extract hydration up to the next top-level function, avoiding the nested applyGroup declaration.
    const hydration = booking.slice(booking.indexOf('function hydrateEducationLessonFields('), booking.indexOf('\nfunction ', booking.indexOf('function hydrateEducationLessonFields(') + 1));
    vm.runInContext(hydration, context); context.hydrateEducationLessonFields({ duration: 45 });
    assert.equal(elements.educationLessonDuration.value, 45); assert.equal(elements.customDuration.value, '30');
    const slots = extract(booking, 'function bookingTimeSlotDurationMinutes()', 'function bookingWorkingHoursBusinessContext()');
    vm.runInContext(slots, context); assert.equal(context.bookingTimeSlotDurationMinutes(), 45);
    context.isEducationTimelineBookingMode = () => false;
    context.getSelectedActivityPrograms = () => []; context.bookingMultiActivityEnabled = () => false;
    context.findBookingProductById = () => null; elements.selectedProgram = { value: '' };
    assert.equal(context.bookingTimeSlotDurationMinutes(), 30);
});

test('education cabinet responses cannot repaint a newer request or another business', async () => {
    let business = 'dar'; const pending = []; const rendered = [];
    const context = { isEducationTimelineBookingMode: () => true,
        document: { getElementById: () => ({ value: 'Лабораторія «Винахідник»' }) },
        window: { TimelineBusinessContext: { current: () => ({ apiValue: business }) } },
        apiGetTimelineResources: () => new Promise(resolve => pending.push(resolve)),
        renderBookingRoomCatalogOptions: (rows, options) => rendered.push({ rows, options }), updateBookingSubmitState() {}, console };
    vm.createContext(context);
    vm.runInContext('let educationCabinetRequestVersion = 0;\n' + extract(booking, 'async function loadBookingRoomResourcesForSelect(', "if (typeof window !== 'undefined')"), context);
    const old = context.loadBookingRoomResourcesForSelect(); const current = context.loadBookingRoomResourcesForSelect();
    pending[1]([{ name: 'Творчий простір «Палітра»' }]); await current;
    pending[0]([{ name: 'Старий кабінет' }]); await old;
    assert.equal(rendered.length, 1); assert.equal(rendered[0].rows[0].name, 'Творчий простір «Палітра»');
    const foreign = context.loadBookingRoomResourcesForSelect(); business = 'maysternya_doli'; pending[2]([{ name: 'Кабінет іншого бізнесу' }]); await foreign;
    assert.equal(rendered.length, 1);
});
