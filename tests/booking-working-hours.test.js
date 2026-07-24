const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const {
    bookingWorkingHoursForDate,
    resolveBookingWorkingHoursPolicy,
    validateBookingWithinWorkingHours
} = require('../services/booking');

test('booking working-hours validator resolves weekday and weekend boundaries', () => {
    assert.deepEqual(bookingWorkingHoursForDate('2099-02-13'), {
        isWeekend: false,
        start: '12:00',
        end: '20:00',
        startMinutes: 720,
        endMinutes: 1200
    });
    assert.deepEqual(bookingWorkingHoursForDate('2099-02-14'), {
        isWeekend: true,
        start: '10:00',
        end: '20:00',
        startMinutes: 600,
        endMinutes: 1200
    });
});

test('booking working-hours validator accepts last duration-aware weekday and weekend slots', () => {
    assert.equal(validateBookingWithinWorkingHours({
        date: '2099-02-13',
        time: '19:30',
        duration: 30
    }).valid, true);
    assert.equal(validateBookingWithinWorkingHours({
        date: '2099-02-14',
        time: '19:45',
        duration: 15
    }).valid, true);
});

test('booking working-hours validator rejects starts before opening and endings after closing', () => {
    const beforeWeekday = validateBookingWithinWorkingHours({
        date: '2099-02-13',
        time: '11:45',
        duration: 15
    });
    const afterWeekend = validateBookingWithinWorkingHours({
        date: '2099-02-14',
        time: '19:45',
        duration: 30
    });

    assert.equal(beforeWeekday.valid, false);
    assert.equal(beforeWeekday.code, 'BOOKING_OUTSIDE_WORKING_HOURS');
    assert.equal(afterWeekend.valid, false);
    assert.equal(afterWeekend.code, 'BOOKING_OUTSIDE_WORKING_HOURS');
    assert.equal(afterWeekend.details.workingHours.end, '20:00');
});

test('booking working-hours validator preserves unchanged legacy out-of-hours bookings', () => {
    const existing = {
        date: '2099-02-13',
        time: '10:00',
        duration: 60
    };

    assert.equal(validateBookingWithinWorkingHours({
        date: '2099-02-13',
        time: '10:00',
        duration: 60
    }, {
        existingBooking: existing,
        allowUnchangedLegacy: true
    }).valid, true);

    const changed = validateBookingWithinWorkingHours({
        date: '2099-02-13',
        time: '10:15',
        duration: 60
    }, {
        existingBooking: existing,
        allowUnchangedLegacy: true
    });

    assert.equal(changed.valid, false);
    assert.equal(changed.code, 'BOOKING_OUTSIDE_WORKING_HOURS');
});


test('booking working-hours policy is explicit for EventGenix and does not impose EventGenix hours on another context', () => {
    const eventGenix = resolveBookingWorkingHoursPolicy({
        businessContext: 'event_genix',
        date: '2099-02-13'
    });
    assert.equal(eventGenix.businessContext, 'event_genix');
    assert.equal(eventGenix.applies, true);
    assert.equal(eventGenix.workingHours.start, '12:00');

    const maysternya = resolveBookingWorkingHoursPolicy({
        businessContext: 'maysternya_doli',
        date: '2099-02-13'
    });
    assert.equal(maysternya.applies, false);
    assert.equal(maysternya.workingHours, null);

    assert.equal(validateBookingWithinWorkingHours({
        businessContext: 'maysternya_doli',
        date: '2099-02-13',
        time: '09:00',
        duration: 60
    }, {
        businessContext: 'maysternya_doli'
    }).valid, true);
});

test('booking working-hours validator rejects zero and invalid durations while preserving opening boundaries', () => {
    assert.equal(validateBookingWithinWorkingHours({
        date: '2099-02-13',
        time: '12:00',
        duration: 15
    }).valid, true);
    assert.equal(validateBookingWithinWorkingHours({
        date: '2099-02-14',
        time: '10:00',
        duration: 15
    }).valid, true);

    for (const duration of [0, -1, 1441]) {
        const result = validateBookingWithinWorkingHours({
            date: '2099-02-13',
            time: '12:00',
            duration
        });
        assert.equal(result.valid, false);
        assert.equal(result.code, 'BOOKING_WORKING_HOURS_INVALID_DURATION');
    }
});

test('all EventGenix direct booking writers delegate to the central working-hours validator', () => {
    const sourceFor = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    const routes = sourceFor('routes/bookings.js');
    const banquetGroups = sourceFor('services/banquetGroups.js');
    const recurring = sourceFor('services/recurring.js');
    const graduation = sourceFor('routes/graduation.js');
    const maintenance = sourceFor('scripts/audit-second-animator-links.js');

    assert.match(routes, /rejectBookingOutsideWorkingHours\(res, b, \{ businessContext \}\)/);
    assert.match(routes, /async function insertSecondAnimatorLinkedBooking[\s\S]*validateBookingWorkingHoursForWrite\(booking, \{ businessContext \}\)/);
    assert.match(routes, /rejectBookingOutsideWorkingHours\(res, main, \{ businessContext \}\)/);
    assert.match(routes, /rejectBookingOutsideWorkingHours\(res, lb, \{ businessContext \}\)/);
    assert.match(routes, /rejectBookingOutsideWorkingHours\(res, activity, \{ businessContext \}\)/);
    assert.match(routes, /allowUnchangedLegacy: true,\s*businessContext/);
    assert.match(banquetGroups, /businessContext: businessContext \|\| booking\.businessContext \|\| booking\.business_context \|\| DEFAULT_TIMELINE_CONTEXT/);
    assert.match(recurring, /const workingHoursValidation = validateBookingWithinWorkingHours\(/);
    assert.match(recurring, /reason: 'working_hours'/);
    assert.match(graduation, /const workingHoursValidation = validateBookingWithinWorkingHours\(/);
    assert.match(maintenance, /const workingHoursValidation = validateBookingWithinWorkingHours\(/);
});
