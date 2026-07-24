const test = require('node:test');
const assert = require('node:assert/strict');

const { mapBookingRow } = require('../services/booking');

test('booking row mapper preserves explicit zero banquet counts', () => {
    const booking = mapBookingRow({
        id: 'BK-ZERO',
        business_context: 'event_genix',
        date: '2026-09-03',
        time: '13:00',
        line_id: 'banquet-service',
        program_id: null,
        program_code: null,
        label: 'Banquet',
        program_name: 'Banquet',
        category: 'banquet',
        duration: 60,
        price: 0,
        hosts: 0,
        room: 'Test room',
        status: 'preliminary',
        kids_count: 0,
        banquet_guests: 0,
        banquet_adults: 0,
        banquet_tables: 0,
        extra_data: {}
    });

    assert.equal(booking.kidsCount, 0);
    assert.equal(booking.banquetGuests, 0);
    assert.equal(booking.banquetAdults, 0);
    assert.equal(booking.banquetTables, 0);
});
