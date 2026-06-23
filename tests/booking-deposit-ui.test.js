const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function functionBlock(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.ok(start >= 0, `${name} should exist`);
    const next = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, next >= 0 ? next : source.length);
}

test('booking banquet detail renders backend-backed deposit status field', () => {
    const api = read('js/api.js');
    const booking = read('js/booking.js');
    const css = read('css/timeline.css');

    assert.match(api, /function apiGetBanquetDepositByBooking\(bookingId\)/);
    assert.match(api, /\/banquets\/by-booking\/\$\{encodeURIComponent\(bookingId\)\}\/deposit/);
    assert.match(api, /function apiGetBanquetDepositByGroup\(groupId\)/);
    assert.match(api, /\/banquets\/\$\{encodeURIComponent\(groupId\)\}\/deposit/);

    assert.match(booking, /function renderBanquetDepositStatusSection\(anchorBooking = \{\}, snapshot = null, projection = \{ loading: true \}\)/);
    assert.match(booking, /renderBanquetDepositStatusSection\(anchorBooking, snapshot\)/);
    assert.match(booking, /id="bookingBanquetDepositStatus"/);
    assert.match(booking, /loadBanquetDepositStatusForDetails\(booking, banquetSnapshot\)/);
    assert.match(css, /\.booking-banquet-deposit/);
});

test('deposit UI uses group projection first and never treats paid_amount as deposit status', () => {
    const booking = read('js/booking.js');
    const loadBlock = functionBlock(booking, 'loadBanquetDepositStatusForDetails');
    const labelBlock = functionBlock(booking, 'bookingDetailDepositStatusLabel');
    const warningsBlock = functionBlock(booking, 'bookingDetailDepositWarnings');

    assert.ok(
        loadBlock.indexOf('apiGetBanquetDepositByGroup(groupId)') < loadBlock.indexOf('apiGetBanquetDepositByBooking(primaryBookingId)'),
        'group deposit projection should be preferred before primary booking fallback'
    );
    assert.doesNotMatch(labelBlock, /paidAmount|paid_amount|paymentStatus|payment_status/);
    assert.match(warningsBlock, /paid_amount \/ payment_status/);
    assert.match(warningsBlock, /bookingDetailDepositHasCanonicalRecord\(projection\)/);
});
