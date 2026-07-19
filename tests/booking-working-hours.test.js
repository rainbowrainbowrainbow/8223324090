const test = require('node:test');
const assert = require('node:assert/strict');

const {
    bookingWorkingHoursForDate,
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
