const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { mapBookingRow, mapBookingRowWithVersion } = require('../services/booking');

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

test('booking optimistic-lock token preserves timestamp wall-clock fields across Node timezones', () => {
    const modulePath = path.resolve(__dirname, '../services/booking.js');
    const script = `const { mapBookingRowWithVersion } = require(${JSON.stringify(modulePath)}); const value = new Date(2026, 9, 25, 2, 30, 0, 123); process.stdout.write(mapBookingRowWithVersion({ updated_at: value }).updatedAtVersion);`;
    const tokens = ['UTC', 'Europe/Kyiv', 'America/Los_Angeles'].map(timezone => {
        const result = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            env: { ...process.env, TZ: timezone }
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
    });

    assert.deepEqual(tokens, [
        '2026-10-25 02:30:00.123',
        '2026-10-25 02:30:00.123',
        '2026-10-25 02:30:00.123'
    ]);
});

test('booking optimistic-lock token compares without changing the timestamp column type', () => {
    const route = fs.readFileSync(path.resolve(__dirname, '../routes/bookings.js'), 'utf8');
    const client = fs.readFileSync(path.resolve(__dirname, '../js/booking.js'), 'utf8');
    const mapper = mapBookingRowWithVersion({
        updated_at: new Date('2026-10-02T12:00:00.123Z'),
        updated_at_version_token: '2026-10-02 12:00:00.123'
    });

    assert.equal(mapper.updatedAtVersion, '2026-10-02 12:00:00.123');
    assert.match(route, /to_char\(date_trunc\('milliseconds', b\.updated_at\), 'YYYY-MM-DD HH24:MI:SS\.MS'\) AS updated_at_version_token/);
    assert.match(route, /to_char\(date_trunc\('milliseconds', updated_at\), 'YYYY-MM-DD HH24:MI:SS\.MS'\) = \$24/);
    assert.match(route, /date_trunc\('milliseconds', updated_at\) = date_trunc\('milliseconds', \$24::timestamp\)/);
    assert.match(client, /obj\.updatedAtVersion = AppState\.editingBookingUpdatedAtVersion \|\| null/);
});
